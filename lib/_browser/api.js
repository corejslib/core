import "#lib/result";
import Cache from "#lib/_browser/api/cache";
import Connection from "#lib/_browser/api/connection";
import Events from "#lib/_browser/api/events";
import Upload from "#lib/_browser/api/upload";
import Interval from "#lib/interval";
import JsonContainer from "#lib/json-container";
import ConnectionsManager from "#lib/threads/connections-manager";
import LifecycleManager from "#lib/threads/lifecycle-manager";
import Uuid from "#lib/uuid";

const DEFAULT_VERSION = 1,
    DEFAULT_CACHE_MAX_SIZE = 10_000,
    DEFAULT_CACHE_MAX_AGE = 0,
    SERVICE_DISCOVERY_HOSTNAME = "service-discovery";

class ApiClientUpload extends Upload {

    // protected
    async _start ( { url, headers, body, fetchOptions } ) {

        // aborted before start
        if ( this.abortSignal.aborted ) {
            this._setResult( result( -32_817 ) );

            return;
        }

        const request = new XMLHttpRequest();

        // set expected response type
        request.responseType = "text";

        request.open( "POST", url );

        for ( const name in headers ) {
            request.setRequestHeader( name, headers[ name ] );
        }

        // progress
        request.upload.addEventListener( "progress", e => {
            this._setSize( e.total );

            this._setProgress( e.loaded );
        } );

        // abort
        this.abortSignal.addEventListener( "abort", () => request.abort(), { "once": true } );

        request.addEventListener( "abort", () => this._setResult( result( -32_817 ) ) );

        // error
        request.addEventListener( "error", e => {
            this._setResult( result( [ request.status, request.statusText ] ) );
        } );

        // done
        request.addEventListener( "load", e => {
            var res;

            try {
                const contentType = request.getResponseHeader( "content-type" ) ?? "";

                let msg;

                // read response body
                if ( contentType.startsWith( "application/json" ) ) {
                    try {
                        msg = JSON.parse( request.response );
                    }
                    catch {

                        // message decode error
                        throw result( -32_807 );
                    }
                }
                else {

                    // invalid content type
                    throw result( -32_803 );
                }

                res = result.fromJsonRpc( msg );
            }
            catch ( e ) {
                res = result.fromError( e );
            }

            this._setResult( res );
        } );

        request.send( body );
    }
}

export default class ApiClient {
    #protocol;
    #hostname;
    #port;
    #pathname;
    #token;
    #locale;
    #isPersistent;
    #version;
    #checkCertificate;
    #onCall;
    #onAuthorization;
    #clearCacheOn;
    #appName;
    #serviceName;

    #url;
    #lifecycleManager;
    #connectionsManager;
    #events;
    #cache;

