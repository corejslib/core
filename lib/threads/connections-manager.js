import List from "#lib/data-structures/list";
import Events from "#lib/events";
import LifecycleManager from "#lib/threads/lifecycle-manager";
import Signal from "#lib/threads/signal";
import { sleep } from "#lib/utils";

class LeastLoaded {
    #buckets = new Map();
    #entries = new Map();
    #min = 0;

    // properties
    get size () {
        return this.#entries.size;
    }

    get least () {
        return this.size
            ? this.#buckets.get( this.#min ).firstEntry.value.item
            : undefined;
    }

    // public
    sizeOf ( count ) {
        return this.#buckets.get( count )?.length ?? 0;
    }

    add ( item, count = 0 ) {
        if ( this.#entries.has( item ) ) return this;

        this.#entries.set( item, this.#bucket( count ).push( { item, count } ) );

        if ( this.size === 1 || count < this.#min ) this.#min = count;

        return this;
    }

    update ( item, count ) {
        const entry = this.#entries.get( item );

        if ( !entry ) return this;

        const oldCount = entry.value.count,
            oldBucket = entry.list;

        if ( oldCount === count ) return this;

        entry.value.count = count;

        // push() detaches the entry from its current list
        this.#bucket( count ).push( entry );

        if ( !oldBucket.length ) this.#buckets.delete( oldCount );

        if ( count < this.#min ) {
            this.#min = count;
        }
        else if ( oldCount === this.#min ) {
            this.#advanceMin();
        }

        return this;
    }

    delete ( item ) {
        const entry = this.#entries.get( item );

        if ( !entry ) return this;

        const bucket = entry.list,
            count = entry.value.count;

        bucket.delete( entry );

        this.#entries.delete( item );

        if ( !bucket.length ) this.#buckets.delete( count );

        if ( this.size && count === this.#min ) this.#advanceMin();

        return this;
    }

    pick () {
        if ( !this.size ) return;

        const entry = this.#buckets.get( this.#min ).firstEntry;

        entry.list.push( entry );

        return entry.value.item;
    }

    // private
    #bucket ( count ) {
        let bucket = this.#buckets.get( count );

        if ( !bucket ) {
            bucket = new List();

            this.#buckets.set( count, bucket );
        }

        return bucket;
    }

    #advanceMin () {
        while ( !this.#buckets.has( this.#min ) ) this.#min++;
    }
}

// delay before retrying, when a connection was destroyed synchronously during creation
const CREATE_RETRY_DELAY = 100,

    // an exclusive request starts to reserve a connection after this number of average request durations
    DRAIN_DELAY_FACTOR = 2,
    MIN_DRAIN_DELAY = 5,
    MAX_DRAIN_DELAY = 5000,
    DEFAULT_DRAIN_DELAY = 200,

    // how long the peak regular demand is remembered, in average request durations
    DEMAND_WINDOW_FACTOR = 100,
    MIN_DEMAND_WINDOW = 1000,
    MAX_DEMAND_WINDOW = 30_000,
    DEFAULT_DEMAND_WINDOW = 5000,
    SERVICE_TIME_SMOOTHING = 0.1,

    // up to this number of hosts all of them are examined, above it two random hosts are compared
    FULL_SCAN_MAX_HOSTS = 16,

    // rounds of random sampling before falling back to the full scan
    SAMPLING_ROUNDS = 3,

    // how long the exclusive quota of a host is reused, ms
    QUOTA_CACHE_TIME = 1;

export default class ConnectionsManager {
    #uri;
    #createConnectionCallback;
    #maxConnectionsPerHost;

    // optional fixed delay, by default the delay is adaptive
    #fixedDrainDelay;

    // smoothed average duration of regular requests, ms
    #serviceTime;
    #idleTimeout;
    #serviceDiscovery;
    #appName;
    #serviceName;
    #hosts = new Map();

    // the same hosts as an array, for O(1) random access
    #hostsList = [];
    #connections = new Map();
    #changeSignal = new Signal();
    #lifecycleManager;
    #serviceDicoveryEvents;

    // pending pool requests in FIFO order
    #waiters = new Set();
    #exclusiveWaiters = 0;

    // connections, which are reserved for pending exclusive requests and are waiting for their active requests to finish
    #draining = new Set();
    #dispatching = false;
    #dispatchAgain = false;
    #dispatchTimer = null;

    constructor ( { uri, createConnection, maxConnectionsPerHost = 1, exclusiveDrainDelay, idleTimeout, serviceDiscovery, appName, serviceName } = {} ) {
        this.#uri = uri;
        this.#createConnectionCallback = createConnection;
        this.#maxConnectionsPerHost = maxConnectionsPerHost;
        this.#fixedDrainDelay = exclusiveDrainDelay;
        this.#idleTimeout = idleTimeout;
        this.#serviceDiscovery = serviceDiscovery;
        this.#appName = appName;
        this.#serviceName = serviceName;

        this.#lifecycleManager = new LifecycleManager( {
            "onStart": this.#start.bind( this ),
            "onStop": this.#stop.bind( this ),
        } );
    }

