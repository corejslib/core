import path from "node:path";
import expandBraces from "#lib/glob/expand-braces";

const POSIX_CLASSES = {
        "alnum": String.raw`A-Za-z\d`,
        "alpha": "A-Za-z",
        "ascii": String.raw`\x00-\x2E\x30-\x7F`, // `/` is excluded from the range
        "blank": String.raw` \t`,
        "cntrl": String.raw`\x00-\x1F\x7F`,
        "digit": String.raw`\d`,
        "graph": String.raw`\x21-\x2E\x30-\x7E`, // `/` is excluded from the range
        "lower": "a-z",
        "print": String.raw`\x20-\x2E\x30-\x7E`, // `/` is excluded from the range
        "punct": String.raw`\x21-\x2E\x3A-\x40\x5B-\x60\x7B-\x7E`, // `/` is excluded from the range
        "space": String.raw` \t\n\r\f\v`,
        "upper": "A-Z",
        "word": String.raw`A-Za-z\d_`,
        "xdigit": String.raw`A-Fa-f\d`,
    },
    REGEXP_ESCAPE_RE = /[.*+?^$\{\}\(\)\|\[\]\\\/]/gv,
    CLASS_CHAR_ESCAPE_SET = new Set( "^()[]{}/-\\|" ),
    REGEXP_ESCAPE_SET = new Set( ".*+?^${}()|[]\\/" ),
    FORWARD_SLASH_CODE = 0x2F, // `/`
    MATCH_ALL_REGEXP = /^.+$/v,
    MATCH_NONE_REGEXP = /.^/v; // eslint-disable-line regexp/no-useless-assertions

export default class GlobPattern {
    #id;
    #pattern;
    #prefix;
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
    #isNegated = false;
    #isStatic;
    #matchesAll = false;
    #matchesNone = false;
    #matchesBasename = false;
    #depth = 1;
    #regexp;
    #regexpIgnoreCase;

