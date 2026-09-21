import CacheLru from "#lib/cache/lru";
import Interval from "#lib/interval";
import { fromMsgPack, toMsgPack } from "#lib/msgpack";
import sql from "#lib/sql";

const DEFULT_VACUUM_INTERVAL = 1000 * 60 * 60 * 4; // 4 hours

const SQL = {
    "schema": sql`
CREATE TABLE IF NOT EXISTS cache (
    id text PRIMARY KEY,
    value bytea NOT NULL,
    added int53 NOT NULL DEFAULT( strftime( '%s', 'now' ) ),
    expires int53
);
`,

    "get": sql`SELECT * FROM cache WHERE id = ?`.decode( { "added": "int53", "expires": "int53" } ).prepare(),

    "set": sql`INSERT INTO cache ( id, value, expires ) VALUES ( ?, ?, ? )  ON CONFLICT ( id ) DO UPDATE SET value = EXCLUDED.value, expires = EXCLUDED.expires`.prepare(),

    "delete": sql`DELETE FROM cache WHERE id = ?`.prepare(),

    "clear": sql`DELETE FROM cache`.prepare(),

    "deleteExpiredEntries": sql`DELETE FROM cache WHERE expires < ?`.prepare(),
};

export default class CachePersistent {
    #dbh;
    #encode;
    #decode;
    #cacheLru;
    #maxAge = 0;
    #vacuumInterval; // eslint-disable-line no-unused-private-class-members

    constructor ( dbh, { maxSize, maxAge, encode, decode, vacuumInterval } = {} ) {
        this.#dbh = dbh;
        this.#cacheLru = new CacheLru( {
            maxSize,
            "autoDeleteExpiredEntries": false,
        } );
        this.#setMaxAge( maxAge );
        this.#encode = encode;
        this.#decode = decode;

        vacuumInterval ??= DEFULT_VACUUM_INTERVAL;

        if ( vacuumInterval ) this.#vacuumInterval = setInterval( this.#vacuum.bind( this ), vacuumInterval );
    }

    // static
    static async new ( dbh, options ) {
        dbh = sql.new( dbh );

        await dbh.exec( SQL.schema );

        return new this( dbh, options );
    }

    // properties
    get maxSize () {
        return this.#cacheLru.maxSize;
    }

    set maxSize ( value ) {
        this.#cacheLru.maxSize = value;
    }

    get maxAge () {
        return this.#maxAge;
    }

    set maxAge ( value ) {
        this.#setMaxAge( value );
    }

    set encode ( value ) {
        this.#encode = value;
    }

    set decode ( value ) {
        this.#decode = value;
    }

    // public
    has ( key ) {
        key = String( key );

        var listEntry = this.#cacheLru._getListEntry( key );

        if ( listEntry ) {
            if ( listEntry.value.isExpired ) {
                return false;
            }
            else {
                return true;
            }
        }

        return !!this.#getCacheEntry( key );
    }

    get ( key, { silent } = {} ) {
        key = String( key );

        const listEntry = this.#cacheLru._getListEntry( key );

        if ( listEntry ) {
            if ( listEntry.value.isExpired ) {
                return;
            }
            else {
                return this.#cacheLru.get( key, { silent } );
            }
        }

        return this.#getCacheEntry( key )?.value;
    }

    set ( key, value, maxAge ) {
        if ( value === undefined ) return;

        key = String( key );

        if ( maxAge == null ) {
            maxAge = this.#maxAge;
        }
        else if ( !maxAge ) {
            maxAge = 0;
        }
        else {
            maxAge = Interval.new( maxAge ).toMilliseconds().rounded.number;
        }

        if ( maxAge < 0 ) {
            this.delete( key );
        }
        else {
            const expires = maxAge
                ? Date.now() + maxAge
                : null;

            this.#dbh.do( SQL.set, [ key, this.#encoder( value ), expires ] );

            this.#cacheLru.set( key, value, maxAge );
        }
    }

    delete ( key ) {
        key = String( key );

        this.#dbh.do( SQL.delete, [ key ] );
        this.#cacheLru.delete( key );
    }

    clear () {
        this.#dbh.do( SQL.clear );

        this.#cacheLru.clear();
    }

    deleteExpiredEntries () {
        this.#dbh.do( SQL.deleteExpiredEntries, [ Date.now() ] );

        this.#cacheLru.deleteExpiredEntries();
    }

    // private
    #setMaxAge ( value ) {
        this.#maxAge = Interval.new( value ).toMilliseconds().rounded.number;
    }

    #encoder ( value ) {
        return toMsgPack( this.#encode
            ? this.#encode( value )
            : value );
    }

    #decoder ( value ) {
        value = fromMsgPack( value );

        return this.#decode
            ? this.#decode( value )
            : value;
    }

    #vacuum () {
        this.#dbh.do( SQL.deleteExpiredEntries, [ Date.now() ] );
        this.#dbh.do( "VACUUM" );
    }

    #getCacheEntry ( key ) {
        const cacheEntry = this.#dbh.selectRow( SQL.get, [ key ] );

        if ( !cacheEntry.data ) return;

        // expired
        if ( cacheEntry.data.expires && cacheEntry.data.expires <= Date.now() ) return;

        // decode value
        const value = this.#decoder( cacheEntry.data.value );

        this.#cacheLru.set( key, value, cacheEntry.data.expires && cacheEntry.data.expires - Date.now() );

        return { value };
    }
}