    constructor ( uri, { token, locale, persistent, version, checkCertificate, onCall, onAuthorization, cache, cacheMaxSize, cacheMaxAge, clearCacheOn, serviceDiscovery } = {} ) {
        const url = this._createUrl( uri );

        this.#protocol = url.protocol;
        this.#hostname = url.hostname;
        this.#port = url.port;
        this.#pathname = url.pathname;

        // token
        this.#token = ( token ?? decodeURIComponent( url.username ) ) || null;

        // locale
        if ( locale ) {
            this.#locale = locale;
        }
        else {
            this.#locale = url.searchParams.get( "locale" ) || null;
        }

        // persistent
        this.#isPersistent = persistent ?? url.searchParams.get( "persistent" );
        if ( this.#isPersistent == null || this.#isPersistent === "" ) {
            this.#isPersistent = this.#protocol === "ws:" || this.#protocol === "wss:";
        }
        else {
            this.#isPersistent = this.#isPersistent === true || this.#isPersistent === "true";
        }

        // set protocol according to the persistent value
        if ( this.#isPersistent ) {
            if ( this.#protocol === "http:" ) {
                this.#protocol = "ws:";
            }
            else if ( this.#protocol === "https:" ) {
                this.#protocol = "wss:";
            }
        }
        else {
            if ( this.#protocol === "ws:" ) {
                this.#protocol = "http:";
            }
            else if ( this.#protocol === "wss:" ) {
                this.#protocol = "https:";
            }
        }

        // version
        this.#version = version ?? url.searchParams.get( "version" );
        if ( this.#version === false || this.#version === "false" ) {
            this.#version = false;
        }
        else if ( this.#version ) {
            this.#version = Number( this.#version );

            if ( !Number.isInteger( this.#version ) || this.#version < 1 ) {
                throw new TypeError( "API client version value is invalid" );
            }
        }
        else {
            this.#version = DEFAULT_VERSION;
        }

        // check certificate
        this.#checkCertificate = checkCertificate ?? url.searchParams.get( "checkCertificate" );
        if ( this.#checkCertificate === false || this.#checkCertificate === "false" ) {
            this.#checkCertificate = false;
        }
        else {
            this.#checkCertificate = true;
        }

        // onCall
        this.#onCall = onCall;

        // onAuthorization
        this.#onAuthorization = onAuthorization;

        // cache
        cacheMaxSize = Number( cacheMaxSize ?? ( url.searchParams.get( "cacheMaxSize" ) || DEFAULT_CACHE_MAX_SIZE ) );
        if ( !Number.isInteger( cacheMaxSize ) || cacheMaxSize <= 0 ) {
            throw new TypeError( "API client cacheMaxSize value is invalid" );
        }

        cacheMaxAge = ( cacheMaxAge ?? url.searchParams.get( "cacheMaxAge" ) ) || DEFAULT_CACHE_MAX_AGE;

        // setup cache drop events
        const clearCacheOnEvents = new Set();

        for ( const item of [ clearCacheOn ?? url.searchParams.getAll( "clearCacheOn" ) ].flat() ) {
            for ( let event of item.split( "," ) ) {
                event = event.trim();

                if ( !event ) continue;

                clearCacheOnEvents.add( event );
            }
        }

        this.#clearCacheOn = [ ...clearCacheOnEvents ].sort().join( "," );

        // service discovery
        if ( this.#hostname === SERVICE_DISCOVERY_HOSTNAME ) {
            if ( !serviceDiscovery ) throw new Error( "Service discovery client is required" );

            // pathname starts with "/", so the leading slash must be skipped
            [ this.#appName, this.#serviceName ] = this.#pathname.replace( /^\/+/v, "" ).split( "/", 2 );

            if ( !this.#appName || !this.#serviceName ) throw new TypeError( "API client service discovery uri must contain app name and service name" );

            this.#connectionsManager = new ConnectionsManager( {
                "createConnection": this.#createConnection.bind( this ),
                serviceDiscovery,
                "appName": this.#appName,
                "serviceName": this.#serviceName,
            } );
        }
        else {
            this.#connectionsManager = new ConnectionsManager( {
                "createConnection": this.#createConnection.bind( this ),
                "uri": `//${ this.#hostname }${ this.#port
                    ? ":" + this.#port
                    : "" }${ this.#pathname }`,
            } );
        }

        this.#events = new Events( this, this.#connectionsManager );

