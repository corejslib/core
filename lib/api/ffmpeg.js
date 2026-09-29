import childProcess from "node:child_process";
import DigitalSize from "#lib/digital-size";
import Events from "#lib/events";
import externalResources from "#lib/external-resources";
import Interval from "#lib/interval";
import Message from "#lib/message";
import stream from "#lib/stream";
import { isPlainObject } from "#lib/utils";

// NOTE: https://www.ffmpeg.org/ffmpeg.html

const PROGRESS_NUMBER_PROPERTIES = new Set( [ "total_size", "out_time_us", "out_time_ms", "dup_frames", "drop_frames" ] ),
    PROTECTED_OPTIONS = new Set( [ "hide_banner", "progress" ] ),
    OPTIONS_ALIASES = {
        "v": "loglevel",
    },
    DEFAULT_OPTIONS = {
        "hide_banner": null,
        "progress": "pipe:3",
        "loglevel": "error",
    },
    FFMPEG_RESOURCE = await externalResources.add( "corejslib/core/resources/ffmpeg-" + process.platform ).check(),
    FFMPEG_EXECUTABLE_PATH = FFMPEG_RESOURCE.getResourcePath( "ffmpeg" + ( process.platform === "win32"
        ? ".exe"
        : "" ) ),
    FFPROBE_EXECUTABLE_PATH = FFMPEG_RESOURCE.getResourcePath( "ffprobe" + ( process.platform === "win32"
        ? ".exe"
        : "" ) );

export default class Ffmpeg {
    #events = new Events();
    #options;
    #input = [];
    #output = [];
    #proc;
    #fd = 4;

    constructor ( { input, output, ...options } = {} ) {
        this.#options = { ...DEFAULT_OPTIONS };

        this.#addOptions( options, this.#options );

        if ( input ) {
            if ( Array.isArray( input ) ) {
                input.forEach( input => this.#addInput( input ) );
            }
            else {
                this.#addInput( input );
            }
        }

        if ( output ) {
            if ( Array.isArray( output ) ) {
                output.forEach( output => this.#addOutput( output ) );
            }
            else {
                this.#addOutput( output );
            }
        }
    }

    // static
    static new ( options ) {
        if ( options instanceof this ) {
            return options;
        }
        else {
            return new this( options );
        }
    }

    static async probe ( message ) {
        const args = [ "-v", "quiet", "-show_format", "-show_streams", "-print_format", "json" ],
            stdio = [ "ignore", "pipe", "ignore" ];

        message = Message.new( message );

        if ( message.isRealFileBody ) {
            args.push( "-i", message.body.path );
        }
        else {
            args.push( "-i", "pipe:0" );
            stdio[ 0 ] = "pipe";
        }

        const proc = childProcess.spawn( FFPROBE_EXECUTABLE_PATH, args, {
            "encoding": "buffer",
            stdio,
        } );

        // pipe input
        if ( stdio[ 0 ] === "pipe" ) {
            stream.pipeline( message.createBodyStreamSync(), proc.stdio[ 0 ], e => {} );
        }

        return new Promise( resolve => {
            proc.once( "error", e => resolve( result.fromError( e, { "log": false } ) ) );

            // process output json
            proc.stdout
                .json()
                .then( data => {
                    if ( !data.format ) return resolve( result( 200 ) );

                    data = {
                        ...data.format,
                        "streams": data.streams,
                    };

                    if ( data.duration ) data.duration = new Interval( Number( data.duration ), "seconds" );
                    if ( data.start_time ) data.start_time = new Interval( Number( data.start_time ), "seconds" );
                    if ( data.size ) data.size = new DigitalSize( data.size );

                    if ( data.streams ) {
                        for ( const stream of data.streams ) {
                            if ( stream.duration ) stream.duration = new Interval( Number( stream.duration ), "seconds" );
                            if ( stream.start_time ) stream.start_time = new Interval( Number( stream.start_time ), "seconds" );
                            if ( stream.is_avc ) stream.is_avc = Boolean( stream.is_avc );
                            if ( stream.nal_length_size ) data.nal_length_size = Number( stream.nal_length_size );
                            if ( stream.bit_rate ) stream.bit_rate = Number( stream.bit_rate );
                            if ( stream.sample_rate ) stream.sample_rate = Number( stream.sample_rate );
                            if ( stream.nb_frames ) stream.nb_frames = Number( stream.nb_frames );
                        }
                    }

                    resolve( result( 200, data ) );
                } )
                .catch( e => {
                    resolve( result.fromError( e, { "log": false } ) );
                } );
        } );
    }

    // public
    async exec ( { signal } = {} ) {
        const args = [],
            stdio = [ "ignore", "ignore", "pipe", "pipe" ];

        // global options
        this.#pushOptions( args, this.#options );

        // files
        for ( const files of [ this.#input, this.#output ] ) {
            for ( const file of files ) {

                // add file options
                this.#pushOptions( args, file.options );

                if ( file.type === "input" ) {
                    args.push( "-i" );
                }

                if ( file.fd ) {
                    args.push( `pipe:${ file.fd }` );

                    stdio.push( "pipe" );
                }
                else {
                    args.push( file.message.body.path );
                }
            }
        }

        // create ffmpeg process
        try {
            this.#proc = childProcess.spawn( FFMPEG_EXECUTABLE_PATH, args, {
                stdio,
                signal,
            } );
        }
        catch ( e ) {
            return result.fromError( e, { "log": false } );
        }

        // pipe stderr
        const stderr = [];
        this.#proc.stdio[ 2 ].on( "data", data => stderr.push( data ) );

        // pipe progress
        this.#proc.stdio[ 3 ].on( "data", this.#onProgress.bind( this ) );

        // pipe output
        for ( const file of this.#output ) {
            if ( file.fd ) {
                stream.pipeline( this.#proc.stdio[ file.fd ], file.message.body, e => {} );
            }
        }

        // pipe input
        for ( const file of this.#input ) {
            if ( file.fd ) {
                stream.pipeline( await file.message.createBodyStream(), this.#proc.stdio[ file.fd ], e => {} );
            }
        }

        return new Promise( resolve => {
            this.#proc.once( "close", code => {
                this.#proc = null;

                if ( code ) {
                    const log = Buffer.concat( stderr ).toString().split( /\r?\n/v );

                    resolve( result( [ 500, log[ 0 ] ], {
                        "stderr": log,
                    } ) );
                }
                else {
                    resolve( result( 200, {
                        "output": this.#output.map( file => file.message ),
                    } ) );
                }
            } );
        } );
    }

    on ( event, callback ) {
        this.#events.on( event, callback );

        return this;
    }

    once ( event, callback ) {
        this.#events.once( event, callback );

        return this;
    }

    off ( event, callback ) {
        this.#events.off( event, callback );

        return this;
    }

    // private
    #addOptions ( options, target ) {
        for ( const [ key, value ] of Object.entries( options ) ) {
            const name = OPTIONS_ALIASES[ key ] || key;

            if ( PROTECTED_OPTIONS.has( name ) ) continue;

            if ( value === undefined ) {
                delete target[ name ];
            }
            else {
                target[ name ] = value;
            }
        }
    }

