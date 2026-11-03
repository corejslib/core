import stream from "#lib/stream";

const EOL = "\r\n",
    MAX_CHUNK_LENGTH = Number.MAX_SAFE_INTEGER,
    STATES = {
        "length": 1,
        "chunk": 2,
        "lastChunk": 3,
        "done": 4,
    };

export class ChunkedStreamEncoder extends stream.Transform {
    #eol;

    constructor ( { eol } = {} ) {
        super();

        this.#eol = eol || EOL;
        if ( !Buffer.isBuffer( this.#eol ) ) this.#eol = Buffer.from( this.#eol );
    }

    // properties
    get eol () {
        return this.#eol;
    }

    // protected
    _transform ( chunk, encoding, callback ) {

        // zero length chunk means the end of data, so it must not be written
        if ( !chunk.length ) return callback();

        this.push( Buffer.from( chunk.length.toString( 16 ) ) );
        this.push( this.#eol );
        this.push( chunk );
        this.push( this.#eol );

        callback();
    }

    _flush ( callback ) {
        this.push( Buffer.from( "0" ) );
        this.push( this.#eol );
        this.push( this.#eol );

        callback();
    }
}

export class ChunkedStreamDecoder extends stream.Transform {
    #eol;
    #maxChunkLength;
    #chunkLengthSize;
    #buffer;
    #state = STATES.length;
    #chunkLength;

    constructor ( { eol, maxChunkLength } = {} ) {
        super();

        this.#eol = eol || EOL;
        if ( !Buffer.isBuffer( this.#eol ) ) this.#eol = Buffer.from( this.#eol );

        this.#maxChunkLength = maxChunkLength || MAX_CHUNK_LENGTH;

        this.#chunkLengthSize = this.#maxChunkLength.toString( 16 ).length + this.#eol.length;
    }

    // properties
    get eol () {
        return this.#eol;
    }

    get maxChunkLength () {
        return this.#maxChunkLength;
    }

    // protected
    _transform ( chunk, encoding, callback ) {
        if ( !this.#buffer?.length ) {
            this.#buffer = chunk;
        }
        else {
            this.#buffer = Buffer.concat( [ this.#buffer, chunk ] );
        }

        while ( true ) {
            if ( !this.#buffer.length ) {
                return callback();
            }

            // done
            else if ( this.#state === STATES.done ) {
                return callback( new Error( "Chunked data is not valid" ) );
            }

            // length
            if ( this.#state === STATES.length ) {
                const idx = this.#buffer.subarray( 0, this.#chunkLengthSize ).indexOf( this.#eol );

                // length line is not complete
                if ( idx === -1 ) {
                    if ( this.#buffer.length < this.#chunkLengthSize ) {
                        return callback();
                    }
                    else {
                        return callback( new Error( "Chunk length is not valid" ) );
                    }
                }
                else if ( idx === 0 ) {
                    return callback( new Error( "Chunk length is not valid" ) );
                }
                else {
                    const string = this.#buffer.subarray( 0, idx ).toString( "latin1" );

                    // only hex digits are allowed
                    if ( !/^[0-9a-f]+$/iv.test( string ) ) {
                        return callback( new Error( "Chunk length is not valid" ) );
                    }

                    const length = Number.parseInt( string, 16 );

                    if ( length > this.#maxChunkLength ) {
                        return callback( new Error( "Chunk length is too large" ) );
                    }

                    this.#chunkLength = length;

                    this.#buffer = this.#buffer.subarray( idx + this.#eol.length );

                    if ( this.#chunkLength === 0 ) {
                        this.#state = STATES.lastChunk;
                    }
                    else {
                        this.#state = STATES.chunk;
                    }
                }
            }

            // chunk
            else {

                // read eol
                if ( this.#chunkLength === 0 ) {
                    if ( this.#buffer.length < this.#eol.length ) {
                        return callback();
                    }
                    else if ( this.#eol.equals( this.#buffer.subarray( 0, this.#eol.length ) ) ) {
                        this.#buffer = this.#buffer.subarray( this.#eol.length );

                        if ( this.#state === STATES.chunk ) {
                            this.#state = STATES.length;
                        }
                        else {
                            this.#state = STATES.done;
                        }
                    }
                    else {
                        return callback( new Error( "Chunked data is not valid" ) );
                    }
                }

                // read chunk body
                else {
                    const body = this.#buffer.subarray( 0, this.#chunkLength );

                    this.#buffer = this.#buffer.subarray( body.length );

                    this.#chunkLength -= body.length;

                    this.push( body );
                }
            }
        }
    }

    _flush ( callback ) {
        if ( this.#state === STATES.done ) {
            callback();
        }
        else {
            callback( new Error( "Chunked data is not valid" ) );
        }
    }
}
