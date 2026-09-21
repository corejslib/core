import { hash } from "node:crypto";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { Ejs as BrowserEjs } from "#browser/ejs";
import { makeCallable } from "#lib/callable";

export class Ejs extends BrowserEjs {

    // static
    static async fromFile ( path, options ) {

        // file: url
        if ( path instanceof URL || ( typeof path === "string" && path.startsWith( "file:" ) ) ) {
            path = fileURLToPath( path );
        }

        return new this( await fs.promises.readFile( path, "utf8" ), options );
    }

    static fromFileSync ( path, options ) {

        // file: url
        if ( path instanceof URL || ( typeof path === "string" && path.startsWith( "file:" ) ) ) {
            path = fileURLToPath( path );
        }

        return new this( fs.readFileSync( path, "utf8" ), options );
    }

    static async renderFile ( path, data, options ) {
        const template = await this.fromFile( path, options );

        return template.render( data );
    }

    // protected
    _createId ( template ) {
        return hash( "SHA-256", template, "hex" );
    }
}

export default makeCallable( Ejs, "new", {
    "name": "ejs",
} );
