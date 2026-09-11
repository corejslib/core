import GlobPatterns from "#lib/glob/patterns";
import { isPlainObject, objectPick } from "#lib/utils";
import Uuid from "#lib/uuid";
import { encodeArray } from "./types.js";

const CACHE = {},
    PLACEHOLDER = "?",
    QUERY_ACCESSOR = Symbol(),
    SET_CACHED_QUERY = Symbol(),
    ORDER_BY_DIRECTION = {
        "asc": "ASC",
        "desc": "DESC",
    },
    CONDITION_OPERATORS = {
        "<": {
            "sql": "<",
        },
        "<=": {
            "sql": "<=",
        },
        "=": {
            "sql": "=",
        },
        ">=": {
            "sql": ">=",
        },
        ">": {
            "sql": ">",
        },
        "!=": {
            "sql": "!=",
        },

        // like
        "like": {
            "sql": "LIKE",
            "isLike": true,
        },
        "not like": {
            "sql": "NOT LIKE",
            "isLike": true,
        },
        "ilike": {
            "sql": "ILIKE",
            "isLike": true,
        },
        "not ilike": {
            "sql": "NOT ILIKE",
            "isLike": true,
        },

        // includes
        "includes": {
            "sql": "LIKE",
            "isIncludes": true,
        },
        "not includes": {
            "sql": "NOT LIKE",
            "isIncludes": true,
        },
        "includes case insensitive": {
            "sql": "ILIKE",
            "isIncludes": true,
        },
        "not includes case insensitive": {
            "sql": "NOT ILIKE",
            "isIncludes": true,
        },

        // starts with
        "starts with": {
            "sql": "LIKE",
            "isStartsWith": true,
        },
        "not starts with": {
            "sql": "NOT LIKE",
            "isStartsWith": true,
        },
        "starts with case insensitive": {
            "sql": "ILIKE",
            "isStartsWith": true,
        },
        "not starts with case insensitive": {
            "sql": "NOT ILIKE",
            "isStartsWith": true,
        },

        // ends with
        "ends with": {
            "sql": "LIKE",
            "isEndsWith": true,
        },
        "not ends with": {
            "sql": "NOT LIKE",
            "isEndsWith": true,
        },
        "ends with case insensitive": {
            "sql": "ILIKE",
            "isEndsWith": true,
        },
        "not ends with case insensitive": {
            "sql": "NOT ILIKE",
            "isEndsWith": true,
        },

        // glob
        "glob": {
            "isGlob": true,
            "allowed": "~",
            "denied": "!~",
        },
        "glob case insensitive": {
            "isGlob": true,
            "allowed": "~*",
            "denied": "!~*",
        },

        // in
        "in": {
            "sql": "IN",
            "isIn": true,
        },
        "not in": {
            "sql": "NOT IN",
            "isIn": true,
        },

        // regular expressions
        "~": {
            "sql": "~",
        },
        "~*": {
            "sql": "~*",
        },
        "!~": {
            "sql": "!~",
        },
        "!~*": {
            "sql": "!~*",
        },
    };

export function createOffsetLimit ( offset, limit, { maxResults, defaultLimit, maxLimit } = {} ) {
    if ( offset ) {
        if ( typeof offset !== "number" || offset < 0 ) throw new RangeError( `SQL offset value "${ offset }" is invalid` );
    }
    else {
        offset ||= 0;
    }

    if ( limit == null ) {
        limit = defaultLimit || maxLimit || null;
    }
    else if ( typeof limit !== "number" || limit < 0 ) {
        throw new TypeError( `SQL limit value "${ limit }" is invalid` );
    }
    else if ( maxLimit && limit > maxLimit ) {
        limit = maxLimit;
    }

    var maxResultsLimit;

    // apply max results
    if ( maxResults && limit !== 0 ) {

        // offset is too large
        if ( offset && offset >= maxResults ) {
            limit = 0;
            maxResultsLimit = true;
        }

        // all rows requested
        else if ( limit == null ) {
            limit = maxResults - offset;
            maxResultsLimit = true;
        }
        else {
            const requestedResults = offset + limit;

            if ( requestedResults > maxResults ) {
                limit = limit - ( requestedResults - maxResults );
            }

            maxResultsLimit = requestedResults >= maxResults;
        }
    }

    return { offset, limit, maxResultsLimit };
}

