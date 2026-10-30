import "#lib/result";
import crypto from "node:crypto";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";
import Events from "#lib/events";
import Numeric from "#lib/numeric";
import { RESERVED_EVENTS } from "#lib/sql/constants";
import Dbh from "#lib/sql/dbh";
import { sql } from "#lib/sql/query";
import { sqliteDecoders } from "#lib/sql/types";
import Uuid from "#lib/uuid";
import Schema from "./sqlite/schema.js";

const // "shared", "private"
    DEFAULT_CACHE = "private",

    // "ro", "rw", "rwc", "memory"
    DEFAULT_MODE = "rwc",

    // "file", "memory"
    DEFAULT_TEMP_STORE = "memory",

    // "delete", "truncate", "persist", "memory", "wal", "off"
    DEFAULT_JOURNAL_MODE = "wal",

    // "off" - data integrity on app failure
    // "normal" - data integrity on app and OS failures
    // "full" - full data integrity on app or OS failures, slower
    DEFAULT_SYNCHRONOUS = "off",

    // integer, 0+ - pages, -kilobytes
    // default - 1GiB
    DEFAULT_CACHE_SIZE = -1_048_576,

    // ms, 30 seconds
    DEFAULT_BUSY_TIMEOUT = 30_000,
    MAX_PARAMS = 999;

const SQL = {
    "publishQuery": sql`SELECT sqlite_notify( ?, ? )`.prepare(),

    "begin": sql`BEGIN`.prepare(),
    "beginImmediate": sql`BEGIN IMMEDIATE`.prepare(),
    "beginExclusive": sql`BEGIN EXCLUSIVE`.prepare(),
    "commit": sql`COMMIT`.prepare(),
    "rollback": sql`ROLLBACK`.prepare(),
};

// quotes an SQL identifier (schema, table, column name)
function quoteIdentifier ( name ) {
    return `"${ String( name ).replaceAll( '"', '""' ) }"`;
}

// pragma values are interpolated into the "PRAGMA" statements, so only words and numbers are allowed
function assertPragmaValue ( name, value ) {
    if ( !/^\w+$/v.test( String( value ) ) ) throw new TypeError( `SQLite ${ name } is invalid` );
}

// portable transaction isolation levels, SQLite transactions are always serializable,
// so any requested level is satisfied (the SQL standard allows a stricter level than requested)
const ISOLATION_LEVELS = new Set( [ "read uncommitted", "read committed", "repeatable read", "serializable" ] );

// SQLite specific transaction locking modes, "deferred" is the default behavior of "BEGIN"
const LOCKING_MODES = new Map( [
    [ "deferred", SQL.begin ],
    [ "immediate", SQL.beginImmediate ],
    [ "exclusive", SQL.beginExclusive ],
] );

// transaction options supported by the "begin" method
const BEGIN_OPTIONS = new Set( [ "isolationLevel", "readOnly", "locking" ] );

// creates the "BEGIN" query from the options, the user input is never concatenated to the query,
// all unknown options are rejected, so an option is never silently ignored
function createBeginQuery ( options ) {
    if ( options == null ) return { "query": SQL.begin };

    if ( typeof options !== "object" ) {
        return { "error": result( [ 400, "Transaction options must be an object" ] ) };
    }

    for ( const name of Object.keys( options ) ) {
        if ( !BEGIN_OPTIONS.has( name ) ) {
            return { "error": result( [ 400, `Unsupported transaction option "${ name }"` ] ) };
        }
    }

    const { isolationLevel, readOnly, locking } = options;

    if ( isolationLevel != null && !ISOLATION_LEVELS.has( isolationLevel ) ) {
        return { "error": result( [ 400, "Unsupported transaction isolation level" ] ) };
    }

    if ( readOnly != null && typeof readOnly !== "boolean" ) {
        return { "error": result( [ 400, `Transaction option "readOnly" must be a boolean` ] ) };
    }

    let query = SQL.begin;

    if ( locking != null ) {
        query = LOCKING_MODES.get( locking );

        if ( !query ) {
            return { "error": result( [ 400, "Unsupported transaction locking mode" ] ) };
        }
    }

    return {
        query,
        "readOnly": readOnly === true,
    };
}

