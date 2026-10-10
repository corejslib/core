import BrowserMessageBuffer from "#lib/_browser/data-structures/message-buffer";

// V8 allocates typed arrays up to this size on the heap, so a regular copy is faster than a pooled Buffer for them
const MAX_ON_HEAP_LENGTH = 64,
    MAX_SHORT_STRING_LENGTH = 12, // the same threshold as in the browser MessageBuffer, shorter strings are decoded there without a native call
    MAX_ENCODE_INTO_LENGTH = 4096, // the same threshold as in the browser MessageBuffer, longer strings are encoded here
    MAX_UINT32 = 0xFFFF_FFFF,
    UTF8_SLICE = Buffer.prototype.utf8Slice,
    UTF8_WRITE = Buffer.prototype.utf8Write;

export default class MessageBuffer extends BrowserMessageBuffer {
    reset () {
        const length = this.offset;

        if ( length <= MAX_ON_HEAP_LENGTH ) return super.reset();

        try {
            const buffer = Buffer.allocUnsafe( length );

            buffer.set( this.uint8Array.subarray( 0, length ) );

            // Buffer is used only as a fast allocator, the result is not a Buffer
            return new Uint8Array( buffer.buffer, buffer.byteOffset, length );
        }
        finally {
            this.clear();
        }
    }

    readString ( length, offset ) {
        if ( length <= MAX_SHORT_STRING_LENGTH ) return super.readString( length, offset );

        const bytes = this.uint8Array;

        const start = offset ?? this.offset;

        // invalid arguments and out of bounds are reported by the base class
        if ( !Number.isSafeInteger( length ) || !Number.isSafeInteger( start ) || start < 0 || start + length > bytes.length ) {
            return super.readString( length, offset );
        }

        const end = start + length;

        if ( offset == null ) this.setOffset( end );

        // a leading BOM (U+FEFF) is a regular character and is kept, the same as in the browser MessageBuffer (TextDecoder with ignoreBOM), invalid UTF-8 is replaced with U+FFFD
        return UTF8_SLICE.call( bytes, start, end );
    }

    writeMsgPackString ( value ) {
        if ( value.length <= MAX_ENCODE_INTO_LENGTH ) return super.writeMsgPackString( value );

        // the string is long, so the size is calculated exactly and the string is written directly into the buffer, without a temporary copy
        const length = Buffer.byteLength( value );

        // UTF-8 is never shorter than UTF-16 code units count, so the length is always greater than 0xFF, and str 8 is not possible
        if ( length <= 0xFFFF ) {
            this.writeUint8( 0xDA );
            this.writeUint16( length );
        }
        else if ( length <= MAX_UINT32 ) {
            this.writeUint8( 0xDB );
            this.writeUint32( length );
        }
        else {
            throw new RangeError( `String is too long: ${ length }` );
        }

        this._checkBufferLength( length );

        const offset = this.offset;

        UTF8_WRITE.call( this.uint8Array, value, offset, length );

        return this.setOffset( offset + length );
    }
}
