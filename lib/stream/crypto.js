import "#lib/result";
import crypto from "node:crypto";
import PasswordHash from "#lib/crypto/password-hash";
import RandomValues from "#lib/crypto/random-values";
import messagePack from "#lib/message-pack";
import stream from "#lib/stream";

const DEFAULT_ALGORITHM = "AES-256-GCM",
    OPENSSL_DEFAULT_ALGORITHM = "AES-256-CBC",
    OPENSSL_DEFAULT_PASSWORD_HASH_OPTIONS = {
        "preset": "pbkdf2-sha256",
        "iterations": 10_000,
        "saltLength": 8,
    },
    OPENSSL_SALT_BUFFER = Buffer.from( "Salted__" ),
    DEFAULT_AUTH_TAG_LENGTH = 16,
    AUTH_TAG_CIPHERS = new Set( [ "CHACHA20-POLY1305", "gcm", "gcm-siv", "ocb", "ccm" ] ),
    CIPHERS = {};

let OPENSSL_PASSWORD_HASH;

// public
export class StreamHash extends stream.Transform {
    #hash;
    #outputEncoding;

    constructor ( algorithm, { outputEncoding } = {} ) {
        super();

        this.#hash = crypto.createHash( algorithm );
        this.#outputEncoding = outputEncoding;
    }

    // protected
    _transform ( chunk, encoding, callback ) {
        this.#hash.update( chunk, encoding );

        callback();
    }

    _flush ( callback ) {
        callback( null, this.#hash.digest( this.#outputEncoding ) );

        this.#hash = null;
    }
}

export class StreamHmac extends stream.Transform {
    #hmac;
    #outputEncoding;

    constructor ( algorithm, key, { outputEncoding } = {} ) {
        super();

        this.#hmac = crypto.createHmac( algorithm, key );
        this.#outputEncoding = outputEncoding;
    }

    // protected
    _transform ( chunk, encoding, callback ) {
        this.#hmac.update( chunk, encoding );

        callback();
    }

    _flush ( callback ) {
        callback( null, this.#hmac.digest( this.#outputEncoding ) );

        this.#hmac = null;
    }
}

export class StreamEncryptor extends stream.Transform {
    #init;
    #options;
    #cipherInfo;
    #cipher;
    #authTagLength;

    constructor ( { init, ...options } = {} ) {
        super();

        this.#init = init || initOpensslEncryption;
        this.#options = options;
    }

