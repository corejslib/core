import GlobPattern from "#lib/glob/pattern";

export function normalizeExtname ( name ) {
    name = name.toLowerCase();

    if ( !name.startsWith( "." ) ) {
        name = "." + name;
    }

    return name;
}

export function createPattern ( pattern ) {
    return GlobPattern.new( pattern, {
        "allowNegatedPatterns": false,
        "allowBraces": true,
        "allowBrackets": true,
        "allowGlobstar": true,
        "allowExtGlob": true,
        "allowGlobalBasename": true,
    } );
}
