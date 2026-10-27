import Queue from "#lib/data-structures/queue";
import fetch from "#lib/fetch";
import { isPlainObject } from "#lib/utils";

const WEBSOCKET_PROTOCOL = "jsonrpc_2.0",
    LIFECYCLE_EVENTS = {
        "connect": "start",
        "disconnect": "stop",
        "destroy": "destroy",
    };

export default class ApiClientConnection {
    #api;
    #uri;
    #connectionsManager;
    #lifecycleManager;
    #cache;
    #events;
    #onCall;
    #onAuthorization;
    #webSocket;
    #webSocketUrl;
    #httpUrl;
    #requestId = 0;
    #queue = new Queue();
    #callbacks = {};

    constructor ( api, { uri, connectionsManager, lifecycleManager, cache, events, onCall, onAuthorization } = {} ) {
        this.#api = api;
        this.#uri = uri;
        this.#connectionsManager = connectionsManager;
        this.#lifecycleManager = lifecycleManager;
        this.#cache = cache;
        this.#events = events;
        this.#onCall = onCall;
        this.#onAuthorization = onAuthorization;

        this.#lifecycleManager //
            .setOnStart( this.#start.bind( this ) )
            .setOnStop( this.#stop.bind( this ) )
            .setOnDestroyThreads( () => this.#dropQueue( result( [ 1006, "Connection destroyed" ] ) ) )
            .setOnIdle( () => this.#lifecycleManager.destroy() );

        const onUriUpdate = this.#onUriUpdate.bind( this );

        this.#events.on( "_uri-update", onUriUpdate );

        // events object is shared between all connections, so destroyed connection must be unsubscribed
        this.#lifecycleManager.once( "destroy", () => this.#events.off( "_uri-update", onUriUpdate ) );

        this.#lifecycleManager.start();
    }

    // properties
    get api () {
        return this.#api;
    }

    get uri () {
        return this.#uri;
    }

    get isExclusive () {
        return this.#connectionsManager.isConnectionExclusive( this );
    }

    get isConnected () {
        return this.#lifecycleManager.isStarted;
    }

    get isDestroyed () {
        return this.#lifecycleManager.isDestroyed;
    }

    // public
    async destroy () {
        return this.#lifecycleManager.destroy();
    }

    async forceDestroy () {
        return this.#lifecycleManager.forceDestroy();
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

        // authorization
        if ( res.status === -32_812 ) {
            if ( this.#onAuthorization && ( await this.#onAuthorization() ) ) {

                // repeat request, the result will be cached by the repeated call
                return this.call( method, ...args );
            }
        }

        if ( useCache ) {
            this.#cache.cacheResult( method, res );
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
        return this.#call( "/publish", [ event, ...args ] );
    }

    async lockShared ( callback, { signal } = {} ) {
        return this.#lifecycleManager.runThread( callback, { signal } );
    }

    async lockExclusive ( callback, { signal } = {} ) {
        if ( !this.isExclusive ) return result( [ 500, "Unable to exclusively lock connection" ] );

        return this.lockShared( callback, {
            signal,
        } );
    }

    async waitConnect ( { signal } = {} ) {
        return this.#lifecycleManager.waitStart( { signal } );
    }

    async waitDisconnect ( { signal } = {} ) {
        return this.#lifecycleManager.waitStop( { signal } );
    }

    on ( event, callback ) {
        if ( LIFECYCLE_EVENTS[ event ] ) {
            this.#lifecycleManager.on( LIFECYCLE_EVENTS[ event ], callback );
        }
        else {
            this.#events.on( event, callback );
        }

        return this;
    }

    once ( event, callback ) {
        if ( LIFECYCLE_EVENTS[ event ] ) {
            this.#lifecycleManager.once( LIFECYCLE_EVENTS[ event ], callback );
        }
        else {
            this.#events.once( event, callback );
        }

        return this;
    }

    off ( event, callback ) {
        if ( LIFECYCLE_EVENTS[ event ] ) {
            this.#lifecycleManager.off( LIFECYCLE_EVENTS[ event ], callback );
        }
        else {
            this.#events.off( event, callback );
        }

        return this;
    }

    // private
    async #start () {

        // http connection has nothing to connect
        if ( !this.#api.isPersistent ) return result( 200 );

        try {
            const protocols = [ WEBSOCKET_PROTOCOL ];
            if ( this.#api.token != null ) protocols.push( this.#api.token );

            this.#webSocket = this.#api._createWebSocket( this.#getWebSocketUrl(), protocols );

            this.#webSocket.binaryType = "arraybuffer";
        }
        catch ( e ) {

            // socket was not created or configured, "onclose" will not be called, so cleanup here
            this.#webSocket = null;

            // not awaited, because destroy() waits for this start to finish
            this.#lifecycleManager.destroy();

            return result.fromError( e, {
                "log": false,
            } );
        }

        const res = await new Promise( resolve => {
            this.#webSocket.onopen = e => resolve( result( 200 ) );

            this.#webSocket.onclose = e => resolve( result( e.code ) );
        } );

        if ( res.ok ) {
            this.#webSocket.onclose = e => {
                this.#onDisconnect( e.code );

                this.#lifecycleManager.destroy();
            };

            this.#webSocket.onmessage = this.#onMessage.bind( this );

            setTimeout( () => this.#sendQueue(), 1 );
        }
        else {
            this.#onDisconnect( res.status );

            // not awaited, because destroy() waits for this start to finish
            this.#lifecycleManager.destroy();
        }

        return res;
    }

    async #stop () {
        if ( !this.#webSocket ) return result( 200 );

        return new Promise( resolve => {
            this.#webSocket.onclose = e => {
                this.#onDisconnect( e.code );

                resolve( result( 200 ) );
            };

            this.#webSocket.close( 1000, "Normal Closure" );
        } );
    }

    #getWebSocketUrl () {
        if ( !this.#webSocketUrl ) {
            this.#webSocketUrl = new URL( this.#uri, this.#api.url );

            if ( this.#webSocketUrl.protocol === "http:" ) {
                this.#webSocketUrl.protocol = "ws:";
            }
            else if ( this.#webSocketUrl.protocol === "https:" ) {
                this.#webSocketUrl.protocol = "wss:";
            }

            if ( this.#api.locale ) {
                this.#webSocketUrl.searchParams.set( "locale", this.#api.locale );
            }
        }

        return this.#webSocketUrl;
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

    #onDisconnect ( status ) {
        this.#webSocket.onopen = undefined;
        this.#webSocket.onclose = undefined;
        this.#webSocket.onmessage = undefined;
        this.#webSocket = null;

        const res = result( status );

        this.#dropQueue( res );
    }

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
                else {
                    this.#events.emitRemote( event, msg.params );
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
                        await this.#lifecycleManager.runThread( async () => {
                            try {
                                await this.#onCall( msg.method, msg.params );
                            }
                            catch ( e ) {
                                result.fromError( e );
                            }
                        } );
                    }

                    // regular call
                    else {
                        this.#lifecycleManager.beginRequest();

                        try {
                            let res;

                            try {
                                res = result.try( await this.#onCall( msg.method, msg.params ) );
                            }
                            catch ( e ) {
                                res = result.fromError( e );
                            }

                            this.#send( res.toJsonRpc( msg.id ) );
                        }
                        finally {
                            this.#lifecycleManager.endRequest();
                        }
                    }
                }
            }
        }

