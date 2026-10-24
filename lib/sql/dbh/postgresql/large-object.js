import "#lib/result";
import Message from "#lib/message";
import Range from "#lib/range";
import { sql } from "#lib/sql/query";
import stream from "#lib/stream";

const INV_WRITE = 0x20000;

const SQL = {
    "loCreate": sql`SELECT lo_create ( ? ) AS oid`.prepare(),

    "loFromBytea": sql`SELECT lo_from_bytea( ?, ? ) AS oid`.prepare(),

    "loPut": sql`SELECT lo_put( ?, ?, ? )`.prepare(),

    "loGet": sql`SELECT lo_get( ? ) AS buffer`.prepare(),

    "loGetLength": sql`SELECT lo_get( ?, ?, ? ) AS buffer`.prepare(),

    "loUnlink": sql`SELECT lo_unlink( ? )`.prepare(),

    "loExists": sql`SELECT EXISTS ( SELECT 1 FROM pg_largeobject_metadata WHERE oid = ? ) AS exists`.prepare(),

    "loOpen": sql`SELECT lo_open( ?, ? ) AS fd`.prepare(),

    "loTruncate": sql`SELECT lo_truncate64( ?, ? )`.prepare(),

    "loClose": sql`SELECT lo_close( ? )`.prepare(),

    "getSize": sql`SELECT lo_size( ? ) AS size`.prepare(),
};

function toError ( e ) {
    if ( Error.isError( e ) ) return e;

    return new Error( e?.statusText || "Large object error", { "cause": e } );
}

class PostgreSqlLargeObjectReadable extends stream.Readable {
    #dbh;
    #oid;
    #range;
    #readLength = 0;

    constructor ( dbh, oid, { range } = {} ) {
        super();

        this.#dbh = dbh;
        this.#oid = oid;

        this.#range = Range.new( range );
    }

    // properties
    get oid () {
        return this.#oid;
    }

    get range () {
        return this.#range;
    }

    // protected
    async _construct ( callback ) {
        var error;

        if ( !this.#range.hasContentLength ) {
            try {
                const res = await this.#dbh.selectRow( SQL.getSize, [ this.#oid ] );

                if ( res.ok ) {
                    this.#range = this.#range.createRange( {
                        "contentLength": res.data.size,
                    } );
                }
                else {
                    error = toError( res );
                }
            }
            catch ( e ) {
                error = toError( e );
            }
        }

        callback( error );
    }

    async _read ( size ) {
        try {
            size = this.#dbh.largeObjectReadSize;

            const rest = this.#range.length - this.#readLength;

            if ( rest <= 0 ) {
                return this.#end();
            }
            else if ( rest < size ) {
                size = rest;
            }

            const res = await this.#dbh.selectRow( SQL.loGetLength, [ this.#oid, this.#range.start + this.#readLength, size ] );

            if ( res.ok ) {
                const length = res.data.buffer.length;

                if ( length ) {
                    this.#readLength += length;

                    this.push( res.data.buffer );

                    // data length limit reached
                    if ( this.#readLength >= this.#range.length ) {
                        this.#end();
                    }

                    // returned data length < requested length, no more data available
                    else if ( length < size ) {
                        this.#end();
                    }
                }
                else {
                    this.#end();
                }
            }
            else {
                this.destroy( toError( res ) );
            }
        }
        catch ( e ) {
            this.destroy( toError( e ) );
        }
    }

    // private
    #end () {
        if ( this.#readLength !== this.#range.length ) {
            this.destroy( new Error( "Large object size is not valid" ) );
        }
        else {
            this.push( null );
        }
    }
}

export default class PostgreSqlLargeObject {
    #dbh;

    constructor ( dbh ) {
        this.#dbh = dbh;
    }

    // public
    async write ( message, { oid } = {} ) {
        await using asyncDisposableStack = new AsyncDisposableStack();

        message = Message.new( message );
        asyncDisposableStack.use( message );

        const bodyStream = await message.createBodyStream();
        asyncDisposableStack.use( bodyStream );

        return this.#dbh.begin( async dbh => {
            var res,
                exists = false,
                start = 0;

            if ( oid ) {
                res = await dbh.selectRow( SQL.loExists, [ oid ] );
                if ( !res.ok ) throw res;

                exists = res.data.exists;
            }

            // overwrite existing large object
            if ( exists ) {

                // open for writing
                res = await dbh.selectRow( SQL.loOpen, [ oid, INV_WRITE ] );
                if ( !res.ok ) throw res;

                const fd = res.data.fd;

                // truncate old content
                res = await dbh.select( SQL.loTruncate, [ fd, 0 ] );
                if ( !res.ok ) throw res;

                res = await dbh.select( SQL.loClose, [ fd ] );
                if ( !res.ok ) throw res;
            }

            // create large object: with the requested oid, or with a new one
            else {
                res = await dbh.selectRow( SQL.loCreate, [ oid || 0 ] );
                if ( !res.ok ) throw res;

                oid = res.data.oid;
            }

            for await ( let buffer of bodyStream ) {
                if ( !Buffer.isBuffer( buffer ) ) buffer = Buffer.from( buffer );

                res = await dbh.select( SQL.loPut, [ oid, start, buffer ] );
                if ( !res.ok ) throw res;

                start += buffer.length;
            }

            return result( 200, { oid } );
        } );
    }

    async read ( oid, { range } = {} ) {
        range = Range.new( range );

        // get size
        const res = await this.getSize( oid );
        if ( !res.ok ) return res;

        range = range.createRange( {
            "contentLength": res.data.size,
        } );

        if ( range.length <= this.#dbh.largeObjectReadSize ) {
            if ( range.isFullRange ) {
                return this.#dbh.selectRow( SQL.loGet, [ oid ] );
            }
            else {
                return this.#dbh.selectRow( SQL.loGetLength, [ oid, range.start, range.length ] );
            }
        }

        const readStream = this.#createReadStream( oid, {
            range,
        } );

        return readStream
            .buffer()
            .then( buffer => result( 200, { buffer } ) )
            .catch( e => result.fromError( e ) );
    }

    async getSize ( oid ) {
        return this.#dbh.selectRow( SQL.getSize, [ oid ] );
    }

    async unlink ( oid ) {
        return this.#dbh.selectRow( SQL.loUnlink, [ oid ] );
    }

    createReadStream ( oid, { range } = {} ) {
        range = Range.new( range ).createRange( {
            "contentLength": null,
        } );

        return this.#createReadStream( oid, { range } );
    }

    // private
    #createReadStream ( oid, { range } = {} ) {
        return new PostgreSqlLargeObjectReadable( this.#dbh, oid, { range } );
    }
}
