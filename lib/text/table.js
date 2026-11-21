import stream from "node:stream";
import ansi from "#lib/ansi";
import Events from "#lib/events";
import wrap, { getStringWidth } from "#lib/text/wrap";

const DEFAULT_WIDTH = 80,
    DEFAULT_STYLE = "ascii",
    DEFAULT_TRIM = false,
    DEFAULT_WORD_WRAP = true,
    DEFAULT_MIN_WIDTH = 10,
    STYLE_LINES = [ "topLine", "headerRow", "headerLine", "dataRow", "dataLine", "bottomLine" ],

    // OSC 8 hyperlink sequences (opening and closing)
    LINK_REGEXP = /\u{1B}\]8;[^;]*;.*?(?:\u{7}|\u{1B}\\)/gsv;

const STYLES = {
    "ascii": {
        "topLine": "+-++",
        "headerRow": "| ||",
        "headerLine": "|=+|",
        "dataRow": "| ||",
        "dataLine": "|-+|",
        "bottomLine": "+-++",
    },
    "unicode": {
        "topLine": "┌─┬┐",
        "headerRow": "│ ││",
        "headerLine": "╞═╪╡",
        "dataRow": "│ ││",
        "dataLine": "├─┼┤",
        "bottomLine": "└─┴┘",
    },
    "borderless": {
        "topLine": null,
        "headerRow": null,
        "headerLine": null,
        "dataRow": null,
        "dataLine": null,
        "bottomLine": null,
    },
    "compact": {
        "topLine": null,
        "headerRow": "  | ",
        "headerLine": " =+ ",
        "dataRow": "  | ",
        "dataLine": null,
        "bottomLine": null,
    },
    "markdown": {
        "topLine": null,
        "headerRow": "|-||",
        "headerLine": "|-||",
        "dataRow": "|-||",
        "dataLine": null,
        "bottomLine": null,
    },
};

// private
function stringify ( value ) {
    return value == null
        ? ""
        : String( value );
}

export default class Table extends Events {
    #stream;
    #style;
    #header;
    #width;
    #maxWidth;
    #ansi;
    #columns = [];

    #rows;
    #started;
    #ended;
    #headerRendered;
    #firstRow = true;
    #content = "";

    constructor ( {

        //
        style,
        ansi,
        header,
        width,
        maxWidth,
        "column": {

            //
            trim,
            wordWrap,
            "width": columnWidth,
            minWidth,
            margin,
            headerAlign,
            headerValign,
            align,
            valign,
            format,
        } = {},
        columns,
    } = {} ) {
        super();

        this.#style = STYLES[ style ] ?? STYLES[ DEFAULT_STYLE ];
        this.#header = header ?? true;
        this.#width = width instanceof stream.Writable
            ? width.columns
            : width;
        this.#maxWidth = maxWidth;
        this.#ansi = ansi instanceof stream.Writable
            ? ( ansi.isTTY ?? false )
            : ansi;

        // array of columns to the object, where keys are the columns indexes
        if ( Array.isArray( columns ) ) {
            columns = { ...columns };
        }

        for ( const id in columns ) {
            const column = { ...columns[ id ], id };

            this.#columns.push( column );

            column.width ??= columnWidth;
            column.minWidth ??= minWidth || DEFAULT_MIN_WIDTH;

            column.marginLeft = column.margin?.[ 0 ] ?? margin?.[ 0 ] ?? 0;
            column.marginRight = column.margin?.[ 1 ] ?? margin?.[ 1 ] ?? 0;

            column.trim ??= trim ?? DEFAULT_TRIM;
            column.wordWrap ??= wordWrap ?? DEFAULT_WORD_WRAP;

            column.headerAlign ||= headerAlign;
            column.headerValign ||= headerValign;
            column.align ||= align;
            column.valign ||= valign;

            column.format ??= format;
        }
    }

    // static
    static defineStyle ( name, style ) {
        STYLES[ name ] = style;
    }

    // properties
    get hasContent () {
        return this.#content.length > 0;
    }

    get content () {
        return this.#content;
    }

