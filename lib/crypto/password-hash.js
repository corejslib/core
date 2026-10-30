import "#lib/result";
import crypto from "node:crypto";
import RandomValues from "#lib/crypto/random-values";
import Phc from "#lib/phc";

const DEFAULT_PRESET = "owasp",
    ARGON2_VERSIONS = new Set( [ 16, 19 ] ),
    ALGORITHMS = {

        // based on argon2-rfc9106-64MiB
        "argon2id": {
            "id": "argon2id",
            "type": "argon2",
            "version": 19,
            "memoryCost": 64 * 1024, // 64 MiB
            "timeCost": 3,
            "parallelism": 1,
            "saltLength": 16,
            "hashLength": 16,
        },
        "argon2i": {
            "id": "argon2i",
            "type": "argon2",
            "version": 19,
            "memoryCost": 64 * 1024, // 64 MiB
            "timeCost": 3,
            "parallelism": 1,
            "saltLength": 16,
            "hashLength": 16,
        },
        "argon2d": {
            "id": "argon2d",
            "type": "argon2",
            "version": 19,
            "memoryCost": 64 * 1024, // 64 MiB
            "timeCost": 3,
            "parallelism": 1,
            "saltLength": 16,
            "hashLength": 16,
        },

        // based on owasp pbkdf2
        "pbkdf2-sha1": {
            "id": "pbkdf2-sha1",
            "type": "pbkdf2",
            "digest": "SHA1",
            "iterations": 1_400_000,
            "saltLength": 16,
            "hashLength": 16,
        },
        "pbkdf2-sha256": {
            "id": "pbkdf2-sha256",
            "type": "pbkdf2",
            "digest": "SHA256",
            "iterations": 600_000,
            "saltLength": 16,
            "hashLength": 16,
        },
        "pbkdf2-sha512": {
            "id": "pbkdf2-sha512",
            "type": "pbkdf2",
            "digest": "SHA512",
            "iterations": 220_000,
            "saltLength": 16,
            "hashLength": 16,
        },

        // based on owasp-scrypt-32MiB
        "scrypt": {
            "id": "scrypt",
            "type": "scrypt",
            "cost": 32 * 1024, // 32 MiB
            "blockSize": 8, // 1024 bytes
            "parallelism": 3,
            "saltLength": 16,
            "hashLength": 16,
        },
    },
    PRESETS = {

        // owasp
        // DOCS: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
        "owasp": { "id": "argon2id", "version": 19, "memoryCost": 12 * 1024, "timeCost": 3, "parallelism": 1 },

        // DOCS: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#argon2id
        "owasp-argon2": { "id": "argon2id", "version": 19, "memoryCost": 12 * 1024, "timeCost": 3, "parallelism": 1 },
        "owasp-argon2-46MiB": { "id": "argon2id", "version": 19, "memoryCost": 46 * 1024, "timeCost": 1, "parallelism": 1 },
        "owasp-argon2-19MiB": { "id": "argon2id", "version": 19, "memoryCost": 19 * 1024, "timeCost": 2, "parallelism": 1 },
        "owasp-argon2-12MiB": { "id": "argon2id", "version": 19, "memoryCost": 12 * 1024, "timeCost": 3, "parallelism": 1 },
        "owasp-argon2-9MiB": { "id": "argon2id", "version": 19, "memoryCost": 9 * 1024, "timeCost": 4, "parallelism": 1 },
        "owasp-argon2-7MiB": { "id": "argon2id", "version": 19, "memoryCost": 7 * 1024, "timeCost": 5, "parallelism": 1 },

        // DOCS: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#pbkdf2
        "owasp-pbkdf2": { "id": "pbkdf2-sha256", "iterations": 600_000 },
        "owasp-pbkdf2-sha1": { "id": "pbkdf2-sha1", "iterations": 1_400_000 },
        "owasp-pbkdf2-sha256": { "id": "pbkdf2-sha256", "iterations": 600_000 },
        "owasp-pbkdf2-sha512": { "id": "pbkdf-sha512", "iterations": 220_000 },

        // DOCS: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#scrypt
        "owasp-scrypt": { "id": "scrypt", "cost": 32 * 1024, "blockSize": 8, "parallelism": 3 },
        "owasp-scrypt-128MiB": { "id": "scrypt", "cost": 128 * 1024, "blockSize": 8, "parallelism": 1 },
        "owasp-scrypt-64MiB": { "id": "scrypt", "cost": 64 * 1024, "blockSize": 8, "parallelism": 2 },
        "owasp-scrypt-32MiB": { "id": "scrypt", "cost": 32 * 1024, "blockSize": 8, "parallelism": 3 },
        "owasp-scrypt-16MiB": { "id": "scrypt", "cost": 16 * 1024, "blockSize": 8, "parallelism": 4 },
        "owasp-scrypt-8MiB": { "id": "scrypt", "cost": 8 * 1024, "blockSize": 8, "parallelism": 10 },

        // argon2
        "argon2": { "id": "argon2id" },
        "argon2id": { "id": "argon2id" },
        "argon2i": { "id": "argon2i" },
        "argon2d": { "id": "argon2d" },

        // DOCS: rfc-9106 recommended settings
        // https://datatracker.ietf.org/doc/html/rfc9106#name-recommendations
        "argon2-rfc9106-64MiB": { "id": "argon2id", "version": 19, "memoryCost": 64 * 1024, "timeCost": 3, "parallelism": 1 },
        "argon2-rfc9106-2GiB": { "id": "argon2id", "version": 19, "memoryCost": 2 * 1024 ** 2, "timeCost": 1, "parallelism": 1 },

        // pbkdf2
        "pbkdf2": { "id": "pbkdf2-sha256" },
        "pbkdf2-sha1": { "id": "pbkdf2-sha1" },
        "pbkdf2-sha256": { "id": "pbkdf2-sha256" },
        "pbkdf2-sha512": { "id": "pbkdf2-sha512" },

        // scrypt
        "scrypt": { "id": "scrypt" },
    },
    PHC_PARAMS = {
        "argon2": {
            "memoryCost": "m",
            "timeCost": "t",
            "parallelism": "p",
        },
        "pbkdf2": {
            "iterations": "i",
        },
        "scrypt": {
            "cost": "n",
            "blockSize": "r",
            "parallelism": "p",
        },
    };

