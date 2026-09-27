import CacheLru from "#lib/cache/lru";
import { makeCallable } from "#lib/callable";

// DOCS:
// <% "Scriptlet" tag, for control-flow, no output
// <%_ "Whitespace Slurping" Scriptlet tag, strips all whitespace before it
//
// <%= Outputs the value into the template (escaped)
// <%- Outputs the unescaped value into the template
//
// %> Plain ending tag
// -%> Trim-mode ("newline slurp") tag, trims following newline
// _%> "Whitespace Slurping" ending tag, removes all whitespace after it
//
// <%# Comment tag, no execution, no output
// <%% Outputs a literal "<%"
// %%> Outputs a literal "%>"

const START_TOKENS = new Set( [ "<%", "<%-", "<%_", "<%=", "<%#" ] ),
    END_TOKENS = new Set( [ "%>", "-%>", "_%>" ] ),
    ESCAPE = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&apos;",
        '"': "&quot;",
    },
    ESCAPE_RE = new RegExp( String.raw`[${ Object.keys( ESCAPE ).join( "" ) }]`, "gv" ),
    STRICT_GLOBALS = new Set( [ "NaN", "Infinity", "undefined", "isNaN", "isFinite", "parseInt", "parseFloat", "encodeURIComponent", "decodeURIComponent", "encodeURI", "decodeURI" ] ),
    CACHE = new CacheLru( {
        "maxSize": 1000,
    } ),
    CONTEXT_PROXY = {
        get ( target, property, receiver ) {
            return target[ property ];
        },

        set ( target, property, value, receiver ) {
            throw new Error( "Unable to set global property" );
        },
    };

class GlobalProxy {
    #context;

    constructor ( context ) {
        this.#context = context;
    }

    // public
    has ( target, property ) {
        return true;
    }

    get ( target, property, receiver ) {
        if ( property === Symbol.unscopables ) {
            return;
        }
        else if ( property in target ) {
            const value = target[ property ];

            if ( typeof value === "function" ) {
                return value.bind( target );
            }
            else {
                return value;
            }
        }
        else if ( property in globalThis ) {
            if ( !this.#context.strictGlobals ) {
                return globalThis[ property ];
            }
            else if ( STRICT_GLOBALS.has( property ) ) {
                return globalThis[ property ];
            }
        }

        if ( this.#context.strictReferences ) {
            throw new ReferenceError( `"${ property }" is not defined` );
        }
    }

    set ( target, property, value, receiver ) {
        throw new Error( "Unable to set global property" );
    }
}

function stringify ( escape, value ) {
    if ( value == null ) {
        return "";
    }
    else {
        value = String( value );

        if ( value && escape ) {
            value = escape( value );
        }

        return value;
    }
}

function escapeXml ( string ) {
    return string && string.replaceAll( ESCAPE_RE, char => ESCAPE[ char ] || char );
}

function buildErrorMessage ( e, template ) {
    return `EJS error: ${ e }\n${ template.replaceAll( /^/gmv, "| " ) }`;
}

class EjsNode {
    #start;
    #end;
    #text = "";

    constructor ( token ) {
        if ( START_TOKENS.has( token ) ) {
            this.#start = token;
        }
        else if ( END_TOKENS.has( token ) ) {
            this.#end = token;
        }
        else {
            this.addText( token );
        }
    }

    // properties
    get isTag () {
        return !!this.#start;
    }

    get isComment () {
        return this.#start === "<%#";
    }

    get startToken () {
        return this.#start;
    }

    get endToken () {
        return this.#end;
    }

    get text () {
        return this.#text;
    }

    // public
    addText ( text ) {
        if ( text === "<%%" || text === "%%>" ) {
            text = text.replace( "%%", "%" );
        }

        this.#text += text;
    }

    close ( text ) {
        this.#end = text;
    }

    createOutput ( previousNode, nextNode ) {
        var text = this.#text;

        if ( this.isComment ) {
            return;
        }
        else if ( this.isTag ) {
            text = text.trim();

            if ( !text ) return;

            // escaped text tag
            if ( this.#start === "<%=" ) {
                return `this.output.push( this.stringify( this.escape, ${ text } ) );`;
            }

            // text tag
            else if ( this.#start === "<%-" ) {
                return `this.output.push( this.stringify( null, ${ text } ) );`;
            }

            // code tag
            else if ( this.#start === "<%" || this.#start === "<%_" ) {
                return text;
            }
        }
        else {

            // remove single newline at the start
            if ( previousNode?.endToken === "-%>" ) {
                text = text.replace( /^(?:\r\n|\r|\n)/v, "" );
            }

            // remove all whitespaces and single new line at the start
            else if ( previousNode?.endToken === "_%>" ) {
                text = text.replace( /^[\t ]*(?:\r\n|\r|\n)?/v, "" );
            }

            // remove all whitespace at the end
            if ( nextNode?.startToken === "<%_" ) {
                text = text.replace( /[\t ]+$/v, "" );
            }
            else if ( nextNode?.isComment ) {
                text = text.replace( /(?:\r\n|\r|\n)[\t ]*$/v, "" );
            }

            if ( text ) {
                return `this.output.push(  ${ JSON.stringify( text ) } );`;
            }
        }
    }

    [ Symbol.for( "nodejs.util.inspect.custom" ) ] ( depth, options, inspect ) {
        const spec = {};

        if ( this.isTag ) {
            spec.startToken = this.#start;
            spec.endToken = this.#end;
        }

        if ( this.#text ) {
            spec.text = this.#text;
        }

        return `${ this.constructor.name }: ${ inspect( spec ) }`;
    }
}

