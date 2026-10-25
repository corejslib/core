import "#lib/result";
import "#lib/temporal";
import crypto from "node:crypto";
import net from "node:net";
import tls from "node:tls";
import Queue from "#lib/data-structures/queue";
import Events from "#lib/events";
import Numeric from "#lib/numeric";
import Sasl from "#lib/sasl";
import constants from "#lib/sql/constants";
import Dbh from "#lib/sql/dbh";
import { createOffsetLimit, sql } from "#lib/sql/query";
import { encodeBuffer } from "#lib/sql/types";
import Signal from "#lib/threads/signal";
import Uuid from "#lib/uuid";
import { READ_ONLY_SQL_TRANSACTION } from "./error-codes.js";
import LargeObject from "./large-object.js";
import MessageBuffer from "./message-buffer.js";

const PROTOCOL_VERSION = Buffer.from( [ 0x00, 0x03, 0x00, 0x02 ] ), // v3.2, PostgreSQL 18+, older servers downgrade the version via NegotiateProtocolVersion
    PROTOCOL_MINOR_VERSION = PROTOCOL_VERSION.readUInt16BE( 2 ),
    CANCEL_SECRET_MIN_LENGTH = 4, // protocol 3.0 secret key is always 4 bytes
    CANCEL_SECRET_MAX_LENGTH = 256, // protocol 3.2 secret key is variable length, 4..256 bytes
    MAX_PARAMS = 65_535,
    MAX_MESSAGE_SIZE = 1024 ** 3, // 1 GiB, default limit for a single backend message
    CANCEL_REQUEST_CODE = 80_877_102, // 1234 << 16 | 5678
    CANCEL_REQUEST_TIMEOUT = 5000; // ms

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
    "NEGOTIATE_PROTOCOL_VERSION": "v",
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

// authentication types (numbers) must not be mixed with message ids (strings)
const BACKEND_METHOD = Object.fromEntries( Object.keys( BACKEND )
    .filter( key => typeof BACKEND[ key ] === "string" )
    .map( key => [ BACKEND[ key ], "_ON_PG_" + key ] ) );

const TRANSACTION_STATE = {
    "I": false, // idle, not in transaction
    "T": true, // in transaction block
    "E": true, // in a failed transaction block (queries will be rejected until block is ended)
};

const LIFECYCLE_EVENTS = {
    "connect": "start",
    "disconnect": "stop",
    "destroy": "destroy",
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

const SQL = {
    "begin": sql`BEGIN`.prepare(),
    "commit": sql`COMMIT`.prepare(),
    "rollback": sql`ROLLBACK`.prepare(),
};

// internal query options, the symbols are not exported, so they can't be set by the user
const BEGIN_FLAG = Symbol( "begin" ), // allowed to start a transaction
    EXEC_FLAG = Symbol( "exec" ), // params are inlined to the query text
    IGNORE_DATA_FLAG = Symbol( "ignoreData" ), // the query must not return data
    MAX_ROWS_OPTION = Symbol( "maxRows" ); // limit of the rows, portal is used

// the option is set by the code outside of this module, so the symbol is exported
export const READ_ONLY_TEST_FLAG = Symbol( "readOnlyTest" ); // expected "read only transaction" error is not logged

// portable transaction isolation levels, translated to the PostgreSQL syntax
const ISOLATION_LEVELS = new Map( [
    [ "read uncommitted", "READ UNCOMMITTED" ],
    [ "read committed", "READ COMMITTED" ],
    [ "repeatable read", "REPEATABLE READ" ],
    [ "serializable", "SERIALIZABLE" ],
] );

// portable transaction options supported by the "begin" method
const BEGIN_OPTIONS = new Set( [ "isolationLevel", "readOnly" ] );

// creates the "BEGIN" query from the portable options, the user input is never concatenated to the query,
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

    const { isolationLevel, readOnly } = options,
        modes = [];

    if ( isolationLevel != null ) {
        const level = ISOLATION_LEVELS.get( isolationLevel );

        if ( !level ) {
            return { "error": result( [ 400, "Unsupported transaction isolation level" ] ) };
        }

        modes.push( `ISOLATION LEVEL ${ level }` );
    }

    if ( readOnly != null ) {
        if ( typeof readOnly !== "boolean" ) {
            return { "error": result( [ 400, `Transaction option "readOnly" must be a boolean` ] ) };
        }

        modes.push( readOnly
            ? "READ ONLY"
            : "READ WRITE" );
    }

    return {
        "query": modes.length
            ? `BEGIN ${ modes.join( ", " ) }`
            : SQL.begin,
    };
}

const messageBuffer = new MessageBuffer();

