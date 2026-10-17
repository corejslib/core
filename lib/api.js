import BrowserApiClient from "#lib/_browser/api";
import Upload from "#lib/_browser/api/upload";
import fetch from "#lib/fetch";
import FormData from "#lib/form-data";
import Message from "#lib/message";
import { WebSocket } from "#lib/undici";
import Uuid from "#lib/uuid";

class ApiClientUpload extends Upload {

    // protected
    async _start ( { url, body, dispatcher, fetchOptions } ) {
        this._setProgress( this.size / 2 );

        const headers = {};

        if ( this.api.token ) {
            headers.authorization = "Bearer " + this.api.token;
        }

        var res;

        try {
            res = await fetch( url, {
                ...fetchOptions,
                "method": "POST",
                headers,
                body,
                "signal": this.abortSignal,
                dispatcher,
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
            this._setProgress( this.size );

            res = result.fromJsonRpc( msg );
        }
        catch ( e ) {
            res = result.fromError( e );
        }

        this._setResult( res );
    }
}

class HttptDispatcher extends fetch.Dispatcher {
    constructor ( api ) {
        super( {
            "checkCertificate": api.checkCertificate,

            // NOTE: nginx does not support websocket over HTTP/2
            "allowH2": false,
        } );
    }
}

class WebSocketDispatcher extends fetch.Dispatcher {
    constructor ( api ) {
        super( {
            "checkCertificate": api.checkCertificate,

            // NOTE: nginx does not support websocket over HTTP/2
            "allowH2": false,
        } );
    }
}

export default class ApiClient extends BrowserApiClient {
    #httpDispatcher;
    #websocketDispatcher;

    // protected
    _createUrl ( uri ) {
        return new URL( uri );
    }

    _createWebSocket ( url, protocols ) {
        if ( !this.#websocketDispatcher ) {
            this.#websocketDispatcher = new WebSocketDispatcher( this );
        }

        return new WebSocket( url, {
            protocols,
            "dispatcher": this.#websocketDispatcher,
        } );
    }

    _stringifyRequest ( id, method, args ) {
        const attachments = new Map(),
            body = JSON.stringify(
                {
                    "jsonrpc": "2.0",
                    id,
                    method,
                    "params": args,
                },
                ( key, value ) => {
                    if ( value && typeof value === "object" && Message.isValidBody( value ) ) {
                        const id = "attachment:" + Uuid.v4();

                        attachments.set( id, value );

                        return id;
                    }
                    else {
                        return value;
                    }
                }
            );

        return {
            body,
            attachments,
        };
    }

    _prepareFormData ( body, attachments ) {
        const formData = new FormData();

        formData.write( new Message( {
            "headers": {
                "content-type": "application/json",
                "content-disposition": {
                    "name": "params",
                },
            },
            body,
        } ) );

        for ( const [ name, body ] of attachments.entries() ) {
            formData.write( new Message( {
                "headers": {
                    "content-disposition": {
                        "type": "form-data",
                        name,
                    },
                },
                body,
            } ) );
        }

        return formData;
    }

    _createUpload ( { url, body, dispatcher, signal, fetchOptions } ) {
        return new ApiClientUpload( this, { url, body, dispatcher, signal, fetchOptions } );
    }

    _getHttpDispatcher () {
        if ( !this.#httpDispatcher ) {
            this.#httpDispatcher = new HttptDispatcher( this );
        }

        return this.#httpDispatcher;
    }
}
