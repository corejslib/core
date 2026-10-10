import BrowserMessageBuffer from "#lib/_browser/data-structures/message-buffer";

export default class MessageBuffer extends BrowserMessageBuffer {
    reset () {
        try {
            const uint8Array = this.uint8Array.subarray( 0, this.offset ),
                buffer = Buffer.allocUnsafe( uint8Array.length );

            buffer.set( uint8Array );

            return buffer;
        }
        finally {
            this.clear();
        }
    }
}
