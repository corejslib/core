import stream from "#lib/stream";

const DEFAULT_LINE_LENGTH = 76;

export class HexStreamEncoder extends stream.Transform {
    #lineLength;
    #eol;
    #line = "";

    constructor ( { wrap, lineLength, eol } = {} ) {
        super();

        this.#lineLength = wrap
            ? lineLength || DEFAULT_LINE_LENGTH
            : null;

        this.#eol = eol || "\n";
    }

    // protected
    _transform ( chunk, encoding, callback ) {
        const data = this.#wrap( chunk.toHex() );

        if ( data ) this.push( data, "ascii" );

        callback();
    }

    _flush ( callback ) {
        const data = this.#wrap( null, true );

        if ( data ) this.push( data, "ascii" );

        callback();
    }

    // private
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

export class HexStreamDecoder extends stream.Transform {
    #buffer;

    // protected
    _transform ( chunk, encoding, callback ) {
        chunk = chunk.toString( "latin1" ).replaceAll( /[\n\r]/gv, "" );

        if ( this.#buffer ) {
            chunk = this.#buffer + chunk;

            this.#buffer = null;
        }

        // min. 2 chars are required
        if ( chunk.length < 2 ) {
            this.#buffer = chunk;

            return callback();
        }

        const remaining = chunk.length % 2;

        if ( remaining ) {
            this.#buffer = chunk.at( -1 );

            chunk = chunk.slice( 0, -1 );
        }

        const buffer = Buffer.fromHex( chunk );

        if ( buffer.length !== chunk.length / 2 ) {
            callback( new Error( "Hex stream data is not valid" ) );
        }
        else {
            callback( null, buffer );
        }
    }

    _flush ( callback ) {
        if ( this.#buffer ) {
            callback( new Error( "Hex stream is not complete" ) );
        }
        else {
            callback();
        }
    }
}
