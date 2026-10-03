import path from "node:path";
import Events from "#lib/events";

export default class ServiceDiscoveryClient {
    #api;
    #appName;
    #events = new Events();
    #localServices = {};
    #localVersion = 0;
    #synchedLocalVersion = 0;
    #localSyncStarted = false;
    #remoteVersion = -1;
    #remoteSyncStarted = false;
    #remoteServices = {};

    constructor ( api, { appName } = {} ) {
        this.#api = api;
        this.#appName = appName;

        this.#api.on( "connect", this.#onConnect.bind( this ) );
        this.#api.on( "disconnect", this.#onDisconnect.bind( this ) );
        this.#api.on( "service-discovery/update", this.#mergeRemoteServices.bind( this ) );

        this.#onConnect();
    }

    // properties
    get appName () {
        return this.#appName();
    }

    // public
    addService ( serviceName, port, pathname = "/" ) {
        const id = port.toString() + path.join( "/", pathname );

        if ( !this.#localServices[ id ] ) {
            this.#localServices[ id ] = {
                serviceName,
                port,
                pathname,
            };

            this.#localVersion++;

            this.#syncLocal();
        }
    }

    deleteService ( port, pathname = "/" ) {
        const id = port.toString() + path.join( "/", pathname );

        if ( this.#localServices[ id ] ) {
            delete this.#localServices[ id ];

            this.#localVersion++;

            this.#syncLocal();
        }
    }

    getServices ( appName, serviceName ) {
        const urls = [];

        for ( const service of Object.values( this.#remoteServices ) ) {
            if ( service.appName === appName && service.serviceName === serviceName ) {
                urls.push( service.url );
            }
        }

        return urls;
    }

    on ( event, callback ) {
        this.#events.on( event, callback );

        return this;
    }

    once ( event, callback ) {
        this.#events.once( event, callback );

        return this;
    }

    off ( event, callback ) {
        this.#events.off( event, callback );

        return this;
    }

    // private
    #onConnect () {
        this.#syncLocal();
        this.#syncRemote();
    }

    #onDisconnect () {
        this.#remoteVersion = -1;
    }

    async #syncLocal () {
        if ( this.#localSyncStarted ) return;

        this.#localSyncStarted = true;

        while ( true ) {
            if ( !this.#api?.isConnected ) break;

            if ( this.#localVersion === this.#synchedLocalVersion ) break;

            if ( !this.#appName ) break;

            const version = this.#localVersion;

            const res = await this.#api.call( "service-discovery/set-host-services", {
                version,
                "appName": this.#appName,
                "services": Object.values( this.#localServices ),
            } );

            if ( res.ok ) {
                this.#synchedLocalVersion = version;
            }
        }

        this.#localSyncStarted = false;
    }

    async #syncRemote () {
        if ( this.#remoteSyncStarted ) return;

        this.#remoteSyncStarted = true;

        while ( true ) {
            if ( !this.#api?.isConnected ) break;

            const res = await this.#api.call( "service-discovery/get-services" );

            if ( res.ok ) {
                this.#mergeRemoteServices( res.data );

                break;
            }
        }

        this.#remoteSyncStarted = false;
    }

    #mergeRemoteServices ( { version, services } = {} ) {
        if ( version <= this.#remoteVersion ) return;

        this.#remoteVersion = version;

        const added = [],
            deleted = [];

        services = Object.fromEntries( services.map( service => [ `${ service.appName }/${ service.serviceName }/${ service.url }`, service ] ) );

        for ( const id in services ) {

            // added
            if ( !this.#remoteServices[ id ] ) {
                added.push( services[ id ] );

                this.#remoteServices[ id ] = services[ id ];
            }
        }

        for ( const id in this.#remoteServices ) {

            // removed
            if ( !services[ id ] ) {
                deleted.push( this.#remoteServices[ id ] );

                delete this.#remoteServices[ id ];
            }
        }

        for ( const service of added ) {
            this.#events.emit( `add/${ service.appName }/${ service.serviceName }`, service.url );
        }

        for ( const service of deleted ) {
            this.#events.emit( `delete/${ service.appName }/${ service.serviceName }`, service.url );
        }
    }
}
