import "#lib/result";
import childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import File from "#lib/file";
import { pathExists } from "#lib/fs";
import stream from "#lib/stream";
import { TmpDir, TmpFile } from "#lib/tmp";

const GPG_BINARY = "gpg" + ( process.platform === "win32"
        ? ".exe"
        : "" ),
    KEY_VALIDITY = {
        "o": "unknown",
        "i": "invalid",
        "d": "disabled",
        "D": "disabled",
        "r": "revoked",
        "e": "expired",
        "-": "",
        "q": "",
        "n": "not valid",
        "m": "marginal valid",
        "f": "fully valid",
        "u": "ultimately valid",
        "w": "well known private part",
        "s": "special validity",

        // XXX in "sig" records, this field may have one of these values as first character:
        // "!": "signature is good",
        // "-": "signature is bad",
        // "?": "no public key to verify signature or public key is not usable",
        // "%": "other error verifying a signature",
    },
    KEY_IS_VALID = new Set( [ "m", "f", "u", "w", "s" ] ),
    KEY_CAPABILITIES = {
        "a": "authentication",
        "c": "certify",
        "e": "encrypt",
        "s": "sign",
        "r": "restricted encryption",
        "t": "timestamping",
        "g": "group key",
        "?": "unknown",
        "d": "disabled key",
    };

var GPG_PRESET_PASSPHRASE_BINARY;

export default class Gpg {
    #passwords;
    #home;
    #privateKeysCache;

    constructor ( { passwords, home } = {} ) {
        this.#passwords = passwords;

        if ( home ) {
            if ( home === true ) {
                this.#home = new TmpDir();
            }
            else {
                this.#home = home;
            }
        }
    }

