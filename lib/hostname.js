import net from "node:net";
import { domainToASCII, domainToUnicode } from "node:url";
import { readConfigSync } from "#lib/config";
import externalResources from "#lib/external-resources";
import IpAddress from "#lib/ip/address";
import { validateDomainName } from "#lib/validate";

var RESOURCES;

const PUBLIC_SUFFIXES = await externalResources
    .add( "c0rejs/core/resources/public-suffixes" )
    .on( "update", () => ( RESOURCES = null ) )
    .check();

const TLD = await externalResources
    .add( "c0rejs/core/resources/tld" )
    .on( "update", () => ( RESOURCES = null ) )
    .check();

export default class Hostname {
    #domain;

    #unicode;
    #ascii;
    #isValid;
    #isIp;
    #isIpV4;
    #isIpV6;
    #ipAddress;
    #parent;
    #isTld;
    #tld;
    #tldIsValid;
    #isPublicSuffix;
    #publicSuffix;
    #isRootDomain;
    #isRootSubdomain;
    #rootDomain;
    #rootLabel;

    constructor ( domain ) {
        this.#domain = domain.toLowerCase();
    }

    // static
    static new ( hostname ) {
        if ( hostname instanceof this ) {
            return hostname;
        }
        else {
            return new this( hostname );
        }
    }

    static compare ( a, b ) {
        return this.new( a ).compare( b );
    }

    static get comparator () {
        return this.compare.bind( this );
    }

    // properties
    get unicode () {
        this.#unicode ??= domainToUnicode( this.#domain );

        return this.#unicode;
    }

    get ascii () {
        this.#ascii ??= domainToASCII( this.#domain );

        return this.#ascii;
    }

    get isValid () {
        if ( this.#isValid == null ) {
            if ( this.isIp ) {
                this.#isValid = true;
            }
            else if ( this.ascii === "" ) {
                this.#isValid = false;
            }
            else if ( !validateDomainName( this.ascii ).ok ) {
                this.#isValid = false;
            }
            else {
                this.#isValid = true;
            }
        }

        return this.#isValid;
    }

    get isDomain () {
        return !this.isIp;
    }