export default class DbhSqlite extends Dbh {
    #url;
    #sqlite;
    #prepared = {};
    #schema = new Schema( this );
    #destroyed = false;
    #decode = { ...sqliteDecoders };
    #events = new Events();

    constructor ( url, options = {} ) {
        super();

        [ this.#url, options ] = this.#parseFileUrl( url, options );

        this.#sqlite = new DatabaseSync( this.#url, {
            "open": true,
            "readOnly": false,
            "enableForeignKeyConstraints": true,
            "enableDoubleQuotedStringLiterals": false,
            "allowExtension": true,
            "timeout": options.busyTimeout,
            "readBigInts": true,
            "returnArrays": false,
            "allowBareNamedParameters": true,
            "allowUnknownNamedParameters": false,
            "defensive": false,
        } );

        this.pragma( `encoding = "UTF-8"` );
        this.pragma( `temp_store = ${ options.tempStore }` );
        this.pragma( `journal_mode = ${ options.journalMode }` );
        this.pragma( `synchronous = ${ options.synchronous }` );
        this.pragma( `cache_size = ${ options.cacheSize }` );

        // create custom functions
        this.function( "sqlite_notify", ( name, data ) => {

            // reserved event
            if ( RESERVED_EVENTS.has( name ) ) {
                if ( this.schema.isLoaded ) throw new Error( `SQLite event name "${ name }" is reserved` );
                else return;
            }

            // unknown event
            if ( this.schema.isLoaded && !this.schema.isEventValid( name ) ) throw new Error( `SQLite event name "${ name }" is unknown` );

            queueMicrotask( () => this.#events.emit( name, data ) );
        } );

        this.function( "uuidv4", () => Uuid.v4() );

        this.function( "uuidv7", () => Uuid.v7() );

        this.function( "md5", str => {
            if ( str == null ) return null;

            return crypto.createHash( "MD5" ).update( str ).digest( "hex" );
        } );

        this.function( "time_hires", () => Date.now() / 1000 );

        // watch for notifications subscribe
        this.watch( this.#watcher.bind( this ) );
    }

    // properties
    get isSqlite () {
        return true;
    }

    get url () {
        return this.#url;
    }

    get inTransaction () {
        return this.#sqlite.isTransaction;
    }

    get schema () {
        return this.#schema;
    }

    get isDestroyed () {
        return this.#destroyed;
    }

    get isConnected () {
        return true;
    }

    // public
    async start () {
        return this.schema.cron.start();
    }

    async stop () {
        return this.schema.cron.stop();
    }

    async destroy () {
        if ( this.#destroyed ) return;
        this.#destroyed = true;

        await this.stop();

        this.#sqlite.close();
    }

    toString () {
        return this.url;
    }

    toJSON () {
        return this.url;
    }

    quote ( value ) {

        // null
        if ( value == null ) {
            return "NULL";
        }
        else {

            // string
            if ( typeof value === "string" ) {

                // if value contains ZERO character
                // ignore, to make it compatible with postgres, where 0x00 in strings is disabled
                // if ( param.indexOf( "\0" ) > -1 ) {
                //     return "CAST(x'" + Buffer.from( param ).toString( "hex" ) + "' AS TEXT)";
                // }
                // else {
                return "'" + value.replaceAll( "'", "''" ) + "'";

                // }
            }

            // number
            else if ( typeof value === "number" ) {

                // "NaN" and "Infinity" are not valid SQL literals, and would be treated as identifiers
                if ( !Number.isFinite( value ) ) throw new TypeError( `Unsupported SQL number "${ value }"` );

                return String( value );
            }

            // boolean
            else if ( typeof value === "boolean" ) {
                return value === true
                    ? "TRUE"
                    : "FALSE";
            }

            // bigint
            else if ( typeof value === "bigint" ) {
                return value.toString();
            }

            // object
            else if ( typeof value === "object" ) {

                // View
                if ( ArrayBuffer.isView( value ) ) {
                    if ( !Buffer.isBuffer( value ) ) {
                        value = Buffer.from( value.buffer, value.byteOffset, value.byteLength );
                    }

                    return `x'${ value.toHex() }'`;
                }

                // ArrayBuffer
                else if ( value instanceof ArrayBuffer ) {
                    value = Buffer.from( value );

                    return `x'${ value.toHex() }'`;
                }

                // Date
                else if ( value instanceof Date ) {
                    return `'${ value.toISOString() }'`;
                }

                // Temporal.Instant
                else if ( value instanceof Temporal.Instant ) {
                    return `'${ value.toString() }'`;
                }

                // Temporal.ZonedDateTime
                else if ( value instanceof Temporal.ZonedDateTime ) {
                    return `'${ value.toInstant().toString() }'`;
                }

                // Numeric
                else if ( Numeric.isNumeric( value ) ) {
                    return value.toString();
                }

                // object
                else {
                    return `'${ JSON.stringify( value ).replaceAll( "'", "''" ) }'`;
                }
            }

            // invalid type
            else {
                throw new TypeError( `Unsupported SQL parameter type "${ typeof value }"` );
            }
        }
    }

    attach ( name, url, options = {} ) {
        [ url, options ] = this.#parseFileUrl( url, options );

        const schema = quoteIdentifier( name );

        const res = this.do( `ATTACH DATABASE ${ this.quote( url ) } AS ${ schema }` );

        if ( !res.ok ) return res;

        this.pragma( `${ schema }.encoding = "UTF-8"` );
        this.pragma( `${ schema }.temp_store = ${ options.tempStore }` );
        this.pragma( `${ schema }.journal_mode = ${ options.journalMode }` );
        this.pragma( `${ schema }.synchronous = ${ options.synchronous }` );
        this.pragma( `${ schema }.cache_size = ${ options.cacheSize }` );

        return res;
    }

    pragma ( pragma, { simple } = {} ) {
        const query = `PRAGMA ${ pragma }`;

        let data;

        try {
            data = this.#sqlite.prepare( query ).all();
        }
        catch ( e ) {
            return this._onQueryError( e, query );
        }

        if ( simple && data.length ) {
            return data[ 0 ][ Object.keys( data[ 0 ] )[ 0 ] ];
        }
        else {
            return data;
        }
    }

    function ( name, callback, options = {} ) {
        return this.#sqlite.function( name, options, callback );
    }

    aggregate ( name, options ) {
        return this.#sqlite.aggregate( name, options );
    }

    waitConnect () {
        return true;
    }

    publish ( name, data ) {
        return this.select( SQL.publishQuery, [ name, data ] );
    }

    exec ( query, params ) {
        if ( params && !Array.isArray( params ) ) params = params.params;

        const sth = this.#prepareQuery( query, params, true );

        var res;

        try {
            this.#sqlite.exec( sth.query );

            res = result( 200 );
        }
        catch ( e ) {
            res = this._onQueryError( e, sth.query );
        }

        return res;
    }

    do ( query, params ) {
        const res = this.#do( query, params, { "ignoreData": true } );

        return res;
    }

    select ( query, params ) {
        const res = this.#do( query, params );

        return res;
    }

    selectRow ( query, params ) {
        const res = this.#do( query, params, { "firstRow": true } );

        return res;
    }

    // mode: { isolationLevel: "read uncommitted" | "read committed" | "repeatable read" | "serializable", readOnly: boolean, locking: "deferred" | "immediate" | "exclusive" }
    begin ( callback, { mode } = {} ) {

        // validate options before the transaction is started
        const { error, "query": begin, readOnly } = createBeginQuery( mode );

        if ( error ) return error;

        const dbh = this,
            savepointId = dbh.inTransaction
                ? Uuid.v4()
                : null;

        // transaction options can be set only for the top-level transaction, silently ignoring them is not safe
        if ( savepointId && ( begin !== SQL.begin || readOnly ) ) {
            return result( [ 400, "Transaction options can be set only for the top-level transaction" ] );
        }

        // SQLite has no "BEGIN READ ONLY", so "query_only" pragma is enabled for the transaction duration
        let restoreQueryOnly = false;

        if ( readOnly && !dbh.#isQueryOnly() ) {
            const queryOnlyRes = dbh.#setQueryOnly( true );

            if ( !queryOnlyRes.ok ) return queryOnlyRes;

            restoreQueryOnly = true;
        }

        try {

            // start transaction
            var res = dbh.do( savepointId
                ? `SAVEPOINT "${ savepointId }"`
                : begin );

            // transaction started
            if ( res.ok ) {
                try {

                    // call transaction body
                    res = callback( dbh );

                    if ( res instanceof Promise ) {

                        // prevent the unhandled rejection
                        res.catch( () => {} );

                        throw new Error( "SQLite transactions must be synchronous" );
                    }

                    res = result.try( res, { "allowUndefined": true } );
                }
                catch ( e ) {
                    res = result.fromError( e );
                }

                let rollback = !res.ok;

                // commit
                if ( !rollback ) {
                    const commitRes = dbh.do( savepointId
                        ? `RELEASE SAVEPOINT "${ savepointId }"`
                        : SQL.commit );

                    // commit failed, the transaction can still be active (for example, "SQLITE_BUSY")
                    if ( !commitRes.ok ) {
                        res = commitRes;
                        rollback = true;
                    }
                }

                // rollback
                if ( rollback ) dbh.#rollbackTransaction( savepointId );
            }

            return res;
        }
        finally {
            if ( restoreQueryOnly ) dbh.#setQueryOnly( false );
        }
    }

    on ( event, callback ) {
        this.#events.on( event, callback );

        return this;
    }

    once ( event, callback ) {
        this.#events.once( event, callback );

        return this;
    }

    off ( event, callback ) {
        this.#events.off( event, callback );

        return this;
    }

    // private
    #rollbackTransaction ( savepointId ) {
        if ( savepointId ) {
            this.do( `ROLLBACK TO SAVEPOINT "${ savepointId }"` );

            // "ROLLBACK TO" does not remove the savepoint from the transaction stack
            this.do( `RELEASE SAVEPOINT "${ savepointId }"` );
        }
        else {
            this.do( SQL.rollback );
        }
    }

    #isQueryOnly () {
        return Number( this.pragma( "query_only", { "simple": true } ) ) === 1;
    }

