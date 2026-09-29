import childProcess from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import ExternalRecourceBuilder from "#lib/external-resource-builder";
import SemanticVersion from "#lib/semantic-version";
import { TmpDir } from "#lib/tmp";

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
        const release = await this.#getRelease(),
            tmpDir = new TmpDir();

        await fs.promises.mkdir( tmpDir.path, { "recursive": true } );

        const res = childProcess.spawnSync( fileURLToPath( import.meta.resolve( "#resources/build-ffmpeg-win32.sh" ) ), {
            "cwd": tmpDir.path,
            "stdio": "inherit",
            "env": {
                ...process.env,
                "FFMPEG_REF": release.tag,
                "FFMPEG_BUILD_DIR": tmpDir.path,
            },
        } );
        if ( res.error ) throw res.error;

        await fs.promises.cp( `${ tmpDir }/bin/ffmpeg.exe`, `${ location }/ffmpeg.exe` );
        await fs.promises.cp( `${ tmpDir }/bin/ffprobe.exe`, `${ location }/ffprobe.exe` );

        return result( 200 );
    }

    async _getMeta () {
        const release = await this.#getRelease();

        return result( 200, {
            "version": release.version.version,
        } );
    }

    // private
    async #getRelease () {
        if ( this.#release ) return this.#release;

        const res = await this.gitHubApi.listTags( "ffmpeg/ffmpeg" );
        if ( !res.ok ) throw res;

        this.#release = {
            "tag": null,
            "version": null,
        };

        for ( const tag of res.data ) {
            const ref = tag.ref.replace( "refs/tags/", "" );

            if ( ref[ 0 ] !== "n" ) continue;

            const version = new SemanticVersion( ref.slice( 1 ) );

            if ( version.isPreRelease ) continue;

            if ( !this.#release.version || version.gt( this.#release.version ) ) {
                this.#release.tag = tag.ref.replace( "refs/tags/", "" );
                this.#release.version = version;
            }
        }

        return this.#release;
    }
}
