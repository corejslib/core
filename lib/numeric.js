import RandomValues from "#lib/crypto/random-values";

const MAX_PRECISION = 1000,
    DEFAULT_PRECISION = 1000,
    DEFAULT_SCALE = 16,
    DEFAULT_ROUNDING_MODE = "ROUND_HALF_UP",
    DEFAULT_MODULO_MODE = "ROUND_DOWN",
    ROUNDING_MODES = new Set( [
        "ROUND_UP", // rounds away from zero
        "ROUND_DOWN", // rounds towards zero (truncate)
        "ROUND_CEIL", // rounds towards Infinity (ceil)
        "ROUND_FLOOR", // rounds towards -Infinity (floor)
        "ROUND_HALF_UP", // rounds towards nearest neighbour, if equidistant, rounds away from zero (default)
        "ROUND_HALF_DOWN", // rounds towards nearest neighbour, if equidistant, rounds towards zero
        "ROUND_HALF_EVEN", // rounds towards nearest neighbour, if equidistant, rounds towards even neighbour
        "ROUND_HALF_CEIL", // rounds towards nearest neighbour, if equidistant, rounds towards Infinity (default in JavaScript)
        "ROUND_HALF_FLOOR", // rounds towards nearest neighbour, if equidistant, rounds towards -Infinity
    ] ),
    MODULO_MODES = new Set( [
        "ROUND_UP", // remainder is positive if the dividend is negative, otherwise negative
        "ROUND_DOWN", // remainder has the same sign as the dividend (truncating division, matches JavaScript "%")
        "ROUND_FLOOR", // remainder has the same sign as the divisor (matches Python "%")
        "ROUND_HALF_EVEN", // the IEEE 754 remainder function
        "EUCLID", // remainder is always positive (Euclidian division): q = sign( n ) * floor( a / abs( n ) )
    ] ),
    RADIX_CHARS = {
        "2": "b",
        "8": "o",
        "10": null,
        "16": "x",
    },
    RADIX_INFO = {
        "b": { "radixChar": "b", "radix": 2n, "bits": 1, "re": /^[01]+$/v },
        "o": { "radixChar": "o", "radix": 8n, "bits": 3, "re": /^[0-7]+$/v },
        "x": { "radixChar": "x", "radix": 16n, "bits": 4, "re": /^[0-9a-f]+$/iv },
    },
    JSON_STRINGS = {
        "NaN": Number.NaN,
        "Infinity": Infinity,
        "-Infinity": -Infinity,
    },
    POW10_CACHE = [ 1n ],
    NUMERICS = {},
    LN_REDUCTION_STEPS = 32,
    EXP_REDUCTION_BITS = 30,
    MIN_SIG_DIGITS = 16,
    BIGINT_LITERAL_RE = /^(?:[+\-]?\d+|0x[0-9a-f]+|0o[0-7]+|0b[01]+)$/iv;

// public
export default function NumericBuilder ( value, options ) {
    return Numeric.new( value, options );
}

// private
class Numeric {
    #PRECISION;
    #SCALE;
    #ROUNDING_MODE;
    #MODULO_MODE;
    #MAX_INTEGER;
    #value;
    #precision;
    #scale;
    #rawValue;
    #rawPrecision;
    #rawScale;
    #string = {};
    #number;
    #bigint;
    #bin;
    #oct;
    #hex;
    #sign;
    #abs;
    #negated;
    #rounded;
    #fractional;
    #compareRank;
    #sqrt;
    #cbrt;
    #loge;
    #log2;
    #log10;

