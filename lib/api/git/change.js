import GitCommit from "./commit.js";
import GitFooters from "./footers.js";
import GitMessage from "./message.js";

export default class GitChange extends GitMessage {
    #id;
    #isBreakingChange;
    #isReleaseChange;
    #type;
    #scope;
    #subjectText;
    #bodyText;
    #footers = new GitFooters();
    #commits = new Map();
    #firstCommit;
    #lastCommit;
    #authors;
    #links;
    #fixes;

    constructor ( commit ) {
        super();

        this.addCommit( commit );
    }

    // static
    static new ( commit ) {
        if ( commit instanceof this.constructor ) return commit;

        return new this( commit );
    }

    static get compare () {
        return ( a, b ) => this.new( a ).compare( b );
    }

    // properties
    get id () {
        return this.#id;
    }

    get isBreakingChange () {
        return this.#isBreakingChange;
    }

    get isReleaseChange () {
        return this.#isReleaseChange;
    }

    get type () {
        return this.#type;
    }

    get scope () {
        return this.#scope;
    }

    get subjectText () {
        return this.#subjectText;
    }

    get bodyText () {
        return this.#bodyText;
    }

    get footers () {
        return this.#footers;
    }

    get commits () {
        return this.#commits;
    }

    get firstCommit () {
        return this.#firstCommit;
    }

    get lastCommit () {
        return this.#lastCommit;
    }

    get authors () {
        if ( this.#authors === undefined ) {
            const authors = [];

            for ( const commit of this.#commits.values() ) {
                authors.push( ...commit.authors );
            }

            this.#authors = new Set( authors.sort() );
        }

        return this.#authors;
    }

    get links () {
        if ( this.#links === undefined ) {
            const links = [];

            for ( const commit of this.#commits.values() ) {
                links.push( ...commit.links );
            }

            this.#links = new Set( links.sort( this.constructor.compareLinks ) );
        }

        return this.#links;
    }

    get fixes () {
        if ( this.#fixes === undefined ) {
            const links = [];

            for ( const commit of this.#commits.values() ) {
                links.push( ...commit.fixes );
            }

            this.#fixes = new Set( links.sort( this.constructor.compareLinks ) );
        }

        return this.#fixes;
    }

    // public
    addCommit ( commit ) {
        commit = GitCommit.new( commit );

        if ( !this.#id ) {
            this.#id = commit.changeId;
            this.#firstCommit = commit;
            this.#lastCommit = commit;
            this.#isBreakingChange = commit.isBreakingChange;
            this.#isReleaseChange = commit.isRelease;
            this.#type = commit.type;
            this.#scope = commit.scope;
            this.#subjectText = commit.subjectText;
        }
        else if ( this.#id !== commit.changeId ) {
            throw new Error( "Commit is not related to the change" );
        }
        else {
            if ( this.#firstCommit.date > commit.date ) {
                this.#firstCommit = commit;
            }

            if ( this.#lastCommit.date < commit.date ) {
                this.#lastCommit = commit;
            }
        }

        this.#commits.set( commit.hash, commit );

        if ( commit.breakingChangePriority < this.breakingChangePriority ) {
            this.#isBreakingChange = commit.isBreakingChange;

            this._clearCache();
        }

        if ( commit.typePriority < this.typePriority ) {
            this.#type = commit.type;

            this._clearCache();
        }

        if ( commit.isRelease ) {
            this.#isReleaseChange = commit.isRelease;
        }

        if ( !this.body ) {
            this.#bodyText = commit.bodyText;
            this.#footers = commit.footers;

            this._clearCache();
        }
    }

    compare ( change ) {
        change = this.constructor.new( change );

        return super.compare( change );
    }

    // protected
    _clearCache () {
        this.#authors = undefined;
        this.#links = undefined;
        this.#fixes = undefined;

        super._clearCache();
    }
}