// merge algorithms and presets
for ( const preset in PRESETS ) {
    PRESETS[ preset ] = {
        ...ALGORITHMS[ PRESETS[ preset ].id ],
        ...PRESETS[ preset ],
    };
}

export default class PasswordHash {
    #preset;
    #options;
    #secret;

    constructor ( { "preset": presetName, version, memoryCost, timeCost, parallelism, cost, blockSize, maxMemory, iterations, saltLength, hashLength, secret } = {} ) {
        presetName ||= DEFAULT_PRESET;

        if ( !PRESETS[ presetName ] ) throw new Error( "Preset name is not valid" );

        this.#preset = presetName;

        if ( secret ) {
            this.#secret = this.#parseSecret( secret );
            if ( !this.#secret ) throw "Secret is not valid";
        }

        this.#options = {
            ...PRESETS[ this.#preset ],
        };

        if ( saltLength ) this.#options.saltLength = saltLength;
        if ( this.#options.saltLength < 8 || this.#options.saltLength > 64 ) throw "Salt length value is not valid";

        if ( hashLength ) this.#options.hashLength = hashLength;
        if ( this.#options.hashLength < 12 || this.#options.hashLength > 64 ) throw "Hash length value is not valid";

        // argon2
        if ( this.#options.type === "argon2" ) {
            if ( version ) this.#options.version = version;
            if ( !ARGON2_VERSIONS.has( this.#options.version ) ) throw "Argon2 version is not valid";

            if ( memoryCost ) this.#options.memoryCost = memoryCost;
            if ( this.#options.memoryCost < 1 || this.#options.memoryCost > 2 ** 32 - 1 ) throw "Argon2 memory cost value is not valid";

            if ( timeCost ) this.#options.timeCost = timeCost;
            if ( this.#options.timeCost < 1 || this.#options.timeCost > 2 ** 32 - 1 ) throw "Argon2 time cost value is not valid";

            if ( parallelism ) this.#options.parallelism = parallelism;
            if ( this.#options.parallelism < 1 || this.#options.parallelism > 255 ) throw "Argon2 parallelism value is not valid";
        }

        // pbkdf2
        else if ( this.#options.type === "pbkdf2" ) {
            if ( iterations ) this.#options.iterations = iterations;
        }

        // scrypt
        else if ( this.#options.type === "scrypt" ) {
            if ( cost ) this.#options.cost = cost;
            if ( blockSize ) this.#options.blockSize = blockSize;
            if ( parallelism ) this.#options.parallelism = parallelism;

            this.#options.maxMemory = maxMemory || this.constructor.calculateScryptMaxMemory( this.#options );
        }
    }

    // static
    static get presets () {
        return PRESETS;
    }

    static get defaultPreset () {
        return DEFAULT_PRESET;
    }

    static new ( passwordHash ) {
        if ( passwordHash instanceof this ) {
            return passwordHash;
        }
        else {
            return new this( passwordHash );
        }
    }

    static calculateScryptMaxMemory ( { cost, blockSize, parallelism } ) {

        // 128 * p * r + 128 * ( 2 + N ) * r
        return 128 * parallelism * blockSize + 128 * ( 2 + cost ) * blockSize;
    }

    // properties
    get preset () {
        return this.#preset;
    }

    get id () {
        return this.#options.id;
    }

    get version () {
        return this.#options.version;
    }

    get memoryCost () {
        return this.#options.memoryCost;
    }

    get timeCost () {
        return this.#options.timeCost;
    }

    get parallelism () {
        return this.#options.parallelism;
    }

    get cost () {
        return this.#options.cost;
    }

    get blockSize () {
        return this.#options.blockSize;
    }

    get maxMemory () {
        return this.#options.maxMemory;
    }

    get digest () {
        return this.#options.digest;
    }

    get iterations () {
        return this.#options.iterations;
    }

    get saltLength () {
        return this.#options.saltLength;
    }

    get hashLength () {
        return this.#options.hashLength;
    }

    // public
    async createPasswordHash ( password, { phc = true, salt, secret, data, hashLength } = {} ) {

        // generate salt
        if ( !salt ) {
            salt = Buffer.from( RandomValues.default.getRandomArrayBuffer( this.saltLength ) );
        }

        // argon2
        if ( this.#options.type === "argon2" ) {
            let res;

            // secret
            res = await this.#resolveSecret( secret );
            if ( !res.ok ) return res;
            secret = res.data;

            // data
            res = this.#validateData( data );
            if ( !res.ok ) return res;
            data = res.data;
        }

        return this.#createHash( password, {
            ...this.#options,
            phc,
            salt,
            secret,
            data,
            "hashLength": hashLength || this.#options.hashLength,
        } );
    }

    async verifyPasswordHash ( digest, password, { update, phc = true, secret, data, hashLength } = {} ) {
        try {
            if ( !Buffer.isBuffer( password ) ) password = Buffer.from( password );

            const parsedPhc = Phc.from( digest );

            const algorithm = ALGORITHMS[ parsedPhc.id ];
            if ( !algorithm ) return result( [ 500, "Algorithm is not supported" ] );

            const defaults = parsedPhc.id === this.id
                    ? this.#options
                    : algorithm,
                options = {
                    ...defaults,
                    "phc": false,
                    "salt": parsedPhc.salt,
                    "hashLength": hashLength || defaults.hashLength,
                };

            var requireUpdate = false,
                compareHash = true;

            if ( parsedPhc.id !== this.id ) {
                requireUpdate = true;
            }

            if ( options.hashLength !== parsedPhc.hash.length ) {
                requireUpdate = true;

                options.hashLength = parsedPhc.hash.length;
            }

            if ( options.saltLength !== parsedPhc.salt.length ) {
                requireUpdate = true;
            }

            // check params
            for ( const [ propertyName, phcName ] of Object.entries( PHC_PARAMS[ options.type ] ) ) {

                // parameter not exists
                if ( !parsedPhc.params.get( phcName ) ) {
                    requireUpdate = true;
                }

                // parameter exists but not equal to the default value
                else if ( parsedPhc.params.get( phcName ) !== options[ propertyName ] ) {
                    requireUpdate = true;

                    options[ propertyName ] = parsedPhc.params.get( phcName );
                }
            }

            // argon2
            if ( options.type === "argon2" ) {

                // version
                if ( !parsedPhc.version ) {
                    requireUpdate = true;
                }
                else if ( !ARGON2_VERSIONS.has( parsedPhc.version ) ) {
                    requireUpdate = true;
                    compareHash = false;
                }
                else if ( options.version !== parsedPhc.version ) {
                    requireUpdate = true;

                    options.version = parsedPhc.version;
                }

                // secret
                const res = await this.#resolveSecret( secret, {
                    "id": parsedPhc.params.get( "key" ),
                    "verify": true,
                } );
                if ( !res.ok ) return res;

                options.secret = res.data;
                requireUpdate = options.secret?.requireUpdate;

                // data is not defined
                if ( data === undefined ) {

                    // use old data
                    data = options.data = parsedPhc.params.get( "data" );
                }

                // data is defined
                else {

                    // validate data
                    const res = this.#validateData( data );
                    if ( !res.ok ) return res;
                    data = res.data;

                    // data changed
                    if ( parsedPhc.params.get( "data" ) !== data ) {
                        requireUpdate = true;
                        compareHash = false;
                    }

                    // data not changed
                    else {
                        options.data = data;
                    }
                }
            }

            // scrypt
            else if ( options.type === "scrypt" ) {

                // max memory
                options.maxMemory = this.maxMemory || this.constructor.calculateScryptMaxMemory( options );
            }

            let match;

            // compare hash
            if ( compareHash ) {
                const res = await this.#createHash( password, options );
                if ( !res.ok ) return res;

                match = crypto.timingSafeEqual( res.data.hash, parsedPhc.hash );
            }

            let updatedHash;

            if ( update && requireUpdate ) {
                const res = await this.createPasswordHash( password, { phc, secret, data, hashLength } );
                if ( !res.ok ) return res;

                updatedHash = res.data;
            }
            else {
                updatedHash = {};
            }

            if ( match ) {
                return result( 200, {
                    requireUpdate,
                    ...updatedHash,
                } );
            }
            else {
                return result( [ 400, "Password is not valid" ], {
                    requireUpdate,
                    ...updatedHash,
                } );
            }
        }
        catch ( e ) {
            return result.fromError( e );
        }
    }

    // private
    async #createHash ( password, options ) {
        try {
            if ( !Buffer.isBuffer( password ) ) password = Buffer.from( password );

            let hash;

            // argon2
            if ( options.type === "argon2" ) {
                hash = await this.#createArgon2Hash( password, options );
            }

            // pbkdf2
            else if ( options.type === "pbkdf2" ) {
                hash = await this.#createPbkdf2Hash( password, options );
            }

            // scrypt
            else if ( options.type === "scrypt" ) {
                hash = await this.#createScryptHash( password, options );
            }

            return result( 200, hash );
        }
        catch ( e ) {
            return result.fromError( e );
        }
    }

    async #createArgon2Hash ( password, { id, phc, salt, hashLength, version, memoryCost, timeCost, parallelism, secret, data } ) {
        const hash = await new Promise( ( resolve, reject ) => {
            crypto.argon2(
                id,
                {
                    "message": password,
                    "nonce": salt,
                    parallelism,
                    "tagLength": hashLength,
                    "memory": memoryCost,
                    "passes": timeCost,
                    "secret": secret?.key,
                    "associatedData": data,
                },
                ( e, hash ) => {
                    if ( e ) {
                        reject( e );
                    }
                    else {
                        resolve( hash );
                    }
                }
            );
        } );

        if ( phc ) {
            return {
                salt,
                hash,
                "phc": new Phc( {
                    id,
                    version,
                    "params": {
                        [ PHC_PARAMS.argon2.memoryCost ]: memoryCost,
                        [ PHC_PARAMS.argon2.timeCost ]: timeCost,
                        [ PHC_PARAMS.argon2.parallelism ]: parallelism,
                        "key": secret?.id && secret?.key
                            ? secret.id
                            : undefined,
                        data,
                    },
                    salt,
                    hash,
                } ),
            };
        }
        else {
            return {
                salt,
                hash,
            };
        }
    }

    async #createPbkdf2Hash ( password, { id, phc, salt, hashLength, digest, iterations } ) {
        const hash = await new Promise( ( resolve, reject ) => {
            crypto.pbkdf2( password, salt, iterations, hashLength, digest, ( e, hash ) => {
                if ( e ) {
                    reject( e );
                }
                else {
                    resolve( hash );
                }
            } );
        } );

        if ( phc ) {
            return {
                salt,
                hash,
                "phc": new Phc( {
                    id,
                    "version": undefined,
                    "params": {
                        [ PHC_PARAMS.pbkdf2.iterations ]: iterations,
                    },
                    salt,
                    hash,
                } ),
            };
        }
        else {
            return {
                salt,
                hash,
            };
        }
    }

    async #createScryptHash ( password, { id, phc, salt, hashLength, cost, blockSize, parallelism, maxMemory } ) {
        const hash = await new Promise( ( resolve, reject ) => {
            crypto.scrypt(
                password,
                salt,
                hashLength,
                {
                    cost,
                    blockSize,
                    "parallelization": parallelism,
                    "maxmem": maxMemory,
                },
                ( e, hash ) => {
                    if ( e ) {
                        reject( e );
                    }
                    else {
                        resolve( hash );
                    }
                }
            );
        } );

        if ( phc ) {
            return {
                salt,
                hash,
                "phc": new Phc( {
                    id,
                    "version": undefined,
                    "params": {
                        [ PHC_PARAMS.scrypt.cost ]: cost,
                        [ PHC_PARAMS.scrypt.blockSize ]: blockSize,
                        [ PHC_PARAMS.scrypt.parallelism ]: parallelism,
                    },
                    salt,
                    hash,
                } ),
            };
        }
        else {
            return {
                salt,
                hash,
            };
        }
    }

    #parseSecret ( secret ) {
        if ( typeof secret === "function" ) {
            return {
                "resolve": secret,
            };
        }
        else if ( typeof secret === "string" || Buffer.isBuffer( secret ) ) {
            return {
                "key": secret.length
                    ? secret
                    : undefined,
            };
        }
    }

    async #resolveSecret ( secret, { id, verify } = {} ) {
        if ( secret != null ) {
            secret = this.#parseSecret( secret );
            if ( !secret ) return result( [ 400, "Secret is not valid" ] );
        }
        else if ( this.#secret ) {
            secret = this.#secret;
        }
        else {
            return result( 200 );
        }

        if ( secret.resolve ) {
            try {
                return result.try( await secret.resolve( { id, verify } ) );
            }
            catch ( e ) {
                return result.fromError( e, { "log": false } );
            }
        }
        else {
            return result( 200, secret );
        }
    }

    #validateData ( data ) {
        if ( data ) {
            if ( typeof data !== "string" || /[$,]/v.test( data ) ) {
                return result( [ 400, "Data parameter is not valid" ] );
            }
        }
        else {
            data = undefined;
        }

        return result( 200, data );
    }
}
