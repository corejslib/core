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
    CACHE = new CacheLru( {
        "maxSize": 1000,
    } ),
    PROXY = {
        has ( target, key ) {
            return true;
        },
        get ( target, key, receiver ) {
            if ( key === Symbol.unscopables ) {
                return;
            }
            else {
                return target?.[ key ];
            }
        },
        set ( target, property, value ) {
            throw new Error( "Unable to set global property" );
        },
    };

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
                return `this.output += this.stringify( this.escape, ${ text } );`;
            }

            // text tag
            else if ( this.#start === "<%-" ) {
                return `this.output += this.stringify( null, ${ text } );`;
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
                return `this.output += ${ JSON.stringify( text ) };`;
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
    #async;
    #escape;
    #code;
    #render;

    constructor ( template, { cache, async, escape } = {} ) {
        this.#template = template;
        this.#cache = cache
            ? ( cache === true
                ? CACHE
                : cache )
            : null;

        this.#async = Boolean( async );
        this.#escape = escape;

        let cached;

        if ( this.#cache ) {
            cached = this.#cache.get( this.id );

            if ( cached ) {
                this.#code = cached.code;

                this.#render = cached[ this.#async
                    ? "render"
                    : "renderSync" ];
            }
            else {
                cached = {
                    "code": null,
                    "render": null,
                    "renderSync": null,
                };

                this.#cache.set( this.id, cached );
            }
        }

        if ( !this.#code ) {
            this.#code = this.#compile( template );

            if ( cached ) {
                cached.code = this.#code;
            }
        }

        if ( !this.#render ) {
            const generatorBody = `
with ( new Proxy( locals ?? {}, proxy ) ) {
    return ${ this.#async
        ? "async "
        : "" }function () {
        "use strict";

${ this.#code }

        return this.output;
    };
}
`.trim(),
                generate = new Function( "proxy", "locals", generatorBody );

            this.#render = function ( locals, context ) {
                return generate( PROXY, locals ).call( context );
            };

            // cache
            if ( cached ) {
                cached[ this.#async
                    ? "render"
                    : "renderSync" ] = this.#render;
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

    get isAsync () {
        return this.#async;
    }

    get code () {
        return this.#code;
    }

    // public
    render ( locals ) {
        return this.#render(
            locals,
            {
                "escape": this.#escape === undefined
                    ? escapeXml
                    : this.#escape,
                stringify,
                "output": "",
            }
        );
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
}

export default makeCallable( Ejs, "new", {
    "name": "ejs",
} );
