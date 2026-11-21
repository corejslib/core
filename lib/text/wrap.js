const ESC = "\u{1B}",
    CSI_8BIT = "\u{9B}",
    BEL = "\u{7}",
    RESET = ESC + "[0m",
    LINK_END = ESC + "]8;;" + ESC + "\\",
    WORD_BREAKING_CHARS = new Set( [ " ", "\n" ] ),
    SEGMENTER = new Intl.Segmenter( "en", { "granularity": "grapheme" } ),

    // SGR sequence
    STYLE_REGEXP = /^(?:\u{1B}\[|\u{9B})[\u{30}-\u{3F}]*m$/v,
    STYLE_RESET_REGEXP = /^(?:\u{1B}\[|\u{9B})0*m$/v,

    // OSC 8 hyperlink
    LINK_REGEXP = /^\u{1B}\]8;[^;]*;(.*?)(?:\u{7}|\u{1B}\\)$/sv,

    // spaces at the end of the line, followed by the optional style codes
    TRAILING_SPACES_REGEXP = / +((?:(?:\u{1B}\[|\u{9B})[\u{30}-\u{3F}]*m)*)$/v,

    // display width
    ZERO_WIDTH_REGEXP = /^[\p{M}\p{Cf}]+$/v,
    EMOJI_REGEXP = /\p{Emoji_Presentation}|\u{FE0F}/v,
    WIDE_REGEXP = /^[\u{1100}-\u{115F}\u{2E80}-\u{303E}\u{3041}-\u{33FF}\u{3400}-\u{4DBF}\u{4E00}-\u{9FFF}\u{A000}-\u{A4CF}\u{AC00}-\u{D7A3}\u{F900}-\u{FAFF}\u{FE30}-\u{FE6F}\u{FF00}-\u{FF60}\u{FFE0}-\u{FFE6}\u{20000}-\u{3FFFD}]/v;

// private
function getCharWidth ( char ) {

    // fast path
    if ( char.length === 1 && char.codePointAt( 0 ) < 0x300 ) return 1;

    if ( ZERO_WIDTH_REGEXP.test( char ) ) return 0;

    if ( EMOJI_REGEXP.test( char ) || WIDE_REGEXP.test( char ) ) return 2;

    return 1;
}

function isAnsiCode ( item ) {
    return item[ 0 ] === ESC || item[ 0 ] === CSI_8BIT;
}

class Wrap {
    #maxLength;
    #trim;
    #wordWrap;

    #output = "";
    #ansiCodeStarted = false;
    #ansiCode = [];
    #word = [];
    #wordVisibleLength = 0;
    #line = "";
    #linePrefix = "";
    #lineVisibleLength = 0;

    // active styles and hyperlink, as they are at the end of the committed text
    #ansiStyle = "";
    #link = "";

    constructor ( maxLength, { trim, wordWrap } = {} ) {
        this.#maxLength = maxLength;
        this.#trim = trim;
        this.#wordWrap = wordWrap;
    }

    // public
    wrap ( string ) {
        const segments = SEGMENTER.segment( String( string ) );

        for ( const { "segment": char } of segments ) {
            this.#processChar( char );
        }

        this.#endAnsiCode();
        this.#endWord();

        return this.#output;
    }

    // private
    #processChar ( char ) {
        if ( this.#ansiCodeStarted ) {
            this.#continueAnsiCode( char );
        }
        else if ( char === ESC || char === CSI_8BIT ) {
            this.#startAnsiCode( char );
        }
        else {
            this.#addChar( char );
        }
    }

    #startAnsiCode ( char ) {
        this.#ansiCode.push( char );

        this.#ansiCodeStarted = true;
    }

    #continueAnsiCode ( char ) {
        const code = this.#ansiCode;

        code.push( char );

        // OSC: ESC ] ... ( BEL | ESC \ )
        if ( code[ 0 ] === ESC && code[ 1 ] === "]" ) {
            if ( char === BEL || ( char === "\\" && code.length > 3 && code.at( -2 ) === ESC ) ) {
                this.#endAnsiCode( true );
            }

            return;
        }

        // CSI introducer: ESC [
        if ( code.length === 2 && code[ 0 ] === ESC && char === "[" ) return;

        const codePoint = char.codePointAt( 0 ),
            isCsi = code[ 0 ] === CSI_8BIT || code[ 1 ] === "[";

        // intermediate byte
        if ( codePoint >= 0x20 && codePoint <= 0x2F ) return;

        // parameter byte
        if ( isCsi && codePoint >= 0x30 && codePoint <= 0x3F ) return;

        // final byte
        if ( codePoint >= ( isCsi
            ? 0x40
            : 0x30 ) && codePoint <= 0x7E ) {
            this.#endAnsiCode( true );
        }

        // invalid escape sequence, the last char is processed again
        else {
            code.pop();

            this.#endAnsiCode();

            this.#processChar( char );
        }
    }

    #endAnsiCode ( valid ) {
        const code = this.#ansiCode;

        this.#ansiCode = [];
        this.#ansiCodeStarted = false;

        if ( valid ) {
            const sequence = code.join( "" );

            // keep styles and hyperlinks, drop all other sequences
            if ( STYLE_REGEXP.test( sequence ) || LINK_REGEXP.test( sequence ) ) {
                this.#word.push( sequence );
            }
        }
        else {
            for ( const char of code ) this.#addChar( char );
        }
    }

    #addChar ( char ) {

        // CRLF is the single grapheme
        if ( char === "\r\n" ) {
            char = "\n";
        }

        // replace tab with the single space
        else if ( char === "\t" ) {
            char = " ";
        }

        // new word
        if ( WORD_BREAKING_CHARS.has( char ) ) {
            this.#endWord( char );
        }
        else {
            const codePoint = char.codePointAt( 0 );

            // ignore control characters
            if ( codePoint <= 0x1F || ( codePoint >= 0x7F && codePoint <= 0x9F ) ) return;

            this.#word.push( char );
            this.#wordVisibleLength += getCharWidth( char );
        }
    }

    #endWord ( char ) {

        // add whole word
        if ( this.#wordWrap && this.#wordVisibleLength <= this.#maxLength ) {

            // can not add whole word to the current line
            if ( this.#lineVisibleLength > 0 && this.#lineVisibleLength + this.#wordVisibleLength > this.#maxLength ) {
                this.#wrapLine();
            }

            for ( const item of this.#word ) {
                this.#line += item;

                if ( isAnsiCode( item ) ) this.#applyAnsiCode( item );
            }

            this.#lineVisibleLength += this.#wordVisibleLength;
        }

        // add word char-by-char
        else {
            for ( const item of this.#word ) {

                // ansi code
                if ( isAnsiCode( item ) ) {
                    this.#line += item;

                    this.#applyAnsiCode( item );
                }
                else {
                    const width = getCharWidth( item );

                    // can not add char to the current line
                    if ( this.#lineVisibleLength > 0 && this.#lineVisibleLength + width > this.#maxLength ) {
                        this.#wrapLine();
                    }

                    this.#line += item;
                    this.#lineVisibleLength += width;
                }
            }
        }

        this.#word = [];
        this.#wordVisibleLength = 0;

        // EOF / EOL
        if ( !char || char === "\n" ) {
            this.#endLine( char );

            // restore styles on the next line
            if ( char ) this.#startLine();
        }

        // end of the word
        else if ( char === " " ) {
            const eol = this.#lineVisibleLength >= this.#maxLength;

            if ( !eol || !this.#trim ) {

                // need to start new line
                if ( eol ) {
                    this.#wrapLine();
                }

                this.#line += char;
                this.#lineVisibleLength += 1;
            }
        }
    }

    #applyAnsiCode ( sequence ) {

        // reset all styles
        if ( STYLE_RESET_REGEXP.test( sequence ) ) {
            this.#ansiStyle = "";
        }

        // style
        else if ( STYLE_REGEXP.test( sequence ) ) {
            this.#ansiStyle += sequence;
        }

        // hyperlink
        else {
            const match = LINK_REGEXP.exec( sequence );

            if ( match ) {
                this.#link = match[ 1 ]
                    ? sequence
                    : "";
            }
        }
    }

    #wrapLine () {
        if ( this.#trim ) {
            this.#line = this.#line.replace( TRAILING_SPACES_REGEXP, "$1" );
        }

        return this.#endLine( "\n" ).#startLine();
    }

    #startLine () {
        this.#linePrefix = this.#ansiStyle + this.#link;
        this.#line = this.#linePrefix;

        return this;
    }

    #endLine ( char ) {

        // skip the line, that contains only restored styles
        if ( this.#line !== this.#linePrefix ) {
            this.#output += this.#line;

            // close hyperlink and reset styles at the line end
            if ( this.#link ) this.#output += LINK_END;
            if ( this.#ansiStyle ) this.#output += RESET;
        }

        if ( char ) this.#output += char;

        this.#line = "";
        this.#linePrefix = "";
        this.#lineVisibleLength = 0;

        return this;
    }
}

export default function wrap ( string, maxLength, { trim, wordWrap } = {} ) {
    const instance = new Wrap( maxLength, { trim, wordWrap } );

    return instance.wrap( string );
}
