import DataUrl from "#lib/data-url";
import Range from "#lib/range";
import stream from "#lib/stream";

const DEFAULT_MIME_TYPE = "application/octet-stream";

export default class Blob extends globalThis.Blob {
    constructor ( sources, { type, endings } = {} ) {

        // string
        if ( typeof sources === "string" ) {
            sources = new URL( sources );
        }

        // url
        if ( sources instanceof URL ) {

            // data url
            if ( sources.protocol === "data:" ) {
                type = sources.type;

                sources = [ sources.data ];
            }
        }

        type ||= "";

        super( sources, { type, endings } );
    }

    // static
    static new ( sources, options ) {
        if ( sources instanceof this ) return sources;

        return new this.constrictor( sources, options );
    }

    static get defaultType () {
        return DEFAULT_MIME_TYPE;
    }

    // properties
    get defaultType () {
        return DEFAULT_MIME_TYPE;
    }

    // public
    slice ( start, end, type ) {
        return this.#slice( start, end, type );
    }

    stream ( { range, type } = {} ) {
        range = Range.new( range ).createRange( {
            "contentLength": this.size,
        } );

        if ( range.isFullRange ) {
            return stream.Readable.fromWeb( super.stream() )
                .setType( type === undefined
                    ? this.type
                    : type )
                .setSize( this.size );
        }
        else {
            return this.#slice( range )
                .stream()
                .setType( type === undefined
                    ? this.type
                    : type );
        }
    }

    async buffer () {
        return Buffer.from( await super.arrayBuffer() );
    }

    async dataUrl ( { encoding = "base64" } = {} ) {
        const url = new DataUrl();

        url.type = this.type;

        url.encoding = encoding;

        url.data = await this.buffer();

        return url.href;
    }

    [ Symbol.for( "nodejs.util.inspect.custom" ) ] ( depth, options, inspect ) {
        const spec = {
            "size": this.size,
        };

        if ( this.type ) spec.type = this.type;

        return `${ this.constructor.name }: ${ inspect( spec ) }`;
    }

    // private
    #slice ( start, end, type ) {
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

        const blob = super.slice( range.start, range.end );

        return new Blob( [ blob ], {
            type,
        } );
    }
}
