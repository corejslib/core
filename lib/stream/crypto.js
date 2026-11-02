import "#lib/result";
import crypto from "node:crypto";
import * as asn1js from "asn1js";
import RandomValues from "#lib/crypto/random-values";
import stream from "#lib/stream";

const DEFAULT_CIPHER = "AES-256-GCM",
    DEFAULT_AUTH_TAG_LENGTH = 16,
    AUTH_TAG_CIPHERS = new Set( [ "CHACHA20-POLY1305", "gcm", "gcm-siv", "ocb", "ccm" ] ),
    CIPHER_OID = {
        "id-aes128-gcm": "2.16.840.1.101.3.4.1.6",
        "id-aes192-gcm": "2.16.840.1.101.3.4.1.26",
        "id-aes256-gcm": "2.16.840.1.101.3.4.1.46",
        "id-aes128-wrap": "2.16.840.1.101.3.4.1.5",
        "id-aes192-wrap": "2.16.840.1.101.3.4.1.25",
        "id-aes256-wrap": "2.16.840.1.101.3.4.1.45",
    },
    CIPHERS = {},
    OID_AUTH_ENVELOPED_DATA = "1.2.840.113549.1.9.16.1.23",
    OID_CIPHER = {
        "2.16.840.1.101.3.4.1.6": "AES-128-GCM",
        "2.16.840.1.101.3.4.1.26": "AES-192-GCM",
        "2.16.840.1.101.3.4.1.46": "AES-256-GCM",
        "2.16.840.1.101.3.4.1.5": "AES-128-WRAP",
        "2.16.840.1.101.3.4.1.25": "AES-192-WRAP",
        "2.16.840.1.101.3.4.1.45": "AES-256-WRAP",
    },
    CLASS_UNIVERSAL = 0,
    CLASS_CONTEXT = 2,
    TAG_OCTET_STRING = 4,
    TAG_OID = 6,
    TAG_SEQUENCE = 16,
    TAG_SET = 17,
    TAG_KEK_RECIPIENT_INFO = 2,
    ASN1JS_CLASS_CONTEXT = 3,
    OID_DATA = "1.2.840.113549.1.7.1",
    WRAP_CIPHERS_BY_LENGTH = {
        "16": "AES-128-WRAP",
        "24": "AES-192-WRAP",
        "32": "AES-256-WRAP",
    },
    WRAP_IV = Buffer.alloc( 8, 0xA6 ),
    BER_OCTET_STRING = 0x04,
    BER_SEQUENCE = 0x30,
    BER_CONTEXT_0 = 0xA0,
    INDEFINITE_SEQUENCE = Buffer.from( [ BER_SEQUENCE, 0x80 ] ),
    INDEFINITE_CONTEXT_0 = Buffer.from( [ BER_CONTEXT_0, 0x80 ] ),
    EOC = Buffer.from( [ 0x00, 0x00 ] ),
    PEM_BEGIN = "-----BEGIN CMS-----\n",
    PEM_END = "-----END CMS-----\n",
    PEM_LINE_LENGTH = 64;

// public
export class StreamHash extends stream.Transform {
    #hash;
    #outputEncoding;

    constructor ( algorithm, { outputEncoding } = {} ) {
        super();

        this.#hash = crypto.createHash( algorithm );
        this.#outputEncoding = outputEncoding;
    }

    // protected
    _transform ( chunk, encoding, callback ) {
        this.#hash.update( chunk, encoding );

        callback();
    }

    _flush ( callback ) {
        callback( null, this.#hash.digest( this.#outputEncoding ) );

        this.#hash = null;
    }
}

export class StreamHmac extends stream.Transform {
    #hmac;
    #outputEncoding;

    constructor ( algorithm, key, { outputEncoding } = {} ) {
        super();

        this.#hmac = crypto.createHmac( algorithm, key );
        this.#outputEncoding = outputEncoding;
    }

    // protected
    _transform ( chunk, encoding, callback ) {
        this.#hmac.update( chunk, encoding );

        callback();
    }

