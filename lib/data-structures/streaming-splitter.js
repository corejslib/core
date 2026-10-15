export default class StreamSearch {
    #eol;
    #eolBuffer;
    #buffer = Buffer.alloc( 0 );
    #isEnded = false;

    constructor ( eol ) {
        this.#eol = eol;

        this.#eolBuffer = Buffer.from( this.#eol );

        if ( !this.#eolBuffer.length ) throw new Error( "EOL must not be empty" );
    }

    // properties
    get eol () {
        return this.#eol;
    }

    get buffer () {
        return this.#buffer;
    }

    get isEnded () {
        return this.#isEnded;
    }

    // public
    push ( chunk, encoding ) {
        if ( typeof chunk === "string" ) {
            chunk = Buffer.from( chunk, encoding );
        }
        else if ( !Buffer.isBuffer( chunk ) ) {

            // Uint8Array and other views: Buffer-specific methods (indexOf( Buffer ), etc.) are required below
            chunk = Buffer.from( chunk.buffer, chunk.byteOffset, chunk.byteLength );
        }

        if ( this.#buffer.length ) {
            this.#buffer = Buffer.concat( [ this.#buffer, chunk ] );
        }
        else {
            this.#buffer = chunk;
        }

        const data = [],
            buf = this.#buffer,
            eol = this.#eolBuffer,
            eolLen = eol.length;

        let start = 0,
            cut;

        while ( true ) {

            // native, SIMD/Boyer-Moore-accelerated search instead of a manual byte-by-byte scan
            const idx = buf.indexOf( eol, start );

            // full match found
            if ( idx !== -1 ) {
                if ( start < idx ) data.push( buf.subarray( start, idx ) );
                data.push( null );

                start = idx + eolLen;

                continue;
            }

            // no full match left in the buffer - check only the last (eolLen - 1) bytes
            // for a partial match straddling the chunk boundary
            let partialAt = -1;

            if ( eolLen > 1 ) {
                const searchFrom = Math.max( start, buf.length - eolLen + 1 );

                for ( let pos = searchFrom; pos < buf.length; pos++ ) {
                    if ( buf[ pos ] !== eol[ 0 ] ) continue;

                    const maxLen = buf.length - pos;

                    let matched = true;

                    for ( let j = 1; j < maxLen; j++ ) {
                        if ( buf[ pos + j ] !== eol[ j ] ) {
                            matched = false;

                            break;
                        }
                    }

                    if ( matched ) {
                        partialAt = pos;

                        break;
                    }
                }
            }

            if ( partialAt === -1 ) {
                if ( start < buf.length ) data.push( buf.subarray( start, buf.length ) );

                cut = buf.length;
            }
            else {
                if ( start < partialAt ) data.push( buf.subarray( start, partialAt ) );

                cut = partialAt;
            }

            break;
        }

        // keep only the unprocessed tail (a possible partial EOL). It is copied, so the internal
        // buffer neither aliases the caller's memory nor keeps the whole chunk alive
        this.#buffer = cut === buf.length
            ? Buffer.alloc( 0 )
            : Buffer.from( buf.subarray( cut ) );

        // the stream is at a line boundary only if the last token is EOL and no partial EOL is pending
        if ( data.length ) {
            this.#isEnded = data.at( -1 ) === null && !this.#buffer.length;
        }
        else if ( this.#buffer.length ) {
            this.#isEnded = false;
        }

        return data;
    }

    end () {
        const data = this.flush();

        if ( !this.#isEnded ) {
            this.#isEnded = true;

            data.push( null );
        }

        return data;
    }

    flush () {
        if ( this.#buffer.length ) {
            const buffer = this.#buffer;
            this.#buffer = Buffer.alloc( 0 );

            this.#isEnded = false;

            return [ buffer ];
        }
        else {
            return [];
        }
    }
}