export function quoteLikePattern ( pattern ) {
    return pattern.replaceAll( "\\", "\\\\" ).replaceAll( "_", "\\_" ).replaceAll( "%", "\\%" );
}

// DOCS: https://www.postgresql.org/docs/current/static/sql-syntax-lexical.html
function quoteId ( id ) {
    return id
        .replaceAll( '"', "" )
        .split( "." )
        .map( item => `"${ item }"` )
        .join( "." );
}

function parseConditions ( args ) {
    const buf = [],
        params = [];

    // called as sql`...`
    if ( Array.isArray( args[ 0 ] ) ) {
        args = [ sql( args.shift(), ...args ) ];
    }

    for ( const arg of args ) {

        // skip null
        if ( arg == null ) {
            continue;
        }

        // query
        if ( arg instanceof Sql ) {
            if ( arg.query ) {
                buf.push( arg.query );

                params.push( ...arg.params );
            }
        }

        // string
        else if ( typeof arg === "string" ) {

            // trim
            const sql = arg.trim();

            if ( sql !== "" ) buf.push( sql );
        }

        // conditions obect
        else if ( typeof arg === "object" ) {
            const conditions = [];

            for ( const field in arg ) {
                let condition = quoteId( field ) + " ",
                    operator,
                    value,
                    options;

                if ( Array.isArray( arg[ field ] ) ) {
                    [ operator, value, options ] = arg[ field ];
                }
                else {
                    operator = "=";
                    value = arg[ field ];
                }

                // validate operator
                operator = CONDITION_OPERATORS[ ( operator + "" ).toLowerCase() ];

                if ( !operator ) throw new Error( "SQL condition operator is invalid" );

                // value is array
                if ( Array.isArray( value ) ) {
                    if ( operator.sql === "=" ) {
                        operator = CONDITION_OPERATORS[ "in" ];
                    }
                    else if ( operator.sql === "!=" ) {
                        operator = CONDITION_OPERATORS[ "not in" ];
                    }
                    else if ( !operator.isIn && !operator.isGlob ) {
                        throw new Error( "SQL condition operator is invalid" );
                    }
                }

                // value is null
                if ( value == null ) {
                    if ( operator.sql === "=" ) {
                        condition += "IS NULL";
                    }
                    else if ( operator.sql === "!=" ) {
                        condition += "IS NOT NULL";
                    }
                    else {
                        throw new Error( "SQL condition operator is invalid" );
                    }
                }

                // value is query
                else if ( value instanceof Sql ) {
                    if ( value.query ) {
                        condition += operator.sql + " ( " + value.query + " )";
                        params.push( ...value.params );
                    }
                }

                // like
                else if ( operator.isLike ) {
                    condition += operator.sql + " " + PLACEHOLDER + " ESCAPE '\\'";
                    params.push( value );
                }

                // includes
                else if ( operator.isIncludes ) {
                    condition += operator.sql + " " + PLACEHOLDER + " ESCAPE '\\'";
                    params.push( "%" + quoteLikePattern( value ) + "%" );
                }

                // starts with
                else if ( operator.isStartsWith ) {
                    condition += operator.sql + " " + PLACEHOLDER + " ESCAPE '\\'";
                    params.push( quoteLikePattern( value ) + "%" );
                }

                // ends with
                else if ( operator.isEndsWith ) {
                    condition += operator.sql + " " + PLACEHOLDER + " ESCAPE '\\'";
                    params.push( "%" + quoteLikePattern( value ) );
                }

                // glob
                else if ( operator.isGlob ) {
                    const patterns = new GlobPatterns().add( value, {
                        "prefix": options?.prefix,
                    } );

                    // deny all
                    if ( patterns.deniesAll ) {
                        condition = "FALSE";
                    }

                    // has no allowed patters
                    else if ( !patterns.hasAllowedPatterns ) {
                        condition = "FALSE";
                    }

                    // has allowed patterns
                    else {
                        const id = quoteId( field );

                        condition = "( ";

                        // allow all
                        if ( patterns.allowsAll ) {
                            condition += `${ id } IS NOT NULL`;
                        }

                        // test allowed patterns
                        else {
                            condition += `${ id } ${ operator.allowed } ${ PLACEHOLDER }`;

                            params.push( patterns.allowedRegexp.source );
                        }

                        // test denied patterns
                        if ( patterns.hasDeniedPatterns ) {
                            condition += ` AND ${ id } ${ operator.denied } ${ PLACEHOLDER }`;

                            params.push( patterns.deniedRegexp.source );
                        }

                        condition += " )";
                    }
                }

                // in
                else if ( operator.isIn ) {
                    const values = value,
                        sql = [];

                    if ( !Array.isArray( values ) ) throw new TypeError( "SQL condition operator is invalid" );

                    for ( const value of values ) {
                        if ( value instanceof Sql ) {
                            if ( value.query ) {
                                sql.push( "( " + value.query + " )" );
                                params.push( ...value.params );
                            }
                        }
                        else {
                            sql.push( PLACEHOLDER );
                            params.push( value );
                        }
                    }

                    condition += operator.sql + " ( " + sql.join( ", " ) + " )";
                }
                else {
                    condition += operator.sql + " " + PLACEHOLDER;
                    params.push( value );
                }

                conditions.push( condition );
            }

            if ( conditions.length ) {
                buf.push( conditions.join( " AND " ) );
            }
        }
        else {
            throw new TypeError( `SQL "${ arg }" is invalid` );
        }
    }

    if ( buf.length ) {
        return [ buf.join( " " ), params ];
    }
}

