// NOTE: https://github.com/P-H-C/phc-string-format/blob/master/phc-sf-spec.md

const NAME_RE = /^[\da-z\-]{1,32}$/v,
    VALUE_RE = /^[\d+.\/A-Za-z\-]+$/v,
    INTEGER_RE = /^-?(?:0|[1-9]\d{0,15})$/v,
    PHC_RE = new RegExp(
        String.raw`^` +
            String.raw`\$(?<id>[\da-z\-]{1,32})` + // id
            String.raw`(?:\$v=(?<version>\d+))?` + // version
            String.raw`(?:\$(?<params>[\da-z\-]{1,32}=[\d+.\/A-Za-z\-]+(?:,[\da-z\-]{1,32}=[\d+.\/A-Za-z\-]+)*))?` + // params
            String.raw`(?:\$(?<salt>[\d+.\/A-Za-z\-]+))?` + // salt
            String.raw`(?:\$(?<hash>[\d+\/A-Za-z]+))?` + // hash
            String.raw`$`,
        "v"
    );

// public
export function toPhc ( { id, version, params, salt, hash, defaultParams, sortParams } = {} ) {
    if ( !NAME_RE.test( id ) ) throw "ID must be in the kebab-case";

    var string = "$" + id;

    // version
    if ( version != null ) {
        if ( typeof version !== "number" ) throw "Version must be a number";

        if ( defaultParams?.v == null || Number( defaultParams.v ) !== version ) {
            string += "$v=" + version;
        }
    }

    // params
    if ( params ) {
        const values = [];

        params = Object.entries( params );

        if ( sortParams ) {
            params = params.sort( ( a, b ) => a[ 0 ].localeCompare( b[ 0 ] ) );
        }

        let name, value;

        for ( [ name, value ] of params ) {

            // name
            if ( !NAME_RE.test( name ) ) throw "Name must be in the kebab-case";
            if ( name === "v" ) throw 'Parameter name should not be a "v"';

            // value
            value ??= defaultParams?.[ name ];

            if ( value == null ) {
                continue;
            }
            else if ( Buffer.isBuffer( value ) ) {
                value = value.toBase64( { "omitPadding": true } );
            }
            else if ( !VALUE_RE.test( value ) ) {
                throw "Parameter value is not valid";
            }

            if ( defaultParams?.[ name ] == null || String( defaultParams[ name ] ) !== String( value ) ) {
                values.push( name + "=" + value );
            }
        }

        if ( values.length ) {
            string += "$" + values.join( "," );
        }
    }

    // salt
    if ( salt != null ) {
        if ( typeof salt === "string" ) {
            if ( !VALUE_RE.test( salt ) ) throw "Salt is not valid";
        }
        else if ( Buffer.isBuffer( salt ) ) {
            salt = salt.toBase64( { "omitPadding": true } );
        }
        else {
            throw "Salt is not valid";
        }

        if ( salt.length ) {
            string += "$" + salt;

            // hash
            if ( hash != null ) {
                if ( Buffer.isBuffer( hash ) ) {
                    hash = hash.toBase64( { "omitPadding": true } );
                }
                else {
                    throw "Hash is not valid";
                }

                if ( hash.length ) {
                    string += "$" + hash;
                }
            }
        }
    }

    return string;
}

export function fromPhc ( string, { defaultParams, decodeNumbers = true, saltEncoding = "base64" } = {} ) {
    const match = string.match( PHC_RE );
    if ( !match ) throw "PHC string is not valid";

    const data = {
        "id": match.groups.id,
        "version": undefined,
        "params": undefined,
        "salt": match.groups.salt
            ? Buffer.from( match.groups.salt, saltEncoding )
            : undefined,
        "hash": match.groups.hash
            ? Buffer.fromBase64( match.groups.hash )
            : undefined,
    };

    // apply default values
    if ( defaultParams ) {
        for ( const [ name, value ] of Object.entries( defaultParams ) ) {
            if ( name === "v" ) {
                data.version = value == null
                    ? value
                    : Number( value );
            }
            else {
                data.params ??= {};

                if ( decodeNumbers && typeof value === "string" && INTEGER_RE.test( value ) ) {
                    data.params[ name ] = Number.parseInt( value );

                    if ( !Number.isSafeInteger( data.params[ name ] ) ) {
                        data.params[ name ] = value;
                    }
                }
                else {
                    data.params[ name ] = value;
                }
            }
        }
    }

    // version
    if ( match.groups.version ) {
        data.version = Number( match.groups.version );
    }

    // params
    if ( match.groups.params ) {
        data.params ??= {};

        for ( const param of match.groups.params.split( "," ) ) {
            const [ name, value ] = param.split( "=", 2 );

            if ( name === "v" ) continue;

            if ( decodeNumbers && INTEGER_RE.test( value ) ) {
                data.params[ name ] = Number.parseInt( value );

                if ( !Number.isSafeInteger( data.params[ name ] ) ) {
                    data.params[ name ] = value;
                }
            }
            else {
                data.params[ name ] = value;
            }
        }
    }

    return data;
}

export default class Phc {
    #id;
    #version;
    #params = new Map();
    #salt;
    #hash;
    #optionsString;
    #string;
    #defaultParams;
    #sortParams;

