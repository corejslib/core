import Events from "node:events";
import fs from "node:fs";
import path from "node:path";
import stream from "node:stream";
import * as tar from "tar";
import { TmpDir, TmpFile } from "#lib/tmp";

// XXX cyclic dependencies
// import tar from "#lib/tar";
// import fetch from "#lib/fetch";

const DEFAULT_CHECK_TIMEOUT = 1000 * 60 * 60 * 24; // 24 hours

export default class ExternalResource extends Events {
    #id;
    #location;
    #repositoryOwner;
    #repositoryName;
    #tag;
    #resourceName;
    #indexPath;
    #remoteIndexUrl;
    #downloadUrl;
    #isInstalled;
    #autoUpdate;
    #index;

    constructor ( id, location, { autoUpdate } = {} ) {
        super();

        this.#id = id;
        this.#location = location;
        this.#autoUpdate = Boolean( autoUpdate );

        [ this.#repositoryOwner, this.#repositoryName, this.#tag, this.#resourceName ] = id.split( "/", 4 );

        this.#indexPath = this.#location + ".json";

        this.#remoteIndexUrl = `https://github.com/${ this.#repositoryOwner }/${ this.#repositoryName }/releases/download/${ this.#tag }/${ this.#resourceName }.json`;

        this.#downloadUrl = `https://github.com/${ this.#repositoryOwner }/${ this.#repositoryName }/releases/download/${ this.#tag }/${ this.#resourceName }.tar.gz`;
    }

    // properties
    get id () {
        return this.#id;
    }

    get isInstalled () {
        if ( this.#isInstalled == null ) {
            this.#readIndexSync();
        }

        return this.#isInstalled;
    }

    get location () {
        return this.#location;
    }

    get autoUpdate () {
        return this.#autoUpdate;
    }

    get etag () {
        return this.#index?.etag;
    }

    get expires () {
        return this.#index?.expires;
    }

    get isExpired () {
        return Boolean( this.expires ) && this.expires.epochMilliseconds <= Date.now();
    }

    get meta () {
        return this.#index?.meta;
    }

    get lastChecked () {
        return this.#index?.lastChecked;
    }

    get lastUpdated () {
        return this.#index?.lastUpdated;
    }

    // public
    async check ( { remote } = {} ) {
        const res = await this.update( {
            remote,
            "silent": true,
        } );

        if ( !res.ok && res.status !== 304 ) {
            throw new Error( `Unable to update resource "${ this.id }": ${ res }` );
        }

        return this;
    }

    async update ( { remote, force, silent } = {} ) {
        const localIndex = await this.#readIndex(),
            isInstalled = Boolean( localIndex?.etag ),
            errorOnRemoteFailed = !isInstalled || Boolean( remote );

        let res, remoteIndex;

        // resource is expired
        if ( this.isExpired ) remote = true;

        // last checked interval
        if ( this.lastChecked && this.lastChecked.epochMilliseconds + DEFAULT_CHECK_TIMEOUT < Date.now() ) remote = true;

        // resource exists
        if ( isInstalled && !remote ) return result( 304 );

        // download remote index
        res = await this.#getRemoteIndex();

        if ( res.ok ) {
            remoteIndex = res.data;
        }
        else if ( errorOnRemoteFailed ) {
            return res;
        }
        else {
            return result( 304 );
        }

        remoteIndex.lastUpdated = localIndex?.lastUpdated;

        try {
            if ( remoteIndex.buildDate ) remoteIndex.buildDate = Temporal.Instant.from( remoteIndex.buildDate );
            if ( remoteIndex.expires ) remoteIndex.expires = Temporal.Instant.from( remoteIndex.expires );
        }
        catch ( e ) {
            return result.fromError( e, { "log": false } );
        }

        // update is not required
        if ( isInstalled && !force && remoteIndex.etag === localIndex.etag ) {
            await this.#writeIndex( remoteIndex );

            return result( 304 );
        }

        // update
        const tmpDir = new TmpDir();

        try {
            res = await fetch( this.#downloadUrl ).catch( e =>
                result.fromError( e, {
                    "log": false,
                } ) );
            if ( !res.ok ) throw result( res );

            // unpack to the temporary directory
            await stream.promises.pipeline(
                stream.Readable.fromWeb( res.body ),
                tar.extract( {
                    "cwd": tmpDir.path,
                } )
            );

            // replace the resource directory
            await this.#replaceResourceDir( tmpDir.path );

            res = result( 200 );
        }
        catch ( e ) {
            res = result.fromError( e, { "log": false } );
        }

        await tmpDir.destroy();

        // update failed
        if ( !res.ok ) {

            // update index
            await this.#writeIndex( localIndex );

            if ( errorOnRemoteFailed ) {
                return res;
            }
            else {
                return result( [ 304, res.statusText ] );
            }
        }

        remoteIndex.lastUpdated = Temporal.Now.instant();

        await this.#writeIndex( remoteIndex );

        if ( !silent ) this.emit( "update", this );

        return result( [ 200, "Updated" ] );
    }

    toString () {
        return this.#id;
    }

    toJSON () {
        return this.#id;
    }

    getResourcePath ( resource ) {
        return path.join( this.location, resource );
    }

    // private
    async #readIndex () {
        const index = await fs.promises.readFile( this.#indexPath ).catch( e => null );

        return this.#processIndex( index );
    }

    #readIndexSync () {
        let index;

        try {
            index = fs.readFileSync( this.#indexPath );
        }
        catch {}

        return this.#processIndex( index );
    }

    async #writeIndex ( index ) {
        const { lastUpdated, ...rest } = index || {};

        // "id" and "lastChecked" must go after the spread, otherwise stale values from the previous index will override them
        index = {
            ...rest,
            "id": this.#id,
            "lastChecked": Temporal.Now.instant(),
            lastUpdated,
        };

        this.#index = index;

        await this.#createParentDir();

        // write index
        await this.#writeFileAtomic( this.#indexPath, JSON.stringify( index, null, 4 ) + "\n" );

        this.#isInstalled = Boolean( index.lastUpdated );
    }

