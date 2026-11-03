import { StringDecoder } from "node:string_decoder";
import Csv from "#lib/csv";
import stream from "#lib/stream";

export class CsvStreamEncoder extends stream.Transform {
    #csv;

    constructor ( { header, headerRow, eol } = {} ) {
        super( { "writableObjectMode": true } );

        this.#csv = new Csv( { header, headerRow, eol } );
    }

    // protected
    _transform ( chunk, encoding, callback ) {
        try {

            // one chunk is one row
            const data = this.#csv.stringify( [ chunk ] );

            if ( data ) this.push( data );

            callback();
        }
        catch ( e ) {
            callback( e );
        }
    }
}

export class CsvStreamDecoder extends stream.Transform {
    #csv;
    #decoder;

    constructor ( { header, headerRow, encoding } = {} ) {
        super( { "readableObjectMode": true } );

        this.#csv = new Csv( { header, headerRow } );
        this.#decoder = new StringDecoder( encoding || "utf8" );
    }

    // protected
    _transform ( chunk, encoding, callback ) {
        try {
            this.#pushRows( this.#csv.parse( this.#decoder.write( chunk ) ) );

            callback();
        }
        catch ( e ) {
            callback( e );
        }
    }

    _flush ( callback ) {
        try {
            const tail = this.#decoder.end();

            if ( tail ) this.#pushRows( this.#csv.parse( tail ) );

            this.#pushRows( this.#csv.end() );

            callback();
        }
        catch ( e ) {
            callback( e );
        }
    }

    // private
    #pushRows ( rows ) {
        for ( const row of rows ) {
            this.push( row );
        }
    }
}
