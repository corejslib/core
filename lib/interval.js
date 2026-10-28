import CacheLru from "#lib/cache/lru";
import { parseZonedDateTime } from "#lib/dates";
import Numeric from "#lib/numeric";

const DEFAULT_PRECISION = 1000,
    DEFAULT_SCALE = 14,
    DEFAULT_UNIT = "milliseconds",
    ZERO_UNIT = "seconds",
    STRING_CACHE_MAX_SIZE = 1000,
    NUMERIC_OPTS = Object.freeze( {
        "precision": DEFAULT_PRECISION,
        "scale": DEFAULT_SCALE,
    } ),
    ZERO = Numeric( 0, NUMERIC_OPTS ),
    UNITS = {
        "years": {
            "long": [ "year", "years" ],
            "short": [ "yr", "yrs" ],
            "narrow": [ "y", "y" ],
            "nanoseconds": 1_000_000n * 1000n * 60n * 60n * 24n * 365n, // 365 days
            "months": 12,
            "nginx": "y",
            "relativeDateParam": true,
        },
        "quarters": {
            "long": [ "quarter", "quarters" ],
            "short": [ "qtr", "qtrs" ],
            "narrow": [ "q", "q" ],
            "nanoseconds": ( 1_000_000n * 1000n * 60n * 60n * 24n * 365n ) / 4n, // 1 / 4 year
            "months": 3,
            "nginx": null,
            "relativeDateParam": true,
        },
        "months": {
            "long": [ "month", "months" ],
            "short": [ "mth", "mths" ],
            "narrow": [ "mo", "mo" ],
            "aliases": [ "M" ],
            "nanoseconds": ( 1_000_000n * 1000n * 60n * 60n * 24n * 365n ) / 12n, // 1 / 12 year
            "months": 1,
            "nginx": "M",
            "relativeDateParam": true,
        },
        "weeks": {
            "long": [ "week", "weeks" ],
            "short": [ "wk", "wks" ],
            "narrow": [ "w", "w" ],
            "nanoseconds": 1_000_000n * 1000n * 60n * 60n * 24n * 7n, // 7 days
            "nginx": "w",
            "relativeDateParam": true,
        },
        "days": {
            "long": [ "day", "days" ],
            "short": [ "day", "days" ],
            "narrow": [ "d", "d" ],
            "nanoseconds": 1_000_000n * 1000n * 60n * 60n * 24n,
            "nginx": "d",
            "relativeDateParam": true,
        },
        "hours": {
            "long": [ "hour", "hours" ],
            "short": [ "hr", "hrs" ],
            "narrow": [ "h", "h" ],
            "nanoseconds": 1_000_000n * 1000n * 60n * 60n,
            "nginx": "h",
            "relativeDateParam": true,
        },
        "minutes": {
            "long": [ "minute", "minutes" ],
            "short": [ "min", "mins" ],
            "narrow": [ "m", "m" ],
            "nanoseconds": 1_000_000n * 1000n * 60n,
            "nginx": "m",
            "relativeDateParam": true,
        },
        "seconds": {
            "long": [ "second", "seconds" ],
            "short": [ "sec", "secs" ],
            "narrow": [ "s", "s" ],
            "nanoseconds": 1_000_000n * 1000n,
            "nginx": "s",
            "relativeDateParam": true,
        },
        "milliseconds": {
            "long": [ "millisecond", "milliseconds" ],
            "short": [ "ms", "ms" ],
            "narrow": [ "ms", "ms" ],
            "nanoseconds": 1_000_000n,
            "nginx": "ms",
            "relativeDateParam": false,
        },
        "microseconds": {
            "long": [ "microsecond", "microseconds" ],
            "short": [ "μs", "μs" ],
            "narrow": [ "μs", "μs" ],
            "aliases": [ "us" ],
            "nanoseconds": 1000n,
            "nginx": null,
            "relativeDateParam": false,
        },
        "nanoseconds": {
            "long": [ "nanosecond", "nanoseconds" ],
            "short": [ "ns", "ns" ],
            "narrow": [ "ns", "ns" ],
            "nanoseconds": 1n,
            "nginx": null,
            "relativeDateParam": false,
        },
    },
    ALIASES = {},
    STYLES = {
        "long": " ",
        "short": " ",
        "narrow": "",
    },
    INTERVAL_UNIT_NAMES = [ "years", "months", "days", "hours", "minutes", "seconds", "milliseconds", "microseconds", "nanoseconds" ],
    INTERVAL_TOKEN_RE = /([+\-]?\d+(?:\.\d+)?)([A-Za-zμ]+)/v;

