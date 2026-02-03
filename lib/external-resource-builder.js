import "#lib/result";
import crypto from "node:crypto";
import fs from "node:fs";
import ansi from "#lib/ansi";
import GitHub from "#lib/api/github";
import { hash } from "#lib/crypto";
import env from "#lib/env";
import externalResoources from "#lib/external-resources";
import File from "#lib/file";
import GlobPatterns from "#lib/glob/patterns";
import stream from "#lib/stream";
import tar from "#lib/tar";
import { TmpDir } from "#lib/tmp";

env.loadUserEnv();

const HASH_ALGORITHM = "SHA256",
    HASH_ENCODING = "base64url";

export default class ExternalRecourceBuilder {
    #id;
    #repository;
    #tag;
    #name;
    #githubToken;
    #gitHubApi;
    #etag;
    #buildDate;
    #expires;
    #meta;

    constructor ( id, { githubtoken } = {} ) {
        if ( id ) {
            this.#id = externalResoources.buildResourceId( id );
        }

        this.#githubToken = githubtoken || process.env.GITHUB_TOKEN;

        const [ owner, repo, tag, name ] = this.id.split( "/" );

        this.#repository = owner + "/" + repo;
        this.#tag = tag;
        this.#name = name;
    }

    // statid
    static async build ( resources, { force, patterns } = {} ) {
        if ( patterns ) {
            patterns = new GlobPatterns( {
                "caseSensitive": false,
                "matchBasename": true,
            } ).add( patterns );
        }

        resources = resources.map( resource => {
            if ( typeof resource === "function" ) resource = new resource();

            return resource;
        } );

        var hasError;

        for ( const resource of resources ) {
            process.stdout.write( `Building resource "${ resource.name }" ... ` );

            let res;

            if ( patterns && !patterns.test( resource.name ) ) {
                res = result( [ 304, "Skipped" ] );
            }
            else {
                res = await resource.build( {
                    force,
                } );
            }

            if ( res.ok ) {
                console.log( ansi.ok( " " + res.statusText + " " ) );
            }
            else {
                if ( res.status === 304 ) {
                    console.log( res.statusText );
                }
                else {
                    console.log( ansi.error( " " + res.statusText + " " ) );

                    hasError = true;
                }
            }
        }

        if ( hasError ) {
            return result( 500 );
        }
        else {
            return result( 200 );
        }
    }

    // properties
    get id () {
        return this.#id;
    }

    get repository () {
        return this.#repository;
    }

    get tag () {
        return this.#tag;
    }

    get name () {
        return this.#name;
    }

    get etag () {
        return this.#etag;
    }

    get buildDate () {
        return this.#buildDate;
    }

    get expires () {
        return this.#expires;
    }

    get isExpired () {
        return this.expires && this.expires <= Date.now();
    }

    get meta () {
        return this.#meta;
    }

    get gitHubApi () {
        if ( !this.#gitHubApi ) {
            this.#gitHubApi = new GitHub( this.#githubToken );
        }

        return this.#gitHubApi;
    }

    // public
    async build ( { force } = {} ) {
        return this.#build( { force } );
    }

    // protected
    async _getEtag ( { etag, buildDate, meta } ) {
        return result( [ 400, "Etog is not defined" ] );
    }

    async _build ( location ) {
        return result( [ 400, "Builder not defined" ] );
    }

    async _getExpires () {
        return result( 200 );
    }

    async _getMeta () {
        return result( 200 );
    }

    _getHash () {
        return crypto.createHash( HASH_ALGORITHM );
    }

    async _getFileHash ( path ) {
        return this._getStreamHash( fs.createReadStream( path ) );
    }

    async _getStreamHash ( stream ) {
        return hash( HASH_ALGORITHM, stream, {
            "outputEncoding": HASH_ENCODING,
        } );
    }

    async _getLastModified ( url ) {
        const res = await fetch( url, {
            "method": "HEAD",
        } ).catch( e => result.catch( e, { "log": false } ) );

        // request error
        if ( !res.ok ) return res;

        const lastModified = res.headers.get( "last-modified" );

        if ( lastModified ) {
            return result( 200, new Date( lastModified ) );
        }
        else {
            return result( [ 500 ] );
        }
    }

