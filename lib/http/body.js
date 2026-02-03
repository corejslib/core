import Blob from "#lib/blob";
import File from "#lib/file";
import Range from "#lib/range";
import stream from "#lib/stream";
import { MultipartStreamEncoder } from "#lib/stream/multipart";

export default class HttpBody {
    #body;
    #contentLength;
    #contentType;
    #isFunction = false;
    #isFile = false;
    #isStream = false;
    #isFileExists;
    #isDestroyed = false;

    constructor ( body, { encoding, contentType } = {} ) {
        this.#contentType = contentType;

        if ( body == null ) {
            this.#contentLength = 0;
        }
        else if ( body instanceof this.constructor ) {
            this.#body = body.body;
            this.#contentLength = body.contentLength;
            this.#contentType ||= body.contentType;
        }
        else {
            if ( typeof body === "string" ) {
                body = Buffer.from( body, encoding );

                this.#contentType ||= "text/plain; charset=UTF-8";
            }
            else if ( typeof body === "number" ) {
                body = Buffer.from( body.toString() );
            }

            // url search params
            else if ( body instanceof URLSearchParams ) {
                body = Buffer.from( body.toString() );

                this.#contentType ||= "application/x-www-form-urlencoded; charset=UTF-8";
            }

            if ( Buffer.isBuffer( body ) ) {
                this.#contentLength = body.length;
            }
            else if ( body instanceof stream.Readable ) {
                this.#contentLength = body.size;
                this.#isStream = true;
                this.#isDestroyed = body.destroyed;

                if ( body instanceof MultipartStreamEncoder ) {
                    this.#contentType ||= body.type;
                }
                else {
                    this.#contentType ||= body.type;
                }
            }
            else if ( body instanceof File ) {
                this.#contentLength = body.size;
                this.#contentType ||= body.type;
                this.#isFile = true;
                this.#isFileExists = this.#contentLength != null;
            }
            else if ( body instanceof Blob ) {
                this.#contentLength = body.size;
                this.#contentType ||= body.type;
            }
            else if ( body instanceof globalThis.Blob ) {
                this.#contentLength = body.size;
                this.#contentType ||= body.type;
            }
            else if ( typeof body === "function" ) {
                this.#isFunction = true;
            }
            else {
                throw new Error( "Body type is not supported" );
            }

            this.#body = body;
        }
    }

    // static
    static new ( body, options ) {
        if ( body instanceof this ) {
            return body;
        }
        else {
            return new this( body, options );
        }
    }

    // properties
    get body () {
        return this.#body;
    }

    get contentLength () {
        return this.#contentLength;
    }

    get contentType () {
        return this.#contentType;
    }

    get hasBody () {
        return this.#body != null;
    }

    get isFunction () {
        return this.#isFunction;
    }

    get isFile () {
        return this.#isFile;
    }

    get isStream () {
        return this.#isStream;
    }

    get isFileExists () {
        return this.#isFileExists;
    }

    get isDestroyed () {
        return this.#isDestroyed;
    }

    // public
    createBody ( { range } = {} ) {
        if ( this.isFunction ) {
            throw new Error( "HTTP body is function" );
        }
        else if ( this.#isFile ) {
            return this.#body.stream( { range, "type": this.#contentType } );
        }
        else if ( this.#body instanceof Blob ) {
            return this.#body.stream( { range, "type": this.#contentType } );
        }
        else if ( this.#body instanceof globalThis.Blob ) {
            range = Range.new( range ).createRange( {
                "contentLength": this.#body.size,
            } );

            if ( range.isFullRange ) {
                return stream.Readable.fromWeb( this.#body.stream() ).setType( this.#contentType ).setSize( this.#body.size );
            }
            else {
                return stream.Readable.fromWeb( this.#body.slice( range.start, range.end ).stream() ).setType( this.#contentType ).setSize( range.length );
            }
        }
        else {
            range = Range.new( range ).createRange( {
                "contentLength": this.#body.size,
            } );

            if ( range.isFullRange ) {
                return this.#body;
            }
            else {
                return this.#body.subarray( range.start, range.end );
            }
        }
    }

    stream ( { range } = {} ) {
        var body = this.createBody( { range } );

        if ( Buffer.isBuffer( body ) ) {
            body = stream.Readable.from( body ).setSize( body.length ).setType( this.#contentType );
        }

        return body;
    }

    destroy () {
        if ( !this.#isDestroyed ) {
            this.#isDestroyed = true;

            if ( this.#isStream ) {
                this.#body.destroy();
            }
        }

        return this;
    }

    [ Symbol.for( "nodejs.util.inspect.custom" ) ] ( depth, options, inspect ) {
        const spec = {
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
}
