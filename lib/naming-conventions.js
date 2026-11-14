// DOCS: https://en.wikipedia.org/wiki/Naming_convention_(programming)#Multiple-word_identifiers

export function isKebabCase ( string, { allowProtected } = {} ) {
    if ( allowProtected && string.startsWith( "_" ) ) string = string.replace( /^_+/v, "" );

    return /^[a-z][\da-z]*(?:-[\da-z]+)*$/v.test( string );
}

export function isSnakeCase ( string, { allowProtected } = {} ) {
    if ( allowProtected && string.startsWith( "_" ) ) string = string.replace( /^_+/v, "" );

    return /^[a-z][\da-z]*(?:_[\da-z]+)*$/v.test( string );
}

export function isConstantCase ( string, { allowProtected } = {} ) {
    if ( allowProtected && string.startsWith( "_" ) ) string = string.replace( /^_+/v, "" );

    return /^[A-Z][\dA-Z]*(?:_[\dA-Z]+)*$/v.test( string );
}

export function isCamelCase ( string, { allowProtected, strict } = {} ) {
    if ( allowProtected && string.startsWith( "_" ) ) string = string.replace( /^_+/v, "" );

    if ( strict ) {
        return /^[a-z][\da-z]*(?:[A-Z][\da-z]+)*[A-Z]?$/v.test( string );
    }
    else {
        return /^[a-z][\da-z]*(?:[A-Z][\da-z]*)*$/v.test( string );
    }
}

export function isPascalCase ( string, { allowProtected, strict } = {} ) {
    if ( allowProtected && string.startsWith( "_" ) ) string = string.replace( /^_+/v, "" );

    if ( strict ) {
        return /^(?:[A-Z]|(?:[A-Z][\da-z]+)+[A-Z]?)$/v.test( string );
    }
    else {
        return /^[A-Z][\dA-Za-z]*$/v.test( string );
    }
}

export function toKebabCase ( string, { allowProtected = true, isStrictCase } = {} ) {
    var protectedPrefix = "";

    string = string.replace( /^(_+)/v, ( match, prefix ) => {
        if ( allowProtected ) protectedPrefix = prefix;

        return "";
    } );

    // kebab, snake, constant case
    if ( /[_\-]/v.test( string ) ) {
        string = string.toLowerCase().replaceAll( /[_\-]+/gv, "-" );
    }

    // camel case
    else {

        // convert to strict camel case
        if ( !isStrictCase ) {
            string = string.replaceAll( /([A-Z])([A-Z]+)([\da-z])?/gv, ( match, letter, body, postfix ) => {
                if ( postfix ) {
                    return letter + body.slice( 0, -1 ).toLowerCase() + body.slice( -1 ) + postfix;
                }
                else {
                    return letter + body.toLowerCase();
                }
            } );
        }

        string = string.replaceAll( /(?<!^)([A-Z])/gv, ( match, letter ) => "-" + letter ).toLowerCase();
    }

    return protectedPrefix + string;
}

export function toSnakeCase ( string, { allowProtected = true, isStrictCase } = {} ) {
    return toKebabCase( string, { allowProtected, isStrictCase } ).replaceAll( "-", "_" );
}

export function toConstantCase ( string, { allowProtected = true, isStrictCase } = {} ) {
    return toSnakeCase( string, { allowProtected, isStrictCase } ).toUpperCase();
}

export function toCamelCase ( string, { allowProtected = true, isStrictCase } = {} ) {
    return toKebabCase( string, { allowProtected, isStrictCase } ).replaceAll( /-([a-z])/gv, ( match, letter ) => letter.toUpperCase() );
}

export function toPascalCase ( string, { allowProtected = true, isStrictCase } = {} ) {
    return toCamelCase( string, { allowProtected, isStrictCase } ).replace( /^(_*)([a-z])/v, ( match, prefix, letter ) => prefix + letter.toUpperCase() );
}

export function toHeaderCase ( string ) {
    return string
        .toLowerCase()
        .replace( /^[ _\-]+/v, "" )
        .replace( /[ _\-]+$/v, "" )
        .replaceAll( /[ _\-]+/gv, "-" )
        .replace( /^(.)/v, ( match, letter ) => letter.toUpperCase() )
        .replaceAll( /-(.)/gv, ( match, letter ) => `-${ letter.toUpperCase() }` );
}
