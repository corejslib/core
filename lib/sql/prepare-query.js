import { quotePostgresql, quoteSqlite } from "./types.js";

const DB_SQLITE = "sqlite",
    DB_POSTGRESQL = "postgresql";

const CH_DQUOTE = 34,
    CH_DOLLAR = 36,
    CH_QUOTE = 39,
    CH_STAR = 42,
    CH_DASH = 45,
    CH_SLASH = 47,
    CH_QMARK = 63,
    CH_LBRACKET = 91,
    CH_BACKSLASH = 92,
    CH_BACKTICK = 96;

// characters, that may start a string, identifier, comment or literal (or are placeholders)
const SPECIAL = new Uint8Array( 256 );

for ( const c of [ CH_QMARK, CH_QUOTE, CH_DQUOTE, CH_BACKTICK, CH_LBRACKET, CH_DASH, CH_SLASH, CH_DOLLAR ] ) {
    SPECIAL[ c ] = 1;
}

function isIdentChar ( c ) {

    // 0-9, A-Z, a-z, _, $, non-ASCII
    return ( c >= 48 && c <= 57 ) || ( c >= 65 && c <= 90 ) || ( c >= 97 && c <= 122 ) || c === 95 || c === CH_DOLLAR || c > 127;
}

function isTagStartChar ( c ) {
    return ( c >= 65 && c <= 90 ) || ( c >= 97 && c <= 122 ) || c === 95 || c > 127;
}

// returns index right after the closing quote (or query length, if not closed)
function skipQuoted ( query, start, quote, backslash ) {
    const len = query.length,
        quoteChar = String.fromCodePoint( quote );

    let i = start + 1;

    while ( i < len ) {
        if ( backslash ) {
            const c = query.codePointAt( i );

            if ( c === CH_BACKSLASH ) {
                i += 2;

                continue;
            }
            else if ( c !== quote ) {
                i++;

                continue;
            }
        }
        else {
            i = query.indexOf( quoteChar, i );

            if ( i === -1 ) return len;
        }

        // doubled quote is an escaped quote
        if ( query.codePointAt( i + 1 ) === quote ) {
            i += 2;
        }
        else {
            return i + 1;
        }
    }

    return len;
}

// returns index right after the closing `*/` (or query length, if not closed)
function skipBlockComment ( query, start, nested ) {
    const len = query.length;

    if ( !nested ) {
        const end = query.indexOf( "*/", start + 2 );

        return end === -1
            ? len
            : end + 2;
    }

    let i = start + 2,
        depth = 1;

    while ( i < len && depth > 0 ) {
        const c1 = query.codePointAt( i ),
            c2 = query.codePointAt( i + 1 );

        if ( c1 === CH_STAR && c2 === CH_SLASH ) {
            depth--;
            i += 2;
        }
        else if ( c1 === CH_SLASH && c2 === CH_STAR ) {
            depth++;
            i += 2;
        }
        else {
            i++;
        }
    }

    return i;
}

// postgresql dollar quoting: $$...$$ or $tag$...$tag$
// returns index right after the closing tag, or `start` if there is no dollar quoted literal at this position
function skipDollarQuoted ( query, start ) {
    const len = query.length;

    // `$` is a part of an identifier
    if ( start > 0 && isIdentChar( query.codePointAt( start - 1 ) ) ) return start;

    let j = start + 1;

    if ( j < len && isTagStartChar( query.codePointAt( j ) ) ) {
        j++;

        while ( j < len && isIdentChar( query.codePointAt( j ) ) && query.codePointAt( j ) !== CH_DOLLAR ) {
            j++;
        }
    }

    // `$1` is a native placeholder, not a literal
    if ( query.codePointAt( j ) !== CH_DOLLAR ) return start;

    const tag = query.slice( start, j + 1 ),
        end = query.indexOf( tag, j + 1 );

    return end === -1
        ? len
        : end + tag.length;
}

// postgresql escape string: E'...'
function isEscapeString ( query, quotePos ) {
    if ( quotePos === 0 ) return false;

    const prev = query.codePointAt( quotePos - 1 );

    if ( prev !== 69 && prev !== 101 ) return false;

    return quotePos === 1 || !isIdentChar( query.codePointAt( quotePos - 2 ) );
}

// returns positions of all `?` placeholders, that are not part of strings, identifiers, comments or literals
function findPlaceholders ( isPg, query ) {
    const len = query.length,
        positions = [];

    let i = 0;

    while ( i < len ) {
        let c = query.codePointAt( i );

        // fast skip of ordinary characters
        while ( c > 255 || SPECIAL[ c ] === 0 ) {
            if ( ++i >= len ) return positions;

            c = query.codePointAt( i );
        }

        let next = i + 1;

        if ( c === CH_QMARK ) {
            positions.push( i );
        }
        else if ( c === CH_QUOTE ) {
            next = skipQuoted( query, i, CH_QUOTE, isPg && isEscapeString( query, i ) );
        }
        else if ( c === CH_DQUOTE ) {
            next = skipQuoted( query, i, CH_DQUOTE, false );
        }
        else if ( c === CH_BACKTICK && !isPg ) {
            next = skipQuoted( query, i, CH_BACKTICK, false );
        }
        else if ( c === CH_LBRACKET && !isPg ) {

            // sqlite: [identifier]
            const end = query.indexOf( "]", i + 1 );

            next = end === -1
                ? len
                : end + 1;
        }
        else if ( c === CH_DASH && query.codePointAt( i + 1 ) === CH_DASH ) {
            const end = query.indexOf( "\n", i + 2 );

            next = end === -1
                ? len
                : end + 1;
        }
        else if ( c === CH_SLASH && query.codePointAt( i + 1 ) === CH_STAR ) {

            // postgresql block comments can be nested
            next = skipBlockComment( query, i, isPg );
        }
        else if ( c === CH_DOLLAR && isPg ) {
            const end = skipDollarQuoted( query, i );

            if ( end > i ) next = end;
        }

        i = next;
    }

    return positions;
}

function prepareQuery ( dbType, query, params ) {
    const isPg = dbType === DB_POSTGRESQL;

    if ( !isPg && dbType !== DB_SQLITE ) throw new TypeError( `Unsupported database type: ${ dbType }` );

    // sqlite uses `?` natively
    if ( !params && !isPg ) return query;

    const positions = findPlaceholders( isPg, query );

    if ( params ) {
        const count = params.length;

        if ( count !== positions.length ) {
            throw new Error( `Number of parameters (${ count }) does not match number of placeholders (${ positions.length })` );
        }
    }

    if ( !positions.length ) return query;

    const quote = isPg
        ? quotePostgresql
        : quoteSqlite;

    let result = "",
        last = 0;

    for ( let n = 0; n < positions.length; n++ ) {
        const pos = positions[ n ];

        result += query.slice( last, pos );
        result += params
            ? quote( params[ n ] )
            : `$${ n + 1 }`;

        last = pos + 1;
    }

    return result + query.slice( last );
}

export function prepareQuerySqlite ( query, params ) {
    return prepareQuery( DB_SQLITE, query, params );
}

export function prepareQueryPostgresql ( query, params ) {
    return prepareQuery( DB_POSTGRESQL, query, params );
}
