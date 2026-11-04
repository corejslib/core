import childProcess from "node:child_process";
import path from "node:path";
import Ajv from "#lib/ajv";
import DockerEngine from "#lib/api/docker/engine";
import Git from "#lib/api/git";
import { readConfig } from "#lib/config";
import { pathExists } from "#lib/fs";
import Logger from "#lib/logger";
import { TmpDir } from "#lib/tmp";
import { confirm } from "#lib/utils";

// NOTE https://docs.docker.com/compose/compose-file/build/

const schema = new Ajv().addSchema( await readConfig( "#resources/schemas/compose.schema.yaml", { "resolve": import.meta.url } ) );

export default class {
    #context;
    #signal;
    #commitRef;
    #autoTags;
    #push;
    #remove;
    #interactive;
    #force;
    #credentials;
    #build = {};

    #logger;
    #git;
    #upstream;
    #commit;
    #buildVersion;
    #tags = new Set();
    #composeFile;
    #images = [];
    #dockerEngine;

    constructor ( context, { composeFile, signal, credentials, commitRef, autoTags, push, remove, interactive, force, build = {} } = {} ) {
        this.#context = context;
        this.#composeFile = composeFile || "compose.yaml";
        this.#signal = signal;
        this.#commitRef = commitRef;

        this.#autoTags = ( Array.isArray( autoTags )
            ? autoTags
            : [ autoTags ] ).filter( tag => typeof tag === "string" );

        this.#push = push;
        this.#remove = remove;
        this.#interactive = interactive;
        this.#force = force;
        this.#credentials = credentials;

        // build options
        this.#build.dockerFile = build.dockerFile;
        this.#build.tag = build.tag;
        this.#build.extraHosts = build.extraHosts;
        this.#build.quiet = build.quiet;
        this.#build.cache = build.cache;
        this.#build.cacheFrom = build.cacheFrom;
        this.#build.pull = build.pull;
        this.#build.rm = build.rm;
        this.#build.forceRm = build.forceRm;
        this.#build.args = build.args || {};
        this.#build.labels = build.labels || {};
        this.#build.secrets = build.secrets || [];

        this.#build.shmSize = build.shmSize;
        this.#build.memory = build.memory;
        this.#build.memSwap = build.memSwap;
        this.#build.cpuShares = build.cpuShares;
        this.#build.cpuSetCpus = build.cpuSetCpus;
        this.#build.cpuPeriod = build.cpuPeriod;
        this.#build.cpuQuota = build.cpuQuota;

        this.#build.squash = build.squash;
        this.#build.networkMode = build.networkMode;
        this.#build.platform = build.platform;
        this.#build.target = build.target;
        this.#build.outputs = build.outputs;

