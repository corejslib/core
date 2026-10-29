import { isUtf8 } from "node:buffer";
import { parseHttpDateToDate } from "#lib/dates";

export function encodeValue ( value, { rfc5987 } = {} ) {
    if ( value == null ) {
        return "";
    }
    else if ( typeof value === "string" ) {
        return encodeString( value, { rfc5987 } );
    }
    else if ( typeof value === "number" ) {
        return value.toString();
    }
    else if ( value === true ) {
        return "?1";
    }
    else if ( value === false ) {
        return "?0";
    }
    else if ( Buffer.isBuffer( value ) ) {
        return `:${ value.toBase64() }:`;
    }
    else if ( value instanceof Date ) {
        return value.toUTCString();
    }
    else if ( value instanceof Temporal.Instant ) {
        return new Date( value.epochMilliseconds ).toUTCString();
    }
    else if ( value instanceof Temporal.ZonedDateTime ) {
        return new Date( value.epochMilliseconds ).toUTCString();
    }
    else {
        throw new TypeError( "Invalid value type" );
    }
}

export function encodeString ( value, { rfc5987 } = {} ) {

    // stringify
    if ( typeof value !== "string" ) {
        value = String( value );
    }

    // RFC 5987
    // https://datatracker.ietf.org/doc/html/rfc5987
    if ( rfc5987 ) {
        return `utf-8''${ encodeURIComponent( value ) }`;
    }

    // quote
    else {

        // encode
        value = value.replaceAll( /[\u{0}-\u{1F}\u{7F}]/gv, char => encodeURIComponent( char ) );

        // escape
        value = value.replaceAll( /["\\]/gv, char => `\\${ char }` );

        // quote
        value = `"${ value }"`;

        return value;
    }
}

export function encodeEtag ( etag, { weak } = {} ) {
    if ( etag == null ) {
        return;
    }
    else if ( Buffer.isBuffer( etag ) ) {
        etag = etag.toBase64();
    }
    else if ( typeof etag !== "string" ) {
        etag = String( etag );
    }

    if ( !etag ) {
        return '""';
    }
    else if ( etag === "*" ) {
        return etag;
    }
    else {
        etag = `"${ etag.replaceAll( /[\u{0}-\u{20}"\u{7F}]/gv, char => encodeURIComponent( char ) ) }"`;

        if ( weak ) {
            etag = "W/" + etag;
        }

        return etag;
    }
}

export function decodeValue ( value, { utf8, rfc5987 } = {} ) {
    if ( value == null ) {
        return null;
    }

    // not a string
    else if ( typeof value !== "string" ) {
        return value;
    }

    // quoted string
    else if ( value.startsWith( '"' ) && value.endsWith( '"' ) ) {
        return decodeString( value, { utf8 } );
    }

    // true
    else if ( value === "?0" ) {
        return false;
    }

    // false
    else if ( value === "?1" ) {
        return true;
    }

    // binary
    else if ( /^:[\d+\/=A-Za-z]*:$/v.test( value ) ) {
        return Buffer.fromBase64( value.slice( 1, -1 ) );
    }
    else {

        // number
        const number = Number( value );
        if ( Number.isFinite( number ) ) {
            return number;
        }

        // http date
        try {
            return parseHttpDateToDate( value );
        }
        catch {}

        // unquoted string
        return decodeString( value, { utf8, rfc5987 } );
    }
}

export function decodeString ( value, { utf8 = true, rfc5987, unescape = true } = {} ) {
    if ( value == null ) {
        value = "";
    }
    else if ( typeof value !== "string" ) {
        value = String( value );
    }

    // RFC 5987
    // https://datatracker.ietf.org/doc/html/rfc5987
    if ( rfc5987 ) {
        const match = value.match( /^(?<encoding>[\dA-Za-z\-]+)'(?<language>[A-Z_a-z]*)'(?<value>.+)/v );
        if ( !match ) return;

        return decodeURIComponent( match.groups.value );
    }
    else {

        // upgrade to "utf8"
        UPGRADE_TO_UTF8: if ( utf8 ) {

            // is "ascii" string
            if ( !/[^\u{0}-\u{7F}]/v.test( value ) ) break UPGRADE_TO_UTF8;

            // we don't check it here because in headers we are storing strings in "latin1"
            // already "utf8" string
            // if ( /[^\x00-\xFF]/.test( value ) ) break UPGRADE_TO_UTF8;

            const buffer = Buffer.from( value, "latin1" );

            // not a valid "utf8" string
            if ( !isUtf8( buffer ) ) break UPGRADE_TO_UTF8;

            value = buffer.toString();
        }

        // quoted string
        if ( value.startsWith( '"' ) && value.endsWith( '"' ) ) {

            // unquote
            value = value.slice( 1, -1 );

            // unescape
            if ( unescape ) {
                value = value.replaceAll( /\\(["\\])/gv, match => match[ 1 ] );
            }

            return value;
        }

        // unquoted string
        else {
            return value;
        }
    }
}

export function decodeNumber ( value ) {
    value = Number( value );

    if ( Number.isFinite( value ) ) {
        return value;
    }
}

export function decodeInteger ( value ) {
    value = Number( value );

    if ( Number.isInteger( value ) ) {
        return value;
    }
}

export function decodeBoolean ( value, { defaultValue = true } = {} ) {
    if ( value == null ) {
        return defaultValue;
    }
    else if ( value === "?0" ) {
        return false;
    }
    else if ( value === "?1" ) {
        return true;
    }
}

export function decodeBinary ( value ) {
    if ( /^:[\d+\/=A-Za-z]*:$/v.test( value ) ) {
        return Buffer.fromBase64( value.slice( 1, -1 ) );
    }
}

export function decodeHttpDate ( value ) {
    try {
        return parseHttpDateToDate( value );
    }
    catch {}
}