export class Ejs {
    #id;
    #cache;
    #template;
    #escape;
    #strictGlobals;
    #strictReferences;
    #code;
    #render;
    #renderSync;

    constructor ( template, { cache, escape, strictGlobals, strictReferences } = {} ) {
        this.#template = template;
        this.#cache = cache
            ? ( cache === true
                ? CACHE
                : cache )
            : null;

        this.#escape = typeof escape === "function"
            ? escape
            : null;
        this.#strictGlobals = Boolean( strictGlobals );
        this.#strictReferences = Boolean( strictReferences );

        if ( this.#cache ) {
            const cached = this.#cache.get( this.id );

            if ( cached ) {
                this.#code = cached.code;

                this.#render = cached.render;
                this.#renderSync = cached.renderSync;
            }
        }

        if ( !this.#code ) {
            this.#code = this.#compile( template );

            try {
                this.#renderSync = this.#buildRenderer( true );
            }
            catch {
                try {
                    this.#render = this.#buildRenderer( false );
                }
                catch ( e ) {
                    throw buildErrorMessage( e, this.#template );
                }
            }

            if ( this.#cache ) {
                this.#cache.set( this.id, {
                    "code": this.#code,
                    "render": this.#render,
                    "renderSync": this.#renderSync,
                } );
            }
        }
    }

    // static
    static get cache () {
        return CACHE;
    }

    static new ( template, options ) {
        if ( template instanceof this ) {
            return template;
        }
        else {
            return new this( template, options );
        }
    }

    static isEjs ( value ) {
        return value instanceof this;
    }

    // properties
    get id () {
        if ( this.#id == null ) {
            this.#id = this._createId( this.#template );
        }

        return this.#id;
    }

    get template () {
        return this.#template;
    }

    get cache () {
        return this.#cache;
    }

    get isSync () {
        return !!this.#renderSync;
    }

    get strictGlobals () {
        return this.#strictGlobals;
    }

    get strictReferences () {
        return this.#strictReferences;
    }

    get code () {
        return this.#code;
    }

    // public
    async render ( locals, { escape, strictGlobals, strictReferences } = {} ) {
        if ( this.#renderSync ) {
            return this.#renderSync( locals, this.#createContext( { escape, strictGlobals, strictReferences } ) );
        }
        else {
            return this.#render( locals, this.#createContext( { escape, strictGlobals, strictReferences } ) );
        }
    }

    renderSync ( locals, { escape, strictGlobals, strictReferences } = {} ) {
        if ( !this.#renderSync ) {
            throw buildErrorMessage( "Template is async", this.#template );
        }

        return this.#renderSync( locals, this.#createContext( { escape, strictGlobals, strictReferences } ) );
    }

    // protected
    _createId ( template ) {
        return template;
    }

    // private
    #compile ( template ) {
        const nodes = [];

        var node;

        for ( const token of template.split( /(<%[#%=_\-]?|[%_\-]?%>)/v ) ) {
            if ( !token ) {
                continue;
            }

            // start tag
            else if ( START_TOKENS.has( token ) ) {
                if ( node ) {
                    if ( node.isComment ) {
                        node.addText( token );

                        continue;
                    }
                    else if ( node.isTag ) {
                        throw new Error( "EJS nested tags are not allowed" );
                    }
                }

                node = this.#createNode( nodes, token );
            }

            // end tag
            else if ( END_TOKENS.has( token ) ) {
                if ( node?.isTag ) {
                    node.close( token );

                    node = null;
                }
                else {
                    throw new Error( "EJS tag not opened" );
                }
            }

            // text
            else {
                if ( node ) {
                    node.addText( token );
                }
                else {
                    node = this.#createNode( nodes, token );
                }
            }
        }

        if ( node?.isTag ) {
            throw new Error( "EJS tag not closed" );
        }

        const lines = [];

        for ( let n = 0; n < nodes.length; n++ ) {
            const line = nodes[ n ].createOutput( nodes[ n - 1 ], nodes[ n + 1 ] );

            if ( line ) {
                lines.push( line );
            }
        }

        return lines.join( "\n" );
    }

    #createNode ( nodes, token ) {
        const node = new EjsNode( token );

        nodes.push( node );

        return node;
    }

    #buildRenderer ( sync ) {
        const generatorBody = `
with ( new Proxy( locals ?? {}, proxy ) ) {
    return ${ sync
        ? ""
        : "async " }function () {
        "use strict";

${ this.#code }

        return this.output.join("");
    };
}
`.trim(),
            generate = new Function( "proxy", "locals", generatorBody );

        if ( sync ) {
            return function ( locals, context ) {
                try {
                    return generate( new GlobalProxy( context ), locals ).call( context );
                }
                catch ( e ) {
                    throw buildErrorMessage( e, this.#template );
                }
            };
        }
        else {
            return async function ( locals, context ) {
                try {
                    return await generate( new GlobalProxy( context ), locals ).call( context );
                }
                catch ( e ) {
                    throw buildErrorMessage( e, this.#template );
                }
            };
        }
    }

    #createContext ( { escape, strictGlobals, strictReferences } = {} ) {
        const context = {
            stringify,
            "escape": typeof escape === "function"
                ? escape
                : ( this.#escape ?? escapeXml ),
            "strictGlobals": strictGlobals === undefined
                ? this.#strictGlobals
                : Boolean( strictGlobals ),
            "strictReferences": strictReferences === undefined
                ? this.#strictReferences
                : Boolean( strictReferences ),
            "output": [],
        };

        return new Proxy( context, CONTEXT_PROXY );
    }
}

export default makeCallable( Ejs, "new", {
    "name": "ejs",
} );
