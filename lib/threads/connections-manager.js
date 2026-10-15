import { sleep } from "#core/sleep";
import ActivityController from "#core/threads/activity-controller";
import Signal from "#core/threads/signal";

const CONNECTION_URI = Symbol(),
    CONNECT_RETRY_DELAY = 1000;

export class Connection {
    [ CONNECTION_URI ];
    #activityController;

    constructor ( activityController ) {
        this.#activityController = activityController //
            .setOnInit( this._init.bind( this ) )
            .setOnStart( this._start.bind( this ) )
            .setOnStop( this._stop.bind( this ) )
            .setOnDestroy( this._destroy.bind( this ) );
    }

    // properties
    get isStarted () {
        return this.#activityController.state === ActivityController.STATE.STARTED;
    }

    get isIdle () {
        return this.#activityController.isIdle;
    }

    get activeRequestsCount () {
        return this.#activityController.activeRequestsCount;
    }

    // public
    async start () {
        return this.#activityController.start();
    }

    async stop () {
        return this.#activityController.stop();
    }

    async waitConnect ( signal ) {
        return this.#activityController.waitStarted( signal );
    }

    async call () {
        this.#activityController.beginActivity();

        await sleep( 1000 );

        this.#activityController.endActivity();
    }

    // protected
    async _init () {
        return result( 200 );
    }

    async _start () {
        return result( 200 );
    }

    async _stop () {
        return result( 200 );
    }

    async _destroy () {
        return result( 200 );
    }
}

export default class ConnectionsManager {
    #uri;
    #createConnection;
    #maxConnectionsPerHost;
    #idleTimeout;
    #serviceDiscoveryClient;
    #appName;
    #serviceName;
    #hosts = new Set();
    #connections = new Map();
    #idleTimers = new Map();
    #locked = new Set();
    #cursor = 0;
    #changeSignal = new Signal();

    constructor ( { uri, createConnection, maxConnectionsPerHost = 1, idleTimeout, serviceDiscoveryClient, appName, serviceName } = {} ) {
        this.#uri = uri;
        this.#createConnection = createConnection;
        this.#maxConnectionsPerHost = maxConnectionsPerHost;
        this.#idleTimeout = idleTimeout;
        this.#serviceDiscoveryClient = serviceDiscoveryClient;
        this.#appName = appName;
        this.#serviceName = serviceName;
    }

    // public
    async init () {
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

    // resolves with a started connection, or with null if the signal was aborted
    async getConnection ( signal ) {
        while ( !signal?.aborted ) {

            // 1. free slot
            const uri = this.#findFreeHost();

            if ( uri ) {
                const opened = this.#openConnection( uri ),
                    res = await opened.start();

                if ( res.ok && this.#isPooled( opened ) ) return opened;

                // host was deleted while connecting
                if ( !this.#hosts.has( uri ) ) continue;

                if ( !res.ok ) await sleep( CONNECT_RETRY_DELAY );

                continue;
            }

            // 2. idle connection, 3. busy connection (round robin inside each group)
            const connection = this.#selectConnection();

            if ( connection ) return connection;

            // no hosts, or all slots are taken by connections that are not available yet
            await this.#changeSignal.wait( { signal } );
        }

        return null;
    }

    // runs callback with an exclusive connection, the lock is always released afterwards
    async lockConnection ( callback, signal ) {
        const connection = await this.getConnection( signal );

        // aborted while waiting for a connection, callback is not called
        if ( !connection ) return null;

        this.#locked.add( connection );

        try {
            return await callback( connection );
        }
        finally {
            this.#unlockConnection( connection );
        }
    }

    // private
    #unlockConnection ( connection ) {
        if ( !this.#locked.delete( connection ) ) return;

        this.#changeSignal.broadcast();
    }

    #addService ( uri ) {
        if ( this.#hosts.has( uri ) ) return;

        this.#hosts.add( uri );

        this.#changeSignal.broadcast();
    }

    #deleteService ( uri ) {
        if ( !this.#hosts.has( uri ) ) return;

        this.#hosts.delete( uri );

        const connections = this.#connections.get( uri );

        if ( connections ) {
            this.#connections.delete( uri );

            for ( const connection of connections ) {
                this.#locked.delete( connection );

                this.#clearIdleTimer( connection );

                connection.stop();
            }
        }

        this.#changeSignal.broadcast();
    }

    #openConnection ( uri ) {
        const activityController = new ActivityController(),
            connection = this.#createConnection( activityController, uri );

        if ( !( connection instanceof Connection ) ) throw new Error( "Connection must be instance of Connection" );

        connection[ CONNECTION_URI ] = uri;

        activityController
            .on( "started", () => this.#onConnectionStarted( connection ) )
            .on( "stopped", () => this.#onConnectionStopped( connection ) )
            .on( "idle", () => this.#onConnectionIdle( connection ) );

        var connections = this.#connections.get( uri );

        if ( !connections ) {
            connections = new Set();

            this.#connections.set( uri, connections );
        }

        connections.add( connection );

        return connection;
    }

    #removeConnection ( connection ) {
        this.#locked.delete( connection );

        const uri = connection[ CONNECTION_URI ],
            connections = this.#connections.get( uri );

        if ( !connections ) return;

        connections.delete( connection );

        if ( !connections.size ) this.#connections.delete( uri );
    }

    #isPooled ( connection ) {
        return !!this.#connections.get( connection[ CONNECTION_URI ] )?.has( connection );
    }

    // started and not locked connections, idle ones have priority over busy ones
    #selectConnection () {
        const available = [];

        for ( const connections of this.#connections.values() ) {
            for ( const connection of connections ) {
                if ( connection.isStarted && !this.#locked.has( connection ) ) available.push( connection );
            }
        }

        const idle = available.filter( connection => connection.isIdle ),
            candidates = idle.length
                ? idle
                : available;

        if ( !candidates.length ) return null;

        return candidates[ this.#cursor++ % candidates.length ];
    }

    // the host with the fewest connections, if it is below the limit
    #findFreeHost () {
        var freeUri,
            min = this.#maxConnectionsPerHost;

        for ( const uri of this.#hosts ) {
            const count = this.#connections.get( uri )?.size ?? 0;

            if ( count < min ) {
                min = count;
                freeUri = uri;
            }
        }

        return freeUri;
    }

    #armIdleTimer ( connection ) {
        if ( !this.#idleTimeout ) return;

        this.#clearIdleTimer( connection );

        const timer = setTimeout( () => {
            this.#idleTimers.delete( connection );

            // activity has started again, the next idle event will rearm the timer
            if ( !connection.isIdle ) return;

            connection.stop();
        }, this.#idleTimeout );

        timer.unref?.();

        this.#idleTimers.set( connection, timer );
    }

    #clearIdleTimer ( connection ) {
        const timer = this.#idleTimers.get( connection );

        if ( !timer ) return;

        clearTimeout( timer );

        this.#idleTimers.delete( connection );
    }

    #onConnectionStarted ( connection ) {
        this.#armIdleTimer( connection );

        this.#changeSignal.broadcast();
    }

    // also fired when the connection failed to start, the slot is freed in both cases
    #onConnectionStopped ( connection ) {
        this.#clearIdleTimer( connection );

        this.#removeConnection( connection );

        this.#changeSignal.broadcast();
    }

    #onConnectionIdle ( connection ) {
        this.#armIdleTimer( connection );
    }
}
