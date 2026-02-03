import "#lib/result";
import Headers from "#lib/http/headers";
import stream from "#lib/stream";

var FormData;

export default class Response extends result.Result {
    #response;
    #headers;
    #body;

    constructor ( response ) {
        super( [ response.status, response.statusText ] );

        this.#response = response;
    }

    // properties
    get url () {
        return this.#response.url;
    }

    get headers () {
        this.#headers ??= new Headers( this.#response.headers );

        return this.#headers;
    }

    get hasBody () {
        return !!this.#response.body;
    }

    get bodyUsed () {
        return this.#response.bodyUsed;
    }

    get body () {
        if ( !this.#body ) {
            if ( this.#response.body ) {
                this.#body = stream.Readable.fromWeb( this.#response.body );
            }
            else {
                this.#body = stream.Readable.from( "" );
            }

            this.#body.setType( this.headers.get( "content-type" ) );
            this.#body.setSize( this.headers.contentLength );
        }

        return this.#body;
    }

    get redirected () {
        return this.#response.redirected;
    }

    get type () {
        return this.#response.type;
    }

    get cookies () {
        return this.#response.cookies;
    }

    // public
    async arrayBuffer ( { maxLength } = {} ) {
        return this.body.arrayBuffer( { maxLength } );
    }

    async blob ( { maxLength, type } = {} ) {
        return this.body.blob( {
            maxLength,
            "type": type || this.headers.get( "content-type" ),
        } );
    }

    async buffer ( { maxLength } = {} ) {
        return this.body.buffer( { maxLength } );
    }

    async json ( { maxLength } = {} ) {
        return this.body.json( { maxLength } );
    }

    async tmpFile ( options = {} ) {
        options = { ...options };

        if ( options.type === undefined && this.headers.has( "content-type" ) ) {
            options.type = this.headers.get( "content-type" );
        }

        if ( options.lastModified === undefined && this.headers.lastModified ) {
            options.lastModified = this.headers.lastModified;
        }

        return this.body.tmpFile( options );
    }

    async text ( { maxLength, encoding } = {} ) {
        return this.body.text( { maxLength, encoding } );
    }

    async formData ( { maxBufferLength, maxFileSize } = {} ) {
        if ( !FormData ) {
            ( { "defailt": FormData } = await import( "#lib/form-data" ) );
        }

        return FormData.parse( this.body, {
            "boundary": this.headers.contentType?.boundary,
            maxBufferLength,
            maxFileSize,
        } );
    }
}
