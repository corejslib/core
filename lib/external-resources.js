import "#lib/result";
import Events from "node:events";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import ansi from "#lib/ansi";
import env from "#lib/env";
import ExternalResource from "#lib/external-resource";

const DEFAULT_UPDATE_INTERVAL = 1000 * 60 * 60 * 4; // 4 hours

class ExternalResources extends Events {
    #defaultLocation = "global";
    #resources = {};
    #updateInterval;

    // public
    get ( id ) {
        id = this.buildResourceId( id );

        return this.#resources[ id ];
    }

    add ( id, { autoUpdate, location } = {} ) {
        autoUpdate ??= true;

        id = this.#parseResourceId( id, {
            location,
        } );

        if ( this.#resources[ id.id ] ) return this.#resources[ id ];

        const resource = new ExternalResource( id.id, id.location, {
            autoUpdate,
        } );

        this.#resources[ resource.id ] = resource;

        resource.on( "update", resource => this.emit( "update", resource ) );

        return resource;
    }

    async update ( { force, log = true } = {} ) {
        return this.#update( {
            "remote": true,
            force,
            log,
        } );
    }

    async autoUpdate ( { force, log } = {} ) {
        return this.#update( {
            "autoUpdate": true,
            "remote": true,
            force,
            log,
        } );
    }

    startUpdate () {
        if ( !this.#updateInterval ) {
            this.#updateInterval = setInterval( this.autoUpdate.bind( this ), DEFAULT_UPDATE_INTERVAL );
        }

        return this;
    }

    stopUpdate () {
        if ( this.#updateInterval ) {
            clearInterval( this.#updateInterval );

            this.#updateInterval = null;
        }

        return this;
    }

    buildResourceId ( id ) {
        id = this.#parseResourceId( id );

        return id.id;
    }

    // private
    #parseResourceId ( id, { location } = {} ) {
        var napi, node, platform, architecture, caller;

        if ( typeof id === "object" ) {
            ( { id, napi, node, platform, architecture, caller } = id );
        }

        var packageRoot,
            [ owner, repo, tag, name ] = id.split( "/", 4 );

        if ( !name ) {
            id = owner + "/" + repo;

            // set tag from package varsion
            if ( !tag ) {
                packageRoot = this.#findPackageRoot( caller );

                const version = JSON.parse( fs.readFileSync( packageRoot + "/package.json" ) ).version;

                if ( !version ) throw new Error( "Package version not defined" );

                tag = "v" + version;
            }

            id += "/" + tag;

            platform ||= process.platform;
            architecture ||= process.arch;

            // napi
            if ( napi ) {
                if ( napi === true ) napi = process.versions.napi;

                name = `napi-v${ napi }-${ platform }-${ architecture }`;
            }

            // node
            else if ( node ) {
                if ( node === true ) node = process.versions.modules;

                name = `node-v${ node }-${ platform }-${ architecture }`;
            }

            // error
            else {
                throw new Error( "Node or napi version is required" );
            }

            id += "/" + name;
        }

        // location
        if ( !location ) {
            if ( napi || node ) {
                location = "package";
            }
            else {
                location = this.#defaultLocation;
            }
        }

        // global
        if ( location === "global" ) {
            location = path.join( env.getDataDir( "corejslib" ), "external-resources", `${ owner }-${ repo }-${ tag }`, name );
        }

        // package
        else if ( location === "package" ) {
            packageRoot ??= this.#findPackageRoot( caller );

            location = path.join( packageRoot, "node_modules/.external-resources", `${ owner }-${ repo }-${ tag }`, name );
        }

        // invalid location
        else {
            throw new Error( "Location is not valid" );
        }

        return {
            id,
            location,
        };
    }

    #findPackageRoot ( location ) {
        if ( !location ) throw new Error( "Location is required" );

        if ( location instanceof URL ) {
            location = url.fileURLToPath( location );
        }
        else if ( location.startsWith( "file:" ) ) {
            location = url.fileURLToPath( location );
        }

        while ( true ) {
            if ( fs.existsSync( location + "/package.json" ) ) break;

            const parent = path.dirname( location );

            if ( location === parent ) throw new Error( "Unable to find package root" );

            location = parent;
        }

        if ( !location ) throw new Error( "Package not found" );

        return location;
    }

    async #update ( { remote, force, log, autoUpdate } = {} ) {
        var error;

        for ( const resource of Object.values( this.#resources ) ) {
            if ( autoUpdate && !resource.autoUpdate ) continue;

            const res = await resource.update( {
                remote,
                force,
            } );

            let logText = `Updating resounrce "${ resource.id }" ... `;

            if ( res.ok ) {
                logText += ansi.ok( " " + res.statusText + " " );
            }
            else if ( res.status === 304 ) {
                logText += res.statusText;
            }
            else {
                logText += ansi.error( " " + res.statusText + " " );

                error = true;
            }

            // log
            if ( log ) {
                console.log( logText );
            }
            else if ( log == null && res.status !== 304 ) {
                console.log( logText );
            }
        }

        return result( error
            ? 500
            : 200 );
    }
}

export default new ExternalResources();
