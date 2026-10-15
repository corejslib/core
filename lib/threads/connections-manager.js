import { sleep } from "#core/sleep";
import ActivityController from "#core/threads/activity-controller";
import Signal from "#core/threads/signal";

// XXX activity controller - emit "activity", activeRequests;

// XXX add state getters
export class Connection {
    #uri;
    #activityController;

    constructor ( uri, activityController ) {
        this.#uri = uri;

        this.#activityController = activityController //
            .setOnInit( this._init.bind( this ) )
            .setOnStart( this._start.bind( this ) )
            .setOnStop( this._stop.bind( this ) )
            .setOnDestroy( this._destroy.bind( this ) );
    }

    // properties
    get uri () {
        return this.#uri;
    }

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
    #createConnectionCallback;
    #maxConnectionsPerHost;
    #idleTimeout;
    #serviceDiscoveryClient;
    #appName;
    #serviceName;
    #services = new Set();
    #connections = new Set();
    #lockedConnections = new Set();
    #changeSignal = new Signal();

    constructor ( { uri, createConnection, maxConnectionsPerHost = 1, idleTimeout, serviceDiscoveryClient, appName, serviceName } = {} ) {
        this.#uri = uri;
        this.#createConnectionCallback = createConnection;
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

    // XXX select connection to the host with minimal number of active requests
    // XXX select connections wuth minimal number of active requests
    async getConnection ( signal ) {
        while ( !signal?.aborted ) {
            if ( this.#connections.size ) {

                // XXX primitive rotation, should be removed
                const connection = this.#connections.values().next().value;
                this.#connections.delete( connection );
                this.#connections.add( connection );

                return connection;
            }

            await this.#changeSignal.wait( { signal } );
        }
    }

    async lockConnection ( callback, signal ) {
        const connection = await this.getConnection( signal );

        // aborted while waiting for a connection, callback is not called
        if ( !connection ) return null;

        this.#connections.delete( connection );
        this.#lockedConnections.add( connection );

        try {
            return await callback( connection );
        }
        finally {
            this.#unlockConnection( connection );
        }
    }

    // private
    #addService ( uri ) {
        if ( this.#services.has( uri ) ) return;

        this.#services.add( uri );

        for ( let n = 0; n < this.#maxConnectionsPerHost; n++ ) {
            this.#createConnection( uri );
        }

        this.#changeSignal.broadcast();
    }

    #deleteService ( uri ) {
        if ( !this.#services.has( uri ) ) return;

        this.#services.delete( uri );

        for ( const connection of this.#connections ) {
            if ( connection.uri === uri ) {
                this.#connections.delete( connection );

                connection.destroy();
            }
        }

        for ( const connection of this.#lockedConnections ) {
            if ( connection.uri === uri ) {
                this.#lockedConnections.delete( connection );

                connection.destroy();
            }
        }
    }

    #createConnection ( uri ) {
        const activityController = new ActivityController( {
            "idleTimeout": this.#idleTimeout,
        } )
            .on( "destroying", () => this.#onConnectionDestroy( connection ) )
            .on( "activity", activeRequests => this.#onConnectionActivity( connection, activeRequests ) );

        const connection = this.#createConnectionCallback( uri, activityController );

        if ( !( connection instanceof Connection ) ) throw new Error( "Connection must be instance of Connection" );

        this.#connections.add( connection );
    }

    #unlockConnection ( connection ) {
        if ( !this.#lockedConnections.delete( connection ) ) return;

        this.#connections.add( connection );

        this.#changeSignal.broadcast();
    }

    // XXX count active requests by host and by connection
    #onConnectionActivity ( connection, activeRequests ) {}

    #onConnectionDestroy ( connection ) {
        const deletedConnection = this.#connections.delete( connection ) || this.#lockedConnections.delete( connection );

        if ( !deletedConnection ) return;

        if ( this.#services.has( connection.uri ) ) {
            this.#createConnection( connection.uri );
        }
    }
}
