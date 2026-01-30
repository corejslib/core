import fs from "node:fs";
import Acme from "#lib/api/acme";
import Cloudflare from "#lib/api/cloudflare";
import env from "#lib/env";
import ExternalResourceBuilder from "#lib/external-resource-builder";
import Hostname from "#lib/hostname";
import Interval from "#lib/interval";

const UPDATE_INTERVAL = new Interval( "2 weeks" ),
    ID = "c0rejs/core/resources/certificates",
    CERTIFICATES = {
        "local": {
            "domains": [

                //
                "local.softvisio.net",
                "*.local.softvisio.net",
                "*.devel.local.softvisio.net",
                "devel.softvisio.net",
                "*.devel.softvisio.net",
            ],
        },
    };

env.loadUserEnv();

var cloudflareApi;

if ( process.env.CLOUDFLARE_KEY && process.env.CLOUDFLARE_EMAIL ) {
    cloudflareApi = new Cloudflare( process.env.CLOUDFLARE_KEY, process.env.CLOUDFLARE_EMAIL );
}
else if ( process.env.CLOUDFLARE_TOKEN ) {
    cloudflareApi = new Cloudflare( process.env.CLOUDFLARE_TOKEN );
}

export default class Datasets extends ExternalResourceBuilder {
    #certificates;

    // properties
    get id () {
        return ID;
    }

    // protected
    async _getEtag () {
        const res = await this.#getCertificates();
        if ( !res.ok ) return res;

        return result(
            200,
            Object.values( this.#certificates )
                .map( data => data.fingerprint )
                .join( "/" )
        );
    }

    async _build ( location ) {
        for ( const [ name, data ] of Object.entries( this.#certificates ) ) {
            fs.mkdirSync( `${ location }/${ name }`, {
                "recursive": true,
            } );

            fs.writeFileSync( `${ location }/${ name }/private-key.pem`, data.privateKey );

            fs.writeFileSync( `${ location }/${ name }/certificate.pem`, data.certificate );
        }

        return result( 200 );
    }

    async _getExpires () {
        var expires;

        for ( const data of Object.values( this.#certificates ) ) {
            data.expires = new Date( data.expires );

            if ( !expires ) {
                expires = data.expires;
            }
            else if ( data.expires < expires ) {
                expires = data.expires;
            }
        }

        return result( 200, UPDATE_INTERVAL.subtractDate( expires ) );
    }

    async _getMeta () {
        const meta = {};

        for ( const name of Object.keys( this.#certificates ).sort() ) {
            const data = this.#certificates[ name ];

            const record = {
                "domains": data.domains.sort( Hostname.compare ),
                "expires": data.expires,
                "fingerprint": data.fingerprint,
            };

            meta[ name ] = record;
        }

        return result( 200, meta );
    }

    // private
    async #getCertificates () {
        if ( !cloudflareApi ) return result( [ 500, "Cloudflare API not defined" ] );

        const acme = new Acme( {
            "test": false,
            "email": "root@softvisio.net",
            "accountKey": null,
        } );

        this.#certificates = structuredClone( CERTIFICATES );

        for ( const name in this.#certificates ) {
            const res = await acme.getCertificate( {
                ...this.#certificates[ name ],
                "createChallenge": this.#createChallenge.bind( this ),
                "deleteChallenge": this.#deleteChallenge.bind( this ),
            } );

            if ( !res.ok ) return res;

            this.#certificates[ name ] = {
                ...this.#certificates[ name ],
                ...res.data,
            };
        }

        return result( 200 );
    }

    async #createChallenge ( { type, domain, dnsTxtRecordName, httpLocation, token, content } ) {
        if ( type !== "dns-01" ) return result( 500 );

        var res;

        // get zone
        res = await this.#getDomainZone( domain );
        if ( !res.ok ) return res;

        const zone = res.data;

        // delete record, if exists
        await this.#deleteDnsRecord( dnsTxtRecordName, zone );

        // create record
        res = await cloudflareApi.createDnsRecord( zone.id, {
            "type": "TXT",
            "name": dnsTxtRecordName,
            content,
            "ttl": 60,
        } );
        if ( !res.ok ) return res;

        return result( 200, {
            "dnsTtl": res.data.ttl,
        } );
    }

    async #deleteChallenge ( { type, domain, dnsTxtRecordName, token, httpLocation } ) {
        if ( type !== "dns-01" ) return false;

        var res;

        // get zone
        res = await this.#getDomainZone( domain );
        if ( !res.ok ) return;

        const zone = res.data;

        await this.#deleteDnsRecord( dnsTxtRecordName, zone );
    }

    async #getDomainZone ( domain ) {
        const res = await cloudflareApi.getZones();
        if ( !res.ok ) return res;

        for ( const zone of res.data ) {
            if ( domain === zone.name || domain.endsWith( `.${ zone.name }` ) ) {
                return result( 200, zone );
            }
        }

        return result( [ 404, "Domain zone not found" ] );
    }

    async #deleteDnsRecord ( dnsTxtRecordName, zone ) {
        var res;

        // get records
        res = await cloudflareApi.getDnsRecords( zone.id );
        if ( !res.ok ) return;

        // delete record
        for ( const record of res.data ) {
            if ( record.type !== "TXT" ) continue;

            if ( record.name !== dnsTxtRecordName ) continue;

            res = await cloudflareApi.deleteDnsRecord( zone.id, record.id );

            return;
        }
    }
}
