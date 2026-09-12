import GlobPattern from "./pattern.js";

export default class GlobPatterns {
    #strict;
    #absolutePatterns;
    #normalizePatterns;
    #allowNegatedPatterns;
    #allowBraces;
    #allowGlob;
    #allowBrackets;
    #allowGlobstar;
    #allowExtGlob;
    #allowGlobalBasename;
    #ignoreCase;
    #allowIfListEmpty;
    #ignoreNegatedPatterns;
    #patterns = new Map();
    #maxDepth;
    #hasAllowedPatterns;
    #hasDeniedPatterns;
    #allowsAll;
    #deniesAll;
    #allowedRegexp;
    #allowedRegexpIgnoreCase;
    #deniedRegexp;
    #deniedRegexpIgnoreCase;

    constructor ( { strict = true, absolutePatterns, normalizePatterns, allowNegatedPatterns = true, allowBraces = true, allowGlob = true, allowBrackets = true, allowGlobstar = true, allowExtGlob = true, allowGlobalBasename, ignoreCase, allowIfListEmpty, ignoreNegatedPatterns } = {} ) {
        this.#strict = Boolean( strict );
        this.#absolutePatterns = Boolean( absolutePatterns );
        this.#normalizePatterns = Boolean( normalizePatterns );
        this.#allowNegatedPatterns = Boolean( allowNegatedPatterns );
        this.#allowBraces = Boolean( allowBraces );
        this.#allowGlob = Boolean( allowGlob );
        this.#allowBrackets = Boolean( allowBrackets );
        this.#allowGlobstar = Boolean( allowGlobstar );
        this.#allowExtGlob = Boolean( allowExtGlob );
        this.#allowGlobalBasename = Boolean( allowGlobalBasename );
        this.#ignoreCase = Boolean( ignoreCase );
        this.#allowIfListEmpty = Boolean( allowIfListEmpty );
        this.#ignoreNegatedPatterns = Boolean( ignoreNegatedPatterns );
    }

    // properties
    get isStrict () {
        return this.#strict;
    }

    get absolutePatterns () {
        return this.#absolutePatterns;
    }

    get normalizePatterns () {
        return this.#normalizePatterns;
    }

    get allowNegatedPatterns () {
        return this.#allowNegatedPatterns;
    }

    get allowBraces () {
        return this.#allowBraces;
    }

    get allowGlob () {
        return this.#allowGlob;
    }

    get allowBrackets () {
        return this.#allowBrackets;
    }

    get allowGlobstar () {
        return this.#allowGlobstar;
    }

    get allowExtGlob () {
        return this.#allowExtGlob;
    }

    get allowGlobalBasename () {
        return this.#allowGlobalBasename;
    }

    get ignoreCase () {
        return this.#ignoreCase;
    }

    get allowIfListEmpty () {
        return this.#allowIfListEmpty;
    }

    get ignoreNegatedPatterns () {
        return this.#ignoreNegatedPatterns;
    }

    get maxDepth () {
        if ( this.#maxDepth == null ) {
            this.#build();
        }

        return this.#maxDepth;
    }

