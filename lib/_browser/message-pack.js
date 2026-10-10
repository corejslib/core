import "#lib/temporal";
import MessageBuffer from "#lib/data-structures/message-buffer";
import { isPlainObject } from "#lib/utils";

const DEFAULT_BUFFER_SIZE = 1024,
    TEXT_ENCODER = new TextEncoder(),
    EMPTY_BYTES = new Uint8Array( 0 ),
    MAX_UINT32 = 0xFFFF_FFFF,
    KEY_CACHE_SIZE = 2048, // must be a power of 2
    KEY_CACHE_MAX_LENGTH = 32,
    KEY_CACHE = new Array( KEY_CACHE_SIZE ).fill( "" ),
    HEADER_SIZES = new Uint8Array( 256 );

for ( const [ size, types ] of [
    [ 1, [ 0xC4, 0xCC, 0xD0, 0xD4, 0xD5, 0xD6, 0xD7, 0xD8, 0xD9 ] ],
    [ 2, [ 0xC5, 0xC7, 0xCD, 0xD1, 0xDA, 0xDC, 0xDE ] ],
    [ 3, [ 0xC8 ] ],
    [ 4, [ 0xC6, 0xCA, 0xCE, 0xD2, 0xDB, 0xDD, 0xDF ] ],
    [ 5, [ 0xC9 ] ],
    [ 8, [ 0xCB, 0xCF, 0xD3 ] ],
] ) {
    for ( const type of types ) {
        HEADER_SIZES[ type ] = size;
    }
}

const EXTENSIONS = new Map(),
    EXTENSIONS_INSTANCE = new Map(),
    EXTENSIONS_TYPEOF = new Map();

class IncompleteDataError extends RangeError {
    constructor () {
        super( "Unexpected end of MsgPack data" );
    }
}

class Decoder {
    #buffer;

    constructor ( data, offset = 0 ) {

        // MessageBuffer creates a new empty buffer if there is no data, but here the data is required
        if ( !data ) {
            throw new TypeError( "MsgPack data must be an ArrayBuffer or an ArrayBuffer view" );
        }

        this.#buffer = new MessageBuffer( { data, offset } );
    }

    // public
    decode () {
        let value;

        try {
            value = this.#decode();
        }
        catch ( e ) {

            // the whole buffer is expected to contain a complete value, so truncated data is a regular error here
            throw e instanceof IncompleteDataError
                ? new RangeError( e.message, { "cause": e } )
                : e;
        }

        if ( this.#buffer.offset !== this.#buffer.length ) {
            throw new RangeError( `Unexpected ${ this.#buffer.length - this.#buffer.offset } trailing bytes in MsgPack data` );
        }

        return value;
    }

    // returns undefined if the data is incomplete, otherwise the decoded value and the offset of its end
    decodeStream () {
        let value;

        try {
            value = this.#decode();
        }
        catch ( e ) {
            if ( e instanceof IncompleteDataError ) return;

            throw e;
        }

        return {
            "value": value,
            "offset": this.#buffer.offset,
        };
    }

    // private
    #decode () {
        const buffer = this.#buffer;

        if ( buffer.offset >= buffer.length ) {
            throw new IncompleteDataError();
        }

        const type = buffer.readUint8();

        // positive fixint
        if ( type <= 0x7F ) return type;

        // fixmap
        if ( type <= 0x8F ) return this.#decodeMap( type & 0x0F );

        // fixarray
        if ( type <= 0x9F ) return this.#decodeArray( type & 0x0F );

        // fixstr
        if ( type <= 0xBF ) return this.#decodeString( type & 0x1F );

        // negative fixint
        if ( type >= 0xE0 ) return type - 0x100;

        // the fixed part of the value (number, length, ext type) is checked here once, so the readers below do not check it again
        const headerSize = HEADER_SIZES[ type ];

        if ( headerSize !== 0 ) {
            this.#assertAvailable( headerSize );
        }

