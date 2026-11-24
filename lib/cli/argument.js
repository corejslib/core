import CliItem from "./item.js";

export default class CliArgument extends CliItem {
    #helpUsage;
    #helpSpec;

    // properties
    get isArgument () {
        return true;
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
