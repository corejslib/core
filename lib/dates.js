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
    HTTP_DATE_PATTERN = String.raw`(?:${ [ ...WEEKDAYS3 ].join( "|" ) }), \d\d (?:${ Object.keys( MONTHS3 ).join( "|" ) }) \d\d\d\d \d\d:\d\d:\d\d GMT`,
    HTTP_DATE_REGEXP = new RegExp( String.raw`^${ HTTP_DATE_PATTERN }$` );

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

export function isValidTimeZone ( timeZone ) {
    try {
        new Intl.DateTimeFormat( "en-US", { timeZone } );

        return true;
    }
    catch {
        return false;
    }
}

export function parseInstant ( value ) {

    // Temporal.Instant
    if ( value instanceof Temporal.Instant ) {
        return value;
    }

    // nunber
    else if ( typeof value === "number" ) {
        return Temporal.Instant.fromEpochMilliseconds( value );
    }

    // bigint
    else if ( typeof value === "bigint" ) {
        return Temporal.Instant.fromEpochNanoseconds( value );
    }

    // string
    else if ( typeof value === "string" ) {

        // Instant string
        if ( value.endsWith( "Z" ) ) {
            return Temporal.Instant.from( value );
        }
        else {
            return Temporal.ZonedDateTime.from( value ).toInstant();
        }
    }

    // Date
    else if ( value instanceof Date ) {
        return Temporal.Instant.fromEpochMilliseconds( value.getTime() );
    }

    // Temporal.ZonedDateTime
    if ( value instanceof Temporal.ZonedDateTime ) {
        return value.toInstant();
    }

    // error
    else {
        throw new TypeError( "Instant date is not valid" );
    }
}

export function parseZonedDateTime ( value ) {

    // Temporal.ZonedDateTime
    if ( value instanceof Temporal.ZonedDateTime ) {
        return value;
    }

    // nunber
    else if ( typeof value === "number" ) {
        value = Temporal.Instant.fromEpochMilliseconds( value );
    }

    // bigint
    else if ( typeof value === "bigint" ) {
        value = Temporal.Instant.fromEpochNanoseconds( value );
    }

    // string
    else if ( typeof value === "string" ) {

        // Instant string
        if ( value.endsWith( "Z" ) ) {
            value = Temporal.Instant.from( value );
        }
        else {
            return Temporal.ZonedDateTime.from( value );
        }
    }

    // Date
    else if ( value instanceof Date ) {
        value = Temporal.Instant.fromEpochMilliseconds( value.getTime() );
    }

    // Temporal.Instant
    if ( value instanceof Temporal.Instant ) {
        return value.toZonedDateTimeISO( "UTC" );
    }

    // error
    else {
        throw new TypeError( "ZonedDateTime is not valid" );
    }
}

export function parseHttpDateToZonedDateTime ( date ) {
    if ( date.length !== 29 || !HTTP_DATE_REGEXP.test( date ) ) throw new Error( "HTTP date is not valid" );

    return Temporal.ZonedDateTime.from( {
        "year": Number( date.slice( 12, 16 ) ),
        "month": MONTHS3[ date.slice( 8, 11 ) ],
        "day": Number( date.slice( 5, 7 ) ),
        "hour": Number( date.slice( 17, 19 ) ),
        "minute": Number( date.slice( 20, 22 ) ),
        "second": Number( date.slice( 23, 25 ) ),
        "timeZone": "UTC",
    } );
}

export function parseHttpDateToInstant ( date ) {
    return parseHttpDateToZonedDateTime( date ).toInstant();
}

export function parseHttpDateToDate ( date ) {
    return new Date( parseHttpDateToZonedDateTime( date ).epochMilliseconds );
}

export function temporalToHttpDate ( date ) {
    if ( date instanceof Temporal.Instant || date instanceof Temporal.ZonedDateTime ) {
        return new Date( date.epochMilliseconds ).toUTCString();
    }
    else {
        throw new TypeError( "Date type is not valid" );
    }
}
