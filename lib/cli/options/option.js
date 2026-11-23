import Option from "../option.js";

export default class CliOption extends Option {
    #short;
    #negatedShort;
    #helpUsage;
    #helpSpec;

    constructor ( cli, name, config ) {
        super( cli, name, config );

        this.#short = config.short;
        this.#negatedShort = config.negatedShort;
    }

    // properties
    get isArgument () {
        return false;
    }

    get isBoolean () {
        return this.type === "boolean";
    }

    get short () {
        return this.#short;
    }

    get negatedShort () {
        return this.#negatedShort;
    }

    // public
    getHelpUsage () {
        if ( this.#helpUsage == null ) {
            var usage = "[";

            if ( this.short ) {
                usage += "-" + this.short + ", ";
            }

            if ( this.negatedShort ) {
                usage += "-" + this.negatedShort + ", ";
            }

            // boolean option
            if ( this.isBoolean ) {
                usage += "--[no-]" + this.name;
            }

            // non-boolean option
            else {
                usage += "--" + this.name + "[=]<" + this._getHelpType() + ">";
            }

            usage += "]";

            if ( this.isArray ) {
                usage += "...";
            }

            this.#helpUsage = usage;
        }

        return this.#helpUsage;
    }

    getHelpSpec ( twoShortsColumns ) {
        if ( this.#helpSpec == null ) {
            let help = "";

            // two columns
            if ( twoShortsColumns ) {

                // first column
                if ( this.short ) {
                    help += `-${ this.short }, `;
                }
                else {
                    help += " ".repeat( 4 );
                }

                // second column
                if ( this.negatedShort ) {
                    help += `-${ this.negatedShort }, `;
                }
                else {
                    help += " ".repeat( 4 );
                }
            }

            // single column
            else {
                if ( this.short ) {
                    help += `-${ this.short }, `;
                }
                else if ( this.negatedShort ) {
                    help += `-${ this.negatedShort }, `;
                }
                else {
                    help += " ".repeat( 4 );
                }
            }

            // boolean option
            if ( this.isBoolean ) {
                help += "--[no-]" + this.name;
            }

            // non-boolean option
            else {
                help += "--" + this.name + "[=]<" + this._getHelpType() + ">";
            }

            // repeatable
            if ( this.isArray ) {
                help += "...";
            }

            this.#helpSpec = help;
        }

        return this.#helpSpec;
    }
}
