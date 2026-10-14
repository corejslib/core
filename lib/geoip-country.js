import fs from "node:fs";
import CacheLru from "#lib/cache/lru";
import Events from "#lib/events";
import externalResources from "#lib/external-resources";
import Mmdb from "#lib/mmdb";

const cache = new CacheLru( { "maxSize": 1000 } );

var mmdb;

const resource = await externalResources
    .add( "corejslib/core/resources/geolite2-country" )
    .on( "update", () => ( mmdb = null ) )
    .check();

class GeoipCountry {
    #events = new Events();
    #dbPath = resource.getResourcePath( "GeoLite2-Country.mmdb" );

    constructor () {
        resource.on( "update", () => this.#events.emit( "update" ) );
    }

    // properties
    get dbPath () {
        return this.#dbPath;
    }

    // public
    get ( ipAddress ) {
        if ( !mmdb ) {
            mmdb = new Mmdb( fs.readFileSync( this.dbPath ), { cache } );
        }

        return mmdb.get( ipAddress );
    }

    on ( event, callback ) {
        this.#events.on( event, callback );

        return this;
    }

    once ( event, callback ) {
        this.#events.once( event, callback );

        return this;
    }

    off ( event, callback ) {
        this.#events.off( event, callback );

        return this;
    }
}

export default new GeoipCountry();