export class Sql {
    #query;
    #postgresqlQuery;
    #sqliteQuery;

    constructor ( query ) {
        this.#query = query || "";
    }

    // properties
    get id () {
        return null;
    }

    get query () {
        return this.#query;
    }

    get postgresqlQuery () {
        if ( !this.#postgresqlQuery ) {
            let n = 0;

            this.#postgresqlQuery = this.#query.replaceAll( "?", () => "$" + ++n );
        }

        return this.#postgresqlQuery;
    }

    get sqliteQuery () {

        // in sqlite LIKE operator is case-insensitive by default (PRAGMA case_sensitive_like = true)
        this.#sqliteQuery ??= this.#query.replaceAll( " ILIKE ", " LIKE " );

        return this.#sqliteQuery;
    }

    // public
    toString () {
        return this.#query;
    }

    quoteId ( id ) {
        return quoteId( id );
    }

    // private
    get [ QUERY_ACCESSOR ] () {
        return this.#query;
    }

    set [ QUERY_ACCESSOR ] ( value ) {
        if ( this.id ) throw new Error( "Prepared query can't be modified" );

        this.#query = value || "";

        this.#postgresqlQuery = null;
        this.#sqliteQuery = null;
    }
}

export class SqlWhere extends Sql {
    #params = [];

    constructor ( conditions ) {
        super();

        const query = parseConditions( conditions );

        if ( query ) [ this[ QUERY_ACCESSOR ], this.#params ] = query;
    }

    // properties
    get params () {
        return this.#params;
    }

    // public
    and ( ...args ) {
        const query = new this.constructor( args );

        if ( query.query ) {
            if ( this[ QUERY_ACCESSOR ] ) {
                this[ QUERY_ACCESSOR ] = "(" + this[ QUERY_ACCESSOR ] + ") AND (" + query.query + ")";
            }
            else {
                this[ QUERY_ACCESSOR ] = query.query;
            }

            this.#params.push( ...query.params );
        }

        return this;
    }

    or ( ...args ) {
        const query = new this.constructor( args );

        if ( query.query ) {
            if ( this[ QUERY_ACCESSOR ] ) {
                this[ QUERY_ACCESSOR ] = "(" + this[ QUERY_ACCESSOR ] + ") OR (" + query.query + ")";
            }
            else {
                this[ QUERY_ACCESSOR ] = query.query;
            }

            this.#params.push( ...query.params );
        }

        return this;
    }
}

export class SqlQuery extends Sql {
    #id;
    #cachedQuery;
    #readOnly;
    #decoders;
    #params = [];

    // properties
    get query () {
        if ( this.#cachedQuery ) {
            return this.#cachedQuery.query;
        }
        else {
            return super.query;
        }
    }

    get postgresqlQuery () {
        if ( this.#cachedQuery ) {
            return this.#cachedQuery.postgresqlQuery;
        }
        else {
            return super.postgresqlQuery;
        }
    }

    get sqliteQuery () {
        if ( this.#cachedQuery ) {
            return this.#cachedQuery.sqliteQuery;
        }
        else {
            return super.sqliteQuery;
        }
    }

