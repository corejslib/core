import "#lib/result";
import crypto from "node:crypto";
import net from "node:net";
import tls from "node:tls";
import Queue from "#lib/data-structures/queue";
import mixins from "#lib/mixins";
import Numeric from "#lib/numeric";
import Sasl from "#lib/sasl";
import constants from "#lib/sql/constants";
import Dbh from "#lib/sql/dbh";
import { createOffsetLimit, sql } from "#lib/sql/query";
import { encodeBuffer, encodeDate } from "#lib/sql/types";
import { READ_ONLY_SQL_TRANSACTION } from "./error-codes.js";
import LargeObject from "./large-object.js";
import MessageBuffer from "./message-buffer.js";
import Transactions from "./transactions.js";

const PROTOCOL_VERSION = Buffer.from( [ 0x00, 0x03, 0x00, 0x00 ] ); // v3

const MAX_PARAMS = 65_535;

// FRONTEND MESSAGES
const FRONTEND = {
    "SASL_RESPONSE": "p",
    "BIND": "B",
    "CANCEL_REQUEST": "",
    "CLOSE": "C",
    "CLOSE_STATEMENT": "S",
    "CLOSE_PORTAL": "P",
    "DESCRIBE": "D",
    "DESCRIBE_STATEMENT": "S",
    "DESCRIBE_PORTAL": "P",
    "EXECUTE": "E",
    "FLUSH": "H",
    "FUNCTION_CALL": "F",
    "PARSE": "P",
    "PASSWORD_MESSAGE": "p",
    "QUERY": "Q",
    "SSL_REQUEST": "",
    "STARTUP_MESSAGE": "",
    "SYNC": "S",
    "TERMINATE": "X",
};

// BACKEND MESSAGES
const BACKEND = {

    // AUTH
    "AUTHENTICATION": "R",

    // AUTH TYPE
    "AUTHENTICATION_OK": 0,
    "AUTHENTICATION_KERBEROS_V5": 2,
    "AUTHENTICATION_CLEARTEXT_PASSWORD": 3,
    "AUTHENTICATION_MD5_PASSWORD": 5,
    "AUTHENTICATION_SCM_CREDENTIAL": 6,
    "AUTHENTICATION_GSS": 7,
    "AUTHENTICATION_GSS_CONTINUE": 8,
    "AUTHENTICATION_SSPI": 9,
    "AUTHENTICATION_SASL": 10,
    "AUTHENTICATION_SASL_CONTINUE": 11,
    "AUTHENTICATION_SASL_FINAL": 12,

    "BACKEND_KEY_DATA": "K",
    "BIND_COMPLETE": "2",
    "CLOSE_COMPLETE": "3",
    "COMMAND_COMPLETE": "C",
    "DATA_ROW": "D",
    "EMPTY_QUERY_RESPONSE": "I",
    "ERROR_RESPONSE": "E",
    "FUNCTION_CALL_RESPONSE": "V",
    "NO_DATA": "n",
    "NOTICE_RESPONSE": "N",
    "NOTIFICATION_RESPONSE": "A",
    "PARAMETER_DESCRIPTION": "t",
    "PARAMETER_STATUS": "S",
    "PARSE_COMPLETE": "1",
    "PORTAL_SUSPENDED": "s",
    "READY_FOR_QUERY": "Z",
    "ROW_DESCRIPTION": "T",
};

const BACKEND_METHOD = Object.fromEntries( Object.keys( BACKEND ).map( key => [ BACKEND[ key ], "_ON_PG_" + key ] ) );

const TRANSACTION_STATE = {
    "I": false, // idle, not in transaction
    "T": true, // in transaction block
    "E": true, // in a failed transaction block (queries will be rejected until block is ended)
};

// COPY
// const COPY_DATA = "d"; // frontend, backend
// const COPY_DONE = "c"; // frontend, backend
// const COPY_FAIL = "f"; // frontend
// const COPY_IN_RESPONSE = "G"; // backend
// const COPY_OUT_RESPONSE = "H"; // backend
// const COPY_BOTH_RESPONSE = "W"; // backend

const ERROR_RESPONSE_TYPE = {
    "S": "severity",
    "C": "code",
    "M": "message",
    "D": "detail",
    "H": "hint",
    "P": "position",
    "p": "internal_position",
    "q": "internal_query",
    "W": "where",
    "F": "file",
    "L": "line",
    "R": "routine",
    "V": "text",
};

