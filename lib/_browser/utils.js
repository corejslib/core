export { sleep } from "#lib/timers";

export function getRandomArrayIndex ( array ) {
    if ( !array.length ) return;

    return Math.floor( Math.random() * array.length );
}

export function getRandomArrayValue ( array ) {
    if ( !array.length ) return;

    return array[ Math.floor( Math.random() * array.length ) ];
}

export function isPlainObject ( value ) {
    return value != null && typeof value === "object" && ( Object.getPrototypeOf( value ) === Object.prototype || Object.getPrototypeOf( value ) === null );
}

export function freezeObjectRecursively ( object ) {
    if ( object != null && typeof object === "object" ) {
        Object.freeze( object );

        for ( const value of Object.values( object ) ) {
            freezeObjectRecursively( value );
        }
    }

    return object;
}

export function isEmptyObject ( object ) {
    for ( const name in object ) return false;

    return true;
}

export function objectPick ( object, keys ) {
    return keys.reduce( ( result, key ) => {
        if ( key in object ) result[ key ] = object[ key ];

        return result;
    }, {} );
}

export function objectOmit ( object, keys ) {
    object = { ...object };

    keys.forEach( key => delete object[ key ] );

    return object;
}

export function mergeObjects ( target, ...objects ) {
    for ( const object of objects ) {
        if ( !object ) continue;

        for ( const property in object ) {
            if ( isPlainObject( object[ property ] ) ) {
                if ( !isPlainObject( target[ property ] ) ) target[ property ] = {};

                mergeObjects( target[ property ], object[ property ] );
            }
            else if ( object[ property ] === undefined ) {
                delete target[ property ];
            }
            else {
                target[ property ] = object[ property ];
            }
        }
    }

    return target;
}

export function sortObject ( object ) {
    return Object.fromEntries( Object.entries( object ).sort( ( [ a ], [ b ] ) => a.localeCompare( b ) ) );
}

export function compare ( a, b ) {
    if ( a < b ) {
        return -1;
    }
    else if ( a > b ) {
        return 1;
    }
    else {
        return 0;
    }
}
