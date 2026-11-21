import { makeCallable } from "#lib/callable";

const ESC = "\u{1B}",
    CSI = ESC + "[",
    OSC = ESC + "]",
    ST = ESC + "\\",
    ANSI_REGEXP = /(?:\u{1B}\[|\u{9B})[\u{30}-\u{3F}]*[\u{20}-\u{2F}]*[\u{40}-\u{7E}]/gv,

    // all CSI sequences except SGR (the final byte is not "m")
    ANSI_KEEP_STYLES_REGEXP = /(?:\u{1B}\[|\u{9B})[\u{30}-\u{3F}]*[\u{20}-\u{2F}]*[\u{40}-\u{6C}\u{6E}-\u{7E}]/gv,
    ANSI_LINK_REGEXP = /\u{1B}\]8;[^;\u{1B}]*;(.*?)\u{1B}\\(.*?)\u{1B}\]8;;\u{1B}\\/gsv,
    RESET = CSI + "0m",
    RESET_FOREGROUND = CSI + "39m",
    RESET_BACKGROUND = CSI + "49m",
    RESET_UNDERLINE_COLOR = CSI + "59m",
    DEFAULT_STYLES = {
        "reset": [ 0, null ],

        "bold": [ 1, 22 ],
        "dim": [ 2, 22 ],
        "italic": [ 3, 23 ],
        "underline": [ 4, 24 ],

        // XXX
        // "underline": [ "4:1", 24 ],
        // "doubleUnderline": [ "4:2", 24 ],
        "curlyUnderline": [ "4:3", 24 ],
        "dottedUnderline": [ "4:4", 24 ],
        "dashedUnderline": [ "4:5", 24 ],
        "slowBlink": [ 5, 25 ],
        "rapidBlink": [ 6, 25 ],
        "inverse": [ 7, 27 ],
        "hidden": [ 8, 28 ],
        "strikethrough": [ 9, 29 ],
        "fraktur": [ 20, 23 ],

        // XXX use 4:2???
        "doubleUnderline": [ 21, 24 ],
        "framed": [ 51, 54 ],
        "encircled": [ 52, 54 ],
        "overline": [ 53, 55 ],

        "black": [ 30, 39 ],
        "red": [ 31, 39 ],
        "green": [ 32, 39 ],
        "yellow": [ 33, 39 ],
        "blue": [ 34, 39 ],
        "magenta": [ 35, 39 ],
        "cyan": [ 36, 39 ],
        "white": [ 37, 39 ],
        "gray": [ 90, 39 ], // alias for brightBlack

        "onBlack": [ 40, 49 ],
        "onRed": [ 41, 49 ],
        "onGreen": [ 42, 49 ],
        "onYellow": [ 43, 49 ],
        "onBlue": [ 44, 49 ],
        "onMagenta": [ 45, 49 ],
        "onCyan": [ 46, 49 ],
        "onWhite": [ 47, 49 ],
        "onGray": [ 100, 49 ], // alias for onBrightBlack

        "brightBlack": [ 90, 39 ],
        "brightRed": [ 91, 39 ],
        "brightGreen": [ 92, 39 ],
        "brightYellow": [ 93, 39 ],
        "brightBlue": [ 94, 39 ],
        "brightMagenta": [ 95, 39 ],
        "brightCyan": [ 96, 39 ],
        "brightWhite": [ 97, 39 ],

        "onBrightBlack": [ 100, 49 ],
        "onBrightRed": [ 101, 49 ],
        "onBrightGreen": [ 102, 49 ],
        "onBrightYellow": [ 103, 49 ],
        "onBrightBlue": [ 104, 49 ],
        "onBrightMagenta": [ 105, 49 ],
        "onBrightCyan": [ 106, 49 ],
        "onBrightWhite": [ 107, 49 ],
    };

// private
function parseEnabled ( enabled ) {
    if ( enabled == null ) {
        enabled = null;
    }
    else {
        enabled = Boolean( enabled );
    }

    return enabled;
}

const isByte = value => Number.isInteger( value ) && value >= 0 && value <= 255;

