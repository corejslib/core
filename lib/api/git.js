import "#lib/result";
import childProcess from "node:child_process";
import { pipeline, Readable } from "node:stream";
import env from "#lib/env";
import SemanticVersion from "#lib/semantic-version";
import Counter from "#lib/threads/counter";
import uuid from "#lib/uuid";
import GitChanges from "./git/changes.js";
import GitCommit from "./git/commit.js";
import GitRelease from "./git/release.js";
import GitReleases from "./git/releases.js";
import GitUpstream from "./git/upstream.js";

const SEMANTIC_VERSION_GLOB_PATTERN = "v[0-9]*.[0-9]*.[0-9]*";

export default class Git {
    #root;
    #upstreams = {};

    constructor ( root ) {
        this.#root = root;
    }

    // static
    static get Upstream () {
        return GitUpstream;
    }

    static new ( root ) {
        root = env.findGitRoot( root );

        if ( !root ) throw new Error( "Git root not found" );

        return new this( root );
    }

    // properties
    get root () {
        return this.#root;
    }

    get upstream () {
        return this.getUpstreamSync( "origin" );
    }

    // public
    async exec ( args, { cwd, encoding, input } = {} ) {
        if ( !Array.isArray( args ) ) args = [ args ];

        if ( this.#root ) cwd ??= this.#root;

        return new Promise( resolve => {
            try {
                const proc = childProcess.spawn( "git", args, {
                    cwd,
                    "encoding": "buffer",
                    "stdio": [ input
                        ? "pipe"
                        : "ignore", "pipe", "pipe" ],
                } );

                const stdout = [],
                    stderr = [];

                proc.once( "error", e => resolve( result( [ 500, e.message ] ) ) );

                proc.stdout.on( "data", data => stdout.push( data ) );

                proc.stderr.on( "data", data => stderr.push( data ) );

                proc.once( "close", code => {
                    var res;

                    if ( code ) {
                        res = result( [ 500, Buffer.concat( stderr ).toString() ] );
                    }
                    else {
                        let data = Buffer.concat( stdout );

                        if ( encoding !== "buffer" ) {
                            data = data.toString( encoding || "utf8" );
                        }

                        res = result( 200, data );
                    }

                    resolve( res );
                } );

                if ( input ) {
                    if ( input instanceof Readable ) {
                        pipeline( input, proc.stdin, e => {
                            if ( e ) {
                                resolve( result( [ 500, e.message ] ) );

                                proc.kill( "SIGKILL" );
                            }
                        } );
                    }
                    else {
                        proc.stdin.write( input );
                        proc.stdin.end();
                    }
                }
            }
            catch ( e ) {
                resolve( result( [ 500, e.message ] ) );
            }
        } );
    }

    execSync ( args, { cwd, encoding, input } = {} ) {
        if ( !Array.isArray( args ) ) args = [ args ];

        if ( this.#root ) cwd ??= this.#root;

        try {
            const res = childProcess.spawnSync( "git", args, {
                cwd,
                "encoding": "buffer",
                "maxBuffer": Infinity,
                input,
                "stdio": [ input
                    ? "pipe"
                    : "ignore", "pipe", "pipe" ],
            } );

            if ( res.status ) {
                return result( [ 500, res.stderr.toString() ] );
            }
            else if ( res.error ) {
                return result( [ 500, res.error.message ], res.stderr.toString() );
            }
            else {
                return result( 200, encoding === "buffer"
                    ? res.stdout
                    : res.stdout.toString( encoding || "utf8" ) );
            }
        }
        catch ( e ) {
            return result.catch( e, { "log": false } );
        }
    }

    getUpstreamSync ( name ) {
        name ||= "origin";

        if ( this.#upstreams[ name ] === undefined ) {
            this.#upstreams[ name ] = null;

            const res = this.execSync( [ "config", "get", `remote.${ name }.url` ] );

            if ( res.ok && res.data ) {
                this.#upstreams[ name ] = new GitUpstream( res.data.trim() );
            }
        }

        return this.#upstreams[ name ];
    }

    async getStatus ( { branchStatus } = {} ) {
        const status = {

                // head commit
                "head": null,

                // version
                "previousRelease": null,
                "previousReleaseDistance": null,

                // state
                "isDirty": null,
                "branchStatus": null,

                // releases
                "releases": null,
            },
            counter = new Counter();

        var error;

        // get release and release distance
        counter.value++;
        this.getPreviousRelease().then( res => {
            if ( res.ok ) {
                status.head = res.data.commit;
                status.releases = res.data.releases;
                status.previousRelease = res.data.previousRelease;
                status.previousReleaseDistance = res.data.previousReleaseDistance;
            }
            else {
                error = res;
            }

            counter.value--;
        } );

        // get dirty status
        counter.value++;
        this.getWorkingTreeStatus().then( res => {
            if ( !res.ok ) {
                error = res;
            }
            else {
                status.isDirty = res.data.isDirty;
            }

            counter.value--;
        } );

        // get branch status
        if ( branchStatus ) {
            counter.value++;
            this.getBranchStatus().then( res => {
                if ( !res.ok ) {
                    error = res;
                }
                else {
                    status.branchStatus = res.data;
                }

                counter.value--;
            } );
        }

        await counter.wait();

        if ( error ) {
            return error;
        }
        else {
            return result( 200, status );
        }
    }

    async getBuildVersion ( { commitRef } = {} ) {
        var res;

        // get commit and release
        res = await this.getPreviousRelease( { commitRef } );
        if ( !res.ok ) return res;
        const previousRelease = res.data;

        var version = ( previousRelease.previousRelease || SemanticVersion.initialVersion ).versionString;

        version += "+" + previousRelease.commit.abbrev;

        if ( previousRelease.previousReleaseDistance ) {
            version += "." + previousRelease.previousReleaseDistance;
        }

        // get dirty status
        res = await this.getWorkingTreeStatus();
        if ( !res.ok ) return res;
        const dirtyStatus = res.data;

        if ( dirtyStatus.isDirty ) {
            version += ".dirty";
        }

        return result( 200, {
            version,
            "commit": previousRelease.commit,
            "isDirty": dirtyStatus.isDirty,
        } );
    }

    async getWorkingTreeStatus () {
        const res = await this.exec( [ "status", "-z", "--no-renames", "--untracked-files=all" ] );

        if ( !res.ok ) {
            return res;
        }
        else {
            const data = {
                "isDirty": false,
                "files": {},
            };

            for ( const line of res.data.split( "\0" ) ) {
                if ( !line ) continue;

                const match = line.match( /^(?<index>.)(?<workingTree>.) (?<file>.+)$/ );

                if ( !match ) throw new Error( `Failed to parse git status: "${ line }"` );

                const index = match.groups.index.trim(),
                    workingTree = match.groups.workingTree.trim();

                data.files[ match.groups.file ] = {
                    index,
                    workingTree,
                };

                if ( index !== "!" ) {
                    data.isDirty = true;
                }

                if ( workingTree !== "!" ) {
                    data.isDirty = true;
                }
            }

            return result( 200, data );
        }
    }

    async getPreviousRelease ( { commitRef, stable, changes } = {} ) {
        commitRef = this.#resolveCommitRef( commitRef ) || "HEAD";

        var res;

        // identify commit
        res = await this.getCommit( { commitRef } );
        if ( !res.ok ) return res;
        const commit = res.data;
        if ( !commit ) return result( [ 404, "Commit not found" ] );

        // get releases
        res = await this.getReleases();
        if ( !res.ok ) return res;
        const releases = res.data;

        const data = {
            commit,
            "previousRelease": null,
            "previousReleaseDistance": 0,
            releases,
            "changes": null,
        };

        // commit is release
        if ( commit.isRelease ) {
            if ( stable ) {
                if ( commit.releaseVersion.isStableRelease ) {
                    data.previousRelease = releases.get( commit.releaseVersion );
                }
            }
            else {
                data.previousRelease = releases.get( commit.releaseVersion );
            }
        }

        // find current release, respect stable
        if ( !data.previousRelease ) {
            res = await this.#findPreviousRelease( {
                "commitRef": commit.hash,
                stable,
            } );
            if ( !res.ok ) return res;

            // current release found
            if ( res.data ) {
                data.previousRelease = releases.get( res.data.version );
                data.previousReleaseDistance = res.data.distance;
            }
            else {
                res = await this.getCommitsDistance( commit.hash );
                if ( !res.ok ) return res;

                data.previousReleaseDistance = res.data;
            }
        }

        // get changes
        if ( changes ) {
            res = await this.getChanges( [ data.previousRelease, commit.hash ] );
            if ( !res.ok ) return res;

            data.changes = res.data;
        }

        return result( 200, data );
    }