    // properties
    get maxConnectionsPerHost () {
        return this.#maxConnectionsPerHost;
    }

    // exclusive locks leave the regular traffic the share of the pool it actually uses, so the limit follows the load
    get maxExclusiveConnections () {
        var total = 0;

        for ( const host of this.#hosts.values() ) {
            total += this.#getMaxExclusive( host );
        }

        return total;
    }

    get idleTimeout () {
        return this.#idleTimeout;
    }

    get hasHosts () {
        return this.#hosts.size > 0;
    }

    // public
    async start () {
        return this.#lifecycleManager.start();
    }

    async stop () {
        return this.#lifecycleManager.stop();
    }

    async getConnection ( signal ) {
        return this.#acquireConnection( signal, false );
    }

    async lockConnection ( callback, { signal, exclusive } = {} ) {
        const connection = await this.#acquireConnection( signal, exclusive );

        try {
            return await callback( connection, { signal } );
        }
        finally {
            if ( exclusive && connection ) {
                this.#unlockConnection( connection );
            }
        }
    }

    async createConnection ( callback, { signal } = {} ) {
        const connection = await this.#acquireExternalConnection( signal );

        try {
            return await callback( connection, { signal } );
        }
        finally {

            // connection can be already destroyed and untracked
            if ( connection ) {
                await this.#connections.get( connection )?.lifecycleManager.destroy();
            }
        }
    }

    destroyConnections () {
        const states = this.#connections.values().toArray();

        for ( const state of states ) {
            state.lifecycleManager.forceDestroy();
        }
    }

    isConnectionExclusive ( connection ) {
        return this.#connections.get( connection )?.locked ?? false;
    }

    // private
    async #start () {
        if ( this.#uri ) {
            this.#addService( this.#uri );
        }
        else if ( this.#serviceDiscovery ) {
            if ( !this.#serviceDicoveryEvents ) {
                this.#serviceDicoveryEvents = new Events().link( this.#serviceDiscovery );
            }

            this.#setServiceDiscoverySubscription( true );

            const services = await this.#serviceDiscovery.getServices( this.#appName, this.#serviceName );

            for ( const uri of services ) {
                this.#addService( uri );
            }
        }

