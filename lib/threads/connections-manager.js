import List from "#lib/data-structures/list";
import Events from "#lib/events";
import LifecycleManager from "#lib/threads/lifecycle-manager";
import Signal from "#lib/threads/signal";

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

export default class ConnectionsManager {
    #uri;
    #createConnectionCallback;
    #maxConnectionsPerHost;
    #idleTimeout;
    #serviceDiscovery;
    #appName;
    #serviceName;
    #hosts = new Map();
    #connections = new Map();
    #changeSignal = new Signal();
    #lifecycleManager;
    #serviceDicoveryEvents;
    #exclusiveWaiters = 0;
    #exclusiveCount = 0;

    constructor ( { uri, createConnection, maxConnectionsPerHost = 1, idleTimeout, serviceDiscovery, appName, serviceName } = {} ) {
        this.#uri = uri;
        this.#createConnectionCallback = createConnection;
        this.#maxConnectionsPerHost = maxConnectionsPerHost;
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

    // exclusive pool locks never take more than half of the pool connections
    get maxExclusiveConnections () {
        return Math.ceil( ( this.#maxConnectionsPerHost * this.#hosts.size ) / 2 );
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
        const states = [ ...this.#connections.values() ];

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
        const hosts = [ ...this.#hosts.values() ];

        this.#hosts.clear();

        // pending get / lock requests are terminated, because lifecycle can't begin thread anymore
        this.#changeSignal.broadcast();

        // destroy all connections and wait
        const results = await Promise.all( [ ...this.#connections.values() ].map( state => state.lifecycleManager.destroy() ) );

        const failedResult = results.find( res => !res.ok );

        // failed to destroy some connections, rollback
        if ( failedResult ) {
            for ( const host of hosts ) {
                this.#hosts.set( host.uri, host );
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
            "count": 0,
            "connections": new Set(),

            // connections created by createConnection(), they do not occupy pool slots
            "external": new Set(),
            "available": new LeastLoaded(),
        };

        this.#hosts.set( uri, host );

        this.#changeSignal.broadcast();
    }

    #deleteService ( uri ) {
        const host = this.#hosts.get( uri );

        if ( !host ) return;

        this.#hosts.delete( uri );

        for ( const connection of host.connections ) this.#forceDestroyConnection( connection );
        for ( const connection of host.external ) this.#forceDestroyConnection( connection );

        host.connections.clear();
        host.external.clear();

        // exclusive limit depends on the number of hosts
        this.#changeSignal.broadcast();
    }

    #forceDestroyConnection ( connection ) {
        const state = this.#connections.get( connection );

        // connection is no longer tracked, so it can't be selected or unlocked
        this.#connections.delete( connection );

        // active requests of the destroyed connection are no longer counted by the host, external connection also counts as one request
        state.host.count -= state.count + ( state.external
            ? 1
            : 0 );

        // destroyed locked connection releases its exclusive slot, external connections are not limited
        if ( state.locked && !state.external ) this.#exclusiveCount--;

        state.lifecycleManager.forceDestroy();
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
            .on( "activity", activeRequestsCount => {
                if ( connection ) this.#onConnectionActivity( connection, activeRequestsCount );
            } );

        connection = this.#createConnectionCallback( this, host.uri, lifecycleManager );

        // connection was destroyed during creation, so it is not registered in the pool
        if ( destroyed ) return connection;

        this.#connections.set( connection, {
            host,
            lifecycleManager,
            "count": 0,

            // external connection is always locked
            "locked": external,
            "external": external,

            // idle timeout of the connection, saved while it is locked
            "idleTimeout": undefined,
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
        while ( !signal?.aborted && this.#lifecycleManager.canBeginThread ) {
            const host = this.#pickHost();

            // must be created synchronously, so the host can't be deleted in between
            if ( host ) return this.#createConnection( host, true );

            // no hosts yet, wait for service discovery
            await this.#changeSignal.wait( { signal } );
        }
    }

    #pickHost () {
        var result;

        for ( const host of this.#hosts.values() ) {
            if ( !result || host.count < result.count ) result = host;
        }

        return result;
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
        while ( !signal?.aborted && this.#lifecycleManager.canBeginThread ) {

            // parallel exclusive locks are limited, so regular requests always have a share of the pool
            if ( !lock || this.#exclusiveCount < this.maxExclusiveConnections ) {
                let selectedHost;

                // single pass: select the least loaded suitable host
                for ( const host of this.#hosts.values() ) {

                    // exclusive lock requires a clean connection without active requests
                    if ( !( lock
                        ? this.#getIdleCount( host )
                        : this.#getFreeCount( host ) ) ) continue;

                    if ( !selectedHost || host.count < selectedHost.count ) selectedHost = host;
                }

                if ( selectedHost ) {
                    const connection = this.#pickConnection( selectedHost );

                    // must be locked synchronously, so nobody else can take the same connection
                    if ( lock ) this.#lockConnection( connection );

                    return connection;
                }
            }

            // exclusive waiters are woken up, when a connection becomes idle or an exclusive lock is released
            if ( lock ) this.#exclusiveWaiters++;

            try {
                await this.#changeSignal.wait( { signal } );
            }
            finally {
                if ( lock ) this.#exclusiveWaiters--;
            }
        }
    }

    #pickConnection ( host ) {
        const least = host.available.least;

        // connections are created on demand, when there is no idle connection
        if ( host.connections.size < this.#maxConnectionsPerHost && ( !least || this.#connections.get( least ).count ) ) {
            return this.#createConnection( host );
        }

        return host.available.pick();
    }

    #lockConnection ( connection ) {
        const state = this.#connections.get( connection );

        // connection was destroyed during creation
        if ( !state ) return;

        state.locked = true;

        this.#exclusiveCount++;

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

        this.#exclusiveCount--;

        // restore only if the timeout was not changed while the connection was locked
        if ( state.lifecycleManager.idleTimeout == null ) state.lifecycleManager.setIdleTimeout( state.idleTimeout );

        state.idleTimeout = undefined;

        this.#makeAvailable( state.host, connection, state.count );

        this.#changeSignal.broadcast();
    }

    #makeAvailable ( host, connection, activeRequestsCount ) {
        host.available.add( connection, activeRequestsCount );
    }

    #makeUnavailable ( host, connection ) {
        host.available.delete( connection );
    }

    #onConnectionActivity ( connection, activeRequestsCount ) {
        const state = this.#connections.get( connection );

        if ( !state ) return;

        const host = state.host,
            delta = activeRequestsCount - state.count;

        if ( !delta ) return;

        state.count = activeRequestsCount;
        host.count += delta;

        // update() ignores locked connections
        host.available.update( connection, activeRequestsCount );

        // connection became idle, so a pending exclusive lock request can take it
        if ( !activeRequestsCount && this.#exclusiveWaiters && !state.locked ) this.#changeSignal.broadcast();
    }

    #onConnectionDestroy ( connection ) {
        const state = this.#connections.get( connection );

        if ( !state ) return;

        const host = state.host;

        this.#connections.delete( connection );
        host.count -= state.count;

        // external connection does not occupy pool slots, so there is nothing to release
        if ( state.external ) {
            host.external.delete( connection );
            host.count--;

            return;
        }

        host.connections.delete( connection );

        // destroyed locked connection releases its exclusive slot
        if ( state.locked ) this.#exclusiveCount--;

        this.#makeUnavailable( host, connection );

        // host can be deleted and added again, so compare hosts, not uris
        if ( this.#hosts.get( host.uri ) === host ) {

            // a new connection can be created instead of the destroyed one
            this.#changeSignal.broadcast();
        }
    }
}
