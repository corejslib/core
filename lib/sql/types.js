import Interval from "#lib/interval";
import Numeric from "#lib/numeric";

const BOOLEAN_TRUE_VALUES = new Set( [ "t", "true" ] );

export function isTemporal ( value ) {
    return value instanceof Temporal.Instant || value instanceof Temporal.ZonedDateTime || value instanceof Temporal.PlainDateTime || value instanceof Temporal.PlainDate || value instanceof Temporal.PlainTime || value instanceof Temporal.Duration;
}

export function quote ( value ) {

    // null
    if ( value == null ) {
        return "NULL";
    }

    // string
    else if ( typeof value === "string" ) {
        return `'${ value.replaceAll( "'", "''" ) }'`;
    }

    // number
    else if ( typeof value === "number" ) {
        if ( Number.isFinite( value ) ) {
            return value.toString();
        }
        else {
            return `'${ value.toString() }'`;
        }
    }

    // boolean
    else if ( typeof value === "boolean" ) {
        return value
            ? "TRUE"
            : "FALSE";
    }

    // bigint
    else if ( typeof value === "bigint" ) {
        return value.toString();
    }

    // object
    else if ( typeof value === "object" ) {

        // Temporal
        if ( isTemporal( value ) ) {
            if ( value instanceof Temporal.ZonedDateTime ) {
                return `'${ value.toInstant().toString() }'`;
            }
            else {
                return `'${ value.toString() }'`;
            }
        }

        // Interval
        else if ( value instanceof Interval ) {
            return `'${ value.toDurationString() }'`;
        }

        // Numeric
        else if ( Numeric.isNumeric( value ) ) {
            return value.toString();
        }

        // Object
        else {
            return `'${ JSON.stringify( value ).replaceAll( "'", "''" ) }'`;
        }
    }

    // invalid type
    throw new TypeError( `Unsupported SQL parameter type "${ typeof value }"` );
}