        // response
        else if ( msg.id ) {
            const callback = this.#callbacks[ msg.id ];

            if ( callback ) {
                delete this.#callbacks[ msg.id ];

                this.#lifecycleManager.endRequest();

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

    async #call ( method, args, { voidCall, upload, download } = {} ) {
        var signal, http, fetchOptions;

        if ( typeof method === "object" ) {
            let isVoidCall, isDownload, methodArgs;

            ( { method, "args": methodArgs, signal, http, "download": isDownload, "void": isVoidCall, fetchOptions } = method );

            args = methodArgs ?? args;
            voidCall ??= isVoidCall;
            download ??= isDownload;
        }

        // prepare id
        const id = voidCall
            ? undefined
            : ++this.#requestId;

        // prepare method
        if ( this.#api.version && !method.startsWith( "/" ) ) {
            method = `/v${ this.#api.version }/${ method }`;
        }

        // prepare args
        if ( !args.length ) {
            args = undefined;
        }
        else if ( args.length === 1 && isPlainObject( args[ 0 ] ) ) {
            args = args[ 0 ];
        }

        const { body, attachments } = this.#api._createRequest( id, method, args );

        if ( !upload ) {
            let res;

            // aborted
            if ( signal?.aborted ) {
                res = result( -32_817 );
            }

            // connection can't accept requests
            else if ( !this.#lifecycleManager.canBeginActivity ) {
                res = result( [ 500, "Destroyed" ] );
            }

            if ( res ) {
                this.#api._destroyAttachments( attachments );

                return res;
            }
        }

        if ( http || upload || download || attachments.size || !this.#api.isPersistent ) {
            this.#lifecycleManager.beginRequest();

            try {
                return await this.#callHttp( {
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
            finally {
                this.#lifecycleManager.endRequest();
            }
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
            headers = {
                "accept": "application/json, */*",
            };

        // prepare form-data
        if ( attachments.size ) {
            body = this.#api._createFormData( body, attachments );
        }
        else {
            headers[ "content-type" ] = "application/json";
        }

        this.#setAuthorizationHeader( headers );

        if ( upload ) {
            return this.#api._createUpload( {
                "lifecycleManager": this.#lifecycleManager,
                attachments,
                url,
                headers,
                body,
                signal,
                fetchOptions,
            } );
        }

        let res;

        REQUEST: while ( true ) {

            // token could be changed by the authorization callback
            this.#setAuthorizationHeader( headers );

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

                // aborted
                if ( signal?.aborted ) return result( -32_817 );

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

            // json-rpc response
            else if ( res.headers.get( "content-type" )?.startsWith( "application/json" ) && ( res.headers.get( "x-jsonrpc-response" ) === "?1" || !download ) ) {
                const xJsonrpcResponse = res.headers.get( "x-jsonrpc-response" ) === "?1";

                try {
                    const data = await res.json();

                    res = result.fromJsonRpc( data );
                }
                catch {

                    // invalid json data
                    return result( -32_807 );
                }

                if ( xJsonrpcResponse ) {

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
                }

                return res;
            }

            // download
            else if ( download ) {
                return result( res.status, res );
            }

            // invalid content type
            else {

                // destroy body
                this.#destroyHttpResponse( res );

                return result( -32_803 );
            }
        }
    }

    #setAuthorizationHeader ( headers ) {
        if ( this.#api.token ) {
            headers[ "authorization" ] = "Bearer " + this.#api.token;
        }
        else {
            delete headers[ "authorization" ];
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
            this.#pushRequest( msg );

            this.#sendQueue();
        }
        else {
            return new Promise( resolve => {
                if ( signal ) {
                    const listener = () => {

                        // message was sent
                        if ( this.#callbacks[ id ] ) {
                            delete this.#callbacks[ id ];

                            this.#lifecycleManager.endRequest();

                            // send abort call
                            this.#call( "/abort", [ id ], {
                                "voidCall": true,
                            } );
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

                this.#pushRequest( msg );

                this.#sendQueue();
            } );
        }
    }

    #pushRequest ( message ) {
        this.#queue.push( message );

        this.#lifecycleManager.beginRequest();
    }

