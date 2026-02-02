import { Console } from "node:console";
import ansi from "#lib/ansi";
import stream from "#lib/stream";

class WritableBlackHole extends stream.Writable {

    // protected
    _write ( chunk, encoding, callback ) {
        callback();
    }
}

class WritableBuffer extends stream.Writable {
    #buffer = [];

    // protected
    _write ( chunk, encoding, callback ) {
        this.#buffer.push( chunk );

        callback();
    }

    // public
    flush () {
        const log = Buffer.concat( this.#buffer ).toString();

        this.#buffer = [];

        return log;
    }
}

export default class Logger extends Console {
    #stdoutColorMode;
    #stderrColorMode;
    #console;
    #enableLabels;

    constructor ( { stdout, stderr, colorMode, ignoreErrors, inspectOptions, groupIndentation, enableLabels } = {} ) {
        colorMode ??= "auto";

        // stdout
        if ( stdout == null || stdout === "inherit" ) {
            stdout = process.stdout;
        }
        else if ( stdout === false || stdout === "ignore" ) {
            stdout = new WritableBlackHole();
        }
        else if ( stdout === true || stdout === "pipe" ) {
            stdout = new WritableBuffer();
        }
        else if ( stdout === "stderr" ) {
            if ( stderr === "stdout" ) {
                stdout = new WritableBlackHole();
            }
        }
        else if ( !( stdout instanceof stream.Writable ) ) {
            throw new Error( "Invalid stdout value" );
        }

        // stderr
        if ( stderr == null || stderr === "inherit" ) {
            stderr = process.stderr;
        }
        else if ( stderr === false || stderr === "ignore" ) {
            stderr = new WritableBlackHole();
        }
        else if ( stderr === true || stderr === "pipe" ) {
            stderr = new WritableBuffer();
        }
        else if ( stderr === "stdout" ) {
            if ( stdout === "stderr" ) {
                stderr = new WritableBlackHole();
            }
        }
        else if ( !( stderr instanceof stream.Writable ) ) {
            throw new Error( "Invalid stderr value" );
        }

        if ( stdout === "stderr" ) {
            stdout = stderr;
        }

        if ( stderr === "stdout" ) {
            stderr = stdout;
        }

        super( {
            stdout,
            stderr,
            colorMode,
            ignoreErrors,
            inspectOptions,
            groupIndentation,
        } );

        this.#enableLabels = Boolean( enableLabels );

        if ( colorMode === "auto" ) {
            if ( this._stdout instanceof WritableBuffer ) {
                this.#stdoutColorMode = true;
            }
            else {
                this.#stdoutColorMode = this._stdout?.isTTY;
            }

            if ( this._stderr instanceof WritableBuffer ) {
                this.#stderrColorMode = true;
            }
            else {
                this.#stderrColorMode = this._stderr?.isTTY;
            }
        }
        else {
            this.#stdoutColorMode = colorMode;
            this.#stderrColorMode = colorMode;
        }
    }

    // properties
    get console () {
        return this.#console || globalThis.console;
    }

    get stdoutColorMode () {
        return this.#stdoutColorMode;
    }

    get stderrColorMode () {
        return this.#stderrColorMode;
    }

    get enableLabels () {
        return this.#enableLabels;
    }

    // public
    installGlobalConsole () {
        if ( !this.#console ) {
            this.#console = globalThis.console;

            globalThis.console = this;
        }

        return this;
    }

    restoreGlobalConsole () {
        if ( this.#console ) {
            globalThis.console = this.#console;

            this.#console = null;
        }

        return this;
    }

    // XXX log().trim()
    write ( ...args ) {
        this._stdout.write( args.join( " " ) );
    }

    log ( ...args ) {
        super.log( ...args );
    }

    debug ( ...args ) {
        if ( this.enableLabels ) {
            super.debug( this.stdoutColorMode
                ? ansi.dim( "[D]" )
                : "[D]", ...args );
        }
        else {
            super.debug( ...args );
        }
    }

    info ( ...args ) {
        if ( this.enableLabels ) {
            super.info( this.stdoutColorMode
                ? ansi.ok( "[I]" )
                : "[I]", ...args );
        }
        else {
            super.info( ...args );
        }
    }

    warn ( ...args ) {
        if ( this.enableLabels ) {
            super.warn( this.stderrColorMode
                ? ansi.warn( "[W]" )
                : "[W]", ...args );
        }
        else {
            super.warn( ...args );
        }
    }

    error ( ...args ) {
        if ( this.enableLabels ) {
            super.error( this.stderrColorMode
                ? ansi.error( "[E]" )
                : "[E]", ...args );
        }
        else {
            super.error( ...args );
        }
    }

    flush () {
        return this.flushStdout() + this.flushStderr();
    }

    flushStdout () {
        if ( this._stdout instanceof WritableBuffer ) {
            return this._stdout.flush();
        }
        else {
            return "";
        }
    }

    flushStderr () {
        if ( this._stderr instanceof WritableBuffer ) {
            return this._stderr.flush();
        }
        else {
            return "";
        }
    }

    [ Symbol.dispose ] () {
        this.restoreGlobalConsole();
    }

    async [ Symbol.asyncDispose ] () {
        this.restoreGlobalConsole();
    }
}