    // the directory is shared between processes, so the file must never be written in place
    async #writeFileAtomic ( file, data ) {
        const tmpFile = new TmpFile();

        try {
            await fs.promises.writeFile( tmpFile.path, data );

            await fs.promises.rename( tmpFile.path, file );
        }
        finally {
            await tmpFile.destroy();
        }
    }

    // the resource directory and its index are siblings
    async #createParentDir () {
        return fs.promises.mkdir( path.dirname( this.#location ), {
            "recursive": true,
        } );
    }

    // swap the resource directory with the prepared one, the old directory is removed only after the swap succeeded
    async #replaceResourceDir ( source ) {
        const backupDir = new TmpDir();

        let hasBackup = false,
            keepBackup = false;

        try {
            await this.#createParentDir();

            // move the old directory to the backup
            try {
                await fs.promises.rename( this.#location, backupDir.path );

                hasBackup = true;
            }
            catch ( e ) {
                if ( e.code !== "ENOENT" ) throw e;
            }

            // move the new directory in place
            try {
                await fs.promises.rename( source, this.#location );
            }
            catch ( e ) {

                // rollback
                if ( hasBackup ) {
                    try {
                        await fs.promises.rename( backupDir.path, this.#location );
                    }
                    catch {

                        // do not destroy the only remaining copy of the old resource
                        keepBackup = true;
                    }
                }

                throw e;
            }
        }
        finally {
            if ( !keepBackup ) await backupDir.destroy();
        }
    }

    #processIndex ( index ) {
        this.#isInstalled = false;

        if ( index ) {

            // corrupted index is treated as missing
            try {
                index = JSON.parse( index );

                if ( index.buildDate ) index.buildDate = Temporal.Instant.from( index.buildDate );
                if ( index.lastChecked ) index.lastChecked = Temporal.Instant.from( index.lastChecked );
                if ( index.expires ) index.expires = Temporal.Instant.from( index.expires );

                if ( index.lastUpdated ) {
                    index.lastUpdated = Temporal.Instant.from( index.lastUpdated );

                    this.#isInstalled = true;
                }
            }
            catch {
                index = null;
                this.#isInstalled = false;
            }
        }
        else {
            index = null;
        }

        this.#index = index;

        return index;
    }

    async #getRemoteIndex () {
        const res = await fetch( this.#remoteIndexUrl ).catch( e =>
            result.fromError( e, {
                "log": false,
            } ) );

        if ( !res.ok ) return result( res.status );

        return res
            .json()
            .then( remoteIndex => result( 200, remoteIndex ) )
            .catch( e => result.fromError( e, { "log": false } ) );
    }
}
