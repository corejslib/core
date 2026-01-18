const REGEXP = new RegExp( String.raw`^` + //
        String.raw`v?` +
        String.raw`(?<major>(?:0|[1-9]\d*))` +
        String.raw`(?:\.(?<minor>(?:0|[1-9]\d*)))?` +
        String.raw`(?:\.(?<patch>(?:0|[1-9]\d*)))?` +
        String.raw`(?:-(?<preRelease>(?:[\dA-Za-z-]+(?:\.[\dA-Za-z-]+)*)))?` +
        String.raw`(?:\+(?<build>(?:[\dA-Za-z-]+(?:\.[\dA-Za-z-]+)*)))?` +
        String.raw`$` );

function throwParsingError ( version ) {
    throw new Error( `Semantic version is not valid: "${ version }"` );
}

export default class SemanticVersion {
    #majorNumber;
    #minorNumber;
    #patchNumber;
    #preRelease;
    #preReleaseTags;
    #preReleaseTag;
    #preReleaseNumber;
    #build;
    #stableVersion;
    #version;

    constructor ( version, { build } = {} ) {
        const match = REGEXP.exec( String( version ) );

        if ( !match ) {
            throwParsingError( version );
        }

        this.#majorNumber = Number( match.groups.major );
        this.#minorNumber = Number( match.groups.minor ?? 0 );
        this.#patchNumber = Number( match.groups.patch ?? 0 );

        // pre-release
        if ( match.groups.preRelease ) {
            const tags = match.groups.preRelease.split( "." );

            for ( let n = 0; n < tags.length; n++ ) {
                const tag = tags[ n ];

                // numeric tag, should not start with "0"
                if ( tag === "0" || /^[1-9]\d*$/.test( tag ) ) {
                    tags[ n ] = Number( tag );
                }
            }

            this.#preRelease = match.groups.preRelease;
            this.#preReleaseTags = tags;
        }

        // build
        if ( build !== false && match.groups.build ) {
            this.#build = match.groups.build;
        }
    }

    // static
    static new ( version, { build } = {} ) {
        if ( version instanceof this ) {
            return version;
        }
        else {
            return new this( version, { build } );
        }
    }

    static isValid ( version ) {
        try {
            this.new( version );

            return true;
        }
        catch {
            return false;
        }
    }

    static compare ( a, b ) {
        return this.new( a ).compare( b );
    }

    static get comparator () {
        return this.compare.bind( this );
    }

    static get initialVersion () {
        return new this( "0" );
    }

    // properties
    get isInitialVersion () {
        return Boolean( !this.majorNumber && !this.minorNumber && !this.patchNumber );
    }

    get isMajor () {
        return Boolean( this.majorNumber && !this.minorNumber && !this.patchNumber );
    }

    get isMinor () {
        return Boolean( this.minorNumber && !this.patchNumber );
    }

    get isPatch () {
        return Boolean( this.patchNumber || ( !this.majorNumber && !this.minorNumber ) );
    }

    get isStableRelease () {
        return !this.isPreRelease;
    }

    get isPreRelease () {
        return Boolean( this.preRelease );
    }

    get majorNumber () {
        return this.#majorNumber;
    }

    get minorNumber () {
        return this.#minorNumber;
    }

    get patchNumber () {
        return this.#patchNumber;
    }

    get preRelease () {
        return this.#preRelease;
    }

    get preReleaseTag () {
        if ( this.#preReleaseTag === undefined ) {
            this.#preReleaseTag = null;

            if ( this.preReleaseNumber != null ) {
                if ( typeof this.#preReleaseTags?.at( -2 ) === "string" ) {
                    this.#preReleaseTag = this.#preReleaseTags.at( -2 );
                }
            }
            else if ( typeof this.#preReleaseTags?.at( -1 ) === "string" ) {
                this.#preReleaseTag = this.#preReleaseTags.at( -1 );
            }
        }

        return this.#preReleaseTag;
    }

    get preReleaseNumber () {
        if ( this.#preReleaseNumber === undefined ) {
            this.#preReleaseNumber = null;

            if ( typeof this.#preReleaseTags?.at( -1 ) === "number" ) {
                this.#preReleaseNumber = this.#preReleaseTags.at( -1 );
            }
        }

        return this.#preReleaseNumber;
    }

    get build () {
        return this.#build;
    }

