import Range from "#lib/range";
import sql from "#lib/sql";
import stream from "#lib/stream";
import StreamSlicer from "#lib/stream/slicer";
import Bucket from "../bucket.js";

const SQL = {
    "getOid": sql`SELECT oid FROM storage_image WHERE path = ?`.prepare(),

    "checkOid": sql`SELECT oid FROM pg_largeobject_metadata WHERE oid = ?`.prepare(),

    "updateImageOid": sql`UPDATE storage_image SET oid = ? WHERE id = ?`.prepare(),
};

export default class extends Bucket {

    // public
    async init () {
        return result( 200 );
    }

    async imageExists ( image, { dbh } = {} ) {
        dbh ||= this.dbh;

        var res, oid;

        if ( image.oid ) {
            oid = image.oid;
        }
        else {
            res = await dbh.selectRow( SQL.getOid, [ image.path ] );
            if ( !res.ok ) return null;

            oid = res.data?.oid;
        }

        if ( !oid ) {
            return false;
        }
        else {
            res = await dbh.selectRow( SQL.checkOid, [ oid ] );
            if ( !res.ok ) return null;

            return res.data?.oid
                ? true
                : false;
        }
    }

    async deleteImage ( image, { dbh } = {} ) {
        dbh ||= this.dbh;

        return dbh.largeObject.unlink( image.oid );
    }

    // protected
    async _uploadImage ( image, file, { encrypt, dbh } = {} ) {
        dbh ||= this.dbh;

        var res, oid;

        if ( image.oid ) {
            oid = image.oid;
        }
        else {
            res = await dbh.selectRow( SQL.getOid, [ image.path ] );
            if ( !res.ok ) return res;

            oid = res.data?.oid;
        }

        var stream = file.stream();

        if ( encrypt ) {
            stream = await this.app.crypto.encrypt( stream );
        }

        return dbh.begin( async dbh => {
            var res;

            res = await dbh.largeObject.write( stream, { oid } );
            if ( !res.ok ) throw res;

            // update image oid
            if ( !oid ) {
                oid = res.data.oid;

                res = await dbh.do( SQL.updateImageOid, [ oid, image.id ] );
                if ( !res.ok ) throw res;

                if ( !res.meta.rows ) throw "Storage image OID not updated";
            }

            return result( 200 );
        } );
    }

    async _getBuffer ( file, { dbh } = {} ) {
        dbh ||= this.dbh;

        const res = await dbh.largeFile.read( file.imageOid );
        if ( !res.ok ) return res;

        const buffer = res.data.buffer;

        return result( 200, buffer );
    }

    async _getStream ( file, { range, dbh } = {} ) {
        dbh ||= this.dbh;

        range = Range.new( range ).createRange( {
            "contentLength": file.size,
        } );

        var out;

        if ( file.isEncrypted ) {
            out = stream.pipeline(

                //
                await this.app.crypto.decrypt( await dbh.largeObject.createReadStream( file.imageOid ) ),
                new StreamSlicer( range ),
                e => {}
            );
        }
        else {
            out = await dbh.largeObject.createReadStream( file.imageOid, {
                range,
            } );
        }

        return result( 200, out );
    }
}