        if ( !this.#interactive ) this.#force = true;

        this.#logger = new Logger();

        if ( !this.#interactive ) this.#dockerEngine = new DockerEngine();
    }

    // public
    async run () {
        var res, clone;

        try {

            // prepare context
            res = await this.#prepareContext();
            if ( !res.ok ) throw res;
            clone = res.data.clone;

            this.#logger.log();
            this.#logger.log( `Build version: ${ this.#buildVersion }` );
            this.#logger.log();

            // prepare images
            res = await this.#prepareImages();
            if ( !res.ok ) throw res;

            if ( !this.#images.length ) throw "No imahes to build found";

            for ( const image of this.#images ) {
                image.tags = [];

                for ( const tag of [ ...this.#tags ].sort() ) {
                    const taggedImage = image.image + ":" + tag;

                    image.tags.push( taggedImage );

                    this.#logger.log( "Image: " + taggedImage );
                }
            }

            // confirm build
            if ( !this.#force && ( await confirm( "\nContinue build process?", [ "[yes]", "no" ] ) ) !== "yes" ) throw "Aborted";

            // clone git repo
            if ( clone ) {
                const context = this.#context;
                this.#context = new TmpDir();

                this.#logger.log( "Cloning ..." );
                res = await this.#git.exec( [ "clone", "--quiet", context, this.#context.path ] );
                if ( !res.ok ) throw result( res );
                this.#logger.log( res + "" );

                this.#git = new Git( this.#context.path );

                this.#logger.log( `Checking out "${ clone }"` );
                res = await this.#git.exec( [ "checkout", clone ] );
                if ( !res.ok ) throw result( res );
                this.#logger.log( res + "\n" );
            }

            res = await this.#buildImages();
            if ( !res.ok ) throw res;
        }
        catch ( e ) {
            res = result.fromError( e, { "log": false } );

            if ( !res.ok ) this.#logger.error( res + "" );
        }

        // remove tmp context
        if ( this.#context instanceof TmpDir ) this.#context.destroy();

        // remove build artifacts
        await this.#removeImages();

        return res;
    }

    // private
    async #prepareContext () {
        const logger = this.#logger;

        // read compose.yaml
        if ( !( await pathExists( this.#context + "/" + this.#composeFile ) ) ) return result( [ 404, `Compose file "${ this.#composeFile } not found"` ] );

        this.#composeFile = await readConfig( this.#context + "/" + this.#composeFile );

        // validate compose.yaml
        if ( !schema.validate( "compose", this.#composeFile ) ) return result( [ 400, `"compose.yaml" is not valid, errors:\n${ schema.errors }` ] );
        logger.log( 'Validate "compose.yaml": OK' );

        this.#git = new Git( this.#context );
        this.#upstream = this.#git.upstream;

        var res;

        // get build version
        res = await this.#git.getBuildVersion( { "commitRef": this.#commitRef === "."
            ? "HEAD"
            : this.#commitRef } );
        if ( !res.ok ) return res;

        const buildVersion = res.data;

        this.#commit = buildVersion.commit;
        this.#buildVersion = buildVersion.version;

        // TODO if !this.#commitRef - take commit-ref from image tag

        // build dirtyy working tree
        if ( this.#commitRef === "." && buildVersion.isDirty ) {
            this.#tags.add( "dirty" );

            return result( 200, {
                "clone": null,
            } );
        }

        // build by commit ref
        else {

            // add commit ref as tag
            if ( this.#commitRef && this.#commitRef !== "." ) {
                if ( buildVersion.commit.branches.has( this.#commitRef ) || buildVersion.commit.tags.has( this.#commitRef ) ) {
                    this.#tags.add( this.#commitRef );
                }
                else if ( buildVersion.commit.hash.startsWith( this.#commitRef ) ) {
                    this.#tags.add( buildVersion.commit.abbrev );
                }
            }

            // add autobuild tags
            for ( const tag of this.#autoTags ) {
                if ( buildVersion.commit.branches.has( tag ) || buildVersion.commit.tags.has( tag ) ) {
                    this.#tags.add( tag );
                }
            }

            // add default tag
            if ( !this.#tags.size ) {
                this.#tags.add( buildVersion.commit.abbrev );
            }

            let clone = null;

            if ( buildVersion.isDirty ) {
                clone = buildVersion.commit.abbrev;
            }
            else {

                // identify head commit
                res = await this.#git.getCommit();
                if ( !res.ok ) return res;
                const head = res.data;

                if ( head.hash !== buildVersion.commit.hash ) {
                    clone = buildVersion.commit.abbrev;
                }
            }

            return result( 200, {
                clone,
            } );
        }
    }

    async #prepareImages () {
        const images = {};

        if ( this.#composeFile.services ) {
            for ( const service of Object.values( this.#composeFile.services ) ) {

                // do not build service
                if ( !service.build || !service.image ) continue;

                if ( typeof service.build === "string" ) {
                    service.build = {
                        "context": service.build,
                    };
                }

                // XXX check build.context, do not build if context is not a relative path (can be git url)

                const imageName = ( service.baseImage = service.image.replace( /:.*$/v, "" ) );

                if ( images[ imageName ] ) {
                    if ( service.depends_on ) {
                        images[ imageName ].dependencies.push( ...( Array.isArray( service.depends_on )
                            ? service.depends_on
                            : Object.keys( service.depends_on ) ) );
                    }

                    continue;
                }

                const image = {
                    "image": imageName,
                    "dependencies": service.depends_on
                        ? ( Array.isArray( service.depends_on )
                            ? [ ...service.depends_on ]
                            : Object.keys( service.depends_on ) )
                        : [],
                    "build": { ...this.#build },
                };

                images[ imageName ] = image;

                image.context = service.build.context
                    ? path.posix.join( this.#context + "", service.build.context )
                    : this.#context;

                // preparee build options
                if ( service.build.dockerfile ) image.build.dockerFile = service.build.dockerfile;
                if ( service.build.shm_size ) image.build.shmSize = service.build.shm_size;
                if ( service.build.network ) image.build.networkMode = service.build.network;
                if ( service.build.target ) image.build.target = service.build.target;
                if ( service.build.cache_from ) image.build.cacheFrom = service.build.cache_from;

                image.build.args = { ...image.build.args };
                image.build.labels = { ...image.build.labels };
                image.build.secrets = [ ...image.build.secrets ];

                // merge build args
                if ( service.build.args ) {
                    if ( Array.isArray( service.build.args ) ) {
                        for ( const arg of service.build.args ) {
                            const [ key, value ] = arg.split( /=(.*)/v, 2 );

                            image.build.args[ key ] = value;
                        }
                    }
                    else {
                        for ( const key in service.build.args ) {
                            image.build.args[ key ] = service.build.args[ key ];
                        }
                    }
                }

                // add default build args
                image.build.args[ "BUILD_VERSION" ] = this.#buildVersion;

                // merge labels
                if ( service.build.labels ) {
                    if ( Array.isArray( service.build.labels ) ) {
                        for ( const label of service.build.labels ) {
                            const [ key, value ] = label.split( /=(.*)/v, 2 );

                            image.build.labels[ key ] = value;
                        }
                    }
                    else if ( typeof service.build.labels === "object" ) {
                        for ( const key in service.build.labels ) {
                            image.build.labels[ key ] = service.build.labels[ key ];
                        }
                    }
                }

                // add default labels
                // DOCS: https://specs.opencontainers.org/image-spec/annotations/
                image.build.labels[ "org.opencontainers.image.created" ] = Temporal.Now.instant().toString();
                image.build.labels[ "org.opencontainers.image.version" ] = this.#buildVersion;
                image.build.labels[ "org.opencontainers.image.revision" ] = this.#commit.hash;

                if ( this.#upstream ) {
                    image.build.labels[ "org.opencontainers.image.url" ] = this.#upstream.readmeUrl;
                    image.build.labels[ "org.opencontainers.image.documentation" ] = this.#upstream.readmeUrl;
                    image.build.labels[ "org.opencontainers.image.source" ] = this.#upstream.homeUrl;
                    image.build.labels[ "org.opencontainers.image.description" ] = this.#upstream.readmeUrl;
                }

                // image.build.labels[ "org.opencontainers.image.authors" ]\f
                // image.build.labels[ "org.opencontainers.image.vendor" ]
                // image.build.labels[ "org.opencontainers.image.licenses" ]
                // image.build.labels[ "org.opencontainers.image.ref.name" ]
                // image.build.labels[ "org.opencontainers.image.title" ]

                // merge build secrets
                if ( service.build.secrets ) {
                    image.build.secrets = [ ...image.build.secrets, ...service.build.secrets ];
                }
            }
        }

        // resolve dependencies
        for ( const image of Object.values( images ) ) {
            image.dependencies = image.dependencies
                .map( serviceName => {
                    const dependencyImage = this.#composeFile.services?.[ serviceName ]?.baseImage;

                    if ( !dependencyImage || dependencyImage === image.image ) return;

                    return dependencyImage;
                } )
                .filter( image => image );
        }

        const colors = {},
            sort = image => {
                const color = colors[ image.image ] || "white";

                if ( color === "black" ) {
                    return result( 200 );
                }
                else if ( color === "grey" ) {
                    return result( [ 500, "Cyclic dependency found" ] );
                }
                else {
                    colors[ image.image ] = "grey";

                    for ( const dependency of image.dependencies ) {
                        const res = sort( images[ dependency ] );
                        if ( !res.ok ) return res;
                    }

                    colors[ image.image ] = "black";

                    this.#images.push( image );

                    return result( 200 );
                }
            };

        for ( const image of Object.values( images ) ) {
            const res = sort( image );

            if ( !res.ok ) return res;
        }

        return result( 200 );
    }

    async #buildImages () {
        for ( const image of this.#images ) {
            this.#logger.log();
            this.#logger.info( `Building image: ${ image.image }` );

            if ( this.#interactive ) {
                const args = [];

                if ( image.build.dockerFile ) args.push( "--file", image.build.dockerFile );
                if ( image.build.shmSize ) args.push( "--shm-size", image.build.shmSize );
                if ( image.build.networkMode ) args.push( "--network", image.build.networkMode );
                if ( image.build.target ) args.push( "--target", image.build.target );
                if ( image.build.cacheFrom ) image.build.cacheFrom.forEach( image => args.push( "--cache-from", image ) );

                for ( const arg in image.build.args ) {
                    args.push( "--build-arg=" + arg + "=" + image.build.args[ arg ] );
                }

                for ( const label in image.build.labels ) {
                    args.push( "--label=" + label + "=" + image.build.labels[ label ] );
                }

                for ( const secret of image.build.secrets ) {
                    args.push( "--secret=" + secret );
                }

                const res = childProcess.spawnSync(
                    "docker",
                    [

                        //
                        "builder",
                        "build",
                        "--rm", // remove intermediate containers after a successful build (default true)
                        "--force-rm", // always remove intermediate containers
                        "--no-cache", // do not use cache when building the image
                        "--pull", // always attempt to pull a newer version of the image
                        ...args,
                        ...image.tags.map( image => "--tag=" + image ),
                        image.context,
                    ],
                    { "stdio": "inherit" }
                );

                if ( res.status ) return result( 500 );
            }
            else {
                let res = await this.#dockerEngine.buildImage( image.context, {
                    "dockerfile": "dockerfile",
                    "signal": this.#signal,
                    "credentials": this.#credentials,
                    "options": {
                        ...image.build,
                        "tag": image.tags[ 0 ],
                    },
                } );

                if ( !res.ok ) return res;

                const stream = res.data;

                res = await new Promise( resolve => {
                    stream.on( "data", data => {
                        if ( data.stream ) {
                            this.#logger.log( data.stream );
                        }
                        else if ( data.error ) {
                            this.#logger.error( data.error );

                            resolve( result( [ 500, data.error ] ) );
                        }
                        else if ( data.aux ) {
                            if ( data.id === "moby.buildkit.trace" ) {

                                // XXX decode protobuf
                                // const buffer = Buffer.from( data.aux, "base64" );
                                // this.#logger.log( "aux: " + buffer.toString() );
                            }
                            else {
                                this.#logger.log( "ID: " + data.aux.ID );
                            }
                        }
                    } );

                    stream.once( "error", e => resolve( result.fromError( e, { "log": false } ) ) );

                    stream.once( "close", () => resolve( result( 200 ) ) );
                } );

                if ( !res.ok ) return res;

                // tag image
                if ( image.tags.length > 1 ) {
                    for ( let n = 1; n < image.tags.length; n++ ) {
                        const res = await this.#dockerEngine.tagImage( image.tags[ 0 ], image.tags[ n ] );

                        if ( !res.ok ) return res;
                    }
                }
            }

            // push images
            if ( this.#push ) {
                for ( const tag of image.tags ) {
                    this.#logger.log( "" );
                    this.#logger.info( `Pushing: ${ tag }` );

                    if ( this.#interactive ) {
                        while ( true ) {
                            const res = childProcess.spawnSync( "docker", [ "image", "push", tag ], { "stdio": "inherit" } );

                            if ( !res.status ) break;

                            if ( ( await confirm( "\nUnable to push image. Repeat?", [ "[yes]", "no" ] ) ) !== "yes" ) break;
                        }
                    }
                    else {
                        let res = await this.#dockerEngine.pushImage( tag, {
                            "signal": this.#signal,
                            "credentials": this.#credentials,
                        } );

                        if ( !res.ok ) return res;

                        const stream = res.data;

                        res = await new Promise( resolve => {
                            stream.on( "data", data => {
                                if ( data.status ) {

                                    // this.#logger.log( data.status );
                                }
                                else if ( data.error ) {
                                    this.#logger.error( data.error );

                                    resolve( result( [ 500, data.error ] ) );
                                }
                                else if ( data.aux ) {
                                    this.#logger.log( "Digest: " + data.aux.digest );
                                    this.#logger.log( "Size: " + data.aux.size );
                                }
                            } );

                            stream.once( "error", e => resolve( result.fromError( e ) ) );

                            stream.once( "close", () => resolve( result( 200 ) ) );
                        } );

                        if ( !res.ok ) return res;
                    }
                }
            }
        }

        return result( 200 );
    }

    async #removeImages () {
        if ( !this.#remove ) return result( 200 );

        const images = [];

        for ( const image of this.#images ) {
            for ( const tag of image.tags ) {
                images.push( tag );
            }
        }

        this.#logger.log( "\nRemoving images" );

        if ( this.#interactive ) {
            childProcess.spawnSync( "docker", [ "image", "rm", ...images ], { "stdio": "inherit" } );
        }
        else {
            for ( const image of images ) {
                const res = await this.#dockerEngine.deleteImage( image );
                this.#logger.log( "Remove image: " + image + " ...  " + res + "" );
            }
        }

        return result( 200 );
    }
}
