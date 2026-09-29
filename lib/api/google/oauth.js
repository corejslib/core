import crypto from "node:crypto";
import { readConfigSync } from "#lib/config";
import fetch from "#lib/fetch";
import Mutex from "#lib/threads/mutex";

const DEFAULT_MAX_AGE = 60 * 60, // seconds, 1 hour
    JWT_HEADER = Buffer.from( JSON.stringify( { "alg": "RS256", "typ": "JWT" } ) ).toString( "base64url" );

export default class GoogleOauth {
    #key;
    #scope;
    #maxAge; // in seconds
    #pkey;
    #mutex = new Mutex();
    #token;

    constructor ( key, scope, { maxAge } = {} ) {
        this.#key = typeof key === "string"
            ? readConfigSync( key )
            : key;
        this.#scope = scope;
        this.#maxAge = maxAge || DEFAULT_MAX_AGE;

        this.#pkey = crypto.createPrivateKey( this.#key.private_key );
    }

    // properties
    get projectId () {
        return this.#key.project_id;
    }

    get scope () {
        return this.#scope;
    }

    // public
    // DOCS: https://developers.google.com/identity/protocols/OAuth2ServiceAccount#authorizingrequests
    async getToken () {
        const issueTime = Math.round( Date.now() / 1000 );

        if ( this.#token && this.#token.expire > issueTime ) return result( 200, this.#token.access_token );

        if ( !this.#mutex.tryLock() ) return this.#mutex.wait();

        const jwtClaimSet = Buffer.from( JSON.stringify( {
            "aud": this.#key.token_uri,
            "iss": this.#key.client_email,
            "scope": this.#scope,
            "iat": issueTime,
            "exp": issueTime + this.#maxAge,
        } ) ).toString( "base64url" );

        const sign = crypto.createSign( "RSA-SHA256" );
        sign.update( JWT_HEADER + "." + jwtClaimSet );
        sign.end();

        const jwtSignature = sign.sign( this.#pkey ).toString( "base64url" );

        const jwt = JWT_HEADER + "." + jwtClaimSet + "." + jwtSignature;

        var res = await fetch( this.#key.token_uri, {
            "method": "POST",
            "body": new URLSearchParams( {
                "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
                "assertion": jwt,
            } ),
        } );

        const data = await res.json().catch( e => null );

        if ( res.ok ) {
            this.#token = data;

            this.#token.expire = issueTime + this.#token.expires_in;

            res = result( 200, this.#token.access_token );
        }
        else {
            res = result( [ res.status, data?.error_description || res.statusText ] );
        }

        this.#mutex.unlock( res );

        return res;
    }
}
