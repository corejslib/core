import path from "node:path";
import Ajv from "#lib/ajv";
import Arguments from "#lib/cli/arguments";
import Commands from "#lib/cli/commands";
import Options from "#lib/cli/options";
import { prepareHeader } from "#lib/cli/utils";
import { readConfig } from "#lib/config";
import env from "#lib/env";
import { isPlainObject, mergeObjects } from "#lib/utils";

var cliSchema, isParsed;

const defaultGlobalOptions = {
    "globalOptions": {
        "version": {
            "description": "print version",
            "default": false,
            "schema": {
                "type": "boolean",
            },
        },

        "help": {
            "short": "?",
            "description": "print help",
            "default": false,
            "schema": {
                "type": "boolean",
            },
        },
    },
};

export default class Cli {
    #allowPartialCommands;
    #module;
    #argv;
    #commandsStack = [];

    #config;
    #globalOptions;
    #commands;
    #options;
    #arguments;

    constructor ( config, { allowPartialCommands } = {} ) {
        if ( isParsed ) throw new Error( "CLI is alreday parsed" );
        isParsed = true;

        this.#allowPartialCommands = Boolean( allowPartialCommands );

        // init process cli
        process.cli = {
            "globalOptions": {},
            "command": "",
            "options": {},
            "arguments": {},
            "argv": [],
        };

        this.#argv = [];

        let split;

        // prepare argv
        for ( const arg of process.argv.slice( 2 ) ) {
            if ( arg === "--" ) {
                split = true;
            }
            else if ( split ) {
                process.cli.argv.push( arg );
            }
            else {
                this.#argv.push( arg );
            }
        }

        this.#findConfig( config );

        // add default global options
        this.#config = mergeObjects( {}, this.#config, defaultGlobalOptions );

        this.#globalOptions = new Options( this, {
            "options": this.#config.globalOptions,
        } );
    }

    // static
    static async parse ( config, options ) {
        const cli = new this( config, options );

        return cli.#parse();
    }

    // properties
    get allowPartialCommands () {
        return this.#allowPartialCommands;
    }

    get module () {
        return this.#module;
    }

    // private
    async #parse () {

        // validate cli config
        cliSchema ??= new Ajv().addSchema( await readConfig( "#resources/schemas/cli.schema.yaml", { "resolve": import.meta.url } ) );

        // cli config error
        if ( !cliSchema.validate( "config", this.#config ) ) {
            console.log( `CLI config is not valid, inspect errors below:\n${ cliSchema.errors }` );

            process.exit( 2 );
        }

        // process commands
        if ( this.#config.commands ) {
            this.#commands = new Commands( this, this.#config.commands );
            this.#options = null;
            this.#arguments = null;

            const errors = await this.#parseCommands();
            if ( errors ) {
                this.#parseOptions();

                this.#throw( errors );
            }
        }

        // process options
        else {
            this.#commands = null;
            this.#options = new Options( this, {
                "options": this.#config.options,
                "globalOptions": this.#globalOptions,
            } );
            this.#arguments = new Arguments( this, this.#config.arguments );

            let errors = this.#parseOptions( this.#options );
            if ( errors ) this.#throw( errors );

            errors = this.#parseArguments();
            if ( errors ) this.#throw( errors );

            process.cli.command = this.#commandsStack.map( command => command.name ).join( "/" );
        }
    }

    #findConfig ( config ) {
        config ||= {};

        // plain object
        if ( isPlainObject( config ) ) {
            this.#config = config;
            this.#module = null;
        }

        // class instance
        else {

            // .cli() method
            if ( "cli" in config ) {
                let cli = config.cli;

                if ( typeof cli === "function" ) {
                    cli = cli.call( config );
                }

                this.#config = cli || {};
                this.#module = config;
            }

            // static .cli() method
            else if ( "cli" in config.constructor ) {
                let cli = config.constructor.cli;

                if ( typeof cli === "function" ) {
                    cli = cli.call( config.constructor );
                }

                this.#config = cli || {};
                this.#module = config;
            }
            else {
                this.#config = {};
                this.#module = config;
            }
        }
    }

    async #parseCommands () {
        let command;

        // find command
        for ( let n = 0; n < this.#argv.length; n++ ) {
            if ( this.#argv[ n ].startsWith( "-" ) ) continue;

            command = this.#argv[ n ];

            this.#argv.splice( n, 1 );

            break;
        }

        // command not provided
        if ( !command ) {
            return "Command is required.";
        }

        const possibleCommands = this.#commands.getCommand( command );

        // command not found
        if ( Array.isArray( possibleCommands ) ) {

            // no matching commands
            if ( !possibleCommands.length ) {
                return `Command "${ command }" is unknown.`;
            }

            // more than 1 matching command
            else {
                return `Command "${ command }" is ambiguous. Possible commands: ${ possibleCommands.join( ", " ) }.`;
            }
        }

        // command found
        else {
            this.#commandsStack.push( possibleCommands );

            const module = await possibleCommands.getModule();

            this.#findConfig( module );

            this.#config.title ||= possibleCommands.title;

            return this.#parse();
        }
    }

    #parseOptions ( options ) {
        const argv = [],
            errors = [];

        // pre-parse stacked short options
        for ( const arg of this.#argv ) {
            if ( arg === "-" || !arg.startsWith( "-" ) || arg.startsWith( "--" ) ) {
                argv.push( arg );
            }
            else {
                for ( let n = 1; n < arg.length; n++ ) {
                    if ( arg[ n + 1 ] === "=" ) {
                        argv.push( "-" + arg.slice( n ) );

                        break;
                    }
                    else {
                        const shortName = arg[ n ],
                            option = options?.getOption( shortName ) || this.#globalOptions.getOption( shortName );

                        if ( !option ) {
                            argv.push( "-" + shortName );
                        }
                        else if ( option.isBoolean ) {
                            argv.push( "-" + shortName );
                        }
                        else {
                            if ( arg[ n + 1 ] == null ) {
                                argv.push( "-" + shortName );
                            }
                            else {
                                argv.push( "-" + shortName + "=" + arg.slice( n + 1 ) );
                            }

                            break;
                        }
                    }
                }
            }
        }

        this.#argv = [ ...argv ];
        argv.length = 0;

        while ( this.#argv.length ) {
            const arg = this.#argv.shift();

            if ( arg === "-" || !arg.startsWith( "-" ) ) {
                argv.push( arg );
            }
            else {
                let name = arg,
                    isShort,
                    negated,
                    value;

                // long option
                if ( name.startsWith( "--" ) ) {
                    name = name.slice( 2 );

                    // negated long option
                    if ( name.startsWith( "no-" ) && !options.getOption( name ) ) {
                        negated = true;
                        name = name.slice( 3 );
                    }
                }

                // short option
                else {
                    isShort = true;
                    name = name.slice( 1 );
                }

                const eqIndex = name.indexOf( "=" );

                // extract value
                if ( eqIndex !== -1 ) {
                    value = name.slice( eqIndex + 1 );
                    name = name.slice( 0, eqIndex );
                }

                const option = options?.getOption( name ) || this.#globalOptions.getOption( name );

                // option is unknown
                if ( !option ) {
                    errors.push( `Option "${ name }" is unknown.` );
                }

                // boolean option
                else if ( option.isBoolean ) {

                    // boolean option can't have argument
                    if ( value != null ) {
                        errors.push( `Option "${ name }" can not have argument.` );
                    }
                    else {

                        // short negated option
                        if ( isShort && option.negatedShort === name ) negated = true;

                        // false value is not allowed
                        if ( negated && !option.allowFalse ) {
                            errors.push( `Option "--no-${ name }" is not allowed.` );
                        }

                        // true value is not allowed
                        else if ( !negated && !option.allowTrue ) {
                            errors.push( `Option "--${ name }" is not allowed.` );
                        }

                        // set boolean option value
                        else {
                            errors.push( ...option.addValue( !negated ) );
                        }
                    }
                }

                // not boolean option
                else {

                    // only boolean options can be negated
                    if ( negated ) {
                        errors.push( `Option "${ name }" is unknown.` );
                    }
                    else {
                        if ( value == null ) {
                            if ( !this.#argv.length || this.#argv[ 0 ].startsWith( "-" ) ) {
                                errors.push( `Option "${ name }" requires argument.` );
                            }
                            else {
                                value = this.#argv.shift();
                            }
                        }

                        errors.push( ...option.addValue( value ) );
                    }
                }
            }
        }

        this.#argv = argv;

        // validate options
        errors.push( ...this.#globalOptions.validate() );
        errors.push( ...options.validate() );

        process.cli.globalOptions = this.#globalOptions.getValues();
        process.cli.options = options.getValues();

        // print version
        if ( process.cli.globalOptions.version ) {
            this.#printVersion();
        }

        // help
        else if ( process.cli.globalOptions.help ) {
            this.#printHelp();
        }

        // invalid options
        else if ( errors.length ) {
            return errors;
        }
    }

    #parseArguments () {
        const errors = [];

        for ( const arg of this.#argv ) {
            errors.push( ...this.#arguments.addValue( arg ) );
        }

        // validate arguments
        errors.push( ...this.#arguments.validate() );

        if ( errors.length ) return errors;

        process.cli.arguments = this.#arguments.getValues();
    }

    #throw ( errors ) {
        if ( !Array.isArray( errors ) ) errors = [ errors ];

        errors.forEach( e => console.log( "ERROR: " + e ) );

        console.log( "\nUse --help or -? option to get help." );

        process.exit( 2 );
    }

    #printHelp () {
        console.log( this.#config.title + "\n" );

        if ( this.#config.description ) console.log( this.#config.description.replaceAll( /^/gmv, " ".repeat( 4 ) ) + "\n" );

        var usage = prepareHeader( "usage" ) + " " + path.basename( process.argv[ 1 ] );

        if ( this.#commandsStack.length ) usage += " " + this.#commandsStack.map( command => command.name ).join( " " );

        // commands
        if ( this.#commands ) {
            usage += " <command>";

            console.log( usage + "\n" );

            // commands
            console.log( this.#commands.getHelp() + "\n" );
        }

        // command
        else {
            usage += this.#options.getHelpUsage();

            usage += this.#globalOptions.getHelpUsage();

            usage += this.#arguments.getHelpUsage();

            console.log( usage + "\n" );

            if ( this.#commandsStack.length ) {
                const command = this.#commandsStack.at( -1 );

                if ( command.short || command.aliases ) {
                    console.log( prepareHeader( "aliases" ), [ command.name, command.short, ...( command.aliases || [] ) ].filter( name => name ).join( ", " ) + "\n" );
                }
            }

            // options
            if ( this.#options.getHelp() ) console.log( this.#options.getHelp() );

            // arguments
            if ( this.#arguments.getHelp() ) console.log( this.#arguments.getHelp() );
        }

        // global options
        if ( this.#globalOptions.getHelp() ) console.log( this.#globalOptions.getHelp() );

        // exit process
        process.exit( 0 );
    }

    #printVersion () {
        const pkg = env.package;

        const version = [];

        if ( pkg.name ) version.push( pkg.name );
        if ( pkg.version ) version.push( "v" + pkg.version );

        if ( version.length ) {
            console.log( version.join( " " ) );

            process.exit( 0 );
        }
        else {
            console.log( "Package version is not specified." );

            process.exit( 2 );
        }
    }
}
