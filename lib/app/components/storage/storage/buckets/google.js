import path from "node:path";
import GoogleCloudStorage from "#lib/api/google/cloud/storage";
import Range from "#lib/range";
import stream from "#lib/stream";
import StreamSlicer from "#lib/stream/slicer";
import Bucket from "../bucket.js";

export default class extends Bucket {
    #name;
    #api;

    constructor ( buckets, location, { name, serviceAccount } = {} ) {
        super( buckets, location );

        this.#name = name;

        this.#api = new GoogleCloudStorage( serviceAccount );
    }

    // properties
    get name () {
        return this.#name;
    }

    // public
    async init () {
        var res;

        res = await this.#api.getBucket( this.#name );

        if ( !res.ok ) {
            if ( res.status !== 404 ) return res;

            // create bucket
            res = await this.#api.createBucket( this.#name );

            if ( !res.ok ) return res;
        }

        return result( 200 );
    }

    async imageExists ( image, { dbh } = {} ) {
        const res = await this.#api.getFileMetadata( this.#buildImagePath( image.path ) );

        if ( res.status === 606 ) {
            return false;
        }
        else if ( !res.ok ) {
            return null;
        }
        else {
            return true;
        }
    }

    async deleteImage ( image, { dbh } = {} ) {
        const res = await this.#api.deleteFile( this.#buildImagePath( image.path ) );

        if ( res.status === 404 ) return result( 200 );

        return res;
    }

    // protected
    async _uploadImage ( image, file, { encrypt, dbh } = {} ) {
        var stream = file.stream();

        if ( encrypt ) {
            stream = await this.app.crypto.encrypt( stream );

            stream.setType( file.contentType );
        }

        return this.#api.uploadFile( this.#buildImagePath( image.path ), stream );
    }

    async _getBuffer ( file, { dbh } = {} ) {
        return this.#api.getBuffer( this.#buildImagePath( file.imagePath ) );
    }

    async _getStream ( file, { range, dbh } = {} ) {
        range = Range.new( range ).createRange( {
            "contentLength": file.size,
        } );

        if ( file.isEncrypted ) {
            const res = await this.#api.getStream( this.#buildImagePath( file.imagePath ) );
            if ( !res.ok ) return res;

            return result(
                200,
                stream.pipeline(

                    //
                    await this.app.crypto.decrypt( res.data ),
                    new StreamSlicer( range ),
                    e => {}
                )
            );
        }
        else {
            return this.#api.getStream( this.#buildImagePath( file.imagePath ), {
                range,
            } );
        }
    }

    // private
    #buildImagePath ( imagePath ) {
        return path.posix.join( this.#name, imagePath.slice( this.location.length ) );
    }
}
