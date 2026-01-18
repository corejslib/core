import Oauth from "#lib/api/google/oauth";
import fetch from "#lib/fetch";
import FormData from "#lib/form-data";
import Headers from "#lib/http/headers";
import Range from "#lib/range";

const DEFAULT_PERMISSION = "fullControl";

const SCOPES = {
    "readOnly": "https://www.googleapis.com/auth/devstorage.read_only",
    "readWrite": "https://www.googleapis.com/auth/devstorage.read_write",
    "fullControl": "https://www.googleapis.com/auth/devstorage.full_control",
    "cloudPlatformReadOnly": "https://www.googleapis.com/auth/cloud-platform.read-only",
    "cloudPlatform": "https://www.googleapis.com/auth/cloud-platform",
};

const API_URL = "https://storage.googleapis.com/storage/v1/",
    UPLOAD_URL = "https://storage.googleapis.com/upload/storage/v1/",
    DOWNLOAD_URL = "https://storage.googleapis.com/";

export default class GoogleCloudStorage {
    #oauth;
    #permission;

    constructor ( key, { permission } = {} ) {
        this.#permission = permission || DEFAULT_PERMISSION;
        this.#oauth = new Oauth( key, SCOPES[ this.#permission ] );
    }

    // properties
    get permission () {
        return this.#permission;
    }

