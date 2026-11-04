import { instantFromHttpDate, instantToHttpDate } from "#lib/dates";
import Hostname from "#lib/hostname";
import Interval from "#lib/interval";

const SAME_SITE = {
        "none": "None",
        "strict": "Strict",
        "lax": "Lax",
    },
    PRIORITY = {
        "low": "Low",
        "medium": "Medium",
        "high": "High",
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
    #priority;
    #isExpired;
    #expirationTimestamp;
    #cookieHeader;
    #setCookieHeader;

    constructor ( { name, value, domain, path, maxAge, expires, secure, httpOnly, partitioned, sameSite, priority } = {} ) {
        this.#name = name == null
            ? ""
            : String( name );
        this.#value = value == null
            ? ""
            : String( value );
        this.#path = path == null
            ? undefined
            : String( path );
        this.#secure = Boolean( secure );
        this.#httpOnly = Boolean( httpOnly );
        this.#partitioned = Boolean( partitioned );

        if ( sameSite ) {
            sameSite = sameSite.toLowerCase();

            if ( SAME_SITE[ sameSite ] ) {
                this.#sameSite = sameSite;
            }
        }

        if ( priority ) {
            priority = priority.toLowerCase();

            if ( PRIORITY[ priority ] ) {
                this.#priority = priority;
            }
        }

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
                maxAge = Interval.new( maxAge, "seconds" ).toSeconds().rounded.number;

                this.#maxAge = maxAge;
                this.#expirationTimestamp = Temporal.Now.instant().epochMilliseconds + maxAge * 1000;
            }
            catch {}
        }

        if ( expires != null && this.#maxAge == null ) {
            expires = instantFromHttpDate( expires );

            this.#expires = expires;
            this.#expirationTimestamp = expires.epochMilliseconds;
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
        return this.#name;
    }

    get value () {
        return this.#value;
    }

    get domain () {
        return this.#domain;
    }

    get path () {
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

    get priority () {
        return this.#priority;
    }

    get isSession () {
        return this.#expirationTimestamp == null;
    }

    get isExpired () {
        if ( this.#isExpired == null ) {
            if ( !this.#expirationTimestamp ) {
                this.#isExpired = false;
            }
            else if ( this.#expirationTimestamp <= Temporal.Now.instant().epochMilliseconds ) {
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
            this.#cookieHeader = ( this.#name
                ? encodeURIComponent( this.#name ) + "="
                : "" ) + encodeURIComponent( this.#value );
        }

        return this.#cookieHeader;
    }

    toSetCookieHeader () {
        if ( !this.#setCookieHeader ) {
            const values = [ ( this.#name
                ? encodeURIComponent( this.#name ) + "="
                : "" ) + encodeURIComponent( this.#value ) ];

            if ( this.#domain ) values.push( "Domain=" + this.#domain.ascii );

            if ( this.#path ) {
                values.push( "Path=" + ( this.#path.includes( ";" )
                    ? encodeURIComponent( this.#path )
                    : encodeURI( this.#path ) ) );
            }

            if ( this.#maxAge != null ) {
                values.push( "Max-Age=" + this.#maxAge );
            }
            else if ( this.#expires ) {
                values.push( "Expires=" + instantToHttpDate( this.#expires ) );
            }

            if ( this.#secure ) values.push( "Secure" );

            if ( this.#httpOnly ) values.push( "HttpOnly" );

            if ( this.#partitioned ) values.push( "Partitioned" );

            if ( this.#sameSite ) values.push( "SameSite=" + SAME_SITE[ this.#sameSite ] );

            if ( this.#priority ) values.push( "Priority=" + PRIORITY[ this.#priority ] );

            this.#setCookieHeader = values.join( "; " );
        }

        return this.#setCookieHeader;
    }

    [ Symbol.for( "nodejs.util.inspect.custom" ) ] ( depth, options, inspect ) {
        return `${ this.constructor.name }: ${ inspect( this.toJSON() ) }`;
    }
}
