import "#lib/result";
import zlib from "node:zlib";
import HttpBody from "#lib/http/body";
import Headers from "#lib/http/headers";
import HttpResponse from "#lib/http/response";
import mime from "#lib/mime";
import stream from "#lib/stream";
import { objectIsPlain } from "#lib/utils";

const DEFAULT_ENCODING = "gzip",
    ENCODINGS_COMPRESSORS = {
        "br": zlib.createBrotliCompress,
        "deflate": zlib.createDeflate,
        "gzip": zlib.createGzip,
        "identity": null,
        "zstd": zlib.createZstdCompress,
    };

export default class HttpMessage {
    #status;
    #headers;
    #body;
    #compress;
    #zlibOptions;
    #lastModifiedDate;

    constructor ( { status, headers, body, compress, zlibOptions } = {} ) {
        this.#headers = new Headers( headers );

        this.#setStatus( status );

        this.#setBody( body );

        this.#compress = compress;
        this.#zlibOptions = zlibOptions;
    }

    // static
    static new ( httpMessage ) {
        if ( httpMessage instanceof this ) {
            return httpMessage;
        }
        else {
            var status, headers, body, compress, zlibOptions;

            if ( !httpMessage ) {
                status = 200;
            }

            // httpMessage is status number
            else if ( typeof httpMessage === "number" ) {
                status = httpMessage;
            }

            // httpMessage is plain object
            else if ( objectIsPlain( httpMessage ) ) {
                ( { status, headers, body, compress, zlibOptions } = httpMessage );
            }

            // httpMessage is http response
            else if ( httpMessage instanceof HttpResponse ) {
                status = httpMessage.status;
                headers = httpMessage.headers;
                body = httpMessage.body;
            }

            // options is result
            else if ( httpMessage instanceof result.Result ) {
                status = httpMessage.status;

                if ( objectIsPlain( httpMessage.data ) ) {
                    ( { headers, body, compress, zlibOptions } = httpMessage.data );
                }
                else {
                    body = httpMessage.data;
                }
            }

            // options is body
            else {
                body = httpMessage;
            }

            return new this( { status, headers, body, compress, zlibOptions } );
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

    get hasBody () {
        return this.#body != null && this.#body.hasBody;
    }

    get body () {
        return this.#body;
    }

    get compress () {
        return this.#compress;
    }

    get zlibOptions () {
        return this.#zlibOptions;
    }

    get contentLength () {
        return this.#headers.contentLength;
    }

    get contentType () {
        return this.#headers.get( "content-type" );
    }

    get lastModifiedDate () {
        PARSE: if ( this.#lastModifiedDate === undefined ) {
            this.#lastModifiedDate = null;

            // get from header
            let date = this.#headers.lastModified;

            if ( date ) {
                this.#lastModifiedDate = date;

                break PARSE;
            }

            // get from body file
            if ( this.#body?.isFile ) {
                date = this.#body.body.lastModifiedDate;

                if ( date ) {
                    this.#lastModifiedDate = date;
                }
            }
        }

        return this.#lastModifiedDate;
    }

    // public
    checkBody () {
        if ( this.ok && this.#body?.isFile ) {
            if ( !this.#body.isFileExists ) {
                this.#dropBody( 404 );
            }
        }

        return this;
    }

    checkCache ( headers, method ) {
        if ( !this.ok ) return;

        if ( this.lastModifiedDate ) {
            this.#headers.set( "last-modified", this.lastModifiedDate.toUTCString() );
        }

        IF_MATCH: {
            const etag = this.#headers.etag;
            if ( !etag ) break IF_MATCH;

            const etags = headers.ifMatch;
            if ( !etags ) break IF_MATCH;

            // strong validation, weak etag never match
            if ( etag.startsWith( 'W/"' ) ) {
                return this.#dropBody( 412 );
            }

            // NOTE: for "*" - check if resource exists or return 412
            // NOTE: currently this is not implemented
            if ( etags.has( "*" ) ) break IF_MATCH;

            if ( etags.has( etag ) ) break IF_MATCH;

            return this.#dropBody( 412 );
        }

        IF_NONE_MATCH: {
            const etag = this.#headers.etag;
            if ( !etag ) break IF_NONE_MATCH;

            const etags = headers.ifNoneMatch;
            if ( !etags ) break IF_NONE_MATCH;

            // NOTE: for "*" - check if resource DOES NOT exists or return error
            // NOTE: currently this is not implemented
            if ( etags.has( "*" ) || etags.has( etag ) ) {
                if ( method === "get" || method === "head" ) {
                    return this.#dropBody( 304 );
                }
                else {
                    return this.#dropBody( 412 );
                }
            }
        }

        IF_MODIFIED_SINCE: {
            if ( method !== "get" && method !== "head" ) break IF_MODIFIED_SINCE;

            const lastModifiedDate = this.lastModifiedDate;
            if ( !lastModifiedDate ) break IF_MODIFIED_SINCE;

            const date = headers.ifModifiedSince;
            if ( !date ) break IF_MODIFIED_SINCE;

            if ( lastModifiedDate <= date ) {
                return this.#dropBody( 304 );
            }
        }

        IF_UNMODIFIED_SINCE: {
            const lastModifiedDate = this.lastModifiedDate;
            if ( !lastModifiedDate ) break IF_UNMODIFIED_SINCE;

            const date = headers.ifUnmodifiedSince;
            if ( !date ) break IF_UNMODIFIED_SINCE;

            if ( lastModifiedDate > date ) {
                return this.#dropBody( 412 );
            }
        }
    }

    async checkBodyFunction () {
        if ( !this.hasBody ) return;

        if ( !this.#body.isFunction ) return;

        const httpMessage = this.constructor.new( await this.#body.body() );

        this.#setStatus( httpMessage.status );

        this.#headers.set( httpMessage.headers );

        this.#setBody( httpMessage.body, { "destroy": true } );

        this.checkBody();
    }

    async checkHttpRange ( headers, { createBody, maxRanges } = {} ) {
        if ( !this.hasBody ) return;

        // ranges are not supported
        if ( !this.#headers.acceptRanges ) return;

        // ranges already applied
        if ( this.#status === 206 || this.#status === 416 ) return;

        const httpRange = headers.range;

        // not a ranged request
        if ( !httpRange ) return;

        IF_RANGE: {
            const ifRange = headers.ifRange;
            if ( !ifRange ) break IF_RANGE;

            if ( ifRange.date ) {
                const lastModifiedDate = this.lastModifiedDate;
                if ( !lastModifiedDate ) break IF_RANGE;

                if ( lastModifiedDate > ifRange.date ) {
                    return;
                }
            }
            else if ( ifRange.etag ) {
                if ( ifRange.etag === "*" ) break IF_RANGE;

                const etag = this.#headers.etag;
                if ( !etag ) break IF_RANGE;

                // strong validation, weak etag never match
                if ( etag.startsWith( 'W/"' ) ) return;

                if ( etag !== ifRange.etag ) return;
            }
        }

        const httpMessage = await httpRange.createHttpMessage( this.#body.body, {
            maxRanges,
            createBody,
            "headers": {
                "content-type": this.contentType,
            },
        } );

        this.#setStatus( httpMessage.status );

        this.#headers.add( httpMessage.headers );

        if ( this.ok ) {
            if ( createBody ) {
                this.#setBody( httpMessage.body );
            }
        }
        else {
            this.#deleteBody();
        }
    }

    checkCompression ( headers, { createBody, compress, zlibOptions } = {} ) {
        if ( !this.hasBody ) return;

        compress = this.#compress ?? compress;

        // compression is disabled
        if ( !compress ) return;

        // already compressed
        if ( this.#headers.get( "content-encoding" ) ) return;

        this.#headers.add( "vary", "Accept-Encoding" );

        if ( typeof compress !== "boolean" && this.contentLength < compress ) return;

        const mimeType = mime.get( this.contentType );
        if ( !mimeType?.compressible ) return;

        const acceptEncoding = headers.acceptEncoding;
        if ( !acceptEncoding ) return;

        var encoding;

        for ( encoding of acceptEncoding ) {
            if ( encoding in ENCODINGS_COMPRESSORS ) break;
        }

        if ( !encoding ) {
            if ( acceptEncoding.has( "*" ) ) {
                encoding = DEFAULT_ENCODING;
            }
            else {
                return;
            }
        }

        const compressor = ENCODINGS_COMPRESSORS[ encoding ];

        if ( !compressor ) return;

        this.#headers.set( "content-encoding", encoding );

        // prepare compressed body stream
        if ( createBody ) {
            zlibOptions = this.#zlibOptions ?? zlibOptions;

            // pipe body to zlib compressor
            const body = stream.pipeline( this.#body.stream(), compressor( zlibOptions ), e => {} ).setType( this.contentType );

            this.#setBody( body );
        }
        else {
            this.#headers.delete( "content-length" );
        }
    }

    createBody () {
        return this.#body?.createBody();
    }

    [ Symbol.for( "nodejs.util.inspect.custom" ) ] ( depth, options, inspect ) {
        const spec = {
            "status": `${ this.status } ${ this.statusText }`,
            "hasBody": this.hasBody,
        };

        if ( this.hasBody ) {
            spec.contentLength = this.contentLength;

            if ( this.contentType ) {
                spec.contentType = this.contentType;
            }
        }

        return `${ this.constructor.name }: ${ inspect( spec ) }`;
    }

    // private
    #setStatus ( status ) {
        if ( !status ) {
            this.#status = 200;
        }
        else if ( typeof status === "number" ) {
            this.#status = result.getHttpStatus( status );
        }
        else {
            throw new Error( "HTTP message status is not valid" );
        }
    }

    #setBody ( body, { destroy } = {} ) {
        body = HttpBody.new( body, {
            "contentType": this.contentType,
        } );

        if ( body.hasBody ) {
            if ( destroy ) {
                this.#deleteBody();
            }

            this.#body = body;

            this.#headers.set( "content-length", this.#body.contentLength );
            this.#headers.set( "content-type", this.#body.contentType );
        }
        else {
            this.#deleteBody();
        }
    }

    #dropBody ( status ) {
        this.#setStatus( status );

        this.#deleteBody();
    }

    #deleteBody () {
        this.#body?.destroy();

        this.#body = null;

        this.#headers.delete( "content-length" );
        this.#headers.delete( "content-type" );
    }
}
