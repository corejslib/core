import "#lib/result";
import fs from "node:fs";
import Blob from "#lib/blob";
import File from "#lib/file";
import { pathExists } from "#lib/fs";
import Headers from "#lib/http/headers";
import mime from "#lib/mime";
import Range from "#lib/range";
import Ranges from "#lib/ranges";
import stream from "#lib/stream";
import StreamJoiner from "#lib/stream/joiner";
import { MultipartStreamEncoder } from "#lib/stream/multipart";
import StreamSlicer from "#lib/stream/slicer";
import { TmpFile } from "#lib/tmp";
import { isPlainObject } from "#lib/utils";
import * as zlib from "#lib/zlib";

const DEFAULT_CONTENT_ENCODING = "gzip",
    CONTENT_ENCODINGS = {
        "br": "brotli",
        "deflate": "deflate",
        "gzip": "gzip",
        "identity": null,
        "zstd": "zstd",
    },
    TRANSFER_ENCODINGS = {
        "deflate": "deflate",
        "gzip": "gzip",
    };

export default class Message {
    #status;
    #headers;
    #body;
    #options;

    #isDestroyed = false;
    #isFunctionBody;
    #isStreamBody;
    #isFileBody;

    #streams = new Set();
    #middlewares = [];
    #runningMiddleware = false;

    constructor ( message = {} ) {
        if ( !isPlainObject( message ) ) throw new TypeError( "Message should be a plsin object" );

        this.setStatus( message.status );

        this.#headers = new Headers( message.headers );

        // do not replace content type
        this.setBody( message.body );

        if ( message.options ) {
            this.#options = { ...message.options };
        }
        else {
            this.#options = {};
        }
    }

    // static
    static new ( message ) {
        if ( message instanceof this ) {
            return message;
        }
        else {
            var status, headers, body, options;

            if ( !message ) {
                status = 200;
            }

            // number
            else if ( typeof message === "number" ) {
                status = message;
            }

            // object
            else if ( typeof message === "object" ) {

                // plain object
                if ( isPlainObject( message ) ) {
                    ( { status, headers, body, options } = message );
                }

                // Result
                else if ( message instanceof result.Result ) {
                    status = message.status;
                }

                // other object
                else {
                    body = message;
                }
            }

            // other type
            else {
                body = message;
            }

            return new this( { status, headers, body, options } );
        }
    }

    static isValidBody ( body ) {
        if ( body == null ) {
            return true;
        }
        else if ( typeof body === "string" || typeof body === "number" ) {
            return true;
        }
        else if ( ArrayBuffer.isView( body ) || body instanceof ArrayBuffer ) {
            return true;
        }
        else if ( body instanceof this || body instanceof globalThis.Blob || body instanceof stream.Readable || body instanceof URLSearchParams ) {
            return true;
        }
        else {
            return false;
        }
    }

    // properties
    get ok () {
        return this.#status >= 200 && this.#status < 300;
    }

    get status () {
        return this.#status;
    }