    get stableVersion () {
        if ( !this.#stableVersion ) {
            if ( this.isPreRelease ) {
                this.#stableVersion = new this.constructor( `${ this.#majorNumber }.${ this.#minorNumber }.${ this.#patchNumber }` );
            }
            else {
                this.#stableVersion = this;
            }
        }

        return this.#stableVersion;
    }

    get version () {
        if ( this.#version == null ) {
            this.#version = `${ this.#majorNumber }.${ this.#minorNumber }.${ this.#patchNumber }`;

            if ( this.#preRelease ) {
                this.#version += `-${ this.#preRelease }`;
            }

            if ( this.#build ) {
                this.#version += `+${ this.#build }`;
            }
        }

        return this.#version;
    }

    get versionString () {
        return "v" + this.toString();
    }

    // public
    toString () {
        return this.version;
    }

    toJSON () {
        return this.toString();
    }

    increment ( type, { preReleaseTag, defaultPreReleaseTag } = {} ) {
        var version, preReleaseTagRequired;

        // major changed
        if ( type === "major" ) {

            // major-pre + major = major
            if ( this.isMajor && this.isPreRelease ) {
                version = this.stableVersion.version;
            }

            // major + major = major + 1
            else {
                version = `${ this.majorNumber + 1 }.0.0`;

                if ( this.isPreRelease ) {
                    preReleaseTagRequired = true;
                }
            }
        }

        // minor changes
        else if ( type === "minor" ) {

            // major + minor
            if ( this.isMajor ) {

                // 1.0.0-a.0 + 0.1.0 = 1.0.0-a.1
                if ( this.isPreRelease ) {
                    version = this.stableVersion.version;
                }

                // 1.0.0 + 0.1.0 = 1.1.0
                else {
                    version = `${ this.majorNumber }.1.0`;
                }
            }

            // minor + minor
            else if ( this.isMinor ) {

                // 1.1.0-a.0 + 0.1.0 = 1.1.0-a.1
                if ( this.isPreRelease ) {
                    version = this.stableVersion.version;
                }

                // 1.1.0 + 0.1.0 = 1.2.0
                else {
                    version = `${ this.majorNumber }.${ this.minorNumber + 1 }.0`;
                }
            }

            // minor + patch
            else if ( this.isPatch ) {

                // 1.1.1-a.0 + 0.1.0 = 1.2.0-a.0
                if ( this.isPreRelease ) {
                    version = `${ this.majorNumber }.${ this.minorNumber + 1 }.0`;

                    preReleaseTagRequired = true;
                }

                // 1.1.1 + 0.1.0 = 1.2.0
                else {
                    version = `${ this.majorNumber }.${ this.minorNumber + 1 }.0`;
                }
            }
        }

        // patch changes
        else if ( type === "patch" ) {

            // major + patch
            if ( this.isMajor ) {

                // 1.0.0-a.0 + 0.0.1 = 1.0.0-a.1
                if ( this.isPreRelease ) {
                    version = this.stableVersion.version;
                }

                // 1.0.0 + 0.0.1 = 1.0.1
                else {
                    version = `${ this.majorNumber }.0.1`;
                }
            }

            // minor + patch
            else if ( this.isMinor ) {

                // 1.1.0-a.0 + 0.0.1 = 1.1.0-a.1
                if ( this.isPreRelease ) {
                    version = this.stableVersion.version;
                }

                // 1.1.0 + 0.0.1 = 1.1.1
                else {
                    version = `${ this.majorNumber }.${ this.minorNumber }.1`;
                }
            }

            // patch + patch
            else if ( this.isPatch ) {

                // 1.1.1-a.0 + 0.0.1 = 1.1.1-a.1
                if ( this.isPreRelease ) {
                    version = this.stableVersion.version;
                }

                // 1.1.1 + 0.0.1 = 1.1.2
                else {
                    version = `${ this.majorNumber }.${ this.minorNumber }.${ this.patchNumber + 1 }`;
                }
            }
        }

        // type error
        else {
            throw new Error( "Increment type is not valid" );
        }

        // pre-release
        if ( this.isPreRelease ) {
            if ( preReleaseTag !== false ) {

                // preRelease is required
                if ( preReleaseTagRequired ) {
                    preReleaseTag ||= defaultPreReleaseTag;

                    if ( !preReleaseTag ) {
                        throw new Error( "Pre-release tag is required" );
                    }
                }

                // set pre-release tag
                if ( preReleaseTag ) {

                    // continue current pre-release
                    if ( !preReleaseTagRequired && preReleaseTag === this.preReleaseTag ) {
                        if ( this.preReleaseNumber != null ) {
                            version += "-" + preReleaseTag + "." + ( this.preReleaseNumber + 1 );
                        }
                        else {
                            version += "-" + preReleaseTag + ".0";
                        }
                    }

                    // start new pre-release
                    else {
                        version += "-" + preReleaseTag + ".0";
                    }
                }

                // continue pre-release tag
                else {
                    if ( this.preReleaseNumber != null ) {
                        version += "-" + this.preReleaseTag + "." + ( this.preReleaseNumber + 1 );
                    }
                    else {
                        version += "-" + this.preReleaseTag + ".0";
                    }
                }
            }
        }

        // stable
        else {

            // stable + pre-release = stable-pre.0
            if ( preReleaseTag ) {
                version += "-" + preReleaseTag + ".0";
            }
        }

        version = this.constructor.new( version );

        // check, that new version > old version (required to compare pre-releases)
        if ( this.gte( version ) ) {
            throw new Error( `New version "${ version }" should be greater than old version "${ this }"` );
        }

        return version;
    }