    #setQueryOnly ( enabled ) {
        const res = this.pragma( `query_only = ${ enabled
            ? "ON"
            : "OFF" }` );

        return Array.isArray( res )
            ? result( 200 )
            : res;
    }

    #do ( query, params, options = {} ) {
        if ( params && !Array.isArray( params ) ) {
            options = { ...params, ...options };

            params = options.params;
        }

        query = this.#prepareQuery( query, params );

        var sth, decode;

        // query is prepared
        if ( query.id && this.#prepared[ query.id ] ) {
            sth = this.#prepared[ query.id ].sth;
            decode = this.#prepared[ query.id ].decode;
        }

        // sth is not cached
        if ( !sth ) {

            // prepare sth
            try {
                sth = this.#sqlite.prepare( query.query );
            }
            catch ( e ) {
                return this._onQueryError( e, query.query );
            }

            const columns = sth.columns();

            sth.hasColumns = Boolean( columns.length );

            if ( sth.hasColumns ) {
                let _decode;

                for ( const column of columns ) {
                    let type;

                    // get type from query.decode by column name
                    if ( query.types?.[ column.name ] ) {
                        type = query.types[ column.name ];

                        // invalid column decode type
                        if ( typeof type === "string" && !this.#decode[ type ] ) return this._onQueryError( new Error( `Invalid decode type for column "${ column.name }"` ), query.query );
                    }

                    // get type by column type
                    else {
                        type = column.type;
                    }

                    if ( typeof type === "string" ) {
                        type = this.#decode[ type ];
                    }

                    if ( type ) {
                        _decode ||= {};

                        _decode[ column.name ] = type;
                    }
                }

                if ( _decode ) decode = _decode;
            }

            // cache sth
            if ( query.id ) {
                this.#prepared[ query.id ] = {
                    sth,
                    decode,
                };
            }
        }

        // check correct dbh method usage
        if ( options.ignoreData ) {
            if ( sth.hasColumns ) throw new Error( `Invalid usage, you need to execute query, that returns data, using "select" method: ${ query.query }` );
        }
        else if ( !sth.hasColumns ) {
            throw new Error( `Invalid usage, you need to execute query, that returns no data, using "do" method: ${ query.query }` );
        }

        const ignoreData = options.ignoreData ?? !sth.hasColumns;

        try {
            let data, res;

            const method = ignoreData
                ? "run"
                : options.firstRow
                    ? "get"
                    : "all";

            if ( query.params ) {
                data = sth[ method ]( {}, ...this.#prepareParams( query.params ) );
            }
            else {
                data = sth[ method ]();
            }

            // "do" request
            if ( ignoreData ) {
                res = result( 200, null );

                res.meta.rows = Number( data.changes );

                // bigint is too big for number
                if ( !Number.isSafeInteger( res.meta.rows ) ) {
                    throw new RangeError( `Number in "meta.rows" is out of range` );
                }
            }

            // "select" request
            else {
                res = result( 200 );

                if ( !options.firstRow && !data.length ) data = null;

                if ( data ) {
                    if ( options.firstRow ) data = [ data ];

                    // decode columns
                    for ( const row of data ) {
                        for ( const name in row ) {
                            if ( row[ name ] == null ) {
                                continue;
                            }

                            // decode with column decoder
                            else if ( decode?.[ name ] ) {
                                row[ name ] = decode[ name ]( row[ name ] );
                            }

                            // decode bigint
                            else if ( typeof row[ name ] === "bigint" ) {

                                // decode bigint to number
                                row[ name ] = Number( row[ name ] );

                                // bigint is too big for number
                                if ( !Number.isSafeInteger( row[ name ] ) ) {
                                    throw new RangeError( `Number in column "${ name }" is out of range` );
                                }
                            }

                            // decode Uint8Array
                            else if ( row[ name ] instanceof Uint8Array ) {
                                row[ name ] = Buffer.from( row[ name ].buffer, row[ name ].byteOffset, row[ name ].byteLength );
                            }
                        }
                    }

                    res.meta.rows = data.length;

                    if ( options.firstRow ) data = data[ 0 ];

                    res.data = data;
                }
                else {
                    res.meta.rows = 0;
                }
            }

            return res;
        }
        catch ( e ) {
            return this._onQueryError( e, query.query );
        }
    }

    #prepareQuery ( query, params, toString ) {
        var sth;

        if ( typeof query === "string" ) {
            query = sql( query );
        }
        else {
            params ||= query.params;
        }

        if ( !params?.length ) params = null;

        if ( params && ( toString || params.length > MAX_PARAMS ) ) {
            sth = {
                "query": this.queryToString( query, params ),
                "types": query.types,
            };
        }
        else {
            sth = {
                "id": query.id,
                "query": query.sqliteQuery,
                params,
                "types": query.types,
            };
        }

        return sth;
    }

    #prepareParams ( params ) {
        const _params = [];

        for ( const param of params ) {

            // null
            if ( param == null ) {
                _params.push( null );
            }
            else {
                if ( typeof param === "boolean" ) {
                    _params.push( param === true
                        ? 1
                        : 0 );
                }

                // object
                else if ( typeof param === "object" ) {

                    // View
                    if ( ArrayBuffer.isView( param ) ) {
                        _params.push( param );
                    }

                    // Date
                    else if ( param instanceof Date ) {
                        _params.push( param.toISOString() );
                    }

                    // Temporal.Instant
                    else if ( param instanceof Temporal.Instant ) {
                        _params.push( param.toString() );
                    }

                    // Temporal.ZonedDateTime
                    else if ( param instanceof Temporal.ZonedDateTime ) {
                        _params.push( param.toInstant().toString() );
                    }

                    // Numeric
                    else if ( Numeric.isNumeric( param ) ) {
                        _params.push( param.toString() );
                    }

                    // ArrayBuffer
                    else if ( param instanceof ArrayBuffer ) {
                        _params.push( Buffer.from( param ) );
                    }

                    // object
                    else {
                        _params.push( JSON.stringify( param ) );
                    }
                }

                // add as is
                else {
                    _params.push( param );
                }
            }
        }

        return _params;
    }

    #parseFileUrl ( url, options = {} ) {
        options = { ...options };

        var relative;

        if ( url instanceof URL ) {
            url = new URL( url );
        }
        else {

            // url string
            if ( url.startsWith( "file:" ) ) {

                // relative
                if ( !url.startsWith( "file:/" ) ) {
                    url = new URL( url );

                    if ( url.pathname !== "/" && url.pathname !== "/:memory:" ) {
                        relative = true;

                        url.pathname = path.join( process.cwd(), url.pathname );
                    }
                }

                // absolute
                else {
                    url = new URL( url );
                }
            }

            // path
            else if ( url === ":memory:" ) {
                url = new URL( "file:///:memory:" );
            }
            else {
                if ( !path.isAbsolute( url ) ) relative = true;

                url = pathToFileURL( path.resolve( url ) );
            }
        }

        // not a file url
        if ( url.protocol !== "file:" ) {
            throw new Error( "Invalid SQL protocol" );
        }

        // cache
        options.cache ||= url.searchParams.get( "cache" ) || DEFAULT_CACHE;

        // mode
        options.mode ||= url.searchParams.get( "mode" ) || DEFAULT_MODE;

        // tempStore
        options.tempStore ??= url.searchParams.get( "tempStore" ) || DEFAULT_TEMP_STORE;
        assertPragmaValue( "tempStore", options.tempStore );

        // journalMode
        options.journalMode ??= url.searchParams.get( "journalMode" ) || DEFAULT_JOURNAL_MODE;
        assertPragmaValue( "journalMode", options.journalMode );

        // synchronous
        options.synchronous ??= url.searchParams.get( "synchronous" ) || DEFAULT_SYNCHRONOUS;
        assertPragmaValue( "synchronous", options.synchronous );

        // cacheSize
        options.cacheSize ??= +( url.searchParams.get( "cacheSize" ) || DEFAULT_CACHE_SIZE );
        if ( !Number.isInteger( options.cacheSize ) ) throw new TypeError( "SQLite cacheSize is invalid" );

        // busyTimeout
        options.busyTimeout ||= +( url.searchParams.get( "busyTimeout" ) || DEFAULT_BUSY_TIMEOUT );
        if ( !Number.isInteger( options.busyTimeout ) || options.busyTimeout <= 0 ) throw new TypeError( "SQLite busyTimeout is invalid" );

        const urlSearchParams = new URLSearchParams();

        if ( options.cache !== DEFAULT_CACHE ) urlSearchParams.set( "cache", options.cache );
        if ( options.tempStore !== DEFAULT_TEMP_STORE ) urlSearchParams.set( "tempStore", options.tempStore );
        if ( options.journalMode !== DEFAULT_JOURNAL_MODE ) urlSearchParams.set( "journalMode", options.journalMode );
        if ( options.synchronous !== DEFAULT_SYNCHRONOUS ) urlSearchParams.set( "synchronous", options.synchronous );
        if ( options.cacheSize !== DEFAULT_CACHE_SIZE ) urlSearchParams.set( "cacheSize", options.cacheSize );
        if ( options.busyTimeout !== DEFAULT_BUSY_TIMEOUT ) urlSearchParams.set( "busyTimeout", options.busyTimeout );
        if ( options.mode !== DEFAULT_MODE && options.mode !== "memory" ) urlSearchParams.set( "mode", options.mode );

        urlSearchParams.sort();

        // temp
        if ( url.pathname === "/" ) {
            url = "file:";
        }

        // memory
        else if ( url.pathname === "/:memory:" || options.mode === "memory" ) {
            url = "file::memory:";
        }
        else if ( relative ) {
            url = "file:" + path.relative( process.cwd(), fileURLToPath( url ) ).replaceAll( "\\", "/" );
        }
        else {
            url = "file:" + url.pathname;
        }

        if ( urlSearchParams.size ) url += "?" + urlSearchParams.toString();

        return [ url, options ];
    }

    #watcher ( name, subscribe ) {
        if ( !subscribe ) return;

        // reserved event
        if ( RESERVED_EVENTS.has( name ) ) return;

        if ( this.schema.isLoaded && !this.schema.isEventValid( name ) ) throw new Error( `Event name "${ name }" is not emitted by the database` );
    }
}