        switch ( type ) {
            case 0xC0:
                return null;
            case 0xC2:
                return false;
            case 0xC3:
                return true;

            // bin 8, 16, 32
            case 0xC4:
                return this.#decodeBinary( buffer.readUint8() );
            case 0xC5:
                return this.#decodeBinary( buffer.readUint16() );
            case 0xC6:
                return this.#decodeBinary( buffer.readUint32() );

            // ext 8, 16, 32
            case 0xC7:
                return this.#decodeExtension( buffer.readUint8() );
            case 0xC8:
                return this.#decodeExtension( buffer.readUint16() );
            case 0xC9:
                return this.#decodeExtension( buffer.readUint32() );

            // float 32, 64
            case 0xCA:
                return buffer.readFloat32();
            case 0xCB:
                return buffer.readFloat64();

            // uint 8, 16, 32, 64
            case 0xCC:
                return buffer.readUint8();
            case 0xCD:
                return buffer.readUint16();
            case 0xCE:
                return buffer.readUint32();
            case 0xCF:
                return buffer.readBigUint64();

            // int 8, 16, 32, 64
            case 0xD0:
                return buffer.readInt8();
            case 0xD1:
                return buffer.readInt16();
            case 0xD2:
                return buffer.readInt32();
            case 0xD3:
                return buffer.readBigInt64();

            // fixext 1, 2, 4, 8, 16
            case 0xD4:
                return this.#decodeExtension( 1 );
            case 0xD5:
                return this.#decodeExtension( 2 );
            case 0xD6:
                return this.#decodeExtension( 4 );
            case 0xD7:
                return this.#decodeExtension( 8 );
            case 0xD8:
                return this.#decodeExtension( 16 );

            // str 8, 16, 32
            case 0xD9:
                return this.#decodeString( buffer.readUint8() );
            case 0xDA:
                return this.#decodeString( buffer.readUint16() );
            case 0xDB:
                return this.#decodeString( buffer.readUint32() );

            // array 16, 32
            case 0xDC:
                return this.#decodeArray( buffer.readUint16() );
            case 0xDD:
                return this.#decodeArray( buffer.readUint32() );

            // map 16, 32
            case 0xDE:
                return this.#decodeMap( buffer.readUint16() );
            case 0xDF:
                return this.#decodeMap( buffer.readUint32() );
        }

