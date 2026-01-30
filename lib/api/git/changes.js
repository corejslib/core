import GitChange from "./change.js";
import GitCommit from "./commit.js";

export default class GitChanges {
    #changes = [];
    #firstCommit;
    #lastCommit;

    #breakingChanges = 0;
    #featureChanges = 0;
    #fixChanges = 0;
    #otherChanges = 0;

    constructor ( commits ) {
        const changes = new Map(),
            hashes = new Map();

        commits = ( commits || [] )
            .map( commit => {
                commit = GitCommit.new( commit );

                hashes.set( commit.hash, false );

                return commit;
            } )
            .sort( ( a, b ) => b.date - a.date );

        // process revert / reapply commits
        for ( const commit of commits ) {

            // commit is ignored
            if ( hashes.get( commit.hash ) ) {
                continue;
            }

            // merge commits
            else if ( commit.isMerge ) {
                hashes.set( commit.hash, true );
            }

            // revert commit
            else if ( commit.isRevert ) {

                // revert commit in the current changes set
                if ( commit.revertHash && hashes.has( commit.revertHash ) ) {
                    hashes.set( commit.hash, true );
                    hashes.set( commit.revertHash, true );
                }
            }
        }

        for ( const commit of commits ) {

            // commit is ignored
            if ( hashes.get( commit.hash ) ) continue;

            let change = changes.get( commit.changeId );

            if ( !change ) {
                change = new GitChange( commit );

                changes.set( change.id, change );

                if ( change.isBreakingChange ) this.#breakingChanges++;
                if ( change.isFeature ) this.#featureChanges++;
                if ( change.isFix ) this.#fixChanges++;
                if ( change.isOther ) this.#otherChanges++;
            }
            else {
                change.addCommit( commit );
            }

            if ( this.#firstCommit ) {
                if ( this.#firstCommit.date > change.firstCommit.date ) {
                    this.#firstCommit = change.firstCommit;
                }
            }
            else {
                this.#firstCommit = change.firstCommit;
            }

            if ( this.#lastCommit ) {
                if ( this.#lastCommit.date < change.lastCommit.date ) {
                    this.#lastCommit = change.lastCommit;
                }
            }
            else {
                this.#lastCommit = change.lastCommit;
            }
        }

        this.#changes = [ ...changes.values() ].sort( this.constructor.compare );
    }

    // static
    static get compare () {
        return GitChange.compare;
    }

    // properties
    get firstCommit () {
        return this.#firstCommit;
    }

    get lastCommit () {
        return this.#lastCommit;
    }

    get size () {
        return this.#changes.length;
    }

    get hasChanges () {
        return !!this.#changes.length;
    }

    get hasBreakingChanges () {
        return Boolean( this.#breakingChanges );
    }

    get hasFeatureChanges () {
        return Boolean( this.#featureChanges );
    }

    get hasFixChanges () {
        return Boolean( this.#fixChanges );
    }

    get hasOtherChanges () {
        return Boolean( this.#otherChanges );
    }

    get breakingChanges () {
        return this.#breakingChanges;
    }

    get featureChanges () {
        return this.#featureChanges;
    }

    get fixChanges () {
        return this.#fixChanges;
    }

    get otherChanges () {
        return this.#otherChanges;
    }

    // public
    getChanges ( filter ) {
        return this.#changes.filter( filter );
    }

    [ Symbol.iterator ] () {
        return this.#changes.values();
    }
}
