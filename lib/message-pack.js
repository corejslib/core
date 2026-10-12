import { MessagePack as BrowserMessagePack } from "#lib/_browser/message-pack";

export class MessagePack extends BrowserMessagePack {

    // protected
    _decodeBinary ( messageBuffer, length ) {
        return Buffer.from( messageBuffer.readArrayBuffer( length ) );
    }
}

const messagePack = new MessagePack();

export default messagePack;