        throw new TypeError( `Invalid MsgPack type: 0x${ type.toString( 16 ) }` );
    }

    #assertAvailable ( length ) {
        if ( this.#buffer.offset + length > this.#buffer.length ) {
            throw new IncompleteDataError();
        }
    }

    #decodeString ( length ) {
        this.#assertAvailable( length );

        return this.#buffer.readString( length );
    }

    #readBytes ( length ) {
        this.#assertAvailable( length );

        return this.#buffer.readBytes( length );
    }

    #decodeBinary ( length ) {
        return this.#readBytes( length );
    }

    #decodeArray ( length ) {

        // every element takes at least 1 byte
        this.#assertAvailable( length );

        const result = new Array( length );

        for ( let index = 0; index < length; index++ ) {
            result[ index ] = this.#decode();
        }

        return result;
    }

    #decodeMap ( length ) {

        // every pair takes at least 2 bytes
        this.#assertAvailable( length * 2 );

        const result = {};

        for ( let index = 0; index < length; index++ ) {
            const key = this.#decodeKey(),
                value = this.#decode();

            // plain assignment of "__proto__" would change the prototype of the result
            if ( key === "__proto__" ) {
                Object.defineProperty( result, key, {
                    "value": value,
                    "writable": true,
                    "enumerable": true,
                    "configurable": true,
                } );
            }
            else {
                result[ key ] = value;
            }
        }

        return result;
    }

    #decodeKey () {
        this.#assertAvailable( 1 );

        const buffer = this.#buffer,
            type = buffer.peekUint8();

        let length;

        // fixstr
        if ( type >= 0xA0 && type <= 0xBF ) {
            length = type & 0x1F;

            buffer.skip( 1 );
        }

        // str 8
        else if ( type === 0xD9 ) {
            this.#assertAvailable( 2 );

            length = buffer.peekUint8( 1 );

            buffer.skip( 2 );
        }
        else {
            const key = this.#decode();

            if ( typeof key !== "string" ) {
                throw new TypeError( `MsgPack map key must be a string, got ${ key === null
                    ? "null"
                    : typeof key }` );
            }

            return key;
        }

        return this.#decodeKeyString( length );
    }

    #decodeKeyString ( length ) {
        if ( length === 0 || length > KEY_CACHE_MAX_LENGTH ) return this.#decodeString( length );

        this.#assertAvailable( length );

        const buffer = this.#buffer;

        let hash = 0x811C_9DC5,
            ascii = 0;

        for ( let index = 0; index < length; index++ ) {
            const code = buffer.peekUint8( index );

            hash = Math.imul( hash ^ code, 0x0100_0193 );
            ascii |= code;
        }

        if ( ascii > 0x7F ) return this.#decodeString( length );

        const slot = ( hash ^ ( hash >>> 15 ) ) & ( KEY_CACHE_SIZE - 1 ),
            cached = KEY_CACHE[ slot ];

        if ( cached.length === length ) {
            let index = 0;

            while ( index < length && cached.codePointAt( index ) === buffer.peekUint8( index ) ) index++;

            if ( index === length ) {
                buffer.skip( length );

                return cached;
            }
        }

        const key = this.#decodeString( length );

        KEY_CACHE[ slot ] = key;

        return key;
    }

    #decodeExtension ( length ) {
        const buffer = this.#buffer,
            type = buffer.readInt8(),
            extension = EXTENSIONS.get( type );

        if ( !extension?.decode ) {
            throw new TypeError( `Unsupported MsgPack extension type: ${ type }` );
        }

        this.#assertAvailable( length );

        // the data of a binary extension is read by the extension itself, otherwise it is a regular MsgPack value
        const end = buffer.offset + length,
            value = extension.binary
                ? extension.decode( buffer, length, extension.instanceOf )
                : extension.decode( this.#decode(), extension.instanceOf );

        if ( buffer.offset !== end ) {
            throw new RangeError( `Invalid MsgPack extension data length: ${ length }` );
        }

        return value;
    }
}

class Encoder {
    #buffer = new MessageBuffer( { "size": DEFAULT_BUFFER_SIZE } );

    // public
    toMessagePack ( value ) {
        try {
            this.#encode( value );
        }
        catch ( e ) {
            this.#buffer.clear();

            throw e;
        }

        return this.#buffer.reset();
    }

    // private
    #encode ( value, key = "" ) {
        const type = typeof value;

