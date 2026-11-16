import RandomValues from "#lib/crypto/random-values";
import RangeTree from "#lib/data-structures/range-tree";
import Range from "#lib/range";
import { compare, isPlainObject } from "#lib/utils";

export default class Ranges {
    #ranges = [];
    #useBigInt;
    #httpRange;
    #hasRelativeRanges = false;
    #maxLength;
    #randomRanges;
    #hasIntersections;
    #combinedRanges;
    #rangeTree;
    #ZERO;
    #ONE;

    constructor ( ranges ) {
        var useBigInt;

        if ( isPlainObject( ranges ) ) {
            ( { ranges, useBigInt } = ranges );
        }

        if ( useBigInt !== undefined ) {
            this.#setUseBigInt( Boolean( useBigInt ) );
        }

        if ( !Array.isArray( ranges ) ) ranges = [ ranges ];

        for ( let range of ranges ) {
            range = Range.new( range );

            if ( this.#useBigInt == null ) {
                this.#setUseBigInt( range.useBigInt );
            }
            else if ( this.#useBigInt !== range.useBigInt ) {
                throw new Error( "Unable to mix bigint and number ranges" );
            }

            this.#ranges.push( range );

            if ( range.isRelativeRange ) {
                this.#hasRelativeRanges = true;
            }
            else if ( range.maxLength ) {
                this.#maxLength += range.maxLength;
            }
        }

        if ( this.#useBigInt == null ) {
            this.#setUseBigInt( false );
        }
    }

    // static
    static new ( ranges ) {
        if ( ranges instanceof this ) {
            return ranges;
        }
        else {
            return new this( ranges );
        }
    }

    // properties
    get useBigInt () {
        return this.#useBigInt;
    }

    get size () {
        return this.#ranges.length;
    }

    get hasRanges () {
        return this.#ranges.length !== 0;
    }

    get hasRelativeRanges () {
        return this.#hasRelativeRanges;
    }

    get maxLength () {
        return this.#maxLength;
    }

    get isValidHttpRange () {
        return this.toHttpRange() != null;
    }

    get hasIntersections () {
        if ( this.#hasIntersections == null ) {
            if ( this.size <= 1 ) {
                this.#hasIntersections = false;
            }

            // scanline algorithm
            else {
                this.#hasIntersections = false;

                const points = [];

                for ( const range of this.#ranges ) {

                    // skip relative ranges
                    if ( range.isRelativeRange ) continue;

                    points.push( {
                        "value": range.start,
                        "start": true,
                        range,
                    } );

                    points.push( {
                        "value": range.isZeroRange
                            ? range.end
                            : range.inclusiveEnd,
                        "start": false,
                        range,
                    } );
                }

                points.sort( ( a, b ) => a.value - b.value || b.start - a.start );

                let started = false;

                for ( const point of points ) {
                    if ( point.start ) {
                        if ( started ) {
                            this.#hasIntersections = true;

                            break;
                        }
                        else {
                            started = true;
                        }
                    }
                    else {
                        started = false;
                    }
                }
            }
        }

        return this.#hasIntersections;
    }

    get combinedRanges () {
        if ( !this.#combinedRanges ) {
            let updated;

            const sorted = this.#ranges
                    .filter( range => {
                        if ( range.isRelativeRange ) {
                            updated = true;

                            return false;
                        }
                        else {
                            return true;
                        }
                    } )
                    .map( range => {
                        return {
                            "start": range.start,
                            "end": range.end,
                        };
                    } )
                    .sort( ( a, b ) => compare( a.start, b.start ) || compare( a.end, b.end ) ),
                merged = sorted.length
                    ? [ sorted[ 0 ] ]
                    : [];

            for ( let i = 1; i < sorted.length; i++ ) {
                const current = sorted[ i ],
                    last = merged.at( -1 );

                if ( current.start <= last.end ) {
                    updated = true;

                    if ( current.end > last.end ) {
                        last.end = current.end;
                    }
                }
                else {
                    merged.push( current );
                }
            }

            if ( updated ) {
                this.#combinedRanges = new this.constructor( merged );
            }
            else {
                this.#combinedRanges = this;
            }
        }

        return this.#combinedRanges;
    }

