import fetch from "#lib/fetch";
import result from "#lib/result";
import Events from "./events.js";
import { prepareParams } from "./utils.js";

export default class extends Events {
    #_url;
    #dispatcher;

    // public
    publish ( name, args ) {
        this.#call( "/publish", [ name, ...args ], true );
    }

    async call ( method, args ) {
        return this.#call( method, args );
    }

    voidCall ( method, args ) {
        this.#call( method, args, true );
    }

    // private
    get #url () {
        if ( !this.#_url ) {
            const url = new URL( this.protocol + "//" + this.hostname );

            url.port = this.port;
            url.pathname = this.pathname;

            if ( url.protocol === "ws:" ) {
                url.protocol = "http:";
            }
            else if ( url.protocol === "wss:" ) {
                url.protocol = "https:";
            }

            if ( this.locale ) {
                url.searchParams.set( "locale", this.locale );
            }

            this.#_url = url;
        }

        return this.#_url;
    }

    async #call ( method, args, isVoidCall ) {
        var url = new URL( this.#url ),
            signal,
            download,
            fetchOptions;

        if ( typeof method === "object" ) {
            let voidCall;

            ( { method, args, signal, download, "void": voidCall, ...fetchOptions } = method );

            isVoidCall ||= voidCall;
        }

        // aborted
        if ( signal?.aborted ) return result( -32_817 );

        const headers = {};

        args = prepareParams( args );

        if ( args ) {
            args = {
                "jsonrpc": "2.0",
                "id": isVoidCall
                    ? undefined
                    : this.createRequestId(),
                "method": this.prepateMethodName( method, true ),
                "params": args,
            };

            headers[ "content-type" ] = "application/json";
        }
        else {

            // add method
            url.pathname += this.prepateMethodName( method );
        }

        if ( this.token ) headers.Authorization = "Bearer " + this.token;

        if ( fetch.Dispatcher ) {
            this.#dispatcher ??= new fetch.Dispatcher( {
                "checkCertificate": this.checkCertificate,
            } );
        }

        var res;

        try {
            res = await fetch( url, {
                ...fetchOptions,
                "method": args
                    ? "POST"
                    : "GET",
                "mode": "cors",
                headers,
                "body": args
                    ? JSON.stringify( args )
                    : undefined,
                signal,
                "dispatcher": this.#dispatcher,
            } );
        }
        catch ( e ) {

            // fetch error
            return result.fromError( e );
        }

        // void call
        if ( isVoidCall ) {

            // destroy body
            this.#destroyResponse( res );

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
                this.#destroyResponse( res );

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
                this.emit( "sessionDisable" );
            }

            // session was deleted
            else if ( res.status === -32_815 ) {
                this.emit( "sessionDelete" );
            }

            // access denied
            else if ( res.status === -32_811 ) {
                this.emit( "accessDenied" );
            }

            // authorization
            else if ( res.status === -32_812 && !isVoidCall ) {
                if ( this.onAuthorization && ( await this.onAuthorization() ) ) {

                    // repeat request
                    return this.#call( method, args );
                }
            }

            return res;
        }
    }

    #destroyResponse ( res ) {
        if ( typeof res.body?.destroy === "function" ) {
            res.body.destroy();
        }
        else if ( typeof res.body?.cancel === "function" ) {
            res.body.cancel();
        }
    }
}
