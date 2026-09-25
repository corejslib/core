import CacheLru from "#lib/cache/lru";
import { readConfigSync } from "#lib/config";
import externalResources from "#lib/external-resources";

const CACHE = new CacheLru( { "maxSize": 1000 } ),
    RESOURCE = await externalResources
        .add( "corejslib/core/resources/user-agent" )
        .on( "update", resource => {
            CACHE.clear();

            resource.data = null;
        } )
        .check(),
    CHROMIUM_BRANDS = {
        "chromium": {
            "id": "chromium",
            "name": "Chromium",
            "fullName": "Chromium",
        },
        "chrome": {
            "id": "chrome",
            "name": "Chrome",
            "fullName": "Google Chrome",
        },
        "msedge": {
            "id": "msedge",
            "name": "Edge",
            "fullName": "Microsoft Edge",
        },
    },
    BROWSER_FAMILY_BRANDS = {
        "chromium": CHROMIUM_BRANDS[ "chromium" ],
        "chrome": CHROMIUM_BRANDS[ "chrome" ],
        "chrome mobile": CHROMIUM_BRANDS[ "chrome" ],
        "msedge": CHROMIUM_BRANDS[ "msedge" ],
        "edge": CHROMIUM_BRANDS[ "msedge" ],
        "edge mobile": CHROMIUM_BRANDS[ "msedge" ],
    },
    PLATFORMS = {
        "android": {
            "id": "android",
            "mobile": true,
            "chromium": "Linux; Android 10; K",
            "navigator": "Linux armv81",
            "sec-ch-ua-platform": "Android",
        },
        "ios": {
            "id": "ios",
            "mobile": true,
            "chromium": null,
            "navigator": "iOS",
            "sec-ch-ua-platform": "iOS",
            "webgl": {
                "vendor": "Apple Inc.",
                "renderer": "Apple GPU",
            },
        },
        "linux": {
            "id": "linux",
            "mobile": false,
            "chromium": "X11; Linux x86_64",
            "navigator": "Linux x86_64",
            "sec-ch-ua-platform": "Linux",
        },
        "macos": {
            "id": "macos",
            "mobile": false,
            "chromium": "Macintosh; Intel Mac OS X 10_15_7",
            "navigator": "MacIntel",
            "sec-ch-ua-platform": "macOS",
        },
        "windows": {
            "id": "windows",
            "mobile": false,
            "chromium": "Windows NT 10.0; Win64; x64",
            "navigator": "Win32",
            "sec-ch-ua-platform": "Windows",
        },
    },
    OS_FAMILY_PLATFORM = {
        "android": PLATFORMS[ "android" ],
        "ios": PLATFORMS[ "ios" ],
        "linux": PLATFORMS[ "linux" ],
        "macos": PLATFORMS[ "macos" ],
        "mac os x": PLATFORMS[ "macos" ],
        "windows": PLATFORMS[ "windows" ],
    },
    WEBGL_DEFAULT = {
        "vendor": "Intel Inc.",
        "renderer": "Intel Iris OpenGL Engine",
    },
    CHROMIUM_BRANDS_ORDER = {
        "1": [
            [ 0, 1 ],
            [ 1, 0 ],
        ],
        "2": [
            [ 0, 1, 2 ],
            [ 0, 2, 1 ],
            [ 1, 0, 2 ],
            [ 1, 2, 0 ],
            [ 2, 0, 1 ],
            [ 2, 1, 0 ],
        ],
        "3": [
            [ 0, 1, 2, 3 ],
            [ 0, 1, 3, 2 ],
            [ 0, 2, 1, 3 ],
            [ 0, 2, 3, 1 ],
            [ 0, 3, 1, 2 ],
            [ 0, 3, 2, 1 ],
            [ 1, 0, 2, 3 ],
            [ 1, 0, 3, 2 ],
            [ 1, 2, 0, 3 ],
            [ 1, 2, 3, 0 ],
            [ 1, 3, 0, 2 ],
            [ 1, 3, 2, 0 ],
            [ 2, 0, 1, 3 ],
            [ 2, 0, 3, 1 ],
            [ 2, 1, 0, 3 ],
            [ 2, 1, 3, 0 ],
            [ 2, 3, 0, 1 ],
            [ 2, 3, 1, 0 ],
            [ 3, 0, 1, 2 ],
            [ 3, 0, 2, 1 ],
            [ 3, 1, 0, 2 ],
            [ 3, 1, 2, 0 ],
            [ 3, 2, 0, 1 ],
            [ 3, 2, 1, 0 ],
        ],
    };