    // private
    async #build ( { force } = {} ) {
        if ( !this.#githubToken ) {
            return result( [ 500, "GitHub token not found" ] );
        }

        var res;

        // get remote index
        res = await this.#getIndex();
        if ( !res.ok ) return res;
        var index = res.data;

        this.#etag = index.etag;
        this.#buildDate = index.buildDate
            ? new Date( index.buildDate )
            : null;
        this.#expires = index.expires
            ? new Date( index.expires )
            : null;
        this.#meta = index.meta;

        // check expired
        if ( !force ) {

            // resource is not expired
            if ( this.expires && !this.isExpired ) return result( 304 );
        }

        // get etag
        try {
            res = result.try( await this._getEtag() );
        }
        catch ( e ) {
            res = result.catch( e, { "log": false } );
        }
        if ( !res.ok ) return res;

        const etag = await this.#prepareEtag( res.data );

        // check modified
        if ( etag == null ) return result( 304 );

        if ( !force ) {

            // resource is not modified
            if ( etag === this.etag ) return result( 304 );
        }

        // get expires
        try {
            res = result.try( await this._getExpires() );
        }
        catch ( e ) {
            res = result.catch( e, { "log": false } );
        }
        if ( !res.ok ) return res;

        const expires = res.data
            ? new Date( res.data )
            : null;

        // get meta data
        try {
            res = result.try( await this._getMeta() );
        }
        catch ( e ) {
            res = result.catch( e, { "log": false } );
        }
        if ( !res.ok ) return res;

        const meta = res.data ?? null;

        const tmp = new TmpDir();

        // build
        try {
            res = result.try( await this._build( tmp.path ) );
        }
        catch ( e ) {
            res = result.catch( e, { "log": false } );
        }
        if ( !res.ok ) return res;

        const assetPath = tmp.path + "/" + this.#name + ".tar.gz",
            onWriteEntry = res.data?.onWriteEntry;

        await tar.create( {
            "cwd": tmp.path,
            "gzip": true,
            "portable": false,
            "file": assetPath,
            onWriteEntry,
        } );

        // upload asset tar.gz
        res = await this.#uploadAsset( new File( {
            "path": assetPath,
        } ) );
        if ( !res.ok ) return res;

        // get latest remote index
        res = await this.#getIndex();
        if ( !res.ok ) return res;
        index = res.data;

        // update index
        index.etag = etag;
        index.buildDate = new Date();
        index.expires = expires;
        index.meta = meta;

        // upload index
        res = await this.#uploadAsset( new File( {
            "path": this.#name + ".json",
            "sources": JSON.stringify( index, null, 4 ) + "\n",
        } ) );
        if ( !res.ok ) return res;

        return result( 200 );
    }

    async #prepareEtag ( etag ) {
        if ( etag == null ) return null;

        if ( !( etag instanceof crypto.Hash ) ) {
            if ( etag instanceof stream.Readable ) {
                return this._getStreamHash( etag );
            }

            if ( etag instanceof Date ) {
                etag = etag.toISOString();
            }

            etag = this._getHash().update( etag );
        }

        return etag.digest( HASH_ENCODING );
    }

    async #getIndex () {

        // get release id
        var res = await this.gitHubApi.getReleaseByTagName( this.#repository, this.#tag );
        if ( !res.ok ) return res;

        res = await this.gitHubApi.downloadReleaseAssetByName( this.#repository, res.data.id, this.#name + ".json" );

        var index;

        if ( !res.ok ) {
            if ( res.status === 404 ) {
                index = {};
            }
            else {
                return result( res );
            }
        }
        else {
            index = await res.json();
        }

        return result( 200, index );
    }

    async #uploadAsset ( file ) {

        // get release id
        const res = await this.gitHubApi.getReleaseByTagName( this.#repository, this.#tag );
        if ( !res.ok ) return res;

        return this.gitHubApi.updateReleaseAsset( this.#repository, res.data.id, file );
    }
}
