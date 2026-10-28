import Headers from "#lib/http/headers";
import Message from "#lib/message";
import stream from "#lib/stream";
import StreamJoiner from "#lib/stream/joiner";
import StreamSplitter from "#lib/stream/splitter";
import Uuid from "#lib/uuid";

const TYPES = new Set( [

        //
        "alternative",
        "byteranges",
        "form-data",
        "mixed",
        "related",
    ] ),
    BOUNDARY_POSTFIX = Buffer.from( "--" ),
    EOL = Buffer.from( "\r\n" );

export class MultipartStreamEncoder extends StreamJoiner {
    #boundary;
    #contentType;
    #lastPart;

    constructor ( type, { boundary, autoEnd } = {} ) {
        super( {
            autoEnd,
        } );

        if ( !TYPES.has( type ) ) throw new Error( "Type is invalid" );

        this.#boundary = boundary || this.constructor.generateBoundary();
        this.#lastPart = Buffer.from( `--${ this.#boundary }--\r\n` );

        this.#contentType = `multipart/${ type }; boundary=${ this.boundary }`;

        this._setContentLength( this.#lastPart.length );
    }

    // static
    static generateBoundary () {
        return Buffer.fromHex( ( Uuid.v4() + Uuid.v4() ).replaceAll( "-", "" ) ).toString( "base64url" );
    }

    // properties
    get boundary () {
        return this.#boundary;
    }

    get contentType () {
        return this.#contentType;
    }

    // public
    write ( chunk, encoding, callback ) {
        if ( typeof encoding === "function" ) {
            callback = encoding;
            encoding = undefined;
        }

        const message = Message.new( chunk );

        if ( message.isGenerated ) {
            this.#createBody( message );
        }
        else {
            message.addMiddleware( this.#generateBody.bind( this ) );
        }

        super.write( message, encoding, callback );
    }

    // protected
    _flush ( callback ) {

        // write last part
        this.push( this.#lastPart );

        callback();
    }

    // private
    async #generateBody ( message ) {
        await message.generateBody();

        this.#createBody( message );
    }

    #createBody ( message ) {
        const body = message.createBodySync();

        const streamJoiner = new StreamJoiner().once( "error", () => {} );

        streamJoiner.write( Buffer.from( `--${ this.boundary }\r\n` ) );

        streamJoiner.write( message.headers.toBuffer( { "crlf": true } ) );

        streamJoiner.write( body );

        streamJoiner.write( EOL );

        streamJoiner.end();

        message.setBody( streamJoiner );
    }
}

export class MultipartStreamDecoder extends StreamSplitter {
    #boundary;
    #boundaryBuffer;
    #firstBoundary;
    #ended;

    constructor ( boundary ) {
        const eol = boundary
            ? "\r\n--" + boundary
            : null;

        super( {
            eol,
        } );

        this.#boundary = boundary;
        this.#boundaryBuffer = Buffer.from( "--" + this.#boundary );
    }

    // static
    static async parseMultipartStream ( multipartStream, { boundary, maxContentLength, maxBufferLength } = {} ) {
        if ( multipartStream instanceof MultipartStreamEncoder ) {
            boundary = multipartStream.boundary;
        }

        await using disposableStack = new AsyncDisposableStack();

        disposableStack.use( multipartStream );

        if ( maxBufferLength > maxContentLength ) {
            maxBufferLength = maxContentLength;
        }

        const multipartStreamDecoder = new MultipartStreamDecoder( boundary );

        disposableStack.use( multipartStreamDecoder );

        stream.pipeline( multipartStream, multipartStreamDecoder, () => {} );

        const parts = [],
            fields = {};

        for await ( const { headers, "body": bodyStream } of multipartStreamDecoder ) {
            let body;

            // read body stream
            READ_BODY: try {

                // read to buffer
                READ_BUFFER: if ( maxBufferLength ) {
                    let length = 0;
                    const buffers = [];

                    for await ( const buffer of bodyStream.iterator( { "destroyOnReturn": false } ) ) {
                        length += buffer.length;
                        buffers.push( buffer );

                        if ( length > maxBufferLength ) {
                            bodyStream.unshift( Buffer.concat( buffers ) );

                            break READ_BUFFER;
                        }
                    }

                    body = Buffer.concat( buffers );

                    break READ_BODY;
                }

                // read to tmp file
                body = await bodyStream.toTmpFile( { "maxLength": maxContentLength } );
            }
            catch ( e ) {
                bodyStream.destroy();

                throw e;
            }

            const name = headers.contentDisposition.name || "",
                part = new Message( {
                    headers,
                    body,
                } );

            parts.push( part );

            if ( fields[ name ] == null ) {
                fields[ name ] = part;
            }
            else {
                if ( !Array.isArray( fields[ name ] ) ) fields[ name ] = [ fields[ name ] ];

                fields[ name ].push( part );
            }
        }

        return {
            parts,
            fields,
        };
    }

    // properties
    get boundary () {
        return this.#boundary;
    }

    // public
    push ( stream ) {
        if ( stream == null ) {
            return super.push( stream );
        }
        else {
            this.#processPart( stream );

            return true;
        }
    }

    // protected
    _construct ( callback ) {
        callback( this.#boundary
            ? null
            : "Unable to parse boundary" );
    }

    _transform ( chunk, encoding, callback ) {
        if ( this.#firstBoundary === true ) {
            super._transform( chunk, encoding, callback );
        }
        else {
            if ( this.#firstBoundary ) {
                this.#firstBoundary = Buffer.concat( [ this.#firstBoundary, chunk ] );
            }
            else {
                this.#firstBoundary = chunk;
            }

            if ( this.#firstBoundary.length < this.#boundaryBuffer.length ) {
                callback();
            }
            else if ( this.#firstBoundary.subarray( 0, this.#boundaryBuffer.length ).equals( this.#boundaryBuffer ) ) {
                chunk = this.#firstBoundary.subarray( this.#boundaryBuffer.length );

                this.#firstBoundary = true;

                if ( chunk.length ) {
                    super._transform( chunk, encoding, callback );
                }
                else {
                    callback();
                }
            }
            else {
                callback( new Error( "Invalid multipart data" ) );
            }
        }
    }

    // private
    async #processPart ( stream ) {
        var chunk;

        try {
            ERROR: {

                // data after last part
                if ( this.#ended ) break ERROR;

                chunk = await stream.readChunk( 4 );
                if ( !chunk ) break ERROR;

                // end
                if ( chunk.subarray( 0, 2 ).equals( BOUNDARY_POSTFIX ) ) {
                    this.#ended = true;

                    if ( !chunk.subarray( 2 ).equals( EOL ) ) break ERROR;

                    // check part has no more data
                    chunk = await stream.readChunk( 1 );
                    if ( chunk ) break ERROR;

                    stream.resume();
                }

                // part
                else {
                    if ( !chunk.subarray( 0, 2 ).equals( EOL ) ) break ERROR;

                    var headers;

                    if ( chunk.subarray( 2 ).equals( EOL ) ) {
                        headers = new Headers();
                    }
                    else {
                        stream.unshift( chunk.subarray( 2 ) );

                        headers = await stream.readHttpHeaders();
                        if ( !headers ) break ERROR;

                        // parse headers
                        headers = Headers.parse( headers );
                    }

                    super.push( {
                        headers,
                        "body": stream,
                    } );
                }

                return;
            }

            stream.destroy( new Error( "Invalid multipart data" ) );
        }
        catch ( e ) {
            stream.destroy( e );
        }
    }
}