        this.#cache = new Cache( this, {
            cache,
            "maxSize": cacheMaxSize,
            "maxAge": cacheMaxAge,
        } );

        // events and cache are ready, so it is safe to subscribe now
        for ( const event of clearCacheOnEvents ) {
            this.on( event, () => this.#cache.clear() );
        }

        this.#lifecycleManager = new LifecycleManager( {
            "onStart": this.#start.bind( this ),
            "onStop": this.#stop.bind( this ),
            "onDestroy": this.#stop.bind( this ),
            "onDestroyThreads": this.#destroyConnections.bind( this ),
        } );

        this.#lifecycleManager.start();
    }

    // properties
    get url () {
        if ( !this.#url ) {
            this.#url = this.#buildUrl();
        }

        return this.#url.href;
    }

    get hostname () {
        return this.#hostname;
    }

    get token () {
        return this.#token;
    }

    get locale () {
        return this.#locale;
    }

    get version () {
        return this.#version;
    }

    get checkCertificate () {
        return this.#checkCertificate;
    }

    get isPersistent () {
        return this.#isPersistent;
    }

    get isConnected () {
        return this.#events.isConnected;
    }

    get isDestroyed () {
        return this.#lifecycleManager.isDestroyed;
    }

    // public
    async connect () {
        return this.#lifecycleManager.start();
    }

    async disconnect () {
        return this.#lifecycleManager.stop();
    }

    async forceDisconnect () {
        return this.#lifecycleManager.forceStop();
    }

    async destroy () {
        return this.#lifecycleManager.destroy();
    }

    async forceDestroy () {
        return this.#lifecycleManager.forceDestroy();
    }

    toString () {
        return this.url;
    }

    toJSON () {
        return this.url;
    }

    async call ( method, ...args ) {

        // check cache
        if ( typeof method === "object" && method.cache ) {
            const res = this.#cache.getCachedResult( method );

            if ( res ) return res;
        }

        const connection = await this.#connectionsManager.getConnection();

        if ( !connection ) return this.#unableToGetConnection( method, args );

        return connection.call( method, ...args );
    }

    async voidCall ( method, ...args ) {
        const connection = await this.#connectionsManager.getConnection();

        if ( !connection ) return this.#unableToGetConnection( method, args );

        return connection.voidCall( method, ...args );
    }

    async upload ( method, ...args ) {
        const connection = await this.#connectionsManager.getConnection();

        // upload is always returned, it is rejected on start
        if ( !connection ) {
            if ( typeof method === "object" ) args = method.args ?? args;

            const { attachments } = this._createRequest( undefined, "", args );

            return this._createUpload( {
                attachments,
                "signal": method?.signal,
            } );
        }

        return connection.upload( method, ...args );
    }

    async download ( method, ...args ) {
        const connection = await this.#connectionsManager.getConnection();

        if ( !connection ) return this.#unableToGetConnection( method, args );

        return connection.download( method, ...args );
    }

    async publish ( event, ...args ) {
        const connection = await this.#connectionsManager.getConnection();

        if ( !connection ) return this.#unableToGetConnection( event, args );

        return connection.publish( event, ...args );
    }

    async lockShared ( callback, { signal } = {} ) {
        return this.#connectionsManager.lockConnection(
            async ( connection, { signal } ) => {

                // aborted while waiting for the connection
                if ( !connection ) return result( -32_817 );

                // keeps the connection active while the callback is running
                return connection.lockShared( callback, { signal } );
            },
            {
                signal,
                "exclusive": false,
            }
        );
    }

    async lockExclusive ( callback, { signal } = {} ) {
        return this.#connectionsManager.lockConnection(
            async ( connection, { signal } ) => {

                // aborted while waiting for the connection
                if ( !connection ) return result( -32_817 );

                // keeps the connection active while the callback is running
                return connection.lockExclusive( callback, { signal } );
            },
            {
                signal,
                "exclusive": true,
            }
        );
    }

    async waitConnect ( { signal } = {} ) {
        return this.#events.waitConnect( { signal } );
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

    setToken ( value ) {
        value ||= null;

        if ( this.#token !== value ) {
            this.#token = value;

            this.#onUriUpdate();
        }

        return this;
    }

    setLocale ( value ) {
        value ||= null;

        if ( this.#locale !== value ) {
            this.#locale = value;

            this.#onUriUpdate();
        }

        return this;
    }

    // protected
    _createUrl ( uri ) {
        const base = new URL( globalThis.location.href );

        base.username = "";
        base.password = "";
        base.search = "";
        base.hash = "";

        const url = new URL( uri, base );

        if ( !url.searchParams.get( "persistent" ) ) url.searchParams.set( "persistent", "true" );

        return url;
    }

    _createWebSocket ( url, protocols ) {
        return new WebSocket( url, protocols );
    }

    _checkAttachment ( value ) {
        return value instanceof Blob;
    }

    _createRequest ( id, method, args ) {
        const checkAttachment = this._checkAttachment,
            attachments = new Map(),
            body = JSON.stringify( JsonContainer.prepareJson(
                {
                    "jsonrpc": "2.0",
                    id,
                    method,
                    "params": args,
                },
                ( key, value ) => {
                    if ( value && typeof value === "object" && checkAttachment( value ) ) {
                        const id = "attach:" + Uuid.v4();

                        attachments.set( id, value );

                        return id;
                    }
                    else {
                        return value;
                    }
                }
            ) );

        return {
            body,
            attachments,
        };
    }

    _createFormData ( body, attachments ) {
        let size = 0;

        const formData = new FormData(),
            blob = new Blob( [ body ], { "type": "application/json" } );

        formData.append( "params", blob );

        size += blob.size;

        for ( const [ name, body ] of attachments.entries() ) {
            formData.append( name, body, body.filename );

            size += body.size;
        }

        formData.contentLength = size;

        return formData;
    }

    _createUpload ( { lifecycleManager, attachments, url, headers, body, signal, fetchOptions } ) {
        return new ApiClientUpload( this, { lifecycleManager, attachments, url, headers, body, signal, fetchOptions } );
    }

    _getHttpDispatcher () {}

    _destroyAttachments ( attachments ) {}

    // private
    async #start () {
        const res = await this.#doStart();

        // failed to start some services, rollback (already stopped services are skipped by lifecycle)
        if ( !res.ok ) await this.#doStop();

        return res;
    }

    async #stop () {
        const res = await this.#doStop();

        // failed to stop some services, rollback (already started services are skipped by lifecycle)
        if ( !res.ok ) await this.#doStart();

        return res;
    }

    async #doStart () {
        const results = await Promise.all( [

            //
            this.#connectionsManager.start(),
            this.#events.start(),
        ] );

        return results.find( res => !res.ok ) ?? result( 200 );
    }

    async #doStop () {
        const results = await Promise.all( [

            //
            this.#connectionsManager.stop(),
            this.#events.stop(),
        ] );

        return results.find( res => !res.ok ) ?? result( 200 );
    }

    #unableToGetConnection ( method, args ) {
        if ( typeof method === "object" ) args = method.args ?? args;

        // request is created only to find attachments
        const { attachments } = this._createRequest( undefined, "", args );

        this._destroyAttachments( attachments );

        return result( [ 500, "Unable to get connection" ] );
    }

    async #destroyConnections () {
        this.#connectionsManager.destroyConnections();
    }

    #createConnection ( connectionsManager, uri, lifecycleManager ) {
        return new Connection( this, {
            uri,
            connectionsManager,
            lifecycleManager,
            "onCall": this.#onCall,
            "onAuthorization": this.#onAuthorization,
            "cache": this.#cache,
            "events": this.#events,
        } );
    }

    #buildUrl () {
        const url = new URL( `${ this.#protocol }//${ this.#hostname }` );

        url.port = this.#port;
        url.pathname = this.#pathname;

        if ( this.#token ) url.username = encodeURIComponent( this.#token );

        if ( this.#locale ) url.searchParams.set( "locale", this.#locale );

        if ( this.#version !== DEFAULT_VERSION ) url.searchParams.set( "version", this.#version );

        if ( !this.#checkCertificate ) url.searchParams.set( "checkCertificate", "false" );

        // protocol alone can't be used to restore a non persistent client, see _createUrl()
        if ( !this.#isPersistent ) url.searchParams.set( "persistent", "false" );

        // cache
        if ( this.#cache.maxSize !== DEFAULT_CACHE_MAX_SIZE ) url.searchParams.set( "cacheMaxSize", +this.#cache.maxSize );
        if ( this.#cache.maxAge !== DEFAULT_CACHE_MAX_AGE ) url.searchParams.set( "cacheMaxAge", new Interval( this.#cache.maxAge ) + "" );
        if ( this.#clearCacheOn ) url.searchParams.set( "clearCacheOn", this.#clearCacheOn );

        url.searchParams.sort();

        return url;
    }

    #onUriUpdate () {
        this.#url = undefined;

        this.#events.emit( "_uri-update" );
    }
}
