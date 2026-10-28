// NOTE: https://www.man7.org/linux/man-pages/man5/crontab.5.html

const PRESETS = {
    "@yearly": "0 0 1 1 *",
    "@monthly": "0 0 1 * *",
    "@weekly": "0 0 * * 0",
    "@daily": "0 0 * * *",
    "@hourly": "0 * * * *",
    "@minutely": "* * * * *",
    "@secondly": "* * * * * *",
    "@weekdays": "0 0 * * 1-5",
    "@weekends": "0 0 * * 0,6",
};

// max. years to look ahead, protects from endless search
const MAX_SEARCH_YEARS = 50;

// february is always 29 days, in order to allow leap years
const DAYS_IN_MONTH = [ 0, 31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31 ];

const FIELDS = [
    {
        "name": "seconds",
        "min": 0,
        "max": 59,
    },
    {
        "name": "minutes",
        "min": 0,
        "max": 59,
    },
    {
        "name": "hours",
        "min": 0,
        "max": 23,
    },
    {
        "name": "days",
        "min": 1,
        "max": 31,
    },
    {
        "name": "months",
        "min": 1,
        "max": 12,
        "names": {
            "jan": 1,
            "feb": 2,
            "mar": 3,
            "apr": 4,
            "may": 5,
            "jun": 6,
            "jul": 7,
            "aug": 8,
            "sep": 9,
            "oct": 10,
            "nov": 11,
            "dec": 12,
        },
    },
    {
        "name": "daysOfWeek",
        "min": 0,
        "max": 6,

        // 7 is allowed as an alias of 0 (sunday)
        "maxInput": 7,
        "names": {
            "sun": 0,
            "mon": 1,
            "tue": 2,
            "wed": 3,
            "thu": 4,
            "fri": 5,
            "sat": 6,
        },
    },
];

export default class CronExpression {
    #expression;
    #timezone;
    #ignoreSeconds;
    #hasSeconds;
    #fields = {};

