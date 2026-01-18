import stream from "node:stream";
import DataUrl from "#lib/data-url";
import Range from "#lib/range";

const DEFAULT_MIME_TYPE = "application/octet-stream";

export default class _Blob extends Blob {
    #buffer;

    constructor ( sources, options = {} ) {
        if ( typeof sources === "string" ) sources = new URL( sources );

        if ( sources instanceof URL ) {
            if ( sources.protocol === "data:" ) {
                options.type = sources.type;

                sources = [ sources.data ];
            }
        }

        super( sources, options );
    }

    // static
    static new ( data, options ) {
        if ( data instanceof this ) return data;

        return new this.constrictor( data, options );
    }

    // properties
    get defaultType () {
        return DEFAULT_MIME_TYPE;
    }

    // public
    async buffer () {
        this.#buffer ??= Buffer.from( await this.arrayBuffer() );

        return this.#buffer;
    }

    slice ( start, end, type ) {
        var range;

        if ( typeof start === "object" ) {
            type = end;

            range = Range.new( start );
        }
        else {
            range = new Range( { start, end } );
        }

        range = range.createRange( {
            "contentLength": this.size,
        } );

        return super.slice( range.start, range.end, type );
    }

    stream ( { range } = {} ) {
        range = Range.new( range ).createRange( {
            "contentType": this.size,
        } );

        if ( range.isFullRange ) {
            return stream.Readable.fromWeb( this.stream() ).setType( this.type ).setSize( this.size );
        }
        else {
            return this.slice( range, this.type ).stream();
        }
    }

    async dataUrl ( { encoding = "base64" } = {} ) {
        const url = new DataUrl();

        url.type = this.type;

        url.encoding = encoding;

        url.data = await this.buffer();

        return url.href;
    }
}
