import { fromMsgPackStream, toMsgPack } from "#lib/msgpack";
import stream from "#lib/stream";

export class MsgpackStreamEncoder extends stream.Transform {
    constructor () {
        super( { "writableObjectMode": true } );
    }

    // protected
    _transform ( chunk, encoding, callback ) {
        try {
            const data = toMsgPack( chunk );

            this.push( data );

            callback();
        }
        catch ( e ) {
            callback( e );
        }
    }
}

export class MsgpackStreamDecoder extends stream.Transform {
    #buf;
    #offset = 0;

    constructor () {
        super( { "readableObjectMode": true } );
    }

    _transform ( data, encoding, callback ) {
        if ( !this.#buf ) {
            this.#buf = data;
        }
        else {
            this.#buf = Buffer.concat( [ this.#buf, data ] );
        }

        while ( true ) {
            try {
                const { value, offset } = fromMsgPackStream( this.#buf, this.#offset ) || {};

                // data is incomplete
                if ( offset == null ) {

                    // remove processed data
                    if ( this.#offset ) {
                        this.#buf = this.#buf.subarray( this.#offset );
                        this.#offset = 0;
                    }

                    break;
                }

                this.push( value );

                this.#offset = offset;

                // all data processed
                if ( this.#offset === this.#buf.length ) {
                    this.#buf = null;
                    this.#offset = 0;
                    break;
                }
            }
            catch ( e ) {
                callback( e );

                return;
            }
        }

        callback();
    }
}