    _flush ( callback ) {
        callback( null, this.#hmac.digest( this.#outputEncoding ) );

        this.#hmac = null;
    }
}

export class StreamEncryptor extends stream.Transform {
    #cipher;
    #header;
    #pem;
    #started = false;

    constructor ( { algorithm = DEFAULT_CIPHER, secret, secretId, format = "der" } = {} ) {
        super();

        if ( format !== "der" && format !== "pem" ) {
            throw new TypeError( `Unsupported output format "${ format }", expected "der" or "pem"` );
        }

        const cipherInfo = getCipherInfo( algorithm );

        const contentKey = Buffer.from( RandomValues.default.getRandomArrayBuffer( cipherInfo.keyLength ) ),
            iv = Buffer.from( RandomValues.default.getRandomArrayBuffer( cipherInfo.ivLength ) ),

            // secretId is optional, KEKIdentifier requires keyIdentifier, so an empty OCTET STRING is used when it is omitted
            kekInfo = this.#createKekInfo( contentKey, this.#toSecret( secret ), this.#toBytes( secretId ) ?? Buffer.alloc( 0 ) );

        this.#pem = format === "pem"
            ? new PemEncoder()
            : null;

        this.#cipher = crypto.createCipheriv( cipherInfo.name, contentKey, iv, {
            "authTagLength": cipherInfo.authTagLength,
        } );

        // ContentInfo ::= SEQUENCE { contentType, content [0] EXPLICIT }
        // AuthEnvelopedData ::= SEQUENCE { version 0, recipientInfos, authEncryptedContentInfo, mac OCTET STRING }
        // EncryptedContentInfo ::= SEQUENCE { contentType, contentEncryptionAlgorithm, encryptedContent [0] IMPLICIT }
        // GCMParameters ::= SEQUENCE { aes-nonce, aes-ICVlen }
        // encryptedContent is a constructed OCTET STRING, every produced chunk is a definite length segment
        this.#header = Buffer.concat( [