        return result( 200 );
    }

    async #stop () {
        this.#setServiceDiscoverySubscription( false );

        // hosts are cleared, so destroyed connections are not created again
        const hosts = this.#hosts.values().toArray();

        this.#clearHosts();

        // pending get / lock requests are terminated, because lifecycle can't begin thread anymore
        this.#releaseWaiters();
        this.#changeSignal.broadcast();

        // destroy all connections and wait
        const results = await Promise.all( this.#connections
            .values()
            .map( state => state.lifecycleManager.destroy() )
            .toArray() );

        const failedResult = results.find( res => !res.ok );

        // failed to destroy some connections, rollback
        if ( failedResult ) {
            for ( const host of hosts ) {
                this.#setHost( host );
            }

            this.#setServiceDiscoverySubscription( true );

            return failedResult;
        }

        return result( 200 );
    }

    #setServiceDiscoverySubscription ( subscribe ) {
        if ( !this.#serviceDicoveryEvents ) return;

        if ( subscribe ) {
            this.#serviceDicoveryEvents.on( `add/${ this.#appName }/${ this.#serviceName }`, this.#addService.bind( this ) );
            this.#serviceDicoveryEvents.on( `delete/${ this.#appName }/${ this.#serviceName }`, this.#deleteService.bind( this ) );
        }
        else {
            this.#serviceDicoveryEvents.offAll();
        }
    }

    #addService ( uri ) {
        if ( this.#hosts.has( uri ) ) return;

        const host = {
            uri,

            // load of the host: active requests of its connections (including requests inside exclusive locks) plus external connections
            "count": 0,

            // connections occupying pool slots
            "connections": new Set(),

            // connections created by createConnection(), they do not occupy pool slots
            "external": new Set(),
            "available": new LeastLoaded(),

            // pool connections, which are locked exclusively or reserved for an exclusive request
            "locked": 0,

            // peak number of connections used by regular requests, decays with time
            "demand": 0,
            "demandAt": performance.now(),
            "quota": 1,
            "quotaAt": -Infinity,
        };

        this.#setHost( host );

        this.#changeSignal.broadcast();
        this.#dispatch();
    }

    #deleteService ( uri ) {
        const host = this.#hosts.get( uri );

        if ( !host ) return;

        this.#deleteHost( host );

        // connections are destroyed by the standard procedure, #onConnectionDestroy() updates all counters
        for ( const connection of Iterator.concat( host.connections, host.external ) ) {
            this.#connections.get( connection ).lifecycleManager.forceDestroy();
        }

        this.#dispatch();
    }

    #setHost ( host ) {
        host.index = this.#hostsList.length;

        this.#hostsList.push( host );
        this.#hosts.set( host.uri, host );
    }

    #deleteHost ( host ) {

        // swap with the last one
        const last = this.#hostsList.pop();

        if ( last !== host ) {
            this.#hostsList[ host.index ] = last;

            last.index = host.index;
        }

        this.#hosts.delete( host.uri );
    }

    #clearHosts () {
        this.#hostsList = [];

        this.#hosts.clear();
    }

    #createConnection ( host, external = false ) {
        var connection,
            destroyed = false;

        const lifecycleManager = new LifecycleManager( {
            "idleTimeout": external
                ? undefined
                : this.#idleTimeout,
        } )
            .on( "destroying", () => {

                // can be emitted synchronously from the createConnection callback, before the connection is returned
                if ( !connection ) {
                    destroyed = true;

                    return;
                }

                this.#onConnectionDestroy( connection );
            } )
            .on( "threads-activity", threadsCount => {
                if ( connection ) this.#onConnectionThreads( connection, threadsCount );
            } )
            .on( "requests-activity", requestsCount => {
                if ( connection ) this.#onConnectionRequests( connection, requestsCount );
            } );

        connection = this.#createConnectionCallback( this, host.uri, lifecycleManager );

        // connection was destroyed during creation, so it is not registered in the pool and must not be returned
        if ( destroyed ) return;

        this.#connections.set( connection, {
            host,
            lifecycleManager,

            // active threads: the connection is in use, so it can't be locked exclusively
            "threads": 0,

            // active requests: the load, which is balanced
            "requests": 0,

            // position in the pool ordering, see #getLevel()
            "level": 0,

            // external connection is always locked
            "locked": external,

            // reserved for a pending exclusive request
            "draining": false,
            "external": external,

            // idle timeout of the connection, saved while it is locked
            "idleTimeout": undefined,

            // start times of active requests
            "begins": [],
        } );

        if ( external ) {

            // external connection is not selectable and does not occupy pool slots, but it counts as one active request of the host
            host.external.add( connection );

            host.count++;
        }
        else {
            host.connections.add( connection );

            this.#makeAvailable( host, connection, 0 );
        }

        return connection;
    }

    async #acquireExternalConnection ( signal ) {
        while ( !signal?.aborted && this.#lifecycleManager.canBeginActivity ) {
            const host = this.#pickHost();

            if ( host ) {

                // must be created synchronously, so the host can't be deleted in between
                const connection = this.#createConnection( host, true );

                if ( connection ) return connection;

                // connection was destroyed during creation, retry later to avoid a busy loop
                try {
                    await sleep( CREATE_RETRY_DELAY, null, { signal } );
                }
                catch {}
            }
            else {

                // no hosts yet, wait for service discovery
                await this.#changeSignal.wait( { signal } );
            }
        }
    }

    #pickHost () {
        if ( this.#hostsList.length > FULL_SCAN_MAX_HOSTS ) {
            const [ a, b ] = this.#sampleHosts();

            return a.count <= b.count
                ? a
                : b;
        }

        var selected;

        for ( const host of this.#hosts.values() ) {
            if ( !selected || host.count < selected.count ) selected = host;
        }

        return selected;
    }

    // two different random hosts, requires at least two hosts
    #sampleHosts () {
        const length = this.#hostsList.length,
            i = Math.floor( Math.random() * length );

        var j = Math.floor( Math.random() * ( length - 1 ) );

        if ( j >= i ) j++;

        return [ this.#hostsList[ i ], this.#hostsList[ j ] ];
    }

    // unlocked connections plus connections, which can still be created
    #getFreeCount ( host ) {
        return host.available.size + this.#maxConnectionsPerHost - host.connections.size;
    }

    // idle connections (without active requests) plus connections, which can still be created
    #getIdleCount ( host ) {
        return host.available.sizeOf( 0 ) + this.#maxConnectionsPerHost - host.connections.size;
    }

    async #acquireConnection ( signal, lock ) {
        if ( signal?.aborted || !this.#lifecycleManager.canBeginActivity ) return;

        // nothing older of the same kind can be served right now (see #dispatch()), so serving this request at once doesn't break FIFO
        const connection = this.#tryAcquire( lock );

        if ( connection ) return connection;

        return this.#wait( signal, lock );
    }

    // selects the host and the connection, locks the connection if needed, all synchronously, so nobody else can take it
    #tryAcquire ( lock ) {
        const host = this.#selectHost( lock );

        if ( !host ) return;

        const connection = this.#pickConnection( host );

        // connection was destroyed during creation, retry later to avoid a busy loop
        if ( !connection ) {
            this.#scheduleDispatch();

            return;
        }

        if ( lock ) this.#lockConnection( connection );

        return connection;
    }

    // many hosts: "power of two choices", two random hosts are compared, this gives almost the same balance as the full scan at O(1)
    // few hosts, or no suitable host among the sampled ones: the full scan, so a suitable host is never missed
    #selectHost ( lock ) {
        const now = performance.now();

        if ( this.#hostsList.length > FULL_SCAN_MAX_HOSTS ) {
            for ( let round = 0; round < SAMPLING_ROUNDS; round++ ) {
                const [ a, b ] = this.#sampleHosts(),
                    canA = this.#canServe( a, lock, now ),
                    canB = this.#canServe( b, lock, now );

                if ( canA && canB ) {
                    return this.#isLessLoaded( b, a, lock )
                        ? b
                        : a;
                }

                if ( canA ) return a;

                if ( canB ) return b;
            }
        }

        var selected;

        for ( const host of this.#hosts.values() ) {
            if ( !this.#canServe( host, lock, now ) ) continue;

            if ( !selected || this.#isLessLoaded( host, selected, lock ) ) selected = host;
        }

        return selected;
    }

    // exclusive lock requires a clean connection without active requests and a free exclusive slot of the host
    #canServe ( host, lock, now ) {
        return lock
            ? this.#getIdleCount( host ) > 0 && host.locked < this.#getMaxExclusive( host, now )
            : this.#getFreeCount( host ) > 0;
    }

    // exclusive locks are spread between the hosts first, so one host never accumulates all of them
    #isLessLoaded ( a, b, lock ) {
        if ( lock && a.locked !== b.locked ) return a.locked < b.locked;

        return a.count < b.count;
    }

    #pickConnection ( host ) {
        const least = host.available.least;

        // connections are created on demand, when there is no idle connection
        if ( host.connections.size < this.#maxConnectionsPerHost && ( !least || this.#connections.get( least ).level ) ) {
            return this.#createConnection( host );
        }

        return host.available.pick();
    }

    // request queue
    #wait ( signal, lock ) {
        return new Promise( resolve => {
            const waiter = {
                lock,
                resolve,
                signal,
                "aged": false,
                "timer": null,
                "onAbort": null,
            };

            this.#waiters.add( waiter );

            if ( lock ) {
                this.#exclusiveWaiters++;

                // long waiting exclusive request starts to reserve a connection, otherwise it can starve under constant load
                waiter.timer = setTimeout( () => {
                    waiter.timer = null;
                    waiter.aged = true;

                    this.#drainAged();
                }, this.#drainDelay );

                waiter.timer.unref?.();
            }

            if ( signal ) {
                waiter.onAbort = () => {
                    if ( !this.#removeWaiter( waiter ) ) return;

                    waiter.resolve();

                    this.#undrainSurplus();
                };

                signal.addEventListener( "abort", waiter.onAbort, { "once": true } );
            }
        } );
    }

    #removeWaiter ( waiter ) {
        if ( !this.#waiters.delete( waiter ) ) return false;

        if ( waiter.timer ) clearTimeout( waiter.timer );

        if ( waiter.onAbort ) waiter.signal.removeEventListener( "abort", waiter.onAbort );

        if ( waiter.lock ) this.#exclusiveWaiters--;

        return true;
    }

    #serve ( waiter, connection ) {
        this.#removeWaiter( waiter );

        waiter.resolve( connection );
    }

    #firstExclusiveWaiter () {
        for ( const waiter of this.#waiters ) {
            if ( waiter.lock ) return waiter;
        }
    }

    #releaseWaiters () {
        const waiters = [ ...this.#waiters ];

        for ( const waiter of waiters ) {
            this.#removeWaiter( waiter );

            waiter.resolve();
        }

        this.#undrainSurplus();

        if ( this.#dispatchTimer ) {
            clearTimeout( this.#dispatchTimer );

            this.#dispatchTimer = null;
        }
    }

    // serves pending requests in FIFO order, must be called after every change, which can make a request servable
    // invariant: after the call no pending request can be served
    #dispatch () {
        if ( this.#dispatching ) {
            this.#dispatchAgain = true;

            return;
        }

        this.#dispatching = true;

        try {
            do {
                this.#dispatchAgain = false;

                this.#dispatchPass();
            } while ( this.#dispatchAgain );
        }
        finally {
            this.#dispatching = false;
        }
    }

    #dispatchPass () {
        if ( this.#waiters.size && this.#lifecycleManager.canBeginActivity ) {

            // if the oldest request of some kind can't be served, the newer ones of the same kind can't either
            var blockedRegular = false,
                blockedExclusive = false;

            for ( const waiter of this.#waiters ) {
                if ( waiter.lock
                    ? blockedExclusive
                    : blockedRegular ) continue;

                const connection = this.#tryAcquire( waiter.lock );

                if ( connection ) {
                    this.#serve( waiter, connection );
                }
                else if ( waiter.lock ) {
                    blockedExclusive = true;
                }
                else {
                    blockedRegular = true;
                }

                // nothing left to try: every kind, which still has pending requests, is blocked
                if ( ( blockedRegular || this.#waiters.size === this.#exclusiveWaiters ) && ( blockedExclusive || !this.#exclusiveWaiters ) ) break;
            }
        }

        this.#undrainSurplus();
        this.#drainAged();
    }

    #scheduleDispatch () {
        if ( this.#dispatchTimer ) return;

        this.#dispatchTimer = setTimeout( () => {
            this.#dispatchTimer = null;

            this.#dispatch();
        }, CREATE_RETRY_DELAY );
    }

    // adaptive parameters
    // measures the request durations, the mean doesn't depend on the order, in which begin and end times are matched
    #trackRequests ( state, delta ) {
        const now = performance.now();

        if ( delta > 0 ) {
            for ( let i = 0; i < delta; i++ ) {
                state.begins.push( now );
            }

            // a new request can enlarge the regular demand, so the peak is registered at once
            if ( !state.locked ) this.#getRegularDemand( state.host );

            return;
        }

        for ( let i = 0; i < -delta; i++ ) {
            const begin = state.begins.shift();

            if ( begin == null ) continue;

            const duration = now - begin;

            this.#serviceTime = this.#serviceTime == null
                ? duration
                : this.#serviceTime + ( duration - this.#serviceTime ) * SERVICE_TIME_SMOOTHING;
        }
    }

    // fast requests: reserve soon, the connection will be free in a moment; slow requests: wait longer, a natural idle moment is more
    // likely than the long loss of the connection for the regular traffic
    get #drainDelay () {
        if ( this.#fixedDrainDelay != null ) return this.#fixedDrainDelay;

        if ( this.#serviceTime == null ) return DEFAULT_DRAIN_DELAY;

        return Math.min( Math.max( this.#serviceTime * DRAIN_DELAY_FACTOR, MIN_DRAIN_DELAY ), MAX_DRAIN_DELAY );
    }

    get #demandWindow () {
        if ( this.#serviceTime == null ) return DEFAULT_DEMAND_WINDOW;

        return Math.min( Math.max( this.#serviceTime * DEMAND_WINDOW_FACTOR, MIN_DEMAND_WINDOW ), MAX_DEMAND_WINDOW );
    }

    // peak with exponential decay: grows at once, shrinks slowly, so a short pause doesn't give the pool away to exclusive locks
    #getRegularDemand ( host, now = performance.now() ) {

        // unlocked connections with active requests
        const busy = host.available.size - host.available.sizeOf( 0 );

        // the demand grows, so the cached quota is outdated
        if ( busy > host.demand ) host.quotaAt = -Infinity;

        // the decayed value can't exceed the previous one, so decay is calculated only when it can matter
        host.demand = busy >= host.demand
            ? busy
            : Math.max( busy, host.demand * Math.exp( ( host.demandAt - now ) / this.#demandWindow ) );

        host.demandAt = now;

        return host.demand;
    }

    // regular traffic keeps the connections it uses plus one to grow, the rest can be locked, but at least one lock is always possible
    #getMaxExclusive ( host, now = performance.now() ) {
        if ( now - host.quotaAt >= QUOTA_CACHE_TIME ) {
            host.quota = Math.max( 1, this.#maxConnectionsPerHost - Math.round( this.#getRegularDemand( host, now ) ) - 1 );
            host.quotaAt = now;
        }

        return host.quota;
    }

    // the pool orders connections by the requests, the connection in use without active requests (for example, a held transaction)
    // goes after the clean one, and level 0 means a clean connection, which can be locked exclusively
    #getLevel ( state ) {
        return state.requests * 2 + ( !state.requests && state.threads
            ? 1
            : 0 );
    }

    #refreshLevel ( connection, state ) {
        const level = this.#getLevel( state );

        if ( level === state.level ) return;

        state.level = level;

        // update() ignores locked and reserved connections
        state.host.available.update( connection, level );

        if ( level ) return;

        // connection became clean
        if ( state.draining ) {
            this.#handoffDrained( connection );
        }
        else if ( this.#exclusiveWaiters && !state.locked ) {
            this.#dispatch();
        }
    }

    // exclusive locks
    #lockConnection ( connection ) {
        const state = this.#connections.get( connection );

        // reserved connection already occupies an exclusive slot of the host
        if ( state.draining ) {
            state.draining = false;

            this.#draining.delete( connection );
        }
        else {
            state.host.locked++;
        }

        state.locked = true;

        // locked connection must not be stopped by idle timer
        state.idleTimeout = state.lifecycleManager.idleTimeout;

        state.lifecycleManager.setIdleTimeout( null );

        this.#makeUnavailable( state.host, connection );
    }

    #unlockConnection ( connection ) {
        const state = this.#connections.get( connection );

        // connection was destroyed while it was locked
        if ( !state?.locked ) return;

        state.locked = false;

        state.host.locked--;

        // restore only if the timeout was not changed while the connection was locked
        if ( state.lifecycleManager.idleTimeout == null ) state.lifecycleManager.setIdleTimeout( state.idleTimeout );

        state.idleTimeout = undefined;

        this.#makeAvailable( state.host, connection, state.level );

        this.#dispatch();
    }

    // reserves the least loaded connection for a pending exclusive request: new requests do not use it anymore,
    // and it is handed over as soon as its active requests are finished
    #drainOne () {
        var selected, selectedLevel;

        for ( const host of this.#hosts.values() ) {
            if ( host.locked >= this.#getMaxExclusive( host ) ) continue;

            const connection = host.available.least;

            if ( !connection ) continue;

            const state = this.#connections.get( connection );

            if ( !selected || state.level < selectedLevel || ( state.level === selectedLevel && host.locked < this.#connections.get( selected ).host.locked ) ) {
                selected = connection;
                selectedLevel = state.level;
            }
        }

        if ( !selected ) return false;

        const state = this.#connections.get( selected );

        state.draining = true;

        state.host.locked++;

        this.#draining.add( selected );

        this.#makeUnavailable( state.host, selected );

        if ( !state.level ) this.#handoffDrained( selected );

        return true;
    }

    #drainAged () {
        while ( this.#draining.size < this.#getAgedExclusiveWaiters() ) {
            if ( !this.#drainOne() ) break;
        }
    }

    #getAgedExclusiveWaiters () {
        var count = 0;

        for ( const waiter of this.#waiters ) {
            if ( waiter.lock && waiter.aged ) count++;
        }

        return count;
    }

    #handoffDrained ( connection ) {
        const waiter = this.#firstExclusiveWaiter();

        // nobody needs it anymore
        if ( !waiter ) {
            this.#undrain( connection );

            this.#dispatch();

            return;
        }

        this.#lockConnection( connection );

        this.#serve( waiter, connection );
    }

    #undrain ( connection ) {
        const state = this.#connections.get( connection );

        state.draining = false;

        state.host.locked--;

        this.#draining.delete( connection );

        this.#makeAvailable( state.host, connection, state.level );
    }

    // reservations are never kept without a request, which needs them
    #undrainSurplus () {
        if ( this.#draining.size <= this.#exclusiveWaiters ) return;

        // the busiest connections are returned to the pool first
        const connections = [ ...this.#draining ].sort( ( a, b ) => this.#connections.get( b ).level - this.#connections.get( a ).level );

        for ( const connection of connections ) {
            if ( this.#draining.size <= this.#exclusiveWaiters ) break;

            this.#undrain( connection );
        }
    }

    #makeAvailable ( host, connection, activeRequestsCount ) {
        host.available.add( connection, activeRequestsCount );
    }

    #makeUnavailable ( host, connection ) {
        host.available.delete( connection );
    }

    // threads show that the connection is in use
    #onConnectionThreads ( connection, threadsCount ) {
        const state = this.#connections.get( connection );

        if ( !state ) return;

        state.threads = threadsCount;

        this.#refreshLevel( connection, state );
    }

    // requests are the load of the host
    #onConnectionRequests ( connection, requestsCount ) {
        const state = this.#connections.get( connection );

        if ( !state ) return;

        const delta = requestsCount - state.requests;

        if ( !delta ) return;

        state.requests = requestsCount;
        state.host.count += delta;

        if ( !state.external ) this.#trackRequests( state, delta );

        this.#refreshLevel( connection, state );
    }

    #onConnectionDestroy ( connection ) {
        const state = this.#connections.get( connection );

        if ( !state ) return;

        const host = state.host;

        this.#connections.delete( connection );

        host.count -= state.requests;

        // external connection does not occupy pool slots, so there is nothing to release
        if ( state.external ) {
            host.external.delete( connection );
            host.count--;

            return;
        }

        host.connections.delete( connection );

        // destroyed locked or reserved connection releases its exclusive slot
        if ( state.locked || state.draining ) host.locked--;

        this.#draining.delete( connection );

        this.#makeUnavailable( host, connection );

        // a pool slot is released, so a pending request can be served, a new connection can be created instead of the destroyed one
        this.#dispatch();
    }
}
