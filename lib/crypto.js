import "#lib/result";
import childProcess from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import stream from "node:stream";
import { promisify } from "node:util";
import fetch from "#lib/fetch";
import Message from "#lib/message";
import { Base64StreamDecoder, Base64StreamEncoder } from "#lib/stream/base64";
import { StreamDecryptor, StreamEncryptor } from "#lib/stream/crypto";
import { HexStreamDecoder, HexStreamEncoder } from "#lib/stream/hex";
import { TmpFile } from "#lib/tmp";

const SSH_SECRETS = new Map(),
    ALLOWED_ENCODINGS = new Set( [ "ascii", "buffer", "latin1", "utf8" ] );

// public
export { getCipherInfo, initEncryption } from "#lib/stream/crypto";

export const randomBytes = promisify( crypto.randomBytes );

export const randomFill = promisify( crypto.randomFill );

export async function hash ( algorithm, message, { inputEncoding, outputEncoding } = {} ) {
    message = Message.new( message );

    const data = await message.createBody();

    if ( data instanceof stream.Readable ) {
        const hash = crypto.createHash( algorithm ),
            pipeline = createPipeline( data, null, { inputEncoding } );

        for await ( const chunk of pipeline ) {
            hash.update( chunk );
        }

        return hash.digest( outputEncoding );
    }
    else {
        return hashSync( algorithm, data, { inputEncoding, outputEncoding } );
    }
}

export function hashSync ( algorithm, data, { inputEncoding, outputEncoding } = {} ) {
    const hash = crypto.createHash( algorithm );

    hash.update( data, inputEncoding );

    return hash.digest( outputEncoding );
}

export async function hmac ( algorithm, key, message, { inputEncoding, outputEncoding } = {} ) {
    message = Message.new( message );

    const data = await message.createBody();

    if ( data instanceof stream.Readable ) {
        const hmac = crypto.createHmac( algorithm, key ),
            pipeline = createPipeline( data, null, { inputEncoding } );

        for await ( const chunk of pipeline ) {
            hmac.update( chunk );
        }

        return hmac.digest( outputEncoding );
    }
    else {
        return hmacSync( algorithm, key, data, { inputEncoding, outputEncoding } );
    }
}

export function hmacSync ( algorithm, key, data, { inputEncoding, outputEncoding } = {} ) {
    const hmac = crypto.createHmac( algorithm, key );

    hmac.update( data, inputEncoding );

    return hmac.digest( outputEncoding );
}

export async function encrypt ( message, { inputEncoding, outputEncoding, ...options } = {} ) {
    message = Message.new( message );

    var data = await message.createBody(),
        isStream;

    if ( data instanceof stream.Readable ) {
        isStream = true;
    }
    else {
        data = stream.Readable.from( data, { "objectMode": false } );
    }

    const pipeline = createPipeline( data, new StreamEncryptor( options ), { inputEncoding, outputEncoding } );

    if ( isStream ) {
        return pipeline;
    }
    else if ( outputEncoding ) {
        return pipeline.text();
    }
    else {
        return pipeline.buffer();
    }
}

export async function decrypt ( message, { inputEncoding, outputEncoding, ...options } = {} ) {
    message = Message.new( message );

    var data = await message.createBody(),
        isStream;

    if ( data instanceof stream.Readable ) {
        isStream = true;
    }
    else {
        data = stream.Readable.from( data, { "objectMode": false } );
    }

    const pipeline = createPipeline( data, new StreamDecryptor( options ), { inputEncoding, outputEncoding } );

    if ( isStream ) {
        return pipeline;
    }
    else if ( outputEncoding ) {
        return pipeline.text();
    }
    else {
        return pipeline.buffer();
    }
}

export async function encryptSsh ( gitHubUsername, message, { inputEncoding, outputEncoding, cache } = {} ) {
    var res;

    res = await getSshSecret( gitHubUsername, { cache } );
    if ( !res.ok ) throw res;
    const secret = res.data;

    return encrypt( message, {
        inputEncoding,
        outputEncoding,
        "key": secret,
        "passwordHash": {
            "preset": "pbkdf2-sha256",
            "iterations": 10_000,
            "saltLength": 16,
        },
    } );
}

export async function decryptSsh ( gitHubUsername, message, { inputEncoding, outputEncoding, cache } = {} ) {
    var res;

    res = await getSshSecret( gitHubUsername, { cache } );
    if ( !res.ok ) throw res;
    const secret = res.data;

    return decrypt( message, {
        inputEncoding,
        outputEncoding,
        "key": secret,
        "passwordHash": {
            "preset": "pbkdf2-sha256",
            "iterations": 10_000,
            "saltLength": 16,
        },
    } );
}

