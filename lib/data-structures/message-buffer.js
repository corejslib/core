import BrowserMessageBuffer from "#lib/_browser/data-structures/message-buffer";

export { MessagePack } from "#lib/_browser/message-pack";

// V8 allocates typed arrays up to this size on the heap, so a regular copy is faster than a pooled Buffer for them
const MAX_ON_HEAP_LENGTH = 64;

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
}
