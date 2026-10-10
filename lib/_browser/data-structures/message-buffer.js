const DEFAULT_BUFFER_SIZE = 4096,
    TEXT_ENCODER = new TextEncoder(),
    TEXT_DECODER = new TextDecoder(),
    MAX_ENCODE_INTO_LENGTH = 4096,
    MAX_SHORT_STRING_LENGTH = 12,
    MAX_JS_UTF8_LENGTH = 16,
    MAX_UINT32 = 0xFFFF_FFFF;

const copyBytes = ( bytes, start, end ) => Uint8Array.prototype.slice.call( bytes, start, end ).buffer;

export default class MessageBuffer {
    #size;
    #uint8Array;
    #dataView;
    #offset;
    #owned;

    constructor ( { size, data, offset } = {} ) {
        this.#size = size || DEFAULT_BUFFER_SIZE;

        let uint8Array;

        if ( data ) {
            if ( data instanceof Uint8Array ) {
                uint8Array = data;
            }
            else if ( data instanceof ArrayBuffer ) {
                uint8Array = new Uint8Array( data );
            }
            else if ( ArrayBuffer.isView( data ) ) {
                uint8Array = new Uint8Array( data.buffer, data.byteOffset, data.byteLength );
            }
            else {
                throw new TypeError( "Data must be an ArrayBuffer or an ArrayBuffer view" );
            }

            offset ??= 0;

            if ( !Number.isSafeInteger( offset ) || offset < 0 || offset > uint8Array.length ) {
                throw new RangeError( `Offset must be an integer in range 0..${ uint8Array.length }, got ${ String( offset ) }` );
            }

            this.#owned = false;
            this.#offset = offset;
        }
        else {
            uint8Array = new Uint8Array( this.#size );

            this.#owned = true;
            this.#offset = 0;
        }

        this.#setUint8Array( uint8Array );
    }

    // properties
    get uint8Array () {
        return this.#uint8Array;
    }

    get offset () {
        return this.#offset;
    }

    get length () {
        return this.#uint8Array.length;
    }

    // public
    reset () {
        try {
            const bytes = this.#uint8Array.subarray( 0, this.#offset );

            return copyBytes( bytes );
        }
        finally {
            this.clear();
        }
    }

    truncate ( start ) {
        if ( !Number.isSafeInteger( start ) || start < 0 || start > this.#offset ) {
            throw new RangeError( `Offset must be an integer in range 0..${ this.#offset }, got ${ String( start ) }` );
        }

        const buffer = copyBytes( this.#uint8Array, start, this.#offset );

        this.#offset = start;

        return buffer;
    }

    clear () {
        this.#offset = 0;

        // data passed by the caller is not reused, so it is not overwritten, a big buffer is released
        if ( !this.#owned || this.#uint8Array.length > this.#size ) {
            this.#setUint8Array( new Uint8Array( this.#size ) );

            this.#owned = true;
        }

        return this;
    }

    // XXX
    peekUint8 ( ahead = 0 ) {
        return this.#uint8Array[ this.#offset + ahead ];
    }

    skip ( length ) {
        this.#assertAvailable( length );

        this.#offset += length;

        return this;
    }

    readString ( length ) {
        this.#assertAvailable( length );

        const bytes = this.#uint8Array,
            start = this.#offset,
            end = start + length;

        this.#offset = end;

        // short ASCII strings are decoded faster without TextDecoder, which has a fixed overhead on every call
        if ( length <= MAX_SHORT_STRING_LENGTH ) {
            let result = "";

            for ( let index = start; index < end; index++ ) {
                const code = bytes[ index ];

                if ( code > 0x7F ) return TEXT_DECODER.decode( bytes.subarray( start, end ) );

                result += String.fromCodePoint( code );
            }

            return result;
        }

        return TEXT_DECODER.decode( bytes.subarray( start, end ) );
    }

    readUint8Array ( length ) {
        this.#assertAvailable( length );

        const start = this.#offset;

        this.#offset += length;

        return copyBytes( this.#uint8Array, start, start + length );
    }

    readUint8 () {
        return this.#uint8Array[ this.#offset++ ];
    }

    readInt8 () {
        const value = this.#getDataView().getInt8( this.#offset );

        this.#offset += 1;

        return value;
    }

    readUint16 () {
        const value = this.#getDataView().getUint16( this.#offset );

        this.#offset += 2;

        return value;
    }

    readInt16 () {
        const value = this.#getDataView().getInt16( this.#offset );

        this.#offset += 2;

        return value;
    }

    readUint32 () {
        const value = this.#getDataView().getUint32( this.#offset );

        this.#offset += 4;

        return value;
    }

    readInt32 () {
        const value = this.#getDataView().getInt32( this.#offset );

        this.#offset += 4;

        return value;
    }

    readBigUint64 () {
        const offset = this.#offset,
            high = this.#getDataView().getUint32( offset );

        this.#offset += 8;

        // high < 2 ** 21 means that the value is less than 2 ** 53
        return high < 0x200000
            ? high * 0x1_0000_0000 + this.#getDataView().getUint32( offset + 4 )
            : this.#getDataView().getBigUint64( offset );
    }

    readBigInt64 () {
        const offset = this.#offset,
            high = this.#getDataView().getInt32( offset );

        this.#offset += 8;

        if ( high >= -0x200000 && high < 0x200000 ) {
            const value = high * 0x1_0000_0000 + this.#getDataView().getUint32( offset + 4 );

            if ( value >= Number.MIN_SAFE_INTEGER ) return value;
        }

        return this.#getDataView().getBigInt64( offset );
    }

    readFloat32 () {
        const value = this.#getDataView().getFloat32( this.#offset );

        this.#offset += 4;

        return value;
    }

    readFloat64 () {
        const value = this.#getDataView().getFloat64( this.#offset );

        this.#offset += 8;

        return value;
    }

    writeUint8 ( value, offset ) {
        if ( offset == null ) {
            this.#checkBufferLength( 1 );

            this.#uint8Array[ this.#offset++ ] = value;
        }
        else {
            this.#uint8Array[ offset ] = value;
        }

        return this;
    }

    writeInt8 ( value, offset ) {
        if ( offset == null ) {
            this.#checkBufferLength( 1 );

            this.#uint8Array[ this.#offset++ ] = value;
        }
        else {
            this.#uint8Array[ offset ] = value;
        }

        return this;
    }

    writeUint16 ( value, offset ) {
        if ( offset == null ) {
            this.#checkBufferLength( 2 );

            this.#getDataView().setUint16( this.#offset, value );

            this.#offset += 2;
        }
        else {
            this.#getDataView().setUint16( offset, value );
        }

        return this;
    }

    writeInt16 ( value, offset ) {
        if ( offset == null ) {
            this.#checkBufferLength( 2 );

            this.#getDataView().setInt16( this.#offset, value );

            this.#offset += 2;
        }
        else {
            this.#getDataView().setInt16( offset, value );
        }

        return this;
    }

    writeUint32 ( value, offset ) {
        if ( offset == null ) {
            this.#checkBufferLength( 4 );

            this.#getDataView().setUint32( this.#offset, value );

            this.#offset += 4;
        }
        else {
            this.#getDataView().setUint32( offset, value );
        }

        return this;
    }

    writeInt32 ( value, offset ) {
        if ( offset == null ) {
            this.#checkBufferLength( 4 );

            this.#getDataView().setInt32( this.#offset, value );

            this.#offset += 4;
        }
        else {
            this.#getDataView().setInt32( offset, value );
        }

        return this;
    }

    writeBigUint64 ( value, offset ) {
        if ( offset == null ) {
            this.#checkBufferLength( 8 );

            this.#getDataView().setBigUint64( this.#offset, value );

            this.#offset += 8;
        }
        else {
            this.#getDataView().setBigUint64( offset, value );
        }

        return this;
    }

    writeBigInt64 ( value, offset ) {
        if ( offset == null ) {
            this.#checkBufferLength( 8 );

            this.#getDataView().setBigInt64( this.#offset, value );

            this.#offset += 8;
        }
        else {
            this.#getDataView().setBigInt64( offset, value );
        }

        return this;
    }

    writeFloat64 ( value, offset ) {
        if ( offset == null ) {
            this.#checkBufferLength( 8 );

            this.#getDataView().setFloat64( this.#offset, value );

            this.#offset += 8;
        }
        else {
            this.#getDataView().setFloat64( offset, value );
        }

        return this;
    }

    writeNull ( n = 1 ) {
        if ( n === 1 ) {
            return this.writeUint8( 0 );
        }
        else {
            this.#checkBufferLength( n );

            const start = this.#offset,
                end = start + n;

            this.#uint8Array.fill( 0, start, end );

            this.#offset += n;

            return this;
        }
    }

    write ( value ) {

        // string
        if ( typeof value === "string" ) {
            const length = value.length;

            if ( length <= MAX_ENCODE_INTO_LENGTH ) {

                // UTF-8 takes at most 3 bytes per UTF-16 code unit
                this.#checkBufferLength( length * 3 );

                const { written } = TEXT_ENCODER.encodeInto( value, this.#uint8Array.subarray( this.#offset ) );

                this.#offset += written;
            }
            else {
                this.writeBytes( TEXT_ENCODER.encode( value ) );
            }
        }

        // ArrayBuffer view, byteOffset and byteLength are respected for any kind of view
        else if ( ArrayBuffer.isView( value ) ) {
            this.writeBytes( new Uint8Array( value.buffer, value.byteOffset, value.byteLength ) );
        }

        // ArrayBuffer
        else if ( value instanceof ArrayBuffer ) {
            this.writeBytes( new Uint8Array( value ) );
        }
        else {
            throw new TypeError( "Value must be a string, an ArrayBuffer or an ArrayBuffer view" );
        }

        return this;
    }

    writeBytes ( bytes ) {
        this.#checkBufferLength( bytes.length );

        this.#uint8Array.set( bytes, this.#offset );

        this.#offset += bytes.length;

        return this;
    }

    writeMsgPackString ( value ) {
        const length = value.length;

        // TextEncoder.encodeInto needs a destination of the known size, so long strings are encoded separately
        if ( length > MAX_ENCODE_INTO_LENGTH ) {
            const bytes = TEXT_ENCODER.encode( value );

            this.#writeStringHeader( bytes.length );
            this.writeBytes( bytes );

            return this;
        }

        // the size of the header is guessed by the length of the string, UTF-8 is never shorter than UTF-16 code units count, so the guess is wrong only for multibyte strings, then the data is shifted
        let guessedSize;

        if ( length < 0x20 ) {
            guessedSize = 1;
        }
        else if ( length <= 0xFF ) {
            guessedSize = 2;
        }
        else {
            guessedSize = 3;
        }

        // UTF-8 takes at most 3 bytes per UTF-16 code unit, the header takes at most 3 bytes
        this.#checkBufferLength( 3 + length * 3 );

        const bytes = this.#uint8Array,
            offset = this.#offset,
            start = offset + guessedSize;

        let end;

        if ( length <= MAX_JS_UTF8_LENGTH ) {
            end = this.#writeUtf8( bytes, start, value, length );
        }
        else {
            end = start + TEXT_ENCODER.encodeInto( value, bytes.subarray( start ) ).written;
        }

        const written = end - start;

        let headerSize;

        if ( written < 0x20 ) {
            headerSize = 1;
        }
        else if ( written <= 0xFF ) {
            headerSize = 2;
        }
        else {
            headerSize = 3;
        }

        if ( headerSize !== guessedSize ) {
            bytes.copyWithin( offset + headerSize, start, end );

            end += headerSize - guessedSize;
        }

        if ( headerSize === 1 ) {
            bytes[ offset ] = 0xA0 | written;
        }
        else if ( headerSize === 2 ) {
            bytes[ offset ] = 0xD9;
            bytes[ offset + 1 ] = written;
        }
        else {
            bytes[ offset ] = 0xDA;
            bytes[ offset + 1 ] = written >> 8;
            bytes[ offset + 2 ] = written;
        }

        this.#offset = end;

        return this;
    }

    // private
    #writeUtf8 ( bytes, offset, value, length ) {
        for ( let index = 0; index < length; index++ ) {
            let code = value.codePointAt( index );

            if ( code < 0x80 ) {
                bytes[ offset++ ] = code;
            }
            else if ( code < 0x800 ) {
                bytes[ offset++ ] = 0xC0 | ( code >> 6 );
                bytes[ offset++ ] = 0x80 | ( code & 0x3F );
            }
            else if ( code < 0x10000 ) {
                if ( code >= 0xD800 && code <= 0xDFFF ) code = 0xFFFD;

                bytes[ offset++ ] = 0xE0 | ( code >> 12 );
                bytes[ offset++ ] = 0x80 | ( ( code >> 6 ) & 0x3F );
                bytes[ offset++ ] = 0x80 | ( code & 0x3F );
            }
            else {

                // surrogate pair, takes two UTF-16 code units
                index++;

                bytes[ offset++ ] = 0xF0 | ( code >> 18 );
                bytes[ offset++ ] = 0x80 | ( ( code >> 12 ) & 0x3F );
                bytes[ offset++ ] = 0x80 | ( ( code >> 6 ) & 0x3F );
                bytes[ offset++ ] = 0x80 | ( code & 0x3F );
            }
        }

        return offset;
    }

    #writeStringHeader ( length ) {

        // fixstr
        if ( length < 0x20 ) {
            this.writeUint8( 0xA0 | length );
        }

        // str 8
        else if ( length <= 0xFF ) {
            this.writeUint8( 0xD9 );
            this.writeUint8( length );
        }

        // str 16
        else if ( length <= 0xFFFF ) {
            this.writeUint8( 0xDA );
            this.writeUint16( length );
        }

        // str 32
        else if ( length <= MAX_UINT32 ) {
            this.writeUint8( 0xDB );
            this.writeUint32( length );
        }
        else {
            throw new RangeError( `String is too long: ${ length }` );
        }
    }

    #setUint8Array ( uint8Array ) {
        this.#uint8Array = uint8Array;

        this.#dataView = null;
    }

    #getDataView () {
        this.#dataView ??= new DataView( this.#uint8Array.buffer, this.#uint8Array.byteOffset, this.#uint8Array.byteLength );

        return this.#dataView;
    }

    #checkBufferLength ( length ) {
        const required = this.#offset + length;

        if ( required > this.#uint8Array.length ) {
            const bytes = new Uint8Array( Math.max( this.#uint8Array.length * 2, required ) );

            bytes.set( this.#uint8Array.subarray( 0, this.#offset ) );

            this.#setUint8Array( bytes );

            this.#owned = true;
        }
    }

    #assertAvailable ( length ) {
        if ( this.#offset + length > this.#uint8Array.length ) {
            throw new RangeError();
        }
    }
}
