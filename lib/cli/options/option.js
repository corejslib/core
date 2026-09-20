import Option from "../option.js";

export default class CliOption extends Option {
    #short;
    #negatedShort;
    #isNegatable;
    #allowTrue;
    #allowFalse;
    #helpUsage;
    #helpSpec;

    constructor ( cli, name, config ) {
        super( cli, name, config );

        this.#short = config.short;
        this.#negatedShort = config.negatedShort;

        // boolean option
        if ( this.isBoolean ) {
            this.#isNegatable = config.negatable ?? this.default == null;

            if ( this.#isNegatable || this.default === false ) {
                this.#allowTrue = true;
            }

            if ( this.#isNegatable || this.default === true ) {
                this.#allowFalse = true;
            }
        }

        // non-boolean option
        else {
            this.#isNegatable = false;
        }
    }

    // properties
    get isArgument () {
        return false;
    }

    get isBoolean () {
        return this.type === "boolean";
    }

    get isNegatable () {
        return this.#isNegatable;
    }

    get allowTrue () {
        return this.#allowTrue;
    }

    get allowFalse () {
        return this.#allowFalse;
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
                if ( this.isNegatable ) {
                    usage += "--[no-]" + this.name;
                }
                else if ( this.allowTrue ) {
                    usage += "--" + this.name;
                }
                else {
                    usage += "--no-" + this.name;
                }
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

    getHelpSpec ( hasNegatedShorts ) {
        if ( this.#helpSpec == null ) {
            var help = "";

            if ( this.isNegatable ) {
                if ( this.short ) {
                    help += `-${ this.short }, `;
                }
                else {
                    help += " ".repeat( 4 );
                }

                if ( this.negatedShort ) {
                    help += `-${ this.negatedShort }, `;
                }
                else {
                    help += " ".repeat( 4 );
                }
            }
            else {
                if ( this.short || this.negatedShort ) {
                    help += `-${ this.short || this.negatedShort }, `;

                    if ( hasNegatedShorts ) {
                        help += " ".repeat( 4 );
                    }
                }
                else {
                    help += " ".repeat( hasNegatedShorts
                        ? 8
                        : 4 );
                }
            }

            // boolean option
            if ( this.isBoolean ) {
                if ( this.isNegatable ) {
                    help += "--[no-]" + this.name;
                }
                else if ( this.allowTrue ) {
                    help += "--" + this.name;
                }
                else {
                    help += "--no-" + this.name;
                }
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