        if ( value === null ) {
            this.#buffer.writeUint8( 0xC0 );
        }
        else if ( type === "boolean" ) {
            this.#buffer.writeUint8( value
                ? 0xC3
                : 0xC2 );
        }
        else if ( type === "number" ) {
            this.#encodeNumber( value );
        }
        else if ( type === "string" ) {
            this.#encodeString( value );
        }
        else if ( Array.isArray( value ) ) {
            this.#encodeArray( value );
        }
        else if ( value instanceof ArrayBuffer ) {
            this.#encodeBinary( new Uint8Array( value ) );
        }
        else if ( isPlainObject( value ) && typeof value.toJSON !== "function" ) {
            this.#encodePlainObject( value );
        }
        else {
            this.#encodeNonStandard( value, key );
        }
    }

    #findExtension ( value ) {
        const type = typeof value;

        // the nearest registered constructor in the prototype chain wins, so Buffer is handled as Uint8Array
        if ( type === "object" || type === "function" ) {
            for ( let prototype = Object.getPrototypeOf( value ); prototype !== null; prototype = Object.getPrototypeOf( prototype ) ) {
                const extension = EXTENSIONS_INSTANCE.get( prototype.constructor );

                if ( extension ) return extension;
            }
        }

        return EXTENSIONS_TYPEOF.get( type );
    }

    #encodeNonStandard ( value, key ) {
        const extension = this.#findExtension( value );

        // registered extension
        if ( extension?.encode ) {

            // the data of a binary extension is written by the extension itself, otherwise it is a regular MsgPack value
            if ( extension.binary ) {
                this.#encodeBinaryExtension( extension, value );
            }
            else {
                this.#encodeNestedExtension( extension.type, extension.encode( value ) );
            }
        }

        // toJSON is called the same way as JSON.stringify does, with the property name or array index
        else if ( typeof value === "object" && value !== null && typeof value.toJSON === "function" ) {
            const result = value.toJSON( String( key ) );

            // toJSON returned the same object, encode it as is
            if ( result === value ) {
                this.#encodePlainObject( value );
            }
            else {
                this.#encode( result, key );
            }
        }
        else {
            const name = typeof value === "object"
                ? ( value.constructor?.name ?? "Object" )
                : typeof value;

            throw new TypeError( `Unsupported type: ${ name }` );
        }
    }

    #encodeNumber ( value ) {
        if ( Number.isSafeInteger( value ) ) {
            this.#encodeInteger( value );
        }
        else {

            // fractions, NaN, +-Infinity and integers outside of the safe range
            this.#buffer.writeUint8( 0xCB );
            this.#buffer.writeFloat64( value );
        }
    }

    #encodeInteger ( value ) {

        // positive
        if ( value >= 0 ) {

            // positive fixint
            if ( value <= 0x7F ) {
                this.#buffer.writeUint8( value );
            }

            // uint 8
            else if ( value <= 0xFF ) {
                this.#buffer.writeUint8( 0xCC );
                this.#buffer.writeUint8( value );
            }

            // uint 16
            else if ( value <= 0xFFFF ) {
                this.#buffer.writeUint8( 0xCD );
                this.#buffer.writeUint16( value );
            }

            // uint 32
            else if ( value <= MAX_UINT32 ) {
                this.#buffer.writeUint8( 0xCE );
                this.#buffer.writeUint32( value );
            }

            // uint 64
            else {
                this.#buffer.writeUint8( 0xCF );
                this.#buffer.writeBigUint64( BigInt( value ) );
            }
        }

        // negative
        else {

            // negative fixint
            if ( value >= -32 ) {
                this.#buffer.writeInt8( value );
            }

            // int 8
            else if ( value >= -0x80 ) {
                this.#buffer.writeUint8( 0xD0 );
                this.#buffer.writeInt8( value );
            }

            // int 16
            else if ( value >= -0x8000 ) {
                this.#buffer.writeUint8( 0xD1 );
                this.#buffer.writeInt16( value );
            }

            // int 32
            else if ( value >= -0x8000_0000 ) {
                this.#buffer.writeUint8( 0xD2 );
                this.#buffer.writeInt32( value );
            }

            // int 64
            else {
                this.#buffer.writeUint8( 0xD3 );
                this.#buffer.writeBigInt64( BigInt( value ) );
            }
        }
    }

    #encodeString ( value ) {
        this.#buffer.writeMsgPackString( value );
    }

    #encodeBinary ( bytes ) {
        const length = bytes.length;

        // bin 8
        if ( length <= 0xFF ) {
            this.#buffer.writeUint8( 0xC4 );
            this.#buffer.writeUint8( length );
        }

        // bin 16
        else if ( length <= 0xFFFF ) {
            this.#buffer.writeUint8( 0xC5 );
            this.#buffer.writeUint16( length );
        }

        // bin 32
        else {
            this.#assertLength( length, "Binary" );

            this.#buffer.writeUint8( 0xC6 );
            this.#buffer.writeUint32( length );
        }

        this.#buffer.writeBytes( bytes );
    }

    #encodeArray ( value ) {
        this.#writeArrayHeader( value.length );

        for ( let index = 0; index < value.length; index++ ) {
            this.#encode( value[ index ], index );
        }
    }

    #writeArrayHeader ( length ) {

        // fixarray
        if ( length < 16 ) {
            this.#buffer.writeUint8( 0x90 | length );
        }

        // array 16
        else if ( length <= 0xFFFF ) {
            this.#buffer.writeUint8( 0xDC );
            this.#buffer.writeUint16( length );
        }

        // array 32
        else {
            this.#assertLength( length, "Array" );

            this.#buffer.writeUint8( 0xDD );
            this.#buffer.writeUint32( length );
        }
    }

    #encodePlainObject ( value ) {
        const keys = Object.keys( value );

        this.#writeMapHeader( keys.length );

        for ( const key of keys ) {
            this.#encodeString( key );
            this.#encode( value[ key ], key );
        }
    }

    #writeMapHeader ( length ) {

        // fixmap
        if ( length < 16 ) {
            this.#buffer.writeUint8( 0x80 | length );
        }

        // map 16
        else if ( length <= 0xFFFF ) {
            this.#buffer.writeUint8( 0xDE );
            this.#buffer.writeUint16( length );
        }

        // map 32
        else {
            this.#assertLength( length, "Map" );

            this.#buffer.writeUint8( 0xDF );
            this.#buffer.writeUint32( length );
        }
    }

    #encodeNestedExtension ( type, data ) {
        const start = this.#buffer.offset;

        this.#encode( data );

        this.#encodeExtension( type, new Uint8Array( this.#buffer.truncate( start ) ) );
    }

    #encodeBinaryExtension ( extension, value ) {
        const data = extension.encode( value );

        let bytes;

        // no data
        if ( data === undefined ) {
            bytes = EMPTY_BYTES;
        }

        // string is encoded as UTF-8
        else if ( typeof data === "string" ) {
            bytes = TEXT_ENCODER.encode( data );
        }

        // ArrayBuffer view, byteOffset and byteLength are respected for any kind of view
        else if ( ArrayBuffer.isView( data ) ) {
            bytes = new Uint8Array( data.buffer, data.byteOffset, data.byteLength );
        }
        else if ( data instanceof ArrayBuffer ) {
            bytes = new Uint8Array( data );
        }
        else {
            throw new TypeError( `MsgPack extension ${ extension.type } must encode to undefined, a string, an ArrayBuffer or an ArrayBuffer view` );
        }

        this.#encodeExtension( extension.type, bytes );
    }

    #encodeExtension ( type, data ) {
        this.#writeExtensionHeader( type, data.length );

        this.#buffer.writeBytes( data );
    }

    #writeExtensionHeader ( type, length ) {

        // fixext 1, 2, 4, 8, 16
        if ( length === 1 ) {
            this.#buffer.writeUint8( 0xD4 );
        }
        else if ( length === 2 ) {
            this.#buffer.writeUint8( 0xD5 );
        }
        else if ( length === 4 ) {
            this.#buffer.writeUint8( 0xD6 );
        }
        else if ( length === 8 ) {
            this.#buffer.writeUint8( 0xD7 );
        }
        else if ( length === 16 ) {
            this.#buffer.writeUint8( 0xD8 );
        }

        // ext 8
        else if ( length <= 0xFF ) {
            this.#buffer.writeUint8( 0xC7 );
            this.#buffer.writeUint8( length );
        }

        // ext 16
        else if ( length <= 0xFFFF ) {
            this.#buffer.writeUint8( 0xC8 );
            this.#buffer.writeUint16( length );
        }

        // ext 32
        else {
            this.#assertLength( length, "Extension" );

            this.#buffer.writeUint8( 0xC9 );
            this.#buffer.writeUint32( length );
        }

        this.#buffer.writeInt8( type );
    }

    #assertLength ( length, name ) {
        if ( length > MAX_UINT32 ) {
            throw new RangeError( `${ name } is too long: ${ length }` );
        }
    }
}

