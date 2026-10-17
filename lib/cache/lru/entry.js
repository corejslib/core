import { Timeout } from "#lib/timers";

// max delay supported by setTimeout, larger values fire immediately
const MAX_TIMEOUT = 2 ** 31 - 1;

export default class CacheLruEntry {
    #cache;
    #key;
    #value;
    #expires = null;
    #timeout = null;

    constructor ( cache, key, value, maxAge ) {
        this.#cache = cache;
        this.#key = key;
        this.#value = value;

        if ( maxAge ) {
            this.#expires = Date.now() + maxAge;

            // entries with a longer maxAge are expired lazily, see isExpired
            if ( this.#cache.autoDeleteExpiredEntries && maxAge <= MAX_TIMEOUT ) {
                this.#timeout = new Timeout( maxAge, this.#onExpire.bind( this ) ).unref();
            }
        }
    }

    // properties
    get key () {
        return this.#key;
    }

    get value () {
        return this.#value;
    }

    get isExpired () {
        return this.#expires !== null && this.#expires < Date.now();
    }

    // public
    delete () {
        if ( this.#timeout ) {
            this.#timeout.clear();

            this.#timeout = null;
        }
    }

    // private
    #onExpire () {
        this.#cache.delete( this.#key );
    }
}
