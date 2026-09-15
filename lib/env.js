import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import xdg from "@corejslib/utils/env";
import env from "#lib/_browser/env";
import { readConfigSync } from "#lib/config";
import { mergeObjects } from "#lib/utils";

const USER_ENV_LOCATION = "corejslib";

class Env extends env.constructor {
    #root;
    #userEnv;
    #package;
    #buildVersion;
    #tmpdir;
    #isDocker;

    // properties
    get mode () {
        return super.mode;
    }

    get isBrowser () {
        return false;
    }

    get root () {
        if ( this.#root == null ) {
            const root = fs.realpathSync( globalThis[ Symbol.for( "mainThreadArgv1" ) ] || process.argv[ 1 ] || process.cwd() ),
                idx = root.indexOf( path.sep + "node_modules" + path.sep );

            if ( idx >= 0 ) {
                this.#root = this.findPackageRoot( root.slice( 0, idx ) );
            }

            this.#root ||= this.findPackageRoot( root ) || "";
        }

        return this.#root;
    }

    get package () {
        this.#package ||= JSON.parse( fs.readFileSync( this.root + "/package.json" ) );

        return this.#package;
    }

    get tmpdir () {
        this.#tmpdir ??= os.tmpdir();

        return this.#tmpdir;
    }

    get isDocker () {
        if ( this.#isDocker == null ) {
            if ( process.platform !== "linux" ) {
                this.#isDocker = false;
            }
            else {
                try {
                    if ( fs.statSync( "/.dockerenv" ) ) {
                        this.#isDocker = true;
                    }
                }
                catch {
                    this.#isDocker = false;
                }

                if ( !this.#isDocker ) {
                    try {
                        this.#isDocker = fs.readFileSync( "/proc/self/cgroup", "utf8" ).includes( "docker" );
                    }
                    catch {
                        this.#isDocker = false;
                    }
                }

                if ( !this.#isDocker ) {
                    try {
                        this.#isDocker = fs.readFileSync( "/proc/self/mountinfo", "utf8" ).includes( "/docker/containers/" );
                    }
                    catch {
                        this.#isDocker = false;
                    }
                }
            }
        }

        return this.#isDocker;
    }

    // public
    setMode ( value ) {
        process.env.NODE_ENV = value || "production";

        return this;
    }

    loadEnv ( { location, mode, defaultConfig, mergeEnv = true, overwriteEnv, envPrefix = "APP_", locale } = {} ) {
        location ||= this.root;
        mode ||= this.mode;

        const configs = [],
            env = [],
            configPrefix = "env",
            files = [

                //
                `${ configPrefix }.yaml`,
                `${ configPrefix }.local.yaml`,
                `${ configPrefix }.${ mode }.yaml`,
                `${ configPrefix }.${ mode }.local.yaml`,
            ];

        // add default config
        if ( defaultConfig ) configs.push( defaultConfig );

        // load configs
        for ( const file of files ) {
            if ( !fs.existsSync( location + "/" + file ) ) continue;

            const config = readConfigSync( location + "/" + file, { locale } );

            configs.push( config );
        }

        // precess configs
        for ( let idx = 0; idx < configs.length; idx++ ) {
            const config = configs[ idx ];

            // extract "env" key
            if ( "env" in config ) {
                env.push( config.env );

                configs[ idx ] = { ...config };
                delete configs[ idx ].env;
            }
        }

        // merge env
        if ( mergeEnv ) {
            this.mergeEnv( env, {
                "prefix": envPrefix,
                "overwrite": overwriteEnv,
            } );
        }

        return mergeObjects( {}, ...configs );
    }

    loadUserEnv ( { cache = true } = {} ) {
        if ( !this.#userEnv || !cache ) {
            this.#userEnv = this.loadEnv( {
                "location": this.getConfigDir( USER_ENV_LOCATION ),
                "envPrefix": false,
            } );
        }

        return this.#userEnv;
    }

    getConfigDir ( name ) {
        return xdg.getConfigDir( name );
    }

    getDataDir ( name ) {
        return xdg.getDataDir( name );
    }

    getCacheDir ( name ) {
        return xdg.getCacheDir( name );
    }

    getStateDir ( name ) {
        return xdg.getStateDir( name );
    }

    getRuntimeDir ( name ) {
        return xdg.getRuntimeDir( name );
    }

    async getBuildVersion ( dir ) {
        if ( !dir && this.#buildVersion !== undefined ) return this.#buildVersion;

        var buildVersion = super.getBuildVersion();

        if ( buildVersion ) {
            if ( !dir ) this.#buildVersion = buildVersion;
        }
        else {
            const { "default": Git } = await import( "#lib/api/git" );

            const git = new Git( dir || this.root );

            const res = await git.getBuildVersion();

            if ( !res.ok ) {
                console.error( `Unable to get git status: ${ res }` );

                if ( !dir ) this.#buildVersion = null;
            }
            else {
                buildVersion = res.data.version;

                if ( !dir ) this.#buildVersion = buildVersion;
            }
        }

        return buildVersion;
    }

    mergeEnv ( env, { prefix, overwrite } = {} ) {
        if ( !Array.isArray( env ) ) env = [ env ];

        const tmp = {};

        // merge
        for ( const _env of env ) {
            for ( const name in _env ) {
                let value = _env[ name ];

                // prepare value
                if ( value == null ) {
                    value = "";
                }
                else if ( typeof value === "boolean" ) {
                    value = value
                        ? "true"
                        : "";
                }
                else if ( typeof value === "string" ) {

                    // interpolate
                    value = value.replaceAll( /(?<!\\)\$\{?(\w+)\}?/gv, ( match, name ) => process.env[ name ] ?? tmp[ name ] ?? "" );
                }
                else if ( typeof value === "number" ) {
                    value = value + "";
                }
                else {
                    throw new Error( `Environment variable "${ name }" must be string or number` );
                }

                tmp[ name ] = value;
            }
        }

        for ( const name in tmp ) {

            // must start with prefix
            if ( prefix && !name.startsWith( prefix ) ) continue;

            // do not overwrite
            if ( !overwrite && Object.hasOwnProperty.call( process.env, name ) ) continue;

            // set environment variable
            process.env[ name ] = tmp[ name ];
        }
    }

    isGitRoot ( dir ) {
        dir ||= process.cwd();

        return fs.existsSync( dir + "/.git" );
    }

    isPackageRoot ( dir ) {
        dir ||= process.cwd();

        return fs.existsSync( dir + "/package.json" );
    }

    isGitPackageRoot ( dir ) {
        dir ||= process.cwd();

        return this.isPackageRoot( dir ) && this.isGitRoot( dir );
    }

    findGitRoot ( dir ) {
        dir ||= process.cwd();

        dir = path.normalize( path.resolve( dir ) );

        while ( true ) {
            if ( this.isGitRoot( dir ) ) return dir;

            const dirname = path.dirname( dir );

            if ( dirname === dir ) return;

            dir = dirname;
        }
    }

    findPackageRoot ( dir ) {
        dir ||= process.cwd();

        dir = path.normalize( path.resolve( dir ) );

        while ( true ) {
            if ( this.isPackageRoot( dir ) ) return dir;

            const dirname = path.dirname( dir );

            if ( dirname === dir ) return;

            dir = dirname;
        }
    }

    findGitPackageRoot ( dir ) {
        dir ||= process.cwd();

        dir = path.normalize( path.resolve( dir ) );

        while ( true ) {
            if ( this.isGitPackageRoot( dir ) ) return dir;

            const dirname = path.dirname( dir );

            if ( dirname === dir ) return;

            dir = dirname;
        }
    }
}

export default new Env();