            //
            INDEFINITE_SEQUENCE,
            this.#toDer( new asn1js.ObjectIdentifier( { "value": OID_AUTH_ENVELOPED_DATA } ) ),
            INDEFINITE_CONTEXT_0,
            INDEFINITE_SEQUENCE,
            this.#toDer( new asn1js.Integer( { "value": 0 } ) ),
            this.#toDer( new asn1js.Set( { "value": [ kekInfo ] } ) ),
            INDEFINITE_SEQUENCE,
            this.#toDer( new asn1js.ObjectIdentifier( { "value": OID_DATA } ) ),
            this.#toDer( this.#algorithmIdentifier( cipherInfo.oid, new asn1js.Sequence( { "value": [ new asn1js.OctetString( { "valueHex": iv } ), new asn1js.Integer( { "value": cipherInfo.authTagLength } ) ] } ) ) ),
            INDEFINITE_CONTEXT_0,
        ] );
    }

    // protected
    _transform ( chunk, encoding, callback ) {
        try {
            this.#start();

            const out = this.#cipher.update( chunk );

            if ( out.length ) {
                this.#emit( this.#octets( out ) );
            }

            callback();
        }
        catch ( e ) {
            callback( e );
        }
    }

    _flush ( callback ) {
        try {
            this.#start();

            const last = this.#cipher.final(),
                parts = [];

            if ( last.length ) {
                parts.push( this.#octets( last ) );
            }

            // end of encryptedContent, end of EncryptedContentInfo
            parts.push( EOC, EOC );

            // mac
            parts.push( this.#octets( this.#cipher.getAuthTag() ) );

            // end of AuthEnvelopedData, end of [0] content, end of ContentInfo
            parts.push( EOC, EOC, EOC );

            this.#emit( Buffer.concat( parts ) );

            if ( this.#pem ) {
                this.push( `${ this.#pem.end() }${ PEM_END }` );
            }

            callback();
        }
        catch ( e ) {
            callback( e );
        }
    }

    // private
    #emit ( buffer ) {
        const out = this.#pem
            ? this.#pem.write( buffer )
            : buffer;

        if ( out.length ) {
            this.push( out );
        }
    }

    #start () {
        if ( this.#started ) {
            return;
        }

        this.#started = true;

        if ( this.#pem ) {
            this.push( PEM_BEGIN );
        }

        this.#emit( this.#header );
    }

    #toBytes ( value ) {
        if ( value == null ) {
            return null;
        }
        else if ( Buffer.isBuffer( value ) ) {
            return value;
        }
        else if ( typeof value === "number" ) {
            return Buffer.from( value.toString() );
        }
        else {
            return Buffer.from( value );
        }
    }

    // Buffer, hex string or a secret KeyObject (crypto.createSecretKey()).
    #toSecret ( value ) {
        if ( value instanceof crypto.KeyObject ) {
            if ( value.type !== "secret" ) {
                throw new TypeError( `Unsupported key object type "${ value.type }", expected "secret"` );
            }

            return value.export();
        }

        return this.#toBytes( value );
    }

    #encodeLength ( length ) {
        if ( length < 0x80 ) {
            return Buffer.from( [ length ] );
        }

        const bytes = [];

        while ( length > 0 ) {
            bytes.unshift( length & 0xFF );

            length >>>= 8;
        }

        return Buffer.from( [ 0x80 | bytes.length, ...bytes ] );
    }

    #octets ( data ) {
        return Buffer.concat( [ Buffer.from( [ BER_OCTET_STRING ] ), this.#encodeLength( data.length ), data ] );
    }

    #toDer ( element ) {
        return Buffer.from( element.toBER() );
    }

    #algorithmIdentifier ( id, params = null ) {
        return new asn1js.Sequence( {
            "value": [ new asn1js.ObjectIdentifier( { "value": id } ), ...( params
                ? [ params ]
                : [] ) ],
        } );
    }

    #createKekInfo ( contentKey, secret, secretId ) {
        const wrapCipherInfo = getCipherInfo( WRAP_CIPHERS_BY_LENGTH[ secret?.length ] );

        if ( !wrapCipherInfo ) {
            throw new TypeError( "options.secret (Buffer, hex string or SecretKeyObject) of 16, 24 or 32 bytes is required" );
        }

        const cipher = crypto.createCipheriv( wrapCipherInfo.name, secret, WRAP_IV ),
            wrapped = Buffer.concat( [ cipher.update( contentKey ), cipher.final() ] );

        return new asn1js.Constructed( {
            "idBlock": { "tagClass": ASN1JS_CLASS_CONTEXT, "tagNumber": TAG_KEK_RECIPIENT_INFO },
            "value": [

                //
                new asn1js.Integer( { "value": 4 } ),
                new asn1js.Sequence( { "value": [ new asn1js.OctetString( { "valueHex": secretId } ) ] } ),
                this.#algorithmIdentifier( wrapCipherInfo.oid ),
                new asn1js.OctetString( { "valueHex": wrapped } ),
            ],
        } );
    }
}

export class StreamDecryptor extends stream.Transform {
    #secret;
    #armor = new ArmorDecoder();
    #reader = new ByteReader( () => this.#releaseCallback() );
    #decipher = null;
    #callback = null;
    #task = null;
    #done = false;
    #flushing = false;
    #error = null;

    constructor ( { secret } ) {
        super();

        // a function is called with the key id (Buffer) found in the message and returns the key (Buffer, hex string or SecretKeyObject), may be async
        if ( typeof secret !== "function" ) {
            secret = this.#toSecret( secret );

            if ( !WRAP_CIPHERS_BY_LENGTH[ secret?.length ] ) {
                throw new TypeError( "options.secret (Buffer, hex string or SecretKeyObject) of 16, 24 or 32 bytes, or a function returning it, is required" );
            }
        }

        this.#secret = secret;
    }

    // protected
    _transform ( chunk, encoding, callback ) {

        // the structure has been fully read, whatever follows is ignored
        if ( this.#done ) {
            callback();

            return;
        }

        this.#callback = callback;

        this.#reader.feed( this.#armor.write( chunk ) );

        this.#task ??= this.#run();
    }