    // public
    write ( rows ) {
        if ( this.#ended ) return this;

        if ( !Array.isArray( rows ) ) rows = [ rows ];

        this.#addRows( rows );

        return this;
    }

    end () {
        if ( this.#ended ) return this;
        this.#ended = true;

        this.#begin();

        // render last line
        if ( this.hasContent ) {
            this.#renderLine( this.#style.bottomLine );
        }

        this.emit( "end", this );

        return this;
    }

    pipe ( writable ) {
        this.#stream = writable;

        if ( this.#stream ) {
            if ( this.#ended ) {
                if ( this.hasContent ) {
                    this.#stream.write( this.content );
                }
            }
            else {
                this.#begin();
            }
        }

        return this;
    }

    // private
    #getBorderWidth ( index ) {
        return STYLE_LINES.some( name => this.#style[ name ]?.[ index ] )
            ? 1
            : 0;
    }

    // returns display width of the text without ansi codes
    #getWidth ( string ) {
        if ( this.#ansi ) string = string.replaceAll( LINK_REGEXP, "" );

        return getStringWidth( ansi.remove( string ) );
    }

    // returns display width of the widest line of the multiline text
    #getTextWidth ( string ) {
        let width = 0;

        for ( const line of string.split( "\n" ) ) {
            width = Math.max( width, this.#getWidth( line ) );
        }

        return width;
    }

    #begin () {
        if ( this.#started ) return;
        this.#started = true;

        this.#ansi ??= this.#stream?.isTTY ?? false;

        const leftBorderWidth = this.#getBorderWidth( 0 ),
            rightBorderWidth = this.#getBorderWidth( 3 ),
            internalBorderWidth = this.#getBorderWidth( 2 ),
            bordersWidth = leftBorderWidth + rightBorderWidth + internalBorderWidth * Math.max( this.#columns.length - 1, 0 );

        let tableWidth = this.#width;

        // calculate columns content width
        if ( !tableWidth && this.#ended ) {
            tableWidth = this.#maxWidth || this.#stream?.columns || DEFAULT_WIDTH;

            let totalWidth = 0;

            for ( const [ index, column ] of this.#columns.entries() ) {
                column.dataWidth = 0;

                if ( column.width ) {
                    totalWidth += column.width;

                    continue;
                }

                // calculate header width
                if ( this.#header ) {
                    column.dataWidth = this.#getTextWidth( stringify( column.title ) );
                }

                // calculate content width
                if ( this.#rows ) {
                    for ( const row of this.#rows ) {
                        let value = Array.isArray( row )
                            ? row[ index ]
                            : row[ column.id ];

                        if ( column.format ) value = column.format( value, row );

                        column.dataWidth = Math.max( column.dataWidth, this.#getTextWidth( stringify( value ) ) );
                    }
                }

                column.dataWidth += column.marginLeft + column.marginRight;

                totalWidth += column.dataWidth;

                column.flex = column.dataWidth;
            }

            // all columns fit into the table width
            if ( totalWidth <= tableWidth - bordersWidth ) {
                for ( const column of this.#columns ) {
                    if ( column.dataWidth ) {
                        column.width = column.dataWidth;
                    }
                }
            }
        }

        tableWidth ||= this.#stream?.columns || DEFAULT_WIDTH;
        tableWidth -= bordersWidth;

        let totalWidth = 0,
            totalFlex = 0;

        for ( const column of this.#columns ) {
            if ( column.width ) {
                totalWidth += column.width;
            }
            else {
                column.flex ||= 1;

                totalFlex += column.flex;
            }
        }

        let freeWidth = tableWidth - totalWidth;

        // calculate columns width
        for ( const column of this.#columns ) {
            if ( !column.width ) {
                column.width = Math.max( Math.floor( freeWidth * ( column.flex / totalFlex ) ), column.minWidth );

                freeWidth -= column.width;
                totalFlex -= column.flex;
            }

            // at least one char for the content
            column.width = Math.max( column.width, column.marginLeft + column.marginRight + 1 );

            column.contentWidth = column.width - column.marginLeft - column.marginRight;
        }

        // render stored rows
        if ( this.#rows ) {
            this.#addRows( this.#rows );

            this.#rows = null;
        }
    }

    #addRows ( rows ) {
        if ( this.#started ) {
            this.#renderHeader();

            for ( const row of rows ) {
                if ( !this.#firstRow ) {
                    this.#renderLine( this.#style.dataLine );
                }
                else {
                    this.#firstRow = false;
                }

                this.#renderRow( this.#style.dataRow, row, false );
            }
        }
        else {
            this.#rows ??= [];

            this.#rows.push( ...rows );
        }
    }

    #renderHeader () {
        if ( this.#headerRendered ) return;
        this.#headerRendered = true;

        // render top line
        this.#renderLine( this.#style.topLine );

        // render header
        if ( this.#header ) {
            this.#renderRow(
                this.#style.headerRow,
                this.#columns.map( column => column.title ),
                true
            );

            this.#renderLine( this.#style.headerLine );
        }
    }

    #renderLine ( style ) {
        if ( style == null ) return;

        let buf = style[ 0 ] ?? "";

        buf += this.#columns.map( column => ( style[ 1 ] || "" ).repeat( column.width ) ).join( style[ 2 ] || "" );

        buf += style[ 3 ] ?? "";

        this.#addLine( buf );
    }

    #renderRow ( style, row, isHeader ) {
        const cells = [];

        let index = -1,
            height = 0;

        for ( const column of this.#columns ) {
            index++;

            const value = Array.isArray( row )
                ? row[ index ]
                : row[ column.id ];

            const lines = this.#wrapColumn( column, value, isHeader, row );

            if ( lines.length > height ) height = lines.length;

            cells.push( {
                lines,
                column,
                "height": lines.length,
            } );
        }

        // valign cells
        for ( const cell of cells ) {
            if ( cell.height < height ) {
                const valign = isHeader
                    ? cell.column.headerValign || cell.column.valign
                    : cell.column.valign;

                const line = " ".repeat( cell.column.width ),
                    padding = height - cell.height;

                let paddingTop, paddingBottom;

                // center
                if ( valign === "center" ) {
                    paddingTop = Math.floor( padding / 2 );
                    paddingBottom = padding - paddingTop;
                }

                // bottom
                else if ( valign === "end" ) {
                    paddingTop = padding;
                }

                // top
                else {
                    paddingBottom = padding;
                }

                if ( paddingTop ) cell.lines.unshift( ...Array.from( { "length": paddingTop }, () => line ) );

                if ( paddingBottom ) cell.lines.push( ...Array.from( { "length": paddingBottom }, () => line ) );
            }
        }

        for ( let n = 0; n < height; n++ ) {
            let buf = "";

            buf += style?.[ 0 ] ?? "";

            buf += cells.map( cell => cell.lines.shift() ).join( style?.[ 2 ] ?? "" );

            buf += style?.[ 3 ] ?? "";

            this.#addLine( buf );
        }
    }

