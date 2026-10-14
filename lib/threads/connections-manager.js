import { sleep } from "#core/sleep";
import ActivityController from "#core/threads/activity-controller";
import Signal from "#core/threads/signal";

const CONNECTION_ID = Symbol(),
    CONNECT_RETRY_DELAY = 1000;

export class Connection {
    [ CONNECTION_ID ];
    #activityController;

    constructor ( activityController ) {
        this.#activityController = activityController;

        this.#activityController.setOnStart( this.#start.bind( this ) ).setOnStop( this.#stop.bind( this ) );
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

    // private
    async #start () {
        return result( 200 );
    }

    async #stop () {
        return result( 200 );
    }
}

export default class ConnectionsManager {
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

    constructor ( { maxConnectionsPerHost = 1, idleTimeout, serviceDiscoveryClient, appName, serviceName } = {} ) {
        this.#maxConnectionsPerHost = maxConnectionsPerHost;
        this.#idleTimeout = idleTimeout;
        this.#serviceDiscoveryClient = serviceDiscoveryClient;
        this.#appName = appName;
        this.#serviceName = serviceName;
    }

    // public
    async init () {
        if ( this.#serviceDiscoveryClient ) {
            this.#serviceDiscoveryClient.on( `add/${ this.#appName }/${ this.#serviceName }`, this.#addService.bind( this ) );

            this.#serviceDiscoveryClient.on( `delete/${ this.#appName }/${ this.#serviceName }`, this.#deleteService.bind( this ) );

            const urls = this.#serviceDiscoveryClient.getServices( this.#appName, this.#serviceName );

            for ( const url of urls ) {
                this.#addService( url );
            }
        }
    }

    // resolves with a started connection, or with null if the signal was aborted
    async getConnection ( signal ) {
        while ( !signal?.aborted ) {

            // 1. free slot
            const url = this.#findFreeHost();

            if ( url ) {
                const opened = this.#openConnection( url ),
                    res = await opened.start();

                if ( res.ok && this.#isPooled( opened ) ) return opened;

                // host was deleted while connecting
                if ( !this.#hosts.has( url ) ) continue;

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

    #addService ( url ) {
        if ( this.#hosts.has( url ) ) return;

        this.#hosts.add( url );

        this.#changeSignal.broadcast();
    }

    #deleteService ( url ) {
        if ( !this.#hosts.has( url ) ) return;

        this.#hosts.delete( url );

        const connections = this.#connections.get( url );

        if ( connections ) {
            this.#connections.delete( url );

            for ( const connection of connections ) {
                this.#locked.delete( connection );

                this.#clearIdleTimer( connection );

                connection.stop();
            }
        }

        this.#changeSignal.broadcast();
    }

    #openConnection ( url ) {
        const activityController = new ActivityController(),
            connection = new Connection( activityController );

        connection[ CONNECTION_ID ] = url;

        activityController
            .on( "started", () => this.#onConnectionStarted( connection ) )
            .on( "stopped", () => this.#onConnectionStopped( connection ) )
            .on( "idle", () => this.#onConnectionIdle( connection ) );

        var connections = this.#connections.get( url );

        if ( !connections ) {
            connections = new Set();

            this.#connections.set( url, connections );
        }

        connections.add( connection );

        return connection;
    }

    #removeConnection ( connection ) {
        this.#locked.delete( connection );

        const url = connection[ CONNECTION_ID ],
            connections = this.#connections.get( url );

        if ( !connections ) return;

        connections.delete( connection );

        if ( !connections.size ) this.#connections.delete( url );
    }

    #isPooled ( connection ) {
        return !!this.#connections.get( connection[ CONNECTION_ID ] )?.has( connection );
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
        var freeUrl,
            min = this.#maxConnectionsPerHost;

        for ( const url of this.#hosts ) {
            const count = this.#connections.get( url )?.size ?? 0;

            if ( count < min ) {
                min = count;
                freeUrl = url;
            }
        }

        return freeUrl;
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
