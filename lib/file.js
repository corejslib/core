import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Blob from "#lib/blob";
import DataUrl from "#lib/data-url";
import { sliceFileSync } from "#lib/fs";
import mime from "#lib/mime";
import Range from "#lib/range";
import stream from "#lib/stream";

export default class File extends Blob {
    #path;
    #name;
    #extname;
    #dirname;
    #hasSources;
    #stat;
    #lastModifiedDate;
    #creationDate;

    constructor ( filePath ) {
        var type, endings, lastModified, sources;

        // string
        if ( typeof filePath === "string" ) {

            // file url
            if ( filePath.startsWith( "file:" ) ) {
                filePath = fileURLToPath( filePath );
            }

            // data url
            else if ( filePath.startsWith( "data:" ) ) {
                filePath = new URL( filePath );
            }
        }

        // object
        if ( typeof filePath === "object" ) {

            // url
            if ( filePath instanceof URL ) {

                // data url
                if ( filePath.protocol === "data:" ) {
                    const dataUrl = new DataUrl( filePath );

                    type = dataUrl.type;
                    sources = dataUrl.data;
                    filePath = dataUrl.searchParams.get( "filename" );
                }

                // file url
                else if ( filePath.protocol === "file:" ) {
                    filePath = fileURLToPath( filePath );
                }

                // invalid url protocol
                else {
                    throw new Error( "Only data: and file: urls are supported" );
                }
            }

            // other object
            else {
                ( { "path": filePath, type, endings, lastModified, sources } = filePath );
            }
        }

        const name = path.basename( filePath );

        // detect type
        if ( type == null ) {
            type =
                mime.findSync( {
                    "filename": name,
                } )?.essence ?? "";
        }

        if ( sources != null && !Array.isArray( sources ) ) sources = [ sources ];

        super( sources, { type, endings } );

        this.#hasSources = !!sources;

        this.#path = filePath;
        this.#name = name;

        if ( lastModified != null ) {
            this.#lastModifiedDate = Temporal.Instant.from( lastModified );
        }
        else if ( this.#hasSources ) {
            this.#lastModifiedDate = Temporal.Now.instant();
        }
        else {
            this.#creationDate = Temporal.Now.instant();
        }
    }

    // static
    static new ( filePath ) {
        if ( filePath instanceof this ) {
            return filePath;
        }
        else {
            return new this( filePath );
        }
    }

    // properties
    get isRealFile () {
        return !this.#hasSources;
    }

    get path () {
        return this.#path;
    }

    get name () {
        return this.#name;
    }

    get extname () {
        this.#extname ??= path.extname( this.#name );

        return this.#extname;
    }

    get dirname () {
        this.#dirname ??= path.dirname( this.#path );

        return this.#dirname;
    }

