import { pipeline } from "node:stream/promises";
import ExternalRecourceBuilder from "#lib/external-resource-builder";
import { calculateMode } from "#lib/fs";
import SemanticVersion from "#lib/semantic-version";
import tar from "#lib/tar";
import { decompress } from "#lib/zlib";

export default class Ffmpeg extends ExternalRecourceBuilder {
    #release;

    // properties
    get id () {
        return "corejslib/core/resources/ffmpeg-linux";
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

        // unpack
        try {
            await pipeline(
                await decompress( "xz", res.body ),
                tar.extract( {
                    "cwd": location,
                    "strip": 1,
                } )
            );
        }
        catch ( e ) {
            return result.fromError( e, { "log": false } );
        }

        return result( 200, {
            onWriteEntry ( entry ) {
                if ( entry.path.startsWith( "bin/" ) ) {
                    entry.stat.mode = calculateMode( "rwxr-xr-x" );
                }
            },
        } );
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
                if ( match.groups.platform !== "linux" ) continue;

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
