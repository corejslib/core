import List from "#lib/data-structures/list";
import ActivityController from "#lib/threads/activity-controller";
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
    #idleTimeout;
    #serviceDiscoveryClient;
    #appName;
    #serviceName;
    #hosts = new Map();
    #connections = new Map();
    #hostsLoad = new LeastLoaded();
    #changeSignal = new Signal();

    constructor ( { uri, createConnection, maxConnectionsPerHost = 1, idleTimeout, serviceDiscoveryClient, appName, serviceName } = {} ) {
        this.#uri = uri;
        this.#createConnectionCallback = createConnection;
        this.#maxConnectionsPerHost = maxConnectionsPerHost;
        this.#idleTimeout = idleTimeout;
        this.#serviceDiscoveryClient = serviceDiscoveryClient;
        this.#appName = appName;
        this.#serviceName = serviceName;

        if ( this.#uri ) {
            this.#addService( this.#uri );
        }
        else if ( this.#serviceDiscoveryClient ) {
            this.#serviceDiscoveryClient.on( `add/${ this.#appName }/${ this.#serviceName }`, this.#addService.bind( this ) );

            this.#serviceDiscoveryClient.on( `delete/${ this.#appName }/${ this.#serviceName }`, this.#deleteService.bind( this ) );

            for ( const uri of this.#serviceDiscoveryClient.getServices( this.#appName, this.#serviceName ) ) {
                this.#addService( uri );
            }
        }
    }

    // public
    async getConnection ( signal ) {
        return this.#acquireConnection( signal, false );
    }

    // XXX
    async lockConnection ( callback, { signal, exclusive = true } = {} ) {
        const connection = await this.#acquireConnection( signal, exclusive );

        // XXX return aborted result
        // aborted while waiting for a connection, callback is not called
        if ( !connection ) return null;

        try {
            return await callback( connection );
        }
        finally {
            if ( exclusive ) {
                this.#unlockConnection( connection );
            }
        }
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

        for ( const connection of host.connections ) {

            // connection is no longer tracked, so it can't be selected or unlocked
            this.#connections.delete( connection );

            connection.destroy();
        }

        host.connections.clear();
    }

    #createConnection ( host ) {
        const activityController = new ActivityController( {
            "idleTimeout": this.#idleTimeout,
        } )
            .on( "destroying", () => this.#onConnectionDestroy( connection ) )
            .on( "activity", activeRequestsCount => this.#onConnectionActivity( connection, activeRequestsCount ) );

        const connection = this.#createConnectionCallback( host.uri, activityController );

        this.#connections.set( connection, {
            host,
            "count": 0,
            "locked": false,
        } );

        host.connections.add( connection );

        this.#makeAvailable( host, connection, 0 );
    }

    async #acquireConnection ( signal, lock ) {
        while ( !signal?.aborted ) {
            const host = this.#hostsLoad.pick();

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

        this.#makeUnavailable( state.host, connection );
    }

    #unlockConnection ( connection ) {
        const state = this.#connections.get( connection );

        // connection was destroyed while it was locked
        if ( !state?.locked ) return;

        state.locked = false;

        this.#makeAvailable( state.host, connection, state.count );

        this.#changeSignal.broadcast();
    }

    #makeAvailable ( host, connection, activeRequestsCount ) {
        host.available.add( connection, activeRequestsCount );

        // does nothing if the host is already there
        this.#hostsLoad.add( host, host.count );
    }

    #makeUnavailable ( host, connection ) {
        host.available.delete( connection );

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
