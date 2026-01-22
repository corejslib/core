import stream from "node:stream";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown, gfmToMarkdown } from "mdast-util-gfm";
import { defaultHandlers, toMarkdown } from "mdast-util-to-markdown";
import { toString } from "mdast-util-to-string";
import { gfm } from "micromark-extension-gfm";
import { CONTINUE, EXIT, SKIP, visit } from "unist-util-visit";
import ansi from "#lib/ansi";
import Table from "#lib/text/table";

const fromMarkdownOptions = {
        "extensions": [ gfm() ],
        "mdastExtensions": [ gfmFromMarkdown() ],
    },
    toMarkdownOptions = {
        "extensions": [ gfmToMarkdown() ],
        "resourceLink": false,
        "bullet": "-",
        "emphasis": "_",
        "strong": "*",
        "listItemIndent": "one",
        "rule": "-",
    },
    ANSI_STYLES = {
        "code": ansi.cyan,
        "inlineCode": ansi.cyan,
        "heading": ansi.doubleUnderline.bold,
        "emphasis": ansi.italic,
        "strong": ansi.bold,
        "strikethrough": ansi.strikethrough,
        "thematicBreak": ansi.dim,
        "link": ansi.link.bind( ansi ),
        "footnote": ansi.underline,
    },
    ALIGN = {
        "left": "start",
        "center": "center",
        "right": "end",
    };

export default class Markdown {
    #source;
    #ast;

    constructor ( source ) {
        this.#source = source;
    }

    // properties
    get source () {
        return this.#source;
    }

    get defaultHandlers () {
        return defaultHandlers;
    }

    get CONTINUE () {
        return CONTINUE;
    }

    get EXIT () {
        return EXIT;
    }

    get SKIP () {
        return SKIP;
    }

    // public
    toMarkdown ( options = {} ) {
        return this.#toMarkdown( this.#getAst(), options );
    }

    toString ( { ansi, table, styles = {}, thematicBreakWidth, replaceCodeLanguage } = {} ) {
        ansi = ansi instanceof stream.Writable
            ? ansi.isTTY
            : Boolean( ansi );

        table = {
            "style": "markdown",
            ...table,
            ansi,
            "column": {
                "headerAlign": "center",
                "headerValign": "end",
                ...table?.column,
            },
        };

        if ( ansi ) {
            styles = {
                ...ANSI_STYLES,
                ...styles,
            };
        }
        else {
            styles = {};
        }

        return this.#toString( this.#getAst(), {
            table,
            styles,
            thematicBreakWidth,
            replaceCodeLanguage,
        } );
    }

    traverse ( callback, { test, reverse } = {} ) {
        visit( this.#getAst(), test, callback, reverse );

        return this;
    }

    nodeToString ( node ) {
        return this.#nodeToString( node );
    }

    // private
    #getAst () {
        if ( this.#ast == null ) {
            this.#ast = fromMarkdown( this.#source, fromMarkdownOptions );
        }

        return this.#ast;
    }

    #toMarkdown ( tree, options = {} ) {
        return toMarkdown( tree, {
            ...toMarkdownOptions,
            ...options,
        } );
    }

    #toString ( tree, { "table": tableOptions = {}, styles = {}, thematicBreakWidth, replaceCodeLanguage } = {} ) {
        if ( Array.isArray( tree ) ) {
            var trim = true;

            tree = {
                "type": "root",
                "children": tree,
            };
        }

        thematicBreakWidth ||= 3;

        const options = {
            "table": tableOptions,
            styles,
            thematicBreakWidth,
            replaceCodeLanguage,
        };

        const string = this.#toMarkdown( tree, {
            "handlers": {
                "heading": ( node, parent, context ) => {
                    const depth = Math.max( Math.min( 6, node.depth || 1 ), 1 ),
                        prefix = "#".repeat( depth ),
                        value = this.#nodeToString( node );

                    return this.#applyStyle( value
                        ? prefix + " " + value
                        : prefix, styles.heading );
                },

                "text": ( node, parent ) => {
                    return this.#applyStyle( this.#nodeToString( node ) );
                },

                "emphasis": ( node, parent, context ) => {
                    return this.#applyStyle( this.#toString( node.children, options ), styles.emphasis );
                },

                "strong": ( node, parent, context ) => {
                    return this.#applyStyle( this.#toString( node.children, options ), styles.strong );
                },

                // strikethrough
                "delete": ( node, parent ) => {
                    return this.#applyStyle( this.#toString( node.children, options ), styles.strikethrough );
                },

                "thematicBreak": ( node, parent, context ) => {
                    return this.#applyStyle( "—".repeat( thematicBreakWidth ), styles.thematicBreak );
                },

                "inlineCode": node => {
                    return this.#applyStyle( this.#nodeToString( node ), styles.inlineCode );
                },

                "code": node => {
                    return `\`\`\`${ replaceCodeLanguage?.( node.lang ) || node.lang || "" }
${ this.#applyStyle( this.#nodeToString( node ), styles.code ) }
\`\`\``;
                },

                "link": ( node, parent, context ) => {
                    const text = this.#nodeToString( node.children[ 0 ] );

                    if ( !node.url ) {
                        return text;
                    }
                    else {
                        const url = this.#parseUrl( node.url, "http:" ),
                            label = this.#parseUrl( text, url.startsWith( "mailto:" )
                                ? "mailto:"
                                : "http:" );

                        if ( styles.link ) {
                            return styles.link( node.url, text );
                        }
                        else if ( url === label ) {
                            return `<${ node.url }>`;
                        }
                        else {
                            return `${ text } <${ node.url }>`;
                        }
                    }
                },

                "footnoteReference": node => {
                    return this.#applyStyle( `[^${ node.label }]`, styles.footnote );
                },

                "footnoteDefinition": node => {
                    return this.#applyStyle( `[^${ node.label }]`, styles.footnote ) + ": " + this.#toString( node.children, options );
                },

                "table": node => {
                    const columns = [],
                        align = [ ...node.align ];

                    for ( const cell of node.children[ 0 ].children ) {
                        columns.push( {
                            "title": this.#toString( cell.children, options ),
                            "align": ALIGN[ align.shift() ],
                        } );
                    }

                    const table = new Table( {
                        ...tableOptions,
                        columns,
                    } );

                    for ( let n = 1; n < node.children.length; n++ ) {
                        const row = node.children[ n ],
                            rows = [];

                        for ( const cell of row.children ) {
                            rows.push( this.#toString( cell.children, options ) );
                        }

                        table.write( [ rows ] );
                    }

                    table.end();

                    return table.content.trim();
                },
            },
        } );

        if ( trim ) {
            return string.trim();
        }
        else {
            return string;
        }
    }

    #parseUrl ( url, protocol ) {
        try {
            return new URL( url ).href;
        }
        catch {}

        try {
            if ( protocol === "mailto:" ) {
                return new URL( protocol + url ).href;
            }
            else if ( url.startsWith( "//" ) ) {
                return new URL( protocol + url ).href;
            }
            else {
                return new URL( protocol + "//" + url ).href;
            }
        }
        catch {}

        return url;
    }

    #nodeToString ( node ) {
        return toString( node );
    }

    #applyStyle ( string, style ) {
        if ( style ) {
            return style( string );
        }
        else {
            return string;
        }
    }
}
