import "#lib/result";
import { fullFormats } from "ajv-formats/dist/formats.js";
import { isCamelCase, isConstantCase, isKebabCase, isPascalCase, isSnakeCase } from "#lib/naming-conventions";

// accepted characters: A-z (case-insensitive), 0-9 and underscores, length: 5-255 characters
export function validateTelegramUsername ( value ) {

    // length must be between 5 and 32 characters
    if ( value.length < 5 || value.length > 255 ) return result( [ 400, "Telegram username lenght must be between 5 and 255 characters" ] );

    // must contain letters, digits and "_" only
    if ( /\W/v.test( value ) ) return result( [ 400, `Telegram username must contain letters, digits and "_" character only` ] );

    return result( 200 );
}

export function validateEmail ( value ) {
    if ( !fullFormats.email.test( value ) ) return result( [ 400, "Email address is invalid" ] );

    return result( 200 );
}

export function validateDomainName ( value ) {
    if ( !fullFormats.hostname.test( value ) ) return result( [ 400, "Hostname is invalid" ] );

    return result( 200 );
}

export function validatePath ( string, { root, absolute, directory, format } = {} ) {

    // root
    if ( string === "/" ) {
        if ( root ) {
            return true;
        }
        else {
            return false;
        }
    }

    // start
    if ( string.startsWith( "/" ) ) {
        if ( absolute === false ) return false;

        string = string.slice( 1 );
    }
    else if ( absolute === true ) {
        return false;
    }

    // end
    if ( string.endsWith( "/" ) ) {
        if ( directory === false ) return false;

        string = string.slice( 0, -1 );
    }
    else if ( directory === true ) {
        return false;
    }

    if ( format ) {

        // kebab case
        if ( format === "kebab-case" ) {
            for ( const segment of string.split( "/" ) ) {
                if ( !isKebabCase( segment ) ) return false;
            }
        }

        // snake case
        else if ( format === "snake-case" ) {
            for ( const segment of string.split( "/" ) ) {
                if ( !isSnakeCase( segment ) ) return false;
            }
        }

        // constant case
        else if ( format === "constant-case" ) {
            for ( const segment of string.split( "/" ) ) {
                if ( !isConstantCase( segment ) ) return false;
            }
        }

        // camel case
        else if ( format === "camel-case" ) {
            for ( const segment of string.split( "/" ) ) {
                if ( !isCamelCase( segment ) ) return false;
            }
        }

        // pascal case
        else if ( format === "pascal-case" ) {
            for ( const segment of string.split( "/" ) ) {
                if ( !isPascalCase( segment ) ) return false;
            }
        }

        // invalid format
        else {
            return false;
        }
    }

    return true;
}

export function validatePort ( port, { allowRandom } = {} ) {
    port = Number( port );

    return Number.isInteger( port ) && port >= ( allowRandom
        ? 0
        : 1 ) && port <= 65_535;
}
