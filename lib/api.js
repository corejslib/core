import { isIP } from "node:net";
import BrowserApiClient from "#lib/_browser/api";
import fetch from "#lib/fetch";
import FormData from "#lib/form-data";
import Message from "#lib/message";
import { WebSocket } from "#lib/undici";
import Uuid from "#lib/uuid";

class WebSocketDispatcher extends fetch.Dispatcher {
    #hostname;

    constructor ( api ) {
        super( {
            "checkCertificate": api.checkCertificate,

            // NOTE: nginx does not support websocket over HTTP/2
            "allowH2": false,
        } );

        if ( !api.useServiceDiscovery && !isIP( api.hostname ) ) {
            this.#hostname = api.hostname;
        }
    }

    // protected
    _processHeaders ( headers ) {
        if ( this.#hostname ) {
            headers.set( "host", this.#hostname );
        }
    }
}

export default class ApiClient extends BrowserApiClient {
    #dispatcher;

    // protected
    _createUrl ( uri ) {
        return new URL( uri );
    }

    _createWebSocket ( url, protocols ) {
        if ( !this.#dispatcher ) {
            this.#dispatcher = new WebSocketDispatcher( this );
        }

        return new WebSocket( url, {
            protocols,
            "dispatcher": this.#dispatcher,
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
}
