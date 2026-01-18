import MimeTypeExtnames from "./type/extnames.js";
import MimeTypeFilenames from "./type/filenames.js";
import MimeTypeShebangs from "./type/shebangs.js";

export default class MimeType {
    #mime;
    #essence;
    #type;
    #subtype;
    #compressible;
    #charset;
    #shebangs;
    #filenames;
    #extnames;

    constructor ( mime, essence, { compressible, charset } = {} ) {
        this.#mime = mime;
        this.#essence = essence;
        this.setCompressible( compressible );
        this.setCharset( charset );

        [ this.#type, this.#subtype ] = this.#essence.split( "/", 2 );

        this.#shebangs = new MimeTypeShebangs( this );
        this.#filenames = new MimeTypeFilenames( this );
        this.#extnames = new MimeTypeExtnames( this );
    }

    // static
    static new ( essence ) {
        if ( essence instanceof this ) {
            return essence;
        }

        return new this( null, essence );
    }

    static get comparator () {
        return ( essence1, essence2 ) => this.new( essence1 ).compare( essence2 );
    }

    // properties
    get mime () {
        return this.#mime;
    }

    get essence () {
        return this.#essence;
    }

    get type () {
        return this.#type;
    }

    get subtype () {
        return this.#subtype;
    }

    get compressible () {
        return this.#compressible;
    }

    get charset () {
        return this.#charset;
    }

    get shebangs () {
        return this.#shebangs;
    }

    get filenames () {
        return this.#filenames;
    }

    get extnames () {
        return this.#extnames;
    }

    // public
    toString () {
        return this.#essence;
    }

    toJSON () {
        return {
            "essence": this.#essence,
            "compressible": this.#compressible || undefined,
            "charset": this.#charset || undefined,
            "shebangs": this.#shebangs.toJSON(),
            "filenames": this.#filenames.toJSON(),
            "extnames": this.#extnames.toJSON(),
        };
    }

    setCompressible ( value ) {
        this.#compressible = Boolean( value );

        return this;
    }

    setCharset ( charset ) {
        this.#charset = charset || null;

        return this;
    }

    delete () {
        this.#mime?.delete( this.#essence );

        this.#mime = null;

        return this;
    }

    compare ( essence ) {
        essence = this.constructor.new( essence );

        return this.type - essence.type || this.subtype - essence.subtype;
    }

    [ Symbol.for( "nodejs.util.inspect.custom" ) ] ( depth, options, inspect ) {
        const spec = {
            "essence": this.essence,
        };

        if ( this.extnames.size ) spec.extensions = [ ...this.extnames ].sort();
        if ( this.filenames.size ) spec.filenames = [ ...this.filenames ].sort();
        if ( this.shebangs.size ) spec.shebangs = [ ...this.shebangs ].sort();

        return "MimeType: " + inspect( spec );
    }
}
