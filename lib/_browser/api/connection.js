import Queue from "#lib/data-structures/queue";
import fetch from "#lib/fetch";
import { isPlainObject } from "#lib/utils";

const WEBSOCKET_PROTOCOL = "jsonrpc_2.0",
    LOCAL_EVENTS = {
        "connect": "start",
        "disconnect": "stop",
    },
    SYSTEM_EVENTS = new Set( [ "sessionDisable", "sessionDelete", "sessionReload" ] );

export default class ApiClientConnection {
    #api;
    #uri;
    #lifecycleManager;
    #createWebSocket;
    #cache;
    #events;
    #onCall;
    #onAuthorization;
    #ws;
    #wsUrl;
    #httpUrl;
    #requestId = 0;
    #queue = new Queue();
    #callbacks = {};

    constructor ( api, { uri, lifecycleManager, createWebSocket, cache, events, onCall, onAuthorization } = {} ) {
        this.#api = api;
        this.#uri = uri;
        this.#lifecycleManager = lifecycleManager;
        this.#createWebSocket = createWebSocket;
        this.#cache = cache;
        this.#events = events;
        this.#onCall = onCall;
        this.#onAuthorization = onAuthorization;

        this.#lifecycleManager.setOnStart( this.#start.bind( this ) ).setOnStop( this.#stop.bind( this ) );

        this.#api.on( "_uri-update", this.#onUriUpdate.bind( this ) );
    }

    // properties
    get api () {
        return this.#api;
    }

    get uri () {
        return this.#uri;
    }

    get isConnected () {
        return this.#lifecycleManager.isStarted;
    }

    // public
    async connect () {
        return this.#lifecycleManager.start();
    }

    async disconnect () {
        return this.#lifecycleManager.stop();
    }

    async destroy () {
        return this.#lifecycleManager.destroy();
    }

    async call ( method, ...args ) {
        let res, useCache;

        // check cache
        if ( typeof method === "object" && method.cache ) {
            useCache = true;

            res = this.#cache.getCachedResult( method );

            if ( res ) return res;
        }

        res = await this.#call( method, args );

        if ( useCache ) {
            this.#cache.cacheResult( method, res );
        }

        // authorization
        if ( res.status === -32_812 ) {
            if ( this.#onAuthorization && ( await this.#onAuthorization() ) ) {

                // repeat request
                return this.call( method, ...args );
            }
        }

        return res;
    }

