import fs from "node:fs";
import CacheLru from "#lib/cache/lru";
import externalResources from "#lib/external-resources";
import MMDB from "#lib/mmdb";

const cache = new CacheLru( { "maxSize": 1000 } );

var mmdb;

const resource = await externalResources
    .add( "corejslib/core/resources/geolite2-country" )
    .on( "update", () => ( mmdb = null ) )
    .check();

class GeoipCountry {
    #dbPath = resource.getResourcePath( "GeoLite2-Country.mmdb" );

    // properties
    get dbPath () {
        return this.#dbPath;
    }

    // public
    get ( ipAddress ) {
        mmdb ??= new MMDB( fs.readFileSync( this.dbPath ), { cache } );

        return mmdb.get( ipAddress );
    }
}

export default new GeoipCountry();
