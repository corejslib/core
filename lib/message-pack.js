import messagePack from "#lib/_browser/message-pack";

export default messagePack;

messagePack.registerExtension( {

    // Buffer
    "14": {
        "instanceOf": Buffer,
        "encode": value => value,
        "decode": ( buffer, length, constructor ) => constructor.from( buffer.readBytes( length ) ),
        "binary": true,
        "force": true,
    },
} );
