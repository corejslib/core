import "temporal-polyfill/global";

const MONTHS = {
        "Jan": 1,
        "Feb": 2,
        "Mar": 3,
        "Apr": 4,
        "May": 5,
        "Jun": 6,
        "Jul": 7,
        "Aug": 8,
        "Sep": 9,
        "Oct": 10,
        "Nov": 11,
        "Dec": 12,
    },
    WEEKDAYS = [ "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday" ],
    WEEKDAYS3 = WEEKDAYS.map( day => day.slice( 0, 3 ) ),
    HTTP_DATE_RE = new RegExp( `^(?<weekday>${ WEEKDAYS3.join( "|" ) }), (?<day>\\d{2}) (?<month>${ Object.keys( MONTHS ).join( "|" ) }) (?<year>\\d{4}) (?<hour>\\d{2}):(?<minute>\\d{2}):(?<second>\\d{2}) GMT$` );

export function parseInstantHttpDate ( date ) {
    const match = date.match( HTTP_DATE_RE );

    if ( !match ) throw new Error( "HTTP date is not valid" );

    return Temporal.PlainDateTime.from( {
        "year": Number( match.groups.year ),
        "month": MONTHS[ match.groups.month ],
        "day": Number( match.groups.day ),
        "hour": Number( match.groups.hour ),
        "minute": Number( match.groups.minute ),
        "second": Number( match.groups.second ),
    } )
        .toZonedDateTime( "UTC" )
        .toInstant();
}

export function parseHttpDate ( date ) {
    return new Date( parseInstantHttpDate( date ).epochMilliseconds );
}