    async _flush ( callback ) {
        this.#flushing = true;

        this.#reader.feed( this.#armor.end() );
        this.#reader.end();

        this.#task ??= this.#run();

        await this.#task;

        callback( this.#error );
    }

    _destroy ( error, callback ) {
        this.#callback = null;

        // wakes up the parser, so it does not wait for data forever
        this.#reader.end();

        callback( error );
    }

    // private
    #releaseCallback () {
        const callback = this.#callback;

        this.#callback = null;

        callback?.();
    }

    #fail ( error ) {
        const callback = this.#callback;

        this.#callback = null;

        if ( callback ) {
            callback( error );
        }
        else if ( this.#flushing ) {
            this.#error = error;
        }
        else {
            this.destroy( error );
        }
    }

    async #readOid () {
        const reader = this.#reader,
            header = await reader.readHeader();

        this.#assertTag( header, CLASS_UNIVERSAL, TAG_OID, "OBJECT IDENTIFIER" );

        return this.#parseElement( await reader.readElement( header ) ).valueBlock.toString();
    }

    #update ( chunk ) {
        const out = this.#decipher.update( chunk );

        if ( out.length ) {
            this.push( out );
        }
    }

    async #content ( header ) {
        const reader = this.#reader;

        if ( !header.constructed ) {
            let remaining = header.length;

            while ( remaining > 0 ) {
                const part = await reader.readSome( remaining );

                remaining -= part.length;

                this.#update( part );
            }

            return;
        }

        const end = header.length == null
            ? null
            : reader.offset + header.length;

        while ( end == null || reader.offset < end ) {
            const child = await reader.readHeader();

            if ( reader.isEoc( child ) ) {
                if ( end == null ) {
                    return;
                }

                throw new Error( "Unexpected end-of-contents marker" );
            }

            if ( child.tagClass !== CLASS_UNIVERSAL || child.tagNumber !== TAG_OCTET_STRING ) {
                throw new Error( "Unexpected ASN.1 element inside encryptedContent" );
            }

            await this.#content( child );
        }
    }

    async #parse () {
        const reader = this.#reader;

        // ContentInfo ::= SEQUENCE { contentType, content [0] EXPLICIT }
        this.#assertTag( await reader.readHeader(), CLASS_UNIVERSAL, TAG_SEQUENCE, "ContentInfo" );

        if ( ( await this.#readOid() ) !== OID_AUTH_ENVELOPED_DATA ) {
            throw new Error( "CMS content type is not AuthEnvelopedData" );
        }

        this.#assertTag( await reader.readHeader(), CLASS_CONTEXT, 0, "[0] content" );

        // AuthEnvelopedData ::= SEQUENCE { version, originatorInfo [0] OPTIONAL, recipientInfos, authEncryptedContentInfo, authAttrs [1] OPTIONAL, mac, unauthAttrs [2] OPTIONAL }
        this.#assertTag( await reader.readHeader(), CLASS_UNIVERSAL, TAG_SEQUENCE, "AuthEnvelopedData" );

        // version
        await reader.readElement( await reader.readHeader() );

        let header = await reader.readHeader();

        // originatorInfo is not needed for KEK recipients
        if ( header.tagClass === CLASS_CONTEXT && header.tagNumber === 0 ) {
            await reader.readElement( header );

            header = await reader.readHeader();
        }

        this.#assertTag( header, CLASS_UNIVERSAL, TAG_SET, "recipientInfos" );

        const recipientInfos = this.#parseElement( await reader.readElement( header ) ).valueBlock.value;

        // EncryptedContentInfo ::= SEQUENCE { contentType, contentEncryptionAlgorithm, encryptedContent [0] IMPLICIT OPTIONAL }
        const contentInfo = await reader.readHeader();

        this.#assertTag( contentInfo, CLASS_UNIVERSAL, TAG_SEQUENCE, "EncryptedContentInfo" );

        const contentInfoEnd = contentInfo.length == null
            ? null
            : reader.offset + contentInfo.length;

        // contentType (id-data etc.), not used for decryption
        await this.#readOid();

        header = await reader.readHeader();

        this.#assertTag( header, CLASS_UNIVERSAL, TAG_SEQUENCE, "contentEncryptionAlgorithm" );

        const algorithm = this.#parseAlgorithm( this.#parseElement( await reader.readElement( header ) ) ),
            cipherInfo = getCipherInfo( OID_CIPHER[ algorithm.id ] );

        if ( !cipherInfo ) {
            throw new Error( `Unsupported content encryption algorithm ${ algorithm.id }, only AES-GCM is supported` );
        }

        const { iv, authTagLength } = this.#parseGcmParams( algorithm.params );

        this.#decipher = crypto.createDecipheriv( cipherInfo.name, await this.#unwrapKey( recipientInfos, this.#secret, cipherInfo.keyLength ), iv, { "authTagLength": authTagLength } );

        header = await reader.readHeader();

        if ( header.tagClass !== CLASS_CONTEXT || header.tagNumber !== 0 ) {
            throw new Error( "CMS has no encryptedContent (detached content is not supported)" );
        }

        await this.#content( header );

        if ( contentInfoEnd == null ) {
            if ( !reader.isEoc( await reader.readHeader() ) ) {
                throw new Error( "Missing end-of-contents marker of EncryptedContentInfo" );
            }
        }
        else if ( reader.offset !== contentInfoEnd ) {
            throw new Error( "Unexpected data at the end of EncryptedContentInfo" );
        }

        header = await reader.readHeader();

        if ( header.tagClass === CLASS_CONTEXT && header.tagNumber === 1 ) {
            throw new Error( "AuthEnvelopedData with authAttrs is not supported" );
        }

        this.#assertTag( header, CLASS_UNIVERSAL, TAG_OCTET_STRING, "mac" );

        if ( header.length !== authTagLength ) {
            throw new Error( "Authentication tag length does not match aes-ICVlen" );
        }

        this.#decipher.setAuthTag( await reader.read( header.length ) );

        const last = this.#decipher.final();

        if ( last.length ) {
            this.push( last );
        }
    }

    async #run () {
        try {
            await this.#parse();
        }
        catch ( e ) {
            this.#done = true;

            this.#fail( e );

            return;
        }

        this.#done = true;

        this.#releaseCallback();
    }

    #toBytes ( value ) {
        if ( value == null ) {
            return null;
        }
        else if ( Buffer.isBuffer( value ) ) {
            return value;
        }
        else if ( typeof value === "number" ) {
            return Buffer.from( value.toString() );
        }
        else {
            return Buffer.from( value );
        }
    }

    // Buffer, hex string or a secret KeyObject (crypto.createSecretKey()).
    #toSecret ( value ) {
        if ( value instanceof crypto.KeyObject ) {
            if ( value.type !== "secret" ) {
                throw new TypeError( `Unsupported key object type "${ value.type }", expected "secret"` );
            }

            return value.export();
        }

        return this.#toBytes( value );
    }

    #assertTag ( header, tagClass, tagNumber, name ) {
        if ( header.tagClass !== tagClass || header.tagNumber !== tagNumber ) {
            throw new Error( `Unexpected ASN.1 element, expected ${ name }` );
        }
    }

    // Parses one BER element from an in-memory buffer (definite or indefinite length), used for the small header structures only.
    #parseElement ( buffer ) {
        const { offset, result } = asn1js.fromBER( buffer );

        if ( offset === -1 ) {
            throw new Error( "Invalid ASN.1 structure in CMS" );
        }

        return result;
    }

    // Content octets of a primitive element.
    #bytes ( element ) {
        const view = element.valueBlock.valueHexView;

        return Buffer.from( view.buffer, view.byteOffset, view.byteLength );
    }

    // AlgorithmIdentifier ::= SEQUENCE { algorithm OBJECT IDENTIFIER, parameters ANY OPTIONAL }
    #parseAlgorithm ( element ) {
        const [ id, params ] = element?.valueBlock?.value ?? [];

        if ( !( id instanceof asn1js.ObjectIdentifier ) ) {
            throw new Error( "Invalid AlgorithmIdentifier" );
        }

        return {
            "id": id.valueBlock.toString(),
            "params": params ?? null,
        };
    }

    #parseGcmParams ( params ) {
        const [ nonce, icvLength ] = params?.valueBlock?.value ?? [];

        if ( !nonce?.valueBlock?.valueHexView?.length ) {
            throw new Error( "Missing content encryption parameters" );
        }

        return {
            "iv": this.#bytes( nonce ),
            "authTagLength": icvLength instanceof asn1js.Integer
                ? icvLength.valueBlock.valueDec
                : DEFAULT_AUTH_TAG_LENGTH,
        };
    }

    // KEKRecipientInfo ::= SEQUENCE { version, kekid KEKIdentifier, keyEncryptionAlgorithm, encryptedKey }
    // the content-encryption key is wrapped with a shared secret key (RFC 3394)
    #parseKekInfo ( info ) {
        const { tagClass, tagNumber, isConstructed } = info.idBlock;

        if ( tagClass !== ASN1JS_CLASS_CONTEXT || tagNumber !== TAG_KEK_RECIPIENT_INFO || !isConstructed ) {
            return null;
        }

        try {
            const [ , kekid, algorithm, encryptedKey ] = info.valueBlock.value,
                wrapCipherInfo = getCipherInfo( OID_CIPHER[ this.#parseAlgorithm( algorithm ).id ] );

            if ( !wrapCipherInfo ) {
                return null;
            }

            return {
                wrapCipherInfo,
                "id": this.#bytes( kekid.valueBlock.value[ 0 ] ),
                "encryptedKey": this.#bytes( encryptedKey ),
            };
        }
        catch {
            return null;
        }
    }

    // Tries every KEK recipient until one yields a key of the expected length.
    // secret is either the key itself or a function (may be async), called with the key id of the recipient to get the key.
    // An error thrown by the function is not swallowed, the key lookup has failed rather than the recipient has not matched.
    async #unwrapKey ( recipientInfos, secret, keyLength ) {
        for ( const info of recipientInfos ) {
            const kek = this.#parseKekInfo( info );

            if ( !kek ) {
                continue;
            }

            const wrapKey = typeof secret === "function"
                ? this.#toSecret( await secret( kek.id ) )
                : secret;

            if ( wrapKey?.length !== kek.wrapCipherInfo.keyLength ) {
                continue;
            }

            try {
                const decipher = crypto.createDecipheriv( kek.wrapCipherInfo.name, wrapKey, WRAP_IV ),
                    key = Buffer.concat( [ decipher.update( kek.encryptedKey ), decipher.final() ] );

                if ( key.length === keyLength ) {
                    return key;
                }
            }
            catch {}
        }

        throw new Error( "None of the CMS recipients matches the provided secret key" );
    }
}

