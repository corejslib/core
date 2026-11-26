import path from "node:path";
import Ajv from "#lib/ajv";
import Arguments from "#lib/cli/arguments";
import Commands from "#lib/cli/commands";
import Options from "#lib/cli/options";
import { markdownToString } from "#lib/cli/utils";
import { readConfig } from "#lib/config";
import env from "#lib/env";
import { isPlainObject, mergeObjects } from "#lib/utils";

var cliSchema, isParsed;

const DEFAULT_CONFIG = {
    "globalOptions": {
        "version": {
            "description": "Print version and exit",
            "schema": {
                "type": "boolean",
            },
        },

        "help": {
            "short": "?",
            "description": "Print help and exit",
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

        this.#resolveConfig( config );

        // add default config
        this.#config = mergeObjects( {}, this.#config, DEFAULT_CONFIG );

        this.#globalOptions = new Options( this, {
            "options": this.#config.globalOptions,
        } );
    }

    // static
    static async parse ( config, options ) {
        const cli = new this( config, options );

        await cli.#parse();

        return cli;
    }

    static markdownToString ( string ) {
        return markdownToString( string );
    }

    // properties
    get allowPartialCommands () {
        return this.#allowPartialCommands;
    }

    get module () {
        return this.#module;
    }

    // public
    markdownToString ( string ) {
        return markdownToString( string );
    }

    // private
    #resolveConfig ( config ) {
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

    async #parseCommands () {
        let command;

        // find command
        for ( let n = 0; n < this.#argv.length; n++ ) {
            if ( this.#argv[ n ].startsWith( "-" ) ) continue;

            let option = this.#argv[ n - 1 ];

            if ( option && option.startsWith( "-" ) && !option.includes( "=" ) ) {

                // long option
                if ( option.startsWith( "--" ) ) {
                    option = option.slice( 2 );
                }

                // single short option
                else if ( option.length === 2 ) {
                    option = option.slice( 1 );
                }

                option = this.#globalOptions.getOption( option );

                // global non-boolean option
                if ( option && !option.isBoolean ) {
                    continue;
                }
            }

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

            this.#resolveConfig( module );

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
                    isNegated,
                    value;

                // long option
                if ( name.startsWith( "--" ) ) {
                    name = name.slice( 2 );

                    // long false option
                    if ( name.startsWith( "no-" ) && !options.getOption( name ) ) {
                        isNegated = true;
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
                        errors.push( `Option "${ option.name }" can not have argument.` );
                    }
                    else {

                        // short false option
                        if ( isShort && option.negatedShort === name ) isNegated = true;

                        errors.push( ...option.addValue( !isNegated ) );
                    }
                }

                // not boolean option
                else {

                    // get value from next argument
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

        this.#argv = argv;

        // validate options
        errors.push( ...this.#globalOptions.validate() );
        process.cli.globalOptions = this.#globalOptions.getValues();

        if ( options ) {
            errors.push( ...options.validate() );
            process.cli.options = options.getValues();
        }

        // print version
        if ( process.cli.globalOptions.version ) {
            this.#printVersion();
        }

        // print help
        else if ( process.cli.globalOptions.help ) {
            this.#printHelp();
        }

        // errors
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
        const help = [];

        // title
        help.push( markdownToString( this.#config.title ) );

        let usage = "**Usage**: " + path.basename( process.argv[ 1 ] ).replace( /\.(?:js|cjs|mjs)$/v, "" );

        if ( this.#commandsStack.length ) usage += " " + this.#commandsStack.map( command => command.name ).join( " " );

        // commands
        if ( this.#commands ) {
            usage += " <command>";

            usage += this.#globalOptions.getHelpUsage();

            help.push( markdownToString( usage ) );

            // commands
            help.push( this.#commands.getHelp() );
        }

        // command
        else {
            usage += this.#globalOptions.getHelpUsage();

            usage += this.#options.getHelpUsage();

            usage += this.#arguments.getHelpUsage();

            help.push( markdownToString( usage ) );

            if ( this.#commandsStack.length ) {
                const command = this.#commandsStack.at( -1 );

                // aliases
                if ( command.short || command.aliases ) {
                    help.push( markdownToString( "**Aliases**: " + [ command.short, ...( command.aliases || [] ) ].filter( name => name ).join( ", " ) ) );
                }
            }

            // options
            if ( this.#options.getHelp() ) help.push( this.#options.getHelp() );

            // arguments
            if ( this.#arguments.getHelp() ) help.push( this.#arguments.getHelp() );
        }

        // global options
        if ( this.#globalOptions.getHelp() ) help.push( this.#globalOptions.getHelp() );

        // description
        if ( this.#config.description ) {
            help.push( markdownToString( "**Description**:" ) );
            help.push( markdownToString( this.#config.description ).replaceAll( /^/gmv, " ".repeat( 2 ) ) );
        }

        console.log( help.map( part => part.trim() ).join( "\n\n" ) );

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