    #sendQueue () {

        // not connected
        if ( !this.#lifecycleManager.isStarted ) {

            // can not start connection
            if ( !this.#lifecycleManager.canBeginActivity ) {
                this.#rejectQueue( result( [ 500, "Destroyed" ] ) );
            }

            return;
        }

        while ( this.#queue.length ) {
            const msg = this.#queue.shift();

            // skip aborted message
            if ( msg.signal?.aborted ) {
                this.#lifecycleManager.endRequest();

                continue;
            }

            if ( msg.resolve ) {
                this.#callbacks[ msg.id ] = msg.resolve;
            }

            this.#send( msg.body );

            // void message, no response is expected
            if ( !msg.resolve ) {
                this.#lifecycleManager.endRequest();
            }
        }
    }

    #rejectQueue ( res ) {
        const queue = this.#queue;

        this.#queue = new Queue();

        for ( const msg of queue ) {
            this.#lifecycleManager.endRequest();

            // skip aborted message
            if ( msg.signal?.aborted ) continue;

            msg.resolve?.( res );
        }
    }

    #send ( body ) {

        // checks the socket, not the public state, so replies are still sent while the manager is stopping
        if ( !this.#webSocket ) return;

        this.#webSocket.send( body );
    }

    #destroyHttpResponse ( res ) {
        if ( typeof res.body?.destroy === "function" ) {
            res.body.destroy();
        }
        else if ( typeof res.body?.cancel === "function" ) {
            res.body.cancel();
        }
    }

    #dropQueue ( res ) {
        const queue = this.#queue;

        this.#queue = new Queue();

        for ( const msg of queue ) {
            this.#lifecycleManager.endRequest();

            // skip aborted message
            if ( msg.signal?.aborted ) continue;

            if ( msg.resolve ) {
                msg.resolve( result( [ res.status, res.statusText ] ) );
            }
        }

        const callbacks = this.#callbacks;

        this.#callbacks = {};

        for ( const id in callbacks ) {
            this.#lifecycleManager.endRequest();

            callbacks[ id ]( result( [ res.status, res.statusText ] ) );
        }
    }

    #onUriUpdate () {
        this.#webSocketUrl = undefined;
        this.#httpUrl = undefined;

        this.#lifecycleManager.forceDestroy();
    }
}