export class MessagePack extends Encoder {

    // public
    fromMessagePack ( data ) {
        return new Decoder( data ).decode();
    }

    fromMessagePackStream ( data, offset = 0 ) {
        return new Decoder( data, offset ).decodeStream();
    }

    registerExtension ( type, { instanceOf, typeOf, encode, decode, binary, force } = {} ) {
        if ( isPlainObject( type ) ) {
            for ( const [ exttype, options ] of Object.entries( type ) ) {
                this.registerExtension( Number( exttype ), options );
            }
        }
        else {
            if ( !Number.isInteger( type ) || type < -128 || type > 127 ) {
                throw new RangeError( `MsgPack extension type must be an integer in range -128..127, got ${ type }` );
            }

            if ( encode && !instanceOf && !typeOf ) {
                throw new TypeError( "MsgPack extension with encode method requires instanceOf or typeOf" );
            }

            const conflicts = [ EXTENSIONS.get( type ), instanceOf && EXTENSIONS_INSTANCE.get( instanceOf ), typeOf && EXTENSIONS_TYPEOF.get( typeOf ) ].filter( Boolean );

            if ( conflicts.length ) {
                if ( !force ) {
                    throw new Error( "MsgPack extension already registered" );
                }

                for ( const extension of conflicts ) {
                    this.#unregisterExtension( extension );
                }
            }

            const extension = {
                type,
                instanceOf,
                typeOf,
                encode,
                decode,
                binary,
            };

            EXTENSIONS.set( type, extension );

            if ( instanceOf ) {
                EXTENSIONS_INSTANCE.set( instanceOf, extension );
            }

            if ( typeOf ) {
                EXTENSIONS_TYPEOF.set( typeOf, extension );
            }
        }

        return this;
    }