    async getReleasesRange ( { commitRef, stable, changes } = {} ) {
        commitRef = this.#resolveCommitRef( commitRef ) || "HEAD";

        var res;

        // identify commit
        res = await this.getCommit( { commitRef } );
        if ( !res.ok ) return res;
        const commit = res.data;
        if ( !commit ) return result( [ 400, "Commit not found" ] );

        // get releases
        res = await this.getReleases();
        if ( !res.ok ) return res;
        const releases = res.data;

        const data = {
            commit,
            "startRelease": null,
            "endRelease": null,
            releases,
            "changes": null,
        };

        var offset = "";

        // commit is release
        if ( commit.isRelease ) {
            data.endRelease = releases.get( commit.releaseVersion );

            // exclude current release
            offset = "~1";
        }

        // commit is not a branch HEAD
        else if ( !commit.isBranchHead ) {
            return result( [ 400, "Commit should be a branch head or a semantic version tag name" ] );
        }

        // find previous release, respect stable
        res = await this.#findPreviousRelease( {
            "commitRef": commit.hash + offset,
            stable,
        } );
        if ( !res.ok ) return res;

        // start release found
        if ( res.data ) {
            data.startRelease = releases.get( res.data.version );
        }

        // get changes
        if ( changes ) {
            res = await this.getChanges( [ data.startRelease, commit.hash + offset ] );
            if ( !res.ok ) return res;

            data.changes = res.data;
        }

        return result( 200, data );
    }

    async getBranchStatus () {
        const data = {},
            res = await this.exec( [ "branch", "--format", "%(refname:short)%00%(upstream:short)%00%(upstream:track)" ] );

        if ( !res.ok ) return res;

        for ( const line of res.data.split( "\n" ) ) {
            if ( !line ) continue;

            const [ branch, upstream, status ] = line.split( "\0" );

            data[ branch ] = {
                "upstream": upstream || null,
                "synchronized": null,
                "ahead": Number( status.match( /ahead (\d+)/ )?.[ 1 ] || 0 ),
                "behind": Number( status.match( /behind (\d+)/ )?.[ 1 ] || 0 ),
            };

            if ( data[ branch ].upstream ) {
                if ( data[ branch ].ahead || data[ branch ].behind ) {
                    data[ branch ].synchronized = false;
                }
                else {
                    data[ branch ].synchronized = true;
                }
            }
        }

        return result( 200, data );
    }

    async getTags () {
        const res = await this.getCommits( null, { "tags": true } );
        if ( !res.ok ) return res;

        const commits = res.data,
            tags = {};

        if ( commits ) {
            for ( const commit of commits ) {
                for ( const tag of commit.tags ) {
                    tags[ tag ] = commit;
                }
            }
        }

        return result( 200, tags );
    }

    async getReleases () {
        const res = await this.exec( [ "tag", "--list", SEMANTIC_VERSION_GLOB_PATTERN, "--format", "%(refname:strip=2)%00%(creatordate:iso)" ] );

        if ( res.ok ) {
            const tags = res.data
                .split( "\n" )
                .filter( line => line )
                .map( line => {
                    const [ version, date ] = line.split( "\0" );

                    return {
                        version,
                        date,
                    };
                } );

            return result( 200, new GitReleases( tags ) );
        }
        else {
            return res;
        }
    }

    async getCommit ( { commitRef } = {} ) {
        const res = await this.getCommits( commitRef, { "maxCount": 1 } );

        if ( !res.ok ) return res;

        res.data = res.data?.[ 0 ];

        return res;
    }

    async getCommits ( commitsRange, { maxCount, tags } = {} ) {
        commitsRange = this.#createCommitsRange( commitsRange );

        // prepare git command
        const rowsSeparator = uuid(),
            separator = uuid(),
            decorateSeparator = uuid(),
            tagId = uuid(),
            args = [ "log", `--pretty=format:%H${ separator }%h${ separator }%cI${ separator }%cN${ separator }%(decorate:prefix=,suffix=,pointer=->,tag=${ tagId },separator=${ decorateSeparator })${ separator }%P${ separator }%B${ rowsSeparator }` ];

        if ( tags ) args.push( "--tags", "--no-walk" );

        if ( maxCount ) args.push( "--max-count", maxCount );

        args.push( commitsRange );

        const res = await this.exec( args );

        if ( !res.ok ) {

            // no commits found
            if ( res.statusText.includes( "does not have any commits yet" ) || res.statusText.includes( "unknown revision or path not in the working tree" ) ) {
                return result( 200 );
            }
            else {
                return res;
            }
        }

        const commits = [];

        if ( res.data ) {
            for ( const commit of res.data.split( rowsSeparator ) ) {
                const [ hash, abbrev, date, author, refsSegment, parentHashes, message ] = commit.trim().split( separator );

                if ( !hash ) continue;

                const data = {
                    "message": message.trim(),
                    hash,
                    abbrev,
                    date,
                    author,
                    "isHead": false,
                    "branch": null,
                    "branches": new Set(),
                    "tags": new Set(),
                    "parentHashes": new Set( parentHashes.split( " " ) ),
                };

                // parse refs
                const refs = refsSegment.split( decorateSeparator );

                for ( let n = 0; n < refs.length; n++ ) {
                    const ref = refs[ n ].trim();

                    if ( !ref ) continue;

                    // first ref
                    if ( n === 0 ) {

                        // HEAD
                        if ( ref === "HEAD" ) {
                            data.isHead = true;

                            continue;
                        }

                        // HEAD->branch
                        else if ( ref.startsWith( "HEAD->" ) ) {
                            data.isHead = true;
                            data.branch = ref.slice( 6 );

                            data.branches.add( data.branch );

                            continue;
                        }
                    }

                    // tag
                    if ( ref.startsWith( tagId ) ) {
                        data.tags.add( ref.slice( tagId.length ) );
                    }

                    // branch
                    else {
                        data.branches.add( ref );
                    }
                }

                commits.push( new GitCommit( data ) );
            }
        }

        return result( 200, commits.length
            ? commits
            : null );
    }

    async getCommitsDistance ( commitsRange ) {
        commitsRange = this.#createCommitsRange( commitsRange );

        const res = await this.exec( [ "rev-list", "--count", commitsRange ] );
        if ( !res.ok ) return res;

        return result( 200, Number( res.data.trim() ) );
    }

    async getChanges ( commitsRange ) {
        const res = await this.getCommits( commitsRange );
        if ( !res.ok ) return res;

        return result( 200, new GitChanges( res.data ) );
    }

    // private
    #resolveCommitRef ( commitRef ) {
        if ( !commitRef ) {
            return;
        }
        else if ( commitRef instanceof SemanticVersion ) {
            return commitRef.versionString;
        }
        else if ( commitRef instanceof GitRelease ) {
            return commitRef.versionString;
        }
        else if ( commitRef instanceof GitCommit ) {
            return commitRef.hash;
        }
        else {
            return commitRef;
        }
    }

    #createCommitsRange ( commitsRange ) {
        var firstCommit, lastCommit;

        if ( Array.isArray( commitsRange ) ) {
            [ firstCommit, lastCommit ] = commitsRange;
        }
        else {
            lastCommit = commitsRange;
        }

        // prepare start commit
        firstCommit = this.#resolveCommitRef( firstCommit );
        if ( SemanticVersion.isValid( firstCommit ) ) {
            firstCommit = SemanticVersion.new( firstCommit ).versionString;
        }

        // prepare end commit
        lastCommit = this.#resolveCommitRef( lastCommit );
        if ( SemanticVersion.isValid( lastCommit ) ) {
            lastCommit = SemanticVersion.new( lastCommit ).versionString;
        }

        // prepare commits range
        if ( firstCommit && lastCommit ) {
            commitsRange = `${ firstCommit }..${ lastCommit }`;
        }
        else if ( firstCommit && !lastCommit ) {
            commitsRange = `${ firstCommit }..HEAD`;
        }
        else if ( !firstCommit && lastCommit ) {
            commitsRange = lastCommit;
        }
        else {
            commitsRange = "HEAD";
        }

        return commitsRange;
    }

    async #findPreviousRelease ( { commitRef, stable } ) {
        commitRef = this.#resolveCommitRef( commitRef ) || "HEAD";

        const args = [ "describe", "--tags", "--long", "--candidates=1000" ];

        if ( stable ) {
            args.push( "--match", SEMANTIC_VERSION_GLOB_PATTERN, "--exclude", "v*[!0-9.]*" );
        }
        else {
            args.push( "--match", SEMANTIC_VERSION_GLOB_PATTERN );
        }

        args.push( commitRef );

        const res = await this.exec( args );

        if ( !res.ok ) {

            // repository has no commits
            if ( res.statusText.startsWith( "fatal: Not a valid object name" ) ) {
                return result( 200 );
            }

            // no tags found
            else if ( res.statusText.startsWith( "fatal: No names found, cannot describe anything" ) ) {
                return result( 200 );
            }

            // commit has no tags in anchestors
            else if ( res.statusText.startsWith( "fatal: No tags can describe" ) ) {
                return result( 200 );
            }

            // error
            else {
                return res;
            }
        }

        const match = res.data.trim().match( /^(?<version>v\d+\.\d+\.\d+.*)-(?<distance>\d+)-g(?<abbrev>[\da-f]+)$/ );

        if ( !match || !SemanticVersion.isValid( match.groups.version ) ) {
            return result( [ 500, "Git describe parsing error" ] );
        }
        else {
            return result( 200, {
                "version": new SemanticVersion( match.groups.version ),
                "distance": Number( match.groups.distance ),
                "abbrev": match.groups.abbrev,
            } );
        }
    }
}
