import mixins from "#lib/mixins";
import stream from "#lib/stream";

const DelayedTransformMixin = Super =>
    class extends Super {
        #pendingChunks = [];
        #isReading = false;

        // public
        read ( size ) {
            if ( !this.#isReading ) {
                this.#isReading = true;

                for ( const chunk of this.#pendingChunks ) {
                    this._transform( ...chunk );
                }

                this.#pendingChunks = null;
            }

            return super.read( size );
        }

        // protected
        async _transform ( chunk, encoding, callback ) {
            if ( !this.#isReading ) {
                this.#pendingChunks.push( [ chunk, encoding, callback ] );
            }
            else {
                super._transform( chunk, encoding, callback );
            }
        }
    };

const StreamJoinerMixin = Super =>
    class extends stream.Transform {
        #autoEnd;
        #streams = new Set();
        #stream;
        #callback;
        #readableListener = this.#onReadable.bind( this );
        #errorListener = this.#onError.bind( this );
        #closeListener = this.#onClose.bind( this );
        #sizeDefined = true;

        constructor ( { autoEnd } = {} ) {
            super( {
                "writableObjectMode": true,
                "writableHighWaterMark": 1,
            } );

            this.#autoEnd = Boolean( autoEnd );
        }

        // properties
        get autoEnd () {
            return this.#autoEnd;
        }

        // public
        write ( chunk, encoding, callback ) {
            if ( typeof encoding === "function" ) {
                callback = encoding;
                encoding = undefined;
            }

            if ( chunk instanceof stream.Readable ) {
                this.#streams.add( chunk );
            }

            var chunkSize;

            // track stream size
            if ( this.#sizeDefined ) {
                if ( chunk instanceof stream.Readable ) {
                    chunkSize = chunk.size;
                }
                else if ( typeof chunk === "function" ) {
                    chunkSize = null;
                }
                else {
                    if ( typeof chunk === "string" ) {
                        chunk = Buffer.from( chunk, encoding );
                    }

                    if ( Buffer.isBuffer( chunk ) ) {
                        chunkSize = chunk.length;
                    }
                    else {
                        chunkSize = null;
                    }
                }

                if ( chunkSize == null ) {
                    this._setSize( null );
                    this.#sizeDefined = false;
                }
                else {
                    this._setSize( ( this.size ?? 0 ) + chunkSize );
                }
            }

            super.write( chunk, encoding, callback );
        }

        read ( size ) {

            // auto end stream on first read
            if ( this.#autoEnd && !this.writableEnded ) {
                this.end();
            }

            return super.read( size );
        }

        setSize ( size ) {
            return this;
        }

        // protected
        async _transform ( chunk, encoding, callback ) {

            // function
            if ( typeof chunk === "function" ) {
                try {
                    chunk = await chunk();

                    // ignore chunk
                    if ( chunk === undefined ) {
                        return callback();
                    }

                    // eof
                    else if ( chunk === null ) {
                        this.push( null );

                        return callback();
                    }
                }
                catch ( e ) {
                    return callback( e );
                }
            }

            if ( chunk instanceof stream.Readable ) {
                if ( chunk.errored ) {
                    return callback( chunk.errored );
                }
                else {
                    this.#callback = callback;

                    this.#setStream( chunk );

                    this.#read();
                }
            }
            else {
                if ( typeof chunk === "string" ) {
                    chunk = Buffer.from( chunk, encoding );
                }

                if ( Buffer.isBuffer( chunk ) ) {
                    this.push( chunk );

                    callback();
                }
                else {
                    callback( "Invalid chunk type" );
                }
            }
        }

        _read ( size ) {
            if ( this.#stream ) {
                this.#read();
            }
            else {
                super._read( size );
            }
        }

        _destroy ( e, callback ) {
            this.#destroy();

            callback( e );
        }

        _setSize ( size ) {
            if ( this.writableEnded ) {
                return this;
            }
            else {
                return super.setSize( size );
            }
        }

        // private
        #read () {
            if ( this.#stream.readableLength ) {
                this.push( this.#stream.read() );
            }
            else {
                this.#stream.once( "readable", this.#readableListener );
            }
        }

        #onReadable () {
            const chunk = this.#stream.read();

            if ( chunk != null ) {
                this.push( chunk );
            }
        }

        #onError ( e ) {}

        #onClose () {
            const error = this.#stream.readableAborted
                ? this.#stream.errored || "Unexpected end of stream"
                : null;

            this.#setStream();

            const callback = this.#callback;
            this.#callback = null;

            callback( error );
        }

        #setStream ( stream ) {
            if ( this.#stream ) {
                this.#stream.off( "readable", this.#readableListener );
                this.#stream.off( "error", this.#errorListener );
                this.#stream.off( "close", this.#closeListener );

                this.#stream.setMaxListeners( this.#stream.getMaxListeners() - 1 );

                this.#stream = null;
            }

            if ( stream ) {
                stream.setMaxListeners( stream.getMaxListeners() + 1 );

                stream.once( "error", this.#errorListener );
                stream.once( "close", this.#closeListener );

                this.#stream = stream;
            }
        }

        #destroy () {

            // destroy buffered streams
            const streams = this.#streams;
            this.#streams = null;

            for ( const stream of streams ) {
                stream.destroy();
            }

            // destroy current stream
            if ( this.#stream ) {
                const stream = this.#stream;

                this.#setStream();

                stream.destroy();
            }

            this.#callback = null;
        }
    };

export default class StreamJoiner extends mixins( DelayedTransformMixin, StreamJoinerMixin ) {}
