import "#lib/temporal";
import CacheLru from "#lib/cache/lru";
import math from "#lib/math";
import Numeric from "#lib/numeric";

const UNITS = {
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
    DEFAULT_UNIT = "milliseconds",
    ALIASES = {},
    STYLES = {
        "long": " ",
        "short": " ",
        "narrow": "",
    };

// create aliases
for ( const name in UNITS ) {
    UNITS[ name ].name = name;

    ALIASES[ name ] = UNITS[ name ];

    for ( const alias of UNITS[ name ].long || [] ) {
        ALIASES[ alias ] = UNITS[ name ];
    }

    for ( const alias of UNITS[ name ].short || [] ) {
        ALIASES[ alias ] = UNITS[ name ];
    }

    for ( const alias of UNITS[ name ].narrow || [] ) {
        ALIASES[ alias ] = UNITS[ name ];
    }

    for ( const alias of UNITS[ name ].aliases || [] ) {
        ALIASES[ alias ] = UNITS[ name ];
    }
}

var CACHE;

function compareDates ( date1, date2 ) {
    date1 = new Date( date1 );
    date2 = new Date( date2 );

    const units = {
        "years": date2.getFullYear() - date1.getFullYear(),
        "months": date2.getMonth() - date1.getMonth(),
        "days": date2.getDate() - date1.getDate(),
        "hours": date2.getHours() - date1.getHours(),
        "minutes": date2.getMinutes() - date1.getMinutes(),
        "seconds": date2.getSeconds() - date1.getSeconds(),
        "milliseconds": date2.getMilliseconds() - date1.getMilliseconds(),
    };

    return units;
}

export default class Interval {
    #units = {
        "years": 0,
        "months": 0,
        "days": 0,
        "hours": 0,
        "minutes": 0,
        "seconds": 0,
        "milliseconds": 0,
        "microseconds": 0,
        "nanoseconds": 0n,
    };
    #strings = {};
    #toUnits = {};
    #trunc = {};
    #temporalDuration;
    #formatDurationParams;
    #formatRelativeDateParams;
    #normalizedUnits;

    constructor ( interval, unit = "milliseconds" ) {
        this.#parse( interval, unit );

        this.#buildUnits();
    }

    // static
    static new ( interval, unit ) {
        if ( interval instanceof this ) return interval;

        return new this( interval, unit );
    }

    static fromDates ( date1, date2 ) {
        return new this( compareDates( date1, date2 ) );
    }

    static get comparator () {
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

    get temporalDuration () {
        this.#temporalDuration = new Temporal.Duration(
            this.#units.years,
            this.#units.months,
            null, // weeks
            this.#units.days,
            this.#units.hours,
            this.#units.minutes,
            this.#units.seconds,
            this.#units.milliseconds,
            this.#units.microseconds,
            this.#units.nanoseconds
        );

        return this.#temporalDuration;
    }

    // public
    toString ( style = "long" ) {
        if ( STYLES[ style ] == null ) {
            style = "long";
        }

        if ( this.#strings[ style ] == null ) {
            const units = [];

            for ( const [ name, value ] of Object.entries( this.#units ) ) {
                if ( !value ) continue;

                units.push( value + STYLES[ style ] + ( Math.abs( value ) === 1
                    ? UNITS[ name ][ style ][ 0 ]
                    : UNITS[ name ][ style ][ 1 ] ) );
            }

            if ( units.length ) {
                this.#strings[ style ] = units.join( " " );
            }
            else {
                this.#strings[ style ] = "0 " + DEFAULT_UNIT;
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

            for ( const [ name, value ] of Object.entries( this.#units ) ) {
                if ( !value || !UNITS[ name ].nginx ) continue;

                units.push( value + UNITS[ name ].nginx );
            }

            this.#strings.nginx = units.join( " " );
        }

        return this.#strings.nginx;
    }

    toNanoseconds () {
        if ( this.#toUnits.nanoseconds == null ) {
            this.#toUnits.nanoseconds = Numeric( 0 );

            for ( const name in this.#units ) {
                this.#toUnits.nanoseconds = this.#toUnits.nanoseconds.add( UNITS[ name ].nanoseconds * BigInt( this.#units[ name ] ) );
            }
        }

        return this.#toUnits.nanoseconds;
    }

    toMicroseconds ( scale ) {
        return this.#toUnit( "microseconds", scale );
    }

    toMilliseconds ( scale ) {
        return this.#toUnit( "milliseconds", scale );
    }

    toSeconds ( scale ) {
        return this.#toUnit( "seconds", scale );
    }

    toMinutes ( scale ) {
        return this.#toUnit( "minutes", scale );
    }

    toHours ( scale ) {
        return this.#toUnit( "hours", scale );
    }

    toDays ( scale ) {
        return this.#toUnit( "days", scale );
    }

    toWeeks ( scale ) {
        return this.#toUnit( "weeks", scale );
    }

    toMonths ( scale ) {
        return this.#toUnit( "months", scale );
    }

    toQuarters ( scale ) {
        return this.#toUnit( "quarters", scale );
    }

    toYears ( scale ) {
        return this.#toUnit( "years", scale );
    }

    getFormatDurationParams () {
        if ( !this.#formatDurationParams ) {
            const units = this.#getNormalizedUnits();

            this.#formatDurationParams = {};

            let found;

            for ( const [ name, value ] of Object.entries( units ) ) {
                if ( !value ) continue;

                found = true;

                this.#formatDurationParams[ name ] = value;
            }

            if ( !found ) this.#formatDurationParams[ DEFAULT_UNIT ] = 0;
        }

        return this.#formatDurationParams;
    }

    getFormatRelativeDateParams () {
        if ( !this.#formatRelativeDateParams ) {
            const units = this.#getNormalizedUnits();

            for ( const unit in units ) {
                if ( !UNITS[ unit ].relativeDateParam ) continue;

                if ( units[ unit ] ) {
                    this.#formatRelativeDateParams = [ units[ unit ], unit ];

                    break;
                }
            }

            // default
            this.#formatRelativeDateParams ||= [ 0, "seconds" ];
        }

        return this.#formatRelativeDateParams;
    }

    addDate ( date ) {
        date = new Date( date ?? Date.now() );

        if ( this.#units.years ) date.setFullYear( date.getFullYear() + this.#units.years );
        if ( this.#units.months ) date.setMonth( date.getMonth() + this.#units.months );
        if ( this.#units.days ) date.setDate( date.getDate() + this.#units.days );
        if ( this.#units.hours ) date.setHours( date.getHours() + this.#units.hours );
        if ( this.#units.minutes ) date.setMinutes( date.getMinutes() + this.#units.minutes );
        if ( this.#units.seconds ) date.setSeconds( date.getSeconds() + this.#units.seconds );
        if ( this.#units.milliseconds ) date.setMilliseconds( date.getMilliseconds() + this.#units.milliseconds );

        return date;
    }

    subtractDate ( date ) {
        date = new Date( date ?? Date.now() );

        if ( this.#units.years ) date.setFullYear( date.getFullYear() - this.#units.years );
        if ( this.#units.months ) date.setMonth( date.getMonth() - this.#units.months );
        if ( this.#units.days ) date.setDate( date.getDate() - this.#units.days );
        if ( this.#units.hours ) date.setHours( date.getHours() - this.#units.hours );
        if ( this.#units.minutes ) date.setMinutes( date.getMinutes() - this.#units.minutes );
        if ( this.#units.seconds ) date.setSeconds( date.getSeconds() - this.#units.seconds );
        if ( this.#units.milliseconds ) date.setMilliseconds( date.getMilliseconds() - this.#units.milliseconds );

        return date;
    }

    addInterval ( interval, unit ) {
        interval = this.constructor.new( interval, unit );

        const units = {};

        for ( const unit in this.#units ) {
            units[ unit ] = this[ unit ] + interval[ unit ];
        }

        return new this.constructor( units );
    }

    subtractInterval ( interval, unit ) {
        interval = this.constructor.new( interval, unit );

        const units = {};

        for ( const unit in this.#units ) {
            units[ unit ] = this[ unit ] - interval[ unit ];
        }

        return new this.constructor( units );
    }

    trunc ( unit ) {
        unit = ALIASES[ unit ]?.name;
        if ( !unit ) throw new Error( "Interval unit is not valid" );

        var interval = this.#trunc[ unit ];

        if ( !interval ) {
            const units = {};

            for ( const name in this.#units ) {
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

    // private
    #parse ( interval, unit ) {

        // check unit
        unit = ALIASES[ unit ];
        if ( !unit ) throw new Error( "Interval unit is not valid" );

        // empty
        if ( !interval ) {
            return;
        }

        // string
        else if ( typeof interval === "string" ) {
            interval = interval.replaceAll( " ", "" ).trim();

            // Temporal.Duration
            if ( interval.startsWith( "P" ) || interval.startsWith( "T" ) ) {
                this.#parseTemporalDuration( Temporal.Duration.from( interval ) );
            }

            // string
            else {
                CACHE ??= new CacheLru( {
                    "maxSize": 1000,
                } );

                const units = CACHE.get( interval );

                if ( units ) {
                    this.#units = { ...units };
                }
                else {
                    const match = interval.split( /([+-]?\d+(?:\.\d+)?)([A-Za-z]+)/ );

                    for ( let n = 0; n < match.length; n += 3 ) {
                        if ( match[ n ] !== "" ) throw new Error( "Interval is not valid" );

                        if ( match[ n + 1 ] === undefined ) break;

                        const unit = ALIASES[ match[ n + 2 ] ];
                        if ( !unit ) throw new Error( "Interval is not valid" );

                        this.#addUnit( match[ n + 1 ], unit.name );
                    }

                    CACHE.set( interval, { ...this.#units } );
                }
            }
        }

        // number, bigint
        else if ( typeof interval === "number" || typeof interval === "bigint" ) {
            this.#addUnit( interval, unit.name );
        }

        // date
        else if ( interval instanceof Date ) {
            const units = compareDates( Date.now(), interval );

            for ( const unit in this.#units ) {
                this.#addUnit( units[ unit ], unit );
            }
        }

        // Temporal.Duration
        else if ( interval instanceof Temporal.Duration ) {
            this.#parseTemporalDuration( interval );
        }

        // object
        else if ( typeof interval === "object" ) {
            for ( const unit in this.#units ) {
                this.#addUnit( interval[ unit ], unit );
            }
        }

        // invalid
        else {
            throw new Error( "Interval is not valid" );
        }
    }

    #parseTemporalDuration ( duration ) {
        for ( const unit in this.#units ) {
            this.#addUnit( duration[ unit ], unit );
        }

        if ( duration.weeks ) {
            this.#addUnit( duration.weeks, "weeks" );
        }
    }

    #addUnit ( value, unit ) {
        if ( !value ) return;

        value = Numeric( value );

        if ( value.isZero ) return;

        // integer
        if ( value.isInteger ) {
            if ( UNITS[ unit ].months ) {
                this.#units.months += value.number * UNITS[ unit ].months;
            }
            else {
                this.#units.nanoseconds += UNITS[ unit ].nanoseconds * value.bigint;
            }
        }

        // fractional
        else {
            this.#addFractionalUnit( value, unit );
        }
    }

    #addFractionalUnit ( value, unit ) {
        if ( UNITS[ unit ].months ) {
            this.#addUnit( value.integer, unit );

            if ( !value.decimal.isZero ) {
                if ( unit === "months" ) {
                    this.#units.nanoseconds += value.decimal.multiply( UNITS[ unit ].nanoseconds ).bigint;
                }
                else {
                    this.#addUnit( value.decimal.multiply( UNITS[ unit ].months ), "months" );
                }
            }
        }
        else {
            this.#units.nanoseconds += value.multiply( UNITS[ unit ].nanoseconds ).bigint;
        }
    }

    #buildUnits () {
        for ( const name of Object.keys( this.#units ) ) {

            // months
            if ( UNITS[ name ].months ) {
                if ( name !== "months" ) {
                    this.#units[ name ] = Math.trunc( this.#units.months / UNITS[ name ].months );
                    this.#units.months = this.#units.months % UNITS[ name ].months;
                }
            }

            // nanoseconds
            else {
                if ( name === "nanoseconds" ) {
                    this.#units[ name ] = Number( this.#units.nanoseconds );
                }
                else {
                    this.#units[ name ] = Number( this.#units.nanoseconds / UNITS[ name ].nanoseconds );
                    this.#units.nanoseconds = this.#units.nanoseconds % UNITS[ name ].nanoseconds;
                }
            }
        }
    }

    #getNormalizedUnits () {
        if ( !this.#normalizedUnits ) {
            this.#normalizedUnits = {};

            let nanoseconds = this.toNanoseconds().bigint;

            for ( const unit in this.#units ) {
                if ( UNITS[ unit ].nanoseconds > math.abs( nanoseconds ) ) {
                    this.#normalizedUnits[ unit ] = 0;
                }
                else {
                    this.#normalizedUnits[ unit ] = Number( nanoseconds / UNITS[ unit ].nanoseconds );

                    nanoseconds = nanoseconds % UNITS[ unit ].nanoseconds;
                }
            }
        }

        return this.#normalizedUnits;
    }

    #toUnit ( unit, scale ) {
        const id = unit + "/" + ( scale || 0 );

        this.#toUnits[ id ] ??= this.toNanoseconds().divide( UNITS[ unit ].nanoseconds ).round( scale ).number;

        return this.#toUnits[ id ];
    }
}
