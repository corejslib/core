import CacheLru from "#lib/cache/lru";
import { parseInstant } from "#lib/dates";
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
            "duration": "Y",
            "relativeDateParam": true,
        },
        "quarters": {
            "long": [ "quarter", "quarters" ],
            "short": [ "qtr", "qtrs" ],
            "narrow": [ "q", "q" ],
            "nanoseconds": ( 1_000_000n * 1000n * 60n * 60n * 24n * 365n ) / 4n, // 1 / 4 year
            "months": 3,
            "nginx": null,
            "duration": null,
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
            "duration": "M",
            "relativeDateParam": true,
        },
        "weeks": {
            "long": [ "week", "weeks" ],
            "short": [ "wk", "wks" ],
            "narrow": [ "w", "w" ],
            "nanoseconds": 1_000_000n * 1000n * 60n * 60n * 24n * 7n, // 7 days
            "nginx": "w",
            "duration": null,
            "relativeDateParam": true,
        },
        "days": {
            "long": [ "day", "days" ],
            "short": [ "day", "days" ],
            "narrow": [ "d", "d" ],
            "nanoseconds": 1_000_000n * 1000n * 60n * 60n * 24n,
            "nginx": "d",
            "duration": "D",
            "relativeDateParam": true,
        },
        "hours": {
            "long": [ "hour", "hours" ],
            "short": [ "hr", "hrs" ],
            "narrow": [ "h", "h" ],
            "nanoseconds": 1_000_000n * 1000n * 60n * 60n,
            "nginx": "h",
            "duration": "H",
            "relativeDateParam": true,
        },
        "minutes": {
            "long": [ "minute", "minutes" ],
            "short": [ "min", "mins" ],
            "narrow": [ "m", "m" ],
            "nanoseconds": 1_000_000n * 1000n * 60n,
            "nginx": "m",
            "duration": "M",
            "relativeDateParam": true,
        },
        "seconds": {
            "long": [ "second", "seconds" ],
            "short": [ "sec", "secs" ],
            "narrow": [ "s", "s" ],
            "nanoseconds": 1_000_000n * 1000n,
            "nginx": "s",
            "duration": "S",
            "relativeDateParam": true,
        },
        "milliseconds": {
            "long": [ "millisecond", "milliseconds" ],
            "short": [ "ms", "ms" ],
            "narrow": [ "ms", "ms" ],
            "nanoseconds": 1_000_000n,
            "nginx": "ms",
            "duration": null,
            "relativeDateParam": false,
        },
        "microseconds": {
            "long": [ "microsecond", "microseconds" ],
            "short": [ "μs", "μs" ],
            "narrow": [ "μs", "μs" ],
            "aliases": [ "us" ],
            "nanoseconds": 1000n,
            "nginx": null,
            "duration": null,
            "relativeDateParam": false,
        },
        "nanoseconds": {
            "long": [ "nanosecond", "nanoseconds" ],
            "short": [ "ns", "ns" ],
            "narrow": [ "ns", "ns" ],
            "nanoseconds": 1n,
            "nginx": null,
            "duration": null,
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
    INTERVAL_TOKEN_RE = /([+\-]?\d+(?:\.\d+)?)([A-Za-zμ]+)/v,
    DURATION_START_RE = /^[+\-]?P/iv,
    DURATION_UNIT_NAMES = [ "years", "months", "weeks", "days", "hours", "minutes", "seconds" ],
    DURATION_NUMBER = String.raw`[+\-]?\d+(?:[.,]\d+)?`,
    DURATION_RE = new RegExp(
        [
            String.raw`^(?<sign>[+\-])?P`,
            String.raw`(?:(?<years>${ DURATION_NUMBER })Y)?`,
            String.raw`(?:(?<months>${ DURATION_NUMBER })M)?`,
            String.raw`(?:(?<weeks>${ DURATION_NUMBER })W)?`,
            String.raw`(?:(?<days>${ DURATION_NUMBER })D)?`,

            // "T" must be followed by at least one time component
            String.raw`(?:T(?=[+\-]?\d)`,
            String.raw`(?:(?<hours>${ DURATION_NUMBER })H)?`,
            String.raw`(?:(?<minutes>${ DURATION_NUMBER })M)?`,
            String.raw`(?:(?<seconds>${ DURATION_NUMBER })S)?`,
            ")?",
            "$",
        ].join( "" ),
        "iv"
    );

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
    if ( fromDate ) {
        fromDate = parseInstant( fromDate );
    }
    else {
        fromDate = Temporal.Now.instant();
    }

    if ( toDate ) {
        toDate = parseInstant( toDate );
    }
    else {
        toDate = Temporal.Now.instant();
    }

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

    toDurationString () {
        if ( this.#strings.duration == null ) {
            const parts = [];

            // fractional part of the seconds (milli-, micro-, nanoseconds)
            const signedFraction = this.#units.milliseconds.bigint * 1_000_000n + this.#units.microseconds.bigint * 1000n + this.#units.nanoseconds.bigint,
                fractionNegative = signedFraction < 0n,
                fraction = fractionNegative
                    ? -signedFraction
                    : signedFraction;

            for ( const name of INTERVAL_UNIT_NAMES ) {
                const designator = UNITS[ name ].duration;

                if ( !designator ) continue;

                const value = this.#units[ name ];

                let string = value.isZero
                        ? null
                        : value.abs.toString(),
                    negative = value.isNegative;

                if ( name === "seconds" && fraction ) {
                    string = ( string ?? "0" ) + "." + fraction.toString().padStart( 9, "0" ).replace( /0+$/v, "" );

                    negative ||= fractionNegative;
                }

                if ( string == null ) continue;

                parts.push( {
                    negative,
                    "text": string + designator,

                    // units smaller than a day go after "T"
                    "time": UNITS.days.nanoseconds.gt( UNITS[ name ].nanoseconds ),
                } );
            }

            if ( !parts.length ) {
                this.#strings.duration = "PT0S";
            }
            else {
                const negatives = parts.filter( part => part.negative ).length,
                    allNegative = negatives === parts.length,
                    mixed = negatives > 0 && !allNegative;

                let date = "",
                    time = "";

                for ( const part of parts ) {
                    const text = ( mixed && part.negative
                        ? "-"
                        : "" ) + part.text;

                    if ( part.time ) {
                        time += text;
                    }
                    else {
                        date += text;
                    }
                }

                this.#strings.duration = ( allNegative
                    ? "-"
                    : "" ) + "P" + date + ( time
                    ? "T" + time
                    : "" );
            }
        }

        return this.#strings.duration;
    }

    toTemporalDuration () {
        if ( !this.#duration ) {
            this.#duration = Temporal.Duration.from( this.toDurationString() );
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
        let zoned = date
            ? Temporal.Instant.from( date ).toZonedDateTimeISO( "UTC" )
            : Temporal.Now.zonedDateTimeISO( "UTC" );

        if ( !this.#units.years.isZero ) {
            zoned = zoned.add( { "years": this.#units.years.number } );
        }

        if ( !this.#units.months.isZero ) {
            zoned = zoned.add( { "months": this.#units.months.number } );
        }

        if ( !this.#units.days.isZero ) {
            zoned = zoned.add( { "days": this.#units.days.number } );
        }

        if ( !this.#units.hours.isZero ) {
            zoned = zoned.add( { "hours": this.#units.hours.number } );
        }

        if ( !this.#units.minutes.isZero ) {
            zoned = zoned.add( { "minutes": this.#units.minutes.number } );
        }

        if ( !this.#units.seconds.isZero ) {
            zoned = zoned.add( { "seconds": this.#units.seconds.number } );
        }

        if ( !this.#units.milliseconds.isZero ) {
            zoned = zoned.add( { "milliseconds": this.#units.milliseconds.number } );
        }

        return zoned.toInstant();
    }

    subtractDate ( date ) {
        let zoned = date
            ? Temporal.Instant.from( date ).toZonedDateTimeISO( "UTC" )
            : Temporal.Now.zonedDateTimeISO( "UTC" );

        if ( !this.#units.years.isZero ) {
            zoned = zoned.subtract( { "years": this.#units.years.number } );
        }

        if ( !this.#units.months.isZero ) {
            zoned = zoned.subtract( { "months": this.#units.months.number } );
        }

        if ( !this.#units.days.isZero ) {
            zoned = zoned.subtract( { "days": this.#units.days.number } );
        }

        if ( !this.#units.hours.isZero ) {
            zoned = zoned.subtract( { "hours": this.#units.hours.number } );
        }

        if ( !this.#units.minutes.isZero ) {
            zoned = zoned.subtract( { "minutes": this.#units.minutes.number } );
        }

        if ( !this.#units.seconds.isZero ) {
            zoned = zoned.subtract( { "seconds": this.#units.seconds.number } );
        }

        if ( !this.#units.milliseconds.isZero ) {
            zoned = zoned.subtract( { "milliseconds": this.#units.milliseconds.number } );
        }

        return zoned.toInstant();
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

        // Temporal.Duration
        if ( interval instanceof Temporal.Duration ) {
            interval = interval.toString();
        }

        // empty
        if ( !interval ) {
            return true;
        }

        // string
        else if ( typeof interval === "string" ) {
            if ( interval.includes( " " ) ) interval = interval.replaceAll( " ", "" );

            interval = interval.trim();

            // check cache
            const units = CACHE.get( interval );

            // cached
            if ( units ) {
                this.#units = { ...units };

                return false;
            }

            // duration string
            if ( DURATION_START_RE.test( interval ) ) {
                this.#parseDuration( interval );
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

        // Temporal.Instant, Temporal.ZonedDateTime
        else if ( interval instanceof Temporal.Instant || interval instanceof Temporal.ZonedDateTime ) {
            const units = compareDates( Temporal.Now.instant(), interval );

            for ( const unit of INTERVAL_UNIT_NAMES ) {
                this.#addUnit( units[ unit ], unit );
            }

            return true;
        }

        // object
        else if ( typeof interval === "object" ) {
            for ( const unit of INTERVAL_UNIT_NAMES ) {
                this.#addUnit( interval[ unit ], unit );
            }

            return true;
        }

        // invalid data type
        throw new Error( "Interval is not valid" );
    }

    #parseDuration ( interval ) {
        const match = DURATION_RE.exec( interval );

        if ( !match ) throw new Error( "Interval is not valid" );

        const negative = match.groups.sign === "-";

        let found = false;

        for ( const name of DURATION_UNIT_NAMES ) {
            const text = match.groups[ name ];

            if ( text === undefined ) continue;

            found = true;

            const first = text[ 0 ],
                componentNegative = first === "-",
                digits = ( componentNegative || first === "+"
                    ? text.slice( 1 )
                    : text ).replace( ",", "." );

            // the sign of the whole string and the sign of the component cancel each other out
            this.#addUnit( ( negative !== componentNegative
                ? "-"
                : "" ) + digits, name );
        }

        // "P" without any components
        if ( !found ) throw new Error( "Interval is not valid" );
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
