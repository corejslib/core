import SemanticVersion from "#lib/semantic-version";

export default class GitRelease extends SemanticVersion {
    #date;

    constructor ( version, { date } = {} ) {
        super( version );

        if ( date ) {
            this.#date = new Date( date );
        }
        else {
            this.#date = new Date();
        }
    }

    // properties
    get date () {
        return this.#date;
    }

    get changelogDate () {
        return this.#date.toISOString().slice( 0, 10 );
    }

    // public
    [ Symbol.for( "nodejs.util.inspect.custom" ) ] ( depth, options, inspect ) {
        const spec = {
            "version": this.versionString,
            "date": this.#date,
        };

        return `${ this.constructor.name }: ${ inspect( spec ) }`;
    }
}