    constructor ( pattern, { prefix, strict = true, absolutePatterns, normalizePatterns, allowNegatedPatterns = true, allowBraces = true, allowGlob = true, allowBrackets = true, allowGlobstar = true, allowExtGlob = true, allowGlobalBasename } = {} ) {
        if ( pattern instanceof GlobPattern ) {
            this.#pattern = pattern.pattern;
        }
        else {
            this.#pattern = pattern;
        }

        if ( typeof this.#pattern !== "string" ) throw new TypeError( "Pattern must be a string" );

        this.#absolutePatterns = Boolean( absolutePatterns );
        this.#normalizePatterns = Boolean( normalizePatterns );
        this.#prefix = this.#preparePrefix( prefix );
        this.#strict = Boolean( strict );
        this.#allowNegatedPatterns = Boolean( allowNegatedPatterns );
        this.#allowBraces = Boolean( allowBraces );
        this.#allowGlob = Boolean( allowGlob );
        this.#allowBrackets = Boolean( allowBrackets );
        this.#allowGlobstar = Boolean( allowGlobstar );
        this.#allowExtGlob = Boolean( allowExtGlob );
        this.#allowGlobalBasename = Boolean( allowGlobalBasename );

        // negated pattern
        if ( this.#allowNegatedPatterns && this.#pattern.startsWith( "!" ) ) {

            // not a ext-glob pattern `!(...)`
            if ( !this.#allowExtGlob || !this.#pattern.startsWith( "!(" ) ) {
                this.#isNegated = true;

                this.#pattern = this.#pattern.slice( 1 );
            }
        }

        this.#regexp = this.#buildRegExp();

        // add negated mark
        if ( this.#isNegated ) {
            this.#pattern = "!" + this.#pattern;
        }
    }

    // static
    static get MATCH_ALL_REGEXP () {
        return MATCH_ALL_REGEXP;
    }

    static get MATCH_NONE_REGEXP () {
        return MATCH_NONE_REGEXP;
    }

    static new ( pattern, options ) {
        if ( pattern instanceof this ) {
            return pattern;
        }
        else {
            return new this( pattern, options );
        }
    }

    static isValid ( pattern, options ) {
        if ( pattern instanceof this ) {
            return true;
        }

        try {
            new this( pattern, options );

            return true;
        }
        catch {
            return false;
        }
    }

    static normalizePath ( string, { prefix, absolute } = {} ) {
        return path.posix.join( absolute
            ? "/"
            : "", prefix ?? "", string );
    }

    // properties
    get id () {
        if ( this.#id == null ) {
            if ( this.#isNegated ) {
                this.#id = "!/" + this.#regexp.source;
            }
            else {
                this.#id = "/" + this.#regexp.source;
            }
        }

        return this.#id;
    }

    get prefix () {
        return this.#prefix;
    }

    get pattern () {
        return this.#pattern;
    }

    get regexp () {
        return this.#regexp;
    }

    get regexpIgnoreCase () {
        if ( !this.#regexpIgnoreCase ) {
            this.#regexpIgnoreCase = new RegExp( this.#regexp.source, "iv" );
        }

        return this.#regexpIgnoreCase;
    }

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

    get isNegated () {
        return this.#isNegated;
    }

    get isStatic () {
        return this.#isStatic;
    }

    get matchesNone () {
        return this.#matchesNone;
    }

    get matchesBasename () {
        return this.#matchesBasename;
    }

    get allowsAll () {
        return this.#matchesAll && !this.#isNegated;
    }

    get deniesAll () {
        return this.#matchesAll && this.#isNegated;
    }

    get depth () {
        return this.#depth;
    }

    // public
    test ( testPath, { prefix, absolute, normalize, ignoreCase } = {} ) {
        if ( !testPath ) {
            return false;
        }
        else if ( this.#matchesAll ) {
            return true;
        }
        else {
            if ( prefix || absolute || normalize ) {
                testPath = this.constructor.normalizePath( testPath, { prefix, absolute } );
            }

            if ( ignoreCase ) {
                return this.regexpIgnoreCase.test( testPath );
            }
            else {
                return this.#regexp.test( testPath );
            }
        }
    }

    toString () {
        return this.pattern;
    }

    toJSON () {
        return this.toString();
    }

    [ Symbol.for( "nodejs.util.inspect.custom" ) ] ( maxDepth, options, inspect ) {
        const spec = {
            "pattern": this.#pattern,
        };

        if ( this.#prefix ) {
            spec.prefix = this.#prefix;
        }

        if ( this.#matchesBasename ) {
            spec.matchesBasename = true;
        }

        return `${ this.constructor.name }: ${ inspect( spec ) }`;
    }

    // private
    #preparePrefix ( prefix ) {
        if ( prefix ) {

            // unescape
            prefix = prefix.replaceAll( /\\(.)/gv, "$1" );

            if ( this.#absolutePatterns || this.#normalizePatterns ) {
                prefix = path.posix.join( this.#absolutePatterns
                    ? "/"
                    : "", prefix, "/" );
            }
            else {
                if ( !prefix.endsWith( "/" ) ) {
                    prefix += "/";
                }
            }
        }
        else {
            if ( this.#absolutePatterns ) {
                prefix = "/";
            }
            else {
                prefix = null;
            }
        }

        return prefix;
    }

    #buildRegExp () {
        let patterns, sequences;