    get id () {
        return this.#id || this.#cachedQuery?.id;
    }

    get isReadOnly () {
        if ( this.#cachedQuery ) {
            return this.#cachedQuery.isReadOnly;
        }
        else {
            return this.#readOnly;
        }
    }

    get types () {
        return this.#decoders;
    }

    get params () {
        return this.#params;
    }

    // public
    prepare () {

        // already cached
        if ( this.id ) return this;

        var cachedQuery = CACHE[ this.query ];

        if ( cachedQuery ) {
            this.#cachedQuery = cachedQuery;
        }
        else if ( this.#decoders || this.#params.length ) {

            // clone and cache query
            cachedQuery = new SqlQuery( this.query ).prepare().readOnly( this.readOnly );

            this[ QUERY_ACCESSOR ] = "";

            this.#cachedQuery = cachedQuery;
        }
        else {
            this.#id = Uuid.v4();

            CACHE[ this.query ] = this;
        }

        return this;
    }

    // column_name: type_name || function
    decode ( decoders ) {

        // cached query
        if ( this.id && !this.#cachedQuery ) {

            // make clone
            return new SqlQuery()[ SET_CACHED_QUERY ]( this ).decode( decoders );
        }
        else {
            this.#decoders = decoders;

            return this;
        }
    }

    readOnly ( value ) {
        if ( value == null ) return this;

        if ( this.#cachedQuery ) {
            this.#cachedQuery.readOnly( value );
        }
        else {
            this.#readOnly = !!value;
        }

        return this;
    }

    toString () {
        if ( this.#cachedQuery ) {
            return this.#cachedQuery.toString();
        }
        else {
            return super.toString();
        }
    }

    sql ( query, ...params ) {
        this.#checkCached();

        var buf = [];

        // called as sql`...`
        if ( Array.isArray( query ) ) {
            if ( !query.raw ) throw new TypeError( `SQL "${ query }" is invalid` );

            for ( let idx = 0; idx < query.length; idx++ ) {
                const sql = query[ idx ].trim();

                if ( sql !== "" ) buf.push( sql );

                if ( idx < params.length ) {

                    // parameter is sub-query
                    if ( params[ idx ] instanceof Sql ) {
                        if ( params[ idx ].query ) {
                            buf.push( params[ idx ].query );

                            this.#params.push( ...params[ idx ].params );
                        }
                    }

                    // parameter is not sub-query
                    else {
                        buf.push( PLACEHOLDER );

                        this.#params.push( params[ idx ] );
                    }
                }
            }
        }

        // called as sql( sql`...` )
        else if ( query instanceof Sql ) {
            if ( query.query ) {
                buf.push( query.query );

                this.#params.push( ...query.params );
            }
        }

        // called as sql( null )
        else if ( query === null ) {
            buf.push( "NULL" );
        }

        // called as sql( string )
        else if ( typeof query === "string" ) {

            // trim
            const sql = query.trim();

            if ( sql !== "" ) buf.push( sql );
        }

        // called as sql( number )
        else if ( typeof query === "number" ) {
            buf.push( query );
        }

        // called as sql( boolean )
        else if ( typeof query === "boolean" ) {
            buf.push( query
                ? "TRUE"
                : "FALSE" );
        }

        // called as sql( bigint )
        else if ( typeof query === "bigint" ) {
            buf.push( query );
        }

        // invalid sql type
        else {
            throw new TypeError( `SQL "${ query }" is invalid` );
        }

        if ( buf.length ) {
            if ( this[ QUERY_ACCESSOR ] ) this[ QUERY_ACCESSOR ] += " ";

            this[ QUERY_ACCESSOR ] += buf.join( " " );
        }

        return this;
    }

    ID ( value ) {
        this.#checkCached();

        this[ QUERY_ACCESSOR ] += " " + quoteId( value ) + " ";

        return this;
    }

    SET ( values, fields ) {
        this.#checkCached();

        var buf = [];

        if ( typeof values === "object" ) {
            if ( fields ) values = objectPick( values, fields );

            for ( const field in values ) {

                // value is subquery
                if ( values[ field ] instanceof Sql ) {
                    const query = values[ field ];

                    if ( query.query ) {
                        buf.push( quoteId( field ) + " = ( " + query.query + " )" );

                        this.#params.push( ...query.params );
                    }
                }

                // valie is parameter
                else {
                    buf.push( quoteId( field ) + " = " + PLACEHOLDER );

                    this.#params.push( values[ field ] );
                }
            }
        }
        else {
            throw new TypeError( `SQL set value "${ values }" is invalid` );
        }

        this[ QUERY_ACCESSOR ] += " SET " + buf.join( ", " );

        return this;
    }

