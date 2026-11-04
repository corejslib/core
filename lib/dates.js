export const MONTHS = {
        "January": 1,
        "February": 2,
        "March": 3,
        "April": 4,
        "May": 5,
        "June": 6,
        "July": 7,
        "August": 8,
        "September": 9,
        "October": 10,
        "November": 11,
        "December": 12,
    },
    MONTHS3 = Object.fromEntries( Object.entries( MONTHS ).map( ( [ month, index ] ) => [ month.slice( 0, 3 ), index ] ) ),
    WEEKDAYS = new Set( [ "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday" ] ),
    WEEKDAYS3 = new Set( [ ...WEEKDAYS ].map( day => day.slice( 0, 3 ) ) ),
    VALID_TIMEZONES = new Set();

export function isValidMonthName ( month ) {
    return month in MONTHS;
}

export function isValidMonth3Name ( month ) {
    return month in MONTHS3;
}

export function isValidWeekdayName ( weekday ) {
    return WEEKDAYS.has( weekday );
}

export function isValidWeekday3Name ( weekday ) {
    return WEEKDAYS3.has( weekday );
}

export function isValidTimeZone ( timezone ) {
    if ( VALID_TIMEZONES.has( timezone ) ) {
        return true;
    }
    try {
        new Intl.DateTimeFormat( "en-US", { timezone } );

        VALID_TIMEZONES.add( timezone );

        return true;
    }
    catch {
        return false;
    }
}

export function instantToHttpDate ( value ) {
    if ( value instanceof Temporal.Instant ) {
        return new Date( value.epochMilliseconds ).toUTCString();
    }
    else if ( value instanceof Temporal.ZonedDateTime ) {
        return new Date( value.epochMilliseconds ).toUTCString();
    }
    else {
        throw new TypeError( "Value is not a Temporal.Instant" );
    }
}

export function httpDateToInstant ( value ) {
    return new Date( value ).toTemporalInstant();
}

export function parseInstant ( value ) {
    if ( value instanceof Temporal.Instant ) {
        return value;
    }
    else if ( typeof value === "number" ) {
        return Temporal.Instant.fromEpochMilliseconds( value );
    }
    else if ( typeof value === "bigint" ) {
        return Temporal.Instant.fromEpochNanoseconds( value );
    }
    else {
        return Temporal.Instant.from( value );
    }
}
