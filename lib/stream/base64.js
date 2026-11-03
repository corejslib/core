import stream from "#lib/stream";

const DEFAULT_LINE_LENGTH = 76,
    BASE64_RE = /^[A-Za-z0-9+\/]*={0,2}$/v,
    BASE64URL_RE = /^[\w\-]*={0,2}$/v;

export class Base64StreamEncoder extends stream.Transform {
    #base64url;
    #lineLength;
    #eol;
    #buffer;
    #line = "";

    constructor ( { base64url, wrap, lineLength, eol } = {} ) {
        super();

        this.#base64url = Boolean( base64url );

        this.#lineLength = wrap
            ? lineLength || DEFAULT_LINE_LENGTH
            : null;

        this.#eol = eol || "\n";
    }

    // protected
    _transform ( chunk, encoding, callback ) {
        if ( this.#buffer?.length ) {
            chunk = Buffer.concat( [ this.#buffer, chunk ] );

            this.#buffer = null;
        }

        // min. 3 bytes are required
        if ( chunk.length < 3 ) {
            this.#buffer = chunk;

            return callback();
        }

        // 3 bytes are represented by 4 characters, so we can only encode in groups of 3 bytes
        const remaining = chunk.length % 3;

        if ( remaining ) {
            this.#buffer = chunk.subarray( chunk.length - remaining );

            chunk = chunk.subarray( 0, chunk.length - remaining );
        }

        try {
            const data = this.#wrap( this.#encode( chunk ) );

            if ( data ) this.push( data, "ascii" );

            callback();
        }
        catch ( e ) {
            callback( e );
        }
    }

    _flush ( callback ) {
        let data;

        if ( this.#buffer?.length ) {
            try {
                data = this.#wrap( this.#encode( this.#buffer ), true );
            }
            catch ( e ) {
                return callback( e );
            }
        }
        else {
            data = this.#wrap( null, true );
        }

        if ( data ) this.push( data, "ascii" );

        callback();
    }

    // private
    #encode ( buffer ) {
        return buffer.toString( this.#base64url
            ? "base64url"
            : "base64" );
    }

    #wrap ( data, flush ) {
        if ( !this.#lineLength ) {
            return data;
        }

        data = this.#line + ( data || "" );
        this.#line = "";

        if ( !data ) {
            return;
        }
        else if ( data.length < this.#lineLength ) {
            if ( flush ) {
                return data + this.#eol;
            }
            else {
                this.#line = data;
            }
        }
        else if ( data.length === this.#lineLength ) {
            return data + this.#eol;
        }
        else {
            const lines = [];

            for ( let pos = 0; pos < data.length; pos += this.#lineLength ) {
                const line = data.slice( pos, pos + this.#lineLength );

                // store last incomplete line
                if ( !flush && line.length !== this.#lineLength ) {
                    this.#line = line;
                }
                else {
                    lines.push( line );
                }
            }

            return lines.join( this.#eol ) + this.#eol;
        }
    }
}

export class Base64StreamDecoder extends stream.Transform {
    #base64url;
    #buffer;
    #ended;

    constructor ( { base64url } = {} ) {
        super();

        this.#base64url = Boolean( base64url );
    }

    // protected
    _transform ( chunk, encoding, callback ) {
        chunk = chunk.toString( "latin1" ).replaceAll( /\s/gv, "" );

        if ( this.#buffer ) {
            chunk = this.#buffer + chunk;

            this.#buffer = null;
        }

        // min. 4 chars are required
        if ( chunk.length < 4 ) {
            this.#buffer = chunk;

            return callback();
        }

        // 4 characters represent 3 bytes, so we can only decode in groups of 4 chars
        const remaining = chunk.length % 4;

        if ( remaining ) {
            this.#buffer = chunk.slice( -remaining );

            chunk = chunk.slice( 0, -remaining );
        }

        try {
            callback( null, this.#decode( chunk ) );
        }
        catch ( e ) {
            callback( e );
        }
    }

    _flush ( callback ) {
        if ( this.#buffer ) {
            let data;

            try {
                data = this.#decode( this.#buffer );
            }
            catch ( e ) {
                return callback( e );
            }

            this.#buffer = null;

            callback( null, data );
        }
        else {
            callback();
        }
    }

    // private
    #decode ( string ) {
        let endSegment,
            expectedLength = 0;

        ERROR: {

            // no data is allowed after the padding
            if ( this.#ended ) break ERROR;

            // only characters of the selected alphabet and optional trailing padding are allowed
            const regex = this.#base64url
                ? BASE64URL_RE
                : BASE64_RE;

            if ( !regex.test( string ) ) break ERROR;

            if ( string.length <= 4 ) {
                endSegment = string;
            }
            else {
                const remaining = string.length % 4 || 4;

                endSegment = string.slice( -remaining );

                expectedLength = ( ( string.length - remaining ) / 4 ) * 3;
            }

            if ( endSegment.indexOf( "=" ) > -1 ) {

                // padded data must be a multiple of 4 chars
                if ( string.length % 4 ) break ERROR;

                this.#ended = true;

                endSegment = endSegment.replace( /=+$/v, "" );
            }

            if ( endSegment.length < 2 ) {
                break ERROR;
            }
            else {
                expectedLength += endSegment.length - 1;
            }

            const buffer = Buffer.from( string, this.#base64url
                ? "base64url"
                : "base64" );

            if ( buffer.length !== expectedLength ) {
                break ERROR;
            }

            return buffer;
        }

        throw new Error( "Base64 stream data is not valid" );
    }
}
