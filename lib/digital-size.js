import CacheLru from "#lib/cache/lru";

const CACHE = new CacheLru( { "maxSize": 1000 } ),
    UNITS = {
        "B": "byte",
        "byte": "byte",
        "bytes": "byte",

        "KB": "kilobyte",
        "kilobyte": "kilobyte",
        "kilobytes": "kilobyte",

        "MB": "megabyte",
        "megabyte": "megabyte",
        "megabytes": "megabyte",

        "GB": "gigabyte",
        "gigabyte": "gigabyte",
        "gigabytes": "gigabyte",

        "TB": "terabyte",
        "terabyte": "terabyte",
        "terabytes": "terabyte",

        "PB": "petabyte",
        "petabyte": "petabyte",
        "petabytes": "petabyte",

        "KiB": "kibibyte",
        "kibibyte": "kibibyte",
        "kibibytes": "kibibyte",

        "MiB": "mebibyte",
        "mebibyte": "mebibyte",
        "mebibytes": "mebibyte",

        "GiB": "gibibyte",
        "gibibyte": "gibibyte",
        "gibibytes": "gibibyte",

        "TiB": "tebibyte",
        "tebibyte": "tebibyte",
        "tebibytes": "tebibyte",

        "PiB": "pebibyte",
        "pebibyte": "pebibyte",
        "pebibytes": "pebibyte",
    },
    UNIT_ABBR = {
        "petabyte": "PB",
        "terabyte": "TB",
        "gigabyte": "GB",
        "megabyte": "MB",
        "kilobyte": "KB",

        "pebibyte": "PiB",
        "tebibyte": "TiB",
        "gibibyte": "GiB",
        "mebibyte": "MiB",
        "kibibyte": "KiB",

        "byte": "B",
    },
    NGINX_SIZE_ABBR = {
        "mebibyte": "M",
        "kibibyte": "K",
    },
    NGINX_OFFSET_ABBR = {
        "gibibyte": "G", // NOTE not portable, for nginx offsets only
        "mebibyte": "M",
        "kibibyte": "K",
    },
    UNIT_KILO_BYTES = {
        "petabyte": 1000 ** 5,
        "terabyte": 1000 ** 4,
        "gigabyte": 1000 ** 3,
        "megabyte": 1000 ** 2,
        "kilobyte": 1000,
        "byte": 1,
    },
    UNIT_KIBI_BYTES = {
        "pebibyte": 1024 ** 5,
        "tebibyte": 1024 ** 4,
        "gibibyte": 1024 ** 3,
        "mebibyte": 1024 ** 2,
        "kibibyte": 1024,
        "byte": 1,
    },
    UNIT_BYTES = {
        "byte": 1,
        ...UNIT_KILO_BYTES,
        ...UNIT_KIBI_BYTES,
    };

export default class DigitalSize {
    #bytes = 0;
    #string = {};
    #formatDifitalSizeParam;