export class StreamSigner extends stream.Transform {
    #sign;
    #privateKey;
    #outputEncoding;

    constructor ( algorithm, privateKey, { outputEncoding } = {} ) {
        super();

        this.#sign = crypto.createSign( algorithm );
        this.#privateKey = privateKey;
        this.#outputEncoding = outputEncoding;
    }

    // protected
    _transform ( chunk, encoding, callback ) {
        this.#sign.update( chunk, encoding );

        callback();
    }

    _flush ( callback ) {
        callback( null, this.#sign.sign( this.#privateKey, this.#outputEncoding ) );

        this.#sign = null;
    }
}

export function getCipherInfo ( algorithm ) {
    if ( typeof algorithm !== "string" ) return;

    let options = CIPHERS[ algorithm.toUpperCase() ];

    if ( !options ) {
        const cipherInfo = crypto.getCipherInfo( algorithm );

        if ( cipherInfo ) {
            options = {
                ...cipherInfo,
                "algorithm": algorithm.toUpperCase(),
                "authTagLength": null,
                "isSupported": true,
                "oid": CIPHER_OID[ cipherInfo.name ],
            };

            // NOTE: CCM ciphers are currently not supported due to algorithm limitations
            // NOTE: https://nodejs.org/api/crypto.html#ccm-mode
            if ( options.mode === "ccm" ) {
                options.isSupported = false;
            }

            // NOTE: siv ciphers are not supported currently
            // siv mode is only required when we use external iv and can't guarantee it's uniqueness
            // need to encrypt stream by blocks
            // each block should use own iv
            // block structure: block-size,iv,encrypted-data,auth-tag
            else if ( options.mode === "gcm-siv" ) {
                options.isSupported = false;
            }

            if ( AUTH_TAG_CIPHERS.has( options.mode ) || AUTH_TAG_CIPHERS.has( options.algorithm ) ) {
                options.authTagLength = DEFAULT_AUTH_TAG_LENGTH;
            }
        }
        else {
            return;
        }

        CIPHERS[ options.algorithm ] = options;
    }

    return options;
}

// private
class ArmorDecoder {
    #binary = null;
    #text = "";
    #base64 = "";
    #body = false;
    #seenHeader = false;
    #finished = false;