    // protected
    async _transform ( chunk, encoding, callback ) {

        // init
        if ( this.#init ) {
            try {
                const res = await this.#init( this.#options );
                this.#init = null;
                this.#options = null;

                this.#cipherInfo = getCipherInfo( res.algorithm );

                if ( !this.#cipherInfo?.isSupported ) {
                    throw new Error( "Cipher is not supported" );
                }

                // write header
                if ( res.header ) {
                    this.push( res.header );
                }

                let iv;

                if ( res.iv ) {
                    iv = res.iv;
                }
                else {
                    iv = Buffer.from( RandomValues.default.getRandomArrayBuffer( res.ivLength || this.#cipherInfo.ivLength ) );

                    // write iv
                    this.push( iv );
                }

                this.#authTagLength = res.authTagLength || this.#cipherInfo.authTagLength;

                this.#cipher = crypto.createCipheriv( this.#cipherInfo.algorithm, res.key, iv, getCipherOptions( this.#authTagLength ) );
            }
            catch ( e ) {
                return callback( e );
            }
        }

        try {
            this.push( this.#cipher.update( chunk, encoding ) );

            callback();
        }
        catch ( e ) {
            callback( e );
        }
    }

    _flush ( callback ) {
        try {
            if ( this.#cipher ) {
                this.push( this.#cipher.final() );

                if ( this.#authTagLength ) {
                    this.push( this.#cipher.getAuthTag() );
                }
            }

            callback();
        }
        catch ( e ) {
            callback( e );
        }
    }
}

export class StreamDecryptor extends stream.Transform {
    #init;
    #options;
    #cipherInfo;
    #buffer;
    #decipher;
    #key;
    #iv;
    #ivLength;
    #authTagLength;
    #authTag;
    #complete = true;

    constructor ( { init, ...options } = {} ) {
        super();

        this.#init = init || initOpensslEncryption;
        this.#options = options;
    }

    // protected
    async _transform ( chunk, encoding, callback ) {
        this.#complete = false;

        if ( this.#buffer?.length ) {
            this.#buffer = Buffer.concat( [ this.#buffer, chunk ] );
        }
        else {
            this.#buffer = chunk;
        }

        // init
        if ( this.#init ) {
            try {
                const res = await this.#init( {
                    ...this.#options,
                    "buffer": this.#buffer,
                } );

                // need more data
                if ( !res ) return callback();

                this.#init = null;
                this.#options = null;

                this.#cipherInfo = getCipherInfo( res.algorithm );

                if ( !this.#cipherInfo?.isSupported ) {
                    throw new Error( "Cipher is not supported" );
                }

                if ( res.offset ) {
                    this.#buffer = this.#buffer.subarray( res.offset );
                }

                this.#key = res.key;

                this.#authTagLength = res.authTagLength || this.#cipherInfo.authTagLength;

                if ( res.iv ) {
                    this.#iv = res.iv;
                }
                else {
                    this.#ivLength = res.ivLength || this.#cipherInfo.ivLength;
                }
            }
            catch ( e ) {
                return callback( e );
            }
        }

        // need more data
        if ( !this.#buffer.length ) return callback();

        // read iv
        if ( !this.#iv ) {

            // need more data
            if ( this.#buffer.length < this.#ivLength ) return callback();

            this.#iv = this.#buffer.subarray( 0, this.#ivLength );
            this.#buffer = this.#buffer.subarray( this.#ivLength );

            // need more data
            if ( !this.#buffer.length ) return callback();
        }

        // create decipher
        if ( !this.#decipher ) {
            this.#decipher = crypto.createDecipheriv( this.#cipherInfo.algorithm, this.#key, this.#iv, getCipherOptions( this.#authTagLength ) );
        }

        try {
            if ( this.#authTagLength ) {
                this.#authTag ||= Buffer.alloc( 0 );

                if ( this.#buffer.length >= this.#authTagLength ) {
                    if ( this.#authTag.length ) {
                        this.push( this.#decipher.update( this.#authTag ) );
                    }

                    this.#authTag = this.#buffer.subarray( -this.#authTagLength );
                    this.#buffer = this.#buffer.subarray( 0, -this.#authTagLength );
                }
                else {
                    this.#buffer = Buffer.concat( [ this.#authTag, this.#buffer ] );

                    if ( this.#buffer.length >= this.#authTagLength ) {
                        this.#authTag = this.#buffer.subarray( -this.#authTagLength );
                        this.#buffer = this.#buffer.subarray( 0, -this.#authTagLength );
                    }
                    else {
                        this.#authTag = this.#buffer;
                        this.#buffer = null;
                    }
                }
            }

            if ( this.#buffer?.length ) {
                this.push( this.#decipher.update( this.#buffer ) );

                this.#buffer = null;
            }

            callback();
        }
        catch ( e ) {
            callback( e );
        }
    }

    _flush ( callback ) {
        try {
            if ( this.#decipher ) {
                if ( this.#authTagLength ) {
                    this.#decipher.setAuthTag( this.#authTag );
                }

                this.push( this.#decipher.final() );

                this.#complete = true;
            }

            // data is not complete
            if ( !this.#complete ) {
                throw new Error( "Data is not complete" );
            }

            callback();
        }
        catch ( e ) {
            callback( e );
        }
    }
}

export class StreamSigner extends stream.Transform {
    #sign;
    #privateKey;
    #outputEncoding;

    constructor ( algorithm, privateKey, { outputEncoding } = {} ) {
        super();

        this.#sign = crypto.createSign( algorithm );
        this.#privateKey = privateKey;
        this.#outputEncoding = outputEncoding;
    }

    // protected
    _transform ( chunk, encoding, callback ) {
        this.#sign.update( chunk, encoding );

        callback();
    }

    _flush ( callback ) {
        callback( null, this.#sign.sign( this.#privateKey, this.#outputEncoding ) );

        this.#sign = null;
    }
}

export function getCipherInfo ( algorithm ) {
    if ( typeof algorithm !== "string" ) return;

    let options = CIPHERS[ algorithm.toUpperCase() ];

    if ( !options ) {
        const cipherInfo = crypto.getCipherInfo( algorithm );

        if ( cipherInfo ) {
            options = {
                ...cipherInfo,
                "algorithm": algorithm.toUpperCase(),
                "authTagLength": null,
                "isSupported": true,
            };

            // NOTE: CCM ciphers are currently not supported due to algorithm limitations
            // NOTE: https://nodejs.org/api/crypto.html#ccm-mode
            if ( options.mode === "ccm" ) {
                options.isSupported = false;
            }

            // NOTE: siv ciphers are not supported currently
            // siv mode is only required when we use external iv and can't guarantee it's uniqueness
            // need to encrypt stream by blocks
            // each block should use own iv
            // block structure: block-size,iv,encrypted-data,auth-tag
            else if ( options.mode === "gcm-siv" ) {
                options.isSupported = false;
            }

            if ( AUTH_TAG_CIPHERS.has( options.mode ) || AUTH_TAG_CIPHERS.has( options.algorithm ) ) {
                options.authTagLength = DEFAULT_AUTH_TAG_LENGTH;
            }
        }
        else {
            return;
        }

        CIPHERS[ options.algorithm ] = options;
    }

    return options;
}

export async function initEncryption ( { buffer, key, algorithm, passwordHash = PasswordHash.default } = {} ) {

    // read header
    if ( buffer ) {

        // try to decode header
        const res = messagePack.fromMessagePackStream( buffer );

        // header is not complete
        if ( !res?.offset ) return;

        if ( !Array.isArray( res.value ) ) throw new Error( "Encryption header is not valid" );

        const [ headerAlgorithm, ivLength, authTagLength, phc ] = res.value,
            cipherInfo = getCipherInfo( headerAlgorithm );

        if ( !cipherInfo?.isSupported ) throw new Error( "Cipher is not supported" );

        // iv and auth tag lengths are trusted, because they are the values used at the encryption time, check only types
        if ( ivLength != null && ( !Number.isInteger( ivLength ) || !( ivLength >= 0 ) ) ) throw new Error( "Encryption header is not valid" );
        if ( authTagLength != null && ( !Number.isInteger( authTagLength ) || !( authTagLength >= 0 ) ) ) throw new Error( "Encryption header is not valid" );

        if ( phc ) {
            const keyRes = await PasswordHash.new( passwordHash || PasswordHash.default ).deriveKey( key, {
                "keyLength": cipherInfo.keyLength,
                phc,
            } );
            if ( !keyRes.ok ) throw keyRes;

            key = keyRes.data.key;
        }

        return {
            "algorithm": cipherInfo.algorithm,
            key,
            ivLength,
            authTagLength,
            "offset": res.offset,
        };
    }

    // create header
    else {
        const cipherInfo = getCipherInfo( algorithm || DEFAULT_ALGORITHM );
        if ( !cipherInfo?.isSupported ) throw new Error( "Cipher is not supported" );

        let phc;

        if ( passwordHash ) {
            const res = await PasswordHash.new( passwordHash ).deriveKey( key, {
                "keyLength": cipherInfo.keyLength,
            } );
            if ( !res.ok ) throw res;

            key = res.data.key;

            phc = res.data.phc.optionsString;
        }

        return {
            "algorithm": cipherInfo.algorithm,
            key,
            "ivLength": cipherInfo.ivLength,
            "authTagLength": cipherInfo.authTagLength,
            "header": messagePack.toMessagePack( [ cipherInfo.algorithm, cipherInfo.ivLength, cipherInfo.authTagLength, phc ] ),
        };
    }
}

export async function initOpensslEncryption ( { buffer, algorithm, key, iv, passwordHash } = {} ) {
    const cipher = getCipherInfo( algorithm || OPENSSL_DEFAULT_ALGORITHM );

    if ( !cipher?.isSupported ) throw new Error( "Cipher is not supported" );

    if ( passwordHash === undefined ) {
        if ( !OPENSSL_PASSWORD_HASH ) {
            OPENSSL_PASSWORD_HASH = new PasswordHash( OPENSSL_DEFAULT_PASSWORD_HASH_OPTIONS );
        }

        passwordHash = OPENSSL_PASSWORD_HASH;
    }

    if ( passwordHash ) {
        passwordHash = PasswordHash.new( passwordHash );

        // read header
        if ( buffer ) {

            // header is not complete
            if ( buffer.length < 8 + passwordHash.saltLength ) return;

            // check header magic
            if ( !buffer.subarray( 0, OPENSSL_SALT_BUFFER.length ).equals( OPENSSL_SALT_BUFFER ) ) throw new Error( "Encryption header is not valid" );

            const salt = buffer.subarray( 8, 8 + passwordHash.saltLength ),
                res = await deriveOpensslKey( key, { passwordHash, salt, cipher } );

            if ( !res.ok ) throw res;

            return {
                "algorithm": cipher.algorithm,
                "key": res.data.key,
                "iv": res.data.iv,
                "offset": 8 + passwordHash.saltLength,
            };
        }

        // create header
        else {
            const res = await deriveOpensslKey( key, { passwordHash, cipher } );
            if ( !res.ok ) throw res;

            return {
                "algorithm": cipher.algorithm,
                "key": res.data.key,
                "iv": res.data.iv,
                "header": Buffer.concat( [ OPENSSL_SALT_BUFFER, res.data.salt ] ),
            };
        }
    }

    // no password hash
    else {
        return {
            "algorithm": cipher.algorithm,
            key,
            iv,
        };
    }
}

// private
function getCipherOptions ( authTagLength ) {
    return authTagLength
        ? { "authTagLength": authTagLength }
        : undefined;
}

async function deriveOpensslKey ( key, { passwordHash, salt, cipher } = {} ) {

    // derive key
    const res = await passwordHash.createPasswordHash( key, {
        "phc": false,
        salt,
        "hashLength": cipher.keyLength + cipher.ivLength,
    } );

    if ( !res.ok ) return res;

    return result( 200, {
        "key": res.data.hash.subarray( 0, cipher.keyLength ),
        "iv": res.data.hash.subarray( cipher.keyLength, cipher.keyLength + cipher.ivLength ),
        "salt": res.data.salt,
    } );
}
