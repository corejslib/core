import CacheLru from "#lib/cache/lru";
import fetch from "#lib/fetch";

const TEXT_ENCODER = new TextEncoder(),
    CACHE = new CacheLru( { "maxSize": 1024 } );

export default class PwnedPasswords {
    #apiKey;

    constructor ( apiKey ) {
        this.#apiKey = apiKey;
    }

    // statid
    static async checkPassword ( password ) {
        let pwned = CACHE.get( password );

        if ( pwned != null ) {
            return result( 200, {
                pwned,
            } );
        }

        const hash = new Uint8Array( await globalThis.crypto.subtle.digest( "SHA-1", TEXT_ENCODER.encode( password ) ) ).toHex().toUpperCase(),
            head = hash.slice( 0, 5 ),
            res = await fetch( `https://api.pwnedpasswords.com/range/${ head }` );

        if ( !res.ok ) return result( res.status );

        const tail = hash.slice( 5 ),
            data = await res.text();

        pwned = 0;

        for ( const line of data.split( "\r\n" ) ) {
            if ( line.startsWith( tail ) ) {
                pwned = Number( line.slice( 36 ) );

                break;
            }
        }

        CACHE.set( password, pwned );

        return result( 200, {
            pwned,
        } );
    }

    // public
    async checkPassword ( password ) {
        return this.constructor.checkPassword( password );
    }

    async checkEmailAddress ( emailAddress ) {
        emailAddress = emailAddress.trim().toLowerCase();

        const url = `https://api.pwnedpasswords.com/breachedaccount/${ encodeURIComponent( emailAddress ) }`,
            res = await fetch( url, {
                "headers": {
                    "hibp-api-key": this.#apiKey,
                },
            } );

        if ( !res.ok ) {
            if ( res.status === 404 ) {
                return result( 200 );
            }
            else {
                return result( res.status );
            }
        }

        const pwned = await res.json();

        return result( 200, {
            pwned,
        } );
    }
}
