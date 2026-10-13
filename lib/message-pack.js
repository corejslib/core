import { MessagePack as BrowserMessagePack } from "#lib/_browser/message-pack";

const DEFAULT_DECODE_BINARY = ( messageBuffer, length ) => Buffer.from( messageBuffer.readArrayBuffer( length ) );

export class MessagePack extends BrowserMessagePack {
    constructor ( options ) {
        super( {
            "decodeBinary": DEFAULT_DECODE_BINARY,
            ...options,
        } );
    }
}

const messagePack = new MessagePack();

export default messagePack;
