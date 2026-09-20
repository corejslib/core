import Command from "#lib/cli/commands/command";

export default class CliCommands {
    #cli;
    #items = {};
    #hasShorts;

    constructor ( cli, config ) {
        this.#cli = cli;

        if ( !config ) return;

        for ( const name in config ) {

            // skip undefined command
            if ( !config[ name ] ) continue;

            const command = new Command( name, config[ name ] );

            this.#items[ name ] = command;

            if ( command.short ) {
                this.#hasShorts = true;

                // short option name is already defined
                if ( this.#items[ command.short ] != null ) {
                    this.#throwSpecError( `Short command name "${ command.short }" is not unique.` );
                }
                else {
                    this.#items[ command.short ] = command;
                }
            }

            if ( command.aliases ) {
                for ( const alias of command.aliases ) {
                    if ( this.#items[ alias ] != null ) {
                        this.#throwSpecError( `Command alias name "${ alias }" is not unique.` );
                    }
                    else {
                        this.#items[ alias ] = command;
                    }
                }
            }
        }
    }

    // public
    getCommand ( command ) {

        // full name exact match
        if ( this.#items[ command ] ) {
            return this.#items[ command ];
        }

        // find partial commands
        else if ( this.#cli.allowPartialCommands ) {
            const possibleCommands = [];

            for ( const commandName in this.#items ) {

                // partial match
                if ( commandName.startsWith( command ) ) {
                    possibleCommands.push( commandName );
                }
            }

            if ( possibleCommands.length === 1 ) {
                return this.#items[ possibleCommands[ 0 ] ];
            }
            else {
                return possibleCommands;
            }
        }
        else {
            return [];
        }
    }

    getHelp () {
        const commands = this.#items;

        let maxLength = 0;

        // index max command name length
        for ( const command of Object.values( commands ) ) {
            const name = [ command.name, ...( command.aliases || [] ) ].join( ", " );

            if ( name.length > maxLength ) maxLength = name.length;
        }

        var help = [];

        for ( const command of Object.values( commands ) ) {
            const name = [ command.name, ...( command.aliases || [] ) ].join( ", " );

            if ( this.#hasShorts ) {
                help.push( "  " + ( command.short
                    ? command.short + ", "
                    : "   " ) + name.padEnd( maxLength, " " ) + " ".repeat( 4 ) + command.title );
            }
            else {
                help.push( "  " + name.padEnd( maxLength, " " ) + " ".repeat( 4 ) + command.title );
            }
        }

        return "where <command> is one of:\n\n" + help.join( "\n" );
    }

    // private
    #throwSpecError ( error ) {
        console.log( error );

        process.exit( 2 );
    }
}
