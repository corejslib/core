import HttpBody from "#lib/http/body";
import Range from "#lib/range";
import { sql } from "#lib/sql/query";
import stream from "#lib/stream";

const SQL = {
    "loCreate": sql`SELECT lo_create ( ? ) AS oid`.prepare(),

    "loFromBytea": sql`SELECT lo_from_bytea( ?, ? ) AS oid`.prepare(),

    "loPut": sql`SELECT lo_put( ?, ?, ? )`.prepare(),

    "loGet": sql`SELECT lo_get( ? ) AS buffer`.prepare(),

    "loGetLength": sql`SELECT lo_get( ?, ?, ? ) AS buffer`.prepare(),

    "loUnlink": sql`SELECT lo_unlink( ? )`.prepare(),

    "getSize": sql`SELECT lo_size( ? ) AS size`.prepare(),
};

class LargeObjectReadable extends stream.Readable {
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
        if ( this.#range.hasContentLength ) {
            callback();
        }
        else {
            const res = await this.#dbh.selectRow( SQL.getSize, [ this.#oid ] );

            if ( res.ok ) {
                this.#range = this.#range.createRange( {
                    "contentLength": res.data.size,
                } );

                callback();
            }
            else {
                callback( res );
            }
        }
    }

    async _read ( size ) {
        size = this.#dbh.largeObjectReadSize;

        const rest = this.#range.length - this.#readLength;

        if ( rest < 0 ) {
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
            this.destroy( res );
        }
    }

    // private
    #end () {
        if ( this.#readLength !== this.#range.length ) {
            this.destroy( "Large object size is not valid" );
        }
        else {
            this.push( null );
        }
    }
}

class LargeObject {
    #dbh;

    constructor ( dbh ) {
        this.#dbh = dbh;
    }

    // public
    async write ( data, { oid } = {} ) {
        data = HttpBody.new( data ).stream();

        return this.#dbh.begin( async dbh => {
            var res,
                start = 0;

            if ( oid ) {
                res = await dbh.selectRow( SQL.loUnlink, [ oid ] );
                if ( !res.ok ) throw res;
            }

            res = await dbh.selectRow( SQL.loCreate, [ oid || 0 ] );
            if ( !res.ok ) throw res;

            oid = res.data.oid;

            for await ( let buffer of data ) {
                if ( !Buffer.isBuffer( buffer ) ) buffer = Buffer.from( buffer );

                res = await dbh.select( SQL.loPut, [ oid, start, buffer ] );

                if ( !res.ok ) {
                    data.destroy();

                    throw res;
                }

                start += buffer.length;
            }

            data.destroy();

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

        const stream = this.#createReadStream( oid, {
            range,
        } );

        return stream
            .buffer()
            .then( buffer => result( 200, { buffer } ) )
            .catch( e => result.catch( e ) );
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
        return new LargeObjectReadable( this.#dbh, oid, { range } );
    }
}

export default Super =>
    class extends Super {
        #largeObject;

        // properties
        get largeObject () {
            if ( !this.#largeObject ) {
                this.#largeObject = new LargeObject( this );
            }

            return this.#largeObject;
        }
    };
