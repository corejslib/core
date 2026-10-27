import CramMd5 from "#lib/sasl/cram-md5";
import Login from "#lib/sasl/login";
import Plain from "#lib/sasl/plain";
import ScramSha256 from "#lib/sasl/scram-sha-256";

const METHODS = [ ScramSha256, CramMd5, Login, Plain ];

export default class Sasl {
    #username;
    #password;
    #method;

    constructor ( methods, username, password ) {
        this.#username = username;
        this.#password = password;

        methods = new Set( methods.map( method => method.toUpperCase() ) );

        for ( const Method of METHODS ) {
            if ( methods.has( Method.method ) ) {
                this.#method = new Method( this );

                break;
            }
        }
    }

    // properties
    get username () {
        return this.#username;
    }

    get password () {
        return this.#password;
    }

    get method () {
        return this.#method?.method;
    }

    // public
    continue ( response ) {
        return this.#method?.continue( response );
    }
}