const ansiStyle = ansi =>
    class AnsiStyle {
        #ansi = ansi;
        #name;
        #isEnabled;
        #on;
        #off;

        constructor ( { name, on, off, enabled } ) {
            this.#name = name;
            this.#on = on;
            this.#off = off;
            this.#isEnabled = parseEnabled( enabled );
        }

        // properties
        get ansi () {
            return this.#ansi;
        }

        get name () {
            return this.#name;
        }

        get on () {
            return this.#on;
        }

        get off () {
            return this.#off;
        }

        get isEnabled () {
            return this.#isEnabled ?? this.#ansi.isEnabled;
        }

        // public
        enable ( enabled ) {

            // clone named style
            if ( this.#name ) {
                return this._addStyle( {
                    "on": "",
                    "off": "",
                    enabled,
                } );
            }

            // update style
            else {
                this.#isEnabled = parseEnabled( enabled );

                return makeCallable( this, "applyStyle", {
                    "name": "ansi",
                } );
            }
        }

        color ( color ) {
            return this._addStyle( {
                "on": this.#ansi.createColor( 38, color ),
                "off": RESET_FOREGROUND,
            } );
        }

        onColor ( color ) {
            return this._addStyle( {
                "on": this.#ansi.createColor( 48, color ),
                "off": RESET_BACKGROUND,
            } );
        }

        underlineColor ( color ) {
            return this._addStyle( {
                "on": this.#ansi.createColor( 58, color ),
                "off": RESET_UNDERLINE_COLOR,
            } );
        }

        applyStyle ( string ) {

            // stringify
            string = String( string );

            if ( !this.isEnabled ) return string;

            if ( !string ) return "";

            if ( string.includes( "\n" ) ) {
                return this.#on + string.replaceAll( /\r*\n/gv, match => this.#off + match + this.#on ) + this.#off;
            }
            else {
                return this.#on + string + this.#off;
            }
        }

        // protected
        _addStyle ( { on, off, enabled } ) {

            // clone named style
            if ( this.#name ) {
                return makeCallable(
                    new this.constructor( {
                        "on": this.#on + on,
                        "off": off + this.#off,
                        enabled,
                    } ),
                    "applyStyle",
                    {
                        "name": "ansi",
                    }
                );
            }

            // update style
            else {
                this.#on = this.#on + on;
                this.#off = off + this.#off;

                return makeCallable( this, "applyStyle", {
                    "name": "ansi",
                } );
            }
        }
    };

// public
export class Ansi {
    static #globalEnabled = true;
    static #globalEnabledStack = [];

    #AnsiStyle;
    #isEnabled = null;
    #enabledStack = [];

    constructor () {
        this.#AnsiStyle = ansiStyle( this );

        // define default styles
        for ( const [ name, [ on, off ] ] of Object.entries( DEFAULT_STYLES ) ) {
            this.defineStyle( name, {
                "configurable": false,
                "on": on == null
                    ? null
                    : CSI + on + "m",
                "off": off == null
                    ? null
                    : CSI + off + "m",
            } );
        }
    }

    // static
    static get isEnabled () {
        return Ansi.#globalEnabled;
    }

    static setEnabled ( enabled ) {
        Ansi.#globalEnabled = Boolean( enabled );

        return this;
    }

    static pushEnabled ( enabled ) {
        Ansi.#globalEnabledStack.push( Ansi.#globalEnabled );

        return this.setEnabled( enabled );
    }

    static [ Symbol.dispose ] () {
        if ( Ansi.#globalEnabledStack.length ) {
            Ansi.#globalEnabled = Ansi.#globalEnabledStack.pop();
        }
    }

    // properties
    get RESET () {
        return RESET;
    }

    get isEnabled () {
        return this.#isEnabled ?? Ansi.isEnabled;
    }

    get regexp () {
        return ANSI_REGEXP;
    }

    // public
    setEnabled ( enabled ) {
        this.#isEnabled = parseEnabled( enabled );

        return this;
    }

    pushEnabled ( enabled ) {
        this.#enabledStack.push( this.#isEnabled );

        return this.setEnabled( enabled );
    }

    defineStyle ( name, { configurable, on, off } ) {
        configurable = configurable == null
            ? true
            : Boolean( configurable );

        const style = this.#createStyle( name, { on, off } );

        Object.defineProperty( this, name, {
            configurable,
            "writable": false,
            "value": style,
        } );

        Object.defineProperty( this.#AnsiStyle.prototype, name, {
            configurable,
            get () {
                return this._addStyle( style );
            },
        } );

