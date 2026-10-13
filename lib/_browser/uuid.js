import RandomValues from "#lib/crypto/random-values";
import { compare } from "#lib/utils";

const UUIDV7_MAX_COUNTER = 2 ** 12 - 1,
    SPLITTER_IDX = new Set( [ 4, 6, 8, 10 ] );

var UUIDV7_TIMESTAMP = 0,
    UUIDV7_COUNTER;

// public
export default class Uuid {
    #string;
    #uint8Array;
    #bigint;
    #version;
    #variant;
    #timestamp;
    #counter;

    constructor ( uuid ) {
        if ( typeof uuid === "string" ) {
            this.#string = uuid.toLowerCase();
        }
        else if ( uuid instanceof Uuid ) {
            this.#string = uuid.toString();
        }
        else if ( uuid instanceof Uint8Array ) {
            this.#uint8Array = uuid;
        }
        else if ( typeof uuid === "bigint" ) {
            this.#bigint = uuid;
        }
        else {
            throw new TypeError( "Uuid is not valid" );
        }
    }

    // static
    static new ( uuid ) {
        if ( uuid instanceof this ) {
            return uuid;
        }
        else {
            return new this( uuid );
        }
    }

    static newV4 () {
        return new this( this.v4() );
    }

    static newV7 () {
        return new this( this.v7() );
    }

    static v4 () {

        // for https context use built-in method
        if ( globalThis.crypto.randomUUID ) {
            return globalThis.crypto.randomUUID();
        }

        // fallback for insecure context
        else {
            const bytes = RandomValues.default.getRandomUint32Subarray( 4 );

            // set version (bits 48-51 to 0b0100)
            bytes[ 1 ] = ( bytes[ 1 ] & -0xF001 ) | 0x4000;

            // set variant (bits 64-65 to 0b10)
            bytes[ 2 ] = ( bytes[ 2 ] & 0x3FFF_FFFF ) | 0x8000_0000;

            return (
                bytes[ 0 ].toString( 16 ).padStart( 8, "0" ) + //
                "-" +
                ( bytes[ 1 ] >>> 16 ).toString( 16 ).padStart( 4, "0" ) +
                "-" +
                ( bytes[ 1 ] & 0xFFFF ).toString( 16 ).padStart( 4, "0" ) +
                "-" +
                ( bytes[ 2 ] >>> 16 ).toString( 16 ).padStart( 4, "0" ) +
                "-" +
                ( bytes[ 2 ] & 0xFFFF ).toString( 16 ).padStart( 4, "0" ) +
                bytes[ 3 ].toString( 16 ).padStart( 8, "0" )
            );
        }
    }

    static v7 () {
        const timestamp = Date.now();

        // use new timestamp
        if ( timestamp > UUIDV7_TIMESTAMP ) {
            UUIDV7_TIMESTAMP = timestamp;
            UUIDV7_COUNTER = null;
        }

        if ( UUIDV7_COUNTER != null ) {
            UUIDV7_COUNTER += 1;

            if ( UUIDV7_COUNTER > UUIDV7_MAX_COUNTER ) {
                UUIDV7_TIMESTAMP += 1;

                UUIDV7_COUNTER = null;
            }
        }

        const bytes = new Array( 4 );

        [ bytes[ 2 ], bytes[ 3 ] ] = RandomValues.default.getRandomUint32Subarray( 2 );

        // init counter
        if ( UUIDV7_COUNTER == null ) {
            UUIDV7_COUNTER = RandomValues.default.getRandomUint16() & 0xFFF;
        }

        // set 48-bit timestamp + version + counter
        bytes[ 0 ] = Number( BigInt( UUIDV7_TIMESTAMP ) >> 16n );
        bytes[ 1 ] = ( ( UUIDV7_TIMESTAMP & 0xFFFF ) << 16 ) | 0x7000 | UUIDV7_COUNTER;

        // set variant (bits 64-65 to 0b10)
        bytes[ 2 ] = ( bytes[ 2 ] & 0x3FFF_FFFF ) | 0x8000_0000;

        return (
            bytes[ 0 ].toString( 16 ).padStart( 8, "0" ) + //
            "-" +
            ( bytes[ 1 ] >>> 16 ).toString( 16 ).padStart( 4, "0" ) +
            "-" +
            ( bytes[ 1 ] & 0xFFFF ).toString( 16 ).padStart( 4, "0" ) +
            "-" +
            ( bytes[ 2 ] >>> 16 ).toString( 16 ).padStart( 4, "0" ) +
            "-" +
            ( bytes[ 2 ] & 0xFFFF ).toString( 16 ).padStart( 4, "0" ) +
            bytes[ 3 ].toString( 16 ).padStart( 8, "0" )
        );
    }