        if ( this.#allowBraces ) {
            ( { patterns, sequences } = expandBraces( this.#pattern ) );
        }
        else {
            patterns = [ this.#pattern ];
        }

        // patterns with braces are not static
        this.#isStatic = patterns.length === 1;

        const prefix = this.#prefix,
            patterns1 = [];

        PATTERN: for ( let pattern of patterns ) {

            // unescape `/` in pattern
            pattern = pattern.replaceAll( /\\(.?)/gv, ( match, char ) => {
                if ( char ) {
                    if ( char === "/" ) {
                        return "/";
                    }
                    else {
                        return "\\" + char;
                    }
                }
                else {
                    return "\\\\";
                }
            } );

            // check if pattern is basename
            CHECK_BASENAME: if ( this.#allowGlobalBasename ) {
                const idx = pattern.indexOf( "/" );

                // should not have `/` at the start or middle
                if ( idx === 0 || ( idx > 0 && idx !== pattern.length - 1 ) ) {
                    break CHECK_BASENAME;
                }

                // should not be: `.`, `./`, `..`, `../`
                if ( /^\.\.?\/?$/v.test( pattern ) ) {
                    break CHECK_BASENAME;
                }

                // should not contain globstars
                if ( this.#allowGlobstar ) {
                    if ( /(?:^|\/)\*\*(?:\/|$)/v.test( pattern ) ) {
                        break CHECK_BASENAME;
                    }
                }

                // prepend with `**/` segmen if is basename
                pattern = "**/" + pattern;

                this.#matchesBasename = true;
            }

            // normalize pattern
            if ( this.#normalizePatterns ) {

                // pattern is absolute
                if ( pattern[ 0 ] === "/" ) {
                    pattern = path.posix.normalize( pattern );
                }

                // pattern is relative
                else {
                    if ( prefix ) {

                        // normalize to absolute path
                        pattern = path.posix.join( "/", pattern );

                        // revert to relative
                        pattern = pattern.slice( 1 );
                    }
                    else {
                        pattern = path.posix.normalize( pattern );
                    }
                }
            }

            // skip empty pattern
            if ( !pattern ) continue PATTERN;

            const segments = this.#splitPatternToSegments( pattern ),
                sources = [];

            let depth = 0;

            for ( let n = 0; n < segments.length; n++ ) {
                const segment = segments[ n ];

                // `/` separator
                if ( segment === "/" ) {

                    // first separator after prefix
                    if ( prefix && n === 0 ) {

                        // `prefix/` will never match, because pattern with prefix should never match prefix
                        if ( segments.length === 1 ) {
                            continue PATTERN;
                        }
                        else {
                            continue;
                        }
                    }
                    else {
                        sources.push( "\\/" );
                    }
                }

                // `**`
                else if ( segment === "**" && this.#allowGlobstar ) {
                    this.#isStatic = false;
                    depth = Infinity;

                    // `prefix/**`
                    if ( prefix ) {
                        sources.push( ".+" );
                    }

                    // `**`
                    else {
                        this.#matchesAll = true;

                        return MATCH_ALL_REGEXP;
                    }
                }

                // `**/`
                else if ( segment === "**/" && this.#allowGlobstar ) {
                    this.#isStatic = false;
                    depth = Infinity;

                    if ( prefix ) {

                        // `prefix/**/`
                        if ( segments.length === 1 ) {
                            sources.push( ".+\\/" );
                        }

                        // `prefix/**/a`
                        else {
                            sources.push( "(?:.*\\/)?" );
                        }
                    }

                    // `**/`
                    else if ( segments.length === 1 ) {
                        sources.push( ".*\\/" );
                    }

                    // `**/a`
                    else {
                        sources.push( "(?:.*\\/)?" );
                    }
                }

                // `/**`
                else if ( segment === "/**" && this.#allowGlobstar ) {
                    this.#isStatic = false;
                    depth = Infinity;

                    // first single segment
                    if ( n === 0 ) {

                        // `prefix/**`
                        if ( prefix ) {
                            sources.push( ".+" );
                        }

                        // `/**`
                        else {
                            sources.push( "\\/.*" );
                        }
                    }

                    // last segment, not after prefix
                    // `a/**`
                    else {
                        sources.push( "(?:\\/.*)?" );
                    }
                }

                // `/**/`
                else if ( segment === "/**/" && this.#allowGlobstar ) {
                    this.#isStatic = false;
                    depth = Infinity;

                    // first segment after prefix
                    if ( prefix && n === 0 ) {

                        // `prefix/**/`
                        if ( segments.length === 1 ) {
                            sources.push( ".+\\/" );
                        }

                        // `prefix/**/a`
                        else {
                            sources.push( "(?:.+\\/)?" );
                        }
                    }

                    // last segment
                    // `/**/`, `a/**/`
                    else if ( n === segments.length - 1 ) {
                        sources.push( "\\/.+\\/" );
                    }

                    // not last segment
                    // `/**/a`, `a/**/b`
                    else {
                        sources.push( "\\/(?:.*\\/)?" );
                    }
                }

                // other segment
                else {
                    depth++;

                    sources.push( this.#segmentToSource( segment, sequences ) );
                }
            }

            // update max. depth
            if ( depth > this.#depth ) {
                this.#depth = depth;
            }

            patterns1.push( {
                pattern,
                segments,
                sources,
            } );
        }

        patterns = patterns1;

        let source;

        if ( !patterns.length ) {
            this.#matchesNone = true;
            this.#depth = 0;

            return MATCH_NONE_REGEXP;
        }
        else {
            const prefixSource = prefix
                ? this.#escapeRegExp( prefix )
                : "";

            if ( patterns.length === 1 ) {
                source = prefixSource + patterns[ 0 ].sources.join( "" );
            }
            else {
                let commonPrefixIndex = 0;

                // find common prefix
                COMMON_PREFIX: while ( true ) {
                    let segmentSource;

                    for ( const pattern of patterns ) {
                        if ( segmentSource === undefined ) {
                            if ( commonPrefixIndex === pattern.sources.length ) {
                                break COMMON_PREFIX;
                            }

                            segmentSource = pattern.sources[ commonPrefixIndex ];
                        }
                        else if ( segmentSource !== pattern.sources[ commonPrefixIndex ] ) {
                            break COMMON_PREFIX;
                        }
                    }

                    commonPrefixIndex++;
                }

                // has common prefix
                if ( commonPrefixIndex ) {
                    const commonPrefix = patterns[ 0 ].sources.slice( 0, commonPrefixIndex ).join( "" );

                    source = prefixSource + commonPrefix + "(?:" + patterns.map( pattern => pattern.sources.slice( commonPrefixIndex ).join( "" ) ).join( "|" ) + ")";
                }
                else {
                    source = prefixSource + "(?:" + patterns.map( pattern => pattern.sources.join( "" ) ).join( "|" ) + ")";
                }
            }
        }

        return new RegExp( "^" + source + "$", "v" );
    }

    #splitPatternToSegments ( pattern ) {
        let segments = [],
            segment = "";

        for ( const char of pattern ) {
            if ( char === "/" ) {
                if ( segment ) {
                    segments.push( segment );
                    segment = "";
                }

                // do not add `/` twice
                if ( segments.at( -1 ) !== "/" ) {
                    segments.push( "/" );
                }
            }
            else {
                segment += char;
            }
        }

        if ( segment ) {
            segments.push( segment );
        }

        // combine globstar segments
        if ( this.#allowGlobstar ) {
            const combined = [];

            let separators = [];

            const flushSeparators = () => {
                if ( !separators.length ) return;

                if ( separators.length === 1 ) {
                    combined.push( separators[ 0 ] );
                }
                else if ( separators.length === 2 ) {
                    combined.push( separators.join( "" ) );
                }
                else if ( separators[ 0 ] === "/" ) {
                    if ( separators.at( -1 ) === "/" ) {
                        combined.push( "/**/" );
                    }
                    else {
                        combined.push( "/**" );
                    }
                }
                else {
                    if ( separators.at( -1 ) === "/" ) {
                        combined.push( "**/" );
                    }
                    else {
                        combined.push( "**" );
                    }
                }

                separators = [];
            };

            for ( const segment of segments ) {
                if ( segment === "/" || segment === "**" ) {
                    separators.push( segment );
                }
                else {
                    flushSeparators();

                    combined.push( segment );
                }
            }

            flushSeparators();

            segments = combined;
        }

        return segments;
    }

    #segmentToSource ( pattern, sequences, inExtGlob = false ) {
        let source = "",
            n = 0;

        while ( n < pattern.length ) {
            const char = pattern[ n ];

            // braces sequence substitution
            if ( char === "\0" && this.#allowBraces ) {
                const id = pattern.slice( n + 1, n + 37 );

                const sequenceRegExp = sequences[ id ];

                if ( sequenceRegExp ) {
                    source += sequenceRegExp;
                    this.#isStatic = false;

                    n += 37;
                    continue;
                }
            }

            // escaped character
            if ( char === "\\" ) {
                source += this.#escapeRegExpChar( pattern[ n + 1 ] ?? "\\" );
                n += 2;
                continue;
            }

            // extglob: `@(...)`, `!(...)`, `+(...)`, `*(...)`, `?(...)`
            if ( this.#allowExtGlob && "@!+*?".includes( char ) && pattern[ n + 1 ] === "(" ) {
                const end = this.#findClosingParen( pattern, n + 1 );

                if ( end === -1 && this.#strict ) {
                    throw new Error( `Unclosed extglob group in glob pattern: "${ pattern.slice( n ) }"` );
                }

                if ( end !== -1 ) {
                    const body = pattern.slice( n + 2, end );

                    source += this.#extglobToSource( char, body, sequences );
                    this.#isStatic = false;
                    n = end + 1;
                    continue;
                }
            }

            if ( this.#allowGlob && char === "*" ) {
                let runEnd = n + 1;

                while ( pattern[ runEnd ] === "*" ) runEnd++;

                const wholeSegment = n === 0 && runEnd >= pattern.length;

                source += wholeSegment && !inExtGlob
                    ? "[^\\/]+"
                    : "[^\\/]*";

                this.#isStatic = false;

                n = runEnd;

                continue;
            }

            // single-character wildcard
            if ( this.#allowGlob && char === "?" ) {
                source += "[^\\/]";
                this.#isStatic = false;
                n++;
                continue;
            }

            // character class
            if ( this.#allowBrackets && char === "[" ) {
                const bracket = this.#readBracket( pattern, n );

                if ( bracket ) {
                    source += bracket.source;
                    this.#isStatic = false;
                    n = bracket.next;
                    continue;
                }
            }

            source += this.#escapeRegExpChar( char );
            n++;
        }

        return source;
    }

    #extglobToSource ( type, body, sequences ) {
        const alternatives = this.#splitExtGlobBody( body ).map( alternative => this.#segmentToSource( alternative, sequences, true ) ),
            group = "(?:" + alternatives.join( "|" ) + ")";

        let source;

        if ( type === "@" ) {
            source = group;
        }
        else if ( type === "+" ) {
            source = group + "+";
        }
        else if ( type === "*" ) {
            source = group + "*";
        }
        else if ( type === "?" ) {
            source = group + "?";
        }
        else {

            // "!(...)": approximated as "any run of characters that never starts a match of the alternatives"
            source = "(?:(?!" + group + ")[^\\/])*";
        }

        return source;
    }

