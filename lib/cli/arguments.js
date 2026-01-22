import Argument from "#lib/cli/arguments/argument";
import Table from "#lib/text/table";
import { prepareHeader } from "./utils.js";

export default class CliArguments {
    #items = {};
    #nextPosition = 0;
    #order = [];
    #helpUsage;
    #help;

    constructor ( args ) {
        if ( !args ) return;

        var lastArgument,
            startPosition = 0;

        for ( const name in args ) {
            const argument = new Argument( name, args[ name ], startPosition );

            if ( lastArgument ) {
                this.#throwSpecError( `Unable to add argument "${ name }" after argument with the unlimited positions.` );
            }

            if ( !argument.endPosition ) lastArgument = true;
            else startPosition = argument.endPosition;

            this.#items[ name ] = argument;
            this.#order.push( argument );
        }
    }

    // public
    addValue ( value ) {
        var errors = [],
            argument = this.#order[ 0 ];

        if ( !argument ) {
            errors.push( `Unexpected argument "${ value }"` );
        }
        else {
            errors.push( ...argument.addValue( value ) );

            this.#nextPosition++;

            if ( argument.endPosition && this.#nextPosition === argument.endPosition ) this.#order.shift();
        }

        return errors;
    }

    validate () {
        var errors = [];

        for ( const name in this.#items ) {
            errors.push( ...this.#items[ name ].validate() );
        }

        return errors;
    }

    getValues () {
        var values = {};

        for ( const name in this.#items ) {
            values[ name ] = this.#items[ name ].value;
        }

        return values;
    }

    getHelpUsage () {
        if ( this.#helpUsage == null ) {
            var usage = [];

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

                this.#help = prepareHeader( "arguments" ) + "\n" + table.content;
            }
        }

        return this.#help;
    }

    // private
    #throwSpecError ( error ) {
        console.log( error );

        process.exit( 2 );
    }
}