    async voidCall ( method, ...args ) {
        this.#call( method, args, {
            "voidCall": true,
        } );
    }

    async upload ( method, ...args ) {
        return this.#call( method, args, {
            "upload": true,
        } );
    }

    async download ( method, ...args ) {
        return this.#call( method, args, {
            "download": true,
        } );
    }

    async publish ( event, ...args ) {
        this.#call( "/publish", [ event, ...args ], {
            "voidCall": true,
        } );
    }

    async lock ( callback, { signal, exclusive } = {} ) {
        try {
            return result.try( await callback( this ), {
                "allowUndefined": true,
            } );
        }
        catch ( e ) {
            return result.fromError( e, {
                "log": false,
            } );
        }
    }

    async waitConnect ( { signal } = {} ) {
        return this.#lifecycleManager.waitStart( { signal } );
    }

    on ( event, callback ) {
        if ( LOCAL_EVENTS[ event ] ) {
            this.#lifecycleManager.on( LOCAL_EVENTS[ event ], callback );
        }
        else {
            this.#events.on( event, callback );
        }

        return this;
    }

    once ( event, callback ) {
        if ( LOCAL_EVENTS[ event ] ) {
            this.#lifecycleManager.once( LOCAL_EVENTS[ event ], callback );
        }
        else {
            this.#events.once( event, callback );
        }

        return this;
    }

    off ( event, callback ) {
        if ( LOCAL_EVENTS[ event ] ) {
            this.#lifecycleManager.off( LOCAL_EVENTS[ event ], callback );
        }
        else {
            this.#events.off( event, callback );
        }

        return this;
    }

    // private
    #getWsUrl () {
        if ( !this.#wsUrl ) {
            this.#wsUrl = new URL( this.#uri, this.#api.url );

            if ( this.#wsUrl.protocol === "http:" ) {
                this.#wsUrl.protocol = "ws:";
            }
            else if ( this.#wsUrl.protocol === "https:" ) {
                this.#wsUrl.protocol = "wss:";
            }

            if ( this.#api.locale ) {
                this.#wsUrl.searchParams.set( "locale", this.#api.locale );
            }
        }

        return this.#wsUrl;
    }

    #getHttpUrl () {
        if ( !this.#httpUrl ) {
            this.#httpUrl = new URL( this.#uri, this.#api.url );

            if ( this.#httpUrl.protocol === "ws:" ) {
                this.#httpUrl.protocol = "http:";
            }
            else if ( this.#httpUrl.protocol === "wss:" ) {
                this.#httpUrl.protocol = "https:";
            }

            if ( this.#api.locale ) {
                this.#httpUrl.searchParams.set( "locale", this.#api.locale );
            }
        }

        return this.#httpUrl;
    }

    // XXX
    async #start () {
        const protocols = [ WEBSOCKET_PROTOCOL ];
        if ( this.#api.token != null ) protocols.push( this.#api.token );

        this.#ws = this.#createWebSocket( this.#getWsUrl(), protocols );

        this.#ws.binaryType = "arraybuffer";

        return new Promise( resolve => {
            this.#ws.onopen = () => {
                this.#ws.onerror = this.#onError.bind( this );
                this.#ws.onclose = this.#onClose.bind( this );
                this.#ws.onmessage = this.#onMessage.bind( this );

                resolve( result( 200 ) );
            };

            this.#ws.onerror = e => {
                this.#ws = null;

                resolve( result.fromError( e, { "log": false } ) );
            };
        } );
    }

    // XXX
    async #stop () {
        if ( !this.#ws ) return result( 200 );

        return new Promise( resolve => {
            this.#ws.onerror = undefined;

            this.#ws.onclose = () => {
                this.#onClose();

                resolve( result( 200 ) );
            };

            this.#ws.close( 1000, "Normal Closure" );
        } );
    }

    #onError ( e ) {
        this.#lifecycleManager.onExternalStop();

        this.#onClose( e );
    }

    // XXX
    #onClose ( e ) {
        this.#ws = null;

        // clear requsests queues
        this.#clearQueuedRequests( e.code, e.reason );
        this.#clearSentRequests( e.code, e.reason );
    }

    // XXX
    async #onMessage ( msg ) {

        // decode message
        try {

            // text message
            if ( typeof msg.data === "string" ) {
                msg = JSON.parse( msg.data );
            }

            // binary message
            else {
                return;
            }
        }
        catch {
            return;
        }

        // request
        if ( msg.method ) {
            if ( !Array.isArray( msg.params ) ) {
                msg.params = msg.params === undefined
                    ? []
                    : [ msg.params ];
            }

            // publish
            if ( msg.method === "/publish" ) {
                const event = msg.params.shift();

                if ( !event ) {
                    return;
                }
                else if ( SYSTEM_EVENTS.has( event ) ) {
                    this.#events.emit( event );
                }
                else {
                    this.#events.emitRemote( "event", event, msg.params );
                }
            }

            // rpc
            else {

                // rpc calls are not supported
                if ( !this.#onCall ) {
                    if ( msg.id ) this.#send( result( -32_800 ).toJsonRpc( msg.id ) );
                }
                else {

                    // void call
                    if ( !msg.id ) {
                        this.#onCall( msg.method, msg.params );
                    }

                    // regular call
                    else {
                        let res;

                        try {
                            res = result.try( await this.#onCall( msg.method, msg.params ) );
                        }
                        catch ( e ) {
                            res = result.fromError( e );
                        }

                        this.#send( res.toJsonRpc( msg.id ) );
                    }
                }
            }
        }

        // response
        else if ( msg.id ) {
            const callback = this.#callbacks[ msg.id ];

            if ( callback ) {
                delete this.#callbacks[ msg.id ];

                const res = result.fromJsonRpc( msg );

                // session is disabled
                if ( res.status === -32_813 ) {
                    this.#events.emit( "sessionDisable" );
                }

                // session was deleted
                else if ( res.status === -32_815 ) {
                    this.#events.emit( "sessionDelete" );
                }

                // access denied
                else if ( res.status === -32_811 ) {
                    this.#events.emit( "accessDenied" );
                }

                callback( res );
            }
        }
    }

    // XXX disard if destroyed
    async #call ( method, args, { voidCall, upload, download } = {} ) {
        var signal, http, fetchOptions;

        if ( typeof method === "object" ) {
            let isVoidCall;

            ( { method, args, signal, http, download, "void": isVoidCall, ...fetchOptions } = method );

            voidCall ??= isVoidCall;
        }

        // aborted
        if ( signal?.aborted ) return result( -32_817 );

        // prepare id
        const id = voidCall
            ? undefined
            : ++this.#requestId;

        // prepare method
        if ( !method.startsWith( "/" ) ) {
            method = `v${ this.#api.version }/${ method }`;
        }

        // prepare args
        if ( !args.length ) {
            args = undefined;
        }
        else if ( args.length === 1 && isPlainObject( args[ 0 ] ) ) {
            args = args[ 0 ];
        }

        const { body, attachments } = this.#api._stringifyRequest( id, method, args );

        if ( http || upload || download || attachments.size || !this.#api.isPersistent ) {
            return this.#callHttp( {
                id,
                method,
                body,
                signal,
                upload,
                download,
                attachments,
                fetchOptions,
            } );
        }
        else {
            return this.#callWebSocket( {
                id,
                body,
                signal,
            } );
        }
    }

    async #callHttp ( { id, method, body, signal, upload, download, attachments, fetchOptions } ) {
        const url = new URL( this.#getHttpUrl() ),
            headers = {};

        // prepare form-data
        if ( attachments.size ) {
            body = this.#api._prepareFormData( body, attachments );

            if ( url.pathname.endsWith( "/" ) ) {
                url.pathname += method.slice( 1 );
            }
            else {
                url.pathname += method;
            }
        }
        else {
            headers[ "content-type" ] = "application/json";
        }

        if ( this.token ) headers.Authorization = "Bearer " + this.token;

        if ( upload ) {
            return this.#api._createUpload( {
                url,
                body,
                "dispatcher": this.#api._getHttpDispatcher(),
                signal,
                fetchOptions,
            } );
        }

        let res;

        REQUEST: while ( true ) {
            try {
                res = await fetch( url, {
                    ...fetchOptions,
                    "method": "POST",
                    "mode": "cors",
                    headers,
                    body,
                    signal,
                    "dispatcher": this.#api._getHttpDispatcher(),
                } );
            }
            catch ( e ) {

                // fetch error
                return result.fromError( e );
            }

            // void call
            if ( !id ) {

                // destroy body
                this.#destroyHttpResponse( res );

                return;
            }

            // aborted
            if ( !res.ok && signal?.aborted ) {
                return result( -32_817 );
            }

            // not an api response
            else if ( res.headers.get( "x-api-response" ) !== "?1" ) {

                // download
                if ( download ) {
                    return result( res.status, res );
                }
                else {

                    // destroy body
                    this.#destroyHttpResponse( res );

                    return result( res.status );
                }
            }

            // api response
            else {
                if ( res.headers.get( "content-type" )?.startsWith( "application/json" ) ) {
                    try {
                        const data = await res.json();

                        res = result.fromJsonRpc( data );
                    }
                    catch {

                        // message decode error
                        return result( -32_807 );
                    }
                }

                // invalid content type
                else {
                    return result( -32_803 );
                }

                // session is disabled
                if ( res.status === -32_813 ) {
                    this.#events.emit( "sessionDisable" );
                }

                // session was deleted
                else if ( res.status === -32_815 ) {
                    this.#events.emit( "sessionDelete" );
                }

                // access denied
                else if ( res.status === -32_811 ) {
                    this.#events.emit( "accessDenied" );
                }

                // authorization
                else if ( res.status === -32_812 && id ) {
                    if ( this.#onAuthorization && ( await this.#onAuthorization() ) ) {

                        // repeat request
                        continue REQUEST;
                    }
                }

                return res;
            }
        }
    }

    async #callWebSocket ( { id, body, signal } ) {
        const msg = {
            id,
            body,
            signal,
            "resolve": null,
        };

        if ( !id ) {
            this.#queue.push( msg );

            this.#sendQueue();
        }
        else {
            return new Promise( resolve => {
                if ( signal ) {
                    const listener = () => {

                        // message was sent
                        if ( this.#callbacks[ id ] ) {
                            delete this.#callbacks[ id ];

                            // send abort call
                            this.#call( "/abort", [ id ], true );
                        }

                        // aborted
                        resolve( result( -32_817 ) );
                    };

                    signal.addEventListener( "abort", listener, { "once": true } );

                    msg.resolve = res => {
                        signal.removeEventListener( "abort", listener );

                        resolve( res );
                    };
                }
                else {
                    msg.resolve = resolve;
                }

                this.#queue.push( msg );

                this.#sendQueue();
            } );
        }
    }

    // XXX .connect() - push callback
    #sendQueue () {

        // not connected, wait for connection
        if ( !this.isConnected ) {
            this.connect();

            return;
        }

        while ( this.#queue.length ) {
            const msg = this.#queue.shift();

            // skip aborted message
            if ( msg.signal?.aborted ) continue;

            if ( msg.resolve ) {
                this.#callbacks[ msg.id ] = msg.resolve;
            }

            this.#send( msg.body );
        }
    }

    #send ( body ) {
        if ( !this.isConnected ) return;

        this.#ws.send( body );
    }

    #destroyHttpResponse ( res ) {
        if ( typeof res.body?.destroy === "function" ) {
            res.body.destroy();
        }
        else if ( typeof res.body?.cancel === "function" ) {
            res.body.cancel();
        }
    }

    #clearQueuedRequests ( status, statusText ) {
        const queue = this.#queue;

        this.#queue = new Queue();

        for ( const msg of queue ) {

            // skip aborted message
            if ( msg.signal?.aborted ) continue;

            if ( msg.resolve ) {
                msg.resolve( result( [ status, statusText ] ) );
            }
        }
    }

    #clearSentRequests ( status, statusText ) {
        const callbacks = this.#callbacks;

        this.#callbacks = {};

        for ( const id in callbacks ) {
            callbacks[ id ]( result( [ status, statusText ] ) );
        }
    }

    // XXX reconnect
    #onUriUpdate () {
        this.#wsUrl = undefined;
        this.#httpUrl = undefined;
    }
}
