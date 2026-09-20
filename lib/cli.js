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

    #spec;
    #globalOptions = {};
    #globalOptionsErrors;
    #commands;
    #options;
    #arguments;

    constructor ( config, { allowPartialCommands } = {} ) {
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

        var split;

        // prepare argv
        for ( let arg of process.argv.slice( 2 ) ) {
            if ( arg === "--" ) {
                split = true;
            }
            else if ( split ) {
                process.cli.argv.push( arg );
            }
            else if ( arg === "-" ) {
                this.#argv.push( arg );
            }
            else if ( arg.startsWith( "--" ) ) {
                this.#argv.push( arg );
            }
            else if ( arg.startsWith( "-" ) ) {
                const eqIndex = arg.indexOf( "=" );

                let value;

                if ( eqIndex > 0 ) {
                    value = arg.slice( eqIndex + 1 );
                    arg = arg.slice( 0, eqIndex );
                }

                for ( let n = 1; n < arg.length; n++ ) {
                    if ( value != null && n === arg.length - 1 ) {
                        this.#argv.push( "-" + arg[ n ] + "=" + value );
                    }
                    else {
                        this.#argv.push( "-" + arg[ n ] );
                    }
                }
            }
            else {
                this.#argv.push( arg );
            }
        }

        this.#findSpec( config );

        this.#parseGlobalOptions();

        // print version
        if ( process.cli.globalOptions.version ) {
            this.#printVersion();
        }
    }

    // static
    static async parse ( config, options ) {
        if ( isParsed ) throw new Error( "CLI is alreday parsed" );
        isParsed = true;

        const cli = new this( config, options );

        return cli.parse();
    }

    // properties
    get allowPartialCommands () {
        return this.#allowPartialCommands;
    }

    get module () {
        return this.#module;
    }

    // public
    async parse () {
        await this.#parse();

        return this;
    }

    // private
    async #parse () {

        // validate cli spec
        cliSchema ??= new Ajv().addSchema( await readConfig( "#resources/schemas/cli.schema.yaml", { "resolve": import.meta.url } ) );

        // cli spec error
        if ( !cliSchema.validate( "config", this.#spec ) ) {
            console.log( `CLI config is not valid, inspect errors below:\n${ cliSchema.errors }` );

            process.exit( 2 );
        }

        // process commands
        if ( this.#spec.commands ) {
            this.#commands = new Commands( this, this.#spec.commands );
            this.#options = null;
            this.#arguments = null;

            await this.#parseCommands();
        }

        // process options
        else {
            this.#commands = null;
            this.#options = new Options( this, {
                "options": this.#spec.options,
                "globalOptions": this.#globalOptions,
            } );
            this.#arguments = new Arguments( this, this.#spec.arguments );

            if ( process.cli.globalOptions.help ) this.#printHelp();

            this.#parseOptions( this.#options );
            this.#parseArguments();

            process.cli.command = this.#commandsStack.map( command => command.name ).join( "/" );
        }
    }

    #findSpec ( config ) {
        config ||= {};

        // plain config
        if ( isPlainObject( config ) ) {
            this.#spec = config;
            this.#module = null;
        }

        // module instance
        else {

            // .cli() method
            if ( config.cli && typeof config.cli === "function" ) {
                this.#spec = config.cli() || {};
                this.#module = config;
            }

            // static .cli() method
            else if ( config.constructor.cli && typeof config.constructor.cli === "function" ) {
                this.#spec = config.constructor.cli() || {};
                this.#module = config;
            }
        }
    }

    #parseGlobalOptions () {

        // update global options help
        this.#spec = mergeObjects( {}, this.#spec, defaultGlobalOptions );

        this.#globalOptions = new Options( this, {
            "options": this.#spec.globalOptions,
        } );

        this.#parseOptions( this.#globalOptions );
    }

    async #parseCommands () {
        this.#commands = new Commands( this, this.#spec.commands );

        var command;

        // find command
        for ( let n = 0; n < this.#argv.length; n++ ) {
            if ( this.#argv[ n ].startsWith( "-" ) ) continue;

            command = this.#argv[ n ];

            this.#argv.splice( n, 1 );

            break;
        }

        // command not provided
        if ( !command ) {

            // help
            if ( process.cli.globalOptions.help ) {
                this.#printHelp();
            }
            else {
                this.#throw( "Command is required." );
            }
        }

        const possibleCommands = this.#commands.getCommand( command );

        // command not found
        if ( Array.isArray( possibleCommands ) ) {

            // help
            if ( process.cli.globalOptions.help ) {
                this.#printHelp();
            }

            // no matching commands
            else if ( !possibleCommands.length ) {
                this.#throw( `Command "${ command }" is unknown.` );
            }

            // more than 1 matching command
            else {
                this.#throw( `Command "${ command }" is ambiguous. Possible commands: ${ possibleCommands.join( ", " ) }.` );
            }
        }

        // command found
        else {
            this.#commandsStack.push( possibleCommands );

            const module = await possibleCommands.getModule();

            this.#findSpec( module );

            this.#spec.title ||= possibleCommands.title;

            return this.#parse();
        }
    }

    #parseOptions ( options ) {
        const argv = [],
            errors = [];

        while ( this.#argv.length ) {
            const arg = this.#argv.shift();

            if ( arg === "-" ) {
                argv.push( arg );
            }
            else if ( !arg.startsWith( "-" ) ) {
                argv.push( arg );
            }
            else {
                let name = arg,
                    iShort,
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
                    iShort = true;
                    name = name.slice( 1 );
                }

                const eqIndex = name.indexOf( "=" );

                // extract value
                if ( eqIndex !== -1 ) {
                    value = name.slice( eqIndex + 1 );
                    name = name.slice( 0, eqIndex );
                }

                const option = options.getOption( name );

                // option is unknown
                if ( !option ) {
                    if ( options.isGlobal ) {
                        argv.push( arg );
                    }
                    else {
                        errors.push( `Option "${ name }" is unknown.` );
                    }

                    continue;
                }

                // boolean option
                if ( option.isBoolean ) {

                    // boolean option can't have argument
                    if ( value != null ) {
                        errors.push( `Option "${ name }" does not requires argument.` );

                        continue;
                    }

                    // short negated option
                    if ( iShort && option.negatedShort === name ) negated = true;

                    // false value is not allowed
                    if ( negated && !option.allowFalse ) {
                        errors.push( `Option "--no-${ name }" is not allowed.` );

                        continue;
                    }

                    // true value is not allowed
                    else if ( !negated && !option.allowTrue ) {
                        errors.push( `Option "--${ name }" is not allowed.` );

                        continue;
                    }

                    // set boolean option value
                    errors.push( ...option.addValue( !negated ) );
                }

                // not boolean option
                else {

                    // only boolean options can be negated
                    if ( negated ) {
                        errors.push( `Option "${ name }" is unknown.` );

                        continue;
                    }

                    if ( value == null ) {
                        if ( !this.#argv.length || this.#argv[ 0 ].startsWith( "-" ) ) {
                            errors.push( `Option "${ name }" requires argument.` );

                            continue;
                        }

                        value = this.#argv.shift();
                    }

                    errors.push( ...option.addValue( value ) );
                }
            }
        }

        this.#argv = argv;

        // validate options
        errors.push( ...options.validate() );

        if ( options.isGlobal ) {
            this.#globalOptionsErrors = errors;

            process.cli.globalOptions = options.getValues();
        }
        else {

            // invalid global options
            if ( this.#globalOptionsErrors.length ) this.#throw( this.#globalOptionsErrors );

            // invalid options
            if ( errors.length ) this.#throw( errors );

            process.cli.options = options.getValues();
        }
    }

    #parseArguments () {
        const errors = [];

        for ( const arg of this.#argv ) {
            errors.push( ...this.#arguments.addValue( arg ) );
        }

        // validate arguments
        errors.push( ...this.#arguments.validate() );

        if ( errors.length ) this.#throw( errors );

        process.cli.arguments = this.#arguments.getValues();
    }

    #throw ( errors ) {
        if ( !Array.isArray( errors ) ) errors = [ errors ];

        errors.forEach( e => console.log( "ERROR: " + e ) );

        console.log( "\nUse --help or -? option to get help." );

        process.exit( 2 );
    }

    #printHelp () {
        console.log( this.#spec.title + "\n" );

        if ( this.#spec.description ) console.log( this.#spec.description.replaceAll( /^/gmv, " ".repeat( 4 ) ) + "\n" );

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

                if ( command.aliases ) {
                    console.log( prepareHeader( "aliases" ), [ command.name, ...command.aliases ].join( ", " ) + "\n" );
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
