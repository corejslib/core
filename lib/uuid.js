import crypto from "node:crypto";
import BrowserUuid from "#browser/uuid";

// public
export default class Uuid extends BrowserUuid {
    #buffer;

    constructor ( uuid ) {
        if ( Buffer.isBuffer( uuid ) ) {
            uuid = new Uint8Array( uuid.buffer, uuid.byteOffset, uuid.byteLength );
        }

        super( uuid );
    }

    // static
    static v4 () {
        return crypto.randomUUID();
    }

    // XXX: https://github.com/nodejs/node/pull/62601
    // static v7 () {
    //     return crypto.randomUUIDv7();
    // }

    // properties
    get buffer () {
        if ( !this.#buffer ) {
            this.#buffer = Buffer.from( this.uint8Array.buffer, this.uint8Array.byteOffset, this.uint8Array.byteLength );
        }

        return this.#buffer;
    }
}