    #addLine ( line ) {
        if ( line == null ) return;

        line += "\n";

        this.#content += line;

        if ( this.#stream ) this.#stream.write( line );

        this.emit( "data", line );
    }

    #wrapColumn ( column, value, isHeader, row ) {
        if ( column.format && !isHeader ) value = column.format( value, row );

        // stringify value
        value = stringify( value );

        if ( !this.#ansi ) value = ansi.remove( value );

        const maxWidth = column.contentWidth;

        value = wrap( value, maxWidth, {
            "trim": column.trim,
            "wordWrap": column.wordWrap,
        } );

        const lines = [];

        for ( let line of value.split( "\n" ) ) {
            const width = this.#getWidth( line );

            // padding and align
            if ( width < maxWidth ) {
                const align = isHeader
                        ? column.headerAlign || column.align
                        : column.align,
                    padding = maxWidth - width;

                let paddingLeft, paddingRight;

                // align right
                if ( align === "end" ) {
                    paddingLeft = padding;
                }

                // align center
                else if ( align === "center" ) {
                    paddingLeft = Math.floor( padding / 2 );
                    paddingRight = padding - paddingLeft;
                }

                // align left
                else {
                    paddingRight = padding;
                }

                if ( paddingLeft ) line = " ".repeat( paddingLeft ) + line;
                if ( paddingRight ) line = line + " ".repeat( paddingRight );
            }

            // add margin
            if ( column.marginLeft ) line = " ".repeat( column.marginLeft ) + line;
            if ( column.marginRight ) line = line + " ".repeat( column.marginRight );

            lines.push( line );
        }

        return lines;
    }
}
