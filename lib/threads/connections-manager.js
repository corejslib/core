import List from "#lib/data-structures/list";
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
        var bucket = this.#buckets.get( count );

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
    #reservedConnections;
    #idleTimeout;
    #serviceDiscovery;
    #appName;
    #serviceName;
    #hosts = new Map();
    #connections = new Map();
    #hostsLoad = new LeastLoaded();
    #changeSignal = new Signal();

    // total number of unlocked connections, available for selection across all hosts
    #availableCount = 0;

    constructor ( { uri, createConnection, maxConnectionsPerHost = 1, reservedConnections, idleTimeout, serviceDiscovery, appName, serviceName } = {} ) {
        this.#uri = uri;
        this.#createConnectionCallback = createConnection;
        this.#maxConnectionsPerHost = maxConnectionsPerHost;
        this.#reservedConnections = reservedConnections ?? 0;
        this.#idleTimeout = idleTimeout;
        this.#serviceDiscovery = serviceDiscovery;
        this.#appName = appName;
        this.#serviceName = serviceName;
    }

    // properties
    get maxConnectionsPerHost () {
        return this.#maxConnectionsPerHost;
    }

    get reservedConnections () {
        return this.#reservedConnections;
    }

    get idleTimeout () {
        return this.#idleTimeout;
    }

    get hasHosts () {
        return this.#hosts.size > 0;
    }

    // public
    async start () {
        if ( this.#uri ) {
            this.#addService( this.#uri );
        }
        else if ( this.#serviceDiscovery ) {
            this.#serviceDiscovery.on( `add/${ this.#appName }/${ this.#serviceName }`, this.#addService.bind( this ) );

            this.#serviceDiscovery.on( `delete/${ this.#appName }/${ this.#serviceName }`, this.#deleteService.bind( this ) );

            const services = await this.#serviceDiscovery.getServices( this.#appName, this.#serviceName );

            for ( const uri of services ) {
                this.#addService( uri );
            }
        }
    }

    async getConnection ( signal ) {
        return this.#acquireConnection( signal, false );
    }

    async lockConnection ( callback, { signal, exclusive } = {} ) {
        const connection = await this.#acquireConnection( signal, exclusive );

        try {
            return await callback( connection );
        }
        finally {
            if ( exclusive ) {
                this.#unlockConnection( connection );
            }
        }
    }

    async createConnection ( signal ) {
        const host = await this.#acquireHost( signal );

        if ( !host ) return;

        // connection is not registered in the pool, so the caller owns its lifecycle
        const lifecycleManager = new LifecycleManager();

        return this.#createConnectionCallback( host.uri, lifecycleManager );
    }

    // private
    #addService ( uri ) {
        if ( this.#hosts.has( uri ) ) return;

        const host = {
            uri,
            "count": 0,
            "connections": new Set(),
            "available": new LeastLoaded(),
        };

        this.#hosts.set( uri, host );

        for ( let n = 0; n < this.#maxConnectionsPerHost; n++ ) {
            this.#createConnection( host );
        }

        this.#changeSignal.broadcast();
    }

    #deleteService ( uri ) {
        const host = this.#hosts.get( uri );

        if ( !host ) return;

        this.#hosts.delete( uri );
        this.#hostsLoad.delete( host );

        // all available connections of the host are gone with it
        this.#availableCount -= host.available.size;

        for ( const connection of host.connections ) {
            const state = this.#connections.get( connection );

            // connection is no longer tracked, so it can't be selected or unlocked
            this.#connections.delete( connection );

            state.lifecycleManager.destroy();
        }

        host.connections.clear();
    }

    #createConnection ( host ) {
        const lifecycleManager = new LifecycleManager( {
            "idleTimeout": this.#idleTimeout,
        } )
            .on( "destroying", () => this.#onConnectionDestroy( connection ) )
            .on( "activity", activeRequestsCount => this.#onConnectionActivity( connection, activeRequestsCount ) );

        const connection = this.#createConnectionCallback( host.uri, lifecycleManager );

        this.#connections.set( connection, {
            host,
            lifecycleManager,
            "count": 0,
            "locked": false,

            // idle timeout of the connection, saved while it is locked
            "idleTimeout": undefined,
        } );

        host.connections.add( connection );

        this.#makeAvailable( host, connection, 0 );
    }

    async #acquireHost ( signal ) {
        while ( !signal?.aborted ) {
            const host = this.#pickHost();

            if ( host ) return host;

            // no hosts yet, wait for service discovery
            await this.#changeSignal.wait( { signal } );
        }
    }

    #pickHost () {
        var result;

        // hosts without available connections are not in #hostsLoad, so scan all hosts
        for ( const host of this.#hosts.values() ) {
            if ( !result || host.count < result.count ) result = host;
        }

        return result;
    }

    async #acquireConnection ( signal, lock ) {

        // exclusive lock must leave at least reservedConnections available connections
        const reserved = lock
            ? this.#reservedConnections
            : 0;

        while ( !signal?.aborted ) {
            const host = this.#availableCount > reserved
                ? this.#hostsLoad.pick()
                : undefined;

            if ( host ) {
                const connection = host.available.pick();

                // must be locked synchronously, so nobody else can take the same connection
                if ( lock ) this.#lockConnection( connection );

                return connection;
            }

            await this.#changeSignal.wait( { signal } );
        }
    }

    #lockConnection ( connection ) {
        const state = this.#connections.get( connection );

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

        // restore only if the timeout was not changed while the connection was locked
        if ( state.lifecycleManager.idleTimeout == null ) state.lifecycleManager.setIdleTimeout( state.idleTimeout );

        state.idleTimeout = undefined;

        this.#makeAvailable( state.host, connection, state.count );

        this.#changeSignal.broadcast();
    }

    #makeAvailable ( host, connection, activeRequestsCount ) {
        const size = host.available.size;

        host.available.add( connection, activeRequestsCount );

        this.#availableCount += host.available.size - size;

        // does nothing if the host is already there
        this.#hostsLoad.add( host, host.count );
    }

    #makeUnavailable ( host, connection ) {
        const size = host.available.size;

        host.available.delete( connection );

        this.#availableCount -= size - host.available.size;

        if ( !host.available.size ) this.#hostsLoad.delete( host );
    }

    #onConnectionActivity ( connection, activeRequestsCount ) {
        const state = this.#connections.get( connection );

        if ( !state ) return;

        const host = state.host,
            delta = activeRequestsCount - state.count;

        if ( !delta ) return;

        state.count = activeRequestsCount;
        host.count += delta;

        // update() ignores locked connections and hosts without available connections
        host.available.update( connection, activeRequestsCount );
        this.#hostsLoad.update( host, host.count );
    }

    #onConnectionDestroy ( connection ) {
        const state = this.#connections.get( connection );

        if ( !state ) return;

        const host = state.host;

        this.#connections.delete( connection );
        host.connections.delete( connection );
        host.count -= state.count;

        this.#makeUnavailable( host, connection );

        // keep the host load actual
        this.#hostsLoad.update( host, host.count );

        // host can be deleted and added again, so compare hosts, not uris
        if ( this.#hosts.get( host.uri ) === host ) {
            this.#createConnection( host );

            this.#changeSignal.broadcast();
        }
    }
}