const messageBuffer = new MessageBuffer();

export default class DbhPostgreSql extends mixins( Transactions, LargeObject, Dbh ) {
    #pool;
    #username;
    #database;
    #standbyAddress;

    #sessionParams = {};
    #pid;
    #secret; // eslint-disable-line no-unused-private-class-members

    #socket;
    #rbuf;
    #wbuf = [];
    #sasl;

    #queue = new Queue();
    #prepared = {};
    #isDestroyed;
    #isConnected = false;
    #isPrimary;
    #transactionState = "I"; // in "idle" state by default
    #abortController = new AbortController();

    #sth;

    constructor ( pool, options = {} ) {
        super();

        this.#pool = pool;
        this.#username = ( options.username || this.#pool.username ) ?? "";
        this.#database = ( options.database || this.#pool.database ) ?? "";
        this.#isDestroyed = !!options.destroyed;
        this.#isPrimary = !options.standbyAddress;
        this.#standbyAddress = options.standbyAddress;

        if ( !this.#isDestroyed ) this.#connect();
    }

    // properties
    get isPostgreSql () {
        return true;
    }

    get mainPid () {
        return this.#pool.mainPid;
    }

    get url () {
        return this.#pool.url;
    }

    get isPrimary () {
        return this.#isPrimary;
    }

    get schema () {
        return this.#pool.schema;
    }

    get largeObjectReadSize () {
        return this.#pool.largeObjectReadSize;
    }

    get standbyAddress () {
        return this.#standbyAddress;
    }

    get inTransaction () {
        return TRANSACTION_STATE[ this.#transactionState ];
    }

    get isDestroyed () {
        return this.#isDestroyed;
    }

    get pid () {
        return this.#pid;
    }

    get main () {
        return this.#pool;
    }

    get abortSignal () {
        return this.#abortController.signal;
    }

    // public
    toString () {
        return this.url;
    }

    toJSON () {
        return this.url;
    }

    quote ( value ) {
        return this.#pool.quote( value );
    }

    destroy ( res ) {
        if ( this.#isDestroyed ) return;

        this.#isDestroyed = true;
        this.#isConnected = false;

        // cleanup socket
        this.#socket.removeAllListeners();
        this.#socket.destroy();
        this.#socket = null;

        // create result
        if ( !res ) {
            res = result.exception( [ 500, "Database connection closed" ] );
        }
        else {
            res = result.exception( res );
        }

        // cleanup queue
        var queue = this.#queue;

        this.#queue = new Queue();

        // finish current request
        this.#finishRequest( res );

        // finish all pending requests
        for ( const sth of queue ) {
            sth.resolve( res );
        }

        this.#abortController.abort();
        this.emit( "destroy", this, res );
    }

    #send ( buf ) {
        if ( !this.#isConnected ) {
            this.#wbuf.push( buf );
        }
        else {
            this.#socket.write( buf );
        }
    }

    #connect () {

        // primary connection
        if ( this.#isPrimary ) {
            this.#socket = this.#pool.socket
                ? net.connect( this.#pool.socket )
                : net.connect( this.#pool.port, this.#pool.hostname );
        }

        // standby connection
        else {
            this.#socket = net.connect( this.#pool.standbyPort, this.#standbyAddress );
        }

        // upgrade socket
        if ( this.#pool.protocol === "postgresql+tls:" ) {
            this.#socket = tls.connect( {
                "socket": this.#socket,
                "servername": this.#isPrimary
                    ? this.#pool.hostname
                    : this.#pool.standbyHostname,
                "rejectUnauthorized": this.#pool.checkCertificate,
            } );

            this.#socket.once( "secureConnect", this.#onConnect.bind( this ) );
        }
        else {
            this.#socket.once( "connect", this.#onConnect.bind( this ) );
        }

        this.#socket.setKeepAlive( true, 60_000 );

        this.#socket.on( "data", this.#onData.bind( this ) );

        this.#socket.once( "close", hadError => this.destroy( result( [ 500, "DBH is disconnected" ] ) ) );

        this.#socket.once( "error", e => this.destroy( result( [ 500, e.message ] ) ) );
    }

    #onConnect () {
        const params = {
            "user": this.#username,
            "database": this.#database,
            "options": "--client-min-messages=warning",
            "replication": "false",
            "application_name": this.#pool.appName,

            // session run-time params
            "client_encoding": "utf8",
            "bytea_output": "hex",
            "backslash_quote": "off",
            "standard_conforming_strings": "on",
        };

        messageBuffer.beginMsg( FRONTEND.STARTUP_MESSAGE ).write( PROTOCOL_VERSION );

        Object.keys( params ).forEach( param => messageBuffer.write( param + "\0" + params[ param ] + "\0" ) );

        this.#socket.write( messageBuffer.writeNull().endMsg().done() );
    }

