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
            let usage = `<${ this.name }>`;

            if ( this.isRepeatable ) {
                usage += "...";
            }

            if ( !this.isRequired ) {
                usage = `[${ usage }]`;
            }

            this.#helpUsage = usage;
        }

        return this.#helpUsage;
    }

    getHelpSpec () {
        if ( this.#helpSpec == null ) {
            let help = `<${ this.name }>`;

            // repeatable
            if ( this.isReleatable ) {
                help += "...";
            }

            this.#helpSpec = help;
        }

        return this.#helpSpec;
    }
}
