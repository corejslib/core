import semver from "semver";
import SemanticVersion from "#lib/semantic-version";

const REGEXP = new RegExp( String.raw`^` + //
        String.raw`(?<operator><=|>=|<|>|=|~|\^)?` +
        String.raw`v?` +
        String.raw`(?<major>(?:[*Xx]|0|[1-9]\d*))` +
        String.raw`(?:\.(?<minor>(?:[*Xx]|0|[1-9]\d*)))?` +
        String.raw`(?:\.(?<patch>(?:[*Xx]|0|[1-9]\d*)))?` +
        String.raw`(?:-(?<preRelease>(?:[\dA-Za-z-]+(?:\.[\dA-Za-z-]+)*)))?` +
        String.raw`(?:\+(?<build>(?:[\dA-Za-z-]+(?:\.[\dA-Za-z-]+)*)))?` +
        String.raw`$` );

export default class SemanticVersionRange {
    #includePreRelease;
    #range;
    #semverRange;
    #hasPreReleaseDependencies = false;
    #isSimple = true;
    #operator;
    #version;

    constructor ( range, { includePreRelease } = {} ) {
        this.#includePreRelease = Boolean( includePreRelease );

        this.#parse( range );
    }

    // static
    static new ( range, { includePreRelease } = {} ) {
        if ( range instanceof SemanticVersionRange ) {
            return range;
        }
        else {
            return new this( range, { includePreRelease } );
        }
    }

    static isValid ( range ) {
        if ( range instanceof SemanticVersionRange ) return true;

        try {
            new this( range );

            return true;
        }
        catch {
            return false;
        }
    }

    // properties
    get includePreRelease () {
        return this.#includePreRelease;
    }

    get range () {
        return this.#range;
    }

    get hasPreReleaseDependencies () {
        return this.#hasPreReleaseDependencies;
    }

    get isSimple () {
        return this.#isSimple;
    }

    get operator () {
        return this.#operator;
    }

    get version () {
        return this.#version;
    }

    // public
    test ( version ) {
        if ( version instanceof SemanticVersion ) {
            version = version.version;
        }

        return this.#semverRange.test( version );
    }

    toString () {
        return this.#range;
    }

    toJSON () {
        return this.#range;
    }

    [ Symbol.for( "nodejs.util.inspect.custom" ) ] ( depth, options, inspect ) {
        const spec = {
            "range": this.range,
        };

        return `${ this.constructor.name }: ${ inspect( spec ) }`;
    }

    // private
    #parse ( range ) {
        const sets = [];

        range = range
            .replaceAll( / +/g, " " )
            .replaceAll( /(<=|>=|<|>|=|~|\^) /g, "$1" )
            .trim();

        for ( const set of range.split( / *\|\| */ ) ) {
            if ( !set ) throw "Semantic version range is not valid";

            const rules = set.split( " " ),
                currentSet = [];

            for ( let n = 0; n < rules.length; n++ ) {
                const rule = rules[ n ];

                // range
                if ( rules[ n + 1 ] === "-" ) {
                    const rule1 = this.#parseRule( rule ),
                        rule2 = this.#parseRule( rules[ n + 2 ] );

                    n += 2;

                    const ruleText = `${ rule1.rule } - ${ rule2.rule }`;

                    if ( ( rule1.operator && rule1.operator !== "=" ) || ( rule2.operator && rule2.operator !== "=" ) ) {
                        throw `Semantic version range rule "${ ruleText }" is not valid`;
                    }

                    currentSet.push( {
                        "rule": ruleText,
                        "operator": "-",
                        "version": null,
                    } );
                }
                else {
                    currentSet.push( this.#parseRule( rule ) );
                }
            }

            sets.push( currentSet );
        }

        this.#range = sets.map( set => set.map( rule => rule.rule ).join( " " ) ).join( " || " );

        if ( sets.length > 1 ) {
            this.#isSimple = false;
        }
        else if ( sets[ 0 ].length > 1 ) {
            this.#isSimple = false;
        }
        else if ( sets[ 0 ][ 0 ].operator === "-" ) {
            this.#isSimple = false;
        }

        if ( this.#isSimple ) {
            this.#operator = sets[ 0 ][ 0 ].operator;
            this.#version = new SemanticVersion( sets[ 0 ][ 0 ].version );
        }

        this.#semverRange = new semver.Range( this.#range, {
            "includePrerelease": this.#includePreRelease,
        } );
    }

    #parseRule ( rule ) {
        const match = REGEXP.exec( rule );
        if ( !match ) throw `Semantic version range rule "${ rule }" is not valid`;

        var operator = match.groups.operator ?? "",
            version = rule.slice( operator.length, match.groups.build
                ? -( match.groups.build.length + 1 )
                : undefined );

        if ( match.groups.preRelease ) this.#hasPreReleaseDependencies = true;

        return {
            "rule": operator === "="
                ? version
                : operator + version,
            "operator": operator || "=",
            version,
        };
    }
}
