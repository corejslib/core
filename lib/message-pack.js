import messagePack from "#lib/_browser/message-pack";

export default messagePack;

messagePack.registerExtension( {

    // Buffer
    "14": {
        "instanceOf": Buffer,
        "encode": value => value,
        "decode": ( messageBuffer, length, constructor ) => constructor.from( messageBuffer.readUint8Array( length ) ),
        "binary": true,
        "force": true,
    },
} );
