import Hostname from "#lib/hostname";
import Interval from "#lib/interval";
import { parseHttpDate } from "#lib/temporal";

const SAME_SITE = {
    "none": "None",
    "strict": "Strict",
    "lax": "Lax",
};

export default class Cookie {
    #name;
    #value;
    #domain;
    #path;
    #maxAge;
    #expires;
    #secure;
    #httpOnly;
    #partitioned;
    #sameSite;
    #encodedName;
    #encodedValue;
    #encodedPath;

    #isExpired;
    #expirationTimestamp;
    #cookieHeader;
    #setCookieHeader;

    constructor ( { name, value, domain, path, maxAge, expires, secure, httpOnly, partitioned, sameSite, encodedName, encodedValue, encodedPath } = {} ) {
        this.#name = name;
        this.#value = value;
        this.#path = path;
        this.#secure = !!secure;
        this.#httpOnly = !!httpOnly;
        this.#partitioned = !!partitioned;

        if ( sameSite ) {
            sameSite = sameSite.toLowerCase();

            if ( SAME_SITE[ sameSite ] ) {
                this.#sameSite = sameSite;
            }
        }

        this.#encodedName = encodedName;
        this.#encodedValue = encodedValue;
        this.#encodedPath = encodedPath;

        if ( domain ) {

            // domain should not start with "."
            if ( typeof domain === "string" && domain.startsWith( "." ) ) {
                domain = domain.slice( 1 );
            }

            this.#domain = Hostname.new( domain );
        }

        // max age
        if ( maxAge != null ) {
            try {
                maxAge = Interval.new( maxAge, "seconds" ).toSeconds();

                this.#maxAge = maxAge;
                this.#expirationTimestamp = Date.now() + maxAge * 1000;
            }
            catch {}
        }

        if ( expires != null && this.#maxAge == null ) {
            try {
                this.#expires = parseHttpDate( expires );
                this.#expirationTimestamp = this.#expires.getTime();
            }
            catch {}
        }
    }

    // static
    static new ( options ) {
        if ( options instanceof this ) {
            return options;
        }
        else {
            return new this( options );
        }
    }

    // properties
    get name () {
        if ( this.#name == null ) {
            if ( this.#encodedName == null ) {
                this.#name = "";
            }
            else {
                try {
                    this.#name = decodeURIComponent( this.#encodedName );
                }
                catch {
                    this.#name = this.#encodedName;
                }
            }
        }

        return this.#name;
    }

    get value () {
        if ( this.#value == null ) {
            if ( this.#encodedValue == null ) {
                this.#value = "";
            }
            else {
                try {
                    this.#value = decodeURIComponent( this.#encodedValue );
                }
                catch {
                    this.#value = this.#encodedValue;
                }
            }
        }

        return this.#value;
    }

    get domain () {
        return this.#domain;
    }

    get path () {
        if ( this.#path == null ) {
            if ( this.#encodedPath == null ) {
                this.#path = "";
            }
            else {
                try {
                    this.#path = decodeURIComponent( this.#encodedPath );
                }
                catch {
                    this.#path = this.#encodedPath;
                }
            }
        }

        return this.#path;
    }

    get maxAge () {
        return this.#maxAge;
    }

    get expires () {
        return this.#expires;
    }

    get secure () {
        return this.#secure;
    }

    get httpOnly () {
        return this.#httpOnly;
    }

    get partitioned () {
        return this.#partitioned;
    }

    get sameSite () {
        return this.#sameSite;
    }

    get isSession () {
        return this.#expirationTimestamp == null;
    }

    get isExpired () {
        if ( this.#isExpired == null ) {
            if ( !this.#expirationTimestamp ) {
                this.#isExpired = false;
            }
            else if ( this.#expirationTimestamp <= Date.now() ) {
                this.#isExpired = true;
            }
            else {
                return false;
            }
        }

        return this.#isExpired;
    }

    get expirationTimestamp () {
        return this.#expirationTimestamp;
    }

    // public
    toString () {
        return this.toCookieHeader();
    }

    toJSON () {
        return {
            "name": this.name,
            "value": this.value,
            "domain": this.#domain?.ascii,
            "path": this.path,
            "maxAge": this.#maxAge,
            "expires": this.#expires,
            "secure": this.#secure,
            "httpOnly": this.#httpOnly,
            "partitioned": this.#partitioned,
            "sameSite": this.#sameSite,
        };
    }

    toCookieHeader () {
        if ( !this.#cookieHeader ) {
            this.#cookieHeader = this.#encodeName() === ""
                ? this.#encodeValue()
                : this.#encodeName() + "=" + this.#encodeValue();
        }

        return this.#cookieHeader;
    }

    toSetCookieHeader () {
        if ( !this.#setCookieHeader ) {
            const values = [

                //
                this.#encodeName() === ""
                    ? this.#encodeValue()
                    : this.#encodeName() + "=" + this.#encodeValue(),
            ];

            if ( this.#domain ) values.push( "Domain=" + this.#domain.ascii );

            if ( this.#encodePath() ) values.push( "Path=" + this.#encodePath() );

            if ( this.#maxAge != null ) {
                values.push( "Max-Age=" + this.#maxAge );
            }
            else if ( this.#expires ) {
                values.push( "Expires=" + this.#expires.toUTCString() );
            }

            if ( this.#secure ) values.push( "Secure" );

            if ( this.#httpOnly ) values.push( "HttpOnly" );

            if ( this.#partitioned ) values.push( "Partitioned" );

            if ( this.#sameSite ) values.push( "SameSite=" + SAME_SITE[ this.#sameSite ] );

            this.#setCookieHeader = values.join( "; " );
        }

        return this.#setCookieHeader;
    }

    [ Symbol.for( "nodejs.util.inspect.custom" ) ] ( depth, options, inspect ) {
        return `${ this.constructor.name }: ${ inspect( this.toJSON() ) }`;
    }

    // private
    #encodeName () {
        if ( this.#encodedName == null ) {
            if ( this.#name == null ) {
                this.#encodedName = "";
            }
            else {
                this.#encodedName = encodeURIComponent( this.#name );

                // this.#encodedName = this.#name.replaceAll( /([\s\x00-\x1F"%(),/:;<=>?@[\\\]{}\x7F-\xFF])/g, match => "%" + match.charCodeAt( 0 ).toString( 16 ).toUpperCase().padStart( 2, "0" ) );
            }
        }

        return this.#encodedName;
    }

    #encodeValue () {
        if ( this.#encodedValue == null ) {
            if ( this.#value == null ) {
                this.#encodedValue = "";
            }
            else {
                this.#encodedValue = encodeURIComponent( this.#value );

                // this.#encodedValue = this.#value.replaceAll( /([\s\x00-\x1F"%,;\\\x7F-\xFF])/g, match => "%" + match.charCodeAt( 0 ).toString( 16 ).toUpperCase().padStart( 2, "0" ) );
            }
        }

        return this.#encodedValue;
    }

    #encodePath () {
        if ( this.#encodedPath == null ) {
            if ( this.#path == null ) {
                this.#encodedPath = "";
            }
            else {
                this.#encodedPath = encodeURIComponent( this.#path );
            }
        }

        return this.#encodedPath;
    }
}
