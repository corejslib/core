import fs from "node:fs";
import path from "node:path";
import ExternalRecourceBuilder from "#lib/external-resource-builder";
import SemanticVersion from "#lib/semantic-version";
import Zip from "#lib/zip";

export default class Ffmpeg extends ExternalRecourceBuilder {
    #release;

    // properties
    get id () {
        return "corejslib/core/resources/ffmpeg-win32";
    }

    // protected
    async _getEtag () {
        const release = await this.#getRelease();

        return result( 200, release.version.versionString );
    }

    async _build ( location ) {
        const release = await this.#getRelease();

        // download
        const res = await this.gitHubApi.downloadReleaseAssetByUrl( release.url );
        if ( !res.ok ) throw res;

        const tmpFile = await res.toTmpFile();

        // unpack
        const zip = new Zip( tmpFile.path );

        for ( const entry of zip.getEntries() ) {
            if ( !entry.name || entry.isDirectory ) continue;

            const entryName = entry.entryName.replace( /^[^\/]+\//v, "" );

            fs.mkdirSync( location + "/" + path.dirname( entryName ), {
                "force": true,
                "recursive": true,
            } );

            fs.writeFileSync( location + "/" + entryName, entry.getData() );
        }

        return result( 200 );
    }

    async _getMeta () {
        const release = await this.#getRelease();

        return result( 200, {
            "version": release.version.version,
            "hash": release.hash,
        } );
    }

    // private
    async #getRelease () {
        if ( this.#release ) return this.#release;

        const res = await this.gitHubApi.listReleases( "btbn/ffmpeg-builds" );
        if ( !res.ok ) throw res;

        const latestRelease = {
            "version": null,
            "hash": null,
            "url": null,
        };

        for ( const release of res.data ) {
            for ( const asset of release.assets ) {
                const match = asset.name.match( /^ffmpeg-n(?<version>[\d.]+(?:-\d+)?)-(?<hash>[^\-]+)-(?<platform>linux|win)64-gpl-[\d.]+.(?<extname>tar\.xz|zip)$/v );

                if ( !match ) continue;
                if ( match.groups.hash === "latest" ) continue;
                if ( match.groups.platform !== "win" ) continue;

                const version = new SemanticVersion( match.groups.version );

                if ( !latestRelease.version || version.gt( latestRelease.version ) ) {
                    latestRelease.version = version;
                    latestRelease.hash = match.groups.hash;
                    latestRelease.url = asset.url;
                }
            }
        }

        this.#release = latestRelease;

        return this.#release;
    }
}