    constructor ( size, unit = "bytes" ) {

        // check unit
        if ( !UNITS[ unit ] ) throw new Error( "Digital size unit is not valid" );

        if ( size ) {

            // string
            if ( typeof size === "string" ) {
                const number = Number( size );

                if ( !Number.isNaN( number ) ) {
                    this.#bytes = number * UNIT_BYTES[ UNITS[ unit ] ];
                }
                else {
                    size = size.replaceAll( " ", "" ).trim();

                    const bytes = CACHE.get( size );

                    if ( bytes != null ) {
                        this.#bytes = bytes;
                    }
                    else {
                        const match = size.split( /([+-]?\d+(?:\.\d+)?)([A-Za-z]+)/ );

                        for ( let n = 0; n < match.length; n += 3 ) {
                            if ( match[ n ] !== "" ) throw new Error( "Digital size is not valid" );

                            if ( match[ n + 1 ] === undefined ) break;

                            const unit = UNITS[ match[ n + 2 ] ];
                            if ( !unit ) throw new Error( "Digital size is not valid" );

                            this.#bytes += Number( match[ n + 1 ] ) * UNIT_BYTES[ unit ];
                        }

                        CACHE.set( size, this.#bytes );
                    }
                }
            }

            // number
            else if ( typeof size === "number" ) {
                this.#bytes = size * UNIT_BYTES[ UNITS[ unit ] ];
            }

            // object
            else if ( typeof size === "object" ) {
                this.#bytes = size.bytes || 0;
            }

            // invalid
            else {
                throw new Error( "Digital size is not valid" );
            }
        }

        this.#bytes = Math.trunc( this.#bytes );
    }

    // static
    static new ( size, unit ) {
        if ( size instanceof this ) {
            return size;
        }
        else {
            return new this( size, unit );
        }
    }

    static compare ( a, b ) {
        return this.new( a ).compare( b );
    }

    static get comparator () {
        return this.compare.bind( this );
    }

    // properties
    get hasValue () {
        return !!this.#bytes;
    }

    get bytes () {
        return this.#bytes;
    }

    get kilobytes () {
        return this.#bytes / 1000;
    }

    get megabytes () {
        return this.#bytes / 1_000_000;
    }

    get gigabytes () {
        return this.#bytes / 1_000_000_000;
    }

    get terabytes () {
        return this.#bytes / 1_000_000_000_000;
    }

    get petabytes () {
        return this.#bytes / 1_000_000_000_000_000;
    }

    // public
    toString ( { units = "kilo" } = {} ) {
        if ( units === "kilo" ) {
            this.#string.kilo ??= this.#toString();

            return this.#string.kilo;
        }
        else if ( units === "kibi" ) {
            this.#string.kibi ??= this.#toString( true );

            return this.#string.kibi;
        }
        else {
            if ( !this.#string.auto ) {
                const bytes = Math.abs( this.#bytes );

                if ( bytes >= 1024 && !( bytes % 1024 ) ) {
                    this.#string.auto = this.#string.kibi ??= this.#toString( true );
                }
                else {
                    this.#string.auto = this.#string.kilo ??= this.#toString();
                }
            }

            return this.#string.auto;
        }
    }

    toJSON () {
        return this.toString();
    }

    toNginx ( { offset } = {} ) {
        const id = offset
            ? "nginxOffset"
            : "nginxSize";

        if ( this.#string[ id ] == null ) {
            if ( this.#bytes ) {
                const units = offset
                    ? NGINX_OFFSET_ABBR
                    : NGINX_SIZE_ABBR;

                for ( const [ unit, abbr ] of Object.entries( units ) ) {
                    if ( this.#bytes % UNIT_BYTES[ unit ] ) continue;

                    this.#string[ id ] = this.#bytes / UNIT_BYTES[ unit ] + abbr;

                    break;
                }

                // default
                this.#string[ id ] ??= this.#bytes;
            }
            else {
                this.#string[ id ] = "";
            }
        }

        return this.#string[ id ];
    }

    getFormatDifitalSizeParam () {
        if ( !this.#formatDifitalSizeParam ) {
            const bytes = Math.abs( this.#bytes ),
                unitsBytes = UNIT_KILO_BYTES;

            for ( const unit in unitsBytes ) {
                if ( bytes >= unitsBytes[ unit ] ) {
                    this.#formatDifitalSizeParam = {
                        unit,
                        "value": this.#bytes / unitsBytes[ unit ],
                    };

                    break;
                }
            }

            // default
            this.#formatDifitalSizeParam ??= {
                "unit": "byte",
                "value": 0,
            };
        }

        return this.#formatDifitalSizeParam;
    }

    compare ( size, unit ) {
        size = this.constructor.new( size, unit );

        return this.bytes - size.bytes;
    }

    eq ( size, unit ) {
        return this.compare( size, unit ) === 0;
    }

    ne ( size, unit ) {
        return this.compare( size, unit ) !== 0;
    }

    lt ( size, unit ) {
        return this.compare( size, unit ) < 0;
    }

    lte ( size, unit ) {
        return this.compare( size, unit ) <= 0;
    }

    gt ( size, unit ) {
        return this.compare( size, unit ) > 0;
    }

    gte ( size, unit ) {
        return this.compare( size, unit ) >= 0;
    }

    add ( size, unit ) {
        return new this.constructor( this.#bytes + this.constructor.new( size, unit ).bytes, "bytes" );
    }

    subtract ( size, unit ) {
        return new this.constructor( this.#bytes - this.constructor.new( size, unit ).bytes, "bytes" );
    }

    [ Symbol.for( "nodejs.util.inspect.custom" ) ] ( depth, options, inspect ) {
        const spec = {
            "size": this.toString(),
        };

        return `${ this.constructor.name }: ${ inspect( spec ) }`;
    }

    // private
    #toString ( kibi ) {
        const units = [],
            sign = this.#bytes < 0
                ? "-"
                : "";

        let bytes = Math.abs( this.#bytes );

        const unitsBytes = kibi
            ? UNIT_KIBI_BYTES
            : UNIT_KILO_BYTES;

        for ( const [ unit, unitBytes ] of Object.entries( unitsBytes ) ) {
            if ( bytes >= unitBytes ) {
                const remainder = bytes % unitBytes;

                units.push( sign + ( bytes - remainder ) / unitBytes + " " + UNIT_ABBR[ unit ] );

                bytes = remainder;
            }
        }

        if ( units.length ) {
            return units.join( " " );
        }
        else {
            return "0 " + UNIT_ABBR.byte;
        }
    }
}
