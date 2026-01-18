import Range from "#lib/range";
import stream from "#lib/stream";

export default class StreamSlicer extends stream.Transform {
    #range;
    #readLength = 0;
    #writeLength = 0;

    constructor ( range, { ...options } = {} ) {
        super( options );

        this.#range = Range.new( range );

        this.setSize( this.#range.length );
    }

    // static
    static slice ( readableStream, { range } = {} ) {
        range = Range.new( range ).createRange( {
            "contentLength": readableStream.size,
        } );

        const sliceStream = new this( range );

        if ( readableStream.type ) {
            sliceStream.setType( readableStream.type );
        }

        if ( readableStream.name ) {
            sliceStream.setName( readableStream.name );
        }

        return stream.pipeline( readableStream, sliceStream, e => {} );
    }

    // properties
    get range () {
        return this.#range;
    }

    // protected
    _construct ( callback ) {
        if ( this.#range.isRelative ) {
            callback( "Range is not satisfiable" );
        }
        else {
            callback();
        }
    }

    _transform ( chunk, encoding, callback ) {
        this.#readLength += chunk.length;

        const rest = this.#range.maxLength - this.#writeLength;

        DATA: if ( rest > 0 ) {

            // start offset
            if ( !this.#writeLength && this.#range.start ) {
                if ( this.#readLength < this.#range.start ) {
                    break DATA;
                }
                else {
                    chunk = chunk.subarray( this.#range.start - ( this.#readLength - chunk.length ) );
                }
            }

            if ( chunk.length > rest ) {
                chunk = chunk.subarray( 0, rest );
            }

            if ( chunk.length ) {
                this.push( chunk );

                this.#writeLength += chunk.length;
            }
        }

        callback();
    }
}
