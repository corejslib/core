import CacheLru from "#lib/cache/lru";
import Interval from "#lib/interval";

export default class ApiClientCache {
    #maxSize;
    #maxAge;
    #cache;

    constructor ( api, { cache, maxSize, maxAge } = {} ) {
        this.#maxSize = maxSize;
        this.#maxAge = maxAge;

        if ( cache ) {
            this.#cache = cache;
        }
        else {
            this.#cache = new CacheLru( {
                maxSize,
                maxAge,
            } );
        }

        // clear cache on disconnect
        api.on( "disconnect", () => this.clear() );
    }

    // properties
    get maxSize () {
        return this.#maxSize;
    }

    get maxAge () {
        return this.#maxAge;
    }

    // public
    getCachedResult ( method ) {
        const { key } = this.#parseMethod( method );

        if ( !key ) return;

        return this.#cache.get( key );
    }

    cacheResult ( method, res ) {
        if ( !res.ok || res.meta[ "cache-control-no-cache" ] ) return;

        var { key, maxAge } = this.#parseMethod( method );

        if ( !key ) return;

        if ( maxAge ) maxAge = Interval.new( maxAge ).toMilliseconds().rounded.number;

        if ( res.meta[ "cache-control-expires" ] ) {
            const remoteMaxAge = Date.parse( res.meta[ "cache-control-expires" ] ) - Date.now();

            if ( !Number.isNaN( remoteMaxAge ) ) {
                if ( !maxAge ) {
                    maxAge = remoteMaxAge;
                }
                else if ( remoteMaxAge < maxAge ) {
                    maxAge = remoteMaxAge;
                }
            }
        }

        if ( res.meta[ "cache-control-max-age" ] ) {
            const remoteMaxAge = new Interval( res.meta[ "cache-control-max-age" ] ).toMilliseconds().rounded.number;

            if ( !maxAge ) {
                maxAge = remoteMaxAge;
            }
            else if ( remoteMaxAge < maxAge ) {
                maxAge = remoteMaxAge;
            }
        }

        this.cache.set( key, res, maxAge );
    }

    clear () {
        this.#cache.clear();
    }

    // private
    #parseMethod ( method ) {
        let key, maxAge;

        if ( typeof method === "object" && method.cache ) {
            key = method.cache === true
                ? ""
                : method.cache;
            maxAge = method.maxAge;
            method = method.method;
            key = `${ method }\u{0}${ key }`;
        }

        return {
            key,
            maxAge,
        };
    }
}