export function quoteSqlite ( value ) {
    if ( typeof value === "number" ) {
        if ( Number.isFinite( value ) ) {
            return value.toString();
        }
        else if ( Number.isNaN( value ) ) {
            return "NULL";
        }
        else {
            return value < 0
                ? "-1e999"
                : "1e999";
        }
    }

    // View
    else if ( ArrayBuffer.isView( value ) ) {
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
    else {
        return quote( value );
    }
}

export function quotePostgresql ( value ) {

    // View, https://www.postgresql.org/docs/current/static/datatype-binary.html
    if ( ArrayBuffer.isView( value ) ) {
        if ( !Buffer.isBuffer( value ) ) {
            value = Buffer.from( value.buffer, value.byteOffset, value.byteLength );
        }

        return `'${ encodeBufferPostgresql( value ) }'`;
    }

    // ArrayBuffer
    else if ( value instanceof ArrayBuffer ) {
        return `'${ encodeBufferPostgresql( Buffer.from( value ) ) }'`;
    }
    else {
        return quote( value );
    }
}

export function encodeBufferPostgresql ( value ) {
    if ( !Buffer.isBuffer( value ) ) {
        if ( ArrayBuffer.isView( value ) ) {
            value = Buffer.from( value.buffer, value.byteOffset, value.byteLength );
        }
        else if ( value instanceof ArrayBuffer ) {
            value = Buffer.from( value );
        }
        else {
            throw new TypeError( "Value is not a Buffer" );
        }
    }

    return "\\x" + value.toHex();
}

export function decodeBufferPostgresql ( value ) {
    if ( Buffer.isBuffer( value ) ) {
        return Buffer.from( value.toString( "latin1", 2 ), "hex" );
    }
    else {
        return Buffer.from( value.slice( 2 ), "hex" );
    }
}

export function encodeDate ( value ) {

    // Temporal
    if ( isTemporal( value ) ) {
        if ( value instanceof Temporal.ZonedDateTime ) {
            return value.toInstant().toString();
        }
        else {
            return value.toString();
        }
    }

    // error
    throw new TypeError( "Date is not valid" );
}

export function encodeArrayPostgresql ( data, { readable } = {} ) {
    if ( data == null ) return "NULL";

    if ( !Array.isArray( data ) ) throw new TypeError( "Unable to encode PostgreSQL array" );

    const space = readable
            ? " "
            : "",
        array = [];

    for ( let value of data ) {

        // null
        if ( value == null ) {
            value = "NULL";
        }

        // string
        else if ( typeof value === "string" ) {
            value = '"' + value.replaceAll( "\\", "\\\\" ).replaceAll( '"', '\\"' ) + '"';
        }

        // boolean
        else if ( typeof value === "boolean" ) {
            value = value
                ? "TRUE"
                : "FALSE";
        }

        // bigint
        else if ( typeof value === "bigint" ) {
            value = value.toString();
        }

        // object
        else if ( typeof value === "object" ) {

            // Array
            if ( Array.isArray( value ) ) {
                value = encodeArrayPostgresql( value, { readable } );
            }

            // View, ArrayBuffer
            else if ( ArrayBuffer.isView( value ) || value instanceof ArrayBuffer ) {
                value = encodeBufferPostgresql( value ).replaceAll( "\\", "\\\\" );
            }

            // Temporal
            else if ( isTemporal( value ) ) {
                if ( value instanceof Temporal.ZonedDateTime ) {
                    value = `"${ value.toInstant().toString() }"`;
                }
                else {
                    value = `"${ value.toString() }"`;
                }
            }

            // Interval
            else if ( value instanceof Interval ) {
                value = `"${ value.toDurationString() }"`;
            }

            // Numeric
            else if ( Numeric.isNumeric( value ) ) {
                value = value.toString();
            }

            // Object
            else {
                value = `"${ JSON.stringify( value ).replaceAll( "\\", "\\\\" ).replaceAll( '"', '\\"' ) }"`;
            }
        }
        else if ( typeof value !== "number" ) {
            throw new TypeError( "PostgreSQL array item type is not valid" );
        }

        array.push( value );
    }

    if ( !array.length ) {
        return "{}";
    }
    else {
        return `{${ space }${ array.join( "," + space ) }${ space }}`;
    }
}

export function decodeArrayPostgresql ( data, valueDecoder = String ) {
    if ( Buffer.isBuffer( data ) ) {
        data = data.toString();
    }

    if ( !data.startsWith( "{" ) ) throw new TypeError( "Not a PostgreSQL array" );

    const arrays = [];

    let array,
        valueStart = null,
        valueEnd = null,
        escapeStarted = false,
        quoteStarted = false,
        valueQuoted = false;

    for ( let n = 0; n < data.length; n++ ) {
        if ( valueStart == null ) {

            // start array
            if ( data[ n ] === "{" ) {
                const subArray = [];

                if ( array ) {
                    array.push( subArray );

                    arrays.push( array );
                }

                array = subArray;
            }

            // end array
            else if ( data[ n ] === "}" ) {
                if ( arrays.length ) {
                    array = arrays.pop();
                }
            }

            // values separator
            else if ( data[ n ] === "," ) {
                continue;
            }

            // ignore spaces
            else if ( data[ n ] === " " ) {
                continue;
            }

            // start value
            else {

                // value is quoted
                if ( data[ n ] === '"' ) {
                    valueStart = n + 1;
                    quoteStarted = true;
                    valueQuoted = true;
                }
                else {
                    valueStart = n;

                    // value starts with the escape character
                    if ( data[ n ] === "\\" ) escapeStarted = true;
                }
            }
        }

        // value
        else {

            // escape
            if ( data[ n ] === "\\" ) {
                escapeStarted = !escapeStarted;

                continue;
            }

            // skip escaped character
            if ( escapeStarted ) {
                escapeStarted = false;

                continue;
            }

            // quote
            if ( quoteStarted ) {

                // end quote
                if ( data[ n ] === '"' ) {
                    quoteStarted = false;
                    valueEnd = n;
                }

                continue;
            }

            // end value
            if ( data[ n ] === "}" || data[ n ] === "," ) {
                let value;

                // value is quoted
                if ( valueQuoted ) {
                    value = data.slice( valueStart, valueEnd );
                }

                // value is not quoted
                else {
                    value = data.slice( valueStart, n );

                    // remove trailing spaces
                    if ( value.endsWith( " " ) ) {
                        value = value.replace( / +$/v, "" );
                    }

                    // NULL value
                    if ( value.toLowerCase() === "null" ) {
                        value = null;
                    }
                }

                valueQuoted = false;
                valueStart = null;
                valueEnd = null;

                // decode not null value
                if ( value != null ) {

                    // unescape value
                    value = value.replaceAll( /\\(.)/gsv, ( match, char ) => char );

                    value = valueDecoder( value );
                }

                array.push( value );

                // end array
                if ( data[ n ] === "}" && arrays.length ) {
                    array = arrays.pop();
                }
            }
        }
    }

    return array;
}

export function decodeBoolean ( value ) {
    return BOOLEAN_TRUE_VALUES.has( value.toString().toLowerCase() );
}

export function decodeNumeric ( value, scale, safe ) {
    const numeric = Numeric( value, { scale } );

    if ( safe && !numeric.truncated.isSafeInteger ) {
        throw new RangeError( "Number is out of range" );
    }

    return numeric;
}

export function decodeSafeInteger ( value ) {
    if ( typeof value !== "number" ) {
        if ( Buffer.isBuffer( value ) ) {
            value = Number( value.toString( "latin1" ) );
        }
        else {
            value = Number( value );
        }
    }

    if ( !Number.isSafeInteger( value ) ) {
        value = Math.trunc( value );

        if ( !Number.isSafeInteger( value ) ) throw new RangeError( "Number is out of range" );
    }

    return value;
}

export function decodeBigInt ( value ) {
    if ( typeof value === "bigint" ) {
        return value;
    }
    else if ( Buffer.isBuffer( value ) ) {
        return BigInt( value.toString( "latin1" ) );
    }
    else {
        return BigInt( value );
    }
}

const DEFAULT_TYPES = [

    // float
    {
        "names": {
            "float4": 700, // real
            "float8": 701, // double
        },
        "decode": Number,
    },

    // integer
    {
        "names": {
            "int2": 21, // smallint
            "int4": 23, // integer
            "oid": 26,
        },
        "decode": Number,
    },

    // numeric
    {
        "names": {
            "numeric": 1700,
        },
    },

    // int8
    {
        "names": {
            "int8": 20, // bigint
            "int53": null,
            "integer": null, // SQLite specific number
        },
        "decode": decodeSafeInteger,
    },

    // boolean
    {
        "names": {
            "boolean": 16, // boolean
        },
        "decodePostgresql": value => ( typeof value === "string"
            ? value[ 0 ] === "t"
            : value[ 0 ] === 0x74 ),
        "decodeSqlite": Boolean,
    },

    // dates
    // {
    //     "names": {
    //         "timestamp": 1114,
    //         "timestamp without time zone": 1114,
    //     },
    //     "decode": value => Temporal.PlainDateTime.from( value.toString() ),
    // },
    // {
    //     "names": {
    //         "timestamptz": 1184,
    //         "timestamp with time zone": 1184,
    //     },
    //     "decode": value => Temporal.Instant.from( value.toString() ),
    // },
    // {
    //     "names": {
    //         "date": 1082,
    //     },
    //     "decode": value => Temporal.PlainDate.from( value.toString() ),
    // },
    // {
    //     "names": {
    //         "time": 1083,
    //         "time without time zone": 1083,
    //     },
    //     "decode": value => Temporal.PlainTime.from( value.toString() ),
    // },
    // {
    //     "names": {
    //         "interval": 1186,
    //     },
    //     "decode": value => new Interval( value.toString() ),
    // },

    // json
    {
        "names": {
            "json": 114,
            "jsonb": 3802,
        },
        "decode": JSON.parse,
    },

    // buffer
    {
        "names": {
            "bytea": 17,
        },
        "decodePostgresql": decodeBufferPostgresql,
    },

    // bigint
    {
        "names": {
            "bigint": null,
        },
        "decode": decodeBigInt,
    },

    // arrays
    {
        "names": {
            "text-array": 1009,
            "money-array": 791,
        },
        "decode": value => decodeArrayPostgresql( value, String ),
    },
    {
        "names": {
            "float4-array": 1021,
            "float8-array": 1022,
        },
        "decode": value => decodeArrayPostgresql( value, Number ),
    },
    {
        "names": {
            "int2-array": 1005,
            "int4-array": 1007,
        },
        "decode": value => decodeArrayPostgresql( value, Number ),
    },
    {
        "names": {
            "int8-array": 1016,
            "int53-array": null,
        },
        "decode": value => decodeArrayPostgresql( value, decodeSafeInteger ),
    },
    {
        "names": {
            "boolean-array": 1000,
        },
        "decode": value => decodeArrayPostgresql( value, decodeBoolean ),
    },
    {
        "names": {
            "json-array": 199,
            "jsonb-array": 3807,
        },
        "decode": value => decodeArrayPostgresql( value, JSON.parse ),
    },
    {
        "names": {
            "bigint-array": null,
        },
        "decode": value => decodeArrayPostgresql( value, BigInt ),
    },
    {
        "names": {
            "numeric-array": 1231,
        },
        "decode": value => decodeArrayPostgresql( value, String ),
    },
    {
        "names": {
            "bytea-array": 1001,
        },
        "decode": value => decodeArrayPostgresql( value, decodeBufferPostgresql ),
    },
];

// numeric types
for ( let n = 0; n < 16; n++ ) {
    DEFAULT_TYPES.push(
        {
            "names": {
                [ `number${ n }` ]: null,
            },
            "decode": value => decodeNumeric( value, n, true ).number,
        },
        {
            "names": {
                [ `numeric${ n }` ]: null,
            },
            "decode": value => decodeNumeric( value, n, false ),
        },
        {
            "names": {
                [ `number${ n }-array` ]: null,
            },
            "decode": data => decodeArrayPostgresql( data, value => decodeNumeric( value, n, true ).number ),
        },
        {
            "names": {
                [ `numeric${ n }-array` ]: null,
            },
            "decode": data => decodeArrayPostgresql( data, value => decodeNumeric( value, n, false ) ),
        }
    );
}

export const sqliteDecoders = {},
    postgresqlDecoders = {};

for ( const type of DEFAULT_TYPES ) {
    for ( const name in type.names ) {
        const oid = type.names[ name ];

        if ( type.decodeSqlite || type.decode ) sqliteDecoders[ name ] = type.decodeSqlite || type.decode;

        if ( type.decodePostgresql || type.decode ) {
            postgresqlDecoders[ name ] = type.decodePostgresql || type.decode;

            if ( oid ) postgresqlDecoders[ oid ] = type.decodePostgresql || type.decode;
        }
    }
}
