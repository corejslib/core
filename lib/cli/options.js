import Option from "#lib/cli/options/option";
import Table from "#lib/text/table";
import { prepareHeader } from "./utils.js";

export default class CliOptions {
    #global;
    #items = {};
    #shorts = {};
    #hasNegatedShorts;
    #helpUsage;
    #help;

    constructor ( options, globalOptions ) {
        this.#global = !globalOptions;

        if ( !options ) return;

        for ( const name in options ) {
            if ( options[ name ] == null ) continue;

            const option = new Option( name, options[ name ] );

            this.#items[ name ] = option;

            if ( globalOptions?.getOption( name ) ) {
                this.#throwSpecError( `Option "${ name }" is conflicted with the global options.` );
            }

            if ( option.isBoolean ) {
                if ( option.short && !option.allowTrue ) {
                    this.#throwSpecError( `Option "${ name }" can not have "short" property.` );
                }

                if ( option.negatedShort && !option.allowFalse ) {
                    this.#throwSpecError( `Option "${ name }" can not have "negatedShort" property.` );
                }
            }
            else {
                if ( option.isNegatable != null ) {
                    this.#throwSpecError( `Option "${ name }" can not have "negatable" property.` );
                }

                if ( option.negatedShort ) {
                    this.#throwSpecError( `Option "${ name }" can not have "negatedShort" property.` );
                }
            }

            for ( const short of [ "short", "negatedShort" ] ) {
                if ( option[ short ] ) {

                    // short option name is already defined
                    if ( this.#shorts[ option[ short ] ] ) {
                        this.#throwSpecError( `Short option "${ option[ short ] }" is not unique.` );
                    }
                    else {
                        this.#shorts[ option[ short ] ] = option;
                    }

                    if ( globalOptions?.getOption( option[ short ] ) ) {
                        this.#throwSpecError( `Short option "${ option[ short ] }" is conflicted with the global options.` );
                    }
                }
            }

            if ( option.isNegatable && option.negatedShort ) {
                this.#hasNegatedShorts = true;
            }
        }

        // check conflicts
        for ( const name in options ) {

            // check option started with "no-" not conflicted with boolean false options
            if ( name.startsWith( "no-" ) ) {
                const option = this.#items[ name.slice( 3 ) ];

                if ( option?.allowFalse ) {
                    this.#throwSpecError( `Option "${ name }" is conflicted with the option "${ option.name }"` );
                }

                const globalOption = globalOptions?.getOption( name.slice( 3 ) );

                if ( globalOption?.allowFalse ) {
                    this.#throwSpecError( `Option "${ name }" is conflicted with the global option "${ globalOption.name }"` );
                }
            }
        }
    }

    // properties
    get isGlobal () {
        return this.#global;
    }

    // public
    getOption ( name ) {
        return this.#items[ name ] || this.#shorts[ name ];
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
            var maxLength = 0;

            // index max length
            for ( const name in this.#items ) {
                const length = this.#items[ name ].getHelpSpec( this.#hasNegatedShorts ).length;

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
                        spec = option.getHelpSpec( this.#hasNegatedShorts ),
                        desc = option.getHelpDescription();

                    table.write( { spec, desc } );
                }

                table.end();

                if ( this.#global ) {
                    this.#help = prepareHeader( "global options" ) + "\n";
                }
                else {
                    this.#help = prepareHeader( "options" ) + "\n";
                }

                this.#help += table.content;

                if ( this.#hasNegatedShorts ) {
                    this.#help += "\n* second short option, if present, sets boolean option to false\n";
                }
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
