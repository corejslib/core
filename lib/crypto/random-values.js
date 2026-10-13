const DEFAULT_BUFFER_LENGTH = 1024, // max 0xFFFF
    MAX_SAFE_INTEGER_BIGINT = BigInt( Number.MAX_SAFE_INTEGER );

var DEFAULT_RANDOM_VALUES;

export default class RandomValues {
    #uint8Array;
    #dataView;
    #offset;

    constructor ( length = DEFAULT_BUFFER_LENGTH ) {
        this.#uint8Array = new Uint8Array( length );
        this.#dataView = new DataView( this.#uint8Array.buffer );
        this.#offset = Infinity;
    }

    // static
    static get default () {
        DEFAULT_RANDOM_VALUES ??= new this( DEFAULT_BUFFER_LENGTH );

        return DEFAULT_RANDOM_VALUES;
    }

    // properties
    get length () {
        return this.#uint8Array.byteLength;
    }

    // public
    getRandomInt ( min = 0, max = 0 ) {
        const bigint = typeof min === "bigint" || typeof max === "bigint";

        if ( bigint ) {
            if ( typeof min !== "bigint" ) min = BigInt( min );

            if ( typeof max !== "bigint" ) max = BigInt( max );
        }

        if ( min > max ) [ min, max ] = [ max, min ];

        const bigintRange = bigint
            ? max - min
            : null;

        // fast path: range fits into a safe integer, avoids BigInt arithmetic entirely
        if ( !bigint || bigintRange <= MAX_SAFE_INTEGER_BIGINT ) {
            const range = bigint
                ? Number( bigintRange )
                : max - min;

            if ( !range ) return min;

            let value;

            // only pull as many random bits as the range actually needs
            if ( range <= 0xFFFF_FFFF ) {
                const bitsNeeded = 32 - Math.clz32( range ),
                    mask = bitsNeeded === 32
                        ? 0xFFFF_FFFF
                        : ( ( 1 << bitsNeeded ) >>> 0 ) - 1;

                while ( true ) {
                    value = ( this.#getRandomWord( bitsNeeded ) & mask ) >>> 0;

                    if ( value <= range ) break;
                }
            }
            else {
                const highPart = Math.floor( range / 0x1_0000_0000 ),
                    highBits = 32 - Math.clz32( highPart ),
                    highMask = ( ( 1 << highBits ) >>> 0 ) - 1;

                while ( true ) {
                    const low = this.getRandomUint32(),
                        high = ( this.#getRandomWord( highBits ) & highMask ) >>> 0;

                    value = high * 0x1_0000_0000 + low;

                    if ( value <= range ) break;
                }
            }

            return bigint
                ? min + BigInt( value )
                : min + value;
        }
        else {
            let value;

            const hexLen = bigintRange.toString( 16 ).length - 1,
                bitLen = hexLen << 2,
                topBits = 32 - Math.clz32( Number( bigintRange >> BigInt( bitLen ) ) ),
                bitLength = bitLen + topBits;

            while ( true ) {
                const bytes = this.getRandomUint8Subarray( Math.ceil( bitLength / 8 ) ),
                    bits = bitLength % 8;

                value = BigInt( bytes[ 0 ] );

                if ( bits ) {
                    value = value >> ( 8n - BigInt( bits ) );
                }

                for ( let n = 1; n < bytes.byteLength; n++ ) {
                    value = ( value << 8n ) | BigInt( bytes[ n ] );
                }

                if ( value <= bigintRange ) break;
            }

            return value + min;
        }
    }

    getRandomBinary () {
        this.#check( 1 );

        const value = this.#dataView.getUint8( this.#offset );

        this.#offset += 1;

        return value & 1;
    }

    getRandomInt8 () {
        this.#check( 1 );

        const value = this.#dataView.getInt8( this.#offset );

        this.#offset += 1;

        return value;
    }

    getRandomUint8 () {
        this.#check( 1 );

        const value = this.#dataView.getUint8( this.#offset );

        this.#offset += 1;

        return value;
    }

    getRandomInt16 () {
        this.#check( 2 );

        const value = this.#dataView.getInt16( this.#offset );

        this.#offset += 2;

        return value;
    }

    getRandomUint16 () {
        this.#check( 2 );

        const value = this.#dataView.getUint16( this.#offset );

        this.#offset += 2;

        return value;
    }

    getRandomInt32 () {
        this.#check( 4 );

        const value = this.#dataView.getInt32( this.#offset );

        this.#offset += 4;

        return value;
    }

    getRandomUint32 () {
        this.#check( 4 );

        const value = this.#dataView.getUint32( this.#offset );

        this.#offset += 4;

        return value;
    }

    getRandomInt53 () {
        return this.getRandomInt( Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER );
    }

    getRandomUint53 () {
        return this.getRandomInt( 0, Number.MAX_SAFE_INTEGER );
    }

    getRandomInt64 () {
        this.#check( 8 );

        const value = this.#dataView.getBigInt64( this.#offset );

        this.#offset += 8;

        return value;
    }

    getRandomUint64 () {
        this.#check( 8 );

        const value = this.#dataView.getBigUint64( this.#offset );

        this.#offset += 8;

        return value;
    }

    getRandomArrayBuffer ( length ) {
        this.#check( length );

        const array = this.#uint8Array.buffer.slice( this.#offset, this.#offset + length );

        this.#offset += length;

        return array;
    }

    getRandomUint8Array ( length ) {
        this.#check( length );

        const array = this.#uint8Array.slice( this.#offset, this.#offset + length );

        this.#offset += length;

        return array;
    }

    getRandomUint8Subarray ( length ) {
        this.#check( length );

        const array = this.#uint8Array.subarray( this.#offset, this.#offset + length );

        this.#offset += length;

        return array;
    }

    getRandomUint32Array ( length ) {
        this.#offset = Math.ceil( this.#offset / 4 ) * 4;

        this.#check( length * 4 );

        const array = new Uint32Array( this.#uint8Array.buffer.slice( this.#offset, this.#offset + length * 4 ) );

        this.#offset += length * 4;

        return array;
    }

    getRandomUint32Subarray ( length ) {
        this.#offset = Math.ceil( this.#offset / 4 ) * 4;

        this.#check( length * 4 );

        const array = new Uint32Array( this.#uint8Array.buffer, this.#offset, length );

        this.#offset += length * 4;

        return array;
    }

    getRandomDigit () {
        while ( true ) {
            let byte = this.getRandomUint8(),
                digit;

            digit = byte & 0b1111;
            if ( digit <= 9 ) return digit;

            byte = byte >> 4;

            digit = byte & 0b1111;
            if ( digit <= 9 ) return digit;
        }
    }

    getRandomDigits ( length = 2 ) {
        const digits = [];

        while ( digits.length < length ) {
            let byte = this.getRandomUint8(),
                digit;

            digit = byte & 0b1111;
            if ( digit <= 9 ) digits.push( digit );

            if ( digits.length === length ) break;

            byte = byte >> 4;

            digit = byte & 0b1111;
            if ( digit <= 9 ) digits.push( digit );
        }

        return digits;
    }

    // private
    #check ( byteLength ) {
        if ( byteLength > this.#uint8Array.byteLength ) throw new Error( "Read length is too large" );

        if ( this.#offset + byteLength > this.#uint8Array.byteLength ) {
            globalThis.crypto.getRandomValues( this.#uint8Array );

            this.#offset = 0;
        }
    }

    #getRandomWord ( bitsNeeded ) {
        if ( bitsNeeded <= 8 ) return this.getRandomUint8();

        if ( bitsNeeded <= 16 ) return this.getRandomUint16();

        return this.getRandomUint32();
    }
}
