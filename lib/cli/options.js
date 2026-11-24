import Option from "#lib/cli/options/option";
import Table from "#lib/text/table";
import { markdownToString, removeAnsi, throwSpecError } from "./utils.js";

export default class CliOptions {
    #cli;
    #global;
    #items = {};
    #names = {};
    #twoShortsColumns = false;
    #helpUsage;
    #help;

    constructor ( cli, { options, globalOptions } ) {
        this.#cli = cli;

        this.#global = !globalOptions;

        if ( !options ) return;

        const shorts = {};

        for ( const name in options ) {
            if ( options[ name ] == null ) continue;

            const option = new Option( this.#cli, name, options[ name ] );

            this.#items[ name ] = option;
            this.#names[ name ] = option;

            if ( globalOptions?.getOption( name ) ) {
                throwSpecError( `Option "${ name }" is conflicted with the global options.` );
            }

            // process short options
            for ( const shortProperty of [ "short", "negatedShort" ] ) {
                if ( option[ shortProperty ] ) {
                    shorts[ shortProperty ] = true;

                    if ( option[ shortProperty ] === option.name ) continue;

                    // short option name is already used
                    if ( this.#names[ option[ shortProperty ] ] ) {
                        throwSpecError( `Short option "${ option[ shortProperty ] }" is not unique.` );
                    }
                    else {
                        this.#names[ option[ shortProperty ] ] = option;
                    }

                    if ( globalOptions?.getOption( option[ shortProperty ] ) ) {
                        throwSpecError( `Short option "${ option[ shortProperty ] }" is conflicted with the global options.` );
                    }
                }
            }
        }

        // check conflicts
        for ( const name in options ) {

            // check option started with "no-" not conflicted with boolean false options
            if ( name.startsWith( "no-" ) ) {
                const option = this.#items[ name.slice( 3 ) ];

                if ( option ) {
                    throwSpecError( `Option "${ name }" is conflicted with the option "${ option.name }"` );
                }

                const globalOption = globalOptions?.getOption( name.slice( 3 ) );

                if ( globalOption ) {
                    throwSpecError( `Option "${ name }" is conflicted with the global option "${ globalOption.name }"` );
                }
            }
        }

        this.#twoShortsColumns = shorts.short && shorts.negatedShort;
    }

    // properties
    get isGlobal () {
        return this.#global;
    }

    // public
    getOption ( name ) {
        return this.#names[ name ];
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
                const length = removeAnsi( this.#items[ name ].getHelpSpec( this.#twoShortsColumns ) ).length;

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
                        spec = option.getHelpSpec( this.#twoShortsColumns ),
                        desc = option.getHelpDescription();

                    table.write( { spec, desc } );
                }

                table.end();

                if ( this.#global ) {
                    this.#help = markdownToString( "**Global options**:" ) + "\n";
                }
                else {
                    this.#help = markdownToString( "**Options**:" ) + "\n";
                }

                this.#help += table.content;

                if ( this.#twoShortsColumns ) {
                    this.#help += "\n* " + markdownToString( "If present, the second short form sets the boolean option to `off`." ) + "\n";
                }
            }
        }

        return this.#help;
    }
}