    // public
    async getPrivateKeys ( { cacheKeys = true } = {} ) {
        if ( cacheKeys && this.#privateKeysCache ) return result( 200, this.#privateKeysCache );

        return new Promise( resolve => {
            childProcess.execFile(
                GPG_BINARY,
                [ "--list-secret-keys", "--with-colons", "--with-keygrip", "--with-fingerprint" ],
                {
                    "env": this.#createEnv(),
                    "windowsHide": true,
                },
                ( error, stdout, stdoerr ) => {
                    if ( error ) {
                        resolve( result.fromError( error, { "log": false } ) );
                    }
                    else {
                        try {
                            stdout = stdout.replace( /^.*?sec/msv, "sec" );

                            const data = [],
                                lines = stdout.split( "\n" );

                            let key, subkey;

                            for ( let line of lines ) {
                                line = line.trim();
                                if ( !line ) continue;

                                const fields = this.#parseColumns( line );

                                // sec
                                if ( fields.type === "sec" ) {
                                    key = {
                                        "id": fields.keyId,
                                        "curveName": fields.curveName,
                                        "validity": {
                                            "type": fields.validity,
                                            "text": KEY_VALIDITY[ fields.validity ],
                                            "isValid": KEY_IS_VALID.has( fields.validity ),
                                        },
                                        "creationDate": fields.creationDate,
                                        "expirationDate": fields.expirationDate,
                                        "fingerprint": null,
                                        "grip": null,
                                        "capabilities": Object.fromEntries( fields.keyCapabilities.split( "" ).map( capability => [ capability, KEY_CAPABILITIES[ capability.toLowerCase() ] ] ) ),
                                        "uids": {},
                                        "subkeys": [],
                                    };

                                    data.push( key );

                                    subkey = null;
                                }

                                // ssb
                                else if ( fields.type === "ssb" ) {
                                    subkey = {
                                        "id": fields.keyId,
                                        "curveName": fields.curveName,
                                        "validity": {
                                            "type": fields.validity,
                                            "text": KEY_VALIDITY[ fields.validity ],
                                            "isValid": KEY_IS_VALID.has( fields.validity ),
                                        },
                                        "creationDate": fields.creationDate,
                                        "expirationDate": fields.expirationDate,
                                        "fingerprint": null,
                                        "grip": null,
                                        "capabilities": Object.fromEntries( fields.keyCapabilities.split( "" ).map( capability => [ capability, KEY_CAPABILITIES[ capability ] ] ) ),
                                    };

                                    key.subkeys.push( subkey );
                                }

                                // uid
                                else if ( fields.type === "uid" ) {
                                    const uid = fields.userId;

                                    let name, email;

                                    const match = uid.match( /^(?<name>.+) <(?<email>.+)>$/v );

                                    if ( match ) {
                                        name = match.groups.name;
                                        email = match.groups.email;
                                    }
                                    else {
                                        name = null;
                                        email = uid;
                                    }

                                    key.uids[ email ] = {
                                        uid,
                                        email,
                                        name,
                                        "validity": {
                                            "type": fields.validity,
                                            "text": KEY_VALIDITY[ fields.validity ],
                                            "isValid": KEY_IS_VALID.has( fields.validity ),
                                        },
                                    };
                                }

                                // fingerprint
                                else if ( fields.type === "fpr" ) {
                                    const fingerprint = fields.userId;

                                    if ( subkey ) {
                                        subkey.fingerprint = fingerprint;
                                    }
                                    else {
                                        key.fingerprint = fingerprint;
                                    }
                                }

                                // grip
                                else if ( fields.type === "grp" ) {
                                    const grip = fields.userId;

                                    if ( subkey ) {
                                        subkey.grip = grip;
                                    }
                                    else {
                                        key.grip = grip;
                                    }
                                }

                                // invalid
                                else {
                                    throw "Key parsing error";
                                }
                            }

                            this.#privateKeysCache = data;

                            resolve( result( 200, data ) );
                        }
                        catch ( e ) {
                            resolve( result.fromError( e, { "log": false } ) );
                        }
                    }
                }
            );
        } );
    }

    async presetPasswords ( passwords, { subkeys, cacheKeys } = {} ) {
        return this.#presetPasswords( passwords, { subkeys, cacheKeys } );
    }

    async encrypt ( data, recipients, { cwd, armor, compressLevel, output, sign, passwords, cacheKeys } = {} ) {
        const args = [];

        if ( armor ) args.push( "--armor" );

        if ( compressLevel != null ) args.push( "-z", compressLevel || 0 );

        // sign
        if ( sign ) {
            args.push( "--sign" );

            if ( !Array.isArray( sign ) ) sign = [ sign ];

            for ( const user of sign ) {
                args.push( "--local-user", user );
            }

            // preset passwords
            const res = await this.#presetPasswords( passwords, { cacheKeys } );
            if ( !res.ok ) return res;
        }

        // encrypt
        args.push( "--encrypt" );

        if ( !Array.isArray( recipients ) ) recipients = [ recipients ];

        for ( const user of recipients ) {
            args.push( "--recipient", user );
        }

        return this.#spawnGpg( args, {
            cwd,
            "input": data,
            "output": output || true,
        } );
    }

    async sign ( data, users, { cwd, armor, compressLevel, output, encrypt, passwords, cacheKeys } = {} ) {
        const args = [];

        if ( armor ) args.push( "--armor" );

        if ( compressLevel != null ) args.push( "-z", compressLevel || 0 );

        // sign
        args.push( "--sign" );

        if ( !Array.isArray( users ) ) users = [ users ];

        for ( const user of users ) {
            args.push( "--local-user", user );
        }

        // preset passwords
        const res = await this.#presetPasswords( passwords, { cacheKeys } );
        if ( !res.ok ) return res;

        // encrypt
        if ( encrypt ) {
            args.push( "--encrypt" );

            if ( !Array.isArray( encrypt ) ) encrypt = [ encrypt ];

            for ( const user of encrypt ) {
                args.push( "--recipient", user );
            }
        }

        return this.#spawnGpg( args, {
            cwd,
            "input": data,
            "output": output || true,
        } );
    }

    async detachSign ( data, users, { cwd, armor, compressLevel, output, passwords, cacheKeys } = {} ) {
        const args = [];

        if ( armor ) args.push( "--armor" );

        if ( compressLevel != null ) args.push( "-z", compressLevel || 0 );

        // sign
        args.push( "--detach-sign" );

        if ( !Array.isArray( users ) ) users = [ users ];

        for ( const user of users ) {
            args.push( "--local-user", user );
        }

        // preset passwords
        const res = await this.#presetPasswords( passwords, { cacheKeys } );
        if ( !res.ok ) return res;

        return this.#spawnGpg( args, {
            cwd,
            "input": data,
            "output": output || true,
        } );
    }

    async clearSign ( data, users, { cwd, compressLevel, output, passwords, cacheKeys } = {} ) {
        const args = [];

        if ( compressLevel != null ) args.push( "-z", compressLevel || 0 );

        // sign
        args.push( "--clear-sign" );

        if ( !Array.isArray( users ) ) users = [ users ];

        for ( const user of users ) {
            args.push( "--local-user", user );
        }

        // preset passwords
        const res = await this.#presetPasswords( passwords, { cacheKeys } );
        if ( !res.ok ) return res;

        return this.#spawnGpg( args, {
            cwd,
            "input": data,
            "output": output || true,
        } );
    }

    async decrypt ( data, { cwd, output, passwords, cacheKeys } = {} ) {
        const args = [ "--decrypt" ];

        // preset passwords
        const res = await this.#presetPasswords( passwords, { cacheKeys } );
        if ( !res.ok ) return res;

        return this.#spawnGpg( args, {
            cwd,
            "input": data,
            "output": output || true,
        } );
    }

    async verify ( data, { cwd, signature, passwords, cacheKeys } = {} ) {
        const args = [ "--verify" ];

        var detachedSignatureTmp;

        // detached signature
        if ( signature ) {
            detachedSignatureTmp = await this.#writeTmpFile( this.#createStream( signature ) );

            args.push( detachedSignatureTmp.path, "-" );
        }

        // preset passwords
        var res = await this.#presetPasswords( passwords, { cacheKeys } );
        if ( !res.ok ) return res;

        res = await this.#spawnGpg( args, {
            cwd,
            "input": data,
        } );

        // detachedSignatureTmp?.destroy();

        return res;
    }

    async importKeys ( data, { cwd, restore } = {} ) {
        const args = [ "--import", "--passphrase", "" ];

        if ( restore ) {
            args.push( "--import-options", "restore" );
        }

        this.#clearCache();

        return this.#spawnGpg( args, {
            cwd,
            "input": data,
        } );
    }

    async importOwnertrust ( data, { cwd } = {} ) {
        const args = [ "--import-ownertrust" ];

        return this.#spawnGpg( args, {
            cwd,
            "input": data,
        } );
    }

    // private
    #parseColumns ( line ) {
        var fields = line.split( ":" );

        // DOCS: https://github.com/gpg/gnupg/blob/master/doc/DETAILS
        fields = {
            "type": fields[ 0 ],
            "validity": fields[ 1 ],
            "keyLength": fields[ 2 ],
            "publicKeyAlgorithm": fields[ 3 ],
            "keyId": fields[ 4 ],
            "creationDate": fields[ 5 ]
                ? Temporal.Instant.fromEpochMilliseconds( Number( fields[ 5 ] ) * 1000 )
                : null,
            "expirationDate": fields[ 6 ]
                ? Temporal.Instant.fromEpochMilliseconds( Number( fields[ 6 ] ) * 1000 )
                : null,

            // XXX
            "field8": fields[ 7 ], // Certificate S/N, UID hash, trust signature info
            "ownertrust": fields[ 8 ],
            "userId": fields[ 9 ],
            "signatureClass": fields[ 10 ],
            "keyCapabilities": fields[ 11 ],
            "issuerCertificateFingerprint": fields[ 12 ],
            "flag": fields[ 13 ],
            "tokenSerialNumber": fields[ 14 ],
            "hashAlgorithm": fields[ 15 ],
            "curveName": fields[ 16 ],
            "complianceFlags": fields[ 17 ],
            "lastUpdate": fields[ 18 ],
            "origin": fields[ 19 ],
            "comment": fields[ 20 ],
        };

        return fields;
    }

    #clearCache () {
        this.#privateKeysCache = undefined;
    }

    async #presetPasswords ( passwords, { subkeys = true, cacheKeys } = {} ) {
        passwords ||= this.#passwords;

        if ( !passwords ) return result( 200 );

        const gpgPresetPassphraseBinary = await this.#getGpgPresetPassphraseBinary();
        if ( !gpgPresetPassphraseBinary ) return result( 500 );

        const res = await this.getPrivateKeys( { cacheKeys } );
        if ( !res.ok ) return res;
        const privateKeys = res.data;

        const keygrips = new Map();

        KEY_ID: for ( const [ keyId, password ] of Object.entries( passwords ) ) {
            if ( !password ) continue;

            let found;

            KEY: for ( const key of privateKeys ) {
                if ( keyId === key.id || keyId === key.grip || keyId === key.fingerprint ) {
                    found = true;

                    keygrips.set( key.grip, password );

                    if ( subkeys ) {
                        for ( const subkey of key.subkeys ) {
                            keygrips.set( subkey.grip, password );
                        }
                    }

                    continue KEY_ID;
                }

                for ( const uid of Object.values( key.uids ) ) {
                    if ( uid.email === keyId || uid.uid.includes( keyId ) ) {
                        if ( keygrips.has( key.grip ) ) return result( [ 400, "GPG key is ambiguous" ] );

                        found = true;

                        keygrips.set( key.grip, password );

                        if ( subkeys ) {
                            for ( const subkey of key.subkeys ) {
                                keygrips.set( subkey.grip, password );
                            }
                        }

                        continue KEY;
                    }
                }

                // find subkeys
                for ( const subkey of key.subkeys ) {
                    if ( keyId === subkey.id || keyId === subkey.grip || keyId === subkey.fingerprint ) {
                        found = true;

                        keygrips.set( subkey.grip, password );

                        continue KEY_ID;
                    }
                }
            }

            if ( !found ) return result( [ 404, "GPG key not found" ] );
        }

        // cache passwords
        if ( keygrips.size ) {
            for ( const [ keygrip, password ] of keygrips.entries() ) {
                const res = await new Promise( resolve => {
                    try {
                        const proc = childProcess.spawn( gpgPresetPassphraseBinary, [ "--preset", keygrip ], {
                            "env": this.#createEnv(),
                            "stdio": [ "pipe", "ignore", "ignore" ],
                        } );

                        proc.once( "error", e => resolve( result.fromError( e, { "log": false } ) ) );

                        proc.once( "close", code => {
                            var res;

                            if ( code ) {
                                res = result( 500 );
                            }
                            else {
                                res = result( 200 );
                            }

                            resolve( res );
                        } );

                        proc.stdin.write( password );
                        proc.stdin.end();
                    }
                    catch ( e ) {
                        resolve( result.fromError( e, { "log": false } ) );
                    }
                } );

                if ( !res.ok ) return res;
            }
        }

        return result( 200 );
    }

    async #getGpgPresetPassphraseBinary () {
        if ( GPG_PRESET_PASSPHRASE_BINARY == null ) {
            GPG_PRESET_PASSPHRASE_BINARY = "";

            if ( process.platform === "win32" ) {
                let gpgDir;

                for ( const dir of process.env.PATH.split( ";" ) ) {
                    if ( await pathExists( dir + "/gpg.exe" ) ) {
                        gpgDir = dir;

                        break;
                    }
                }

                if ( gpgDir ) {
                    if ( await pathExists( gpgDir + "/gpg-preset-passphrase.exe" ) ) {
                        GPG_PRESET_PASSPHRASE_BINARY = path.join( gpgDir, "gpg-preset-passphrase.exe" );
                    }
                    else if ( await pathExists( gpgDir + "/../lib/gnupg/gpg-preset-passphrase.exe" ) ) {
                        GPG_PRESET_PASSPHRASE_BINARY = path.join( gpgDir, "../lib/gnupg/gpg-preset-passphrase.exe" );
                    }
                }
            }
            else {
                GPG_PRESET_PASSPHRASE_BINARY = "/usr/lib/gnupg/gpg-preset-passphrase";
            }
        }

        return GPG_PRESET_PASSPHRASE_BINARY;
    }

    #createStream ( data ) {
        if ( data instanceof stream.Readable ) {
            return data;
        }
        else if ( data instanceof File ) {
            return data.stream();
        }
        else {
            return stream.Readable.from( data, { "objectMode": false } );
        }
    }

    async #writeTmpFile ( readStream ) {
        const tmp = new TmpFile();

        await stream.promises.pipeline( readStream, fs.createWriteStream( tmp.path ) );

        return tmp;
    }

    async #spawnGpg ( args, { cwd, input, output } = {} ) {
        args.unshift( "--pinentry-mode=loopback", "--yes", "--batch" );

        if ( output ) {
            args.push( "--output" );

            if ( output === true ) {
                args.push( "-" );
            }
            else {
                args.push( output );
            }
        }

        const env = { ...process.env };
        if ( this.#home ) {
            env[ "GNUPGHOME" ] = String( this.#home );
        }

        try {
            const proc = childProcess.spawn( GPG_BINARY, args, {
                cwd,
                "env": this.#createEnv(),
                "stdio": [ input
                    ? "pipe"
                    : "ignore", output === true
                    ? "pipe"
                    : "ignore", "ignore" ],
            } );

            if ( input ) {
                stream.pipeline( this.#createStream( input ), proc.stdin, e => {} );
            }

            if ( output === true ) {
                return result( 200, {
                    "stream": proc.stdout,
                } );
            }
            else {
                return new Promise( resolve => {
                    proc.once( "close", ( code, signal ) => {
                        if ( code ) {
                            resolve( result( 500 ) );
                        }
                        else {
                            resolve( result( 200 ) );
                        }
                    } );
                } );
            }
        }
        catch ( e ) {
            return result.fromError( e, { "log": false } );
        }
    }

    #createEnv () {
        var env;

        if ( this.#home ) {
            env = {
                ...process.env,
                "GNUPGHOME": String( this.#home ),
            };
        }

        return env;
    }
}