    static get compare () {
        return ( a, b ) => this.new( a ).compare( b );
    }

    // properties
    get uint8Array () {
        if ( !this.#uint8Array ) {
            this.#uint8Array = new Uint8Array( 16 );

            // string
            if ( this.#string ) {

                // FIXME [engine:node@>=26.0.0]: enable in node 26
                // this.#uint8Array = Uint8Array.fromHex( this.#string.replaceAll( "-", "" ) );

                const hex = this.#string.replaceAll( "-", "" );
                for ( let n = 0; n < 32; n += 2 ) {
                    this.#uint8Array[ n / 2 ] = Number.parseInt( hex.slice( n, n + 2 ), 16 );
                }
            }

            // bigint
            else {
                const dataView = new DataView( this.#uint8Array.buffer, this.#uint8Array.byteOffset, this.#uint8Array.byteLength );

                dataView.setBigUint64( 0, this.#bigint >> 64n, false );
                dataView.setBigUint64( 8, this.#bigint & 0xFFFF_FFFF_FFFF_FFFFn, false );
            }
        }

        return this.#uint8Array;
    }

    get bigint () {
        if ( this.#bigint == null ) {

            // string
            if ( this.#string ) {
                this.#bigint = BigInt( "0x" + this.#string.replaceAll( "-", "" ) );
            }

            // Uint8Array
            else {
                const dataView = new DataView( this.#uint8Array.buffer, this.#uint8Array.byteOffset, this.#uint8Array.byteLength ),
                    high = dataView.getBigUint64( 0 ),
                    low = dataView.getBigUint64( 8 );

                this.#bigint = ( high << 64n ) | low;
            }
        }

        return this.#bigint;
    }

    get version () {
        if ( this.#version == null ) {
            this.#version = this.uint8Array[ 6 ] >>> 4;
        }

        return this.#version;
    }

    get variant () {
        if ( this.#variant == null ) {
            this.#variant = this.uint8Array[ 8 ] >>> 6;
        }

        return this.#variant;
    }

    get timestamp () {
        if ( this.#timestamp === undefined ) {
            if ( this.version === 7 ) {
                const dataView = new DataView( this.uint8Array.buffer, this.uint8Array.byteOffset, this.uint8Array.byteLength );

                this.#timestamp = dataView.getUint32( 0 ) * 2 ** 16 + dataView.getUint16( 4 );
            }
            else {
                this.#timestamp = null;
            }
        }

        return this.#timestamp;
    }

    get counter () {
        if ( this.#counter === undefined ) {
            if ( this.version === 7 ) {
                const dataView = new DataView( this.uint8Array.buffer, this.uint8Array.byteOffset, this.uint8Array.byteLength );

                this.#counter = dataView.getUint16( 6 ) & 0x0FFF;
            }
            else {
                this.#counter = null;
            }
        }

        return this.#counter;
    }

    // public
    toString () {
        if ( !this.#string ) {
            this.#string = [ ...this.uint8Array ]
                .map( ( byte, idx ) => {
                    return ( SPLITTER_IDX.has( idx )
                        ? "-"
                        : "" ) + byte.toString( 16 ).padStart( 2, "0" );
                } )
                .join( "" );
        }

        return this.#string;
    }

    toJson () {
        return this.toString();
    }

    compare ( uuid ) {
        uuid = this.constructor.new( uuid );

        return compare( this.bigint, uuid.bigint );
    }

    eq ( uuid ) {
        return this.compare( uuid ) === 0;
    }

    ne ( uuid ) {
        return this.compare( uuid ) !== 0;
    }

    lt ( uuid ) {
        return this.compare( uuid ) < 0;
    }

    lte ( uuid ) {
        return this.compare( uuid ) <= 0;
    }

    gt ( uuid ) {
        return this.compare( uuid ) > 0;
    }

    gte ( uuid ) {
        return this.compare( uuid ) >= 0;
    }

    [ Symbol.for( "nodejs.util.inspect.custom" ) ] ( depth, options, inspect ) {
        const spec = {
            "uuid": this.toString(),
            "version": this.version,
        };

        if ( this.timestamp ) {
            spec.timestamp = this.timestamp;
        }

        return `${ this.constructor.name }: ${ inspect( spec ) }`;
    }
}
