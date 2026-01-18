import HttpBody from "#lib/http/body";
import Headers from "#lib/http/headers";
import StreamJoiner from "#lib/stream/joiner";
import StreamSplitter from "#lib/stream/splitter";
import { objectIsPlain } from "#lib/utils";
import uuid from "#lib/uuid";

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
    #lastPart;

    constructor ( type, { boundary, autoEnd } = {} ) {
        super( {
            autoEnd,
        } );

        if ( !TYPES.has( type ) ) throw new Error( "Type is invalid" );

        this.#boundary = boundary || this.constructor.generateBoundary();
        this.#lastPart = Buffer.from( `--${ this.#boundary }--\r\n` );

        this.setType( `multipart/${ type }; boundary=${ this.boundary }` );
    }

    // static
    static generateBoundary () {
        return Buffer.from( ( uuid() + uuid() ).replaceAll( "-", "" ), "hex" ).toString( "base64url" );
    }

    // properties
    get boundary () {
        return this.#boundary;
    }

    // public
    write ( chunk, encoding, callback ) {
        if ( typeof encoding === "function" ) {
            callback = encoding;
            encoding = undefined;
        }

        if ( typeof chunk === "function" ) {
            const wrapper = async () => {
                var args = await chunk();

                if ( args != null ) {
                    if ( !Array.isArray( args ) ) args = [ args ];

                    return this.#createStream( ...args );
                }
            };

            super.write( wrapper, encoding, callback );
        }
        else {
            try {
                chunk = this.#createStream( chunk, encoding );
            }
            catch ( e ) {
                this.destroy( e );
            }

            super.write( chunk, encoding, callback );
        }
    }

    // protected
    _flush ( callback ) {

        // write last part
        this.push( this.#lastPart );

        callback();
    }

    _setSize ( size ) {
        if ( size != null && this.size == null ) {
            size += this.#lastPart.length;
        }

        return super._setSize( size );
    }

    // private
    #createStream ( chunk, encoding ) {
        var name, filename, headers, body, transform;

        if ( objectIsPlain( chunk ) ) {
            ( { headers, body, name, filename, transform } = chunk );
        }
        else {
            body = chunk;
        }

        headers = new Headers( headers );

        var contentType = headers.get( "content-type" );

        if ( typeof body === "function" ) {
            const createBody = body;

            body = async () => {
                var body = await createBody();

                if ( body != null ) {
                    ( { body } = this.#prepareBody( body, { encoding, contentType, filename } ) );
                }

                return body;
            };
        }
        else {
            ( { body, contentType, filename } = this.#prepareBody( body, { encoding, contentType, filename } ) );
        }

        if ( transform ) {
            const createBody = body;

            body = async () => {
                var body = createBody;

                if ( typeof body === "function" ) {
                    body = await body();
                }

                if ( body != null ) {
                    body = await transform( body );
                }

                return body;
            };
        }

        // add content-type
        if ( contentType ) {
            if ( filename ) {
                headers.set( "content-type", `${ contentType }; name="${ filename.replaceAll( '"', "%22" ) }"` );
            }
            else {
                headers.set( "content-type", contentType );
            }
        }

        // add content-disposition
        if ( name || filename ) headers.setContentDisposition( { name, filename } );

        const streamJoiner = new StreamJoiner().once( "error", () => {} );

        streamJoiner.write( Buffer.from( `--${ this.boundary }\r\n${ headers.toString() }\r\n` ) );

        streamJoiner.write( body );

        streamJoiner.write( EOL );

        streamJoiner.end();

        return streamJoiner;
    }

    #prepareBody ( body, { encoding, contentType, filename } = {} ) {
        const httpBody = HttpBody.new( body, {
            encoding,
            contentType,
        } );

        contentType = httpBody.contentType;

        if ( httpBody.isFile ) {
            filename ||= httpBody.body.name;
        }

        body = httpBody.createBody();

        return {
            body,
            contentType,
            filename,
        };
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