    get hasPatterns () {
        return Boolean( this.#patterns.size );
    }

    get allowsAll () {
        if ( this.#allowsAll == null ) {
            this.#build();
        }

        return this.#allowsAll;
    }

    get deniesAll () {
        if ( this.#deniesAll == null ) {
            this.#build();
        }

        return this.#deniesAll;
    }

    get hasAllowedPatterns () {
        if ( this.#hasAllowedPatterns == null ) {
            this.#build();
        }

        return this.#hasAllowedPatterns;
    }

    get hasDeniedPatterns () {
        if ( this.#hasDeniedPatterns == null ) {
            this.#build();
        }

        return this.#hasDeniedPatterns;
    }

    get allowedRegexp () {
        if ( this.#allowedRegexp == null ) {
            this.#build();
        }

        return this.#allowedRegexp;
    }

    get allowedRegexpIgnoreCase () {
        if ( !this.#allowedRegexpIgnoreCase ) {
            this.#allowedRegexpIgnoreCase = new RegExp( this.allowedRegexp.source, "iv" );
        }

        return this.#allowedRegexpIgnoreCase;
    }

    get deniedRegexp () {
        if ( this.#deniedRegexp == null ) {
            this.#build();
        }

        return this.#deniedRegexp;
    }

    get deniedRegexpIgnoreCase () {
        if ( !this.#deniedRegexpIgnoreCase ) {
            this.#deniedRegexpIgnoreCase = new RegExp( this.deniedRegexp.source, "iv" );
        }

        return this.#deniedRegexpIgnoreCase;
    }

    // public
    has ( pattern, globPatternOptions ) {
        if ( !pattern ) return false;

        pattern = this.#createPattern( pattern, globPatternOptions );

        return this.#patterns.has( pattern.id );
    }

    add ( patterns, globPatternOptions ) {
        if ( !Array.isArray( patterns ) ) patterns = [ patterns ];

        for ( let pattern of patterns ) {
            if ( !pattern ) continue;

            pattern = this.#createPattern( pattern, globPatternOptions );

            if ( pattern.isNegated && this.#ignoreNegatedPatterns ) continue;

            // move pattern
            if ( this.#patterns.delete( pattern.id ) ) {
                this.#patterns.set( pattern.id, pattern );
            }

            // add pattern
            else {
                this.#patterns.set( pattern.id, pattern );

                this.#clear();
            }
        }

        return this;
    }

    set ( patterns, globPatternOptions ) {
        return this.clear().add( patterns, globPatternOptions );
    }

    delete ( patterns, globPatternOptions ) {
        if ( !Array.isArray( patterns ) ) patterns = [ patterns ];

        for ( let pattern of patterns ) {
            if ( !pattern ) continue;

            pattern = this.#createPattern( pattern, globPatternOptions );

            // pattern exists
            if ( this.#patterns.delete( pattern.id ) ) {
                this.#clear();
            }
        }

        return this;
    }

    clear () {
        this.#patterns.clear();

        this.#clear();

        return this;
    }

    test ( testPath, { prefix, absolute, normalize, ignoreCase = this.#ignoreCase } = {} ) {
        const prepared = this.#normalizeTestPath( testPath, { prefix, absolute, normalize } );

        if ( !prepared ) return false;

        const isArray = prepared.isArray;
        testPath = prepared.testPath;

        this.#build();

        let allow = false;

        // deny all
        if ( this.#deniesAll ) {
            return false;
        }

        // allow all
        else if ( this.#allowsAll ) {
            allow = true;
        }

        // test allowed patterns
        else if ( this.#hasAllowedPatterns ) {
            if ( isArray ) {
                for ( const item of testPath ) {
                    if ( ignoreCase ) {
                        allow = this.allowedRegexpIgnoreCase.test( item );
                    }
                    else {
                        allow = this.#allowedRegexp.test( item );
                    }

                    if ( allow ) break;
                }
            }
            else {
                if ( ignoreCase ) {
                    allow = this.allowedRegexpIgnoreCase.test( testPath );
                }
                else {
                    allow = this.#allowedRegexp.test( testPath );
                }
            }
        }

        if ( !allow ) return allow;

        // test denied patterns
        if ( this.#hasDeniedPatterns ) {
            if ( isArray ) {
                for ( const item of testPath ) {
                    if ( ignoreCase ) {
                        allow = !this.deniedRegexpIgnoreCase.test( item );
                    }
                    else {
                        allow = !this.#deniedRegexp.test( item );
                    }

                    if ( !allow ) break;
                }
            }
            else {
                if ( ignoreCase ) {
                    allow = !this.deniedRegexpIgnoreCase.test( testPath );
                }
                else {
                    allow = !this.#deniedRegexp.test( testPath );
                }
            }
        }

        return allow;
    }

    testList ( testPath, { prefix, absolute, normalize, ignoreCase = this.#ignoreCase } = {} ) {
        const prepared = this.#normalizeTestPath( testPath, { prefix, absolute, normalize } );

        if ( !prepared ) return false;

        const isArray = prepared.isArray;
        testPath = prepared.testPath;

        this.#build();

        let allow = false;

        // allow if list is empty
        if ( !this.#hasAllowedPatterns && this.#allowIfListEmpty ) {
            allow = true;
        }

        // allowed and has no denied patterns
        if ( allow && !this.#hasDeniedPatterns ) {
            return allow;
        }

        // denied and has no allowed patterns
        else if ( !allow && !this.#hasAllowedPatterns ) {
            return allow;
        }

        // test patterns
        for ( const pattern of this.#patterns.values() ) {
            let match;

            if ( isArray ) {
                for ( const item of testPath ) {
                    match = pattern.test( item, { ignoreCase } );

                    if ( match ) break;
                }
            }
            else {
                match = pattern.test( testPath, { ignoreCase } );
            }

            // pattern match
            if ( match ) {

                // negated pattern
                if ( pattern.isNegated ) {
                    allow = false;

                    // denied and has no allowed patterns
                    if ( !this.#hasAllowedPatterns ) {
                        return allow;
                    }
                }
                else {
                    allow = true;

                    // allowed and has no denied patterns
                    if ( !this.#hasDeniedPatterns ) {
                        return allow;
                    }
                }
            }
        }

        return allow;
    }

    testAllowed ( testPath, { prefix, absolute, normalize, ignoreCase = this.#ignoreCase } = {} ) {
        const prepared = this.#normalizeTestPath( testPath, { prefix, absolute, normalize } );

        if ( !prepared ) return false;

        const isArray = prepared.isArray;
        testPath = prepared.testPath;

        this.#build();

        // match all
        if ( this.#allowsAll ) {
            return true;
        }

        // test patterns
        else if ( this.#hasAllowedPatterns ) {
            if ( isArray ) {
                for ( const item of testPath ) {
                    if ( ignoreCase ) {
                        if ( this.allowedRegexpIgnoreCase.test( item ) ) {
                            return true;
                        }
                    }
                    else {
                        if ( this.#allowedRegexp.test( item ) ) {
                            return true;
                        }
                    }
                }

                // not match any pattern
                return false;
            }
            else {
                if ( ignoreCase ) {
                    return this.allowedRegexpIgnoreCase.test( testPath );
                }
                else {
                    return this.#allowedRegexp.test( testPath );
                }
            }
        }

        // has no patters
        else {
            return false;
        }
    }

    testDenied ( testPath, { prefix, absolute, normalize, ignoreCase = this.#ignoreCase } = {} ) {
        const prepared = this.#normalizeTestPath( testPath, { prefix, absolute, normalize } );

        if ( !prepared ) return false;

        const isArray = prepared.isArray;
        testPath = prepared.testPath;

        this.#build();

        // match all
        if ( this.#deniesAll ) {
            return true;
        }

        // test patterns
        else if ( this.#hasDeniedPatterns ) {
            if ( isArray ) {
                for ( const item of testPath ) {
                    if ( ignoreCase ) {
                        if ( this.deniedRegexpIgnoreCase.test( item ) ) {
                            return true;
                        }
                    }
                    else {
                        if ( this.#deniedRegexp.test( item ) ) {
                            return true;
                        }
                    }
                }

                // not match any pattern
                return false;
            }
            else {
                if ( ignoreCase ) {
                    return this.deniedRegexpIgnoreCase.test( testPath );
                }
                else {
                    return this.#deniedRegexp.test( testPath );
                }
            }
        }

        // has no patterns
        else {
            return false;
        }
    }

    toJSON () {
        return [ ...this.#patterns.values() ].map( pattern => pattern.pattern );
    }

    [ Symbol.iterator ] () {
        return this.#patterns.values();
    }

    [ Symbol.for( "nodejs.util.inspect.custom" ) ] ( maxDepth, options, inspect ) {
        const spec = {
            "patterns": [ ...this.#patterns.values() ],
        };

        return `${ this.constructor.name }: ${ inspect( spec ) }`;
    }

    // private
    #normalizeTestPath ( testPath, { prefix, absolute, normalize } = {} ) {
        const isArray = Array.isArray( testPath );

        if ( isArray ) {
            const normalizedList = [];

            for ( const path of testPath ) {
                if ( !path ) continue;

                const normalizedPath = prefix || absolute || normalize
                    ? GlobPattern.normalizePath( path, { prefix, absolute } )
                    : path;

                if ( normalizedPath ) normalizedList.push( normalizedPath );
            }

            if ( !normalizedList.length ) return false;

            return { isArray, "testPath": normalizedList };
        }

        if ( !testPath ) return false;

        if ( prefix || absolute || normalize ) {
            testPath = GlobPattern.normalizePath( testPath, { prefix, absolute } );

            if ( !testPath ) return false;
        }

        return { isArray, testPath };
    }

    #createPattern ( pattern, { prefix, strict = this.#strict, absolutePatterns = this.#absolutePatterns, normalizePatterns = this.#normalizePatterns, allowNegatedPatterns = this.#allowNegatedPatterns, allowBraces = this.#allowBraces, allowGlob = this.#allowGlob, allowBrackets = this.#allowBrackets, allowGlobstar = this.#allowGlobstar, allowExtGlob = this.#allowExtGlob, allowGlobalBasename = this.#allowGlobalBasename } = {} ) {
        return GlobPattern.new( pattern, {
            prefix,
            strict,
            absolutePatterns,
            normalizePatterns,
            allowNegatedPatterns,
            allowBraces,
            allowGlob,
            allowBrackets,
            allowGlobstar,
            allowExtGlob,
            allowGlobalBasename,
        } );
    }

    #clear () {
        this.#hasAllowedPatterns = undefined;
        this.#hasDeniedPatterns = undefined;
        this.#allowsAll = undefined;
        this.#deniesAll = undefined;
        this.#maxDepth = undefined;
        this.#allowedRegexp = undefined;
        this.#allowedRegexpIgnoreCase = undefined;
        this.#deniedRegexp = undefined;
        this.#deniedRegexpIgnoreCase = undefined;
    }

    #build () {
        if ( this.#hasAllowedPatterns != null ) return;

        this.#hasAllowedPatterns = false;
        this.#hasDeniedPatterns = false;
        this.#allowsAll = false;
        this.#deniesAll = false;
        this.#maxDepth = 0;

        const allowedRegexps = [],
            deniedRegexps = [];

        for ( const pattern of this.#patterns.values() ) {
            if ( pattern.matchesNone ) {
                continue;
            }
            else if ( pattern.isNegated ) {
                this.#hasDeniedPatterns = true;

                if ( pattern.deniesAll ) {
                    this.#deniesAll = true;
                }

                deniedRegexps.push( pattern.regexp.source );
            }
            else {
                this.#hasAllowedPatterns = true;

                if ( pattern.allowsAll ) {
                    this.#allowsAll = true;
                }

                allowedRegexps.push( pattern.regexp.source );

                if ( pattern.maxDepth > this.#maxDepth ) {
                    this.#maxDepth = pattern.maxDepth;
                }
            }
        }

        if ( this.#allowsAll ) {
            this.#allowedRegexp = GlobPattern.MATCH_ALL_REGEXP;
        }
        else if ( this.#hasAllowedPatterns ) {
            if ( allowedRegexps.length === 1 ) {
                this.#allowedRegexp = new RegExp( allowedRegexps[ 0 ], "v" );
            }
            else {
                this.#allowedRegexp = new RegExp( "(?:" + allowedRegexps.sort( ( a, b ) => a.length - b.length ).join( "|" ) + ")", "v" );
            }
        }
        else if ( this.#allowIfListEmpty ) {
            this.#allowsAll = true;
            this.#allowedRegexp = GlobPattern.MATCH_ALL_REGEXP;
        }
        else {
            this.#allowedRegexp = GlobPattern.MATCH_NONE_REGEXP;
        }

        if ( this.#deniesAll ) {
            this.#deniedRegexp = GlobPattern.MATCH_ALL_REGEXP;
        }
        else if ( this.#hasDeniedPatterns ) {
            if ( deniedRegexps.length === 1 ) {
                this.#deniedRegexp = new RegExp( deniedRegexps[ 0 ], "v" );
            }
            else {
                this.#deniedRegexp = new RegExp( "(?:" + deniedRegexps.sort( ( a, b ) => a.length - b.length ).join( "|" ) + ")", "v" );
            }
        }
        else {
            this.#deniedRegexp = GlobPattern.MATCH_NONE_REGEXP;
        }
    }
}
