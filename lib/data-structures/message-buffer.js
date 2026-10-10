import BrowserMessageBuffer from "#lib/_browser/data-structures/message-buffer";

// V8 allocates typed arrays up to this size on the heap, so a regular copy is faster than a pooled Buffer for them
const MAX_ON_HEAP_LENGTH = 64,
    MAX_SHORT_STRING_LENGTH = 12, // the same threshold as in the browser MessageBuffer, shorter strings are decoded there without a native call
    UTF8_SLICE = Buffer.prototype.utf8Slice;

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
}
