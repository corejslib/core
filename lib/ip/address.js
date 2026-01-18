import geoipCountry from "#lib/geoip-country";
import IpRange from "#lib/ip/range";

try {
    var { "default": geoipCity } = await import( "@c0rejs/geoip-city" );
}
catch {}

try {
    var { "default": geoipAsn } = await import( "@c0rejs/geoip-asn" );
}
catch {}

const PARSING_ERROR_MESSAGE = "IP address is invalid";
const MAX_IPV4_VALUE = 4_294_967_295;
const MAX_IPV6_VALUE = 340_282_366_920_938_463_463_374_607_431_768_211_455n;

export default class IpAddress {
    #isIpV4;
    #value;
    #string;
    #fullString;
    #previousAddress;
    #nextAddress;
    #geoipCountry;
    #geoipCity;
    #geoipAsn;
    #geoip;

    constructor ( address ) {
        if ( address instanceof this.constructor ) {
            this.#isIpV4 = address.isIpV4;
            this.#value = address.value;
        }

        // ipv4 number
        else if ( typeof address === "number" ) {

            // check range
            if ( address < 0 || address > MAX_IPV4_VALUE ) throw new Error( PARSING_ERROR_MESSAGE );

            this.#isIpV4 = true;
            this.#value = address;
        }

        // ipv6 number
        else if ( typeof address === "bigint" ) {

            // check range
            if ( address < 0n || address > MAX_IPV6_VALUE ) throw new Error( PARSING_ERROR_MESSAGE );

            this.#isIpV4 = false;
            this.#value = address;
        }

        // string
        else if ( typeof address === "string" ) {

            // ipv6 string
            if ( address.includes( ":" ) ) {
                this.#parseV6( address );
            }

            // ipv4 string
            else if ( address.includes( "." ) ) {
                this.#parseV4( address );
            }
            else {
                throw new Error( "IP address is invalid" );
            }
        }
        else {
            throw new Error( "IP address is invalid" );
        }
    }

    // static
    static new ( ipAddress ) {
        if ( ipAddress instanceof this ) return ipAddress;

        return new this( ipAddress );
    }

    static get comparator () {
        return ( a, b ) => this.new( a ).compare( b );
    }

    // properties
    get family () {
        return this.#isIpV4
            ? 4
            : 6;
    }

    get value () {
        return this.#value;
    }

    get isIpV4 () {
        return this.#isIpV4;
    }

    get isIpV6 () {
        return !this.#isIpV4;
    }

    get hasPreviousAddress () {
        if ( this.#isIpV4 ) {
            return this.#value > 0;
        }
        else {
            return this.#value > 0n;
        }
    }

    get hasNextAddress () {
        if ( this.#isIpV4 ) {
            return this.#value < MAX_IPV4_VALUE;
        }
        else {
            return this.#value < MAX_IPV6_VALUE;
        }
    }

