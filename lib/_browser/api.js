import result from "#lib/result";
import Uuid from "#lib/uuid";
import Common from "./api/common.js";
import Upload from "./api/upload.js";

class AptClientUpload extends Upload {
    #size = 0;
    #formData;

    // properties
    constructor ( api, url, method, args, { signal } = {} ) {
        super( api, url, method, signal );

        const files = {},
            data = JSON.stringify(
                {
                    "jsonrpc": "2.0",
                    "id": api._createRequestId(),
                    "method": undefined,
                    "params": args,
                },
                ( key, value ) => {
                    if ( value instanceof Blob ) {
                        const id = "attach:" + Uuid.v4();

                        files[ id ] = value;

                        return id;
                    }
                    else {
                        return value;
                    }
                }
            );

        this.#formData = new FormData();

        const blob = new Blob( [ data ], { "type": "application/json" } );

        this.#formData.append( "params", blob );

        this.#size += blob.size;

        for ( const [ name, body ] of Object.entries( files ) ) {
            this.#formData.append( name, body, body.filename );

            this.#size += body.size;
        }
    }

    get size () {
        return this.#size;
    }

    // protected
    async _start ( url ) {
        const request = new XMLHttpRequest();

        // set expected response type
        request.responseType = "text";

        this._abortController = request;

        request.open( "POST", url );

        if ( this.api.token ) {
            request.setRequestHeader( "Authorization", "Bearer " + this.api.token );
        }

        // progress
        request.upload.addEventListener( "progress", e => {
            this.#size = e.total;

            this._setProgress( e.loaded );
        } );

        // error
        request.addEventListener( "error", e => {
            this._abortController = null;

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

        request.send( this.#formData );

        this.#formData = null;
    }
}

export default class AptClient extends Common {
    constructor ( url, options ) {
        super( url, options );

        this.connect();
    }

    // properties
    get Upload () {
        return AptClientUpload;
    }

    // protected
    _resolveUrl ( url ) {
        const base = new URL( globalThis.location.href );

        base.username = "";
        base.password = "";
        base.search = "";
        base.hash = "";

        url = new URL( url, base );

        if ( !url.pathname.endsWith( "/" ) ) url.pathname += "/";

        if ( !url.searchParams.get( "persistent" ) ) url.searchParams.set( "persistent", "true" );

        return url;
    }

    _createWebSocket ( url, protocols ) {
        return new WebSocket( url, protocols );
    }
}