    // rows: {} || [{}]
    // index: [String], "firstRow", "fullScan". "fullScan" is default
    VALUES ( rows, { index = "fullScan" } = {} ) {
        this.#checkCached();

        const [ fields, _rows ] = this.#processValues( rows, index );

        if ( fields ) {
            this[ QUERY_ACCESSOR ] += " ( " + fields.map( field => quoteId( field ) ).join( ", " ) + " )";
        }

        this[ QUERY_ACCESSOR ] += " VALUES " + _rows.join( ", " );

        return this;
    }

    // rows: {} || [{}]
    // index: [String], "firstRow", "fullScan". "fullScan" is default
    VALUES_AS ( alias, rows, { index = "fullScan" } = {} ) {
        this.#checkCached();

        const [ fields, _rows ] = this.#processValues( rows, index );

        this[ QUERY_ACCESSOR ] += " ( VALUES " + _rows.join( ", " ) + " ) AS " + quoteId( alias ) + " ( " + fields.map( field => quoteId( field ) ).join( ", " ) + " )";

        return this;
    }

    FROM ( ...values ) {
        this.#checkCached();

        var from = [];

        for ( const value of values ) {

            // skip undefined values
            if ( value == null ) {
                continue;
            }
            else if ( Array.isArray( value ) ) {
                for ( const value1 of value ) {

                    // skip undefined value
                    if ( value1 == null ) {
                        continue;
                    }
                    else {
                        from.push( quoteId( value1 ) );
                    }
                }
            }
            else {
                from.push( quoteId( value ) );
            }
        }

        this[ QUERY_ACCESSOR ] += " FROM " + from.join( ", " );

        return this;
    }

    WHERE ( ...conditions ) {
        this.#checkCached();

        const query = parseConditions( conditions );

        if ( query ) {
            this[ QUERY_ACCESSOR ] += " WHERE " + query[ 0 ];

            this.#params.push( ...query[ 1 ] );
        }

        return this;
    }

    ON ( ...conditions ) {
        this.#checkCached();

        const query = parseConditions( conditions );

        if ( query ) {
            this[ QUERY_ACCESSOR ] += " WHERE " + query[ 0 ];

            this.#params.push( ...query[ 1 ] );
        }

        return this;
    }

    HAVING ( ...conditions ) {
        this.#checkCached();

        const query = parseConditions( conditions );

        if ( query ) {
            this[ QUERY_ACCESSOR ] += " WHERE " + query[ 0 ];

            this.#params.push( ...query[ 1 ] );
        }

        return this;
    }

    IN ( values ) {
        this.#checkCached();

        var buf = [];

        for ( const val1 of values ) {

            // skip undefined values
            if ( typeof val1 === "undefined" ) {
                continue;
            }
            else {
                buf.push( PLACEHOLDER );

                this.#params.push( val1 );
            }
        }

        this[ QUERY_ACCESSOR ] += " IN (" + buf.join( ", " ) + ")";

        return this;
    }

    GROUP_BY ( fields ) {
        this.#checkCached();

        var buf = [];

        for ( const field of fields ) {
            if ( field ) {
                buf.push( quoteId( field ) );
            }
        }

        if ( buf.length ) this[ QUERY_ACCESSOR ] += " GROUP BY " + buf.join( ", " );

        return this;
    }

    ORDER_BY ( values ) {
        this.#checkCached();

        if ( values ) {
            const buf = [];

            for ( const value of values ) {
                const direction = ORDER_BY_DIRECTION[ value[ 1 ] || "asc" ];

                if ( direction ) {
                    buf.push( quoteId( value[ 0 ] ) + " " + direction );
                }
                else {
                    throw new Error( `SQL order by direction "${ value[ 1 ] }" is invalid` );
                }
            }

            if ( buf.length ) this[ QUERY_ACCESSOR ] += " ORDER BY " + buf.join( ", " );
        }

        return this;
    }

