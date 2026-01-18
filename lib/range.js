const ERRORS = {
    "CONTENT_LENGTH_INVALID": "Range content length is not valid",
    "START_INVALID": "Range start is not valid",
    "END_INVALID": "Range end is not valid",
    "LENGTH_INVALID": "Range length is not valid",
    "NOT_SATISFIABLE": "Range is not valid",
    "OUT_OF_RANGE": "Range is out of boundaries",
};

export default class Range {
    #contentLength;
    #start;
    #end;
    #length;
    #maxLength;
    #inclusiveEnd;
    #httpRange;
    #httpContentRange;

    constructor ( { contentLength, start, end, length, inclusive, satisfiable, strictBoundaries } = {} ) {

        // check params
        if ( contentLength != null && ( !Number.isInteger( contentLength ) || contentLength < 0 ) ) {
            throw new Error( ERRORS.CONTENT_LENGTH_INVALID );
        }

        if ( start == null ) {
            start = 0;
        }
        else if ( !Number.isInteger( start ) ) {
            throw new Error( ERRORS.START_INVALID );
        }

        if ( end != null && !Number.isInteger( end ) ) {
            throw new Error( ERRORS.END_INVALID );
        }

        if ( length != null && ( !Number.isInteger( length ) || length < 0 ) ) {
            throw new Error( ERRORS.LENGTH_INVALID );
        }

        // no content length
        if ( contentLength == null ) {
            this.#contentLength = null;

            // start
            this.#start = start;

            // length
            this.#length = undefined;

            // end
            if ( end == null ) {
                if ( length == null ) {
                    this.#end = undefined;
                }

                // use length, relative to the start
                else {
                    this.#end = this.#start + length;

                    if ( this.#start < 0 && this.#end >= 0 ) {
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
                    if ( end === -1 ) {
                        this.#end = undefined;
                    }
                    else {
                        this.#end = end + 1;
                    }
                }
                else {
                    this.#end = end;
                }
            }

            // XXX
            // start < 0
            if ( this.#start < 0 ) {

                // start < 0, end = null
                if ( this.#end == null ) {
                    this.#maxLength = Math.abs( this.#start );
                }

                // start < 0, end < 0
                else if ( this.#end < 0 ) {
                    if ( this.#start <= this.#end ) {
                        this.#maxLength = this.#end - this.#start;
                    }
                    else {
                        if ( satisfiable ) {
                            throw new Error( ERRORS.NOT_SATISFIABLE );
                        }
                        else {
                            this.#start = this.#end = 0;
                            this.#maxLength = 0;
                        }
                    }
                }

                // start < 0, end = 0
                else if ( this.#end === 0 ) {
                    if ( satisfiable ) {
                        throw new Error( ERRORS.NOT_SATISFIABLE );
                    }
                    else {
                        this.#start = this.#end = 0;
                        this.#maxLength = 0;
                    }
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
                else if ( this.#end < 0 ) {
                    this.#maxLength = undefined;
                }

                // start >= 0, end >= 0
                else {
                    if ( this.#start > this.#end ) {
                        if ( satisfiable ) {
                            throw new Error( ERRORS.NOT_SATISFIABLE );
                        }
                        else {
                            this.#start = this.#end = 0;
                        }
                    }

                    this.#maxLength = this.#end - this.#start;
                }
            }

            if ( this.#maxLength === 0 ) this.#length = 0;
        }

        // has content length
        else {
            this.#contentLength = contentLength;

            // start
            if ( start < 0 ) {
                this.#start = this.#contentLength + start;
            }
            else {
                this.#start = start;
            }

            // check start
            if ( this.#start < 0 ) {
                if ( strictBoundaries ) {
                    throw new Error( ERRORS.OUT_OF_RANGE );
                }
                else {
                    this.#start = 0;
                }
            }
            else if ( this.#start > this.#contentLength ) {
                if ( strictBoundaries ) {
                    throw new Error( ERRORS.OUT_OF_RANGE );
                }
                else {
                    this.#start = this.#contentLength;
                }
            }

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
                    if ( end === -1 ) {
                        this.#end = this.#contentLength;
                    }
                    else {
                        this.#end = end + 1;
                    }
                }
                else {
                    this.#end = end;
                }

                // end is negative
                if ( this.#end < 0 ) {
                    this.#end = this.#contentLength + this.#end;
                }
            }

            // check end
            if ( this.#end < 0 ) {
                if ( strictBoundaries ) {
                    throw new Error( ERRORS.OUT_OF_RANGE );
                }
                else {
                    this.#end = 0;
                }
            }
            else if ( this.#end > this.#contentLength ) {
                if ( strictBoundaries ) {
                    throw new Error( ERRORS.OUT_OF_RANGE );
                }
                else {
                    this.#end = this.#contentLength;
                }
            }

            if ( this.#end < this.#start ) {
                if ( satisfiable ) {
                    throw new Error( ERRORS.NOT_SATISFIABLE );
                }
                else {
                    this.#end = this.#start = 0;
                }
            }

            // length
            this.#length = this.#maxLength = this.#end - this.#start;
        }

        // calculate inclusive end
        if ( this.#end == null ) {
            this.#inclusiveEnd = undefined;
        }

        // inclusive end can be calculated for non-relative range only
        else if ( this.#start >= 0 && this.#end >= 0 ) {
            this.#inclusiveEnd = this.#end - 1;

            if ( this.#start > this.#inclusiveEnd ) {
                this.#inclusiveEnd = -1;
            }
        }
        else {
            this.#inclusiveEnd = -1;
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

    static compare ( a, b ) {
        return this.new( a ).compare( b );
    }

    static get comparator () {
        return this.compare.bind( this );
    }

    // properties
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

    get maxLength () {
        return this.#maxLength;
    }

    get isFullRange () {
        if ( this.#start === 0 && this.#end == null ) {
            return true;
        }
        else if ( this.#contentLength != null && this.#contentLength === this.#length ) {
            return true;
        }

        return false;
    }

    get isZeroRange () {
        return this.#length === 0;
    }

    get isRelative () {
        if ( this.#start < 0 || this.#end < 0 ) {
            return true;
        }

        return false;
    }

    get isValidHttpRange () {
        return this.httpRange != null;
    }

    get httpRange () {
        if ( this.#httpRange === undefined ) {
            this.#httpRange = null;

            if ( this.#start >= 0 ) {
                if ( this.#inclusiveEnd >= 0 ) {
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

    get isValidHttpContentRange () {
        return this.httpContentRange != null;
    }

    get httpContentRange () {
        RANGE: if ( this.#httpContentRange === undefined ) {
            this.#httpContentRange = null;

            if ( this.#start < 0 || this.#inclusiveEnd == null || this.#inclusiveEnd < 0 ) break RANGE;

            this.#httpContentRange = `bytes ${ this.#start }-${ this.#inclusiveEnd }/${ this.#contentLength ?? "*" }`;
        }

        return this.#httpContentRange;
    }

    // public
    createRange ( { contentLength, start, end, ...options } = {} ) {
        return new this.constructor( {
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

    // XXX
    compare ( range ) {
        range = this.constructor.new( range );

        return Math.abs( this.start ) - Math.abs( range.start ) || Math.abs( this.end ?? Infinity ) - Math.abs( range.end ?? Infinity );
    }

    // XXX
    includes ( range ) {
        range = this.constructor.new( range );
    }

    // XXX
    inside ( range ) {
        range = this.constructor.new( range );
    }

    // XXX
    intersects ( range ) {
        range = this.constructor.new( range );
    }

    // XXX
    isConsecutive ( range ) {
        range = this.constructor.new( range );
    }

    // XXX
    concat ( range ) {
        range = this.constructor.new( range );

        if ( this.includes( range ) ) {
            return this;
        }
        else if ( this.inside( range ) ) {
            return range;
        }
        else if ( this.intersects( range ) || this.isConsecutive( range ) ) {
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
            throw new Error( "Cannot concatenate ranges" );
        }
    }

    toJSON () {
        const json = {};

        if ( this.#contentLength != null ) json.contentLength = this.#contentLength;

        json.start = this.#start;

        if ( this.#end != null ) json.end = this.#end;

        return json;
    }

    [ Symbol.for( "nodejs.util.inspect.custom" ) ] ( depth, options, inspect ) {
        const spec = {};

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
}