    get size () {
        if ( this.#hasSources ) {
            return super.size;
        }
        else {
            if ( this.#stat === undefined ) this.#getStatSync();

            return this.#stat?.size;
        }
    }

    get lastModified () {
        if ( this.#lastModifiedDate == null ) {
            if ( this.#stat === undefined ) this.#getStatSync();

            if ( this.#stat ) {
                this.#lastModifiedDate = Temporal.Instant.fromEpochNanoseconds( this.#stat.mtimeNs );
            }
            else {
                this.#lastModifiedDate = this.#creationDate;
            }
        }

        return this.#lastModifiedDate;
    }

    // public
    async getSize () {
        if ( this.#hasSources ) {
            return super.size;
        }
        else {
            if ( this.#stat === undefined ) await this.#getStat();

            return this.#stat?.size;
        }
    }

    async getLastModified () {
        if ( this.#lastModifiedDate == null ) {
            if ( this.#stat === undefined ) await this.#getStat();

            if ( this.#stat ) {
                this.#lastModifiedDate = Temporal.Instant.fromEpochNanoseconds( this.#stat.mtimeNs );
            }
            else {
                this.#lastModifiedDate = this.#creationDate;
            }
        }

        return this.#lastModifiedDate;
    }

    slice ( start, end, type ) {
        if ( this.#hasSources ) {
            return super.slice( start, end, type );
        }
        else {
            let range;

            if ( typeof start === "object" ) {
                type = end;

                range = Range.new( start ).createRange( {
                    "contentLength": this.size,
                } );
            }
            else {
                range = new Range( {
                    start,
                    end,
                } );
            }

            const buffer = sliceFileSync( this.#path, { range } );

            return new Blob( [ buffer ], {
                type,
            } );
        }
    }

    stream ( { range } = {} ) {
        var readableStream;

        if ( this.#hasSources ) {
            readableStream = super.stream( { range } );
        }
        else if ( range ) {
            range = Range.new( range ).createRange( {
                "contentLength": this.size,
            } );

            if ( range.length === 0 ) {
                const stat = fs.statSync( this.#path );
                if ( !stat.isFile() ) throw new Error( "Path is not a file" );

                readableStream = stream.Readable.from( "", { "objectMode": false } );
            }
            else {
                readableStream = fs.createReadStream( this.#path, {
                    "start": range.start,
                    "end": range.inclusiveEnd,
                } );
            }
        }
        else {
            readableStream = fs.createReadStream( this.#path );
        }

        return readableStream;
    }

    async arrayBuffer () {
        if ( this.#hasSources ) {
            return super.arrayBuffer();
        }
        else {
            return new Uint8Array( await this.#getBuffer() ).buffer;
        }
    }

    async buffer () {
        if ( this.#hasSources ) {
            return super.buffer();
        }
        else {
            return this.#getBuffer();
        }
    }

    async bytes () {
        if ( this.#hasSources ) {
            return super.bytes();
        }
        else {
            const buffer = await this.#getBuffer();

            return new Uint8Array( buffer.buffer, buffer.byteOffset, buffer.byteLength );
        }
    }

    async json () {
        if ( this.#hasSources ) {
            return super.json();
        }
        else {
            const buffer = await this.#getBuffer();

            return JSON.parse( buffer );
        }
    }

    async text () {
        if ( this.#hasSources ) {
            return super.text();
        }
        else {
            return this.#getBuffer( "utf8" );
        }
    }

    async toDataUrl ( { encoding = "base64", withFilename = true } = {} ) {
        const url = new DataUrl();

        if ( withFilename && this.name ) url.searchParams.set( "filename", this.name );

        url.type = this.type;

        url.encoding = encoding;

        url.data = await this.buffer();

        return url.href;
    }

    clearCache () {
        this.#stat = undefined;

        if ( this.#creationDate ) {
            this.#lastModifiedDate = undefined;
        }

        return this;
    }

    [ Symbol.for( "nodejs.util.inspect.custom" ) ] ( depth, options, inspect ) {
        const spec = {
            "name": this.name,
            "path": this.path,
        };

        if ( this.type ) spec.type = this.type;

        return `${ this.constructor.name }: ${ inspect( spec ) }`;
    }

    // private
    async #getStat () {
        if ( this.#stat === undefined && this.#path ) {
            try {
                this.#stat = await fs.promises.stat( this.#path, {
                    "bigint": true,
                } );
            }
            catch ( e ) {

                // file not found
                if ( e.code === "ENOENT" ) {
                    this.#stat = null;
                }
                else {
                    throw e;
                }
            }
        }
    }

    #getStatSync () {
        if ( this.#stat === undefined && this.#path ) {
            try {
                this.#stat = fs.statSync( this.#path, {
                    "bigint": true,
                } );
            }
            catch ( e ) {

                // file not found
                if ( e.code === "ENOENT" ) {
                    this.#stat = null;
                }
                else {
                    throw e;
                }
            }
        }
    }

    async #getBuffer ( encoding ) {
        return fs.promises.readFile( this.#path, encoding );
    }
}