    #splitExtGlobBody ( body ) {
        const parts = [];

        let start = 0,
            maxDepth = 0;

        for ( let n = 0; n < body.length; n++ ) {
            if ( body[ n ] === "\\" ) {
                n++;
                continue;
            }

            if ( body[ n ] === "(" ) {
                maxDepth++;
            }
            else if ( body[ n ] === ")" ) {
                maxDepth--;
            }
            else if ( maxDepth === 0 && body[ n ] === "|" ) {
                parts.push( body.slice( start, n ) );
                start = n + 1;
            }
        }

        parts.push( body.slice( start ) );

        return parts;
    }

    #findClosingParen ( pattern, start ) {
        let maxDepth = 0;

        for ( let n = start; n < pattern.length; n++ ) {
            if ( pattern[ n ] === "\\" ) {
                n++;
                continue;
            }

            if ( pattern[ n ] === "(" ) {
                maxDepth++;
            }
            else if ( pattern[ n ] === ")" ) {
                maxDepth--;

                if ( maxDepth === 0 ) {
                    return n;
                }
            }
        }

        return -1;
    }

    #readBracket ( pattern, start ) {
        let n = start + 1;

        const negated = pattern[ n ] === "!" || pattern[ n ] === "^";

        if ( negated ) {
            n++;
        }

        const contentStart = n;

        // leading `]` is a literal member of the class
        if ( pattern[ n ] === "]" ) {
            n++;
        }

        while ( n < pattern.length && pattern[ n ] !== "]" ) {
            if ( pattern[ n ] === "\\" ) {
                n += 2;
                continue;
            }

            // POSIX class token, e.g. `[:upper:]` - skip as a unit so its
            // internal `]` isn't mistaken for the bracket's closing `]`
            if ( pattern[ n ] === "[" && pattern[ n + 1 ] === ":" ) {
                const end = pattern.indexOf( ":]", n + 2 );

                if ( end !== -1 ) {
                    n = end + 2;
                    continue;
                }
            }

            n++;
        }

        if ( pattern[ n ] !== "]" ) {
            if ( this.#strict ) {
                throw new Error( `Unclosed bracket expression in glob pattern: "${ pattern.slice( start ) }"` );
            }

            return null;
        }

        const content = this.#classContentToSource( pattern.slice( contentStart, n ) );

        if ( content === null ) {
            return null;
        }

        return {
            "source": "[" + ( negated
                ? "^"
                : "" ) + content + "]",
            "next": n + 1,
        };
    }

    #classContentToSource ( content ) {
        const rawTokens = [];

        for ( let n = 0; n < content.length; n++ ) {

            // POSIX class, e.g. `[:upper:]`
            if ( content[ n ] === "[" && content[ n + 1 ] === ":" ) {
                const end = content.indexOf( ":]", n + 2 );

                if ( end !== -1 ) {
                    const name = content.slice( n + 2, end ),
                        posixClass = POSIX_CLASSES[ name ];

                    if ( posixClass ) {
                        rawTokens.push( { "type": "posixClass", "value": posixClass } );
                        n = end + 1;
                        continue;
                    }
                    else {
                        if ( this.#strict ) {
                            throw new Error( `Invalid POSIX character class name in glob pattern: "[:${ name }:]"` );
                        }

                        return null;
                    }
                }
            }

            if ( content[ n ] === "\\" ) {
                rawTokens.push( { "type": "char", "value": content[ n + 1 ] ?? "\\" } );
                n++;
                continue;
            }

            rawTokens.push( { "type": content[ n ] === "-"
                ? "dash"
                : "char", "value": content[ n ] } );
        }

        // group `atom, dash, atom` triples into range tokens; a leading or
        // trailing dash, or one next to a POSIX class, stays a literal `-`
        const tokens = [];

        for ( let n = 0; n < rawTokens.length; n++ ) {
            const token = rawTokens[ n ];

            if ( token.type === "dash" && n > 0 && n < rawTokens.length - 1 && rawTokens[ n - 1 ].type === "char" && rawTokens[ n + 1 ].type === "char" ) {
                const start = tokens.pop().value;

                tokens.push( { "type": "range", "start": start, "end": rawTokens[ n + 1 ].value } );
                n++;
                continue;
            }

            tokens.push( token );
        }

        // sort literal characters and ranges by their starting codepoint so
        // that classes written in different orders (`[bac]` vs `[abc]`,
        // `[0-9a-z]` vs `[a-z0-9]`) produce identical regex source; POSIX
        // classes aren't single codepoints, so they keep their relative
        // order and are placed after the sorted chars/ranges
        const posixTokens = tokens.filter( token => token.type === "posixClass" ),
            orderedTokens = tokens
                .filter( token => token.type !== "posixClass" )
                .sort( ( a, b ) => {
                    const aCode = ( a.type === "range"
                            ? a.start
                            : a.value ).codePointAt( 0 ),
                        bCode = ( b.type === "range"
                            ? b.start
                            : b.value ).codePointAt( 0 );

                    return aCode - bCode;
                } )
                .concat( posixTokens );

        let source = "";

        for ( const token of orderedTokens ) {
            if ( token.type === "posixClass" ) {

                // already a valid, unescaped regex character range -
                // inserting it through #escapeClassChar would break its
                // internal `-`
                source += token.value;
            }
            else if ( token.type === "range" ) {

                // `/` may never appear in a bracket expression; written
                // literally as a range endpoint it invalidates the whole
                // bracket unless strict mode requires it to error instead
                if ( token.start === "/" || token.end === "/" ) {
                    if ( this.#strict ) {
                        throw new Error( `Bracket expression range must not contain "/": "${ token.start }-${ token.end }"` );
                    }

                    return null;
                }

                source += this.#rangeToSource( token.start, token.end );
            }
            else {

                // `/` written as a standalone literal member - invalid bracket
                if ( token.value === "/" ) {
                    if ( this.#strict ) {
                        throw new Error( 'Bracket expression must not contain "/"' );
                    }

                    return null;
                }

                source += this.#escapeClassChar( token.value );
            }
        }

        return source;
    }

    #rangeToSource ( start, end ) {
        const startCode = start.codePointAt( 0 ),
            endCode = end.codePointAt( 0 );

        // the range spans over `/` without naming it explicitly - `/` may
        // never appear in a bracket expression; in strict mode that's an
        // error, otherwise split the range around that codepoint to
        // exclude it
        if ( startCode < FORWARD_SLASH_CODE && endCode > FORWARD_SLASH_CODE ) {
            if ( this.#strict ) {
                throw new Error( `Bracket expression range must not contain "/": "${ start }-${ end }"` );
            }

            return this.#rangeToSource( start, String.fromCodePoint( FORWARD_SLASH_CODE - 1 ) ) + this.#rangeToSource( String.fromCodePoint( FORWARD_SLASH_CODE + 1 ), end );
        }

        if ( startCode === endCode ) {
            return this.#escapeClassChar( start );
        }

        return this.#escapeClassChar( start ) + "-" + this.#escapeClassChar( end );
    }

    #escapeClassChar ( char ) {
        return CLASS_CHAR_ESCAPE_SET.has( char )
            ? "\\" + char
            : char;
    }

    #escapeRegExp ( string ) {
        return string.replaceAll( REGEXP_ESCAPE_RE, "\\$&" );
    }

    #escapeRegExpChar ( char ) {
        return REGEXP_ESCAPE_SET.has( char )
            ? "\\" + char
            : char;
    }
}