// create aliases
for ( const name in UNITS ) {
    UNITS[ name ].name = name;

    ALIASES[ name ] = UNITS[ name ];

    UNITS[ name ].nanoseconds = Numeric( UNITS[ name ].nanoseconds, NUMERIC_OPTS );

    if ( UNITS[ name ].months ) {
        UNITS[ name ].months = Numeric( UNITS[ name ].months, NUMERIC_OPTS );
    }

    if ( UNITS[ name ].long ) {
        for ( const alias of UNITS[ name ].long ) {
            ALIASES[ alias ] = UNITS[ name ];
        }
    }

    if ( UNITS[ name ].short ) {
        for ( const alias of UNITS[ name ].short ) {
            ALIASES[ alias ] = UNITS[ name ];
        }
    }

    if ( UNITS[ name ].narrow ) {
        for ( const alias of UNITS[ name ].narrow ) {
            ALIASES[ alias ] = UNITS[ name ];
        }
    }

    if ( UNITS[ name ].aliases ) {
        for ( const alias of UNITS[ name ].aliases ) {
            ALIASES[ alias ] = UNITS[ name ];
        }
    }
}

var CACHE;

function compareDates ( fromDate, toDate ) {
    fromDate = parseZonedDateTime( fromDate ?? Date.now() );
    toDate = parseZonedDateTime( toDate ?? Date.now() );

    const units = {
        "nanoseconds": toDate.epochNanoseconds - fromDate.epochNanoseconds,
    };

    return units;
}

