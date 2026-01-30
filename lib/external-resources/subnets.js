import { writeConfig } from "#lib/config";
import ExternalRecourceBuilder from "#lib/external-resource-builder";
import fetch from "#lib/fetch";
import IpRange from "#lib/ip/range";
import * as yaml from "#lib/yaml";

const EPOCH = 1,
    CLOUDFLARE_IPV4_URL = "https://www.cloudflare.com/ips-v4",
    CLOUDFLARE_IPV6_URL = "https://www.cloudflare.com/ips-v6",
    GOOGLE_URL = "https://www.gstatic.com/ipranges/goog.json";

// TODO
// facebook
// whois -h whois.radb.net -- '-i origin AS32934' | grep ^route
//
// cloudflare
// whois -h whois.radb.net -- '-i origin AS13335' | grep ^route
//
// google
// whois -h whois.radb.net -- '-i origin AS15169' | grep ^route

export default class TLD extends ExternalRecourceBuilder {

    // properties
    get id () {
        return "c0rejs/core/resources/subnets";
    }

    // protected
    async _getEtag () {
        const res = await this.#build();
        if ( !res.ok ) return res;

        return result( 200, EPOCH + "/" + JSON.stringify( res.data ) );
    }

    async _build ( location ) {
        const res = await this.#build();

        if ( !res.ok ) return res;

        await writeConfig( location + "/subnets.json", res.data, { "readable": true } );

        return res;
    }

    // private
    async #build () {
        const subnets = yaml.fromYaml( await ( await fetch( "https://raw.githubusercontent.com/c0rejs/core/main/resources/subnets.yaml" ) ).text() );

        subnets.cloudflare = [];
        subnets.google = [];

        // cloudflare v4
        var res = await fetch( CLOUDFLARE_IPV4_URL );
        if ( !res.ok ) return res;

        subnets.cloudflare.push( ...( await res.text() )
            .split( "\n" )
            .map( line => line.trim() )
            .filter( line => line )
            .sort( IpRange.compare ) );

        // cloudflare v6
        res = await fetch( CLOUDFLARE_IPV6_URL );
        if ( !res.ok ) return res;

        subnets.cloudflare.push( ...( await res.text() )
            .split( "\n" )
            .map( line => line.trim() )
            .filter( line => line )
            .sort( IpRange.compare ) );

        // google
        res = await fetch( GOOGLE_URL );
        if ( !res.ok ) return res;

        subnets.google.push( ...( await res.json() ).prefixes.map( prefix => prefix.ipv4Prefix || prefix.ipv6Prefix ).sort( IpRange.compare ) );

        return result( 200, subnets );
    }
}
