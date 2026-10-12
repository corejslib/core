import fs from "node:fs";
import ExternalResourceBuilder from "#lib/external-resource-builder";

export default class ExternalResource extends ExternalResourceBuilder {
    #file;
    #meta;

    constructor ( file, id, meta ) {
        super( {
            ...id,
            "id": "corejslib/core/resources/uws",
            "caller": import.meta.url,
        } );

        this.#file = file;
        this.#meta = meta;
    }

    // protected
    async _getEtag () {
        return result( 200, fs.createReadStream( this.#file ) );
    }

    async _build ( location ) {
        fs.copyFileSync( this.#file, location + "/uws.node" );

        return result( 200 );
    }

    async _getMeta () {
        return result( 200, this.#meta );
    }
}
