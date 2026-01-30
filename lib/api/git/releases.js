import GitRelease from "./release.js";

export default class GitReleases {
    #releases = [];
    #index = {};
    #firstStableRelease;
    #lastStableRelease;
    #firstPreRelease;
    #lastPreRelease;

    constructor ( releases = [] ) {
        this.#releases = releases
            .map( release => {
                try {
                    release = new GitRelease( release.version, {
                        "date": release.date,
                    } );

                    return release;
                }
                catch {}
            } )
            .filter( release => release )
            .sort( GitRelease.compare );

        for ( const release of this.#releases ) {
            this.#index[ release.version ] = release;

            if ( release.isPreRelease ) {
                this.#firstPreRelease ||= release;
                this.#lastPreRelease = release;
            }
            else {
                this.#firstStableRelease ||= release;
                this.#lastStableRelease = release;
            }
        }
    }

    // properties
    get firstRelease () {
        return this.#releases[ 0 ];
    }

    get firstStableRelease () {
        return this.#firstStableRelease;
    }

    get firstPreRelease () {
        return this.#firstPreRelease;
    }

    get lastRelease () {
        return this.#releases.at( -1 );
    }

    get lastStableRelease () {
        return this.#lastStableRelease;
    }

    get lastPreRelease () {
        return this.#lastPreRelease;
    }

    // public
    has ( version ) {
        return Boolean( this.#index[ GitRelease.new( version ).version ] );
    }

    get ( version ) {
        return this.#index[ GitRelease.new( version ).version ];
    }

    canRelease ( version ) {
        version = GitRelease.new( version );

        // check, that new version isn't already released
        if ( this.has( version ) ) {
            return result( [
                500,
                `Version "${ version }" is already released.
You need to merge with the "${ version.versionString }" first.`,
            ] );
        }

        if ( version.isPreRelease ) {

            // check, that pre-release stable version isn't already released
            if ( this.has( version.stableVersion ) ) {
                return result( [
                    500,
                    `Stable version "${ version.stableVersion }" is already released.
Create new pre-release for the released stable version is prohibited.
You need to merge first.`,
                ] );
            }

            // new pre-release must be greater than latest released pre-release for the same stable version
            // for example:
            // we have `1.0.0-a.0` -> `1.0.0-rc.0` released
            // `1.0.0-b.0` release is prohibited
            // because we already have `1.0.0-rc.0` released for the same stable release `1.0.0`
            const latestPreRelease = this.#getLastPreRelease( version );

            if ( latestPreRelease?.gte( version ) ) {
                return result( [
                    500,
                    `New pre-release must be greater then "${ latestPreRelease }", which is already released on the other branch.
You need to merge with the "${ latestPreRelease.versionString }" first.`,
                ] );
            }
        }

        return result( 200 );
    }

    [ Symbol.iterator ] () {
        return this.#releases.values();
    }

    // private
    #getLastPreRelease ( version ) {
        version = GitRelease.new( version );

        var latestPreRelease;

        for ( const release of this.#releases ) {

            // version is the pre-release of the new version
            if ( release.isPreRelease && release.stableVersion.eq( version.stableVersion ) ) {

                // version is the latest pre-release of the new version
                if ( !latestPreRelease || release.gt( latestPreRelease ) ) latestPreRelease = release;
            }
        }

        return latestPreRelease;
    }
}