export default class Interval {
    #units = {
        "years": ZERO,
        "months": ZERO,
        "days": ZERO,
        "hours": ZERO,
        "minutes": ZERO,
        "seconds": ZERO,
        "milliseconds": ZERO,
        "microseconds": ZERO,
        "nanoseconds": ZERO,
    };
    #strings = {};
    #toUnits = {};
    #trunc = {};
    #duration;
    #formatDurationParams;
    #formatRelativeDateParams;
    #normalizedUnits;
    #pendingCacheKey;

    constructor ( interval, unit = DEFAULT_UNIT ) {
        CACHE ??= new CacheLru( {
            "maxSize": STRING_CACHE_MAX_SIZE,
        } );

        if ( this.#parse( interval, unit ) ) {
            this.#buildUnits();

            if ( this.#pendingCacheKey !== undefined ) {
                CACHE.set( this.#pendingCacheKey, { ...this.#units } );

                this.#pendingCacheKey = undefined;
            }
        }
    }

    // static
    static new ( interval, unit ) {
        if ( interval instanceof this ) return interval;

        return new this( interval, unit );
    }

    static fromDates ( fromDate, toDate ) {
        return new this( compareDates( fromDate, toDate ) );
    }

    static get compare () {
        return ( a, b ) => this.new( a ).compare( b );
    }

    // properties
    get hasValue () {
        return !this.toNanoseconds().isZero;
    }

    get years () {
        return this.#units.years;
    }

    get months () {
        return this.#units.months;
    }

    get days () {
        return this.#units.days;
    }

    get hours () {
        return this.#units.hours;
    }

    get minutes () {
        return this.#units.minutes;
    }

    get seconds () {
        return this.#units.seconds;
    }

    get milliseconds () {
        return this.#units.milliseconds;
    }

    get microseconds () {
        return this.#units.microseconds;
    }

    get nanoseconds () {
        return this.#units.nanoseconds;
    }

    // public
    toString ( style = "long" ) {
        if ( !( style in STYLES ) ) {
            style = "long";
        }

        if ( this.#strings[ style ] == null ) {
            const units = [];

            for ( const name of INTERVAL_UNIT_NAMES ) {
                const value = this.#units[ name ];

                if ( value.isZero ) continue;

                units.push( value.toString() + STYLES[ style ] + ( value.abs.bigint === 1n
                    ? UNITS[ name ][ style ][ 0 ]
                    : UNITS[ name ][ style ][ 1 ] ) );
            }

            if ( units.length ) {
                this.#strings[ style ] = units.join( " " );
            }
            else {
                this.#strings[ style ] = "0 " + UNITS[ ZERO_UNIT ][ style ][ 1 ];
            }
        }

        return this.#strings[ style ];
    }

    toJSON () {
        return this.toString();
    }

    toNginx () {
        if ( this.#strings.nginx == null ) {
            const units = [];

            for ( const name of INTERVAL_UNIT_NAMES ) {
                const value = this.#units[ name ];

                if ( value.isZero || !UNITS[ name ].nginx ) continue;

                units.push( value.toString() + UNITS[ name ].nginx );
            }

            this.#strings.nginx = units.join( " " );
        }

        return this.#strings.nginx;
    }

    toDuration () {
        if ( !this.#duration ) {
            this.#duration = Temporal.Duration.from( this.#units );
        }

        return this.#duration;
    }

    toNanoseconds () {
        if ( this.#toUnits.nanoseconds == null ) {
            this.#toUnits.nanoseconds = ZERO;

            for ( const name of INTERVAL_UNIT_NAMES ) {
                this.#toUnits.nanoseconds = this.#toUnits.nanoseconds.add( this.#units[ name ].multiply( UNITS[ name ].nanoseconds ) );
            }
        }

        return this.#toUnits.nanoseconds;
    }

    toMicroseconds () {
        return this.#toUnit( "microseconds" );
    }

    toMilliseconds () {
        return this.#toUnit( "milliseconds" );
    }

    toSeconds () {
        return this.#toUnit( "seconds" );
    }

    toMinutes () {
        return this.#toUnit( "minutes" );
    }

    toHours () {
        return this.#toUnit( "hours" );
    }

    toDays () {
        return this.#toUnit( "days" );
    }

    toWeeks () {
        return this.#toUnit( "weeks" );
    }

    toMonths () {
        return this.#toUnit( "months" );
    }

    toQuarters () {
        return this.#toUnit( "quarters" );
    }

    toYears () {
        return this.#toUnit( "years" );
    }

    getFormatDurationParams () {
        if ( this.#formatDurationParams === undefined ) {
            const units = this.#getNormalizedUnits();

            this.#formatDurationParams = {};

            let found;

            for ( const name of INTERVAL_UNIT_NAMES ) {
                const value = units[ name ];

                if ( !value ) continue;

                found = true;

                this.#formatDurationParams[ name ] = Math.abs( Number( value ) );
            }

            if ( !found ) {
                this.#formatDurationParams = {
                    [ ZERO_UNIT ]: 0,
                };
            }

            // trim years to max. allowed value
            else if ( this.#formatDurationParams.years > 0xFFFF_FFFF ) {
                this.#formatDurationParams = {
                    "years": 0xFFFF_FFFF,
                };
            }
        }

        return this.#formatDurationParams;
    }

    getFormatRelativeDateParams () {
        if ( this.#formatRelativeDateParams === undefined ) {
            const units = this.#getNormalizedUnits();

            for ( const unit of INTERVAL_UNIT_NAMES ) {
                if ( !UNITS[ unit ].relativeDateParam ) continue;

                if ( units[ unit ] ) {
                    this.#formatRelativeDateParams = [ Number( units[ unit ] ), unit ];

                    break;
                }
            }

            // default
            this.#formatRelativeDateParams ||= [ 0, ZERO_UNIT ];
        }

        return this.#formatRelativeDateParams;
    }

    addDate ( date ) {
        date = new Date( date ?? Date.now() );

        if ( !this.#units.years.isZero ) date.setFullYear( date.getFullYear() + this.#units.years.number );
        if ( !this.#units.months.isZero ) date.setMonth( date.getMonth() + this.#units.months.number );
        if ( !this.#units.days.isZero ) date.setDate( date.getDate() + this.#units.days.number );
        if ( !this.#units.hours.isZero ) date.setHours( date.getHours() + this.#units.hours.number );
        if ( !this.#units.minutes.isZero ) date.setMinutes( date.getMinutes() + this.#units.minutes.number );
        if ( !this.#units.seconds.isZero ) date.setSeconds( date.getSeconds() + this.#units.seconds.number );
        if ( !this.#units.milliseconds.isZero ) date.setMilliseconds( date.getMilliseconds() + this.#units.milliseconds.number );

        return date;
    }

    subtractDate ( date ) {
        date = new Date( date ?? Date.now() );

        if ( !this.#units.years.isZero ) date.setFullYear( date.getFullYear() - this.#units.years.number );
        if ( !this.#units.months.isZero ) date.setMonth( date.getMonth() - this.#units.months.number );
        if ( !this.#units.days.isZero ) date.setDate( date.getDate() - this.#units.days.number );
        if ( !this.#units.hours.isZero ) date.setHours( date.getHours() - this.#units.hours.number );
        if ( !this.#units.minutes.isZero ) date.setMinutes( date.getMinutes() - this.#units.minutes.number );
        if ( !this.#units.seconds.isZero ) date.setSeconds( date.getSeconds() - this.#units.seconds.number );
        if ( !this.#units.milliseconds.isZero ) date.setMilliseconds( date.getMilliseconds() - this.#units.milliseconds.number );

        return date;
    }

    addInterval ( interval, unit ) {
        interval = this.constructor.new( interval, unit );

        const units = {};

        for ( const unit of INTERVAL_UNIT_NAMES ) {
            units[ unit ] = this[ unit ].add( interval[ unit ] );
        }

        return new this.constructor( units );
    }

    subtractInterval ( interval, unit ) {
        interval = this.constructor.new( interval, unit );

        const units = {};

        for ( const unit of INTERVAL_UNIT_NAMES ) {
            units[ unit ] = this[ unit ].subtract( interval[ unit ] );
        }

        return new this.constructor( units );
    }

    truncate ( unit ) {
        unit = ALIASES[ unit ]?.name;
        if ( !unit ) throw new Error( "Interval unit is not valid" );

        var interval = this.#trunc[ unit ];

        if ( !interval ) {
            const units = {};

            for ( const name of INTERVAL_UNIT_NAMES ) {
                units[ name ] = this.#units[ name ];

                if ( name === unit ) break;
            }

            interval = new this.constructor( units );

            this.#trunc[ unit ] = interval;
        }

        return interval;
    }

    compare ( interval, unit ) {
        interval = this.constructor.new( interval, unit );

        return this.toNanoseconds().compare( interval.toNanoseconds() );
    }

    eq ( interval ) {
        return this.compare( interval ) === 0;
    }

    ne ( interval ) {
        return this.compare( interval ) !== 0;
    }

    lt ( interval ) {
        return this.compare( interval ) < 0;
    }

    lte ( interval ) {
        return this.compare( interval ) <= 0;
    }

    gt ( interval ) {
        return this.compare( interval ) > 0;
    }

    gte ( interval ) {
        return this.compare( interval ) >= 0;
    }

    [ Symbol.for( "nodejs.util.inspect.custom" ) ] ( depth, options, inspect ) {
        const spec = this.toString( "short" );

        return `${ this.constructor.name }: ${ inspect( spec ) }`;
    }

    // private
    #parse ( interval, unit ) {

        // check unit
        unit = ALIASES[ unit ];
        if ( !unit ) throw new Error( "Interval unit is not valid" );

        // empty
        if ( !interval ) {
            return true;
        }

        // string
        else if ( typeof interval === "string" ) {

            // avoid an extra string allocation via replaceAll() when there
            // is nothing to strip, which is the common case for interval
            // strings such as "1d2h" or "5m"
            if ( interval.includes( " " ) ) interval = interval.replaceAll( " ", "" );

            interval = interval.trim();

            // check cache
            const units = CACHE.get( interval );

            // cached
            if ( units ) {
                this.#units = { ...units };

                return false;
            }

            // Temporal.Duration
            if ( interval.startsWith( "P" ) || interval.startsWith( "T" ) ) {
                this.#parseTemporalDuration( Temporal.Duration.from( interval ) );
            }

            // interval string
            else {
                const match = interval.split( INTERVAL_TOKEN_RE );

                for ( let n = 0; n < match.length; n += 3 ) {
                    if ( match[ n ] !== "" ) throw new Error( "Interval is not valid" );

                    if ( match[ n + 1 ] === undefined ) break;

                    const unit = ALIASES[ match[ n + 2 ] ];
                    if ( !unit ) throw new Error( "Interval is not valid" );

                    this.#addUnit( match[ n + 1 ], unit.name );
                }
            }

            this.#pendingCacheKey = interval;

            return true;
        }

        // number, bigint, Numeric
        else if ( typeof interval === "number" || typeof interval === "bigint" || interval instanceof Numeric ) {
            const cacheKey = `${ interval }${ unit.name }`;

            // check cache
            const units = CACHE.get( cacheKey );

            // cached
            if ( units ) {
                this.#units = { ...units };

                return false;
            }

            this.#addUnit( interval, unit.name );

            this.#pendingCacheKey = cacheKey;

            return true;
        }

        // Date, Temporal.Instant, Temporal.ZonedDateTime
        else if ( interval instanceof Date || interval instanceof Temporal.Instant || interval instanceof Temporal.ZonedDateTime ) {
            const units = compareDates( Date.now(), interval );

            for ( const unit of INTERVAL_UNIT_NAMES ) {
                this.#addUnit( units[ unit ], unit );
            }

            return true;
        }

        // Temporal.Duration
        else if ( interval instanceof Temporal.Duration ) {
            this.#parseTemporalDuration( interval );

            return true;
        }

        // object
        else if ( typeof interval === "object" ) {
            for ( const unit of INTERVAL_UNIT_NAMES ) {
                this.#addUnit( interval[ unit ], unit );
            }

            return true;
        }

        // invalid
        else {
            throw new Error( "Interval is not valid" );
        }
    }

    #parseTemporalDuration ( duration ) {
        for ( const unit of INTERVAL_UNIT_NAMES ) {
            this.#addUnit( duration[ unit ], unit );
        }

        if ( duration.weeks ) {
            this.#addUnit( duration.weeks, "weeks" );
        }
    }

    #addUnit ( value, unit ) {
        if ( !value ) return;

        value = Numeric.new( value, NUMERIC_OPTS );

        if ( value.isZero ) return;

        // integer
        if ( value.isInteger ) {
            if ( UNITS[ unit ].months ) {
                this.#units.months = this.#units.months.add( UNITS[ unit ].months.multiply( value ) );
            }
            else {
                this.#units.nanoseconds = this.#units.nanoseconds.add( UNITS[ unit ].nanoseconds.multiply( value ) );
            }
        }

        // fractional
        else {
            this.#addFractionalUnit( value, unit );
        }
    }

    #addFractionalUnit ( value, unit ) {
        if ( UNITS[ unit ].months ) {
            this.#addUnit( value.truncated, unit );

            if ( !value.isInteger ) {
                if ( unit === "months" ) {
                    this.#units.nanoseconds = this.#units.nanoseconds.add( UNITS[ unit ].nanoseconds.multiply( value.fractional ) );
                }
                else {
                    this.#addUnit( UNITS[ unit ].months.multiply( value.fractional ), "months" );
                }
            }
        }
        else {
            this.#units.nanoseconds = this.#units.nanoseconds.add( UNITS[ unit ].nanoseconds.multiply( value ) );
        }
    }

    #buildUnits () {
        for ( const name of INTERVAL_UNIT_NAMES ) {

            // months
            if ( UNITS[ name ].months ) {
                if ( name !== "months" ) {
                    this.#units[ name ] = this.#units.months.divide( UNITS[ name ].months ).truncated;
                    this.#units.months = this.#units.months.mod( UNITS[ name ].months );
                }
            }

            // nanoseconds
            else {
                if ( name !== "nanoseconds" ) {
                    this.#units[ name ] = this.#units.nanoseconds.divide( UNITS[ name ].nanoseconds ).truncated;
                    this.#units.nanoseconds = this.#units.nanoseconds.mod( UNITS[ name ].nanoseconds );
                }
            }
        }

        this.#units.nanoseconds = this.#units.nanoseconds.truncated;
    }

    #getNormalizedUnits () {
        if ( !this.#normalizedUnits ) {
            this.#normalizedUnits = {};

            let nanoseconds = this.toNanoseconds();

            for ( const unit of INTERVAL_UNIT_NAMES ) {
                const unitNanoseconds = UNITS[ unit ].nanoseconds,
                    absNanoseconds = nanoseconds.abs;

                if ( unitNanoseconds.gt( absNanoseconds ) ) {
                    this.#normalizedUnits[ unit ] = 0n;
                }
                else {
                    this.#normalizedUnits[ unit ] = nanoseconds.divide( unitNanoseconds ).bigint;

                    nanoseconds = nanoseconds.mod( unitNanoseconds );
                }
            }
        }

        return this.#normalizedUnits;
    }

    #toUnit ( unit ) {
        this.#toUnits[ unit ] ??= this.toNanoseconds().divide( UNITS[ unit ].nanoseconds );

        return this.#toUnits[ unit ];
    }
}