    get statusText () {
        return result.getStatusText( this.#status );
    }

    get headers () {
        return this.#headers;
    }

    get body () {
        return this.#body;
    }

    get options () {
        return this.#options;
    }

    get hasBody () {
        return this.#body != null;
    }

    get isGenerated () {
        return !this.#isFunctionBody && !this.#middlewares.length;
    }

    get isDestroyed () {
        return this.#isDestroyed;
    }

    get isBufferedBody () {
        return this.hasBody && !this.#isFunctionBody && !this.#isFileBody && !this.#isStreamBody;
    }

    get isReusableBody () {
        return this.hasBody && !this.#isStreamBody;
    }

    get isFunctionBody () {
        return this.#isFunctionBody;
    }

    get isStreamBody () {
        return this.#isStreamBody;
    }

    get isFileBody () {
        return this.#isFileBody;
    }

    get isRealFileBody () {
        return this.#isFileBody && this.#body.isRealFile;
    }

    get contentLength () {
        return this.#headers.contentLength.bytes;
    }

    get generatedContentLength () {
        if ( this.isGenerated ) {
            return this.#headers.contentLength.bytes;
        }
        else {
            return;
        }
    }

    get contentType () {
        return this.#headers.contentType.value;
    }

    get contentDisposition () {
        return this.#headers.contentDisposition;
    }

    // public
    setStatus ( status ) {
        if ( this.#isDestroyed ) throw new Error( "Message is destroyed" );

        if ( !status ) {
            this.#status = 200;
        }
        else if ( typeof status === "number" ) {
            this.#status = result.getHttpStatus( status );
        }
        else {
            throw new Error( "HTTP message status is not valid" );
        }

        return this;
    }

    setBody ( body, { encoding } = {} ) {
        if ( this.#isDestroyed ) throw new Error( "Message is destroyed" );

        var contentLength, contentType, filename, lastModified;

        this.#clearBody();

        if ( body == null ) {
            this.deleteBody();
        }

        // function
        else if ( typeof body === "function" ) {
            if ( this.#runningMiddleware ) throw new Error( "Message body function added from middleware" );

            this.#isFunctionBody = true;
            this.#body = body;
        }
        else {

            // string
            if ( typeof body === "string" ) {
                body = Buffer.from( body, encoding );
            }

            // number
            else if ( typeof body === "number" ) {
                body = Buffer.from( body.toString() );
            }

            // URLSearchParams
            else if ( body instanceof URLSearchParams ) {
                body = Buffer.from( body.toString() );

                contentType = "application/x-www-form-urlencoded; charset=utf-8";
            }

            // View
            if ( ArrayBuffer.isView( body ) ) {
                if ( !Buffer.isBuffer( body ) ) {
                    body = Buffer.from( body.buffer, body.byteOffset, body.byteLength );
                }

                contentLength = body.length;
            }

            // ArrayBuffer
            else if ( body instanceof ArrayBuffer ) {
                body = Buffer.from( body );

                contentLength = body.length;
            }

            // stream.Readable
            else if ( body instanceof stream.Readable ) {
                this.#isStreamBody = true;

                this.#streams.add( body );

                if ( body instanceof StreamJoiner ) {
                    contentLength = body.contentLength;
                    contentType = body.contentType;
                }
            }

            // File
            else if ( body instanceof File ) {
                this.#isFileBody = true;

                contentLength = body.size;
                contentType = body.type;
                filename = body.name;
                lastModified = body.lastModified;
            }

            // Blob
            else if ( body instanceof Blob ) {
                contentLength = body.size;
                contentType = body.type;
            }

            // global.Blob
            else if ( body instanceof globalThis.Blob ) {
                contentLength = body.size;
                contentType = body.type;

                // global.File
                if ( body instanceof globalThis.File ) {
                    filename = body.name;
                    lastModified = Temporal.Instant.fromEpochMilliseconds( body.lastModified );
                }

                body = new Blob( [ body ], {
                    "type": contentType,
                } );
            }

            // Message
            else if ( body instanceof Message ) {
                if ( !body.isGenerated ) {
                    throw new Error( "Body message is not generated" );
                }
                else {
                    contentLength = body.contentLength;
                    contentType = body.contentType;
                    filename = body.contentDisposition.filename;
                    lastModified = body.headers.lastModified.date;

                    body = body.body;
                }
            }

            // error
            else {
                throw new TypeError( "Body type is not supported" );
            }

            this.#body = body;

            this.#headers.contentLength.set( contentLength );

            if ( contentType && !this.contentType ) {
                this.#headers.set( "content-type", contentType );
            }

            if ( filename && !this.contentDisposition.filename ) {
                this.#headers.contentDisposition.setFilename( filename );
            }

            if ( lastModified && !this.#headers.lastModified.date ) {
                this.#headers.lastModified.set( lastModified );
            }
        }

        return this;
    }

    deleteBody () {
        this.#deleteBody();

        return this;
    }

    async checkBody () {
        if ( !this.isRealFileBody ) return;

        if ( !( await pathExists( this.#body.path ) ) ) {
            this.setStatus( 404 ).deleteBody();
        }
    }

    checkCache ( method, headers ) {
        if ( !this.ok ) return this;

        IF_MATCH: {
            const etag = this.#headers.etag.etag;
            if ( !etag ) break IF_MATCH;

            const etags = headers.ifMatch.etags;
            if ( !etags ) break IF_MATCH;

            // strong validation, weak etag never match
            if ( etag.startsWith( 'W/"' ) ) {
                return this.setStatus( 412 ).deleteBody();
            }

            // NOTE: for "*" - check if resource exists or return 412
            // NOTE: currently this is not implemented
            if ( etags.has( "*" ) ) break IF_MATCH;

            if ( etags.has( etag ) ) break IF_MATCH;

            return this.setStatus( 412 ).deleteBody();
        }

        IF_NONE_MATCH: {
            const etag = this.#headers.etag.etag;
            if ( !etag ) break IF_NONE_MATCH;

            const etags = headers.ifNoneMatch.etags;
            if ( !etags ) break IF_NONE_MATCH;

            // NOTE: for "*" - check if resource DOES NOT exists or return error
            // NOTE: currently this is not implemented
            if ( etags.has( "*" ) || etags.has( etag ) ) {
                if ( method === "GET" || method === "HEAD" ) {
                    return this.setStatus( 304 ).deleteBody();
                }
                else {
                    return this.setStatus( 412 ).deleteBody();
                }
            }
        }

        IF_MODIFIED_SINCE: {
            if ( method !== "GET" && method !== "HEAD" ) break IF_MODIFIED_SINCE;

            const lastModifiedDate = this.#headers.lastModified.date;
            if ( !lastModifiedDate ) break IF_MODIFIED_SINCE;

            const date = headers.ifModifiedSince.date;
            if ( !date ) break IF_MODIFIED_SINCE;

            if ( lastModifiedDate <= date ) {
                return this.setStatus( 304 ).deleteBody();
            }
        }

        IF_UNMODIFIED_SINCE: {
            const lastModifiedDate = this.#headers.lastModified.date;
            if ( !lastModifiedDate ) break IF_UNMODIFIED_SINCE;

            const date = headers.ifUnmodifiedSince.date;
            if ( !date ) break IF_UNMODIFIED_SINCE;

            if ( lastModifiedDate > date ) {
                return this.setStatus( 412 ).deleteBody();
            }
        }

        return this;
    }

    addMiddleware ( middleware ) {
        if ( this.#isDestroyed ) throw new Error( "Message is destroyed" );

        if ( this.#runningMiddleware ) throw new Error( "Message middleware added from other middleware" );

        if ( middleware ) {
            if ( typeof middleware !== "function" ) throw new Error( "Middleware is not a function" );

            this.#middlewares.push( middleware );
        }

        return this;
    }

    addContentEncodingMiddleware ( { headers, compress, zlibOptions } = {} ) {
        if ( this.#isDestroyed ) throw new Error( "Message is destroyed" );

        this.headers.add( "vary", "Accept-Encoding" );

        var encoding;

        if ( headers ) {
            const acceptEncodings = headers.acceptEncoding.encodings;
            if ( !acceptEncodings ) return this;

            for ( encoding of acceptEncodings ) {
                if ( encoding in CONTENT_ENCODINGS ) break;
            }

            if ( !encoding ) {
                if ( acceptEncodings.has( "*" ) ) {
                    encoding = DEFAULT_CONTENT_ENCODING;
                }
                else {
                    return this;
                }
            }
        }
        else {
            encoding = DEFAULT_CONTENT_ENCODING;
        }

        if ( !CONTENT_ENCODINGS[ encoding ] ) return this;

        this.addMiddleware( async message => {
            return contentEncodingMiddleware( message, encoding, {
                compress,
                zlibOptions,
            } );
        } );

        return this;
    }

    addContentRangeMiddleware ( { ranges, headers, maxRanges } = {} ) {
        if ( this.#isDestroyed ) throw new Error( "Message is destroyed" );

        this.headers.add( "vary", "Range" );

        if ( ranges ) {
            ranges = Ranges.new( ranges );
        }
        else {
            ranges = headers?.range.ranges;
        }

        // not a ranged request
        if ( !ranges ) return this;

        this.addMiddleware( async message => {
            return contentRangeMiddleware( message, ranges, {
                headers,
                maxRanges,
            } );
        } );

        return this;
    }

    addTransferEncodingMiddleware ( { headers, compress, zlibOptions } = {} ) {
        if ( this.#isDestroyed ) throw new Error( "Message is destroyed" );

        this.headers.add( "vary", "TE" );

        var encoding;

        if ( headers ) {
            const te = headers.te.encodings;
            if ( !te ) return this;

            for ( encoding of te ) {
                if ( encoding in TRANSFER_ENCODINGS ) break;
            }

            if ( !encoding ) {
                return this;
            }
        }
        else {
            return this;
        }

        if ( !TRANSFER_ENCODINGS[ encoding ] ) return this;

        this.addMiddleware( async message => {
            return transferEncodingMiddleware( message, encoding, {
                compress,
                zlibOptions,
            } );
        } );

        return this;
    }

    async generateBody ( { range, createStream } = {} ) {

        // run middlewares if not called from middleware
        MIDDLEWARES: if ( !this.#runningMiddleware && this.#middlewares.length ) {
            while ( true ) {
                const middleware = this.#middlewares.shift();

                if ( !middleware ) break MIDDLEWARES;

                this.#runningMiddleware = true;

                // run middleware
                try {
                    await middleware( this );

                    this.#runningMiddleware = false;
                }
                catch ( e ) {

                    // error calling middleware
                    this.#runningMiddleware = false;

                    await this.#onGenerationError( e );
                }
            }
        }

        // function
        if ( this.#isFunctionBody ) {
            let body;

            try {
                body = await this.#body( { range, createStream } );
            }
            catch ( e ) {
                await this.#onGenerationError( e );
            }

            if ( typeof body === "function" ) {
                throw new TypeError( "Body shoutl not be a function" );
            }

            this.setBody( body );
        }
    }

    async createBody ( { range, createStream } = {} ) {
        if ( !this.isGenerated ) {
            await this.generateBody( { range, createStream } );

            range = undefined;
        }

        var body;

        // File
        if ( this.#isFileBody ) {
            body = this.#body.stream( {
                range,
            } );
        }

        // Blob
        else if ( this.#body instanceof Blob ) {
            if ( createStream ) {
                body = this.#body.stream( {
                    range,
                } );
            }
            else {
                body = this.#body.buffer( {
                    range,
                } );
            }
        }

        // stream.Readable
        else if ( this.#isStreamBody ) {
            if ( range ) {
                range = Range.new( range ).createRange( {
                    "contentLength": this.contentLength,
                } );

                if ( range.isFullRange ) {
                    body = this.#body;
                }
                else {
                    body = StreamSlicer.slice( this.#body, { range } );
                }
            }
            else {
                body = this.#body;
            }
        }

        // Buffer
        else {
            if ( range ) {
                range = Range.new( range ).createRange( {
                    "contentLength": this.contentLength,
                } );

                if ( range.isFullRange ) {
                    body = this.#body;
                }
                else {
                    body = this.#body.subarray( range.start, range.end );
                }
            }
            else {
                body = this.#body;
            }

            if ( createStream ) {
                body = stream.Readable.from( body, { "objectMode": false } );
            }
        }

        return body;
    }

    async createBodyStream ( { range } = {} ) {
        return this.createBody( { range, "createStream": true } );
    }

    createBodySync ( { range, createStream } = {} ) {

        // not generated
        if ( !this.isGenerated ) {
            throw new Error( "Message is not generated" );
        }
        else {
            return this.#createBodySync( { range, createStream } );
        }
    }

    createBodyStreamSync ( { range } = {} ) {
        return this.createBodySync( { range, "createStream": true } );
    }

    async destroy () {
        if ( !this.#isDestroyed ) {
            this.#isDestroyed = true;

            this.#status = 500;

            // remove middlewares
            this.#middlewares.length = 0;

            // delete body
            return this.#deleteBody();
        }
    }

    async toReusableBody () {
        if ( !this.hasBody || this.isReusableBody ) return;

        return await this.toFileBody();
    }

    async toFileBody () {
        var body;

        if ( this.#isFunctionBody ) {
            body = await this.#body();

            this.setBody( body );
        }

        if ( !this.hasBody || this.#isFileBody ) return;

        body = this.#createBodySync();

        const tmpFile = new TmpFile( {
            "type": this.contentType,
            "name": this.contentDisposition.filename,
            "lastModified": this.headers.lastModified.date,
        } );

        if ( Buffer.isBuffer( body ) ) {
            await fs.promises.writeFile( tmpFile.path, body );
        }
        else {
            await stream.promises.pipeline( body, fs.createWriteStream( tmpFile.path ) );
        }

        this.setBody( tmpFile );
    }

    [ Symbol.dispose ] () {
        this.destroy();
    }

    async [ Symbol.asyncDispose ] () {
        return this.destroy();
    }

    [ Symbol.for( "nodejs.util.inspect.custom" ) ] ( depth, options, inspect ) {
        const spec = {
            "status": `${ this.status } ${ this.statusText }`,
            "isGenerated": this.isGenerated,
            "hasBody": this.hasBody,
        };

        if ( this.hasBody ) {
            if ( this.contentLength != null ) {
                spec.contentLength = this.contentLength;
            }

            if ( this.contentType ) {
                spec.contentType = this.contentType;
            }
        }

        return `${ this.constructor.name }: ${ inspect( spec ) }`;
    }

    // private
    #clearBody () {
        this.#body = null;

        this.#isFunctionBody = false;
        this.#isStreamBody = false;
        this.#isFileBody = false;
    }

    async #deleteBody () {
        this.#clearBody();

        // delete "content-*" headers
        this.#headers.deleteContentHeaders();

        // destroy streams
        if ( this.#streams.size ) {
            const streams = this.#streams;
            this.#streams = new Set();

            const promises = [];

            for ( const stream of streams ) {
                if ( stream.closed ) continue;

                promises.push( new Promise( resolve => stream.once( "close", resolve ) ) );

                stream.destroy();
            }

            return Promise.all( promises );
        }
    }

    async #onGenerationError ( e ) {
        this.setStatus( 500 );

        await this.destroy();

        throw e;
    }

    #createBodySync ( { range, createStream } = {} ) {
        if ( !this.#body ) {
            return;
        }
        else if ( this.#isFunctionBody ) {
            throw new Error( "Budy is function" );
        }

        var body;

        // File
        if ( this.#isFileBody ) {
            body = this.#body.stream( {
                range,
            } );
        }

        // Blob
        else if ( this.#body instanceof Blob ) {
            body = this.#body.stream( {
                range,
            } );
        }