    #finishRequest ( res ) {
        var sth = this.#sth;

        if ( !sth ) {
            this._checkIdle();

            return;
        }

        this.#sth = this.#queue.shift();

        // compose result
        if ( !res ) {
            if ( sth.error ) {
                res = this._onQueryError( sth.error, sth.query, {
                    "meta": sth.error,
                    "silent": sth.options?._readOnlyTest && sth.error?.code === READ_ONLY_SQL_TRANSACTION,
                } );
            }
            else {
                let columns;

                if ( sth.id ) {
                    columns = this.#prepared[ sth.id ].columns;

                    // prepared query finished succesfully
                    this.#prepared[ sth.id ].described = true;
                }
                else {
                    columns = sth.columns;
                }

                // check correct dbh method usage
                if ( sth.options.ignoreData ) {

                    // query returns
                    if ( columns ) {
                        res = this._onQueryError( `Invalid usage, you need to execute query, that returns data, using "select" method`, sth.query );
                    }
                }

                // query returns no data
                else if ( !columns ) {
                    res = this._onQueryError( `Invalid usage, you need to execute query, that returns no data, using "do" method`, sth.query );
                }

                if ( !res ) {
                    res = result( 200, sth.data.length
                        ? sth.data
                        : null );

                    if ( typeof sth.rows !== "undefined" ) res.meta.rows = sth.rows;
                }
            }
        }

        this._checkIdle();