    // public
    write ( chunk ) {
        if ( !chunk.length ) {
            return chunk;
        }

        // 0x30 is a SEQUENCE tag, i.e. the beginning of the binary ContentInfo
        this.#binary ??= chunk[ 0 ] === 0x30;

        if ( this.#binary ) {
            return chunk;
        }

        if ( this.#finished ) {
            return Buffer.alloc( 0 );
        }

        this.#text += chunk.toString( "latin1" );

        const lines = this.#text.split( "\n" );

        this.#text = lines.pop();

        for ( const line of lines ) {
            this.#processLine( line );

            if ( this.#finished ) {
                break;
            }
        }

        return this.#decode( false );
    }

    end () {
        if ( this.#binary !== false ) {
            return Buffer.alloc( 0 );
        }

        if ( !this.#finished && this.#text.length ) {
            this.#processLine( this.#text );
        }

        this.#text = "";

        return this.#decode( true );
    }

    // private
    #processLine ( rawLine ) {
        const line = rawLine.trim();

        if ( !this.#body ) {
            if ( line.startsWith( "-----BEGIN" ) ) {
                this.#body = true;
            }
            else if ( line === "" ) {
                this.#body = this.#seenHeader;
            }
            else {
                this.#seenHeader = true;
            }

            return;
        }

