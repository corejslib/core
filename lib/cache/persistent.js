import CacheLru from "#lib/cache/lru";
import Interval from "#lib/interval";
import messagePack from "#lib/message-pack";
import sql from "#lib/sql";

const DEFAULT_VACUUM_INTERVAL = 1000 * 60 * 60 * 4; // 4 hours

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

    "deleteExpiredEntries": sql`DELETE FROM cache WHERE expires <= ?`.prepare(),
};

export default class CachePersistent {
    #dbh;
    #encoder;
    #decoder;
    #cacheLru;
    #maxAge = 0;
    #vacuumInterval; // eslint-disable-line no-unused-private-class-members

    constructor ( dbh, { maxSize, maxAge, encoder, decoder, vacuumInterval } = {} ) {
        this.#dbh = dbh;
        this.#cacheLru = new CacheLru( {
            maxSize,
            "autoDeleteExpiredEntries": false,
        } );
        this.setMaxAge( maxAge );
        this.#encoder = encoder;
        this.#decoder = decoder;

        vacuumInterval ??= DEFAULT_VACUUM_INTERVAL;

        if ( vacuumInterval ) this.#vacuumInterval = setInterval( this.#vacuum.bind( this ), vacuumInterval ).unref();
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

    get maxAge () {
        return this.#maxAge;
    }

    // public
    has ( key ) {
        key = String( key );

        // entry is in memory and not expired
        if ( this.#cacheLru._getListEntry( key ) ) return true;

        return !!this.#getCacheEntry( key );
    }

    get ( key, { silent } = {} ) {
        key = String( key );

        // entry is in memory and not expired
        if ( this.#cacheLru._getListEntry( key ) ) {
            return this.#cacheLru.get( key, { silent } );
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

            this.#dbh.do( SQL.set, [ key, this.#encodeValue( value ), expires ] );

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

    setMaxSize ( value ) {
        this.#cacheLru.setMaxSize( value );

        return this;
    }

    setMaxAge ( value ) {
        this.#maxAge = value
            ? Interval.new( value ).toMilliseconds().rounded.number
            : 0;

        return this;
    }

    setEncoder ( value ) {
        this.#encoder = value;

        return this;
    }

    setDecoder ( value ) {
        this.#decoder = value;

        return this;
    }

    // private
    #encodeValue ( value ) {
        return messagePack.toMessagePack( this.#encoder
            ? this.#encoder( value )
            : value );
    }

    #decodeValue ( value ) {
        value = messagePack.fromMessagePack( value );

        return this.#decoder
            ? this.#decoder( value )
            : value;
    }

    #vacuum () {
        this.#dbh.do( SQL.deleteExpiredEntries, [ Date.now() ] );
        this.#dbh.do( "VACUUM" );
    }

    #getCacheEntry ( key ) {
        const cacheEntry = this.#dbh.selectRow( SQL.get, [ key ] );

        if ( !cacheEntry.data ) return;

        const expires = cacheEntry.data.expires;

        // expired
        if ( expires && expires <= Date.now() ) return;

        // decode value
        const value = this.#decodeValue( cacheEntry.data.value );

        this.#cacheLru.set( key, value, expires
            ? expires - Date.now()
            : 0 );

        return { value };
    }
}
