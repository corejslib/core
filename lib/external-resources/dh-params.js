import { spawnSync } from "node:child_process";
import ExternalRecourceBuilder from "#lib/external-resource-builder";

const SIZE = 4096;

export default class DhParams extends ExternalRecourceBuilder {

    // properties
    get id () {
        return "corejslib/core/resources/dh-params";
    }

    // protected
    async _getEtag () {
        if ( this.etag ) {
            return result( 200 );
        }
        else {
            return result( 200, Temporal.Now.instant() );
        }
    }

    async _build ( location ) {
        spawnSync( "openssl", [ "dhparam", "-out", location + "/dh-params.pem", SIZE ], {
            "stdio": "ignore",
        } );

        return result( 200 );
    }
}
