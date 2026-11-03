import { isPlainObject } from "#lib/utils";

const END_OF_FIELD = new Set( [ ",", "\n", "\r" ] ),
    END_OF_LINE = new Set( [ "\n", "\r" ] ),
    DEFAULT_EOL = "\n";

export default class Csv {
    #header;
    #headerRow;
    #eol;

    #buffer = "";
    #pos = 0;
    #line = 1;
    #firstRow = true;
    #rowLength;
    #row = [];
    #rowStarted;
    #fieldStarted;
    #lineBreakPossible;

    constructor ( { header, headerRow = true, eol } = {} ) {
        this.#header = header;
        this.#headerRow = headerRow;
        this.#eol = eol || DEFAULT_EOL;
    }

    // static
    static stringify ( rows, { header, headerRow, eol } = {} ) {
        const csv = new this( { header, headerRow, eol } );

        const data = csv.stringify( rows );

        return data;
    }

    static parse ( buffer, { header, headerRow, eol, encoding } = {} ) {
        const csv = new this( { header, headerRow, eol } );

        const data = csv.parse( buffer, { encoding } );

        return data.concat( csv.end() );
    }

    // properties
    get isEnded () {
        return !this.#rowStarted;
    }

    // public
    stringify ( rows ) {
        const data = [];

        if ( !Array.isArray( rows ) ) rows = [ rows ];

        for ( let row of rows ) {
            if ( !row ) continue;

            const rowIsObject = isPlainObject( row );

            if ( this.#firstRow ) {
                this.#firstRow = false;

                const header = rowIsObject
                    ? Object.keys( row )
                    : null;

                this.#rowLength = rowIsObject
                    ? header.length
                    : row.length;

                if ( typeof this.#header === "function" ) {
                    this.#header = this.#header( header );
                }
                else {
                    this.#header ??= header;
                }

                // write header row
                if ( this.#header && this.#headerRow ) {
                    const fields = [];

                    for ( let n = 0; n < this.#header.length; n++ ) {
                        if ( this.#header[ n ] == null ) continue;

                        fields.push( this.#stringifyField( this.#header[ n ] ) );
                    }

                    data.push( fields.join( "," ) + this.#eol );
                }
            }

            const fields = [];

            if ( this.#header ) {
                for ( let n = 0; n < this.#header.length; n++ ) {
                    if ( this.#header[ n ] == null ) continue;

                    // object
                    if ( rowIsObject ) {
                        fields.push( this.#stringifyField( row[ this.#header[ n ] ] ) );
                    }

                    // array
                    else {
                        fields.push( this.#stringifyField( row[ n ] ) );
                    }
                }
            }
            else {
                if ( rowIsObject ) row = Object.values( row );

                for ( let n = 0; n < this.#rowLength; n++ ) {
                    fields.push( this.#stringifyField( row[ n ] ) );
                }
            }

            data.push( fields.join( "," ) + this.#eol );
        }

        return data.join( "" );
    }

    parse ( buffer, { encoding } = {} ) {
        if ( Buffer.isBuffer( buffer ) ) buffer = buffer.toString( encoding );

        if ( this.#buffer ) {
            this.#buffer += buffer;
        }
        else {
            this.#buffer = buffer;
        }

        const rows = [];

        while ( true ) {

            // all data processed
            if ( this.#buffer.length === this.#pos ) break;

            const row = this.#parseRow();

            // row is not complete
            if ( !row ) break;

            // first row
            if ( this.#firstRow ) {
                this.#firstRow = false;
                this.#rowLength = row.length;

                // header row
                if ( this.#headerRow ) {
                    if ( typeof this.#header === "function" ) {
                        this.#header = this.#header( row );
                    }
                    else {
                        this.#header ??= row;
                    }

                    continue;
                }
                else if ( typeof this.#header === "function" ) {
                    this.#header = this.#header();
                }
            }

            // object
            if ( this.#header ) {
                const data = {};

                for ( let n = 0; n < this.#header.length; n++ ) {
                    if ( this.#header[ n ] == null ) continue;

                    data[ this.#header[ n ] ] = row[ n ];
                }

                rows.push( data );
            }

            // array
            else {
                if ( row.length !== this.#rowLength ) {
                    row.length = this.#rowLength;
                }

                rows.push( row );
            }
        }

        // truncate buffer
        if ( this.#buffer.length === this.#pos ) {
            this.#buffer = "";
        }
        else {
            this.#buffer = this.#buffer.slice( this.#pos );
        }

        this.#pos = 0;

        return rows;
    }

    // finish parsing, returns the last row if the data does not end with a line break
    end () {
        const rows = this.#rowStarted
            ? this.parse( "\n" )
            : [];

        if ( !this.isEnded ) throw new Error( "CSV unexpected end of file" );

        return rows;
    }

    // private
    #stringifyField ( field ) {
        if ( field == null ) {
            return "";
        }

        field = String( field );

        if ( /[\n\r",]/v.test( field ) ) {
            field = `"${ field.replaceAll( '"', '""' ) }"`;
        }

        return field;
    }

    #parseRow () {
        this.#rowStarted = true;

        if ( this.#lineBreakPossible ) {
            this.#lineBreakPossible = false;

            // prev. line ended
            if ( this.#buffer[ this.#pos ] === "\n" ) {
                this.#pos++;

                // end of buffer
                if ( this.#buffer.length === this.#pos ) {
                    this.#rowStarted = false;

                    return;
                }
            }
        }

        while ( true ) {
            const field = this.#parseField();

            // field is not complete
            if ( field == null ) return;

            this.#row.push( field );

            const char = this.#buffer[ this.#pos ];

            // end of row
            if ( END_OF_LINE.has( char ) ) {
                this.#rowStarted = false;
                this.#line++;

                this.#pos++;

                // \r\n
                if ( char === "\r" ) {
                    if ( this.#buffer[ this.#pos ] == null ) {
                        this.#lineBreakPossible = true;
                    }
                    else if ( this.#buffer[ this.#pos ] === "\n" ) {
                        this.#pos++;
                    }
                }

                const row = this.#row;
                this.#row = [];

                return row;
            }

            // end of field
            else if ( char === "," ) {
                this.#pos++;
            }
        }
    }

    #parseField () {
        this.#fieldStarted = true;

        let start = this.#pos,
            quoted,
            hasDoubleQuotes,
            pos;

        // field is quoted
        if ( this.#buffer[ start ] === '"' ) {
            quoted = true;
            start++;
        }

        for ( pos = start; pos < this.#buffer.length; pos++ ) {
            const char = this.#buffer[ pos ];

            if ( char === '"' ) {
                const next = this.#buffer[ pos + 1 ];

                // end of buffer
                if ( next == null ) break;

                // double quote
                if ( next === '"' ) {
                    pos++;
                    hasDoubleQuotes = true;
                }

                // close quote
                else if ( quoted ) {

                    // end of field
                    if ( END_OF_FIELD.has( next ) ) {
                        pos++;
                        this.#fieldStarted = false;
                        break;
                    }
                    else {
                        throw new Error( `CSV invalid quote at line: ${ this.#line }` );
                    }
                }
                else {
                    throw new Error( `CSV invalid quote at line: ${ this.#line }` );
                }
            }
            else if ( END_OF_FIELD.has( char ) ) {
                if ( !quoted ) {
                    this.#fieldStarted = false;
                    break;
                }
            }
        }

        // field completely parsed
        if ( !this.#fieldStarted ) {
            let field;

            if ( quoted ) {
                field = this.#buffer.slice( start, pos - 1 );
            }
            else {
                field = this.#buffer.slice( start, pos );
            }

            this.#pos = pos;

            // convert double quotes
            if ( hasDoubleQuotes ) field = field.replaceAll( '""', '"' );

            return field;
        }
    }
}
