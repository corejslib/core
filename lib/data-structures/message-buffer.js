import BrowserMessageBuffer from "#lib/_browser/data-structures/message-buffer";

export default class MessageBuffer extends BrowserMessageBuffer {
    reset () {
        try {
            const bytes = this.bytes.subarray( 0, this.offset ),
                buffer = Buffer.allocUnsafe( bytes.length );

            buffer.set( bytes );

            return buffer;
        }
        finally {
            this.clear();
        }
    }
}