    // public
    createRanges ( { contentLength, start, end, ...options } = {} ) {
        const ranges = Array.from( this.#ranges, range => range.createRange( { contentLength, start, end, ...options } ) );

        return new this.constructor( {
            "useBigInt": this.#useBigInt,
            ranges,
        } );
    }

    hasRangesIntersecting ( range ) {
        return this.#getRangeTree().hasRangesIntersecting( range );
    }

    hasRangesContaining ( range ) {
        return this.#getRangeTree().hasRangesContaining( range );
    }

    hasRangesCoveredBy ( range ) {
        return this.#getRangeTree().hasRangesCoveredBy( range );
    }

    findRangesIntersecting ( range ) {
        return this.#getRangeTree().findRangesIntersecting( range );
    }

    findRangesContaining ( range ) {
        return this.#getRangeTree().findRangesContaining( range );
    }

    findRangesCoveredBy ( range ) {
        return this.#getRangeTree().findRangesCoveredBy( range );
    }

    getRandomValue () {
        return this.#getRandomValue()?.value;
    }

    getRandomRange ( { useWeights = true } = {} ) {
        if ( this.#ranges.length === 0 ) {
            return;
        }
        else if ( useWeights ) {
            return this.#getRandomValue()?.range;
        }
        else if ( this.#ranges.length === 1 ) {
            return this.#ranges[ 0 ];
        }
        else {
            return this.#ranges[ RandomValues.default.getRandomInt( { "min": 0, "max": this.#ranges.length - 1 } ) ];
        }
    }

    toHttpRange () {
        RANGE: if ( this.#httpRange === undefined ) {
            this.#httpRange = null;

            if ( !this.#ranges.length ) break RANGE;

            const ranges = [];

            for ( const range of this.#ranges ) {
                if ( !range.isValidHttpRange ) {
                    break RANGE;
                }

                ranges.push( range.toHttpRange() );
            }

            this.#httpRange = ranges.join( "," );
        }

        return this.#httpRange;
    }

    toRangeHeader () {
        if ( this.isValidHttpRange ) {
            return "bytes=" + this.toHttpRange();
        }
    }

    [ Symbol.iterator ] () {
        return this.#ranges.values();
    }

    [ Symbol.for( "nodejs.util.inspect.custom" ) ] ( depth, options, inspect ) {
        const spec = {
            "ranges": this.#ranges,
        };

        return `${ this.constructor.name }: ${ inspect( spec ) }`;
    }

    // private
    #setUseBigInt ( value ) {
        this.#useBigInt = value;

        if ( this.#useBigInt ) {
            this.#ZERO = 0n;
            this.#ONE = 1n;
            this.#maxLength = 0n;
        }
        else {
            this.#ZERO = 0;
            this.#ONE = 1;
            this.#maxLength = 0;
        }
    }

    #getRangeTree () {
        if ( !this.#rangeTree ) {
            this.#rangeTree = new RangeTree();

            for ( const range of this.#ranges ) {
                if ( range.isRelativeRange ) continue;

                this.#rangeTree.add( range );
            }
        }

        return this.#rangeTree;
    }

    #getRandomValue () {
        if ( !this.#maxLength ) return;

        if ( !this.#randomRanges ) {
            this.#randomRanges = [];

            let offset = this.#ZERO;

            for ( const range of this.#ranges ) {
                if ( range.isRelativeRange || range.isZeroRange ) continue;

                offset += range.maxLength;

                this.#randomRanges.push( {
                    range,
                    offset,
                } );
            }
        }

        const offset = RandomValues.default.getRandomInt( { "max": this.#maxLength - this.#ONE } );

        let left = 0,
            right = this.#randomRanges.length - 1;

        while ( left < right ) {
            const middle = ( left + right ) >> 1;

            if ( offset < this.#randomRanges[ middle ].offset ) {
                right = middle;
            }
            else {
                left = middle + 1;
            }
        }

        const range = this.#randomRanges[ left ].range,
            prevPrefix = left === 0
                ? this.#ZERO
                : this.#randomRanges[ left - 1 ].offset;

        return {
            "value": range.start + ( offset - prevPrefix ),
            range,
        };
    }
}
