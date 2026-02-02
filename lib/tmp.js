import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import File from "#lib/file";
import { objectIsPlain } from "#lib/utils";
import uuid from "#lib/uuid";

const tmpItems = new Set(),
    finalizationRegistry = new FinalizationRegistry( tmpItem => tmpItem.destroy() );

var defaultTmpDir = os.tmpdir();

process.setMaxListeners( process.getMaxListeners() + 1 );

process.on( "exit", () => {
    for ( const tmpItem of tmpItems ) {
        tmpItem.destroySync();
    }
} );

class TmpItem {
    #path;
    #destroyed = false;

    constructor ( tmp, fsPath ) {
        this.#path = fsPath;

        tmpItems.add( this );

        finalizationRegistry.register( tmp, this, this );
    }

    // properties
    get path () {
        return this.#path;
    }

    get isDestroyed () {
        return this.#destroyed;
    }

    // public
    async destroy () {
        if ( this.#destroyed ) return;

        await fs.promises.rm( this.#path, {
            "recursive": true,
            "force": true,
        } );

        this.#destroyed = true;

        tmpItems.delete( this );

        finalizationRegistry.unregister( this );
    }

    destroySync () {
        if ( this.#destroyed ) return;

        fs.rmSync( this.#path, {
            "recursive": true,
            "force": true,
        } );

        this.#destroyed = true;

        tmpItems.delete( this );

        finalizationRegistry.unregister( this );
    }
}

const Tmp = Super =>
    class extends ( Super || class {} ) {
        #tmpItem;

        constructor ( fsPath, options ) {
            super( options );

            this.#tmpItem = new TmpItem( this, fsPath );
        }

        // static
        static get defaultTmpDir () {
            return defaultTmpDir;
        }

        static setDefaultTmpDir ( tmpDir ) {
            if ( tmpDir ) {
                defaultTmpDir = tmpDir;
            }
        }

        // properties
        get path () {
            return this.#tmpItem.path;
        }

        get isDestroyed () {
            return this.#tmpItem.isDestroyed;
        }

        // public
        toString () {
            return this.path;
        }

        destroy () {
            this.#tmpItem.destroySync();
        }

        [ Symbol.dispose ] () {
            this.#tmpItem.destroySync();
        }

        async [ Symbol.asyncDispose ] () {
            return this.#tmpItem.destroy();
        }

        async [ Symbol.asyncDispose ] () {
            return this.#tmpItem.destroy();
        }
    };

export class TmpFile extends Tmp( File ) {
    constructor ( filePath ) {
        var tmpDir, name, extname, type;

        if ( objectIsPlain( filePath ) ) {
            ( { "path": filePath, tmpDir, name, extname, type } = filePath );
        }

        if ( filePath ) {
            if ( filePath instanceof File ) {
                ( { filePath, name, type } = filePath );
            }
            else if ( typeof filePath === "string" ) {
                if ( filePath.startsWith( "file:" ) ) {
                    filePath = url.fileURLToPath( filePath );
                }
            }
            else if ( filePath instanceof URL ) {
                filePath = url.fileURLToPath( filePath );
            }
            else {
                throw "Path is not valid";
            }
        }

        filePath ||= path.join( tmpDir || defaultTmpDir, uuid() + ( extname || "" ) );

        super( filePath, {
            "path": filePath,
            name,
            type,
        } );
    }

    // public
    [ Symbol.for( "nodejs.util.inspect.custom" ) ] ( depth, options, inspect ) {
        const spec = {};

        if ( this.path ) spec.path = this.path;
        if ( this.name ) spec.name = this.name;
        if ( this.type ) spec.type = this.type;

        return `${ this.constructor.name }: ${ inspect( spec ) }`;
    }
}

export class TmpDir extends Tmp() {
    constructor ( dirPath ) {
        var tmpDir;

        if ( objectIsPlain( dirPath ) ) {
            ( { "path": dirPath, tmpDir } = dirPath );
        }

        if ( dirPath ) {
            if ( typeof dirPath === "string" ) {
                if ( dirPath.startsWith( "file:" ) ) {
                    dirPath = url.fileURLToPath( dirPath );
                }
            }
            else if ( dirPath instanceof URL ) {
                dirPath = url.fileURLToPath( dirPath );
            }
            else {
                throw "Path is not valid";
            }
        }

        dirPath ||= path.join( tmpDir || defaultTmpDir, uuid() );

        super( dirPath );

        fs.mkdirSync( this.path, {
            "recursive": true,
        } );
    }

    // public
    [ Symbol.for( "nodejs.util.inspect.custom" ) ] ( depth, options, inspect ) {
        const spec = {};

        if ( this.path ) spec.path = this.path;

        return "TmpDir: " + inspect( spec );
    }
}