    constructor ( expression, { timezone, ignoreSeconds } = {} ) {
        if ( typeof expression !== "string" ) throw new TypeError( "Cron expression must be a string" );

        this.#expression = expression;
        this.#ignoreSeconds = !!ignoreSeconds;

        if ( timezone ) {
            this.#timezone = Temporal.Now.zonedDateTimeISO( timezone ).timeZoneId;
        }
        else {
            this.#timezone = Temporal.Now.timeZoneId();
        }

        expression = expression.trim();

        // resolve presets
        if ( Object.hasOwn( PRESETS, expression ) ) expression = PRESETS[ expression ];

        const fields = expression.split( /\s+/v );

        if ( fields.length < 5 || fields.length > 6 ) {
            throw new Error( `Cron expression is not valid: ${ expression }` );
        }

        if ( fields.length === 6 ) {
            if ( this.#ignoreSeconds ) {
                fields.shift();
            }
        }

        if ( fields.length === 5 ) {
            this.#hasSeconds = false;
        }
        else {
            this.#hasSeconds = true;
        }

        for ( let n = 0; n < fields.length; n++ ) {
            this.#parseField( fields[ n ], FIELDS[ n + ( this.#hasSeconds
                ? 0
                : 1 ) ] );
        }

        this.#validateDays();
    }

    // static
    static isValid ( value, options ) {
        try {
            new this( value, options );

            return true;
        }
        catch {
            return false;
        }
    }

    // properties
    get timezone () {
        return this.#timezone;
    }

    get ignoreSeconds () {
        return this.#ignoreSeconds;
    }

    get hasSeconds () {
        return this.#hasSeconds;
    }

    // public
    toString () {
        return this.#expression;
    }

    toJSON () {
        return this.toString();
    }

    getSchedule ( { fromDate, maxItems = 1 } = {} ) {
        if ( fromDate ) {
            fromDate = fromDate.toTemporalInstant().toZonedDateTimeISO( this.#timezone );
        }
        else {
            fromDate = Temporal.Now.instant().toZonedDateTimeISO( this.#timezone );
        }

        if ( this.#hasSeconds ) {

            // round to the seconds
            fromDate = fromDate.round( {
                "smallestUnit": "second",
                "roundingMode": "ceil",
            } );
        }
        else {

            // round to the minutes
            fromDate = fromDate.round( {
                "smallestUnit": "minute",
                "roundingMode": "ceil",
            } );
        }

        const dates = [];

        for ( let n = 0; n < maxItems; n++ ) {
            fromDate = this.#getNextDate( fromDate );

            dates.push( new Date( fromDate.epochMilliseconds ) );

            if ( this.#hasSeconds ) {
                fromDate = fromDate.add( { "seconds": 1 } );
            }
            else {
                fromDate = fromDate.add( { "minutes": 1 } );
            }
        }

        return dates;
    }

    // private
    #parseField ( fieldValue, field ) {
        var restricted = false;

        const values = new Array( field.max + 1 ),
            maxInput = field.maxInput ?? field.max;

        for ( const range of fieldValue.split( "," ) ) {
            const parts = range.split( "/" );

            if ( parts.length > 2 ) this.#throwError( fieldValue, field );

            const body = parts[ 0 ],
                hasStep = parts.length === 2;

            let step = 1,
                start,
                end = null,
                random = false;

            if ( hasStep ) {
                if ( !/^\d+$/v.test( parts[ 1 ] ) ) this.#throwError( fieldValue, field );

                step = +parts[ 1 ];

                if ( !step ) this.#throwError( fieldValue, field );
            }

            // random value
            if ( body.includes( "~" ) ) {
                const bounds = body.split( "~" );

                if ( bounds.length > 2 || bounds.includes( "*" ) ) this.#throwError( fieldValue, field );

                random = true;
                restricted = true;

                start = bounds[ 0 ]
                    ? this.#parseValue( bounds[ 0 ], fieldValue, field )
                    : field.min;

                end = bounds[ 1 ]
                    ? this.#parseValue( bounds[ 1 ], fieldValue, field )
                    : field.max;
            }

            // range
            else {
                const bounds = body.split( "-" );

                if ( bounds.length > 2 || !bounds[ 0 ] ) this.#throwError( fieldValue, field );

                if ( bounds[ 0 ] === "*" ) {
                    if ( bounds.length > 1 ) this.#throwError( fieldValue, field );

                    start = field.min;
                    end = field.max;
                }

                // field is restricted
                else {
                    restricted = true;

                    start = this.#parseValue( bounds[ 0 ], fieldValue, field );

                    if ( bounds.length === 2 ) {
                        if ( !bounds[ 1 ] ) this.#throwError( fieldValue, field );

                        end = this.#parseValue( bounds[ 1 ], fieldValue, field );
                    }
                }
            }

            if ( start < field.min || start > maxInput ) this.#throwError( fieldValue, field );

            if ( end != null ) {
                if ( end > maxInput || end < start ) this.#throwError( fieldValue, field );

                if ( hasStep && step > end - start ) this.#throwError( fieldValue, field );

                if ( random ) {
                    start = this.#getRandomValue( start, end );

                    end = null;
                }
            }

            // single value
            if ( end == null ) {
                if ( hasStep ) this.#throwError( fieldValue, field );

                // 7 is mapped to 0 for daysOfWeek
                values[ start % values.length ] = true;
            }

            // range
            else {
                for ( let n = start; n <= end; n += step ) {

                    // 7 is mapped to 0 for daysOfWeek
                    values[ n % values.length ] = true;
                }
            }
        }

        // next[ value ] - the nearest allowed value >= value, or -1
        const next = new Array( values.length + 1 );

        next[ values.length ] = -1;

        for ( let n = values.length - 1; n >= 0; n-- ) {
            next[ n ] = values[ n ]
                ? n
                : next[ n + 1 ];
        }

        this.#fields[ field.name ] = {
            restricted,
            values,
            next,
        };
    }

    #parseValue ( value, fieldValue, field ) {
        const name = value.toLowerCase();

        if ( field.names && Object.hasOwn( field.names, name ) ) return field.names[ name ];

        if ( !/^\d+$/v.test( value ) ) this.#throwError( fieldValue, field );

        return +value;
    }

    // there must be at least one existing day in the allowed months
    #validateDays () {
        const { days, daysOfWeek, months } = this.#fields;

        // days OR days of week are matched, days of week can match any day
        if ( days.restricted && daysOfWeek.restricted ) return;

        const firstDay = days.next[ 1 ];

        for ( let month = 1; month <= 12; month++ ) {
            if ( months.values[ month ] && firstDay <= DAYS_IN_MONTH[ month ] ) return;
        }

        throw new Error( `Cron expression is not valid: ${ this.#expression }` );
    }

    #getRandomValue ( min, max ) {
        if ( min === max ) return min;

        return Math.floor( Math.random() * ( max - min + 1 ) ) + min;
    }

    #throwError ( fieldValue, field ) {
        throw new Error( `Cron expression field ${ field.name } is not valid: ${ fieldValue }` );
    }

    #getNextDate ( date ) {
        const { months, days, daysOfWeek, hours, minutes, seconds } = this.#fields,
            maxYear = date.year + MAX_SEARCH_YEARS,

            // if days are restricted and days of week are restricted
            // match days OR days of week
            matchAnyDay = days.restricted && daysOfWeek.restricted,

            // wildcard hours or minutes (for example "*/15 * * * *") run continuously,
            // fixed time jobs (for example "30 1 * * *") are not repeated in the hour,
            // that is repeated, when the clocks are turned back
            continuous = !hours.restricted || !minutes.restricted;

        while ( true ) {
            if ( date.year > maxYear ) throw new Error( "Cron unable to find next date" );

            // current month is not allowed
            if ( !months.values[ date.month ] ) {
                const month = months.next[ date.month ];

                // next allowed month is in the next year
                if ( month === -1 ) {
                    date = date.add( { "years": 1 } ).with( { "month": months.next[ 1 ], "day": 1 } ).startOfDay();
                }
                else {
                    date = date.with( { month, "day": 1 } ).startOfDay();
                }

                continue;
            }

            // days are checked one by one, because months have different length
            const dayAllowed = days.values[ date.day ],
                dayOfWeekAllowed = daysOfWeek.values[ date.dayOfWeek === 7
                    ? 0
                    : date.dayOfWeek ];

            if ( matchAnyDay
                ? !dayAllowed && !dayOfWeekAllowed
                : !dayAllowed || !dayOfWeekAllowed ) {
                date = date.add( { "days": 1 } ).startOfDay();

                continue;
            }

            // current hour is not allowed
            if ( !hours.values[ date.hour ] ) {
                const hour = hours.next[ date.hour ];

                // next allowed hour is tomorrow
                if ( hour === -1 ) {
                    date = date.add( { "days": 1 } ).startOfDay();
                }
                else {
                    date = date.with( { hour, "minute": 0, "second": 0 } );
                }

                continue;
            }

            // current minute is not allowed
            if ( !minutes.values[ date.minute ] ) {
                const minute = minutes.next[ date.minute ];

                // next allowed minute is in the next hour
                if ( minute === -1 ) {
                    if ( continuous ) {
                        date = date.add( { "hours": 1 } ).with( { "minute": 0, "second": 0 } );
                    }
                    else {
                        date = date.toPlainDateTime().add( { "hours": 1 } ).with( { "minute": 0, "second": 0 } ).toZonedDateTime( date.timeZoneId );
                    }
                }
                else {
                    date = date.with( { minute, "second": 0 } );
                }

                continue;
            }

            // current second is not allowed
            if ( seconds && !seconds.values[ date.second ] ) {
                const second = seconds.next[ date.second ];

                // next allowed second is in the next minute
                if ( second === -1 ) {
                    date = date.add( { "minutes": 1 } ).with( { "second": 0 } );
                }
                else {
                    date = date.with( { second } );
                }

                continue;
            }

            // found date, which is match all conditions
            break;
        }

        return date;
    }
}