    // public
    // https://cloud.google.com/storage/docs/json_api/v1/buckets/insert
    async createBucket ( bucket, { predefinedAcl, predefinedDefaultObjectAcl } = {} ) {
        return this.#request( API_URL + "b", {
            "params": {
                "project": this.#oauth.projectId,
                ...( predefinedAcl && { predefinedAcl } ),
                ...( predefinedDefaultObjectAcl && { predefinedDefaultObjectAcl } ),
            },
            "request": {
                "method": "post",
                "headers": {
                    "content-type": "application/json",
                },
                "body": JSON.stringify( {
                    "name": bucket,
                } ),
            },
        } );
    }

    // https://cloud.google.com/storage/docs/json_api/v1/buckets/list
    async getBuckets () {
        return this.#request( API_URL + "b", {
            "params": {
                "project": this.#oauth.projectId,
            },
        } );
    }

    // https://cloud.google.com/storage/docs/json_api/v1/buckets/get
    async getBucket ( bucket ) {
        return this.#request( API_URL + "b/" + encodeURIComponent( bucket ) );
    }

    // https://cloud.google.com/storage/docs/json_api/v1/buckets/delete
    async deleteBucket ( bucket ) {
        return this.#request( API_URL + "b/" + encodeURIComponent( bucket ), {
            "request": {
                "method": "delete",
            },
        } );
    }

    // https://cloud.google.com/storage/docs/json_api/v1/objects/insert
    async uploadFile ( path, file, { predefinedAcl, metadata } = {} ) {
        const { bucket, name } = this.#parsePath( path );

        metadata ||= {};

        if ( file.type ) metadata.contentType ||= file.type;

        const streamMultipart = new FormData( { "type": "related" } );

        streamMultipart.write( {
            "headers": {
                "content-type": "application/json",
            },
            "body": JSON.stringify( metadata ),
        } );

        streamMultipart.write( {
            "headers": {
                "content-type": file.type,
            },
            "body": file,
        } );

        return this.#request( UPLOAD_URL + `b/${ encodeURIComponent( bucket ) }/o`, {
            "params": {
                name,
                "uploadType": "multipart",
                ...( predefinedAcl && { predefinedAcl } ),
            },
            "request": {
                "method": "post",
                "body": streamMultipart,
            },
        } );
    }

    // https://cloud.google.com/storage/docs/json_api/v1/objects/list
    async getFiles ( bucket ) {
        return this.#request( API_URL + `b/${ encodeURIComponent( bucket ) }/o` );
    }

    // https://cloud.google.com/storage/docs/json_api/v1/objects/get
    async getFile ( path ) {
        const { bucket, name } = this.#parsePath( path );

        const res = await this.#request( API_URL + `b/${ encodeURIComponent( bucket ) }/o/${ encodeURIComponent( name ) }`, {
            "returnResult": true,
            "params": {
                "alt": "media",
            },
        } );

        if ( res.ok ) {
            const tmpFile = await res.tmpFile().catch( e => null );

            if ( !tmpFile ) {
                return result( 500 );
            }
            else {
                return result( 200, tmpFile );
            }
        }
        else {
            return result( res.status );
        }
    }

    async getBuffer ( path ) {
        const { bucket, name } = this.#parsePath( path );

        const res = await this.#request( API_URL + `b/${ encodeURIComponent( bucket ) }/o/${ encodeURIComponent( name ) }`, {
            "returnResult": true,
            "params": {
                "alt": "media",
            },
        } );

        if ( res.ok ) {
            const buffer = await res.buffer().catch( e => null );

            if ( !buffer ) {
                return result( 500 );
            }
            else {
                return result( 200, buffer );
            }
        }
        else {
            return result( res.status );
        }
    }

    async getStream ( path, { range } = {} ) {
        const { bucket, name } = this.#parsePath( path ),
            headers = {};

        range = Range.new( range );

        if ( !range.isFullRange ) {
            if ( !range.isValidHttpRange ) return result( 416 );

            headers.range = "bytes=" + range.httpRange;
        }

        const res = await this.#request( API_URL + `b/${ encodeURIComponent( bucket ) }/o/${ encodeURIComponent( name ) }`, {
            "returnResult": true,
            "params": {
                "alt": "media",
            },
            "request": {
                headers,
            },
        } );

        if ( res.ok ) {
            return result( 200, res.body );
        }
        else {
            return result( res );
        }
    }

    async getFileHttpResponse ( path, { headers } = {} ) {
        const { bucket, name } = this.#parsePath( path );

        if ( headers ) {
            if ( headers instanceof Headers ) {
                headers = { ...headers.toJSON() };
            }

            delete headers.host;
            delete headers.referer;
        }

        const res = await this.#request( DOWNLOAD_URL + `${ encodeURIComponent( bucket ) }/${ encodeURIComponent( name ) }`, {
            "returnResult": true,
            "request": {
                headers,
            },
        } );

        return res;
    }

    // https://cloud.google.com/storage/docs/json_api/v1/objects/get
    async getFileMetadata ( path ) {
        const { bucket, name } = this.#parsePath( path );

        return this.#request( API_URL + `b/${ encodeURIComponent( bucket ) }/o/${ encodeURIComponent( name ) }`, {
            "params": {
                "alt": "json",
            },
        } );
    }

    // https://cloud.google.com/storage/docs/json_api/v1/objects/patch
    async patchFileMetadata ( path, metadata ) {
        const { bucket, name } = this.#parsePath( path );

        return this.#request( API_URL + `b/${ encodeURIComponent( bucket ) }/o/${ encodeURIComponent( name ) }`, {
            "request": {
                "method": "patch",
                "headers": {
                    "content-type": "application/json",
                },
                "body": JSON.stringify( metadata ),
            },
        } );
    }

    // https://cloud.google.com/storage/docs/json_api/v1/objects/update
    async updateFileMetadata ( path, metadata ) {
        const { bucket, name } = this.#parsePath( path );

        return this.#request( API_URL + `b/${ encodeURIComponent( bucket ) }/o/${ encodeURIComponent( name ) }`, {
            "request": {
                "method": "put",
                "headers": {
                    "content-type": "application/json",
                },
                "body": JSON.stringify( metadata ),
            },
        } );
    }

    // https://cloud.google.com/storage/docs/json_api/v1/objects/delete
    async deleteFile ( path ) {
        const { bucket, name } = this.#parsePath( path );

        return this.#request( API_URL + `b/${ encodeURIComponent( bucket ) }/o/${ encodeURIComponent( name ) }`, {
            "request": {
                "method": "delete",
            },
        } );
    }

    // https://cloud.google.com/storage/docs/json_api/v1/objects/copy
    async copyFile ( from, to ) {
        from = this.#parsePath( from );
        to = this.#parsePath( to );

        return this.#request( API_URL + `b/${ encodeURIComponent( from.bucket ) }/o/${ encodeURIComponent( from.name ) }/copyTo/b/${ encodeURIComponent( to.bucket ) }/o/${ encodeURIComponent( to.name ) }`, {
            "request": {
                "method": "post",
            },
        } );
    }

    // private
    #parsePath ( path ) {
        const idx = path.indexOf( "/" );

        return {
            "bucket": path.slice( 0, idx ),
            "name": path.slice( idx + 1 ),
        };
    }

    async #request ( url, { returnResult, params, request = {} } = {} ) {
        const token = await this.#oauth.getToken();

        if ( !token.ok ) return token;

        url = new URL( url );

        if ( params ) url.search = new URLSearchParams( params );

        request.headers ||= {};
        request.headers.authorization = `Bearer ${ token.data }`;

        const res = await fetch( url, request );

        if ( returnResult ) return res;

        if ( res.headers.contentType.type === "application/json" ) {
            var data = await res.json().catch( e => null );
        }

        if ( res.ok ) {
            return result( 200, data );
        }
        else {
            return result( [ res.status, data?.error?.message || res.statusText ] );
        }
    }
}