        return this;
    }

    defineStyles ( styles ) {
        for ( const [ name, style ] of Object.entries( styles ) ) {
            this.defineStyle( name, style );
        }

        return this;
    }

    enable ( enabled ) {
        return this.#createStyle( null, { enabled } );
    }

    color ( color ) {
        return this.#createStyle( null, {
            "on": this.createColor( 38, color ),
            "off": RESET_FOREGROUND,
        } );
    }

    onColor ( color ) {
        return this.#createStyle( null, {
            "on": this.createColor( 48, color ),
            "off": RESET_BACKGROUND,
        } );
    }

    underlineColor ( color ) {
        return this.#createStyle( null, {
            "on": this.createColor( 58, color ),
            "off": RESET_UNDERLINE_COLOR,
        } );
    }

    link ( url, text ) {
        if ( this.isEnabled ) {
            return OSC + "8;;" + url + ST + ( text ?? url ) + OSC + "8;;" + ST;
        }
        else {
            return this.#linkToString( url, text );
        }
    }

    remove ( string, { keepStyles } = {} ) {
        if ( keepStyles ) {
            string = string.replaceAll( ANSI_KEEP_STYLES_REGEXP, "" );
        }
        else {
            string = string.replaceAll( ANSI_REGEXP, "" );
        }

        // remove links
        string = string.replaceAll( ANSI_LINK_REGEXP, ( match, url, text ) => this.#linkToString( url, text ) );

        return string;
    }

    createColor ( prefix, color ) {
        let r, g, b;

        // array
        if ( Array.isArray( color ) ) {
            [ r, g, b ] = color;
        }

        // number
        else if ( typeof color === "number" ) {
            if ( !Number.isInteger( color ) || color < 0 || color > 0xFFFFFF ) {
                throw new Error( "ANSI color value is invalid" );
            }

            r = ( color >> 16 ) & 0xFF;
            g = ( color >> 8 ) & 0xFF;
            b = color & 0xFF;
        }

        // hex string
        else if ( typeof color === "string" ) {
            let hex = color.startsWith( "#" )
                ? color.slice( 1 )
                : color;

            // expand short form: "fa0" -> "ffaa00"
            if ( hex.length === 3 ) {
                hex = hex.replaceAll( /[\da-f]/giv, "$&$&" );
            }

            if ( !/^[\da-f]{6}$/iv.test( hex ) ) {
                throw new Error( "ANSI color value is invalid" );
            }

            const value = Number.parseInt( hex, 16 );

            r = ( value >> 16 ) & 0xFF;
            g = ( value >> 8 ) & 0xFF;
            b = value & 0xFF;
        }

        // invalid value
        else {
            throw new Error( "ANSI color value is invalid" );
        }

        if ( !isByte( r ) || !isByte( g ) || !isByte( b ) ) {
            throw new Error( "ANSI color value is invalid" );
        }

        return CSI + `${ prefix };2;${ r };${ g };${ b }m`;
    }

    [ Symbol.dispose ] () {
        if ( this.#enabledStack.length ) {
            this.#isEnabled = this.#enabledStack.pop();
        }
    }

    // private
    #createStyle ( name, { on, off, enabled } = {} ) {
        on = on == null
            ? ""
            : String( on );

        off = off == null
            ? ""
            : String( off );

        return makeCallable(
            new this.#AnsiStyle( {
                name,
                on,
                off,
                enabled,
            } ),
            "applyStyle",
            {
                "name": "ansi",
            }
        );
    }

    #linkToString ( url, text ) {
        if ( !text || url === text ) {
            return `<${ url }>`;
        }
        else {
            return `[${ text }](${ url })`;
        }
    }
}

const ansi = new Ansi();

export default ansi;

ansi.defineStyles( {
    "hl": ansi.brightWhite,
    "ok": ansi.bold.brightWhite.onColor( 0x6400 ),
    "warn": ansi.color( 0x0 ).onColor( 0xCCCC00 ),
    "error": ansi.bold.brightWhite.onRed,
    "dark": ansi.white.onColor( 0x333333 ),
} );

// gray
for ( let n = 0; n <= 100; n++ ) {
    const color = Math.round( ( 255 * n ) / 100 ),
        colorArray = [ color, color, color ];

    ansi.defineStyle( "gray" + n, ansi.color( colorArray ) );
    ansi.defineStyle( "onGray" + n, ansi.onColor( colorArray ) );
}