export default class DbhPostgreSqlConnection extends Dbh {
    #main;
    #unixSocket;
    #url;
    #connectionsManager;
    #lifecycleManager;
    #globalEvents;
    #isPrimary;
    #username;
    #database;

    #sessionParams = {};
    #pid;
    #secret;

    #events = new Events();
    #socket;
    #inChunks = [];
    #inLength = 0;
    #inNeeded = 0; // total size of the incomplete message, that is currently being received
    #outBuffer = [];
    #sasl;

    #sth;
    #queue = new Queue();
    #prepared = {};

    #transactionState = "I"; // in "idle" state by default
    #transactionDepth = 0; // number of active "begin" calls, 0 - top-level transaction is not started

    #largeObject = new LargeObject( this );

    #connectSignal;
    #locksCount = 0;
    #abortController = new AbortController();

    constructor ( main, { uri, connectionsManager, lifecycleManager, globalEvents, isPrimary } = {} ) {
        super();

        if ( uri.startsWith( "unix:" ) ) {
            this.#unixSocket = uri.slice( 5 );
        }
        else {
            this.#url = new URL( uri, "postgresql://local:5432/" );
        }

        this.#main = main;
        this.#connectionsManager = connectionsManager;
        this.#lifecycleManager = lifecycleManager;
        this.#globalEvents = globalEvents;
        this.#username = this.#main.username ?? "";
        this.#database = this.#main.database ?? "";
        this.#isPrimary = isPrimary;

        this.#lifecycleManager //
            .setOnStart( this.#start.bind( this ) )
            .setOnStop( this.#stop.bind( this ) )
            .setOnDestroyThreads( () => this.#dropQueue( result( [ 1006, "Connection destroyed" ] ) ) )
            .setOnIdle( () => this.#lifecycleManager.destroy() );

        this.#lifecycleManager.start();
    }

    // properties
    get isPostgreSql () {
        return true;
    }

    get url () {
        return this.#main.url;
    }

    get isPrimary () {
        return this.#isPrimary;
    }

    get schema () {
        return this.#main.schema;
    }

    get largeObjectReadSize () {
        return this.#main.largeObjectReadSize;
    }

    get largeObject () {
        return this.#largeObject;
    }

    get inTransaction () {
        return TRANSACTION_STATE[ this.#transactionState ];
    }

    get isConnected () {
        return this.#lifecycleManager.isStarted;
    }

    get isDestroyed () {
        return this.#lifecycleManager.isDestroyed;
    }

    get main () {
        return this.#main;
    }

    get isLocked () {
        return this.#locksCount > 0;
    }

    get isExclusive () {
        return this.#connectionsManager.isConnectionExclusive( this );
    }

    get abortSignal () {
        return this.#abortController.signal;
    }

    // public
    async destroy ( res ) {
        return this.#lifecycleManager.destroy();
    }

    async forceDestroy () {
        return this.#lifecycleManager.forceDestroy();
    }

    toString () {
        return this.url;
    }

    toJSON () {
        return this.url;
    }

    quote ( value ) {
        return this.#main.quote( value );
    }

    async exec ( query, params ) {
        return new Promise( resolve => {
            this.#do( resolve, query, params, {
                [ EXEC_FLAG ]: true,
                [ IGNORE_DATA_FLAG ]: true,
            } );
        } );
    }

    async do ( query, params ) {
        return new Promise( resolve => {
            this.#do( resolve, query, params, {
                [ IGNORE_DATA_FLAG ]: true,
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
                    if ( !res.ok ) {
                        resolve( res );

                        return;
                    }

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
                    [ MAX_ROWS_OPTION ]: 1,
                }
            );
        } );
    }

    async read ( query, { summaryQuery, orderBy, offset, limit, defaultLimit, maxLimit, maxResults } = {} ) {
        this.#lifecycleManager.beginThread();

        try {
            let maxResultsLimit;

            ( { offset, limit, maxResultsLimit } = createOffsetLimit( offset, limit, { defaultLimit, maxLimit, maxResults } ) );

            // nothing to fetch
            if ( limit === 0 ) return result( 200, null, { "next_page": false } );

            let summary, totalRows;

            // has summary query
            if ( summaryQuery ) {

                // cache query
                const preparedQuery = summaryQuery.prepare().decode( { "total": "int53" } );

                summary = await this.selectRow( preparedQuery, summaryQuery.params );

                // summary query error
                if ( !summary.ok ) return summary;

                summary = summary.data;

                // has total count of rows
                if ( summary && "total" in summary ) {
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
            let addLimit = false;
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
        finally {
            this.#lifecycleManager.endThread();
        }
    }

    async lock ( callback, { signal } = {} ) {
        if ( signal?.aborted ) return result( [ 500, "Aborted" ] );

        if ( !this.#locksCount ) {
            this.#lifecycleManager.beginThread();
        }

        this.#locksCount++;

        let res,
            unclosedTransaction = false;

        try {
            res = await callback( this, {
                signal,
            } );
        }
        finally {
            this.#locksCount--;

            if ( !this.#locksCount ) {
                this.#lifecycleManager.endThread();

                if ( this.inTransaction ) {
                    console.warn( "PostgreSql uncommitted transaction detected" );

                    unclosedTransaction = true;

                    this.#lifecycleManager.forceDestroy();
                }
            }
        }

        // the transaction is rolled back by destroying the connection, so the callback result can't be reported as successful
        if ( unclosedTransaction ) return result( [ 500, "PostgreSql uncommitted transaction detected, connection destroyed" ] );

        return res;
    }

    async lockExclusive ( callback, { signal } = {} ) {
        if ( !this.isExclusive ) return result( [ 500, "Unable to exclusively lock connection" ] );

        return this.lock( callback, {
            signal,
        } );
    }

    // mode: { isolationLevel: "read uncommitted" | "read committed" | "repeatable read" | "serializable", readOnly: boolean }
    async begin ( callback, { signal, mode } = {} ) {

        // validate options before the connection is locked
        const { error, "query": begin } = createBeginQuery( mode );
        if ( error ) return error;

        return this.lockExclusive(
            async dbh => {

                // the decision is made synchronously, using logical depth instead of the server state,
                // because previous "begin" can be still in the queue and "inTransaction" is not updated yet
                const savepointId = this.#transactionDepth
                    ? Uuid.v4()
                    : null;

                // transaction options can be set only for the top-level transaction, silently ignoring them is not safe
                if ( savepointId && begin !== SQL.begin ) {
                    return result( [ 400, "Transaction options can be set only for the top-level transaction" ] );
                }

                this.#transactionDepth++;

                let res,
                    commited,
                    depthReleased = false;

                // depth must be released as soon as the transaction is finished on the server,
                // before commit / rollback callbacks are called,
                // otherwise "begin" called from the callback will be treated as a nested one and will use SAVEPOINT outside of the transaction
                const releaseDepth = () => {
                    if ( depthReleased ) return;

                    depthReleased = true;

                    this.#transactionDepth--;
                };

                try {

                    // start transaction
                    res = await this.do( savepointId
                        ? `SAVEPOINT "${ savepointId }"`
                        : begin, { [ BEGIN_FLAG ]: true } );

                    // transaction started
                    if ( res.ok ) {
                        try {

                            // call transaction body
                            res = result.try( await callback( this ), {
                                "allowUndefined": true,
                            } );
                        }
                        catch ( e ) {
                            res = result.fromError( e );
                        }

                        // the callback has not failed, but the transaction is in the failed state (some query error was ignored),
                        // COMMIT in this state does not return an error, the server just silently rolls the transaction back
                        if ( res.ok && this.#transactionState === "E" ) {
                            res = result( [ 500, "Transaction is in the failed state and cannot be committed" ] );
                        }

                        // commit
                        if ( res.ok ) {
                            const commitRes = await this.do( savepointId
                                ? `RELEASE SAVEPOINT "${ savepointId }"`
                                : SQL.commit );

                            // commited
                            if ( commitRes.ok ) {
                                commited = true;
                            }

                            // commit failed
                            else {
                                res = commitRes;
                            }
                        }

                        // rollback
                        else {

                            // ROLLBACK TO SAVEPOINT does not remove the savepoint, so release it in the same simple query (single round trip)
                            await this.do( savepointId
                                ? `ROLLBACK TO SAVEPOINT "${ savepointId }"; RELEASE SAVEPOINT "${ savepointId }"`
                                : SQL.rollback );
                        }
                    }

                    // top-level transaction finished
                    if ( !savepointId ) {
                        releaseDepth();

                        // run callbacks
                        if ( commited ) {
                            this.#events.offAll( "rollback" );

                            await this.#events.runCallbacks( "commit" );
                        }
                        else {
                            this.#events.offAll( "commit" );

                            await this.#events.runCallbacks( "rollback" );
                        }
                    }

                    return res;
                }
                finally {
                    releaseDepth();
                }
            },
            {
                signal,
            }
        );
    }

    async cancelQuery () {
        const useTls = this.#main.protocol === "postgresql+tls:";

        let message, socket;

        try {
            message = messageBuffer.beginMsg( FRONTEND.CANCEL_REQUEST ).writeInt32( CANCEL_REQUEST_CODE ).writeInt32( this.#pid ).write( this.#secret ).endMsg().reset();

            socket = this.#createSocket();
        }
        catch ( e ) {
            messageBuffer.reset();

            return result.fromError( e, { "log": false } );
        }

        return new Promise( resolve => {
            let error;

            const timer = setTimeout( () => socket.destroy( new Error( "Cancel request timed out" ) ), CANCEL_REQUEST_TIMEOUT );

            socket.once( useTls
                ? "secureConnect"
                : "connect", () => socket.end( message ) );

            socket.once( "error", e => {
                error = e;
            } );

            socket.once( "close", () => {
                clearTimeout( timer );

                resolve( error
                    ? result.fromError( error, { "log": false } )
                    : result( 200 ) );
            } );

            // the server does not send anything, resume is required to detect the closed connection
            socket.resume();
        } );
    }

    async waitConnect ( { signal } = {} ) {
        return this.#lifecycleManager.waitStart( { signal } );
    }

    async waitDisconnect ( { signal } = {} ) {
        return this.#lifecycleManager.waitStop( { signal } );
    }

    on ( event, callback ) {
        if ( LIFECYCLE_EVENTS[ event ] ) {
            this.#lifecycleManager.on( LIFECYCLE_EVENTS[ event ], callback );
        }
        else if ( event === "commit" || event === "rollback" ) {
            if ( !this.inTransaction ) throw new Error( `Unable to use "${ event }" event when transaction is not started` );

            this.#events.once( event, callback );
        }
        else {
            this.#events.on( event, callback );
        }

        return this;
    }

    once ( event, callback ) {
        if ( LIFECYCLE_EVENTS[ event ] ) {
            this.#lifecycleManager.once( LIFECYCLE_EVENTS[ event ], callback );
        }
        else if ( event === "commit" || event === "rollback" ) {
            if ( !this.inTransaction ) throw new Error( `Unable to use "${ event }" event when transaction is not started` );

            this.#events.once( event, callback );
        }
        else {
            this.#events.once( event, callback );
        }

        return this;
    }

    off ( event, callback ) {
        if ( LIFECYCLE_EVENTS[ event ] ) {
            this.#lifecycleManager.off( LIFECYCLE_EVENTS[ event ], callback );
        }
        else {
            this.#events.off( event, callback );
        }

        return this;
    }

    // protected
    async _ON_PG_AUTHENTICATION ( data ) {
        try {
            const type = data.readUInt32BE();

            AUTHENTICATE: {
                if ( type === BACKEND.AUTHENTICATION_OK ) {

                    // auth is ok
                }
                else if ( type === BACKEND.AUTHENTICATION_CLEARTEXT_PASSWORD ) {
                    this.#socket.write( messageBuffer
                        .beginMsg( FRONTEND.PASSWORD_MESSAGE )
                        .write( this.#main.password ?? "" )
                        .writeNull()
                        .endMsg()
                        .reset() );
                }
                else if ( type === BACKEND.AUTHENTICATION_MD5_PASSWORD ) {
                    const pwdhash = crypto
                        .createHash( "MD5" )
                        .update( ( this.#main.password ?? "" ) + this.#username, "utf8" )
                        .digest( "hex" );

                    const hash =
                        "md5" +
                        crypto
                            .createHash( "MD5" )
                            .update( pwdhash + data.subarray( 4 ).toString( "latin1" ), "latin1" )
                            .digest( "hex" );

                    this.#socket.write( messageBuffer.beginMsg( FRONTEND.PASSWORD_MESSAGE ).write( hash ).writeNull().endMsg().reset() );
                }
                else if ( type === BACKEND.AUTHENTICATION_SASL ) {
                    const mechanisms = data.subarray( 4 ).toString().split( "\0" );

                    this.#sasl = await Sasl.new( mechanisms, this.#username, this.#main.password );

                    if ( !this.#sasl ) break AUTHENTICATE;

                    const response = this.#sasl.continue();

                    // SASLInitialResponse
                    this.#socket.write( messageBuffer.beginMsg( FRONTEND.SASL_RESPONSE ).write( this.#sasl.type ).writeNull().writeUint32( response.length ).write( response ).endMsg().reset() );
                }
                else if ( type === BACKEND.AUTHENTICATION_SASL_CONTINUE ) {
                    const response = this.#sasl.continue( data.subarray( 4 ).toString() );

                    if ( !response ) break AUTHENTICATE;

                    // SASLResponse
                    this.#socket.write( messageBuffer.beginMsg( FRONTEND.SASL_RESPONSE ).write( response ).endMsg().reset() );
                }
                else if ( type === BACKEND.AUTHENTICATION_SASL_FINAL ) {
                    const ok = this.#sasl.continue( data.subarray( 4 ).toString() );

                    this.#sasl = null;

                    if ( !ok ) break AUTHENTICATE;
                }
                else {
                    break AUTHENTICATE;
                }

                return;
            }

            this.#socket.destroy( result( [ 500, "Unsupported authentication method" ] ) );
        }
        catch ( e ) {
            this.#socket?.destroy( result.fromError( e, { "log": false } ) );
        }
    }

    // the server supports a lower minor protocol version than requested, the connection continues using that version,
    // protocol options are not used, so the list of rejected options (if any) is ignored
    _ON_PG_NEGOTIATE_PROTOCOL_VERSION ( data ) {
        const minorVersion = data.readUInt32BE();

        if ( minorVersion > PROTOCOL_MINOR_VERSION ) {
            throw new RangeError( `Unsupported negotiated PostgreSQL protocol version 3.${ minorVersion }` );
        }
    }

    _ON_PG_PARAMETER_STATUS ( data ) {
        const [ key, val ] = data.toString().split( "\0", 2 );

        this.#sessionParams[ key ] = val;
    }

    _ON_PG_BACKEND_KEY_DATA ( data ) {
        const secret = data.subarray( 4 );

        if ( secret.length < CANCEL_SECRET_MIN_LENGTH || secret.length > CANCEL_SECRET_MAX_LENGTH ) {
            throw new RangeError( `Invalid PostgreSQL cancel secret key length ${ secret.length }` );
        }

        this.#pid = data.readUInt32BE();

        // copy, the secret lives as long as the connection and must not hold the socket chunk
        this.#secret = Buffer.from( secret );
    }

    _ON_PG_READY_FOR_QUERY ( data ) {
        const wasInTransaction = this.inTransaction;

        this.#transactionState = data.toString();

        // dbh is connected
        if ( this.#connectSignal ) {
            this.#connectSignal.broadcast( result( 200 ) );
        }

        // query is finished
        else {

            // transaction was started not by the "begin" method, the queue could be dropped, then there is no statement for the message
            if ( this.#sth && !wasInTransaction && this.inTransaction && !this.#sth.options[ BEGIN_FLAG ] ) {
                console.warn( "PostgreSql transaction must be started using the `begin` method" );

                this.#lifecycleManager.forceDestroy();

                return;
            }

            this.#finishSth();
        }
    }

    _ON_PG_ERROR_RESPONSE ( data ) {
        const error = {};

        // parse error message
        for ( const field of data.toString().split( "\0" ) ) {
            if ( !field ) continue;

            error[ ERROR_RESPONSE_TYPE[ field.charAt( 0 ) ] ] = field.slice( 1 );
        }

        // error during connection
        if ( this.#connectSignal ) {
            this.#socket.destroy( result( [ 500, error.message ] ) );
        }

        // query error
        else if ( this.#sth ) {
            this.#sth.error = error;
        }

        // unknown error
        else {
            this.#socket.destroy( result( [ 500, error.message ] ) );
        }
    }

    _ON_PG_EMPTY_QUERY_RESPONSE ( data ) {

        // identifies the message as a response to an empty query string. (This substitutes for CommandComplete.)
        this._ON_PG_COMMAND_COMPLETE( data );
    }

    _ON_PG_ROW_DESCRIPTION ( data ) {

        // the queue was dropped, there is no statement for the message
        if ( !this.#sth ) return;

        const types = this.#sth.types,
            numOfCols = data.readInt16BE(),
            columns = [];

        let decoder,
            pos = 2;

        for ( let n = 0; n < numOfCols; n++ ) {
            let idx = data.indexOf( "\0", pos );

            const column = [

                //
                data.toString( "utf8", pos, idx ), // 0, column name
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
                    decoder = this.#main.decode[ decoder ];

                    if ( !decoder ) this.#sth.error = new Error( `Invalid decode type for column "${ column[ 0 ] }"` );
                }
            }

            // get decoder by type oid (or base type for domains)
            else {
                decoder = this.#main.decode[ column[ 3 ] ];
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

        // ignore data (or the queue was dropped and there is no statement for the message)
        if ( !this.#sth || this.#sth.options[ IGNORE_DATA_FLAG ] ) return;

        const numOfCols = data.readUInt16BE(),
            columns = this.#sth.id
                ? this.#prepared[ this.#sth.id ].columns
                : this.#sth.columns,
            row = {};

        let pos = 2;

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

        // the queue was dropped, there is no statement for the message
        if ( !this.#sth ) return;

        const rowsTag = data.toString( "latin1", 0, data.length - 1 );

        const rows = rowsTag.match( /\s(\d+)$/v );

        if ( rows ) this.#sth.rows = +rows[ 1 ];
    }

    _ON_PG_PARSE_COMPLETE ( data ) {
        if ( this.#sth ) this.#sth.parseComplete = true;
    }

    _ON_PG_BIND_COMPLETE ( data ) {}

    _ON_PG_CLOSE_COMPLETE ( data ) {}

    _ON_PG_PORTAL_SUSPENDED ( data ) {}

    _ON_PG_NOTICE_RESPONSE ( data ) {
        const error = {};

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

        const [ name, payload ] = data.subarray( 4 ).toString().split( "\0", 2 );

        // reserved event
        if ( constants.reservedEvents.has( name ) ) {
            if ( this.#main.schema.isLoaded ) console.warn( `PostgreSQL event name "${ name }" is reserved` );

            return;
        }

        // unknown event
        if ( this.#main.schema.isLoaded && !this.#main.schema.isEventValid( name ) ) {
            console.warn( `PostgreSQL event name "${ name }" is unknown` );

            return;
        }

        // no listeners, ignore event
        if ( !this.#globalEvents.hasListeners( name ) ) return;

        // no payload
        if ( !payload ) {
            this.#globalEvents.emitRemote( name );
        }

        // has payload
        else {
            let decodedPayload;

            // decode payload
            try {
                decodedPayload = JSON.parse( payload );
            }
            catch {

                // invalid payload
                console.warn( `Unable to decode JSON notification payload for event: "${ name }":\n${ payload }` );

                return;
            }

            this.#globalEvents.emitRemote( name, decodedPayload );
        }
    }

    // private
    #createSocket () {
        const useTls = this.#main.protocol === "postgresql+tls:";

        let socket = this.#unixSocket
            ? net.connect( this.#unixSocket )
            : net.connect( this.#url.port || 5432, this.#url.hostname );

        // upgrade socket
        if ( useTls ) {
            try {
                socket = tls.connect( {
                    "socket": socket,
                    "servername": this.#isPrimary
                        ? this.#main.hostname
                        : this.#main.standbyHostname,
                    "rejectUnauthorized": this.#main.checkCertificate,

                    // required for the direct TLS connection to PostgreSQL 17+, ignored by the proxies, that do not use ALPN
                    "ALPNProtocols": [ "postgresql" ],
                } );
            }
            catch ( e ) {
                socket.destroy();

                throw e;
            }
        }

        return socket;
    }

    async #start () {
        const useTls = this.#main.protocol === "postgresql+tls:";

        try {
            this.#socket = this.#createSocket();

            this.#socket.setKeepAlive( true, 60_000 );

            this.#connectSignal = new Signal();

            this.#socket.once( useTls
                ? "secureConnect"
                : "connect", () => this.#sendStartupMessage() );

            this.#socket.once( "error", e => this.#onDisconnect( e ) );

            this.#socket.once( "close", hasError => this.#onDisconnect() );

            this.#socket.on( "data", this.#onData.bind( this ) );
        }
        catch ( e ) {
            const res = result.fromError( e, { "log": false } );

            // socket was not created or configured, "#onDisconnect" will not be called, so cleanup here
            const socket = this.#socket;

            this.#socket = null;
            this.#connectSignal = null;
            this.#outBuffer = [];

            socket?.destroy();

            this.#dropQueue( res );

            if ( this.#lifecycleManager.canBeginThread ) {
                this.#lifecycleManager.destroy();
            }

            return res;
        }

        let res = await this.#connectSignal.wait();
        res = result.fromError( res, { "log": false } );

        this.#connectSignal = null;

        if ( res.ok ) setTimeout( () => this.#sendQueue(), 1 );

        return res;
    }

    async #stop () {
        const socket = this.#socket;

        // already disconnected
        if ( !socket ) return result( 200 );

        return new Promise( resolve => {
            socket.once( "close", () => resolve( result( 200 ) ) );

            socket.destroy();
        } );
    }

    #onDisconnect ( e ) {
        if ( !this.#socket ) return;
        this.#socket = null;

        const res = e
            ? result.fromError( e, { "log": false } )
            : result( [ 500, "Disconnected" ] );

        if ( this.#connectSignal ) {
            this.#connectSignal.broadcast( res );
        }

        // connection failed or was lost unexpectedly, it is not reused, so destroy it;
        // if the manager is already stopping or destroying (socket was closed by "#stop"), do nothing
        if ( this.#lifecycleManager.canBeginThread ) {
            this.#lifecycleManager.destroy();
        }

        // clear buffers
        this.#inChunks = [];
        this.#inLength = 0;
        this.#inNeeded = 0;
        this.#outBuffer = [];
        this.#prepared = {};
        this.#transactionState = "I";

        this.#abortController.abort();
        this.#abortController = new AbortController();

        this.#dropQueue( res );
    }

    #sendStartupMessage () {
        const params = {
            "user": this.#username,
            "database": this.#database,
            "options": "--client-min-messages=warning",
            "replication": "false",
            "application_name": this.#main.appName,

            // session run-time params
            "client_encoding": "utf8",
            "bytea_output": "hex",
            "backslash_quote": "off",
            "standard_conforming_strings": "on",
        };

        messageBuffer.beginMsg( FRONTEND.STARTUP_MESSAGE ).write( PROTOCOL_VERSION );

        Object.keys( params ).forEach( param => messageBuffer.write( param + "\0" + params[ param ] + "\0" ) );

        this.#socket.write( messageBuffer.writeNull().endMsg().reset() );
    }

    #send ( buffer ) {

        // always go through the out buffer to keep messages order
        this.#outBuffer.push( buffer );

        if ( this.isConnected ) {
            this.#sendQueue();
        }
    }

    #sendQueue () {

        // nothing to send
        if ( !this.#outBuffer.length || !this.#socket ) return;

        const buffer = this.#outBuffer.length === 1
            ? this.#outBuffer[ 0 ]
            : Buffer.concat( this.#outBuffer );

        this.#outBuffer = [];

        this.#socket.write( buffer );
    }

    #dropQueue ( res ) {

        // create result
        if ( !res ) {
            res = result.exception( [ 500, "Database connection closed" ] );
        }
        else {
            res = result.exception( res );
        }

        // cleanup queue
        const queue = this.#queue;
        this.#queue = new Queue();

        // finish current sth
        this.#finishSth( res );

        // finish all pending sth
        for ( const sth of queue ) {
            this.#lifecycleManager.endThread();

            sth.resolve( res );
        }
    }

    #finishSth ( res ) {
        const sth = this.#sth;
        if ( !sth ) return;

        this.#sth = this.#queue.shift();

        // compose result
        try {
            if ( !res ) {
                if ( sth.error ) {

                    // prepared statement was not created on the server, forget it
                    if ( sth.id && !sth.parsed && !sth.parseComplete ) delete this.#prepared[ sth.id ];

                    res = this._onQueryError( sth.error, sth.query, {
                        "meta": sth.error,
                        "silent": sth.options?.[ READ_ONLY_TEST_FLAG ] && sth.error?.code === READ_ONLY_SQL_TRANSACTION,
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
                    if ( sth.options[ IGNORE_DATA_FLAG ] ) {

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

                        if ( sth.rows !== undefined ) res.meta.rows = sth.rows;
                    }
                }
            }
        }
        catch ( e ) {
            res = result.fromError( e );
        }

        this.#lifecycleManager.endThread();

        sth.resolve( res );
    }

    #onData ( data ) {
        this.#inChunks.push( data );
        this.#inLength += data.length;

        // the current message is not received completely yet, do not copy anything
        if ( this.#inLength < this.#inNeeded ) return;

        let buffer = this.#inChunks.length === 1
            ? this.#inChunks[ 0 ]
            : Buffer.concat( this.#inChunks, this.#inLength );

        this.#inChunks = [];
        this.#inLength = 0;
        this.#inNeeded = 0;

        const maxMessageSize = this.#main.maxMessageSize ?? MAX_MESSAGE_SIZE;

        try {
            while ( buffer.length > 4 ) {
                const length = buffer.readUInt32BE( 1 );

                // invalid or too large message
                if ( length < 4 || length + 1 > maxMessageSize ) {
                    buffer = null;

                    this.#socket.destroy( result( [ 500, `PostgreSQL message size ${ length } is invalid or exceeds the limit of ${ maxMessageSize } bytes` ] ) );

                    return;
                }

                // message is incomplete
                if ( buffer.length < length + 1 ) {
                    this.#inNeeded = length + 1;

                    break;
                }

                const msgId = buffer.toString( "latin1", 0, 1 ),
                    body = buffer.subarray( 5, length + 1 );

                buffer = buffer.subarray( length + 1 );

                const method = this[ BACKEND_METHOD[ msgId ] ];

                if ( !method ) {
                    buffer = null;

                    this.#socket.destroy( result( [ 500, `Unhandled PostgreSQL message "${ msgId }"` ] ) );

                    return;
                }

                method.call( this, body );
            }
        }
        catch ( e ) {

            // the protocol state is unknown, drop the rest of the data and close the connection
            buffer = null;

            this.#socket?.destroy( result.fromError( e ) );
        }
        finally {

            // store unprocessed tail
            if ( buffer?.length ) {
                this.#inChunks.push( buffer );
                this.#inLength = buffer.length;
            }
            else {
                this.#inNeeded = 0;
            }
        }
    }

    #do ( resolve, query, params, options = {} ) {

        // dbh is destroyed or destroying
        if ( !this.#lifecycleManager.canBeginThread ) {
            resolve( result.exception( [ 500, "Database connection closed" ] ) );

            return;
        }

        if ( params && !Array.isArray( params ) ) {
            options = { ...params, ...options };

            params = options.params;
        }

        try {
            query = this.#prepareQuery( query, params, options[ EXEC_FLAG ] );

            // encode params before message is started, to not leave the shared message buffer in inconsistent state
            if ( query.params ) query.params = query.params.map( param => this.#encodeParam( param ) );
        }
        catch ( e ) {
            resolve( result.fromError( e ) );

            return;
        }

        const sth = {
            resolve,
            "id": query.id ?? "",
            "query": query.query,
            "types": query.types,
            options,
            "error": null,
            "columns": null,
            "data": [],
        };

        try {

            // use simple query if query has no params, query is not prepared, no max rows defined
            const useSimpleQuery = !query.params && !sth.id && !options[ MAX_ROWS_OPTION ];

            // for simple query multiple queries in single statement are allowed
            if ( useSimpleQuery ) {
                messageBuffer.beginMsg( FRONTEND.QUERY ).write( sth.query ).writeNull().endMsg();
            }

            // extended query mode
            else {
                const portalId = ""; // Uuid.v4(), currently we use unnamed portals

                // query is prepared
                if ( sth.id ) {
                    if ( !this.#prepared[ sth.id ] ) {
                        this.#prepared[ sth.id ] = {
                            "described": false,
                        };

                        sth.prepareCreated = true;
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
                    .writeUint16( 0 ) // params format text
                    .writeUint16( query.params?.length ?? 0 ); // params length

                // prepare params
                if ( query.params ) {
                    for ( const param of query.params ) {

                        // null or undefined
                        if ( param == null ) {
                            messageBuffer.writeInt32( -1 );
                        }
                        else {
                            messageBuffer.writeInt32( Buffer.byteLength( param ) ).write( param );
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
                    .writeUint32( options[ MAX_ROWS_OPTION ] || 0 )
                    .endMsg();

                // close portal if max rows was used
                if ( options[ MAX_ROWS_OPTION ] ) {
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
        }
        catch ( e ) {

            // message was not sent, drop partially written message and prepared statement registration
            messageBuffer.reset();

            if ( sth.prepareCreated ) delete this.#prepared[ sth.id ];

            resolve( result.fromError( e ) );

            return;
        }

        // from this point the sth is finished by "#finishSth" or "#dropQueue", each of them calls "endThread"
        this.#lifecycleManager.beginThread();

        if ( !this.#sth ) {
            this.#sth = sth;
        }
        else {
            this.#queue.push( sth );
        }

        this.#send( messageBuffer.reset() );
    }

    #encodeParam ( param ) {

        // null or undefined
        if ( param == null ) return null;

        // string
        if ( typeof param === "string" ) return param;

        // number, bigint
        if ( typeof param === "number" || typeof param === "bigint" ) return param.toString();

        // boolean
        if ( typeof param === "boolean" ) {
            return param
                ? "t"
                : "f";
        }

        if ( typeof param === "object" ) {

            // View
            if ( ArrayBuffer.isView( param ) ) {
                if ( !Buffer.isBuffer( param ) ) {
                    param = Buffer.from( param.buffer, param.byteOffset, param.byteLength );
                }

                return encodeBuffer( param );
            }

            // ArrayBuffer
            if ( param instanceof ArrayBuffer ) return encodeBuffer( Buffer.from( param ) );

            // Date
            if ( param instanceof Date ) return param.toISOString();

            // Temporal.Instant
            if ( param instanceof Temporal.Instant ) return param.toString();

            // Temporal.ZonedDateTime
            if ( param instanceof Temporal.ZonedDateTime ) return param.toInstant().toString();

            // Temporal.PlainDate, Temporal.PlainDateTime, Temporal.PlainTime, Temporal.Duration (ISO 8601 strings, supported by PostgreSQL)
            if ( param instanceof Temporal.PlainDate || param instanceof Temporal.PlainDateTime || param instanceof Temporal.PlainTime || param instanceof Temporal.Duration ) {
                return param.toString();
            }

            // Numeric
            if ( Numeric.isNumeric( param ) ) return param.toString();

            // object
            return JSON.stringify( param );
        }

        throw new TypeError( `Unsupported SQL parameter type "${ typeof param }"` );
    }

    #prepareQuery ( query, params, toString ) {
        let sth;

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
}