function getResources ( name ) {
    RESOURCE.data ??= readConfigSync( RESOURCE.getResourcePath( "regexes.json" ) );

    if ( !( RESOURCE.data[ name ][ 0 ][ 0 ] instanceof RegExp ) ) {
        for ( const row of RESOURCE.data[ name ] ) {
            if ( Array.isArray( row[ 0 ] ) ) {
                row[ 0 ] = new RegExp( ...row[ 0 ] );
            }
            else {
                row[ 0 ] = new RegExp( row[ 0 ] );
            }
        }
    }

    return RESOURCE.data[ name ];
}

class UserAgentData {
    #userAgent;

    constructor ( userAgent ) {
        this.#userAgent = userAgent;
    }

    // properties
    get userAgent () {
        return this.#userAgent;
    }
}

class UserAgentBrowser extends UserAgentData {
    #parsed;
    #family = null;
    #majorVersion = null;
    #version = null;
    #name;

    // properties
    get family () {
        if ( !this.#parsed ) this.#parse();

        return this.#family;
    }

    get majorVersion () {
        if ( !this.#parsed ) this.#parse();

        return this.#majorVersion;
    }

    get version () {
        if ( !this.#parsed ) this.#parse();

        return this.#version;
    }

    get name () {
        if ( this.#name === undefined ) {
            this.#name = null;

            if ( this.family ) {
                this.#name = this.family;

                if ( this.version ) {
                    this.#name += " " + this.version;
                }
            }
        }

        return this.#name;
    }

    // public
    toString () {
        return this.name ?? "";
    }

    toJSON () {
        return {
            "family": this.family,
            "majorVersion": this.majorVersion,
            "version": this.version,
        };
    }

    // private
    #parse () {
        if ( this.#parsed ) return;
        this.#parsed = true;

        const userAgent = this.userAgent.userAgent;
        if ( !userAgent ) return;

        for ( const row of getResources( "browser" ) ) {
            const match = row[ 0 ].exec( userAgent );

            if ( match ) {
                this.#family = row[ 1 ]?.replaceAll( /\$(\d+)/gv, ( string, index ) => match[ index ] ) ?? match[ 1 ];

                const major = row[ 2 ]?.replaceAll( /\$(\d+)/gv, ( string, index ) => match[ index ] ) ?? match[ 2 ] ?? null,
                    minor = row[ 3 ]?.replaceAll( /\$(\d+)/gv, ( string, index ) => match[ index ] ) ?? match[ 3 ] ?? null,
                    patch = row[ 4 ]?.replaceAll( /\$(\d+)/gv, ( string, index ) => match[ index ] ) ?? match[ 4 ] ?? null,
                    build = row[ 5 ]?.replaceAll( /\$(\d+)/gv, ( string, index ) => match[ index ] ) ?? match[ 5 ] ?? null;

                if ( major == null ) {
                    this.#majorVersion = null;
                    this.#version = null;
                }
                else {
                    this.#majorVersion = +major;

                    this.#version = major;

                    if ( minor != null ) {
                        this.#version += "." + minor;

                        if ( patch != null ) {
                            this.#version += "." + patch;

                            if ( build != null ) {
                                this.#version += "." + build;
                            }
                        }
                    }
                }

                break;
            }
        }
    }
}

class UserAgentOs extends UserAgentData {
    #parsed;
    #family = null;
    #majorVersion = null;
    #version = null;
    #name;

    // properties
    get family () {
        if ( !this.#parsed ) this.#parse();

        return this.#family;
    }

    get majorVersion () {
        if ( !this.#parsed ) this.#parse();

        return this.#majorVersion;
    }

    get version () {
        if ( !this.#parsed ) this.#parse();

        return this.#version;
    }

    get name () {
        if ( this.#name === undefined ) {
            this.#name = null;

            if ( this.family ) {
                this.#name = this.family;

                if ( this.version ) {
                    this.#name += " " + this.version;
                }
            }
        }

        return this.#name;
    }

    // public
    toString () {
        return this.name ?? "";
    }

    toJSON () {
        return {
            "family": this.family,
            "majorVersion": this.majorVersion,
            "version": this.version,
        };
    }

    // private
    #parse () {
        if ( this.#parsed ) return;
        this.#parsed = true;

        const userAgent = this.userAgent.userAgent;
        if ( !userAgent ) return;

        for ( const row of getResources( "os" ) ) {
            const match = row[ 0 ].exec( userAgent );

            if ( match ) {
                this.#family = row[ 1 ]?.replaceAll( /\$(\d+)/gv, ( string, index ) => match[ index ] ) ?? match[ 1 ];

                const major = row[ 2 ]?.replaceAll( /\$(\d+)/gv, ( string, index ) => match[ index ] ) ?? match[ 2 ] ?? null,
                    minor = row[ 3 ]?.replaceAll( /\$(\d+)/gv, ( string, index ) => match[ index ] ) ?? match[ 3 ] ?? null,
                    patch = row[ 4 ]?.replaceAll( /\$(\d+)/gv, ( string, index ) => match[ index ] ) ?? match[ 4 ] ?? null,
                    build = row[ 5 ]?.replaceAll( /\$(\d+)/gv, ( string, index ) => match[ index ] ) ?? match[ 5 ] ?? null;

                this.#majorVersion = major == null
                    ? null
                    : +major;

                if ( major == null ) {
                    this.#majorVersion = null;
                    this.#version = null;
                }
                else {
                    this.#majorVersion = +major;

                    this.#version = major;

                    if ( minor != null ) {
                        this.#version += "." + minor;

                        if ( patch != null ) {
                            this.#version += "." + patch;

                            if ( build != null ) {
                                this.#version += "." + build;
                            }
                        }
                    }
                }

                break;
            }
        }
    }
}

class UserAgentDevice extends UserAgentData {
    #parsed;
    #family = null;
    #vendor = null;
    #model = null;
    #name;

    // properties
    get family () {
        if ( !this.#parsed ) this.#parse();

        return this.#family;
    }

    get vendor () {
        if ( !this.#parsed ) this.#parse();

        return this.#vendor;
    }

    get model () {
        if ( !this.#parsed ) this.#parse();

        return this.#model;
    }

    get name () {
        if ( this.#name === undefined ) {
            this.#name = [ this.vendor, this.model ].filter( tag => tag ).join( " " ) || null;
        }

        return this.#name;
    }

    // public
    toString () {
        return this.name ?? "";
    }

    toJSON () {
        return {
            "family": this.family,
            "vendor": this.vendor,
            "model": this.model,
        };
    }

    // private
    #parse () {
        if ( this.#parsed ) return;
        this.#parsed = true;

        const userAgent = this.userAgent.userAgent;
        if ( !userAgent ) return;

        for ( const row of getResources( "device" ) ) {
            const match = row[ 0 ].exec( userAgent );

            if ( match ) {
                this.#family = row[ 1 ]?.replaceAll( /\$(\d+)/gv, ( string, index ) => match[ index ] ) ?? match[ 1 ] ?? null;

                this.#vendor = row[ 2 ]?.replaceAll( /\$(\d+)/gv, ( string, index ) => match[ index ] ) ?? match[ 2 ] ?? null;

                this.#model = row[ 3 ]?.replaceAll( /\$(\d+)/gv, ( string, index ) => match[ index ] ) ?? match[ 3 ] ?? null;

                break;
            }
        }
    }
}

export default class UserAgent {
    #userAgent;
    #reducedUserAgent;
    #isChromium;
    #chromiumBrand;
    #platform;
    #browser;
    #os;
    #device;

    constructor ( userAgent ) {
        this.#userAgent = userAgent;
    }

    // static
    static new ( userAgent ) {
        if ( userAgent instanceof this ) return userAgent;

        var ua = CACHE.get( userAgent );

        if ( !ua ) {
            ua = new this( userAgent );

            CACHE.set( userAgent, ua );
        }

        return ua;
    }

    static get chromiumBrands () {
        return CHROMIUM_BRANDS;
    }

    static get platforms () {
        return PLATFORMS;
    }

    // https://developers.google.com/privacy-sandbox/blog/user-agent-reduction-android-model-and-version
    static createChromiumUserAgentString ( brand, platform, userAgentVersion ) {
        const majorVersion = userAgentVersion.toString().split( ".", 1 )[ 0 ];

        // resolve brand
        brand = BROWSER_FAMILY_BRANDS[ brand.toLowerCase() ];
        if ( !brand ) throw new Error( "Chromium brand is not valid" );

        // resolve platform
        platform = OS_FAMILY_PLATFORM[ platform.toLowerCase() ];
        if ( !platform?.chromium ) throw new Error( "Chromium platform is not valid" );

        // chromium
        if ( brand.id === "chromium" ) {
            return `Mozilla/5.0 (${ platform.chromium }) AppleWebKit/537.36 (KHTML, like Gecko) Chromium/${ majorVersion }.0.0.0${ platform.mobile
                ? " Mobile"
                : "" } Safari/537.36`;
        }

        // chrome
        else if ( brand.id === "chrome" ) {
            return `Mozilla/5.0 (${ platform.chromium }) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${ majorVersion }.0.0.0${ platform.mobile
                ? " Mobile"
                : "" } Safari/537.36`;
        }

        // edge
        else if ( brand.id === "msedge" ) {

            // edge android
            if ( platform.id === "android" ) {
                return `Mozilla/5.0 (${ platform.chromium }) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${ majorVersion }.0.0.0${ platform.mobile
                    ? " Mobile"
                    : "" } Safari/537.36 EdgA/${ majorVersion }.0.0.0`;
            }

            // edge desktop
            else {
                return `Mozilla/5.0 (${ platform.chromium }) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${ majorVersion }.0.0.0${ platform.mobile
                    ? " Mobile"
                    : "" } Safari/537.36 Edg/${ majorVersion }.0.0.0`;
            }
        }
    }

    // https://source.chromium.org/chromium/chromium/src/+/master:components/embedder_support/user_agent_utils.cc;l=55-100
    static createChromiumBrands ( brands, userAgentVersion, useFullVersion ) {
        if ( !Array.isArray( brands ) ) brands = [ brands ];

        brands = new Set( brands.map( brand => BROWSER_FAMILY_BRANDS[ brand?.toLowerCase() ]?.fullName ).filter( brand => brand ) );

        if ( !brands.size || brands.size > 3 ) return [];

        brands.add( "Chromium" );

        const seed = Number( userAgentVersion.split( ".", 1 )[ 0 ] ),
            version = useFullVersion
                ? userAgentVersion
                : seed.toString(),
            order = CHROMIUM_BRANDS_ORDER[ brands.size ][ seed % CHROMIUM_BRANDS_ORDER[ brands.size ].length ],
            greaseyChars = [ " ", "(", ":", "-", ".", "/", ")", ";", "=", "?", "_" ],
            greasedVersions = [ "8", "99", "24" ],
            greasedBrandVersionList = [];

        brands.delete( "Chromium" );

        // add "Not A Brand"
        greasedBrandVersionList[ order[ 0 ] ] = {
            "brand": `Not${ greaseyChars[ seed % greaseyChars.length ] }A${ greaseyChars[ ( seed + 1 ) % greaseyChars.length ] }Brand`,
            "version": greasedVersions[ seed % greasedVersions.length ],
        };

        // add "Chromium" brand
        greasedBrandVersionList[ order[ 1 ] ] = {
            "brand": "Chromium",
            version,
        };

        // add other brands
        let n = 1;

        for ( const brand of brands ) {
            n += 1;

            greasedBrandVersionList[ order[ n ] ] = {
                brand,
                version,
            };
        }

        return greasedBrandVersionList;
    }

    // properties
    get userAgent () {
        return this.#userAgent;
    }

    get reducedUserAgent () {
        if ( this.#reducedUserAgent == null ) {
            if ( this.isChromium ) {
                this.#reducedUserAgent = this.constructor.createChromiumUserAgentString( this.browser.family, this.os.family, this.browser.version );
            }
            else {
                this.#reducedUserAgent = this.userAgent;
            }
        }

        return this.#reducedUserAgent;
    }

    get isChromium () {
        this.#isChromium ??= /chrom(?:e|ium)/iv.test( this.userAgent );

        return this.#isChromium;
    }

    get chromiumBrand () {
        if ( this.#chromiumBrand === undefined ) {
            this.#chromiumBrand = BROWSER_FAMILY_BRANDS[ this.browser.family?.toLowerCase() ] || null;
        }

        return this.#chromiumBrand;
    }

    get platform () {
        if ( this.#platform === undefined ) {
            this.#platform = OS_FAMILY_PLATFORM[ this.os.family?.toLowerCase() ] || null;
        }

        return this.#platform;
    }

    get webgl () {
        return this.platform?.webgl || WEBGL_DEFAULT;
    }

    get browser () {
        this.#browser ??= new UserAgentBrowser( this );

        return this.#browser;
    }

    get os () {
        this.#os ??= new UserAgentOs( this );

        return this.#os;
    }

    get device () {
        this.#device ??= new UserAgentDevice( this );

        return this.#device;
    }

    // public
    toString () {
        return this.userAgent;
    }

    toJSON () {
        return {
            "userAgent": this.userAgent,
            "isChromium": this.isChromium,
            "browser": this.browser.toJSON(),
            "os": this.os.toJSON(),
            "device": this.device.toJSON(),
        };
    }

    createChromiumBrands ( useFullVersion ) {
        return this.constructor.createChromiumBrands( this.browser.family, this.browser.version, useFullVersion );
    }

    [ Symbol.for( "nodejs.util.inspect.custom" ) ] ( depth, options, inspect ) {
        const spec = this.toJSON();

        return `${ this.constructor.name }: ${ inspect( spec ) }`;
    }
}
