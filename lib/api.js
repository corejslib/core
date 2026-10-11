import { isIP } from "node:net";
import { WebSocket } from "undici";
import Common from "#browser/api/common";
import Upload from "#browser/api/upload";
import DnsWatcher from "#lib/dns/watcher";
import fetch from "#lib/fetch";
import FormData from "#lib/form-data";
import Message from "#lib/message";
import Uuid from "#lib/uuid";

class WebSocketDispatcher extends fetch.Dispatcher {
    #hostname;

    constructor ( { api, hostname, ...options } ) {
        super( {
            ...options,
            "checkCertificate": api.checkCertificate,

            // NOTE: nginx does not support websocket over HTTP/2
            "allowH2": false,
        } );

        this.#hostname = hostname;
    }

    // protected
    _processHeaders ( headers ) {
        if ( this.#hostname ) {
            headers.set( "host", this.#hostname );
        }
    }
}

class ApiClientUpload extends Upload {
    #size;
    #formData;
    #dispatcher;
    #fetchOptions;

    constructor ( api, url, method, args, { signal, ...fetchOptions } = {} ) {
        super( api, url, method, signal );

        this.#fetchOptions = fetchOptions;

        const files = {},
            data = JSON.stringify(
                {
                    "jsonrpc": "2.0",
                    "id": api.createRequestId(),
                    "method": undefined,
                    "params": args,
                },
                ( key, value ) => {
                    if ( value && typeof value === "object" && Message.isValidBody( value ) ) {
                        const id = "attachment:" + Uuid.v4();

                        files[ id ] = value;

                        return id;
                    }
                    else {
                        return value;
                    }
                }
            );

        this.#formData = new FormData();

        this.#formData.write( new Message( {
            "headers": {
                "content-type": "application/json",
                "content-disposition": {
                    "name": "params",
                },
            },
            "body": data,
        } ) );

        for ( const [ name, body ] of Object.entries( files ) ) {
            this.#formData.write( new Message( {
                "headers": {
                    "content-disposition": {
                        "type": "form-data",
                        name,
                    },
                },
                body,
            } ) );
        }

        this.#size = this.#formData.size;
    }

    // properties
    get size () {
        return this.#size;
    }

    // protected
    async _start ( url ) {
        this._setProgress( this.#size / 2 );

        const formData = this.#formData;
        this.#formData = null;

        const headers = {
            "host": this.api.hostname,
        };

        if ( this.api.token ) {
            headers.authorization = "Bearer " + this.api.token;
        }

        var res;

        try {
            this.#dispatcher ??= new fetch.Dispatcher( {
                "checkCertificate": this.api.checkCertificate,
            } );

            res = await fetch( url, {
                ...this.#fetchOptions,
                "method": "POST",
                headers,
                "body": formData,
                "signal": this.abortSignal,
                "dispatcher": this.#dispatcher,
            } );

            const contentType = res.headers.get( "content-type" ) ?? "";

            let msg;

            // read response body
            if ( contentType.startsWith( "application/json" ) ) {
                try {
                    msg = await res.json();
                }
                catch {

                    // message decode error
                    throw result( -32_807 );
                }
            }
            else {

                // request error
                if ( !res.ok ) {
                    throw res;
                }

                // invalid content type
                else {
                    throw result( -32_803 );
                }
            }

            // set progress to 100%
            this._setProgress( this.#size );

            res = result.fromJsonRpc( msg );
        }
        catch ( e ) {
            res = result.fromError( e );
        }

        this._setResult( res );
    }
}

export default class ApiClient extends Common {
    #_dnsWatcher;
    #dispatcher;

    constructor ( url, options ) {
        super( url, options );

        this.connect();
    }

    // properties
    get Upload () {
        return ApiClientUpload;
    }

    // protected
    _resolveUrl ( url ) {
        url = new URL( url );

        if ( !url.pathname.endsWith( "/" ) ) url.pathname += "/";

        return url;
    }

    _createWebSocket ( url, protocols ) {
        this.#dispatcher ||= new WebSocketDispatcher( this, isIP( this.hostname )
            ? null
            : this.hostname );

        return new WebSocket( url, {
            protocols,
            "dispatcher": this.#dispatcher,
        } );
    }

    async _dnsLookup () {
        return this.#dnsWatcher.lookup( { "silent": true } );
    }

    _dnsReset () {
        this.#dnsWatcher.reset();
    }

    // private
    get #dnsWatcher () {
        if ( !this.#_dnsWatcher ) {
            this.#_dnsWatcher = new DnsWatcher( this.hostname ).on( "add", addresses => this.connect() ).unref();

            if ( this.realMaxConnections !== 1 ) this.#_dnsWatcher.start();
        }

        return this.#_dnsWatcher;
    }
}
