import Events from "node:events";
import fs from "node:fs";
import path from "node:path";
import stream from "node:stream";
import * as tar from "tar";

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
        return this.expires && this.expires <= Date.now();
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

        // resource is expired
        if ( this.isExpired ) remote = true;

        // last checked interval
        if ( this.lastChecked && this.lastChecked + DEFAULT_CHECK_TIMEOUT < Date.now() ) remote = true;

        // resource exists
        if ( isInstalled && !remote ) return result( 304 );

        var res, remoteIndex;

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

        if ( remoteIndex.buildDate ) remoteIndex.buildDate = new Date( remoteIndex.buildDate );
        if ( remoteIndex.expires ) remoteIndex.expires = new Date( remoteIndex.expires );

        // update is not required
        if ( !force && remoteIndex.etag === localIndex?.etag ) {
            await this.#writeIndex( remoteIndex );

            return result( 304 );
        }

        // update
        try {
            res = await fetch( this.#downloadUrl ).catch( e => result.fromError( e, { "log": false } ) );
            if ( !res.ok ) throw result( res );

            await this.#createResourceDir();

            // unpack
            await stream.promises.pipeline(
                stream.Readable.fromWeb( res.body ),
                tar.extract( {
                    "cwd": this.#location,
                } )
            );

            res = result( 200 );
        }
        catch ( e ) {
            res = result.fromError( e, { "log": false } );
        }

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

        remoteIndex.lastUpdated = new Date();

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
        var index;

        if ( fs.existsSync( this.#indexPath ) ) {
            index = fs.readFileSync( this.#indexPath );
        }

        return this.#processIndex( index );
    }

    async #writeIndex ( index ) {
        var id, lastChecked, lastUpdated;

        index ||= {};

        ( { lastUpdated, ...index } = index );

        id = this.id;
        lastChecked = new Date();

        index = {
            id,
            lastChecked,
            lastUpdated,
            ...index,
        };

        this.#index = index;

        await this.#createResourceDir();

        // write index
        await fs.promises.writeFile( this.#indexPath, JSON.stringify( index, null, 4 ) + "\n" );

        if ( index.lastUpdated ) {
            this.#isInstalled = true;
        }
        else {
            this.#isInstalled = false;
        }
    }

    async #createResourceDir () {
        return fs.promises.mkdir( this.#location, {
            "force": true,
            "recursive": true,
        } );
    }

    #processIndex ( index ) {
        if ( index ) {
            index = JSON.parse( index );

            if ( index.buildDate ) index.buildDate = new Date( index.buildDate );
            if ( index.lastChecked ) index.lastChecked = new Date( index.lastChecked );
            if ( index.expires ) index.expires = new Date( index.expires );

            if ( index.lastUpdated ) {
                index.lastUpdated = new Date( index.lastUpdated );

                this.#isInstalled = true;
            }
            else {
                this.#isInstalled = false;
            }
        }
        else {
            this.#isInstalled = false;
        }

        this.#index = index;

        return index;
    }

    async #getRemoteIndex () {
        const res = await fetch( this.#remoteIndexUrl ).catch( e => result.fromError( e, { "log": false } ) );

        if ( !res.ok ) return result( res.status );

        return res
            .json()
            .then( remoteIndex => result( 200, remoteIndex ) )
            .catch( e => result.fromError( e, { "log": false } ) );
    }
}
