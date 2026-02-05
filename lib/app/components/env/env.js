import fs from "node:fs";
import path from "node:path";
import env from "#lib/env";
import { TmpFile } from "#lib/tmp";
import uuid from "#lib/uuid";

const BUILD_VERSION = await env.getBuildVersion();

export default class Env {
    #app;
    #config;
    #dataDir;
    #tmpDir;
    #unixSocketsDir;
    #instanceId;

    constructor ( app, config ) {
        this.#app = app;
        this.#config = config;

        TmpFile.setDefaultTmpDir( this.tmpDir );
    }

    // properties
    get name () {
        return this.#config.name;
    }

    get mode () {
        return env.mode;
    }

    get isProduction () {
        return env.isProduction;
    }

    get isDevelopment () {
        return env.isDevelopment;
    }

    get buildVersion () {
        return BUILD_VERSION;
    }

    get root () {
        return env.root;
    }

    get dataDir () {
        if ( !this.#dataDir ) {
            this.#dataDir = path.join( env.root, "data" );

            fs.mkdirSync( this.#dataDir, { "recursive": true } );
        }

        return this.#dataDir;
    }

    get tmpDir () {
        if ( !this.#tmpDir ) {
            if ( this.#config.shareTmpDir ) {
                this.#tmpDir = path.join( this.dataDir, ".tmp" );
            }
            else {
                this.#tmpDir = path.join( TmpFile.defaultTmpDir, this.instanceId );
            }

            fs.rmSync( this.#tmpDir, { "recursive": true, "force": true } );

            fs.mkdirSync( this.#tmpDir, { "recursive": true } );
        }

        return this.#tmpDir;
    }

    get unixSocketsDir () {
        if ( !this.#unixSocketsDir ) {
            this.#unixSocketsDir = "/var/run/" + this.instanceId;

            fs.rmSync( this.#unixSocketsDir, { "recursive": true, "force": true } );

            fs.mkdirSync( this.#unixSocketsDir, { "recursive": true } );
        }

        return this.#unixSocketsDir;
    }

    get instanceId () {
        if ( !this.#instanceId ) {
            const instanceIdPath = path.join( this.dataDir, ".instance-id" );

            if ( fs.existsSync( instanceIdPath ) ) {
                this.#instanceId = fs.readFileSync( instanceIdPath, "utf8" );
            }

            if ( !this.#instanceId ) {
                this.#instanceId = uuid();

                fs.writeFileSync( instanceIdPath, this.#instanceId );
            }
        }

        return this.#instanceId;
    }

    get clusterId () {
        return this.#app.cluster?.id;
    }

    get packageName () {
        return env.package.name;
    }

    get packageVersion () {
        return env.package.version;
    }

    get serviceName () {
        return this.#app.components.service;
    }
}