    get isIp () {
        if ( this.#isIp == null ) this.#checkIsIp();

        return this.#isIp;
    }

    get isIpV4 () {
        if ( this.#isIpV4 == null ) this.#checkIsIp();

        return this.#isIpV4;
    }

    get isIpV6 () {
        if ( this.#isIpV6 == null ) this.#checkIsIp();

        return this.#isIpV6;
    }

    get ipAddress () {
        if ( this.#ipAddress === undefined ) {
            this.#ipAddress = null;

            if ( this.isIp ) {
                this.#ipAddress = new IpAddress( this.#domain );
            }
        }

        return this.#ipAddress;
    }

    get isTld () {
        if ( this.#isTld == null ) {
            if ( !this.tld ) {
                this.#isTld = false;
            }
            else {
                this.#isTld = this.tld.unicode === this.unicode;
            }
        }

        return this.#isTld;
    }

    get parent () {
        if ( this.#parent === undefined ) {
            this.#parent = null;

            if ( this.isDomain ) {
                const idx = this.unicode.indexOf( "." );

                if ( idx >= 0 ) {
                    this.#parent = new this.constructor( this.unicode.slice( idx + 1 ) );
                }
            }
        }

        return this.#parent;
    }

    get tld () {
        if ( this.#tld === undefined ) {
            if ( this.isIp ) {
                this.#tld = null;
            }
            else {
                const idx = this.unicode.lastIndexOf( "." );

                if ( idx < 0 ) {
                    this.#tld = this;
                }
                else {
                    this.#tld = new this.constructor( this.unicode.slice( idx + 1 ) );
                }
            }
        }

        return this.#tld;
    }

    get tldIsValid () {
        if ( this.#tldIsValid == null ) {
            if ( this.tld ) {
                this.#tldIsValid = this.#resources.has( this.tld.unicode );
            }
            else {
                this.#tldIsValid = false;
            }
        }

        return this.#tldIsValid;
    }

    get isPublicSuffix () {
        this.#isPublicSuffix ??= this.publicSuffix && this.publicSuffix.unicode === this.unicode;

        return this.#isPublicSuffix;
    }

    get publicSuffix () {
        if ( this.#publicSuffix === undefined ) {
            this.#publicSuffix = null;

            if ( this.isIp ) {
                this.#publicSuffix = null;
            }
            else if ( this.#resources.has( this.unicode ) ) {
                this.#publicSuffix = this;
            }
            else {
                const labels = this.unicode.split( "." );

                if ( labels.length > 1 ) {
                    let publicSuffix, rootLabel;

                    while ( labels.length > 1 ) {
                        rootLabel = labels.shift();
                        publicSuffix = labels.join( "." );

                        // match wildcard
                        if ( this.#resources.has( "*." + publicSuffix ) ) {
                            const rootDomain = rootLabel + "." + publicSuffix;

                            // not excluded
                            if ( !this.#resources.has( "!" + rootDomain ) ) {
                                publicSuffix = rootDomain;
                            }

                            if ( publicSuffix === this.unicode ) {
                                this.#publicSuffix = this;
                            }
                            else {
                                this.#publicSuffix = new this.constructor( publicSuffix );
                            }

                            break;
                        }

                        if ( this.#resources.has( publicSuffix ) ) {
                            this.#publicSuffix = new this.constructor( publicSuffix );

                            break;
                        }
                    }
                }
            }
        }

        return this.#publicSuffix;
    }

    get isRootDomain () {
        this.#isRootDomain ??= !!( this.rootDomain && this.rootDomain.unicode === this.unicode );

        return this.#isRootDomain;
    }

    get isRootSubdomain () {
        if ( this.#isRootSubdomain == null ) {
            if ( !this.rootDomain ) {
                this.#isRootSubdomain = false;
            }
            else if ( this.isRootDomain ) {
                this.#isRootSubdomain = false;
            }
            else {
                const left = this.unicode.slice( 0, -this.rootDomain.unicode.length - 1 );

                this.#isRootSubdomain = !left.includes( "." );
            }
        }

        return this.#isRootSubdomain;
    }

    get rootDomain () {
        if ( this.#rootDomain === undefined ) {
            if ( this.rootLabel == null ) {
                this.#rootDomain = null;
            }
            else {
                const rootDomain = this.rootLabel.unicode + "." + this.publicSuffix.unicode;

                if ( rootDomain === this.unicode ) {
                    this.#rootDomain = this;
                }
                else {
                    this.#rootDomain = new this.constructor( rootDomain );
                }
            }
        }

        return this.#rootDomain;
    }

    get rootLabel () {
        if ( this.#rootLabel === undefined ) {
            if ( this.publicSuffix && !this.isPublicSuffix ) {
                const left = this.unicode.slice( 0, -this.publicSuffix.unicode.length - 1 );

                const idx = left.lastIndexOf( "." );

                this.#rootLabel = new this.constructor( left.slice( idx + 1 ) );
            }
            else {
                this.#rootLabel = null;
            }
        }

        return this.#rootLabel;
    }

    compare ( hostname ) {
        hostname = Hostname.new( hostname );

        if ( this.isIp ) {
            if ( hostname.isIp ) {
                return this.ipAddress.compare( hostname.ipAddress );
            }
            else {
                return -1;
            }
        }
        else {
            if ( hostname.isIp ) {
                return 1;
            }
            else {
                const a = this.unicode.split( "." ),
                    b = hostname.unicode.split( "." ),
                    length = Math.min( a.length, b.length );

                for ( let n = 0; n < length; n++ ) {
                    const a1 = a.pop(),
                        b1 = b.pop();

                    if ( a1 < b1 ) {
                        return -1;
                    }
                    else if ( a1 > b1 ) {
                        return 1;
                    }
                }

                if ( a.length ) {
                    return 1;
                }
                else if ( b.length ) {
                    return -1;
                }
                else {
                    return 0;
                }
            }
        }
    }

    // public
    toString () {
        return this.unicode || this.#domain;
    }

    toJSON () {
        return this.toString();
    }

    [ Symbol.for( "nodejs.util.inspect.custom" ) ] ( depth, options, inspect ) {
        return `${ this.constructor.name }: ${ inspect( this.toString() ) }`;
    }

    // private
    get #resources () {
        if ( !RESOURCES ) {
            RESOURCES = new Set();

            for ( const row of readConfigSync( PUBLIC_SUFFIXES.getResourcePath( "public-suffixes.json" ) ) ) {
                RESOURCES.add( row );
            }

            for ( const row of readConfigSync( TLD.getResourcePath( "tld.json" ) ) ) {
                RESOURCES.add( row );
            }
        }

        return RESOURCES;
    }

    #checkIsIp () {
        const ip = net.isIP( this.#domain );

        if ( !ip ) {
            this.#isIp = false;
            this.#isIpV4 = false;
            this.#isIpV6 = false;
        }
        else {
            this.#isIp = true;
            this.#isIpV4 = ip === 4;
            this.#isIpV6 = ip === 6;
        }
    }
}