    get previousAddress () {
        if ( !this.hasPreviousAddress ) return null;

        if ( !this.#previousAddress ) {
            if ( this.#isIpV4 ) this.#previousAddress = new this.constructor( this.#value - 1 );
            else this.#previousAddress = new this.constructor( this.#value - 1n );
        }

        return this.#previousAddress;
    }

    get nextAddress () {
        if ( !this.hasNextAddress ) return null;

        if ( !this.#nextAddress ) {
            if ( this.#isIpV4 ) this.#nextAddress = new this.constructor( this.#value + 1 );
            else this.#nextAddress = new this.constructor( this.#value + 1n );
        }

        return this.#nextAddress;
    }

    get geoipCountry () {
        if ( this.#geoipCountry === undefined ) {
            this.#geoipCountry = geoipCountry.get( this.toString() );
        }

        return this.#geoipCountry;
    }

    get geoipCity () {
        if ( this.#geoipCity === undefined ) {
            this.#geoipCity = geoipCity?.get( this.toString() ) || null;
        }

        return this.#geoipCity;
    }

    get geoipAsn () {
        if ( this.#geoipAsn === undefined ) {
            this.#geoipAsn = geoipAsn?.get( this.toString() ) || null;
        }

        return this.#geoipAsn;
    }

    get geoip () {
        if ( this.#geoip === undefined ) {
            const geoip = this.geoipCity || this.geoipCountry;

            if ( geoip ) {
                this.#geoip = {
                    "name": ( geoip.city?.names.en
                        ? geoip.city.names.en + ", "
                        : "" ) + geoip.country.names.en,
                    "country": {
                        "iso2": geoip.country.iso_code,
                        "name": geoip.country.names.en,
                    },
                };
            }
            else {
                this.#geoip = null;
            }
        }

        return this.#geoip;
    }

    // public
    toString () {
        if ( !this.#string ) {
            if ( this.#isIpV4 ) {
                const buf = Buffer.allocUnsafe( 4 );

                buf.writeUInt32BE( this.#value );

                this.#string = buf.join( "." );
                this.#fullString = this.#string;
            }
            else {
                if ( this.#value === 0n ) {
                    this.#string = "::";
                    this.#fullString = "0000:0000:0000:0000:0000:0000:0000:0000";
                }
                else {
                    const str = this.#value.toString( 16 ).padStart( 32, "0" ),
                        hextets = new Array( 8 ),
                        fullHextets = new Array( 8 );

                    let zero, longestZero;

                    for ( let n = 0; n < 8; n++ ) {
                        fullHextets[ n ] = str.slice( n * 4, n * 4 + 4 );

                        const hextet = Number( "0x" + fullHextets[ n ] ).toString( 16 );

                        hextets[ n ] = hextet;

                        // zero segment start
                        if ( hextet === "0" && !zero ) zero = [ n, null, null ];

                        // zero segment end
                        if ( zero && ( hextet !== "0" || n === 7 ) ) {
                            zero[ 1 ] = hextet !== "0"
                                ? n - 1
                                : n;

                            zero[ 2 ] = zero[ 1 ] - zero[ 0 ] + 1;

                            if ( !longestZero || zero[ 2 ] > longestZero[ 2 ] ) longestZero = zero;

                            zero = null;
                        }
                    }

                    if ( longestZero ) {
                        hextets.splice( longestZero[ 0 ], longestZero[ 2 ], longestZero[ 0 ] === 0 || longestZero[ 1 ] === 7
                            ? ":"
                            : "" );
                    }

                    this.#string = hextets.join( ":" );
                    this.#fullString = fullHextets.join( ":" );
                }
            }
        }

        return this.#string;
    }

    toFullString () {
        if ( !this.#fullString ) this.toString();

        return this.#fullString;
    }

    toJSON () {
        return this.toString();
    }

    [ Symbol.for( "nodejs.util.inspect.custom" ) ] ( depth, options, inspect ) {
        return "IpAddress: " + this.toString();
    }

    inside ( range ) {
        if ( typeof range === "string" ) range = new IpRange( range );

        return range.includes( this );
    }

    compare ( ipAddress ) {
        ipAddress = this.constructor.new( ipAddress );

        return this.family - ipAddress.family || this.#value < ipAddress.value
            ? -1
            : this.#value === ipAddress.value
                ? 0
                : 1;
    }

    eq ( ipAddress ) {
        return this.compare( ipAddress ) === 0;
    }

    ne ( ipAddress ) {
        return this.compare( ipAddress ) !== 0;
    }

    lt ( ipAddress ) {
        return this.compare( ipAddress ) < 0;
    }

    lte ( ipAddress ) {
        return this.compare( ipAddress ) <= 0;
    }

    gt ( ipAddress ) {
        return this.compare( ipAddress ) > 0;
    }

    gte ( ipAddress ) {
        return this.compare( ipAddress ) >= 0;
    }

    // private
    #parseV4 ( address ) {
        const hextets = address.split( "." );

        if ( hextets.length !== 4 ) throw new Error( PARSING_ERROR_MESSAGE );

        for ( let n = 0; n < hextets.length; n++ ) {
            const number = +hextets[ n ];

            if ( Number.isNaN( number ) || number < 0 || number > 255 ) throw new Error( PARSING_ERROR_MESSAGE );

            hextets[ n ] = number;
        }

        this.#isIpV4 = true;
        this.#value = hextets[ 0 ] * 16_777_216 + hextets[ 1 ] * 65_536 + hextets[ 2 ] * 256 + hextets[ 3 ];
    }

    #parseV6 ( address ) {
        var hextets;

        const groups = address.split( "::" );

        if ( groups.length > 2 ) throw new Error( PARSING_ERROR_MESSAGE );

        if ( groups.length === 2 ) {
            hextets = groups[ 0 ]
                ? this.#parseHextets( groups[ 0 ] )
                : "";
            if ( groups[ 1 ] ) groups[ 1 ] = this.#parseHextets( groups[ 1 ] );

            // handle 1:2:3:4:5:6:7::1
            if ( hextets.length + groups[ 1 ].length >= 32 ) throw new Error( PARSING_ERROR_MESSAGE );

            hextets += groups[ 1 ].padStart( 32 - hextets.length, "0" );
        }
        else {
            hextets = this.#parseHextets( groups[ 0 ] );
        }

        if ( hextets.length !== 32 ) throw new Error( PARSING_ERROR_MESSAGE );

        try {
            this.#value = BigInt( "0x" + hextets );
            this.#isIpV4 = false;
        }
        catch {
            throw new Error( PARSING_ERROR_MESSAGE );
        }
    }

    #parseHextets ( hextets ) {
        return hextets
            .split( ":" )
            .map( hextet => {
                if ( hextet.length === 0 || hextet.length > 4 ) throw new Error( PARSING_ERROR_MESSAGE );
                else return hextet.padStart( 4, "0" );
            } )
            .join( "" );
    }
}
