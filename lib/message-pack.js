import messagePack, { encodeView, sizeView, toArrayBuffer } from "#lib/_browser/message-pack";

export default messagePack;

messagePack.registerExtension( {

    // Buffer
    "14": {
        "instanceOf": Buffer,
        "encode": encodeView,
        "decode": ( buffer, length, constructor ) => constructor.from( toArrayBuffer( buffer.readBytes( length ) ) ),
        "binary": true,
        "size": sizeView,
        "force": true,
    },
} );