        // "-----END ..." of PEM or a MIME boundary
        if ( line.startsWith( "-----" ) ) {
            this.#finished = true;

            return;
        }

        this.#base64 += line;
    }

    #decode ( final ) {
        const usable = final
            ? this.#base64.length
            : this.#base64.length - ( this.#base64.length % 4 );

        if ( !usable ) {
            return Buffer.alloc( 0 );
        }

        const decoded = Buffer.from( this.#base64.slice( 0, usable ), "base64" );

        this.#base64 = this.#base64.slice( usable );

        return decoded;
    }
}

class ByteReader {
    #chunks = [];
    #buffered = 0;
    #offset = 0;
    #ended = false;
    #waiter = null;
    #onStarve;

    constructor ( onStarve ) {
        this.#onStarve = onStarve;
    }

    // properties
    get offset () {
        return this.#offset;
    }

    // public
    isEoc ( header ) {
        return header.tagClass === CLASS_UNIVERSAL && header.tagNumber === 0 && !header.constructed && header.length === 0;
    }

    feed ( chunk ) {
        if ( chunk.length ) {
            this.#chunks.push( chunk );

            this.#buffered += chunk.length;
        }

        this.#wake();
    }

    end () {
        this.#ended = true;

        this.#wake();
    }

    async read ( size ) {
        if ( size === 0 ) {
            return Buffer.alloc( 0 );
        }

        if ( !( await this.#fill( size ) ) ) {
            throw new Error( "Unexpected end of CMS stream" );
        }

        const parts = [];

        let remaining = size;

        while ( remaining > 0 ) {
            const part = this.#takeFirst( remaining );

            parts.push( part );
            remaining -= part.length;
        }

        return Buffer.concat( parts );
    }

    // Reads 1 to `max` bytes without accumulating them in memory.
    async readSome ( max ) {
        if ( !( await this.#fill( 1 ) ) ) {
            throw new Error( "Unexpected end of CMS stream" );
        }

        return this.#takeFirst( max );
    }

    // Reads BER identifier + length octets.
    async readHeader () {
        const first = await this.read( 1 ),
            parts = [ first ];

        let tagNumber = first[ 0 ] & 0x1F;

        if ( tagNumber === 0x1F ) {
            tagNumber = 0;

            let byte;

            do {
                byte = await this.read( 1 );

                parts.push( byte );

                tagNumber = tagNumber * 128 + ( byte[ 0 ] & 0x7F );
            } while ( ( byte[ 0 ] & 0x80 ) !== 0 );
        }

        const lengthByte = await this.read( 1 ),
            constructed = ( first[ 0 ] & 0x20 ) !== 0;

        let length = lengthByte[ 0 ];

        parts.push( lengthByte );

        if ( length === 0x80 ) {
            if ( !constructed ) {
                throw new Error( "Indefinite length is allowed for constructed elements only" );
            }

            length = null;
        }
        else if ( length > 0x80 ) {
            const count = length & 0x7F;

            if ( count > 6 ) {
                throw new Error( "ASN.1 length is too large" );
            }

            const bytes = await this.read( count );

            parts.push( bytes );

            length = 0;

            for ( const byte of bytes ) {
                length = length * 256 + byte;
            }
        }

        return {
            "tagClass": first[ 0 ] >> 6,
            "tagNumber": tagNumber,
            "constructed": constructed,
            "length": length,
            "raw": Buffer.concat( parts ),
        };
    }

    // Reads the whole element (header included), supports indefinite length.
    async readElement ( header ) {
        if ( header.length != null ) {
            return Buffer.concat( [ header.raw, await this.read( header.length ) ] );
        }

        const parts = [ header.raw ];

        for ( ;; ) {
            const child = await this.readHeader();

            if ( this.isEoc( child ) ) {
                parts.push( child.raw );

                break;
            }

            parts.push( await this.readElement( child ) );
        }

        return Buffer.concat( parts );
    }

    // private
    #wake () {
        const waiter = this.#waiter;

        this.#waiter = null;

        waiter?.();
    }

    async #fill ( size ) {
        while ( this.#buffered < size ) {
            if ( this.#ended ) {
                return false;
            }

            // the waiter is set before the notification, because the notification may synchronously feed more data
            const wait = new Promise( resolve => {
                this.#waiter = resolve;
            } );

            this.#onStarve();

            await wait;
        }

        return true;
    }

