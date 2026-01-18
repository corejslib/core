import fs from "node:fs";
import path from "node:path";
import File from "#lib/file";
import { pathExists } from "#lib/fs";
import Range from "#lib/range";
import stream from "#lib/stream";
import StreamSlicer from "#lib/stream/slicer";
import Bucket from "../bucket.js";

export default class extends Bucket {
    #path;

    constructor ( buckets, location ) {
        super( buckets, location );

        this.#path = path.join( this.storage.app.env.dataDir, this.storage.config.location );
    }

    // public
    async init () {
        return result( 200 );
    }

    async imageExists ( image, { dbh } = {} ) {
        return pathExists( this.#buildImagePath( image.path ) );
    }

    async deleteImage ( image, { dbh } = {} ) {
        try {
            const imagePath = this.#buildImagePath( image.path );

            await fs.promises.rm( imagePath, {
                "force": true,
            } );

            // remove dir, if empty
            await fs.promises.rmdir( path.dirname( imagePath ) ).catch( e => {} );

            return result( 299 );
        }
        catch ( e ) {
            return result.catch( e, { "log": false } );
        }
    }

    // protected
    async _uploadImage ( image, file, { encrypt, dbh } = {} ) {
        const imagePath = this.#buildImagePath( image.path );

        try {
            await fs.promises.mkdir( path.dirname( imagePath ), {
                "recursive": true,
            } );

            const writeStream = fs.createWriteStream( imagePath );

            if ( encrypt ) {
                await stream.promises.pipeline( await this.app.crypto.encrypt( file.stream() ), writeStream );
            }
            else {
                await stream.promises.pipeline( file.stream(), writeStream );
            }

            return result( 200 );
        }
        catch ( e ) {
            return result.catch( e, { "log": false } );
        }
    }

    async _getBuffer ( file, { dbh } = {} ) {
        try {
            const buffer = await fs.promises.readFile( this.#buildImagePath( file.imagePath ) );

            return result( 200, buffer );
        }
        catch ( e ) {
            return result.catch( e, { "log": false } );
        }
    }

    async _getStream ( file, { range, dbh } = {} ) {
        range = Range.new( range ).createRange( {
            "contentLength": file.size,
        } );

        file = new File( {
            "path": this.#buildImagePath( file.imagePath ),
        } );

        try {
            if ( file.isEncrypted ) {
                return result(
                    200,
                    stream.pipeline(

                        //
                        await this.app.crypto.decrypt( file.stream() ),
                        new StreamSlicer( range ),
                        e => {}
                    )
                );
            }
            else {
                return result(
                    200,
                    file.stream( {
                        range,
                    } )
                );
            }
        }
        catch ( e ) {
            return result.catch( e );
        }
    }

    // private
    #buildImagePath ( imagePath ) {
        return path.join( this.#path, imagePath );
    }
}