        sth.resolve( res );
    }

    #onData ( data ) {
        if ( this.#rbuf ) {
            this.#rbuf = Buffer.concat( [ this.#rbuf, data ] );
        }
        else {
            this.#rbuf = data;
        }

        while ( this.#rbuf.length > 4 ) {
            var length = this.#rbuf.readUInt32BE( 1 );

            if ( this.#rbuf.length >= length + 1 ) {
                const msgId = this.#rbuf.toString( "latin1", 0, 1 ),
                    body = this.#rbuf.subarray( 5, length + 1 );

                this.#rbuf = this.#rbuf.subarray( length + 1 );

                const method = this[ BACKEND_METHOD[ msgId ] ];

                if ( !method ) throw `Unhandled PostgreSQL message "${ msgId }"`;

                method.call( this, body );
            }
            else {
                break;
            }
        }
    }

    // postgres message handlers
    async _ON_PG_AUTHENTICATION ( data ) {
        var type = data.readUInt32BE();

        if ( type === BACKEND.AUTHENTICATION_OK ) {

            // auth is ok
        }
        else if ( type === BACKEND.AUTHENTICATION_CLEARTEXT_PASSWORD ) {
            this.#socket.write( messageBuffer
                .beginMsg( FRONTEND.PASSWORD_MESSAGE )
                .write( this.#pool.password ?? "" )
                .writeNull()
                .endMsg()
                .done() );
        }
        else if ( type === BACKEND.AUTHENTICATION_MD5_PASSWORD ) {
            const pwdhash = crypto
                .createHash( "MD5" )
                .update( ( this.#pool.password ?? "" ) + this.#username, "utf8" )
                .digest( "hex" );

            const hash =
                "md5" +
                crypto
                    .createHash( "MD5" )
                    .update( pwdhash + data.subarray( 4 ).toString( "latin1" ), "latin1" )
                    .digest( "hex" );

            this.#socket.write( messageBuffer.beginMsg( FRONTEND.PASSWORD_MESSAGE ).write( hash ).writeNull().endMsg().done() );
        }
        else if ( type === BACKEND.AUTHENTICATION_SASL ) {
            const mechanisms = data.subarray( 4 ).toString().split( "\0" );

            this.#sasl = await Sasl.new( mechanisms, this.#username, this.#pool.password );

            if ( !this.#sasl ) return this.destroy( result( [ 500, "Unsupported authentication method" ] ) );

            const response = this.#sasl.continue();

            // SASLInitialResponse
            this.#socket.write( messageBuffer.beginMsg( FRONTEND.SASL_RESPONSE ).write( this.#sasl.type ).writeNull().writeUInt32BE( response.length ).write( response ).endMsg().done() );
        }
        else if ( type === BACKEND.AUTHENTICATION_SASL_CONTINUE ) {
            const response = this.#sasl.continue( data.subarray( 4 ).toString() );

            if ( !response ) return this.destroy( result( [ 500, "Unsupported authentication method" ] ) );

            // SASLResponse
            this.#socket.write( messageBuffer.beginMsg( FRONTEND.SASL_RESPONSE ).write( response ).endMsg().done() );
        }
        else if ( type === BACKEND.AUTHENTICATION_SASL_FINAL ) {
            const ok = this.#sasl.continue( data.subarray( 4 ).toString() );

            this.#sasl = null;

            if ( !ok ) this.destroy( result( [ 500, "Unsupported authentication method" ] ) );
        }
        else {
            this.destroy( result( [ 500, "Unsupported authentication method" ] ) );
        }
    }

    _ON_PG_PARAMETER_STATUS ( data ) {
        var [ key, val ] = data.toString().split( "\0" );

        this.#sessionParams[ key ] = val;
    }

    _ON_PG_BACKEND_KEY_DATA ( data ) {

        // Identifies the message as cancellation key data.
        // The frontend must save these values if it wishes to be able to issue CancelRequest messages later.

        this.#pid = data.readUInt32BE();

        this.#secret = data.readUInt32BE( 4 );

        this.emit( "connect", this );
    }

    // ready for query
    _ON_PG_READY_FOR_QUERY ( data ) {
        this.#transactionState = data.toString();

        // dbh is connected
        if ( !this.#isConnected ) {
            this.#isConnected = true;

            // send pending messages
            if ( this.#wbuf.length ) {
                if ( this.#wbuf.length === 1 ) {
                    this.#socket.write( this.#wbuf[ 0 ] );
                }
                else {
                    this.#socket.write( Buffer.concat( this.#wbuf ) );
                }

                this.#wbuf = [];
            }
        }

        // query is finished
        else {
            this.#finishRequest();
        }
    }

    // error response
    _ON_PG_ERROR_RESPONSE ( data ) {
        var error = {};

        // parse error message
        for ( const field of data.toString().split( "\0" ) ) {
            if ( !field ) continue;

            error[ ERROR_RESPONSE_TYPE[ field.charAt( 0 ) ] ] = field.slice( 1 );
        }

        // error during connection
        if ( !this.#isConnected ) {
            this.destroy( result( [ 500, error.message ] ) );
        }

        // query error
        else if ( this.#sth ) {
            this.#sth.error = error;
        }

        // unknown error
        else {
            this.destroy( result( [ 500, error.message ] ) );
        }
    }

    _ON_PG_EMPTY_QUERY_RESPONSE ( data ) {

        // identifies the message as a response to an empty query string. (This substitutes for CommandComplete.)
        this._ON_PG_COMMAND_COMPLETE( data );
    }

    _ON_PG_ROW_DESCRIPTION ( data ) {
        var types = this.#sth.types,
            decoder,
            numOfCols = data.readInt16BE(),
            pos = 2,
            columns = [];

        for ( let n = 0; n < numOfCols; n++ ) {
            let idx = data.indexOf( "\0", pos );

            const column = [

                //
                data.toString( "latin1", pos, idx ), // 0, column name
                data.readInt32BE( ( idx += 1 ) ), // 1, if the field can be identified as a column of a specific table, the object ID of the table; otherwise zero.
                data.readInt16BE( ( idx += 4 ) ), // 2, if the field can be identified as a column of a specific table, the attribute number of the column; otherwise zero.
                data.readInt32BE( ( idx += 2 ) ), // 3, the object ID of the field's data type.
                data.readInt16BE( ( idx += 4 ) ), // 4, the data type size (see pg_type.typlen). Note that negative values denote variable-width types., -1 - indicates a "varlena" type (one that has a length word);, -2 - indicates a null-terminated C string;
                data.readInt32BE( ( idx += 2 ) ), // 5, the type modifier (see pg_attribute.atttypmod). The meaning of the modifier is type-specific.
                data.readInt16BE( ( idx += 4 ) ), // 6, the format code being used for the field. Currently will be 0 (text) or 1 (binary). In a RowDescription returned from the statement variant of Describe, the format code is not yet known and will always be zero.
            ];

            pos = idx + 2;

            // get decoder by column name
            if ( types?.[ column[ 0 ] ] ) {
                decoder = types[ column[ 0 ] ];

                if ( typeof decoder === "string" ) {
                    decoder = this.#pool.decode[ decoder ];

                    if ( !decoder ) this.#sth.error = new Error( `Invalid decode type for column "${ column[ 0 ] }"` );
                }
            }

            // get decoder by type oid (or base type for domains)
            else {
                decoder = this.#pool.decode[ column[ 3 ] ];
            }

            // store type decoder
            column.push( decoder );

            // add column
            columns.push( column );
        }

        this.#sth.columns = columns;

        // query is prepared, store columns descriptions
        if ( this.#sth.id ) this.#prepared[ this.#sth.id ].columns = columns;
    }

    _ON_PG_NO_DATA ( data ) {}

    _ON_PG_DATA_ROW ( data ) {

        // ignore data
        if ( this.#sth.options.ignoreData ) return;

        var numOfCols = data.readUInt16BE(),
            columns = this.#sth.id
                ? this.#prepared[ this.#sth.id ].columns
                : this.#sth.columns,
            pos = 2,
            row = {};

        for ( let n = 0; n < numOfCols; n++ ) {
            const length = data.readInt32BE( pos );
            let col;

            pos += 4;

            // col is ""
            if ( !length ) {
                col = "";
            }

            // col is null
            else if ( length === -1 ) {
                col = null;
            }

            // col has data
            else {
                const decoder = columns[ n ][ 7 ];

                // column has decoder
                if ( decoder ) {
                    col = decoder( data.subarray( pos, ( pos += length ) ) );
                }

                // decode to utf8 string by default
                else {
                    col = data.toString( "utf8", pos, ( pos += length ) );
                }
            }

            row[ columns[ n ][ 0 ] ] = col;
        }

        this.#sth.data.push( row );
    }

    _ON_PG_COMMAND_COMPLETE ( data ) {
        const rowsTag = data.toString( "latin1", 0, data.length - 1 );

        const rows = rowsTag.match( /\s(\d+)$/ );

        if ( rows ) this.#sth.rows = +rows[ 1 ];
    }

    _ON_PG_PARSE_COMPLETE ( data ) {}

    _ON_PG_BIND_COMPLETE ( data ) {}

    _ON_PG_CLOSE_COMPLETE ( data ) {}

    _ON_PG_PORTAL_SUSPENDED ( data ) {}

    _ON_PG_NOTICE_RESPONSE ( data ) {
        var error = {};

        for ( const field of data.toString().split( "\0" ) ) {
            if ( !field ) continue;

            error[ ERROR_RESPONSE_TYPE[ field.charAt( 0 ) ] ] = field.slice( 1 );
        }

        console.log( "PostgreSQL notice:", error.severity, error.message + ( error.hint
            ? ", " + error.hint
            : "" ) );
    }

    _ON_PG_NOTIFICATION_RESPONSE ( data ) {

        // const pid = data.readInt32BE();

        var [ name, payload ] = data.subarray( 4 ).toString().split( "\0" );

        // reserved event
        if ( constants.reservedEvents.has( name ) ) {
            if ( this.#pool.schema.isLoaded ) throw new Error( `PostgreSQL event name "${ name }" is reserved` );
            else return;
        }

        // unknown event
        if ( this.#pool.schema.isLoaded && !this.#pool.schema.isEventValid( name ) ) throw new Error( `PostgreSQL event name "${ name }" is unknown` );

        // no listeners, ignore event
        if ( !this.#pool.hasListeners( name ) ) return;

        // no payload
        if ( !payload ) {
            this.#pool.emit( name );
        }

        // has payload
        else {

            // decode payload
            try {
                payload = JSON.parse( payload );
            }
            catch {

                // invalid payload
                console.log( `Unable to decode JSON notification payload for event: "${ name }":\n${ payload }` );

                return;
            }

            this.#pool.emit( name, payload );
        }
    }

    // query
    async exec ( query, params ) {
        return new Promise( resolve => {
            this.#do( resolve, query, params, {
                "exec": true,
                "ignoreData": true,
            } );
        } );
    }

    async do ( query, params ) {
        return new Promise( resolve => {
            this.#do( resolve, query, params, {
                "ignoreData": true,
            } );
        } );
    }

    async select ( query, params ) {
        return new Promise( resolve => {
            this.#do( resolve, query, params );
        } );
    }

    async selectRow ( query, params ) {
        return new Promise( resolve => {
            this.#do(
                res => {
                    if ( res.data ) {
                        res.data = res.data[ 0 ];
                        res.meta.rows = 1;
                    }
                    else {
                        res.meta.rows = 0;
                    }

                    resolve( res );
                },
                query,
                params,
                {
                    "maxRows": 1,
                }
            );
        } );
    }

    async read ( query, { summaryQuery, orderBy, offset, limit, defaultLimit, maxLimit, maxResults } = {} ) {
        var maxResultsLimit;

        ( { offset, limit, maxResultsLimit } = createOffsetLimit( offset, limit, { defaultLimit, maxLimit, maxResults } ) );

        // nothing to fetch
        if ( limit === 0 ) return result( 200, null, { "next_page": false } );

        var summary, totalRows;

        // has summary query
        if ( summaryQuery ) {

            // cache query
            const preparedQuery = summaryQuery.prepare().decode( { "total": "int53" } );

            summary = await this.selectRow( preparedQuery, summaryQuery.params );

            // summary query error
            if ( !summary.ok ) return summary;

            summary = summary.data;

            // has total count of rows
            if ( "total" in summary ) {
                totalRows = summary.total;

                // no results
                if ( !totalRows ) {
                    return result( 200, null, {
                        "total_rows": 0,
                        "next_page": false,
                        summary,
                    } );
                }

                // do not perform main query if offset >= total rows
                else if ( offset && offset >= totalRows ) {
                    return result( 200, null, {
                        "total_rows": summary.total,
                        "next_page": false,
                        summary,
                    } );
                }
            }
        }

        // add 1 row to the limit if:
        // we don't know total number of rows
        // we don't request all results
        var addLimit = false;
        if ( totalRows == null && limit && !maxResultsLimit ) addLimit = true;

        // execute main query
        const fullQuery = query
            .ORDER_BY( orderBy )
            .OFFSET( offset )
            .LIMIT( addLimit
                ? limit + 1
                : limit );

        // cache query
        const preparedQuery = fullQuery.prepare();

        const res = await this.select( preparedQuery, fullQuery.params );

        if ( res.ok ) {
            if ( summary ) res.meta.summary = summary;

            // we know total number of the rows
            if ( totalRows != null ) {
                res.meta.total_rows = totalRows;
                res.meta.next_page = offset + res.meta.rows < totalRows;
            }

            // we added 1 row to the limit
            else if ( addLimit ) {

                // number of the returned rows > number of the requested rows
                if ( res.meta.rows > limit ) {
                    res.meta.next_page = true;

                    // decrement results
                    res.data.pop();
                    res.meta.rows--;
                }
                else {
                    res.meta.next_page = false;
                }
            }

            // we requested max. allowed number of the rows
            else {
                res.meta.next_page = false;
            }
        }

        return res;
    }

    // protected
    _getConnection () {
        return this;
    }

    _checkIdle () {

        // idle
        if ( !this.#isDestroyed && !this.isLocked && !this.#sth && !this.#queue.length ) this.emit( "idle", this );
    }

    // private
    #do ( resolve, query, params, options = {} ) {

        // dbh is already destroyed
        if ( this.#isDestroyed ) {
            resolve( result.exception( [ 500, "Database connection closed" ] ) );

            return;
        }

        if ( params && !Array.isArray( params ) ) {
            options = { ...params, ...options };

            params = options.params;
        }

        query = this.#prepareQuery( query, params, options.exec );

        var sth = {
            resolve,
            "id": query.id ?? "",
            "query": query.query,
            "types": query.types,
            options,
            "error": null,
            "columns": null,
            "data": [],
        };

        // use simple query if query has no params, query is not prepared, no maxRows defined
        const useSimpleQuery = !( query.params || sth.id || options.maxRows );

        // for simple query multiple queries in single statement are allowed
        if ( useSimpleQuery ) {
            messageBuffer.beginMsg( FRONTEND.QUERY ).write( sth.query ).writeNull().endMsg();
        }

        // extended query mode
        else {
            const portalId = ""; // uuid(), currently we use unnamed portals

            // query is prepared
            if ( sth.id ) {
                if ( !this.#prepared[ sth.id ] ) {
                    this.#prepared[ sth.id ] = {
                        "described": false,
                    };
                }
                else {
                    sth.parsed = true;
                }
            }

            // parse query
            if ( !sth.parsed ) {
                messageBuffer
                    .beginMsg( FRONTEND.PARSE )
                    .write( sth.id + "\0" + sth.query + "\0\0\0" )
                    .endMsg();
            }

            // bind, create portal
            messageBuffer
                .beginMsg( FRONTEND.BIND )
                .write( portalId + "\0" + sth.id + "\0" )
                .writeUInt16BE( 0 ) // params format text
                .writeUInt16BE( query.params?.length ?? 0 ); // params length

            // prepare params
            if ( query.params ) {
                for ( let param of query.params ) {

                    // null or undefined
                    if ( param == null ) {
                        messageBuffer.writeInt32BE( -1 );
                    }
                    else {
                        if ( typeof param !== "string" ) {

                            // number
                            if ( typeof param === "number" ) {
                                param = param.toString();
                            }

                            // boolean
                            else if ( typeof param === "boolean" ) {
                                param = param
                                    ? "t"
                                    : "f";
                            }

                            // bigint
                            else if ( typeof param === "bigint" ) {
                                param = param.toString();
                            }

                            // object
                            else if ( typeof param === "object" ) {

                                // buffer
                                if ( Buffer.isBuffer( param ) ) {
                                    param = encodeBuffer( param );
                                }

                                // date
                                else if ( param instanceof Date ) {
                                    param = encodeDate( param );
                                }

                                // numeric
                                else if ( Numeric.isNumeric( param ) ) {
                                    param = param.toString();
                                }

                                // object
                                else {
                                    param = JSON.stringify( param );
                                }
                            }

                            // error
                            else {
                                throw TypeError( `Unsupported SQL parameter type "${ param }"` );
                            }
                        }

                        messageBuffer.writeInt32BE( Buffer.byteLength( param ) ).write( param );
                    }
                }
            }

            // finish bind msg
            messageBuffer.writeNull( 2 ).endMsg();

            // request portal description
            if ( !sth.id || !this.#prepared[ sth.id ].described ) {
                messageBuffer
                    .beginMsg( FRONTEND.DESCRIBE )
                    .write( FRONTEND.DESCRIBE_PORTAL + portalId )
                    .writeNull()
                    .endMsg();
            }

            // execute
            messageBuffer
                .beginMsg( FRONTEND.EXECUTE )
                .write( portalId )
                .writeNull()
                .writeUInt32BE( options.maxRows || 0 )
                .endMsg();

            // close portal if maxRows was used
            if ( options.maxRows ) {
                messageBuffer
                    .beginMsg( FRONTEND.CLOSE )
                    .write( FRONTEND.CLOSE_PORTAL + portalId + "\0" )
                    .endMsg();
            }

            // flush
            messageBuffer.beginMsg( FRONTEND.FLUSH ).endMsg();

            // sync
            messageBuffer.beginMsg( FRONTEND.SYNC ).endMsg();
        }

        if ( !this.#sth ) {
            this.#sth = sth;
        }
        else {
            this.#queue.push( sth );
        }

        this.#send( messageBuffer.done() );
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
                "query": query.postgresqlQuery,
                params,
                "types": query.types,
            };
        }

        return sth;
    }

    // notifications
    get isConnected () {
        return this.#pool.isConnected;
    }

    async waitConnect ( signal ) {
        return this.#pool.waitConnect( signal );
    }

    on ( name, listener ) {
        return this.#on( name, listener, false );
    }

    once ( name, listener ) {
        return this.#on( name, listener, true );
    }

    #on ( name, listener, once ) {
        if ( name === "commit" || name === "rollback" ) {
            if ( !this.inTransaction ) throw new Error( `Unable to use "${ name }" event when transaction is not started` );

            return super.once( name, listener );
        }
        else if ( name === "unlock" ) {
            if ( !this.inTransaction ) throw new Error( `Unable to use "${ name }" event when dbh is not locked` );

            return super.once( name, listener );
        }
        else {
            if ( once ) {
                return super.once( name, listener );
            }
            else {
                return super.on( name, listener );
            }
        }
    }
}