        // stream.Readable
        else if ( this.#isStreamBody ) {
            if ( range ) {
                range = Range.new( range ).createRange( {
                    "contentLength": this.contentLength,
                } );

                if ( range.isFullRange ) {
                    body = this.#body;
                }
                else {
                    body = StreamSlicer.slice( this.#body, { range } );
                }
            }
            else {
                body = this.#body;
            }
        }

        // Buffer
        else {
            if ( range ) {
                range = Range.new( range ).createRange( {
                    "contentLength": this.contentLength,
                } );

                if ( range.isFullRange ) {
                    body = this.#body;
                }
                else {
                    body = this.#body.subarray( range.start, range.end );
                }
            }
            else {
                body = this.#body;
            }

            if ( createStream ) {
                body = stream.Readable.from( body, { "objectMode": false } );
            }
        }

        return body;
    }
}

// private
async function contentEncodingMiddleware ( message, encoding, { compress, zlibOptions } ) {
    if ( message.isDestroyed ) return;

    if ( !message.hasBody ) return;

    compress = message.options.compress ?? compress;

    // compression is disabled
    if ( !compress ) return;

    // already compressed
    if ( message.headers.contentEncoding.hasValue ) return;
    if ( message.headers.transferEncoding.hasValue ) return;

    // do not compress partial content
    if ( message.status === 206 ) return;

    // check minimum content length
    if ( typeof compress !== "boolean" && message.contentLength < compress ) return;

    // check content type is compressible
    const mimeType = mime.get( message.contentType );
    if ( !mimeType?.compressible ) return;

    message.headers.set( "content-encoding", encoding );

    // make etag weak
    const etag = message.headers.get( "etag" );
    if ( etag && !etag.startsWith( "W/" ) ) {
        message.headers.set( "etag", "W/" + etag );
    }

    // generate body
    zlibOptions = message.options.zlibOptions ?? zlibOptions;

    const comressedBody = await zlib.compress( CONTENT_ENCODINGS[ encoding ], message, zlibOptions );

    message.setBody( comressedBody );
}

