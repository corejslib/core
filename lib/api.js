import BrowserApiClient from "#lib/_browser/api";
import Upload from "#lib/_browser/api/upload";
import fetch from "#lib/fetch";
import FormData from "#lib/form-data";
import Message from "#lib/message";
import { WebSocket } from "#lib/undici";

class ApiClientUpload extends Upload {

    // protected
    async _start ( { url, headers, body, fetchOptions } ) {
        this._setProgress( this.size / 2 );

        var res;

        try {
            res = await fetch( url, {
                ...fetchOptions,
                "method": "POST",
                headers,
                body,
                "signal": this.abortSignal,
                "dispatcher": this.api._getHttpDispatcher(),
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

class HttpDispatcher extends fetch.Dispatcher {
    constructor ( api ) {
        super( {
            "checkCertificate": api.checkCertificate,
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

    _checkAttachment = Message.isValidBody.bind( Message );

    _createFormData ( body, attachments ) {
        const formData = new FormData();

        formData.write( new Message( {
            "headers": {
                "content-type": "application/json",
                "content-disposition": {
                    "type": "form-data",
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

    _createUpload ( { lifecycleManager, attachments, url, headers, body, signal, fetchOptions } ) {
        return new ApiClientUpload( this, { lifecycleManager, attachments, url, headers, body, signal, fetchOptions } );
    }

    _destroyAttachments ( attachments ) {
        for ( const attachment of attachments.values() ) {
            Message.new( attachment ).destroy();
        }
    }

    _getHttpDispatcher () {
        if ( !this.#httpDispatcher ) {
            this.#httpDispatcher = new HttpDispatcher( this );
        }

        return this.#httpDispatcher;
    }
}