    constructor ( value, { precision, scale, roundingMode, moduloMode, radix, valueScale } = {} ) {
        if ( precision ) {
            this.#PRECISION = precision;
            this.#SCALE = scale == null
                ? 0
                : scale;
        }
        else {
            this.#PRECISION = DEFAULT_PRECISION;
            this.#SCALE = scale == null
                ? Math.min( DEFAULT_SCALE, this.#PRECISION )
                : scale;
        }

        this.#ROUNDING_MODE = roundingMode || DEFAULT_ROUNDING_MODE;
        this.#MODULO_MODE = moduloMode || DEFAULT_MODULO_MODE;

        if ( !Number.isSafeInteger( this.#PRECISION ) || this.#PRECISION <= 0 || this.#PRECISION > MAX_PRECISION ) {
            throw new Error( "Numeric precision must be a positive integer" );
        }

        if ( !Number.isSafeInteger( this.#SCALE ) || this.#SCALE < 0 || this.#SCALE > this.#PRECISION ) {
            throw new Error( "Numeric scale must be a non-negative integer or null" );
        }

        if ( !ROUNDING_MODES.has( this.#ROUNDING_MODE ) ) {
            throw new Error( `Numeric roundingMode "${ this.#ROUNDING_MODE }" is not valid` );
        }

        if ( !MODULO_MODES.has( this.#MODULO_MODE ) ) {
            throw new Error( `Numeric moduloMode "${ this.#MODULO_MODE }" is not valid` );
        }

        // bigint
        if ( typeof value === "bigint" ) {
            this.#rawScale = valueScale || 0;
        }

        // number
        else if ( typeof value === "number" ) {

            // finite
            if ( Number.isFinite( value ) ) {

                // integer
                if ( Number.isInteger( value ) ) {
                    value = BigInt( value );
                    this.#rawScale = 0;
                }

                // fractional
                else {
                    [ value, this.#rawScale ] = parseString( value.toString() );
                }
            }
        }

        // Numeric
        else if ( value instanceof this.constructor ) {
            this.#rawPrecision = value.#rawPrecision;
            this.#rawScale = value.#rawScale;
            value = value.#rawValue;
        }

        // View
        else if ( ArrayBuffer.isView( value ) ) {
            value = this.#parseString( new TextDecoder( "iso-8859-1" ).decode( new Uint8Array( value.buffer, value.byteOffset, value.byteLength ) ), radix );
        }

        // string
        else if ( typeof value === "string" ) {
            value = this.#parseString( value, radix );
        }

        // error
        else {
            throw new TypeError( "Numeric type is not valid" );
        }

        if ( typeof value === "bigint" ) {

            // remove trailing zeros in fractional part
            if ( value === 0n ) {
                this.#rawPrecision = 0;
                this.#rawScale = 0;
            }
            else {
                while ( this.#rawScale > 0 && value % 10n === 0n ) {
                    value /= 10n;
                    this.#rawScale--;
                }
            }

            // round to integer
            if ( !this.#SCALE && this.#rawScale ) {
                value = roundBigInt( value, this.#rawScale, this.#SCALE, this.#ROUNDING_MODE );
                this.#rawScale = 0;
            }

            // calculate precision
            this.#rawPrecision ??= ( value < 0n
                ? -value
                : value ).toString().length;

            // check integer part precision
            if ( this.#rawPrecision - this.#rawScale > this.#PRECISION ) {
                throw new Error( `Numeric integer part exceeds precision (${ this.#PRECISION })` );
            }

            // integer
            if ( !this.#rawScale ) {
                this.#value = value;
                this.#precision = this.#rawPrecision;
                this.#scale = 0;
            }
        }
        else {
            this.#rawPrecision = 0;
            this.#rawScale = 0;

            this.#precision = 0;
            this.#scale = 0;
        }

        this.#rawValue = value;
    }

    // static
    static new ( numeric, options ) {
        if ( numeric instanceof this ) {
            return numeric;
        }
        else {
            return new this( numeric, options );
        }
    }

    static get compare () {
        return ( a, b ) => this.new( a ).compare( b );
    }

    static get MAX_PRECISION () {
        return MAX_PRECISION;
    }

    static get DEFAULT_PRECISION () {
        return DEFAULT_PRECISION;
    }

    static get MAX_SAFE_INTEGER () {
        NUMERICS.MAX_SAFE_INTEGER ??= new this( Number.MAX_SAFE_INTEGER );

        return NUMERICS.MAX_SAFE_INTEGER;
    }

    static get MIN_SAFE_INTEGER () {
        NUMERICS.MIN_SAFE_INTEGER ??= new this( Number.MIN_SAFE_INTEGER );

        return NUMERICS.MIN_SAFE_INTEGER;
    }

    static get INT8_PRECISION () {
        return 3;
    }

    static get INT16_PRECISION () {
        return 5;
    }

    static get INT32_PRECISION () {
        return 10;
    }

    static get INT53_PRECISION () {
        return 16;
    }

    static get INT64_PRECISION () {
        return 20;
    }

    static get INT128_PRECISION () {
        return 40;
    }

    static get MIN_INT8 () {
        NUMERICS.MIN_INT8 ??= this.MAX_UINT8.add( 1 ).divide( 2 ).negated;

        return NUMERICS.MIN_INT8;
    }

    static get MAX_INT8 () {
        NUMERICS.MAX_INT8 ??= this.MAX_UINT8.subtract( 1 ).divide( 2 );

        return NUMERICS.MAX_INT8;
    }

    static get MAX_UINT8 () {
        NUMERICS.MAX_UINT8 ??= new this( 0xFF, {
            "precision": this.INT8_PRECISION,
        } );

        return NUMERICS.MAX_UINT8;
    }

    static get MIN_INT16 () {
        NUMERICS.MIN_INT16 ??= this.MAX_UINT16.add( 1 ).divide( 2 ).negated;

        return NUMERICS.MIN_INT16;
    }

    static get MAX_INT16 () {
        NUMERICS.MAX_INT16 ??= this.MAX_UINT16.subtract( 1 ).divide( 2 );

        return NUMERICS.MAX_INT16;
    }

    static get MAX_UINT16 () {
        NUMERICS.MAX_UINT16 ??= new this( 0xFFFF, {
            "precision": this.INT16_PRECISION,
        } );

        return NUMERICS.MAX_UINT16;
    }

    static get MIN_INT32 () {
        NUMERICS.MIN_INT32 ??= this.MAX_UINT32.add( 1 ).divide( 2 ).negated;

        return NUMERICS.MIN_INT32;
    }

    static get MAX_INT32 () {
        NUMERICS.MAX_INT32 ??= this.MAX_UINT32.subtract( 1 ).divide( 2 );

        return NUMERICS.MAX_INT32;
    }

    static get MAX_UINT32 () {
        NUMERICS.MAX_UINT32 ??= new this( 0xFFFF_FFFF, {
            "precision": this.INT32_PRECISION,
        } );

        return NUMERICS.MAX_UINT32;
    }

    static get MIN_INT53 () {
        return this.MAX_UINT53.negated;
    }

    static get MAX_INT53 () {
        return this.MAX_UINT53;
    }

    static get MAX_UINT53 () {
        NUMERICS.MAX_UINT53 ??= new this( Number.MAX_SAFE_INTEGER, {
            "precision": this.INT53_PRECISION,
        } );

        return NUMERICS.MAX_UINT53;
    }

    static get MIN_INT64 () {
        NUMERICS.MIN_INT64 ??= this.MAX_UINT64.add( 1 ).divide( 2 ).negated;

        return NUMERICS.MIN_INT64;
    }

    static get MAX_INT64 () {
        NUMERICS.MAX_INT64 ??= this.MAX_UINT64.subtract( 1 ).divide( 2 );

        return NUMERICS.MAX_INT64;
    }

    static get MAX_UINT64 () {
        NUMERICS.MAX_UINT64 ??= new this( "0xFFFFFFFFFFFFFFFF", {
            "precision": this.INT64_PRECISION,
        } );

        return NUMERICS.MAX_UINT64;
    }

    static get MIN_INT128 () {
        NUMERICS.MIN_INT128 ??= this.MAX_UINT128.add( 1 ).divide( 2 ).negated;

        return NUMERICS.MIN_INT128;
    }

    static get MAX_INT128 () {
        NUMERICS.MAX_INT128 ??= this.MAX_UINT128.subtract( 1 ).divide( 2 );

        return NUMERICS.MAX_INT128;
    }

    static get MAX_UINT128 () {
        NUMERICS.MAX_UINT128 ??= new this( "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF", {
            "precision": this.INT128_PRECISION,
        } );

        return NUMERICS.MAX_UINT128;
    }

    static isNumeric ( value ) {
        return value instanceof this;
    }

    static isNaN ( value ) {
        if ( this.isNumeric( value ) ) {
            return value.isNaN;
        }
        else {
            return Number.isNaN( value );
        }
    }

    static isFinite ( value ) {
        if ( this.isNumeric( value ) ) {
            return value.isFinite;
        }
        else {
            return Number.isFinite( value );
        }
    }

    static isInteger ( value ) {
        if ( this.isNumeric( value ) ) {
            return value.isInteger;
        }
        else {
            return Number.isInteger( value );
        }
    }

    static isSafeInteger ( value ) {
        if ( this.isNumeric( value ) ) {
            return value.isSafeInteger;
        }
        else {
            return Number.isSafeInteger( value );
        }
    }

    static abs ( value ) {

        // bigint
        if ( typeof value === "bigint" ) {
            if ( value < 0n ) {
                return 0n - value;
            }
            else {
                return value;
            }
        }

        // number
        else if ( typeof value === "number" ) {
            return Math.abs( value );
        }

        // other
        else {
            return this.new( value ).abs;
        }
    }

    static round ( value, { scale, roundingMode = DEFAULT_ROUNDING_MODE } = {} ) {

        // bigint
        if ( typeof value === "bigint" ) {
            return value;
        }

        // number
        else if ( typeof value === "number" ) {
            if ( roundingMode === "ROUND_HALF_CEIL" ) {
                if ( scale ) {
                    scale = 10 ** scale;

                    return Math.round( value * scale ) / scale;
                }
                else {
                    return Math.round( value );
                }
            }
            else {
                return new this( value ).round( { scale, roundingMode } ).number;
            }
        }

        // other
        else {
            return this.new( value ).round( { scale, roundingMode } );
        }
    }

    static truncate ( value, { scale } = {} ) {

        // bigint
        if ( typeof value === "bigint" ) {
            return value;
        }

        // number
        else if ( typeof value === "number" ) {
            if ( scale ) {
                scale = 10 ** scale;

                return Math.trunc( value * scale ) / scale;
            }
            else {
                return Math.trunc( value );
            }
        }

        // other
        else {
            return this.new( value ).truncate( { scale } );
        }
    }

    static floor ( value, { scale } = {} ) {

        // bigint
        if ( typeof value === "bigint" ) {
            return value;
        }

        // number
        else if ( typeof value === "number" ) {
            if ( scale ) {
                scale = 10 ** scale;

                return Math.floor( value * scale ) / scale;
            }
            else {
                return Math.floor( value );
            }
        }

        // other
        else {
            return this.new( value ).floor( { scale } );
        }
    }

    static ceil ( value, { scale } = {} ) {

        // bigint
        if ( typeof value === "bigint" ) {
            return value;
        }

        // number
        else if ( typeof value === "number" ) {
            if ( scale ) {
                scale = 10 ** scale;

                return Math.ceil( value * scale ) / scale;
            }
            else {
                return Math.ceil( value );
            }
        }

        // other
        else {
            return this.new( value ).ceil( { scale } );
        }
    }

    static max ( ...args ) {
        var res = null;

        for ( let arg of args ) {
            if ( arg == null ) {
                continue;
            }

            if ( !this.isNumeric( arg ) ) {
                arg = new this( arg );
            }

            if ( arg.isNaN ) {
                continue;
            }
            else if ( res == null ) {
                res = arg;
            }
            else if ( arg.gt( res ) ) {
                res = arg;
            }
        }

        return res;
    }

    static min ( ...args ) {
        var res = null;

        for ( let arg of args ) {
            if ( arg == null ) {
                continue;
            }

            if ( !this.isNumeric( arg ) ) {
                arg = new this( arg );
            }

            if ( arg.isNaN ) {
                continue;
            }
            else if ( res == null ) {
                res = arg;
            }
            else if ( arg.lt( res ) ) {
                res = arg;
            }
        }

        return res;
    }

    static getRandomNumeric ( { minPrecision, maxPrecision, scale } = {} ) {
        minPrecision ||= 0;
        maxPrecision ||= DEFAULT_PRECISION;

        if ( minPrecision > maxPrecision ) {
            [ minPrecision, maxPrecision ] = [ maxPrecision, minPrecision ];
        }

        const min = minPrecision
                ? 10n ** ( BigInt( minPrecision ) - 1n )
                : 0n,
            max = 10n ** BigInt( maxPrecision ) - 1n;

        var value = RandomValues.default.getRandomInt( { min, max } );

        if ( scale ) {
            value = new this( value, {
                "precision": maxPrecision,
            } ).divide( 10 ** scale );
        }

        return new this( value, {
            "precision": maxPrecision,
            scale,
        } );
    }

    static getRandomInt ( { min, max, precision } = {} ) {
        return new this( RandomValues.default.getRandomInt( { min, max } ), {
            precision,
        } );
    }

    static getRandomBinary ( { precision } = {} ) {
        return new this( RandomValues.default.getRandomBinary(), {
            "precision": precision || this.INT8_PRECISION,
        } );
    }

    static getRandomInt8 ( { precision } = {} ) {
        return new this( RandomValues.default.getRandomInt8(), {
            "precision": precision || this.INT8_PRECISION,
        } );
    }

    static getRandomUint8 ( { precision } = {} ) {
        return new this( RandomValues.default.getRandomUint8(), {
            "precision": precision || this.INT8_PRECISION,
        } );
    }

    static getRandomInt16 ( { precision } = {} ) {
        return new this( RandomValues.default.getRandomInt16(), {
            "precision": precision || this.INT16_PRECISION,
        } );
    }

    static getRandomUint16 ( { precision } = {} ) {
        return new this( RandomValues.default.getRandomUint16(), {
            "precision": precision || this.INT16_PRECISION,
        } );
    }

    static getRandomInt32 ( { precision } = {} ) {
        return new this( RandomValues.default.getRandomInt32(), {
            "precision": precision || this.INT32_PRECISION,
        } );
    }

    static getRandomUint32 ( { precision } = {} ) {
        return new this( RandomValues.default.getRandomUint32(), {
            "precision": precision || this.INT32_PRECISION,
        } );
    }

    static getRandomInt53 ( { precision } = {} ) {
        return new this( RandomValues.default.getRandomInt53(), {
            "precision": precision || this.INT53_PRECISION,
        } );
    }

    static getRandomUint53 ( { precision } = {} ) {
        return new this( RandomValues.default.getRandomUint53(), {
            "precision": precision || this.INT53_PRECISION,
        } );
    }

    static getRandomInt64 ( { precision } = {} ) {
        return new this( RandomValues.default.getRandomInt64(), {
            "precision": precision || this.INT64_PRECISION,
        } );
    }

    static getRandomUint64 ( { precision } = {} ) {
        return new this( RandomValues.default.getRandomUint64(), {
            "precision": precision || this.INT64_PRECISION,
        } );
    }

    static getRandomInt128 ( { precision } = {} ) {
        return this.getRandomInt( {
            "min": this.MIN_INT128.bigint,
            "max": this.MAX_INT128.bigint,
            "precision": precision || this.INT128_PRECISION,
        } );
    }

    static getRandomUint128 ( { precision } = {} ) {
        return this.getRandomInt( {
            "min": 0n,
            "max": this.MAX_UINT128.bigint,
            "precision": precision || this.INT128_PRECISION,
        } );
    }

    // properties
    get PRECISION () {
        return this.#PRECISION;
    }

    get SCALE () {
        return this.#SCALE;
    }

    get ROUNDING_MODE () {
        return this.#ROUNDING_MODE;
    }

    get MODULO_MODE () {
        return this.#MODULO_MODE;
    }

    get MIN_INTEGER () {
        return this.MAX_INTEGER.negated;
    }

    get MAX_INTEGER () {
        if ( this.#MAX_INTEGER == null ) {
            let value = this.PRECISION - this.SCALE;

            if ( value ) {
                value = "9".repeat( value );
            }

            this.#MAX_INTEGER = this.#createNumeric( BigInt( value ), 0 );
        }

        return this.#MAX_INTEGER;
    }

    get value () {
        if ( this.#value === undefined ) {
            this.#materialize();
        }

        return this.#value;
    }

    get precision () {
        if ( this.#precision === undefined ) {
            this.#materialize();
        }

        return this.#precision;
    }

    get scale () {
        if ( this.#scale === undefined ) {
            this.#materialize();
        }

        return this.#scale;
    }

    get rawValue () {
        return this.#rawValue;
    }

    get rawPrecision () {
        return this.#rawPrecision;
    }

    get rawScale () {
        return this.#rawScale;
    }

    get isNaN () {
        return Number.isNaN( this.#rawValue );
    }

    get isInfinity () {
        return this.#rawValue === Infinity || this.#rawValue === -Infinity;
    }

    get isPositiveInfinity () {
        return this.#rawValue === Infinity;
    }

    get isNegativeInfinity () {
        return this.#rawValue === -Infinity;
    }

    get isFinite () {
        return typeof this.#rawValue === "bigint";
    }

    get isInteger () {
        return this.isFinite && this.scale === 0;
    }

    get isSafeInteger () {
        return this.isInteger && this.value >= this.constructor.MIN_SAFE_INTEGER.value && this.value <= this.constructor.MAX_SAFE_INTEGER.value;
    }

    get isZero () {
        return this.value === 0n;
    }

    get isPositive () {
        return this.sign > 0;
    }

    get isNegative () {
        return this.sign < 0;
    }

    get number () {
        if ( this.#number === undefined ) {
            if ( this.isFinite ) {
                this.#number = Number( this.toString() );
            }
            else {
                this.#number = this.#rawValue;
            }
        }

        return this.#number;
    }

    get bigint () {
        if ( this.#bigint === undefined ) {
            if ( this.isFinite ) {
                if ( this.isInteger ) {
                    this.#bigint = this.#rawValue;
                }
                else {
                    this.#bigint = this.rounded.bigint;
                }
            }
            else {
                this.#bigint = this.#rawValue;
            }
        }

        return this.#bigint;
    }

    get bin () {
        if ( this.#bin === undefined ) {
            if ( this.isFinite ) {
                this.#bin = "0b" + this.toString( 2 );
            }
            else {
                this.#bin = this.#rawValue;
            }
        }

        return this.#bin;
    }

    get oct () {
        if ( this.#oct === undefined ) {
            if ( this.isFinite ) {
                this.#oct = "0o" + this.toString( 8 );
            }
            else {
                this.#oct = this.#rawValue;
            }
        }

        return this.#oct;
    }

    get hex () {
        if ( this.#hex === undefined ) {
            if ( this.isFinite ) {
                this.#hex ??= "0x" + this.toString( 16 );
            }
            else {
                this.#hex = this.#rawValue;
            }
        }

        return this.#hex;
    }

    get sign () {
        if ( this.#sign === undefined ) {
            if ( typeof this.#rawValue === "bigint" ) {
                if ( this.#rawValue < 0n ) {
                    this.#sign = -1;
                }
                else if ( this.#rawValue > 0n ) {
                    this.#sign = 1;
                }
                else {
                    this.#sign = 0;
                }
            }
            else if ( this.#rawValue === Infinity ) {
                this.#sign = 1;
            }
            else if ( this.#rawValue === -Infinity ) {
                this.#sign = -1;
            }
            else {
                this.#sign = Number.NaN;
            }
        }

        return this.#sign;
    }

    get abs () {
        if ( this.#abs === undefined ) {
            if ( this.sign < 0 ) {
                this.#abs = this.negated;
            }
            else {
                this.#abs = this;
            }
        }

        return this.#abs;
    }

    get negated () {
        if ( this.#negated === undefined ) {
            if ( this.isNaN ) {
                this.#negated = this;
            }
            else {
                this.#negated = this.#createNumeric( -this.#rawValue, this.#rawScale );
            }
        }

        return this.#negated;
    }

    get rounded () {
        return this.round();
    }

    get truncated () {
        return this.truncate();
    }

    get floored () {
        return this.floor();
    }

    get ceiled () {
        return this.ceil();
    }

    get fractional () {
        if ( this.#fractional === undefined ) {
            if ( this.isFinite ) {
                this.#fractional = this.subtract( this.truncated );
            }
            else {
                this.#fractional = this;
            }
        }

        return this.#fractional;
    }

    get compareRank () {
        if ( this.#compareRank === undefined ) {
            if ( typeof this.#rawValue === "bigint" ) {
                this.#compareRank = 1;
            }
            else if ( this.#rawValue === -Infinity ) {
                this.#compareRank = 2;
            }
            else if ( this.#rawValue === Infinity ) {
                this.#compareRank = 3;
            }
            else {
                this.#compareRank = 4;
            }
        }

        return this.#compareRank;
    }

    // public
    toString ( radix = 10 ) {
        if ( this.#string[ radix ] === undefined ) {

            // not a number
            if ( !this.isFinite ) {
                this.#string[ 10 ] = String( this.#rawValue );
            }

            // decimal
            else if ( radix === 10 ) {
                const value = this.value,
                    scale = this.scale,
                    negative = value < 0n,
                    abs = negative
                        ? -value
                        : value,
                    digits = abs.toString().padStart( scale + 1, "0" ),
                    intPart = scale > 0
                        ? digits.slice( 0, digits.length - scale )
                        : digits;

                let fracPart = scale > 0
                    ? digits.slice( digits.length - scale )
                    : "";

                if ( fracPart ) {
                    fracPart = fracPart.replace( /0+$/v, "" );
                }

                this.#string[ 10 ] = ( negative && abs !== 0n
                    ? "-"
                    : "" ) + intPart + ( fracPart
                    ? "." + fracPart
                    : "" );
            }

            // arbitrary radix
            else {
                if ( !Number.isSafeInteger( radix ) || radix < 2 || radix > 36 ) {
                    throw new Error( `Numeric "radix" must be an integer between 2 and 36` );
                }

                const value = this.value,
                    scale = this.scale,
                    negative = value < 0n,
                    abs = negative
                        ? -value
                        : value;

                const divisor = pow10( scale ),
                    intPart = abs / divisor;

                let remainder = abs % divisor;

                let result = intPart.toString( radix );

                if ( remainder !== 0n ) {
                    const bigRadix = BigInt( radix );

                    let fracDigits = "";

                    const maxFractionDigits = scale === 0
                        ? 0
                        : Math.ceil( ( scale * Math.LN10 ) / Math.log( radix ) );

                    // XXX truncation, not rounding -
                    // when the loop stops at the maxFractionDigits limit, the
                    // fractional part is not rounded at the last digit, it is simply cut off
                    for ( let i = 0; i < maxFractionDigits && remainder !== 0n; i++ ) {
                        remainder *= bigRadix;

                        const digit = remainder / divisor;

                        remainder %= divisor;
                        fracDigits += digit.toString( radix );
                    }

                    fracDigits = fracDigits.replace( /0+$/v, "" );

                    if ( fracDigits ) {
                        result += "." + fracDigits;
                    }
                }

                this.#string[ radix ] = ( negative && ( intPart !== 0n || remainder !== 0n || result !== "0" )
                    ? "-"
                    : "" ) + result;
            }
        }

        return this.#string[ radix ];
    }

    toJSON () {
        return this.toString();
    }

    valueOf () {
        return this.number;
    }

    [ Symbol.toPrimitive ] ( hint ) {
        if ( hint === "number" ) {
            return this.number;
        }
        else {
            return this.toString();
        }
    }

    toNumeric ( { precision, scale, roundingMode, moduloMode } = {} ) {
        return new this.constructor( this.#rawValue, {
            "precision": precision === undefined
                ? this.#PRECISION
                : precision,
            "scale": scale === undefined
                ? this.#SCALE
                : scale,
            "roundingMode": roundingMode || this.#ROUNDING_MODE,
            "moduloMode": moduloMode || this.#MODULO_MODE,
            "valueScale": this.#rawScale,
        } );
    }

    [ Symbol.for( "nodejs.util.inspect.custom" ) ] ( depth, options, inspect ) {
        const spec = this.toString();

        return `${ this.constructor.name }: ${ inspect( spec ) }`;
    }

    compare ( numeric ) {
        numeric = this.constructor.new( numeric );

        const rankA = this.compareRank,
            rankB = numeric.compareRank;

        const cmp = rankA === rankB
            ? 0
            : rankA < rankB
                ? -1
                : 1;

        if ( cmp ) {
            return cmp;
        }
        else if ( rankA === 1 ) {
            const valueA = this.value,
                scaleA = this.scale,
                valueB = numeric.value,
                scaleB = numeric.scale;

            const maxScale = Math.max( scaleA, scaleB ),
                alignedA = valueA * pow10( maxScale - scaleA ),
                alignedB = valueB * pow10( maxScale - scaleB );

            return alignedA === alignedB
                ? 0
                : alignedA < alignedB
                    ? -1
                    : 1;
        }
        else {
            return 0;
        }
    }

    eq ( numeric ) {
        return this.compare( numeric ) === 0;
    }

    ne ( numeric ) {
        return this.compare( numeric ) !== 0;
    }

    gt ( numeric ) {
        return this.compare( numeric ) > 0;
    }

    gte ( numeric ) {
        return this.compare( numeric ) >= 0;
    }

    lt ( numeric ) {
        return this.compare( numeric ) < 0;
    }

    lte ( numeric ) {
        return this.compare( numeric ) <= 0;
    }

    round ( { scale, roundingMode } = {} ) {
        if ( roundingMode ) {
            if ( !ROUNDING_MODES.has( roundingMode ) ) {
                throw new Error( "Numeric rounding mode is not valid" );
            }
        }
        else {
            roundingMode = this.#ROUNDING_MODE;
        }

        if ( !this.isFinite ) {
            return this;
        }
        else if ( this.isInteger ) {
            return this;
        }
        else if ( scale ) {
            if ( scale >= this.scale ) {
                return this;
            }
            else {
                return this.#createNumeric( roundBigInt( this.#rawValue, this.#rawScale, scale, roundingMode ), scale );
            }
        }
        else {
            if ( !this.#rounded?.[ roundingMode ] ) {
                this.#rounded ??= {};

                this.#rounded[ roundingMode ] = this.#createNumeric( roundBigInt( this.#rawValue, this.#rawScale, 0, roundingMode ), 0 );
            }

            return this.#rounded[ roundingMode ];
        }
    }

    truncate ( { scale } = {} ) {
        return this.round( { scale, "roundingMode": "ROUND_DOWN" } );
    }

    floor ( { scale } = {} ) {
        return this.round( { scale, "roundingMode": "ROUND_FLOOR" } );
    }

    ceil ( { scale } = {} ) {
        return this.round( { scale, "roundingMode": "ROUND_CEIL" } );
    }

    add ( numeric ) {
        numeric = this.#prepareNumeric( numeric );

        if ( this.isFinite && numeric.isFinite ) {
            const targetScale = Math.max( this.#rawScale, numeric.#rawScale ),
                a = this.#rawValue * pow10( targetScale - this.#rawScale ),
                b = numeric.#rawValue * pow10( targetScale - numeric.#rawScale );

            return this.#createNumeric( ...this.#capScale( a + b, targetScale ) );
        }
        else {
            return this.#createNumeric( ( this.isFinite
                ? 1
                : this.#rawValue ) + ( numeric.isFinite
                ? 1
                : numeric.#rawValue ), 0 );
        }
    }

    subtract ( numeric ) {
        numeric = this.#prepareNumeric( numeric );

        if ( this.isFinite && numeric.isFinite ) {
            const targetScale = Math.max( this.#rawScale, numeric.#rawScale ),
                a = this.#rawValue * pow10( targetScale - this.#rawScale ),
                b = numeric.#rawValue * pow10( targetScale - numeric.#rawScale );

            return this.#createNumeric( ...this.#capScale( a - b, targetScale ) );
        }
        else {
            return this.#createNumeric( ( this.isFinite
                ? 1
                : this.#rawValue ) - ( numeric.isFinite
                ? 1
                : numeric.#rawValue ), 0 );
        }
    }

    multiply ( numeric ) {
        numeric = this.#prepareNumeric( numeric );

        if ( this.isFinite && numeric.isFinite ) {
            const targetScale = this.#rawScale + numeric.#rawScale;

            return this.#createNumeric( ...this.#capScale( this.#rawValue * numeric.#rawValue, targetScale ) );
        }
        else {

            // a finite operand's magnitude is irrelevant once the other side
            // is infinite, but its *sign* (and whether it's zero) still is:
            // -5 * Infinity is -Infinity, not Infinity, and 0 * Infinity is
            // NaN (indeterminate), not Infinity - so use .sign, not a bare 1
            return this.#createNumeric( ( this.isFinite
                ? this.sign
                : this.#rawValue ) * ( numeric.isFinite
                ? numeric.sign
                : numeric.#rawValue ), 0 );
        }
    }

    divide ( numeric ) {
        numeric = this.#prepareNumeric( numeric );

        if ( this.isFinite && numeric.isFinite ) {
            if ( numeric.#rawValue === 0n ) {
                if ( this.isZero ) {
                    return this.#createNumeric( NaN, 0 );
                }

                return this.#createNumeric( this.#rawValue < 0n
                    ? -Infinity
                    : Infinity, 0 );
            }
            else {

                // result scale is predicted from the operands themselves,
                // the same way PostgreSQL's select_div_scale() does it:
                // estimate the quotient's order of magnitude from the
                // operands' weights, then pick enough fractional digits to
                // keep MIN_SIG_DIGITS significant digits in it - never
                // fewer than either operand's own scale, and capped by the
                // Numeric's precision budget. A fixed SCALE always wins,
                // since it's a hard contract, not a prediction.
                const numeratorWeight = weightOf( this.#rawPrecision, this.#rawScale ),
                    denominatorWeight = weightOf( numeric.#rawPrecision, numeric.#rawScale ),

                    // naive weight1 - weight2 overestimates the quotient's
                    // weight by 1 whenever the dividend's leading digit
                    // isn't larger than the divisor's - e.g. 1 / 3: equal
                    // weights (0 - 0 = 0), but the quotient is 0.333...,
                    // weight -1, not weight 0. PostgreSQL's
                    // select_div_scale() corrects for exactly this by
                    // comparing the operands' first significant digits.
                    quotientWeight = leadingDigit( this.#rawValue ) <= leadingDigit( numeric.#rawValue )
                        ? numeratorWeight - denominatorWeight - 1
                        : numeratorWeight - denominatorWeight,
                    rscale = selectScale( quotientWeight, Math.max( this.#rawScale, numeric.#rawScale ), this.#PRECISION );

                const scale = Math.max( rscale, this.#SCALE ) + 1;

                const numerator = this.#rawValue * pow10( numeric.#rawScale + scale ),
                    denominator = numeric.#rawValue * pow10( this.#rawScale );

                let quotient = numerator / denominator;

                const remainder = numerator % denominator;

                // plain BigInt division truncates toward zero, which bakes a
                // one-directional bias into the raw value; round to nearest
                // instead so the raw quotient is unbiased, matching the
                // #ROUNDING_MODE contract used everywhere else in the class
                if ( remainder !== 0n ) {
                    const absRemainder = remainder < 0n
                            ? -remainder
                            : remainder,
                        absDenominator = denominator < 0n
                            ? -denominator
                            : denominator,
                        //  eslint-disable-next-line @stylistic/no-mixed-operators
                        quotientSign = numerator < 0n !== denominator < 0n
                            ? -1n
                            : 1n,
                        doubledRemainder = absRemainder * 2n;

                    let roundUp;

                    switch ( this.#ROUNDING_MODE ) {
                        case "ROUND_UP":
                            roundUp = true;
                            break;
                        case "ROUND_DOWN":
                            roundUp = false;
                            break;
                        case "ROUND_CEIL":
                            roundUp = quotientSign > 0n;
                            break;
                        case "ROUND_FLOOR":
                            roundUp = quotientSign < 0n;
                            break;
                        case "ROUND_HALF_UP":
                            roundUp = doubledRemainder >= absDenominator;
                            break;
                        case "ROUND_HALF_DOWN":
                            roundUp = doubledRemainder > absDenominator;
                            break;
                        case "ROUND_HALF_EVEN":
                            roundUp = doubledRemainder === absDenominator
                                ? quotient % 2n !== 0n
                                : doubledRemainder > absDenominator;
                            break;
                        case "ROUND_HALF_CEIL":
                            roundUp = doubledRemainder === absDenominator
                                ? quotientSign > 0n
                                : doubledRemainder > absDenominator;
                            break;
                        case "ROUND_HALF_FLOOR":
                            roundUp = doubledRemainder === absDenominator
                                ? quotientSign < 0n
                                : doubledRemainder > absDenominator;
                            break;
                        default:
                            roundUp = false;
                    }

                    if ( roundUp ) {
                        quotient += quotientSign;
                    }
                }

                return this.#createNumeric( quotient, scale );
            }
        }
        else {

            // same reasoning as multiply(): a finite operand's sign (and
            // zero-ness) still matters even though its magnitude doesn't -
            // Infinity / -5 is -Infinity, not Infinity
            return this.#createNumeric( ( this.isFinite
                ? this.sign
                : this.#rawValue ) / ( numeric.isFinite
                ? numeric.sign
                : numeric.#rawValue ), 0 );
        }
    }

    mod ( numeric, { moduloMode } = {} ) {
        numeric = this.#prepareNumeric( numeric );

        if ( moduloMode ) {
            if ( !MODULO_MODES.has( moduloMode ) ) {
                throw new Error( `Numeric moduloMode "${ moduloMode }" is not valid` );
            }
        }
        else {
            moduloMode = this.#MODULO_MODE;
        }

        if ( this.isFinite && numeric.isFinite ) {
            if ( numeric.#rawValue === 0n ) {
                return this.#createNumeric( NaN, 0 );
            }
            else {
                const targetScale = Math.max( this.#rawScale, numeric.#rawScale ),
                    a = this.#rawValue * pow10( targetScale - this.#rawScale ),
                    b = numeric.#rawValue * pow10( targetScale - numeric.#rawScale ),
                    remainder = modBigInt( a, b, moduloMode );

                return this.#createNumeric( remainder, targetScale );
            }
        }
        else {
            if ( this.isNaN || numeric.isNaN ) {
                return this.#createNumeric( NaN, 0 );
            }

            // matches native "%": a finite dividend modulo an infinite
            // divisor is just the dividend, unchanged; an infinite dividend
            // modulo anything is indeterminate
            if ( this.isFinite && !numeric.isFinite ) {
                return this.#createNumeric( this.#rawValue, this.#rawScale );
            }

            return this.#createNumeric( NaN, 0 );
        }
    }

    pow ( exponent ) {
        exponent = this.#prepareNumeric( exponent );

        // any base (even NaN or Infinity) raised to the power of 0 is 1,
        // matching the native "**" operator / Math.pow() behavior
        if ( exponent.isFinite && exponent.isZero ) {
            return this.#createNumeric( 1n, 0 );
        }

        if ( this.isNaN || exponent.isNaN ) {
            return this.#createNumeric( NaN, 0 );
        }

        // exact BigInt exponentiation is only possible for a finite integer exponent
        if ( this.isFinite && exponent.isFinite && exponent.isInteger ) {
            const negativeExponent = exponent.isNegative,
                absExponent = negativeExponent
                    ? -exponent.#rawValue
                    : exponent.#rawValue;

            let resultValue = 1n,
                resultScale = 0,
                baseValue = this.#rawValue,
                baseScale = this.#rawScale,
                e = absExponent;

            // exponentiation by squaring
            while ( e > 0n ) {
                if ( e & 1n ) {
                    resultValue *= baseValue;
                    resultScale += baseScale;
                }

                baseValue *= baseValue;
                baseScale *= 2;
                e >>= 1n;
            }

            const positivePower = this.#createNumeric( resultValue, resultScale );

            return negativeExponent
                ? this.#createNumeric( 1n, 0 ).divide( positivePower )
                : positivePower;
        }

        // finite base raised to a finite fractional exponent: base**exponent
        // is computed as exp(exponent * ln(base)), same as libm/PostgreSQL
        // do for non-integer exponents
        if ( this.isFinite && exponent.isFinite ) {

            // a negative base raised to a fractional exponent isn't a real
            // number, matching native "**" / Math.pow() behavior
            if ( this.#rawValue < 0n ) {
                return this.#createNumeric( NaN, 0 );
            }

            if ( this.isZero ) {
                return exponent.isNegative
                    ? this.#createNumeric( Infinity, 0 )
                    : this.#createNumeric( 0n, 0 );
            }

            return this.#log().multiply( exponent ).#exp();
        }

        // infinite base and/or exponent: the result is always one of
        // 0, 1, Infinity or NaN, so native floating point semantics are exact here
        const base = this.isFinite
                ? Number( this.toString() )
                : this.#rawValue,
            power = exponent.isFinite
                ? Number( exponent.toString() )
                : exponent.#rawValue,
            result = base ** power;

        return this.#createNumeric( Number.isFinite( result )
            ? BigInt( result )
            : result, 0 );
    }

    sqrt () {
        if ( !this.#sqrt ) {
            if ( this.isNaN || this.isNegativeInfinity || ( this.isFinite && this.#rawValue < 0n ) ) {
                this.#sqrt = this.#createNumeric( NaN, 0 );
            }
            else if ( this.isPositiveInfinity ) {
                this.#sqrt = this.#createNumeric( Infinity, 0 );
            }
            else if ( this.isZero ) {
                this.#sqrt = this.#createNumeric( 0n, 0 );
            }
            else {

                // sqrt(10^w) ~ 10^(w/2), so the result's weight is roughly half the
                // argument's - same rscale selection as divide(), just with an
                // estimated result weight instead of one derived from two operands
                const argWeight = weightOf( this.#rawPrecision, this.#rawScale ),
                    resultWeight = Math.floor( argWeight / 2 ),
                    rscale = selectScale( resultWeight, this.#rawScale, this.#PRECISION );

                // fixed cushion for Newton's method's own rounding error
                const scale = Math.max( rscale, this.#SCALE ) + 1;

                const exponent = 2 * scale - this.#rawScale,
                    radicand = exponent >= 0
                        ? this.#rawValue * pow10( exponent )
                        : this.#rawValue / pow10( -exponent );

                const quotient = isqrtBigInt( radicand );

                this.#sqrt = this.#createNumeric( quotient, scale );
            }
        }

        return this.#sqrt;
    }

    cbrt () {
        if ( !this.#cbrt ) {
            if ( this.isNaN ) {
                this.#cbrt = this.#createNumeric( NaN, 0 );
            }
            else if ( this.isPositiveInfinity ) {
                this.#cbrt = this.#createNumeric( Infinity, 0 );
            }
            else if ( this.isNegativeInfinity ) {
                this.#cbrt = this.#createNumeric( -Infinity, 0 );
            }
            else if ( this.isZero ) {
                this.#cbrt = this.#createNumeric( 0n, 0 );
            }
            else {
                const negative = this.#rawValue < 0n,
                    absValue = negative
                        ? -this.#rawValue
                        : this.#rawValue;

                // cbrt(10^w) ~ 10^(w/3) - same idea as sqrt(), a third instead of a half
                const argWeight = weightOf( this.#rawPrecision, this.#rawScale ),
                    resultWeight = Math.floor( argWeight / 3 ),
                    rscale = selectScale( resultWeight, this.#rawScale, this.#PRECISION );

                // fixed cushion for Newton's method's own rounding error
                const scale = Math.max( rscale, this.#SCALE ) + 1;

                const exponent = 3 * scale - this.#rawScale,
                    radicand = exponent >= 0
                        ? absValue * pow10( exponent )
                        : absValue / pow10( -exponent );

                let quotient = icbrtBigInt( radicand );

                if ( negative && quotient !== 0n ) {
                    quotient = -quotient;
                }

                this.#cbrt = this.#createNumeric( quotient, scale );
            }
        }

        return this.#cbrt;
    }

    log ( base ) {
        return base
            ? this.#log().divide( this.#prepareNumeric( base ).log() )
            : this.#log();
    }

    log2 () {
        if ( !this.#log2 ) {
            this.#log2 = this.log( 2 );
        }

        return this.#log2;
    }

    log10 () {
        if ( !this.#log10 ) {
            this.#log10 = this.log( 10 );
        }

        return this.#log10;
    }

    // private
    #parseString ( value, radix ) {

        // remove "_" separator
        if ( /_/v.test( value ) ) {
            value = value.replaceAll( "_", "" );
        }

        // BigInt string
        if ( BIGINT_LITERAL_RE.test( value ) ) {
            this.#rawScale = 0;

            return BigInt( value );
        }
        else {
            const jsonValue = JSON_STRINGS[ value ];

            if ( jsonValue !== undefined ) {
                this.#rawScale = 0;

                return jsonValue;
            }
            else {
                const [ parsedValue, parsedScale ] = parseString( value, radix );

                this.#rawScale = parsedScale;

                return parsedValue;
            }
        }
    }

    #prepareNumeric ( numeric ) {
        if ( numeric instanceof this.constructor ) {
            return numeric;
        }
        else {
            return new this.constructor( numeric );
        }
    }

    #createNumeric ( value, valueScale ) {
        return new this.constructor( value, {
            "precision": this.#PRECISION,
            "scale": this.#SCALE,
            "roundingMode": this.#ROUNDING_MODE,
            "moduloMode": this.#MODULO_MODE,
            valueScale,
        } );
    }

    #materialize () {
        if ( !this.isFinite ) {
            this.#value = this.#rawValue;
            this.#precision = 0;
            this.#scale = 0;
        }
        else {

            // the decimal part can never eat into digits already spent on the
            // integer part - whatever SCALE requests, it's capped by what's left
            // of PRECISION after the integer-part digits
            const integerDigits = this.#rawPrecision > this.#rawScale
                    ? this.#rawPrecision - this.#rawScale
                    : 1,
                maxScale = Math.max( this.#PRECISION - integerDigits, 0 );

            const targetScale = Math.min( this.#SCALE, maxScale );

            if ( this.#rawScale <= targetScale ) {
                this.#value = this.#rawValue;
                this.#precision = this.#rawPrecision;
                this.#scale = this.#rawScale;
            }
            else {
                const roundedValue = roundBigInt( this.#rawValue, this.#rawScale, targetScale, this.#ROUNDING_MODE );

                // rounding can carry over (e.g. 999.999 -> 1000), pushing the integer
                // part past what PRECISION allows even though the original value fit.
                //
                // Getting the digit count used to go through
                // `.toString().length`, which forces a full binary-to-decimal
                // conversion of the (possibly large) rounded BigInt - the
                // dominant cost of this method for high-scale numerics. We
                // already know the digit count of the raw value
                // (#rawPrecision), and dropping `k` trailing decimal digits
                // shrinks that count by exactly `k` (floored at 1); a carry
                // can only ever push it back up by one more digit, which a
                // single cached-power-of-10 comparison detects. That replaces
                // an O(digits^2) stringify with an O(digits) compare.
                const k = this.#rawScale - targetScale,
                    truncatedDigits = this.#rawPrecision > k
                        ? this.#rawPrecision - k
                        : 1,
                    absRoundedValue = roundedValue < 0n
                        ? -roundedValue
                        : roundedValue,
                    roundedDigits = absRoundedValue >= pow10( truncatedDigits )
                        ? truncatedDigits + 1
                        : truncatedDigits,
                    roundedIntegerDigits = roundedDigits > targetScale
                        ? roundedDigits - targetScale
                        : 1;

                // check integer part precision
                if ( roundedIntegerDigits > this.#PRECISION ) {
                    throw new Error( `Numeric integer part exceeds precision (${ this.#PRECISION })` );
                }

                this.#value = roundedValue;
                this.#precision = roundedDigits;
                this.#scale = targetScale;
            }
        }
    }

    #capScale ( value, scale ) {
        if ( scale <= this.#PRECISION ) {
            return [ value, scale ];
        }

        return [ roundBigInt( value, scale, this.#PRECISION, this.#ROUNDING_MODE ), this.#PRECISION ];
    }

    #log () {
        if ( !this.#loge ) {
            if ( this.isNaN || this.isNegativeInfinity || ( this.isFinite && this.#rawValue < 0n ) ) {
                this.#loge = this.#createNumeric( NaN, 0 );
            }
            else if ( this.isZero ) {
                this.#loge = this.#createNumeric( -Infinity, 0 );
            }
            else if ( this.isPositiveInfinity ) {
                this.#loge = this.#createNumeric( Infinity, 0 );
            }
            else {

                // unlike sqrt/cbrt, ln(x)'s magnitude doesn't follow from x's weight
                // (ln(x) is near 0 for any x near 1, however large or small x's own
                // weight is), so there's no result weight to estimate from - just
                // guarantee MIN_SIG_DIGITS as if the result were O(1), same as
                // PostgreSQL's ln_var() does.
                const rscale = selectScale( 0, this.#rawScale, this.#PRECISION );

                // fixed cushion for the reduction steps' and series' own rounding error
                const scale = Math.max( rscale, this.#SCALE ) + 1,
                    quotient = lnBigIntFixedPoint( this.#rawValue, this.#rawScale, scale );

                this.#loge = this.#createNumeric( quotient, scale );
            }
        }

        return this.#loge;
    }

    #exp () {
        if ( this.isNaN ) {
            return this.#createNumeric( NaN, 0 );
        }

        if ( this.isPositiveInfinity ) {
            return this.#createNumeric( Infinity, 0 );
        }

        if ( this.isNegativeInfinity ) {
            return this.#createNumeric( 0n, 0 );
        }

        if ( this.isZero ) {
            return this.#createNumeric( 1n, 0 );
        }

        // like ln(x), exp(x)'s magnitude doesn't follow from x's own weight
        // (exp(x) can be astronomically large or vanishingly small for a
        // modestly-sized x), so just guarantee MIN_SIG_DIGITS as if the
        // result were O(1), same as PostgreSQL's exp_var() does
        const rscale = selectScale( 0, this.#rawScale, this.#PRECISION );

        // fixed cushion for the reduction steps' and series' own rounding error
        const scale = Math.max( rscale, this.#SCALE ) + 1,
            quotient = expBigIntFixedPoint( this.#rawValue, this.#rawScale, scale );

        return this.#createNumeric( quotient, scale );
    }
}

function parseString ( value, radix ) {
    let scale1, radixInfo, sign, integerDigits, fractionalDigits;

    if ( /^[+\-]?0[box]/iv.test( value ) ) {
        const match = value.match( /^(?<sign>[+\-]?)0(?<radixChar>[box])(?<integer>[0-9a-f]+)(?:\.(?<fractional>[0-9a-f]+))?$/iv );

        if ( !match ) {
            throw new Error( "Numeric value is not valid" );
        }

        radixInfo = RADIX_INFO[ match.groups.radixChar.toLowerCase() ];
        sign = match.groups.sign;
        integerDigits = match.groups.integer;
        fractionalDigits = match.groups.fractional ?? "";
    }
    else if ( radix ) {
        if ( !( radix in RADIX_CHARS ) ) {
            throw new Error( "Numeric radix is not valid" );
        }

        const match = value.match( /^(?<sign>[+\-]?)(?<integer>[0-9a-f]+)(?:\.(?<fractional>[0-9a-f]+))?$/iv );

        if ( !match ) {
            throw new Error( "Numeric value is not valid" );
        }

        radixInfo = RADIX_INFO[ RADIX_CHARS[ radix ] ];
        sign = match.groups.sign;
        integerDigits = match.groups.integer;
        fractionalDigits = match.groups.fractional ?? "";
    }

    if ( radixInfo ) {
        if ( !radixInfo.re.test( integerDigits ) || ( fractionalDigits && !radixInfo.re.test( fractionalDigits ) ) ) {
            throw new Error( "Numeric value is not valid" );
        }

        const integerValue = BigInt( "0" + radixInfo.radixChar + integerDigits ),
            scale = fractionalDigits.length * radixInfo.bits;

        let unsignedValue = integerValue * pow10( scale );

        if ( fractionalDigits ) {
            const fractionalValue = BigInt( "0" + radixInfo.radixChar + fractionalDigits );

            unsignedValue += fractionalValue * 5n ** BigInt( scale );
        }

        value = sign === "-" && unsignedValue !== 0n
            ? -unsignedValue
            : unsignedValue;

        scale1 = scale;
    }
    else {
        const match = value.match( /^(?<sign>[+\-]?)(?<integer>\d+)(?:\.(?<fractional>\d+))?(?:e(?<exp>[+\-]?\d+))?$/iv );

        if ( !match ) {
            throw new Error( "Numeric value is not valid" );
        }
        else {
            const sign = match.groups.sign,
                integer = match.groups.integer.replace( /^0+/v, "" ),
                fractional = match.groups.fractional
                    ? match.groups.fractional.replace( /0+$/v, "" )
                    : "",
                exp = match.groups.exp
                    ? Number( match.groups.exp )
                    : 0;

            let digits = integer + fractional;

            scale1 = fractional.length - exp;

            if ( scale1 < 0 ) {
                digits += "0".repeat( -scale1 );

                scale1 = 0;
            }

            value = BigInt( sign + digits );
        }
    }

    return [ value, scale1 ];
}

function modBigInt ( a, b, mode ) {

    // BigInt "%" truncates toward zero, so this remainder always matches
    // the sign of the dividend (or is zero)
    const remainder = a % b;

    if ( remainder === 0n ) {
        return remainder;
    }

    switch ( mode ) {

        // remainder has the same sign as the dividend (truncating
        // division, matches JavaScript's "%")
        case "ROUND_DOWN":
            return remainder;

        // remainder has the opposite sign of the dividend (zero otherwise)
        case "ROUND_UP": {
            const signA = a < 0n
                    ? -1n
                    : 1n,
                signB = b < 0n
                    ? -1n
                    : 1n;

            return remainder - ( signA === signB
                ? b
                : -b );
        }

        // remainder has the same sign as the divisor (matches Python's "%")
        case "ROUND_FLOOR": {
            const remainderNegative = remainder < 0n,
                divisorNegative = b < 0n;

            return remainderNegative === divisorNegative
                ? remainder
                : remainder + b;
        }

        // remainder is always positive: q = sign( b ) * floor( a / abs( b ) )
        case "EUCLID": {
            const absB = b < 0n
                ? -b
                : b;

            return remainder < 0n
                ? remainder + absB
                : remainder;
        }

        // IEEE 754 remainder function: the quotient is rounded to the
        // nearest integer, ties rounding to the even quotient
        case "ROUND_HALF_EVEN": {
            const quotient = a / b, // BigInt division truncates toward zero
                absRemainder = remainder < 0n
                    ? -remainder
                    : remainder,
                absB = b < 0n
                    ? -b
                    : b,
                doubledRemainder = absRemainder * 2n,
                signA = a < 0n
                    ? -1n
                    : 1n,
                signB = b < 0n
                    ? -1n
                    : 1n,
                roundUp = doubledRemainder === absB
                    ? quotient % 2n !== 0n
                    : doubledRemainder > absB;

            return roundUp
                ? remainder - ( signA === signB
                    ? b
                    : -b )
                : remainder;
        }

        default:
            return remainder;
    }
}

function roundBigInt ( value, fromScale, toScale, mode ) {
    if ( toScale === fromScale ) {
        return value;
    }

    if ( toScale > fromScale ) {
        return value * pow10( toScale - fromScale );
    }

    const divisor = pow10( fromScale - toScale ),
        truncated = value / divisor, // BigInt division truncates toward zero
        remainder = value % divisor;

    if ( remainder === 0n ) {
        return truncated;
    }

    const sign = value < 0n
            ? -1n
            : 1n,
        absRemainder = remainder < 0n
            ? -remainder
            : remainder,
        doubledRemainder = absRemainder * 2n;

    let roundUp;

    switch ( mode ) {
        case "ROUND_UP":
            roundUp = true;
            break;
        case "ROUND_DOWN":
            roundUp = false;
            break;
        case "ROUND_CEIL":
            roundUp = sign > 0n;
            break;
        case "ROUND_FLOOR":
            roundUp = sign < 0n;
            break;
        case "ROUND_HALF_UP":
            roundUp = doubledRemainder >= divisor;
            break;
        case "ROUND_HALF_DOWN":
            roundUp = doubledRemainder > divisor;
            break;
        case "ROUND_HALF_EVEN":
            roundUp = doubledRemainder === divisor
                ? truncated % 2n !== 0n
                : doubledRemainder > divisor;
            break;
        case "ROUND_HALF_CEIL":
            roundUp = doubledRemainder === divisor
                ? sign > 0n
                : doubledRemainder > divisor;
            break;
        case "ROUND_HALF_FLOOR":
            roundUp = doubledRemainder === divisor
                ? sign < 0n
                : doubledRemainder > divisor;
            break;
        default:
            roundUp = false;
    }

    return roundUp
        ? truncated + sign
        : truncated;
}

function pow10 ( exponent ) {
    for ( let i = POW10_CACHE.length; i <= exponent; i++ ) {
        POW10_CACHE[ i ] = POW10_CACHE[ i - 1 ] * 10n;
    }

    return POW10_CACHE[ exponent ];
}

function isqrtBigInt ( value ) {
    if ( value < 2n ) {
        return value;
    }

    const bitLength = value.toString( 2 ).length,
        initialShift = BigInt( Math.ceil( bitLength / 2 ) );

    let x = 1n << initialShift,
        y = ( x + value / x ) >> 1n;

    while ( y < x ) {
        x = y;
        y = ( x + value / x ) >> 1n;
    }

    return x;
}

function icbrtBigInt ( value ) {
    if ( value < 2n ) {
        return value;
    }

    const bitLength = value.toString( 2 ).length,
        initialShift = BigInt( Math.ceil( bitLength / 3 ) );

    let x = 1n << initialShift,
        y = ( 2n * x + value / ( x * x ) ) / 3n;

    while ( y < x ) {
        x = y;
        y = ( 2n * x + value / ( x * x ) ) / 3n;
    }

    // Newton's method for cube roots can under- or overshoot by 1 near the
    // boundary, so nudge the result to the exact floor value
    while ( ( x + 1n ) ** 3n <= value ) {
        x += 1n;
    }

    while ( x ** 3n > value ) {
        x -= 1n;
    }

    return x;
}

function lnBigIntFixedPoint ( value, scale, workScale ) {
    const diff = workScale - scale,
        one = pow10( workScale );

    let m = diff >= 0
        ? value * pow10( diff )
        : value / pow10( -diff );

    for ( let i = 0; i < LN_REDUCTION_STEPS; i++ ) {
        m = isqrtBigInt( m * one );
    }

    const z = ( ( m - one ) * one ) / ( m + one ),
        z2 = ( z * z ) / one;

    let term = z,
        sum = z,
        k = 1n;

    for ( let i = 0; i < 6; i++ ) {
        term = ( term * z2 ) / one;
        k += 2n;
        sum += term / k;
    }

    return 2n * sum * ( 1n << BigInt( LN_REDUCTION_STEPS ) );
}

function expBigIntFixedPoint ( value, scale, workScale ) {
    const diff = workScale - scale,
        one = pow10( workScale );

    const x = diff >= 0
        ? value * pow10( diff )
        : value / pow10( -diff );

    const absX = x < 0n
        ? -x
        : x;

    // exp(x) = exp(x / 2^shift) ^ (2^shift), so first push |x| below
    // 2^-EXP_REDUCTION_BITS (shift is derived from x's own bit length, not
    // fixed, since x can be either astronomically large or tiny) - that
    // keeps the Taylor series below to just a handful of terms regardless
    // of x's original magnitude, then the loop after the series squares
    // the result back up to undo the reduction
    let shift = 0n;

    if ( absX > 0n ) {
        const xBits = BigInt( absX.toString( 2 ).length ),
            oneBits = BigInt( one.toString( 2 ).length );

        shift = xBits - oneBits + BigInt( EXP_REDUCTION_BITS );

        if ( shift < 0n ) {
            shift = 0n;
        }
    }

    const reduced = shift > 0n
        ? x >> shift
        : x;

    let term = one,
        sum = one;

    for ( let n = 1n; term !== 0n; n++ ) {
        term = ( term * reduced ) / ( one * n );
        sum += term;
    }

    for ( let i = 0n; i < shift; i++ ) {
        sum = ( sum * sum ) / one;
    }

    return sum;
}

function weightOf ( precision, scale ) {
    return precision - scale - 1;
}

function leadingDigit ( value ) {
    const digits = ( value < 0n
        ? -value
        : value ).toString();

    return digits.codePointAt( 0 ) - 48;
}

function selectScale ( resultWeight, floorScale, precisionCap ) {
    let rscale = MIN_SIG_DIGITS - resultWeight;

    rscale = Math.max( rscale, floorScale, 0 );
    rscale = Math.min( rscale, precisionCap );

    return rscale;
}

NumericBuilder.prototype = Numeric.prototype;

Object.setPrototypeOf( NumericBuilder, Numeric );