    OFFSET_LIMIT ( _offset, _limit, options ) {
        this.#checkCached();

        const { offset, limit } = createOffsetLimit( _offset, _limit, options );

        if ( offset ) {
            this[ QUERY_ACCESSOR ] += " OFFSET " + PLACEHOLDER;

            this.#params.push( offset );
        }

        if ( limit != null ) {
            this[ QUERY_ACCESSOR ] += " LIMIT " + PLACEHOLDER;

            this.#params.push( limit === -1
                ? 0
                : limit );
        }

        return this;
    }

    LIMIT ( limit, { defaultLimit, maxLimit } = {} ) {
        this.#checkCached();

        if ( limit == null ) {
            limit = defaultLimit || maxLimit || null;
        }
        else if ( typeof limit !== "number" || limit < 0 ) {
            throw new RangeError( `SQL limit value "${ limit }" is invalid` );
        }
        else if ( maxLimit && limit > maxLimit ) {
            limit = maxLimit;
        }

        if ( limit != null ) {
            this[ QUERY_ACCESSOR ] += " LIMIT " + PLACEHOLDER;

            this.#params.push( limit );
        }

        return this;
    }

    OFFSET ( offset ) {
        this.#checkCached();

        if ( offset ) {
            if ( typeof offset !== "number" || offset < 0 ) throw new RangeError( `SQL offset value "${ offset }" is invalid` );

            this[ QUERY_ACCESSOR ] += " OFFSET " + PLACEHOLDER;

            this.#params.push( offset );
        }

        return this;
    }

    // private
    #checkCached () {
        if ( this.id ) throw new Error( "Prepared SQL query can't be modified" );
    }

    [ SET_CACHED_QUERY ] ( cachedQuery ) {
        this[ QUERY_ACCESSOR ] = "";

        this.#cachedQuery = cachedQuery;

        return this;
    }

    #processValues ( rows, index ) {
        if ( isPlainObject( rows ) ) {
            rows = [ rows ];
        }
        else if ( !Array.isArray( rows ) ) {
            throw new TypeError( "SQL rows value is not a array" );
        }

        var fields;

        const valueIsObject = isPlainObject( rows[ 0 ] );

        // create fields index
        if ( Array.isArray( index ) ) {
            fields = index;
        }
        else if ( valueIsObject ) {

            // build full fields index
            if ( index === "fullScan" ) {
                const idx = {};

                for ( const row of rows ) {
                    for ( const field in row ) {
                        idx[ field ] = true;
                    }
                }

                fields = Object.keys( idx );
            }

            // build fields index from the first row only
            else if ( index === "firstRow" ) {
                fields = Object.keys( rows[ 0 ] );
            }
            else {
                throw new Error( "SQL fields value is invalid" );
            }
        }

        const _rows = [];

        // create rows
        for ( const row of rows ) {
            const params = [];

            // object
            if ( valueIsObject ) {
                for ( const field of fields ) {
                    const param = row[ field ];

                    if ( param instanceof Sql ) {
                        if ( param.query ) {
                            params.push( "( " + param.query + " )" );

                            this.#params.push( ...param.params );
                        }
                    }
                    else {
                        params.push( PLACEHOLDER );

                        this.#params.push( param );
                    }
                }
            }

            // array
            else {
                for ( const param of row ) {
                    if ( param instanceof Sql ) {
                        if ( param.query ) {
                            params.push( "( " + param.query + " )" );

                            this.#params.push( ...param.params );
                        }
                    }
                    else {
                        params.push( PLACEHOLDER );

                        this.#params.push( param );
                    }
                }
            }

            _rows.push( "( " + params.join( ", " ) + " )" );
        }

        return [ fields, _rows ];
    }
}

export function sql () {
    return new SqlQuery().sql( ...arguments );
}

Object.defineProperties( sql, {
    "where": {
        "configurable": false,
        "writable": false,
        "value": function ( ...args ) {
            return new SqlWhere( args );
        },
    },
    "createOffsetLimit": {
        "configurable": false,
        "writable": false,
        "value": createOffsetLimit,
    },
    "quoteId": {
        "configurable": false,
        "writable": false,
        "value": quoteId,
    },
    "quoteLikePattern": {
        "configurable": false,
        "writable": false,
        "value": quoteLikePattern,
    },
    "encodeArray": {
        "configurable": false,
        "writable": false,
        "value": encodeArray,
    },
} );
