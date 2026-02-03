import fs from "node:fs";
import stream from "node:stream";
import Blob from "#lib/blob";
import env from "#lib/env";

export default stream;
export * from "node:stream";

var TmpFile;

const DEFAULT_EOL = Buffer.from( "\n" ),
    HTTP_HEADERS_EOL = Buffer.from( "\r\n\r\n" ),
    DEFAULT_HTTP_HEADERS_MAX_LENGTH = 16_384;

const nameProperty = Symbol(),
    typeProperty = Symbol(),
    sizeProperty = Symbol();

// patch stream.Stream
Object.defineProperties( stream.Stream.prototype, {

    // properties
    "name": {
        "configurable": false,
        "enumerable": false,
        get () {
            return this[ nameProperty ];
        },
    },

    "type": {
        "configurable": false,
        "enumerable": false,
        get () {
            return this[ typeProperty ];
        },

        // XXX patch for "send" package
        // SendStream.prototype.type = function type (path) {}
        set ( value ) {
            if ( typeof value === "function" ) {
                console.warn( "Attempt to set stream.type" );
            }
            else {

                // this[ typeProperty ] = value;
                throw new Error( "Attempt to set stream.type" );
            }
        },
    },

    "size": {
        "configurable": false,
        "enumerable": false,
        get () {
            return this[ sizeProperty ];
        },
    },

    // public
    "setName": {
        "configurable": false,
        "enumerable": false,
        "writable": false,
        value ( value ) {
            if ( value == null ) {
                this[ nameProperty ] = undefined;
            }
            else if ( typeof value === "string" ) {
                this[ nameProperty ] = value || undefined;
            }
            else {
                throw new Error( "Name should be a String" );
            }

            return this;
        },
    },

    "setType": {
        "configurable": false,
        "enumerable": false,
        "writable": false,
        value ( value ) {
            if ( value == null ) {
                this[ typeProperty ] = undefined;
            }
            else if ( typeof value === "string" ) {
                this[ typeProperty ] = value || undefined;
            }
            else {
                throw new Error( "Type should be a String" );
            }

            return this;
        },
    },

    "setSize": {
        "configurable": false,
        "enumerable": false,
        "writable": false,
        value ( value ) {
            if ( value == null ) {
                this[ sizeProperty ] = undefined;
            }
            else if ( typeof value === "number" ) {
                if ( !Number.isInteger( value ) || value < 0 ) throw new Error( "Size should be a positive integer" );

                this[ sizeProperty ] = value;
            }
            else {
                throw new Error( "Size should be a Number" );
            }

            return this;
        },
    },

    [ Symbol.for( "nodejs.util.inspect.custom" ) ]: {
        "configurable": false,
        "enumerable": false,
        "writable": false,
        value ( depth, options, inspect ) {
            const spec = {};

            if ( this.name ) spec.name = this.name;
            if ( this.type ) spec.type = this.type;
            if ( this.size != null ) spec.size = this.size;

            var name;

            if ( this instanceof stream.PassThrough ) {
                name = this.constructor.name + " (stream.PassThrough)";
            }
            else if ( this instanceof stream.Transform ) {
                name = this.constructor.name + " (stream.Transform)";
            }
            else if ( this instanceof stream.Duplex ) {
                name = this.constructor.name + " (stream.Duplex)";
            }
            else if ( this instanceof stream.Readable ) {
                name = this.constructor.name + " (stream.Readable)";
            }
            else if ( this instanceof stream.Writable ) {
                name = this.constructor.name + " (stream.Writable)";
            }
            else {
                name = this.constructor.name + " (stream.Stream)";
            }

            return name + ": " + inspect( spec );
        },
    },
} );

