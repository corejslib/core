import stream from "node:stream";
import { fromMarkdown } from "mdast-util-from-markdown";
import { frontmatterFromMarkdown, frontmatterToMarkdown } from "mdast-util-frontmatter";
import { gfmFromMarkdown, gfmToMarkdown } from "mdast-util-gfm";
import { defaultHandlers, toMarkdown } from "mdast-util-to-markdown";
import { toString } from "mdast-util-to-string";
import { frontmatter } from "micromark-extension-frontmatter";
import { gfm } from "micromark-extension-gfm";
import { CONTINUE, EXIT, SKIP, visit } from "unist-util-visit";
import ansi from "#lib/ansi";
import Table from "#lib/text/table";
import wrap from "#lib/text/wrap";

const DEFAULT_TABLE_WIDTH = 100,
    DEFAULT_THEMATIC_BREAK_WIDTH = 3,
    ANSI_STYLES = {
        "code": ansi.cyan.onColor( 0x000022 ),
        "inlineCode": ansi.cyan.onColor( 0x000022 ),
        "heading": ansi.bold.red.dashedUnderline,
        "emphasis": ansi.italic,
        "strong": ansi.yellow.dashedUnderline,
        "strikethrough": ansi.strikethrough,
        "thematicBreak": ansi.dim,
        "link": ansi.link.bind( ansi ),
        "footnote": ansi.underline,
    },
    ANSI_HEADING_STYLES = {
        "inlineCode": ansi.color( 0xEE0000 ).onColor( 0x220000 ),
        "emphasis": ansi.italic,
        "strong": ansi.bold,
        "strikethrough": ansi.strikethrough,
    },
    fromMarkdownOptions = {
        "extensions": [ gfm(), frontmatter( [ "yaml", "toml" ] ) ],
        "mdastExtensions": [ gfmFromMarkdown(), frontmatterFromMarkdown( [ "yaml", "toml" ] ) ],
    },
    toMarkdownOptions = {
        "extensions": [ gfmToMarkdown(), frontmatterToMarkdown( [ "yaml", "toml" ] ) ],
        "resourceLink": false,
        "bullet": "-",
        "emphasis": "_",
        "strong": "*",
        "listItemIndent": "one",
        "rule": "-",
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

    toString ( { ansi, table, styles = {}, headingStyles = {}, thematicBreakWidth, replaceCodeLanguage } = {} ) {
        ansi = ansi instanceof stream.Writable
            ? ansi.isTTY
            : Boolean( ansi );

        table = {
            "width": DEFAULT_TABLE_WIDTH,
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

            headingStyles = {
                ...ANSI_HEADING_STYLES,
                ...headingStyles,
            };
        }

        return this.#toString( this.#getAst(), {
            table,
            styles,
            headingStyles,
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

    #toString ( tree, { "table": tableOptions = {}, styles = {}, headingStyles = {}, thematicBreakWidth, replaceCodeLanguage } = {} ) {
        let trim;

        if ( Array.isArray( tree ) ) {
            trim = true;

            tree = {
                "type": "root",
                "children": tree,
            };
        }

        thematicBreakWidth ||= DEFAULT_THEMATIC_BREAK_WIDTH;

        const options = {
            "table": tableOptions,
            styles,
            headingStyles,
            thematicBreakWidth,
            replaceCodeLanguage,
        };

        const string = this.#toMarkdown( tree, {
            "handlers": {
                "heading": ( node, parent, context ) => {
                    const depth = node.depth,
                        prefix = "#".repeat( depth ),
                        value = this.#toString( node.children, {
                            ...options,
                            "styles": headingStyles,
                        } );

                    if ( value ) {
                        return prefix + " " + this.#applyStyle( value, styles.heading );
                    }
                    else {
                        return prefix;
                    }
                },

                "text": ( node, parent ) => this.#applyStyle( this.#nodeToString( node ) ),

                "emphasis": ( node, parent, context ) => this.#applyStyle( this.#toString( node.children, options ), styles.emphasis ),

                "strong": ( node, parent, context ) => this.#applyStyle( this.#toString( node.children, options ), styles.strong ),

                // strikethrough
                "delete": ( node, parent ) => this.#applyStyle( this.#toString( node.children, options ), styles.strikethrough ),

                "thematicBreak": ( node, parent, context ) => this.#applyStyle( "—".repeat( thematicBreakWidth ), styles.thematicBreak ),

                "inlineCode": node => this.#applyStyle( this.#nodeToString( node ), styles.inlineCode ),

                "code": node => {
                    let title = replaceCodeLanguage?.( node.lang ) || node.lang || "";

                    if ( title ) {
                        title = `[code: ${ this.#applyStyle( title, styles.inlineCode ) }]`;
                    }

                    const table = new Table( {
                        ...tableOptions,
                        "style": "borderless",
                        "columns": {
                            "code": {
                                title,
                                "headerAlign": "start",
                                "align": "start",
                            },
                        },
                    } );

                    table.write( {
                        "code": this.#nodeToString( node )
                            .split( "\n" )
                            .flatMap( line => wrap( line, table.width - 1 ).split( "\n" ) )
                            .map( line => "┆" + this.#applyStyle( line.padEnd( table.width - 1 ), styles.code ) )
                            .join( "\n" ),
                    } );

                    table.end();

                    return table.content.trim();
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

                "footnoteReference": node => this.#applyStyle( `[^${ node.label }]`, styles.footnote ),

                "footnoteDefinition": node => this.#applyStyle( `[^${ node.label }]`, styles.footnote ) + ": " + this.#toString( node.children, options ),

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