    compare ( version ) {
        version = this.constructor.new( version );

        if ( this.majorNumber < version.majorNumber ) {
            return -1;
        }
        else if ( this.majorNumber > version.majorNumber ) {
            return 1;
        }
        else if ( this.minorNumber < version.minorNumber ) {
            return -1;
        }
        else if ( this.minorNumber > version.minorNumber ) {
            return 1;
        }
        else if ( this.patchNumber < version.patchNumber ) {
            return -1;
        }
        else if ( this.patchNumber > version.patchNumber ) {
            return 1;
        }
        else {
            return this.#comparePreRelease( version );
        }
    }

    eq ( version ) {
        return this.compare( version ) === 0;
    }

    ne ( version ) {
        return this.compare( version ) !== 0;
    }

    lt ( version ) {
        return this.compare( version ) < 0;
    }

    lte ( version ) {
        return this.compare( version ) <= 0;
    }

    gt ( version ) {
        return this.compare( version ) > 0;
    }

    gte ( version ) {
        return this.compare( version ) >= 0;
    }

    [ Symbol.for( "nodejs.util.inspect.custom" ) ] ( depth, options, inspect ) {
        const spec = {
            "version": this.version,
        };

        return `${ this.constructor.name }: ${ inspect( spec ) }`;
    }

    // private
    #comparePreRelease ( version ) {
        const preRelease = version.preRelease?.split( "." );

        if ( this.preRelease ) {
            if ( preRelease ) {
                const length = Math.min( this.#preReleaseTags.length, preRelease.length );

                let n = 0;

                for ( ; n < length; n++ ) {
                    const a = this.#preReleaseTags[ n ];

                    let b = preRelease[ n ];

                    if ( typeof b !== "number" ) {
                        b = Number( b );

                        if ( Number.isNaN( b ) ) {
                            b = preRelease[ n ];
                        }
                    }

                    if ( typeof a === "number" ) {

                        // identifiers consisting of only digits are compared numerically
                        if ( typeof b === "number" ) {
                            if ( a < b ) {
                                return -1;
                            }
                            else if ( a > b ) {
                                return 1;
                            }
                        }

                        // identifiers with letters or hyphens are compared lexically in ASCII sort order
                        else {
                            return -1;
                        }
                    }

                    // identifiers with letters or hyphens are compared lexically in ASCII sort order
                    else if ( typeof b === "number" ) {
                        return 1;
                    }

                    // identifiers with letters or hyphens are compared lexically in ASCII sort order
                    else {
                        if ( a < b ) {
                            return -1;
                        }
                        else if ( a > b ) {
                            return 1;
                        }
                    }
                }

                // a larger set of pre-release fields has a higher precedence
                // than a smaller set, if all of the preceding identifiers are equal
                if ( preRelease.length > n ) {
                    return -1;
                }
                else if ( this.#preReleaseTags.length > n ) {
                    return 1;
                }
                else {
                    return 0;
                }
            }
            else {
                return -1;
            }
        }
        else if ( preRelease ) {
            return 1;
        }
        else {
            return 0;
        }
    }
}