    // private
    #unregisterExtension ( extension ) {
        EXTENSIONS.delete( extension.type );

        if ( extension.instanceOf ) {
            EXTENSIONS_INSTANCE.delete( extension.instanceOf );
        }

        if ( extension.typeOf ) {
            EXTENSIONS_TYPEOF.delete( extension.typeOf );
        }
    }
}

const messagePack = new MessagePack();

export default messagePack;

const encodeView = value => value,
    decodeView = ( messageBuffer, length, constructor ) => new constructor( messageBuffer.readBytes( length ) ),
    encodeTemporal = value => value.toString(),
    decodeTemporal = ( messageBuffer, length, constructor ) => constructor.from( messageBuffer.readString( length ) );

messagePack.registerExtension( {

    // timestamp
    "-1": {
        "instanceOf": Temporal.Instant,
        "encode": value => {
            const epoch = value.epochNanoseconds;

            let seconds = epoch / 1_000_000_000n,
                nanoseconds = epoch % 1_000_000_000n;

            // BigInt division truncates towards zero, but the timestamp requires non-negative nanoseconds
            if ( nanoseconds < 0n ) {
                nanoseconds += 1_000_000_000n;
                seconds -= 1n;
            }

            // timestamp 96, 32 bits of nanoseconds and 64 bits of seconds
            if ( epoch < 0n || epoch >= 2n ** 34n * 1_000_000_000n ) {
                const view = new DataView( new ArrayBuffer( 12 ) );

                view.setUint32( 0, Number( nanoseconds ) );
                view.setBigInt64( 4, seconds );

                return view;
            }

            // timestamp 32
            if ( nanoseconds === 0n && seconds <= 0xFFFF_FFFFn ) {
                const view = new DataView( new ArrayBuffer( 4 ) );

                view.setUint32( 0, Number( seconds ) );

                return view;
            }

            // timestamp 64, 30 bits of nanoseconds and 34 bits of seconds
            const view = new DataView( new ArrayBuffer( 8 ) );

            view.setBigUint64( 0, ( nanoseconds << 34n ) | seconds );

            return view;
        },
        "decode": ( messageBuffer, length, constructor ) => {
            let seconds, nanoseconds;

            // timestamp 32
            if ( length === 4 ) {
                seconds = BigInt( messageBuffer.readUint32() );
                nanoseconds = 0n;
            }

            // timestamp 64, 30 bits of nanoseconds and 34 bits of seconds
            else if ( length === 8 ) {
                const value = BigInt( messageBuffer.readBigUint64() );

                seconds = value & 0x3_FFFF_FFFFn;
                nanoseconds = value >> 34n;
            }

            // timestamp 96, 32 bits of nanoseconds and 64 bits of seconds
            else if ( length === 12 ) {
                nanoseconds = BigInt( messageBuffer.readUint32() );
                seconds = BigInt( messageBuffer.readBigInt64() );
            }
            else {
                throw new RangeError( `Invalid timestamp length: ${ length }` );
            }

            return new constructor( seconds * 1_000_000_000n + nanoseconds );
        },
        "binary": true,
    },

    // undefined
    "0": {
        "typeOf": "undefined",
        "encode": () => {},
        "decode": () => {},
        "binary": true,
    },

    // BigInt
    "1": {
        "typeOf": "bigint",
        "encode": value => value.toString(),
        "decode": ( messageBuffer, length ) => BigInt( messageBuffer.readString( length ) ),
        "binary": true,
    },

    // View
    "2": {
        "instanceOf": Int8Array,
        "encode": encodeView,
        "decode": decodeView,
        "binary": true,
    },
    "3": {
        "instanceOf": Uint8Array,
        "encode": encodeView,
        "decode": decodeView,
        "binary": true,
    },
    "4": {
        "instanceOf": Uint8ClampedArray,
        "encode": encodeView,
        "decode": decodeView,
        "binary": true,
    },
    "5": {
        "instanceOf": Int16Array,
        "encode": encodeView,
        "decode": decodeView,
        "binary": true,
    },
    "6": {
        "instanceOf": Uint16Array,
        "encode": encodeView,
        "decode": decodeView,
        "binary": true,
    },
    "7": {
        "instanceOf": Int32Array,
        "encode": encodeView,
        "decode": decodeView,
        "binary": true,
    },
    "8": {
        "instanceOf": Uint32Array,
        "encode": encodeView,
        "decode": decodeView,
        "binary": true,
    },
    "9": {
        "instanceOf": Float32Array,
        "encode": encodeView,
        "decode": decodeView,
        "binary": true,
    },
    "10": {
        "instanceOf": Float64Array,
        "encode": encodeView,
        "decode": decodeView,
        "binary": true,
    },
    "11": {
        "instanceOf": BigInt64Array,
        "encode": encodeView,
        "decode": decodeView,
        "binary": true,
    },
    "12": {
        "instanceOf": BigUint64Array,
        "encode": encodeView,
        "decode": decodeView,
        "binary": true,
    },
    "13": {
        "instanceOf": DataView,
        "encode": encodeView,
        "decode": decodeView,
        "binary": true,
    },

    // Buffer
    "14": {
        "decode": ( messageBuffer, length ) => messageBuffer.readBytes( length ),
        "binary": true,
    },

    // Date
    "15": {
        "instanceOf": Date,
        "encode": value => {
            const view = new DataView( new ArrayBuffer( 8 ) );

            view.setFloat64( 0, value.getTime() );

            return view;
        },
        "decode": messageBuffer => new Date( messageBuffer.readFloat64() ),
        "binary": true,
    },

    // Temporal
    "16": {
        "instanceOf": Temporal.ZonedDateTime,
        "encode": encodeTemporal,
        "decode": ( messageBuffer, length, constructor ) => {
            return constructor.from( messageBuffer.readString( length ), {
                "offset": "use",
            } );
        },
        "binary": true,
    },
    "17": {
        "instanceOf": Temporal.PlainDateTime,
        "encode": encodeTemporal,
        "decode": decodeTemporal,
        "binary": true,
    },
    "18": {
        "instanceOf": Temporal.PlainDate,
        "encode": encodeTemporal,
        "decode": decodeTemporal,
        "binary": true,
    },
    "19": {
        "instanceOf": Temporal.PlainTime,
        "encode": encodeTemporal,
        "decode": decodeTemporal,
        "binary": true,
    },
    "20": {
        "instanceOf": Temporal.PlainYearMonth,
        "encode": encodeTemporal,
        "decode": decodeTemporal,
        "binary": true,
    },
    "21": {
        "instanceOf": Temporal.PlainMonthDay,
        "encode": encodeTemporal,
        "decode": decodeTemporal,
        "binary": true,
    },
    "22": {
        "instanceOf": Temporal.Duration,
        "encode": encodeTemporal,
        "decode": decodeTemporal,
        "binary": true,
    },
} );
