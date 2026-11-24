import Table from "#lib/text/table";
import Argument from "./argument.js";
import { markdownToString, throwSpecError } from "./utils.js";

export default class CliArguments {
    #items = {};
    #currentPosition = 0;
    #order = [];
    #helpUsage;
    #help;

    constructor ( cli, config ) {
        if ( !config ) return;

        let hasOptionalArguments, hasSlurpingArgument;

        for ( const name in config ) {
            const argument = new Argument( cli, name, config[ name ] );

            // slurping argument must be last
            if ( hasSlurpingArgument ) {
                throwSpecError( `Argument "${ name }" can not be placed after slurping arguments.` );
            }

            if ( argument.isRequired ) {

                // required argument can not be placed after optional arguments
                if ( hasOptionalArguments ) {
                    throwSpecError( `Required argument "${ name }" must be placed begore optional arguments.` );
                }
            }
            else {
                hasOptionalArguments = true;
            }

            // slurping argument
            if ( argument.isArray && !argument.maxItems ) {
                hasSlurpingArgument = true;
            }

            this.#items[ name ] = argument;
            this.#order.push( argument );
        }
    }

    // public
    addValue ( value ) {
        const errors = [],
            argument = this.#order[ this.#currentPosition ];

        if ( !argument ) {
            errors.push( `Unexpected argument "${ value }"` );
        }
        else {
            if ( argument.isArray ) {
                if ( argument.canAddValue() ) {
                    errors.push( ...argument.addValue( value ) );
                }
                else {
                    this.#currentPosition++;

                    errors.push( ...this.addValue( value ) );
                }
            }
            else {
                errors.push( ...argument.addValue( value ) );

                this.#currentPosition++;
            }
        }

        return errors;
    }

    validate () {
        const errors = [];

        for ( const name in this.#items ) {
            errors.push( ...this.#items[ name ].validate() );
        }

        return errors;
    }

    getValues () {
        const values = {};

        for ( const name in this.#items ) {
            values[ name ] = this.#items[ name ].value;
        }

        return values;
    }

    getHelpUsage () {
        if ( this.#helpUsage == null ) {
            const usage = [];

            for ( const name in this.#items ) {
                usage.push( this.#items[ name ].getHelpUsage() );
            }

            if ( usage.length ) {
                this.#helpUsage = " " + usage.join( " " );
            }
            else {
                this.#helpUsage = "";
            }
        }

        return this.#helpUsage;
    }

    getHelp () {
        if ( this.#help == null ) {
            let maxLength = 0;

            // index max length
            for ( const name in this.#items ) {
                const length = this.#items[ name ].getHelpSpec().length;

                if ( length > maxLength ) maxLength = length;
            }

            if ( !maxLength ) {
                this.#help = "";
            }
            else {
                const table = new Table( {
                    "ansi": process.stdout,
                    "width": process.stdout,
                    "style": "borderless",
                    "header": false,
                    "columns": {
                        "spec": { "width": maxLength + 6, "margin": [ 2, 4 ] },
                        "desc": { "flex": 1 },
                    },
                } );

                for ( const name in this.#items ) {
                    const option = this.#items[ name ],
                        spec = option.getHelpSpec(),
                        desc = option.getHelpDescription();

                    table.write( { spec, desc } );
                }

                table.end();

                this.#help = markdownToString( "**Arguments**:" ) + "\n" + table.content;
            }
        }

        return this.#help;
    }
}
