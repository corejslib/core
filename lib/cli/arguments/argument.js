import Option from "../option.js";

export default class CliArgument extends Option {
    #startPosition;
    #endPosition;
    #helpUsage;
    #helpSpec;

    constructor ( cli, name, config, startPosition ) {
        super( cli, name, config );

        this.#startPosition = startPosition;

        if ( this.maxItems ) this.#endPosition = this.#startPosition + this.maxItems;
    }

    // properties
    get isArgument () {
        return true;
    }

    get endPosition () {
        return this.#endPosition;
    }

    // public
    getHelpUsage () {
        if ( this.#helpUsage == null ) {
            var usage = `<${ this.name }>`;

            usage += "";

            if ( this.isArray ) {
                usage += "...";
            }

            if ( !this.isRequired ) usage = `[${ usage }]`;

            this.#helpUsage = usage;
        }

        return this.#helpUsage;
    }

    getHelpSpec () {
        if ( this.#helpSpec == null ) {
            var help = `<${ this.name }>`;

            // repeatable
            if ( this.isArray ) {
                help += "...";
            }

            this.#helpSpec = help;
        }

        return this.#helpSpec;
    }
}
