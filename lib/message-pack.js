import messagePack from "#lib/_browser/message-pack";

export { MessagePack } from "#lib/_browser/message-pack";

export default messagePack;

messagePack.registerExtension( {

    // Uint8Array
    "3": {
        "instanceOf": Uint8Array,
        "encode": value => value,
        "decode": ( messageBuffer, length ) => Buffer.from( messageBuffer.readArrayBuffer( length ) ),
        "binary": true,
        "force": true,
    },

    // Buffer
    "14": {
        "instanceOf": Buffer,
        "encode": value => value,
        "decode": ( messageBuffer, length ) => Buffer.from( messageBuffer.readArrayBuffer( length ) ),
        "binary": true,
        "force": true,
    },
} );