    // Takes up to `max` bytes from the first buffered chunk.
    #takeFirst ( max ) {
        const chunk = this.#chunks[ 0 ],
            take = Math.min( chunk.length, max );

        if ( take === chunk.length ) {
            this.#chunks.shift();
        }
        else {
            this.#chunks[ 0 ] = chunk.subarray( take );
        }

        this.#buffered -= take;
        this.#offset += take;

        return chunk.subarray( 0, take );
    }
}

class PemEncoder {
    #pending = Buffer.alloc( 0 );
    #line = "";

    // public
    write ( chunk ) {
        this.#pending = Buffer.concat( [ this.#pending, chunk ] );

        const usable = this.#pending.length - ( this.#pending.length % 3 );

        if ( !usable ) {
            return "";
        }

        this.#line += this.#pending.subarray( 0, usable ).toBase64();

        this.#pending = this.#pending.subarray( usable );

        return this.#drain( false );
    }

    end () {
        this.#line += this.#pending.toBase64();

        this.#pending = Buffer.alloc( 0 );

        return this.#drain( true );
    }

    // protected
    #drain ( final ) {
        let text = "";

        while ( this.#line.length >= PEM_LINE_LENGTH || ( final && this.#line.length ) ) {
            text += `${ this.#line.slice( 0, PEM_LINE_LENGTH ) }\n`;

            this.#line = this.#line.slice( PEM_LINE_LENGTH );
        }

        return text;
    }
}