    constructor ( { id, version, params, salt, hash, defaultParams, sortParams = true } ) {

        // id
        if ( !NAME_RE.test( id ) ) throw "ID must be in the kebab-case";
        this.#id = id;

        // version
        if ( version != null ) {
            if ( typeof version !== "number" ) throw "Version must be a number";

            this.#version = version;
        }

        // params
        if ( params ) {
            for ( const name in params ) {

                // name
                if ( !NAME_RE.test( name ) ) {
                    throw new Error( `Parameter name "${ name }" must be in the kebab-case` );
                }
                if ( name === "v" ) {
                    throw new Error( 'Parameter name should not be a "v"' );
                }

                // value
                let value = params[ name ];

                // use default value
                if ( value === undefined ) {
                    value = defaultParams?.[ name ];
                }

                if ( value == null ) {
                    continue;
                }

                this.#params.set( name, value );
            }
        }

        // salt
        if ( salt != null ) {
            if ( typeof salt === "string" ) {
                if ( !VALUE_RE.test( salt ) ) throw "Salt is not valid";
            }
            else if ( !( salt instanceof Uint8Array ) ) {
                throw "Salt is not valid";
            }

            if ( salt.length ) {
                this.#salt = salt;
            }
        }

        // hash
        if ( this.#salt && hash != null ) {
            if ( !( hash instanceof Uint8Array ) ) {
                throw new Error( "Hash is not valid" );
            }

            this.#hash = hash;
        }

        this.#defaultParams = defaultParams;
        this.#sortParams = Boolean( sortParams );
    }

    // static
    static from ( string, { defaultParams, decodeNumbers = true, saltEncoding = "base64", sortParams } = {} ) {
        if ( string instanceof this ) {
            return string;
        }

        const match = string.match( PHC_RE );
        if ( !match ) throw "PHC string is not valid";

        const data = {
            "id": match.groups.id,
            "version": undefined,
            "params": undefined,
            "salt": match.groups.salt
                ? Uint8Array.fromBase64( match.groups.salt, { "alphabet": saltEncoding } )
                : undefined,
            "hash": match.groups.hash
                ? Uint8Array.fromBase64( match.groups.hash )
                : undefined,
            defaultParams,
            sortParams,
        };

        // version
        if ( match.groups.version ) {
            data.version = Number( match.groups.version );
        }

        // params
        if ( match.groups.params ) {
            data.params ??= {};

            for ( const param of match.groups.params.split( "," ) ) {
                const [ name, value ] = param.split( "=", 2 );

                if ( name === "v" ) continue;

                if ( decodeNumbers && INTEGER_RE.test( value ) ) {
                    data.params[ name ] = Number.parseInt( value );

                    if ( !Number.isSafeInteger( data.params[ name ] ) ) {
                        data.params[ name ] = value;
                    }
                }
                else {
                    data.params[ name ] = value;
                }
            }
        }

        return new this( data );
    }

    // properties
    get id () {
        return this.#id;
    }

    get version () {
        return this.#version;
    }

    get params () {
        return this.#params;
    }

    get salt () {
        return this.#salt;
    }

    get hash () {
        return this.#hash;
    }

    get optionsString () {
        if ( this.#optionsString == null ) {
            let string = "$" + this.#id;

            // version
            if ( this.#version != null ) {
                if ( this.#defaultParams?.v == null || Number( this.#defaultParams.v ) !== this.#version ) {
                    string += "$v=" + this.#version;
                }
            }

            // params
            if ( this.#params.size ) {
                let names;

                if ( this.#sortParams ) {
                    names = this.#params.keys().toArray().sort();
                }
                else {
                    names = this.#params.keys();
                }

                const params = [];

                for ( const name of names ) {
                    let value = this.#params.get( name );

                    if ( value instanceof Uint8Array ) {
                        value = value.toBase64( { "omitPadding": true } );
                    }
                    else if ( typeof value !== "string" ) {
                        value = String( value );

                        if ( !VALUE_RE.test( value ) ) {
                            throw new Error( `Parameter "${ name }" value is not valid` );
                        }
                    }

                    if ( this.#defaultParams?.[ name ] == null || String( this.#defaultParams[ name ] ) !== String( value ) ) {
                        params.push( name + "=" + value );
                    }
                }

                if ( params.length ) {
                    string += "$" + params.join( "," );
                }
            }

            // salt
            if ( this.#salt ) {
                let salt = this.#salt;

                if ( salt instanceof Uint8Array ) {
                    salt = salt.toBase64( { "omitPadding": true } );
                }

                string += "$" + salt;
            }

            this.#optionsString = string;
        }

        return this.#optionsString;
    }

    // public
    toString () {
        if ( this.#string == null ) {
            let string = this.optionsString;

            // hash
            if ( this.#salt ) {
                let hash = this.#hash;

                if ( hash instanceof Uint8Array ) {
                    hash = hash.toBase64( { "omitPadding": true } );
                }

                string += "$" + hash;
            }

            this.#string = string;
        }

        return this.#string;
    }

    toJSON () {
        return this.toStaing();
    }

    [ Symbol.for( "nodejs.util.inspect.custom" ) ] ( depth, options, inspect ) {
        const spec = {
            "phc": this.toString(),
        };

        return `${ this.constructor.name }: ${ inspect( spec ) }`;
    }
}