    #addInput ( input ) {
        const file = {
            "type": "input",
            "message": null,
            "fd": null,
            "options": {},
        };

        this.#input.push( file );

        var message, options;

        if ( isPlainObject( input ) ) {
            ( { "from": message, ...options } = input );

            this.#addOptions( options, file.options );
        }
        else {
            message = input;
        }

        this.#addMessage( file, message );
    }

    #addOutput ( output ) {
        const file = {
            "type": "output",
            "message": null,
            "fd": null,
            "options": {},
        };

        this.#output.push( file );

        var message, options;

        if ( isPlainObject( output ) ) {
            ( { "to": message, ...options } = output );

            this.#addOptions( options, file.options );
        }
        else {
            message = output;
        }

        this.#addMessage( file, message );
    }

    #addMessage ( file, message ) {
        message = Message.new( message );

        file.message = message;

        if ( !message.isRealFileBody ) {
            if ( file.type === "output" && !( message.body instanceof stream.Transform ) ) {
                throw new TypeError( "Output type is not valid. It can be a instance of File or stream.Transform." );
            }

            file.fd = this.#fd++;
        }
    }

    #onProgress ( buffer ) {
        if ( !this.#events.hasListeners( "progress" ) ) return;

        const data = {};

        for ( const line of buffer.toString().split( "\n" ) ) {
            let [ key, value ] = line.split( "=", 2 );

            key = key.trim();

            if ( !key ) continue;

            value = value.trim();

            if ( PROGRESS_NUMBER_PROPERTIES.has( key ) ) {
                value = Number( value );
            }

            data[ key ] = value;
        }

        this.#events.emit( "progress", data );
    }

    #pushOptions ( args, options ) {
        for ( const key in options ) {
            const value = options[ key ];

            if ( value === undefined ) {
                continue;
            }
            else if ( Array.isArray( value ) ) {
                const values = value;

                for ( const value of values ) {
                    if ( value === undefined ) {
                        continue;
                    }
                    else {
                        args.push( `-${ key }` );

                        if ( value != null ) {
                            args.push( value );
                        }
                    }
                }
            }
            else {
                args.push( `-${ key }` );

                if ( value != null ) {
                    args.push( value );
                }
            }
        }
    }
}