export async function sign ( algorithm, message, privateKey, { inputEncoding, outputEncoding } = {} ) {
    message = Message.new( message );

    const data = await message.createBody();

    if ( data instanceof stream.Readable ) {
        const sign = crypto.createSign( algorithm ),
            pipeline = createPipeline( data, null, { inputEncoding } );

        for await ( const chunk of pipeline ) {
            sign.update( chunk );
        }

        return sign.sign( privateKey, outputEncoding );
    }
    else {
        return signSync( algorithm, data, privateKey, { inputEncoding, outputEncoding } );
    }
}

export function signSync ( algorithm, data, privateKey, { inputEncoding, outputEncoding } = {} ) {
    const sign = crypto.createSign( algorithm );

    sign.update( data, inputEncoding );

    return sign.sign( privateKey, outputEncoding );
}

export async function verify ( algorithm, message, publicKey, signature, { inputEncoding, signatureEncoding } = {} ) {
    message = Message.new( message );

    const data = await message.createBody();

    if ( data instanceof stream.Readable ) {
        const verify = crypto.createVerify( algorithm ),
            pipeline = createPipeline( data, null, { inputEncoding } );

        for await ( const chunk of pipeline ) {
            verify.update( chunk );
        }

        return verify.verify( publicKey, signature, signatureEncoding );
    }
    else {
        return verifySync( algorithm, data, publicKey, signature, { inputEncoding, signatureEncoding } );
    }
}

export function verifySync ( algorithm, data, publicKey, signature, { inputEncoding, signatureEncoding } = {} ) {
    const verify = crypto.createVerify( algorithm );

    verify.update( data, inputEncoding );

    return verify.verify( publicKey, signature, signatureEncoding );
}

// private
async function getSshSecret ( gitHubUsername, { cache } = {} ) {
    if ( !cache ) {
        SSH_SECRETS.delete( gitHubUsername );
    }
    else if ( SSH_SECRETS.has( gitHubUsername ) ) {
        return result( 200, SSH_SECRETS.get( gitHubUsername ) );
    }

    var res;

    res = await fetch( `https://github.com/${ gitHubUsername }.keys` );
    if ( !res.ok ) return res;

    const sshPublicKeys = await res.text();

    if ( !sshPublicKeys ) {
        return result( [ 500, "SSH public keys not found on GitHub" ] );
    }

    const tmpFile = new TmpFile();

    await fs.promises.writeFile( tmpFile.path, sshPublicKeys );

    return new Promise( resolve => {
        const proc = childProcess.spawn( "ssh-keygen", [ "-Y", "sign", "-n", "ssh-crypt", "-q", "-f", tmpFile.path ], {
            "encoding": "buffer",
            "stdio": [ "pipe", "pipe", "pipe" ],
        } );

        const stdout = [],
            stderr = [];

        proc.once( "error", e => resolve( result( [ 500, e.message ] ) ) );

        proc.stdout.on( "data", data => stdout.push( data ) );

        proc.stderr.on( "data", data => stderr.push( data ) );

        proc.once( "close", code => {
            var res;

            tmpFile.destroy();

            if ( code ) {
                res = result( [ 500, Buffer.concat( stderr ).toString() ] );
            }
            else {
                const secret = crypto.createHash( "SHA3-256" ).update( Buffer.concat( stdout ) ).digest( "buffer" );

                SSH_SECRETS.set( gitHubUsername, secret );

                res = result( 200, secret );
            }

            resolve( res );
        } );

        proc.stdin.write( gitHubUsername );
        proc.stdin.end();
    } );
}

function createPipeline ( inputStream, ouputStream, { inputEncoding, outputEncoding } = {} ) {
    const streams = [ inputStream ];

    if ( inputEncoding ) {
        if ( inputEncoding === "base64" ) {
            streams.push( new Base64StreamDecoder() );
        }
        else if ( inputEncoding === "base64url" ) {
            streams.push( new Base64StreamDecoder( { "base64url": true } ) );
        }
        else if ( inputEncoding === "hex" ) {
            streams.push( new HexStreamDecoder() );
        }
        else if ( !ALLOWED_ENCODINGS.has( inputEncoding ) ) {
            throw new Error( "Input encoding is not valid" );
        }
    }

    if ( ouputStream ) {
        streams.push( ouputStream );
    }

    if ( outputEncoding ) {
        if ( outputEncoding === "base64" ) {
            streams.push( new Base64StreamEncoder() );
        }
        else if ( outputEncoding === "base64url" ) {
            streams.push( new Base64StreamEncoder( { "base64url": true } ) );
        }
        else if ( outputEncoding === "hex" ) {
            streams.push( new HexStreamEncoder() );
        }
        else if ( !ALLOWED_ENCODINGS.has( outputEncoding ) ) {
            throw new Error( "Output encoding is not valid" );
        }
    }

    if ( streams.length === 1 ) {
        return inputStream;
    }
    else {
        return stream.pipeline( ...streams, () => {} );
    }
}
