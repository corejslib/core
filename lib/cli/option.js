import CliItem from "./item.js";
import { applyFalseStyle, throwSpecError } from "./utils.js";

export default class CliOption extends CliItem {
    #short;
    #negatedShort;
    #helpSpec;

    constructor ( cli, name, config ) {
        super( cli, name, config );

        this.#short = config.short;
        this.#negatedShort = config.negatedShort;

        if ( !this.isBoolean && this.negatedShort ) {
            throwSpecError( `Option "${ this.name }" can not have "negatedShort" property.` );
        }
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
                    help += `-${ applyFalseStyle( this.negatedShort ) }, `;
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
                    help += `-${ applyFalseStyle( this.negatedShort ) }, `;
                }
                else {
                    help += " ".repeat( 4 );
                }
            }

            // boolean option
            if ( this.isBoolean ) {
                help += `--${ applyFalseStyle( "[no-]" ) }${ this.name }`;
            }

            // non-boolean option
            else {
                help += "--" + this.name + "[=]<" + this._getHelpType() + ">";
            }

            // repeatable
            if ( this.isRepeatable ) {
                help += "...";
            }

            this.#helpSpec = help;
        }

        return this.#helpSpec;
    }
}
