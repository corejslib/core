import ejs from "#lib/ejs";
import FileTree from "#lib/file-tree";
import { resolve } from "#lib/utils";
import * as yaml from "#lib/yaml";
import fileKeyword from "./keywords/file.js";
import readKeyword from "./keywords/read.js";

const apiSchemaTmpl = resolve( "#resources/templates/api-schema.md.ejs", import.meta.url );

const MARKDOWN_TYPE = {
    "object": "Object",
    "array": "Array",
};

export default class {
    #schema;
    #options;

    constructor ( schema, options ) {
        this.#schema = schema;
        this.#options = options;
    }

    // properties
    get schema () {
        return this.#schema;
    }

    get options () {
        return this.#options;
    }

    // public
    async start () {
        const fileTree = new FileTree(),
            versions = [];

        // build versions index
        for ( const module of Object.values( this.schema.modules ) ) {
            versions[ module.version ] ||= {};
            versions[ module.version ][ module.id ] = module;
        }

        const httpUrl = new URL( this.options.url );
        httpUrl.protocol = httpUrl.protocol === "http:" || httpUrl.protocol === "ws:"
            ? "http:"
            : "https:";
        if ( !httpUrl.pathname.endsWith( "/" ) ) httpUrl.pathname += "/";

        const webSocketsUrl = new URL( httpUrl );
        webSocketsUrl.protocol = httpUrl.protocol === "http:"
            ? "ws:"
            : "wss:";

        // build docs
        for ( const version in versions ) {
            fileTree.add( {
                "path": `${ version }.md`,
                "sources": await ejs.renderFile(
                    apiSchemaTmpl,
                    {
                        "generator": this,
                        version,
                        "modules": Object.values( versions[ version ] ),
                        httpUrl,
                        webSocketsUrl,
                        yaml,
                    },
                    { "async": true }
                ),
            } );
        }

        return result( 200, fileTree );
    }

    getMethodMarkdownSignature ( method ) {
        var signature;

        // method has params
        if ( method.params ) {
            signature = method.params
                .map( param => {

                    // required
                    if ( param.required ) {
                        return param.name;
                    }

                    // not required
                    else {
                        return param.name + "?";
                    }
                } )
                .join( ", " );
        }

        // method has no params
        else {
            signature = "";
        }

        return signature;
    }

    // XXX
    async getMethodParamDescription ( method, param ) {
        var desc = "";

        // read keyword
        if ( param.schema.read ) {
            desc += await readKeyword.getDescription( param );
        }

        // file keyword
        else if ( param.schema.file ) {
            desc += await fileKeyword.getDescription( param );
        }

        // raw parameter
        else {
            if ( param.description ) desc = param.description.trim();

            // XXX
            // descriprion has no type, try to get type from the schema
            if ( !/^{([\w.]+)(\[])?}/.test( desc ) ) {
                let types = param.schema?.instanceof || param.schema?.typeof || param.schema?.type;

                // if ( !types ) throw `Method "${method.id}" parameter "${param.name}" has no type defined`;
                if ( types ) {
                    if ( !Array.isArray( types ) ) types = [ types ];

                    desc = "{" + types.map( type => MARKDOWN_TYPE[ type ] || type ).join( "|" ) + "}" + ( desc
                        ? " " + desc
                        : "" );
                }
            }
        }

        // indent
        if ( desc ) desc = " " + desc.replaceAll( /^/gm, " ".repeat( 4 ) ).replaceAll( /^ +$/gm, "" ).trim();

        return desc;
    }
}
