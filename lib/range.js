import RandomValues from "#lib/crypto/random-values";
import { compare } from "#lib/utils";

const ERRORS = {
    "CONTENT_LENGTH_INVALID": "Range content length is not valid",
    "START_INVALID": "Range start is not valid",
    "END_INVALID": "Range end is not valid",
    "LENGTH_INVALID": "Range length is not valid",
    "NOT_SATISFIABLE": "Range is not valid",
    "OUT_OF_RANGE": "Range is out of boundaries",
};

// NOTE: options
// satisfiable - checks that "start" <= "end"
// strictBoundaries - checks that "start" and "end" are inside the provided content length

export default class Range {
    #name;
    #useBigInt;
    #contentLength;
    #start;
    #end;
    #length;
    #maxLength;
    #inclusiveEnd;
    #inclusiveEndPoint;
    #httpRange;
    #httpContentRange;
    #ZERO;
    #ONE;
    #MINUS_ONE;

    constructor ( { name, contentLength, start, end, length, inclusive, useBigInt, satisfiable, strictBoundaries } = {} ) {
        if ( name ) {
            this.#name = String( name );
        }

        if ( useBigInt !== undefined ) {
            this.#useBigInt = Boolean( useBigInt );
        }
        else {
            this.#useBigInt = typeof contentLength === "bigint" || typeof start === "bigint" || typeof end === "bigint" || typeof length === "bigint" || typeof contentLength === "string" || typeof start === "string" || typeof end === "string" || typeof length === "string";
        }

        if ( this.#useBigInt ) {
            this.#ZERO = 0n;
            this.#ONE = 1n;
            this.#MINUS_ONE = -1n;
        }
        else {
            this.#ZERO = 0;
            this.#ONE = 1;
            this.#MINUS_ONE = -1;
        }

        // check params
        contentLength = this.#convertValue( contentLength, ERRORS.CONTENT_LENGTH_INVALID );
        if ( contentLength != null && contentLength < this.#ZERO ) {
            throw new Error( ERRORS.CONTENT_LENGTH_INVALID );
        }

        start = start == null
            ? this.#ZERO
            : this.#convertValue( start, ERRORS.START_INVALID );
        end = this.#convertValue( end, ERRORS.END_INVALID );
        length = this.#convertValue( length, ERRORS.LENGTH_INVALID );
        if ( length != null && length < this.#ZERO ) {
            throw new Error( ERRORS.LENGTH_INVALID );
        }

        // no content length
        if ( contentLength == null ) {
            this.#contentLength = null;

            // start
            this.#start = start;

            // length
            this.#length = undefined;

            // end not defined
            if ( end == null ) {
                if ( length == null ) {
                    this.#end = undefined;
                }

                // use length, relative to the start
                else {
                    this.#end = this.#start + length;

                    // start < 0, end >= 0
                    if ( this.#start < this.#ZERO && this.#end >= this.#ZERO ) {
                        if ( strictBoundaries ) {
                            throw new Error( ERRORS.OUT_OF_RANGE );
                        }
                        else {
                            this.#end = undefined;
                        }
                    }
                }
            }

            // end defined
            else {
                if ( inclusive ) {
                    if ( end === this.#MINUS_ONE ) {
                        this.#end = undefined;
                    }
                    else {
                        this.#end = end + this.#ONE;
                    }
                }
                else {
                    this.#end = end;
                }
            }

            // start < 0
            if ( this.#start < this.#ZERO ) {

                // start < 0, end = null
                if ( this.#end == null ) {
                    this.#maxLength = this.#useBigInt
                        ? -this.#start
                        : Math.abs( this.#start );
                }

                // start < 0, end < 0
                else if ( this.#end < this.#ZERO ) {

                    // start < 0, end < 0, start <= end
                    if ( this.#start <= this.#end ) {
                        this.#maxLength = this.#end - this.#start;
                    }

                    // start < 0, end < 0, start > end
                    else {
                        this.#handleNotSatisfiable( satisfiable );
                    }
                }

                // start < 0, end = 0
                else if ( this.#end === this.#ZERO ) {
                    this.#handleNotSatisfiable( satisfiable );
                }

                // start < 0, end > 0
                else {
                    this.#maxLength = this.#end;
                }
            }

            // start >= 0
            else {

                // start >= 0, end = null
                if ( this.#end == null ) {
                    this.#maxLength = undefined;
                }

                // start >= 0, end < 0
                else if ( this.#end < this.#ZERO ) {
                    this.#maxLength = undefined;
                }

                // start >= 0, end >= 0
                else {

                    // start >= 0, end >= 0, start > end
                    if ( this.#start > this.#end ) {
                        this.#handleNotSatisfiable( satisfiable );
                    }

                    this.#maxLength = this.#end - this.#start;
                }
            }

            if ( this.#maxLength === this.#ZERO ) this.#length = this.#ZERO;
        }

        // has content length
        else {
            this.#contentLength = contentLength;

            // start
            if ( start < this.#ZERO ) {
                this.#start = this.#contentLength + start;
            }
            else {
                this.#start = start;
            }

            // check start
            this.#start = this.#checkBoundary( this.#start, strictBoundaries, this.#contentLength );

            // end not defined
            if ( end == null ) {
                if ( length == null ) {
                    this.#end = this.#contentLength;
                }
                else {
                    this.#end = this.#start + length;
                }
            }

            // end defined
            else {

                // end is inclusive
                if ( inclusive ) {
                    if ( end === this.#MINUS_ONE ) {
                        this.#end = this.#contentLength;
                    }
                    else {
                        this.#end = end + this.#ONE;
                    }
                }
                else {
                    this.#end = end;
                }

                // end is negative
                if ( this.#end < this.#ZERO ) {
                    this.#end = this.#contentLength + this.#end;
                }
            }

            // check end
            this.#end = this.#checkBoundary( this.#end, strictBoundaries, this.#contentLength );

            // end < start
            if ( this.#end < this.#start ) {
                this.#handleNotSatisfiable( satisfiable );
            }

            // length
            this.#length = this.#maxLength = this.#end - this.#start;
        }

        // calculate inclusive end
        if ( this.#end == null ) {
            this.#inclusiveEnd = undefined;
        }

        // inclusive end can be calculated for non-relative range only
        else if ( this.#start >= this.#ZERO && this.#end >= this.#ZERO ) {
            this.#inclusiveEnd = this.#end - this.#ONE;

            if ( this.#start > this.#inclusiveEnd ) {
                this.#inclusiveEnd = this.#MINUS_ONE;
            }
        }
        else {
            this.#inclusiveEnd = this.#MINUS_ONE;
        }
    }

    // static
    static new ( range ) {
        if ( range instanceof this ) {
            return range;
        }
        else {
            return new this( range );
        }
    }

    static isValid ( range ) {
        try {
            this.new( range );

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
    get name () {
        return this.#name;
    }

    get useBigInt () {
        return this.#useBigInt;
    }

    get contentLength () {
        return this.#contentLength;
    }

    get start () {
        return this.#start;
    }

    get end () {
        return this.#end;
    }

    get length () {
        return this.#length;
    }

    get hasContentLength () {
        return this.#contentLength != null;
    }

    get inclusiveEnd () {
        return this.#inclusiveEnd;
    }

    get inclusiveEndPoint () {
        if ( this.#inclusiveEndPoint === undefined ) {
            if ( this.isRelativeRange ) {
                this.#inclusiveEndPoint = null;
            }
            else if ( this.isZeroRange ) {
                this.#inclusiveEndPoint = this.#end;
            }
            else {
                this.#inclusiveEndPoint = this.#inclusiveEnd;
            }
        }

        return this.#inclusiveEndPoint;
    }

    get maxLength () {
        return this.#maxLength;
    }

    get isFullRange () {
        return ( this.#start === this.#ZERO && this.#end == null ) || ( this.#contentLength != null && this.#contentLength === this.#length );
    }

    get isZeroRange () {
        return this.#length === this.#ZERO;
    }

    get isRelativeRange () {
        return this.#start < this.#ZERO || this.#end < this.#ZERO || this.#end == null;
    }

    get isValidHttpRange () {
        return this.toHttpRange() != null;
    }

    get isValidHttpContentRange () {
        return this.toContentRangeHeader() != null;
    }

    // public
    createRange ( { name, contentLength, start, end, ...options } = {} ) {
        return new this.constructor( {
            "name": name === undefined
                ? this.name
                : name,
            "contentLength": contentLength === undefined
                ? this.contentLength
                : contentLength,
            "start": start === undefined
                ? this.start
                : start,
            "end": end === undefined
                ? this.end
                : end,
            ...options,
        } );
    }

    intersects ( range ) {
        if ( this.isRelativeRange ) {
            return false;
        }
        else if ( typeof range === "number" || typeof range === "bigint" ) {
            return range >= this.#start && range <= this.inclusiveEndPoint;
        }
        else {
            range = this.constructor.new( range );

            if ( range.isRelativeRange ) {
                return false;
            }

            return this.start <= range.inclusiveEndPoint && range.start <= this.inclusiveEndPoint;
        }
    }

    contains ( range ) {
        if ( this.isRelativeRange ) {
            return false;
        }
        else if ( typeof range === "number" || typeof range === "bigint" ) {
            return range >= this.#start && range <= this.inclusiveEndPoint;
        }
        else {
            range = this.constructor.new( range );

            if ( range.isRelativeRange ) {
                return false;
            }
            else if ( range.start >= this.start && range.inclusiveEndPoint <= this.inclusiveEndPoint ) {
                return true;
            }
            else {
                return false;
            }
        }
    }

    isCoveredBy ( range ) {
        if ( this.isRelativeRange ) {
            return false;
        }
        else if ( typeof range === "number" || typeof range === "bigint" ) {
            return range === this.#start && range === this.inclusiveEndPoint;
        }
        else {
            range = this.constructor.new( range );

            if ( range.isRelativeRange ) {
                return false;
            }
            else if ( range.start <= this.start && range.inclusiveEndPoint >= this.inclusiveEndPoint ) {
                return true;
            }
            else {
                return false;
            }
        }
    }

    getRandomValue () {
        if ( this.inclusiveEnd >= this.#ZERO ) {
            return RandomValues.default.getRandomInt( { "min": this.start, "max": this.inclusiveEnd } );
        }
    }

    toHttpRange () {
        if ( this.#httpRange === undefined ) {
            this.#httpRange = null;

            if ( this.#start >= this.#ZERO ) {
                if ( this.#inclusiveEnd >= this.#ZERO ) {
                    this.#httpRange = `${ this.#start }-${ this.#inclusiveEnd }`;
                }
                else if ( this.#end == null ) {
                    this.#httpRange = `${ this.#start }-`;
                }
            }
            else if ( this.#end == null ) {
                this.#httpRange = this.#start.toString();
            }
        }

        return this.#httpRange;
    }

    toRangeHeader () {
        if ( this.isValidHttpRange ) {
            return "bytes=" + this.toHttpRange();
        }
    }

    toContentRangeHeader () {
        RANGE: if ( this.#httpContentRange === undefined ) {
            this.#httpContentRange = null;

            if ( this.#start < this.#ZERO || this.#inclusiveEnd == null || this.#inclusiveEnd < this.#ZERO ) break RANGE;

            this.#httpContentRange = `bytes ${ this.#start }-${ this.#inclusiveEnd }/${ this.#contentLength ?? "*" }`;
        }

        return this.#httpContentRange;
    }

    toJSON () {
        const json = {};

        if ( this.name ) json.name = this.name;

        const stringify = value => {
            return this.#useBigInt && value != null
                ? value.toString()
                : value;
        };

        if ( this.#contentLength != null ) json.contentLength = stringify( this.#contentLength );
        json.start = stringify( this.#start );
        if ( this.#end != null ) json.end = stringify( this.#end );
        if ( this.#useBigInt ) json.useBigInt = true;

        return json;
    }

    compare ( range ) {
        range = this.constructor.new( range );

        return compare( this.isRelativeRange, range.isRelativeRange ) || compare( this.start, range.start ) || compare( this.end, range.end );
    }

    [ Symbol.for( "nodejs.util.inspect.custom" ) ] ( depth, options, inspect ) {
        const spec = {};

        if ( this.name ) spec.name = this.name;

        if ( this.#contentLength != null ) spec.contentLength = this.#contentLength;

        spec.start = this.#start;

        if ( this.#end != null ) spec.end = this.#end;

        if ( this.#length != null ) {
            spec.length = this.#length;
        }
        else if ( this.#maxLength != null ) {
            spec.maxLength = this.#maxLength;
        }

        return `${ this.constructor.name }: ${ inspect( spec ) }`;
    }

    // private
    #convertValue ( value, errorMsg ) {
        if ( value == null ) return null;

        const converted = this.#useBigInt
            ? BigInt( value )
            : Number( value );

        if ( !this.#useBigInt && !Number.isSafeInteger( converted ) ) {
            throw new Error( errorMsg );
        }

        return converted;
    }

    #handleNotSatisfiable ( satisfiable ) {
        if ( satisfiable ) {
            throw new Error( ERRORS.NOT_SATISFIABLE );
        }

        this.#start = this.#end = this.#ZERO;
        this.#maxLength = this.#ZERO;
    }

    #checkBoundary ( value, strictBoundaries, contentLength ) {
        if ( value < this.#ZERO ) {
            if ( strictBoundaries ) {
                throw new Error( ERRORS.OUT_OF_RANGE );
            }

            return this.#ZERO;
        }

        if ( value > contentLength ) {
            if ( strictBoundaries ) {
                throw new Error( ERRORS.OUT_OF_RANGE );
            }

            return contentLength;
        }

        return value;
    }
}
