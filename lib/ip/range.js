import IpAddress from "#lib/ip/address";
import Numeric from "#lib/numeric";

const PARSING_ERROR_MESSAGE = "IP range is invalid";

const V4_MASK0 = new Array( 32 );
const V4_MASK1 = new Array( 32 );
const V6_MASK0 = new Array( 128 );
const V6_MASK1 = new Array( 128 );

export default class IpRange {
    #firstAddress;
    #lastAddress;
    #prefix;
    #string;
    #rangeString;
    #cidrString;

    constructor ( range, prefix ) {

        // ip range, make a copy
        if ( range instanceof IpRange ) {
            this.#firstAddress = range.firstAddress;
            this.#lastAddress = range.lastAddress;
        }

        // array of ip addresses
        else if ( Array.isArray( range ) ) {
            this.#firstAddress = range[ 0 ];
            this.#lastAddress = range[ 1 ];
        }

        // range string
        else if ( typeof range === "string" && range.includes( "-" ) ) {
            const idx = range.indexOf( "-" );

            this.#firstAddress = new IpAddress( range.slice( 0, idx ) );
            this.#lastAddress = new IpAddress( range.slice( idx + 1 ) );

            if ( this.#firstAddress.isIpV4 && !this.#lastAddress.isIpV4 ) throw new Error( PARSING_ERROR_MESSAGE );

            // swap first <-> last
            if ( this.#firstAddress.value > this.#lastAddress.value ) [ this.#firstAddress, this.#lastAddress ] = [ this.#lastAddress, this.#firstAddress ];
        }

        // cidr or value or ip address
        else {

            // string
            if ( typeof range === "string" ) {
                const idx = range.indexOf( "/" );

                // cidr string
                if ( idx > 0 ) {
                    prefix ??= +range.slice( idx + 1 );
                    range = new IpAddress( range.slice( 0, idx ) );
                }

                // single ip address
                else {
                    range = new IpAddress( range );
                }
            }

            // value
            else if ( typeof range === "number" || typeof range === "bigint" ) {
                range = new IpAddress( range );
            }

            // ip address
            if ( range instanceof IpAddress ) {

                // v4
                if ( range.isIpV4 ) {

                    // check prefix
                    if ( prefix == null ) {
                        prefix = 32;
                    }
                    else if ( Number.isNaN( prefix ) || prefix < 0 || prefix > 32 ) {
                        throw new Error( PARSING_ERROR_MESSAGE );
                    }

                    if ( prefix === 32 ) {
                        this.#firstAddress = range;
                        this.#lastAddress = range;
                    }
                    else {
                        V4_MASK0[ prefix ] ??= Number( "0b" + "1".repeat( prefix ) + "0".repeat( 32 - prefix ) );
                        this.#firstAddress = new IpAddress( ( range.value & V4_MASK0[ prefix ] ) >>> 0 );

                        V4_MASK1[ prefix ] ??= Number( "0b" + "0".repeat( prefix ) + "1".repeat( 32 - prefix ) );
                        this.#lastAddress = new IpAddress( ( range.value | V4_MASK1[ prefix ] ) >>> 0 );
                    }
                }

                // v6
                else {

                    // check prefix
                    if ( prefix == null ) {
                        prefix = 128;
                    }
                    else if ( Number.isNaN( prefix ) || prefix < 0 || prefix > 128 ) {
                        throw new Error( PARSING_ERROR_MESSAGE );
                    }

                    if ( prefix === 128 ) {
                        this.#firstAddress = range;
                        this.#lastAddress = range;
                    }
                    else {
                        V6_MASK0[ prefix ] ??= BigInt( "0b" + "1".repeat( prefix ) + "0".repeat( 128 - prefix ) );
                        this.#firstAddress = new IpAddress( range.value & V6_MASK0[ prefix ] );

                        V6_MASK1[ prefix ] ??= BigInt( "0b" + "0".repeat( prefix ) + "1".repeat( 128 - prefix ) );
                        this.#lastAddress = new IpAddress( range.value | V6_MASK1[ prefix ] );
                    }
                }

                this.#prefix = prefix;
            }

            // invalid type
            else {
                throw new Error( PARSING_ERROR_MESSAGE );
            }
        }
    }

    // static
    static new ( range, prefix ) {
        if ( range instanceof IpRange ) return range;

        return new this( range, prefix );
    }

    static isValid ( range, prefix ) {
        try {
            new this( range, prefix );

            return true;
        }
        catch {
            return false;
        }
    }

    static get compare () {
        return ( a, b ) => this.new( a ).compare( b );
    }

    // properties
    get isIpV4 () {
        return this.#firstAddress.isIpV4;
    }

    get isIpV6 () {
        return this.#firstAddress.isIpV6;
    }

    get firstAddress () {
        return this.#firstAddress;
    }

    get lastAddress () {
        return this.#lastAddress;
    }

    get size () {
        if ( this.isIpV4 ) {
            return this.#lastAddress.value - this.#firstAddress.value + 1;
        }
        else {
            return this.#lastAddress.value - this.#firstAddress.value + 1n;
        }
    }

    get isCidrAble () {
        return this.prefix === null;
    }

    get prefix () {
        if ( this.#prefix === undefined ) {
            const isIpV4 = this.#firstAddress.isIpV4;

            if ( this.#firstAddress.value === this.#lastAddress.value ) {
                this.#prefix = isIpV4
                    ? 32
                    : 128;
            }
            else {
                let first = this.#firstAddress.value.toString( 2 ),
                    last = this.#lastAddress.value.toString( 2 );

                if ( isIpV4 ) {
                    first = first.padStart( 32, "0" );
                    last = last.padStart( 32, "0" );
                }
                else {
                    first = first.padStart( 128, "0" );
                    last = last.padStart( 128, "0" );
                }

                let prefix;

                for ( prefix = 0; prefix < first.length; prefix++ ) {
                    if ( first[ prefix ] !== last[ prefix ] ) break;
                }

                for ( let n = prefix; n < first.length; n++ ) {
                    if ( first[ n ] !== "0" || last[ n ] !== "1" ) {
                        prefix = null;

                        break;
                    }
                }

                this.#prefix = prefix;
            }
        }

        return this.#prefix;
    }

    // public
    toString () {
        if ( this.#string === undefined ) {
            if ( this.prefix !== null ) this.#string = this.toCidrString();
            else this.#string = this.toRangeString();
        }

        return this.#string;
    }

    toJSON () {
        return this.toString();
    }

    toRangeString () {
        this.#rangeString ??= this.#firstAddress + "-" + this.#lastAddress;

        return this.#rangeString;
    }

    toCidrString () {
        if ( this.#cidrString === undefined ) {
            if ( this.prefix == null ) this.#cidrString = null;
            else this.#cidrString = this.#firstAddress + "/" + this.prefix;
        }

        return this.#cidrString;
    }

    getRandomAddress () {
        var min = this.#firstAddress.value,
            max = this.#lastAddress.value;

        if ( this.isIpV4 ) {
            return new IpAddress( Numeric.randomInt32( {
                min,
                max,
            } ).number );
        }
        else {
            return new IpAddress( Numeric.randomInt128( {
                min,
                max,
            } ).bigint );
        }
    }

    includes ( range ) {
        range = IpRange.new( range );

        if ( this.isIpV4 && !range.isIpV4 ) return false;

        const min = range.firstAddress.value,
            max = range.lastAddress.value;

        if ( this.#firstAddress.value > min ) return false;

        if ( this.#lastAddress.value < max ) return false;

        return true;
    }

    inside ( range ) {
        range = IpRange.new( range );

        if ( this.isIpV4 && !range.isIpV4 ) return false;

        if ( this.#firstAddress.value < range.firstAddress.value ) return false;

        if ( this.#lastAddress.value > range.lastAddress.value ) return false;

        return true;
    }

    isConsecutive ( range ) {
        range = IpRange.new( range );

        if ( this.isIpV4 && !range.isIpV4 ) return false;

        const nextAddress = this.lastAddress.nextAddress;
        if ( nextAddress && nextAddress.value === range.firstAddress.value ) return true;

        const previousAddress = this.firstAddress.previousAddress;
        if ( previousAddress && previousAddress.value === range.lastAddress.value ) return true;

        return false;
    }

    isOverlapped ( range ) {
        range = IpRange.new( range );

        if ( this.isIpV4 && !range.isIpV4 ) return false;

        if ( this.firstAddress.value >= range.firstAddress.value && this.firstAddress.value <= range.lastAddress.value ) return true;

        if ( range.firstAddress.value >= this.firstAddress.value && range.firstAddress.value <= this.lastAddress.value ) return true;

        return false;
    }

    concat ( range ) {
        range = IpRange.new( range );

        if ( this.isOverlapped( range ) || this.isConsecutive( range ) ) {
            return new this.constructor( [

                //
                this.firstAddress.value < range.firstAddress.value
                    ? this.firstAddress
                    : range.firstAddress,
                this.lastAddress.value > range.lastAddress.value
                    ? this.lastAddress
                    : range.lastAddress,
            ] );
        }
        else {
            throw new Error( "Cannot concatenate IP ranges" );
        }
    }

    compare ( range ) {
        range = IpRange.new( range );

        return this.firstAddress.compare( range.firstAddress ) || this.lastAddress.compare( range.lastAddress );
    }
}
