import childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { readConfig } from "#lib/config";
import env from "#lib/env";
import { calculateMode } from "#lib/fs";
import GlobPatterns from "#lib/glob/patterns";
import stream from "#lib/stream";
import { TarStreamPacker, TarStreamUnpacker } from "#lib/stream/tar";
import { TmpDir, TmpFile } from "#lib/tmp";
import { shellQuote } from "#lib/utils";

export default class Npm {
    #npm;
    #cwd;
    #registry;

    constructor ( { npm, cwd, registry } = {} ) {
        this.#npm = npm || process.platform === "win32"
            ? "npm.cmd"
            : "npm";

        this.#cwd = cwd;
        this.#registry = registry;
    }

    // properties
    get npm () {
        return this.#npm;
    }

    get cwd () {
        return this.#cwd;
    }

    get registry () {
        return this.#registry;
    }

    // public
    async exec ( args, { cwd, registry, ignoreExitCode } = {} ) {
        if ( !Array.isArray( args ) ) args = [ args ];

        args = [ this.npm, ...args, "--json" ];

        registry ||= this.registry;

        if ( registry ) {
            args.push( "--registry=" + registry );
        }

        args = shellQuote( args );

        if ( this.#cwd ) cwd ??= this.#cwd;

        return new Promise( resolve => {
            try {
                const proc = childProcess.spawn( args, {
                    cwd,
                    "shell": true,
                    "encoding": "buffer",
                    "stdio": [ "ignore", "pipe", "pipe" ],
                } );

                const stdout = [],
                    stderr = [];

                proc.stdout.on( "data", data => stdout.push( data ) );

                proc.stderr.on( "data", data => stderr.push( data ) );

                proc.once( "close", code => {
                    var res,
                        data = Buffer.concat( stdout ).toString();

                    try {
                        data = JSON.parse( data );
                    }
                    catch {}

                    if ( code && ( !ignoreExitCode || stderr.length ) ) {
                        res = result( [ 500, data?.error?.summary ], data );
                    }
                    else {
                        res = result( 200, data );
                    }

                    resolve( res );
                } );
            }
            catch ( e ) {
                resolve( result( [ 500, e.message ] ) );
            }
        } );
    }

    async getPackageVersions ( packageName, { cwd, registry } = {} ) {
        const args = [ "view", packageName, "versions" ];

        return this.exec( args, {
            cwd,
            registry,
        } );
    }

    async getPackageTags ( packageName, { cwd, registry } = {} ) {
        const args = [ "view", packageName, "dist-tags" ];

        const res = await this.exec( args, {
            cwd,
            registry,
        } );

        if ( res.ok ) {
            res.data = res.data[ 0 ];
        }

        return res;
    }

    async setPackageTag ( packageName, packageVersion, tag, { cwd, registry } = {} ) {
        packageName = `${ packageName }@${ packageVersion }`;

        const args = [ "dist-tag", "add", packageName, tag ];

        return this.exec( args, {
            cwd,
            registry,
        } );
    }

    async deletePackageTag ( packageName, tag, { cwd, registry } = {} ) {
        const args = [ "dist-tag", "rm", packageName, tag ];

        return this.exec( args, {
            cwd,
            registry,
        } );
    }

    async getPackageAccessStatus ( packageName, { cwd, registry } = {} ) {
        const args = [ "access", "get", "status", packageName ];

        const res = await this.exec( args, {
            cwd,
            registry,
        } );

        if ( res.ok ) {
            res.data = {
                "accessStatus": res.data[ packageName ],
            };
        }

        return res;
    }

    async setPackageAccessStatus ( packageName, accessStatus, { cwd, registry } = {} ) {
        const args = [ "access", "set", "status=" + accessStatus, packageName ];

        const res = await this.exec( args, {
            cwd,
            registry,
        } );

        if ( res.ok ) {
            res.data = res.data[ packageName ];
        }

        return res;
    }

    async getOutdatedDependencies ( { all, cwd, registry } = {} ) {
        const args = [ "outdated", "--long" ];

        if ( all ) args.push( "--all" );

        return this.exec( args, { cwd, registry, "ignoreExitCode": true } );
    }

    async updateDependencies ( { cwd, registry, dryRun, ignoreScripts, ignorePackageLock } = {} ) {
        const args = [ "update", "--fund=false" ];

        if ( dryRun ) {
            args.push( "--dry-run" );
        }

        if ( ignoreScripts ) {
            args.push( "--ignore-scripts" );
        }

        if ( ignorePackageLock ) {
            args.push( "--package-lock=false" );
        }

        return this.exec( args, {
            cwd,
            registry,
        } );
    }

    async pack ( { cwd, executablesPatterns } = {} ) {
        let res;

        cwd = env.findPackageRoot( cwd ?? this.#cwd );
        if ( !cwd ) return result( [ 500, "Package not found" ] );

        const { name, bundleDependencies } = await readConfig( path.join( cwd, "package.json" ) );

        // install dependencirs, if any of them are bundled
        if ( bundleDependencies ) {
            await fs.promises.rm( path.join( cwd, "node_modules" ), {
                "recursive": true,
                "force": true,
            } );

            res = await this.exec( [ "install" ], {
                cwd,
            } );
            if ( !res.ok ) return res;
        }

        const tmpDir = new TmpDir();

        // pack the package
        res = await this.exec( [ "pack", "--pack-destination", tmpDir.path ], {
            cwd,
        } );
        if ( !res.ok ) return res;

        const filename = res.data[ name ].filename,
            tmpFile = new TmpFile( {
                "extname": ".tgz",
            } );

        executablesPatterns = executablesPatterns
            ? new GlobPatterns().add( executablesPatterns )
            : null;

        // fix permissions
        await stream.promises.pipeline(

            //
            fs.createReadStream( path.join( tmpDir.path, filename ) ),
            new TarStreamUnpacker(),
            new TarStreamPacker( {
                "gzip": true,
                "onWriteEntry": writeEntry => {
                    if ( executablesPatterns?.test( writeEntry.path.replace( /^package\//v, "" ) ) ) {
                        writeEntry.mode = calculateMode( "rwxr-xr-x" );
                    }
                    else {
                        writeEntry.mode = calculateMode( "rw-r--r--" );
                    }
                },
            } ),
            fs.createWriteStream( tmpFile.path )
        );

        return result( 200, {
            "pack": tmpFile,
        } );
    }

    async publish ( { executablesPatterns, packPath, accessStatus, tag, cwd, registry } = {} ) {
        if ( !packPath ) {
            const res = await this.pack( {
                executablesPatterns,
                cwd,
            } );
            if ( !res.ok ) return res;

            var pack = res.data.pack;

            packPath = pack.path;
        }

        const args = [ "publish" ];

        if ( accessStatus ) {
            args.push( "--access", accessStatus === "private"
                ? "restricted"
                : "public" );
        }

        if ( tag ) {
            args.push( "--tag", tag );
        }

        args.push( packPath );

        return this.exec( args, {
            cwd,
            registry,
        } );
    }

    async runScript ( script, { args, log = true, cwd } = {} ) {
        if ( args?.length ) {
            args = [ "--", ...args ];
        }
        else {
            args = [];
        }

        return new Promise( resolve => {
            const proc = childProcess.spawn( shellQuote( [ this.#npm, "run", script, ...args ] ), {
                "cwd": cwd || this.#cwd,
                "stdio": [ "inherit", log
                    ? "inherit"
                    : "pipe", log
                    ? "inherit"
                    : "pipe" ],
                "shell": true,
            } );

            const stdout = [],
                stderr = [];

            if ( !log ) {
                proc.stdout.on( "data", data => stdout.push( data ) );
                proc.stderr.on( "data", data => stderr.push( data ) );
            }

            proc.once( "close", () => {
                var res;

                if ( proc.exitCode ) {
                    res = result( 500 );
                }
                else {
                    res = result( 200 );
                }

                res.data = {
                    "stdout": Buffer.concat( stdout ).toString(),
                    "stderr": Buffer.concat( stderr ).toString(),
                };

                resolve( res );
            } );
        } );
    }
}