async function contentRangeMiddleware ( message, ranges, { headers, maxRanges } ) {
    if ( message.isDestroyed ) return;

    if ( !message.hasBody ) return;

    // ranges are not accepted
    if ( !message.headers.acceptRanges.isRangesAccepted ) return;

    // ranges already applied
    if ( message.status === 206 || message.status === 416 ) return;

    // check cache
    if ( headers ) {
        IF_RANGE: {
            if ( !headers.ifRange.hasValue ) break IF_RANGE;

            const ifRange = headers.ifRange;

            if ( ifRange.date ) {
                const lastModifiedDate = message.headers.lastModified.date;
                if ( !lastModifiedDate ) break IF_RANGE;

                if ( lastModifiedDate > ifRange.date ) {
                    return;
                }
            }
            else if ( ifRange.etag ) {
                if ( ifRange.etag === "*" ) break IF_RANGE;

                const etag = message.headers.etag.etag;
                if ( !etag ) break IF_RANGE;

                // strong validation, weak etag never match
                if ( etag.startsWith( 'W/"' ) ) return;

                if ( etag !== ifRange.etag ) return;
            }
        }
    }

    var supported = true;

    RANGES: {
        if ( !ranges.size || ( maxRanges && ranges.size > maxRanges ) ) {
            supported = false;

            break RANGES;
        }

        ranges = [ ...ranges ];

        for ( let n = 0; n < ranges.length; n++ ) {
            const range = ranges[ n ].createRange( {
                "contentLength": message.contentLength,
            } );

            if ( range.isFullRange ) {
                return;
            }
            else if ( !range.isValidHttpContentRange ) {
                supported = false;

                break RANGES;
            }

            ranges[ n ] = range;
        }
    }

    // ranges are not supported
    if ( !supported ) {
        message.setStatus( 416 ).deleteBody();

        message.headers.set( {
            "content-range": `bytes */${ message.contentLength ?? "*" }`,
        } );
    }

    // ranges are supported
    else {

        // single range
        if ( ranges.length === 1 ) {
            const range = ranges[ 0 ];

            message.setStatus( 206 );

            message.headers.set( {
                "content-range": range.toContentRangeHeader(),
            } );

            // add body
            const body = await message.createBody( { range } );

            message.setBody( body );
        }

        // multiple ranges
        else {
            message.setStatus( 206 );

            // convert to reusable body
            if ( !message.isReusableBody ) {
                await message.toReusableBody();
            }

            // add body
            const multipartStream = new MultipartStreamEncoder( "byteranges" );

            for ( const range of ranges ) {
                let body;

                if ( message.isBufferedBody ) {
                    body = await message.createBody( { range } );
                }

                // delayed range creation
                else {
                    const part = new Message( { "body": message.body } );

                    body = async () => part.createBody( { range } );
                }

                multipartStream.write( {
                    "headers": {
                        "content-encoding": message.headers.get( "content-encoding" ),
                        "content-type": message.contentType,
                        "content-range": range.toContentRangeHeader(),
                    },
                    body,
                } );
            }

            multipartStream.end();

            message.setBody( multipartStream );

            // set headers
            message.headers.set( {
                "content-type": multipartStream.contentType,
            } );
        }
    }
}

async function transferEncodingMiddleware ( message, encoding, { compress, zlibOptions } ) {
    if ( message.isDestroyed ) return;

    if ( !message.hasBody ) return;

    compress = message.options.compress ?? compress;

    // compression is disabled
    if ( !compress ) return;

    // already compressed
    if ( message.headers.contentEncoding.hasValue ) return;
    if ( message.headers.transferEncoding.hasValue ) return;

    // check minimum content length
    if ( typeof compress !== "boolean" && message.contentLength < compress ) return;

    // check content type is compressible
    const mimeType = mime.get( message.contentType );
    if ( !mimeType?.compressible ) return;

    message.headers.transferEncoding.setEncoding( encoding );

    // generate body
    zlibOptions = message.options.zlibOptions ?? zlibOptions;

    const body = await message.createBodyStream(),
        comressedBody = await zlib.compress( TRANSFER_ENCODINGS[ encoding ], body, zlibOptions );

    message.setBody( comressedBody );
}