// patch stream.Readable
Object.defineProperties( stream.Readable.prototype, {

    // public
    "blackhole": {
        "configurable": false,
        "enumerable": false,
        "writable": false,
        async value () {

            // strem is destroyed
            if ( this.destroyed ) return;

            this.once( "error", e => {} );

            return new Promise( resolve => {
                this.on( "close", resolve );

                this.resume();
            } );
        },
    },

    "buffer": {
        "configurable": false,
        "enumerable": false,
        "writable": false,
        async value ( { maxLength } = {} ) {

            // stream is destroyed
            if ( this.destroyed ) return;

            return new Promise( ( resolve, reject ) => {
                const buffers = [];

                var length = 0;

                this.once( "error", e => {
                    reject( e );
                } );

                this.on( "data", ( data, encoding ) => {
                    if ( !Buffer.isBuffer( data ) ) data = Buffer.from( data, encoding );

                    length += data.length;

                    if ( maxLength && length > maxLength ) {
                        this.destroy( "Length limit exceeded" );
                    }
                    else {
                        buffers.push( data );
                    }
                } );

                this.once( "end", () => {
                    if ( !buffers.length ) {
                        resolve( Buffer.alloc( 0 ) );
                    }
                    else if ( buffers.length === 1 ) {
                        resolve( buffers[ 0 ] );
                    }
                    else {
                        resolve( Buffer.concat( buffers ) );
                    }
                } );
            } );
        },
    },

    "arrayBuffer": {
        "configurable": false,
        "enumerable": false,
        "writable": false,
        async value ( { maxLength } = {} ) {
            const buffer = await this.buffer( { maxLength } );

            if ( !buffer ) return;

            return buffer.buffer.slice( buffer.byteOffset, buffer.byteOffset + buffer.byteLength );
        },
    },

    "tmpFile": {
        "configurable": false,
        "enumerable": false,
        "writable": false,
        async value ( { maxLength, ...tmpFileOptions } = {} ) {
            TmpFile ||= ( await import( "#lib/tmp" ) ).TmpFile;

            // stream is destroyed
            if ( this.destroyed ) return;

            const tmpFile = TmpFile.new( tmpFileOptions );

            return new Promise( ( resolve, reject ) => {
                const writeStream = fs.createWriteStream( tmpFile.path );

                if ( maxLength ) {
                    let length = 0;

                    this.on( "data", data => {
                        length += data.length;

                        if ( length > maxLength ) this.destroy( "Length limit exceeded" );
                    } );
                }

                stream.pipeline( this, writeStream, e => {
                    if ( e ) {
                        reject( e );
                    }
                    else {
                        resolve( tmpFile );
                    }
                } );
            } );
        },
    },

    "blob": {
        "configurable": false,
        "enumerable": false,
        "writable": false,
        async value ( { maxLength, type } = {} ) {
            const buffer = await this.buffer( { maxLength } );

            if ( !buffer ) return;

            return new Blob( [ buffer ], { type } );
        },
    },

    "text": {
        "configurable": false,
        "enumerable": false,
        "writable": false,
        async value ( { maxLength, encoding } = {} ) {
            const buffer = await this.buffer( { maxLength } );

            if ( !buffer ) return;

            return buffer.toString( encoding );
        },
    },

    "json": {
        "configurable": false,
        "enumerable": false,
        "writable": false,
        async value ( { maxLength } = {} ) {
            const buffer = await this.buffer( { maxLength } );

            if ( !buffer.length ) return;

            try {
                return JSON.parse( buffer );
            }
            catch ( e ) {
                if ( env.isDevelopment ) {
                    console.log( "Invalid JSON:\n", buffer );
                }

                throw e;
            }
        },
    },

    "readHttpHeaders": {
        "configurable": false,
        "enumerable": false,
        "writable": false,
        async value ( { maxLength } = {} ) {
            maxLength = maxLength || DEFAULT_HTTP_HEADERS_MAX_LENGTH;

            return this.readLine( { "eol": HTTP_HEADERS_EOL, maxLength, "encoding": "latin1" } );
        },
    },

    "readChunk": {
        "configurable": false,
        "enumerable": false,
        "writable": false,
        async value ( chunkLength, { encoding } = {} ) {

            // stream is destroyed, no more data can be read
            if ( this.destroyed ) return;

            // chunk is already buffered
            if ( this.readableLength >= chunkLength ) {
                return encoding
                    ? this.read( chunkLength ).toString( encoding )
                    : this.read( chunkLength );
            }

            return new Promise( ( resolve, reject ) => {
                var error,
                    readable,
                    buffers = [],
                    totalLength = 0;

                error = e => {
                    this.off( "end", end );
                    this.off( "readable", readable );

                    reject( e );
                };

                const end = () => {

                    // remove events listeners
                    this.off( "error", error );
                    this.off( "end", end );
                    this.off( "readable", readable );

                    // no data, unable to read chunk with the specified length
                    if ( totalLength < chunkLength ) return resolve();

                    let buffer;

                    // combine buffers
                    if ( buffers.length === 1 ) buffer = buffers[ 0 ];
                    else buffer = Buffer.concat( buffers );

                    resolve( encoding
                        ? buffer.toString( encoding )
                        : buffer );
                };

                readable = () => {

                    // eof
                    if ( !this.readableLength ) return end();

                    const readSize = chunkLength - totalLength;

                    const buffer = this.read( this.readableLength >= readSize
                        ? readSize
                        : null );

                    buffers.push( buffer );

                    totalLength += buffer.length;

                    // size reached
                    if ( totalLength >= chunkLength ) end();
                };

                // set events listeners
                this.once( "error", error );
                this.once( "end", end );
                this.on( "readable", readable );
            } );
        },
    },

    // maxLength - length without eol length
    "readLine": {
        "configurable": false,
        "enumerable": false,
        "writable": false,
        async value ( { eol, maxLength, encoding, lastEolRequired } = {} ) {

            // stream is destroyed
            if ( this.destroyed ) return;

            eol = eol == null
                ? DEFAULT_EOL
                : Buffer.isBuffer( eol )
                    ? eol
                    : Buffer.from( eol, encoding );
            maxLength ||= Infinity;
            lastEolRequired ??= true;

            return new Promise( ( resolve, reject ) => {
                var error, end, readable, buffer, line;

                error = e => {
                    this.off( "end", end );
                    this.off( "readable", readable );

                    reject( e );
                };

                end = () => {
                    this.off( "error", error );
                    this.off( "end", end );
                    this.off( "readable", readable );

                    // not found
                    if ( line == null ) {
                        if ( !lastEolRequired && buffer != null ) {
                            resolve( encoding
                                ? buffer.toString( encoding )
                                : buffer );
                        }
                        else {
                            resolve();
                        }
                    }

                    // found
                    else {
                        resolve( encoding
                            ? line.toString( encoding )
                            : line );
                    }
                };

                readable = () => {

                    // eof
                    if ( !this.readableLength ) return end();

                    let start;

                    if ( !buffer ) {
                        const size = maxLength + eol.length;

                        buffer = this.read( size > this.readableLength
                            ? this.readableLength
                            : size );
                    }
                    else {
                        start = buffer.length - eol.length;

                        const size = maxLength + eol.length - buffer.length;

                        buffer = Buffer.concat( [ buffer, this.read( size > this.readableLength
                            ? this.readableLength
                            : size ) ] );
                    }

                    const idx = buffer.indexOf( eol, start );

                    // not found
                    if ( idx === -1 ) {
                        if ( buffer.length >= maxLength + eol.length ) return this.destroy( "Length limit reached" );
                    }

                    // found
                    else {
                        if ( idx > maxLength ) return this.destroy( "Length limit reached" );

                        line = buffer.subarray( 0, idx );

                        if ( buffer.length > idx + eol.length ) this.unshift( buffer.subarray( idx + eol.length ) );

                        return end();
                    }

                    // check eof
                    this.read( 0 );
                };

                this.once( "error", error );
                this.on( "readable", readable );
                this.once( "end", end );
            } );
        },
    },
} );
