import Events from "#lib/events";
import FormData from "#lib/form-data";
import Headers from "#lib/http/headers";
import HttpMessage from "#lib/http/message";
import IpAddress from "#lib/ip/address";
import subnets from "#lib/ip/subnets";
import stream, { Readable } from "#lib/stream";

const localAddress = new IpAddress( "127.0.0.1" );

export default class Request extends Events {
    #server;
    #res;
    #socketContext;

    #isAborted;
    #isEnded = false;

    #method;
    #clientRemoteAddress;
    #remoteAddress;
    #headers;
    #url;
    #path;
    #hasBody;
    #bodyUsed = false;
    #body;
    #endEventSent;
    #abortController = new AbortController();

    constructor ( server, req, res, socketContext ) {
        super();

        this.#server = server;
        this.#res = res;
        this.#socketContext = socketContext;

        this.#method = req.getMethod();

        // headers
        this.#headers = new Headers();
        req.forEach( ( key, value ) => this.#headers.add( key, value ) );

        // has body
        this.#hasBody = !!( this.headers.contentLength || this.headers.get( "transfer-encoding" )?.toLowerCase().includes( "chunked" ) );

        // remote address
        this.#clientRemoteAddress = this.#res.getProxiedRemoteAddressAsText();
        if ( !this.#clientRemoteAddress.byteLength ) this.#clientRemoteAddress = this.#res.getRemoteAddressAsText();
        this.#clientRemoteAddress = this.#clientRemoteAddress.byteLength
            ? new IpAddress( Buffer.from( this.#clientRemoteAddress ).toString() )
            : localAddress;

        // url
        var url = "http://" + ( this.headers.get( "host" ) || this.#clientRemoteAddress.toString() ) + req.getUrl() + ( req.getQuery()
            ? "?" + req.getQuery()
            : "" );

        try {
            this.#url = new URL( url );
        }
        catch {
            this.#url = null;
        }

        this.#res.onAborted( this.#onAborted.bind( this ) );
    }

    // properties
    get isAborted () {
        return this.#isAborted;
    }

    get isEnded () {
        return this.#isEnded;
    }

    get abortSignal () {
        return this.#abortController.signal;
    }

    get clientRemoteAddress () {
        return this.#clientRemoteAddress;
    }

    get remoteAddress () {
        if ( !this.#remoteAddress ) {
            this.#remoteAddress = this.clientRemoteAddress;

            if ( this.#server.realIpHeader && this.#server.setRealIpFrom && this.#isIpAddressTrusted( this.clientRemoteAddress ) ) {
                const addresses = this.headers.get( this.#server.realIpHeader )?.split( "," );

                if ( addresses ) {
                    while ( addresses.length ) {
                        try {
                            this.#remoteAddress = new IpAddress( addresses.pop().trim() );

                            if ( !this.#isIpAddressTrusted( this.#remoteAddress ) ) break;
                        }
                        catch {
                            break;
                        }
                    }
                }
            }
        }

        return this.#remoteAddress;
    }

    get method () {
        return this.#method;
    }

    get headers () {
        return this.#headers;
    }

    get url () {
        return this.#url;
    }

    get path () {
        if ( this.#path === undefined ) {
            if ( this.url ) {
                this.#path = decodeURI( this.url.pathname );
            }
            else {
                this.#path = null;
            }
        }

        return this.#path;
    }

    // TODO: https://github.com/uNetworking/uWebSockets.js/issues/1095
    get hasBody () {
        return this.#hasBody;
    }

    get bodyUsed () {
        return this.#bodyUsed;
    }

    get body () {
        if ( !this.#body ) {
            this.#body = new Readable( { read () {} } );

            this.#body.setType( this.headers.get( "content-type" ) );
            this.#body.setSize( this.headers.contentLength );

            const abortHandler = () => this.#body.destroy( "HTTP request aborted" );

            this.once( "abort", abortHandler );

            this.#res.onData( ( arrayBuffer, isLast ) => {

                // make a copy of array buffer
                this.#body.push( Buffer.concat( [ Buffer.from( arrayBuffer ) ] ) );

                // eof
                if ( isLast ) {
                    this.#bodyUsed = true;

                    this.off( "abort", abortHandler );

                    this.#body.push( null );
                }
            } );
        }

        return this.#body;
    }

    // public
    async end ( options ) {
        if ( this.#isAborted || this.#isEnded ) return;

        this.#isEnded = true;

        await this.#end( options );

        this.#onEnd();
    }

    // also calls abort callbacks
    close ( status ) {
        if ( this.#isAborted ) return;

        if ( status ) {
            if ( typeof status !== "number" ) throw new Error( "Status must be a number" );

            status = result.getHttpStatus( status );
            status += " " + result.getStatusText( status );

            this.#res.cork( () => {

                // write status
                this.#res.writeStatus( status );

                // write body buffer
                this.#res.endWithoutBody( 0, true );
            } );

            this.#onEnd();
        }
        else {
            this.#res.close();
        }
    }

    upgrade ( { data, key, protocol, extensions } = {} ) {
        if ( this.#isAborted || this.#isEnded ) return;

        this.#isEnded = true;

        key ??= this.headers.get( "sec-websocket-key" );
        protocol ??= this.headers.get( "sec-websocket-protocol" );
        extensions ??= this.headers.get( "sec-websocket-extensions" );

        this.#res.cork( () => {
            this.#res.upgrade(
                {
                    "remoteAddress": this.remoteAddress,
                    data,
                },
                key,
                protocol,
                extensions,
                this.#socketContext
            );
        } );

        this.#onEnd();
    }

    // body methods
    async buffer ( { maxLength } = {} ) {
        return this.body.buffer( { maxLength } );
    }

    async json ( { maxLength } = {} ) {
        return this.body.json( { maxLength } );
    }

    async text ( { maxLength, encoding } = {} ) {
        return this.body.text( { maxLength, encoding } );
    }

    async arrayBuffer ( { maxLength } = {} ) {
        return this.body.arrayBuffer( { maxLength } );
    }

    async blob ( { maxLength, type } = {} ) {
        return this.body.blob( {
            maxLength,
            "type": type || this.headers.get( "content-type" ),
        } );
    }

    async tmpFile ( options ) {
        return this.body.tmpFile( {
            "type": this.headers.get( "content-type" ),
            ...options,
        } );
    }

    async formData ( { maxBufferLength, maxFileSize } = {} ) {
        return FormData.parse( this.body, {
            "boundary": this.headers.contentType?.boundary,
            maxBufferLength,
            maxFileSize,
        } );
    }

    // private
    #onAborted () {
        if ( this.#isAborted ) return;

        this.#isAborted = true;
        this.#isEnded = true;

        this.#abortController.abort();

        this.emit( "abort" );

        this.#onEnd();
    }

    #isIpAddressTrusted ( address ) {
        for ( const subnet of this.#server.setRealIpFrom ) {
            if ( subnets.get( subnet )?.includes( address ) ) return true;
        }
    }

    async #end ( httpMessage ) {
        httpMessage = HttpMessage.new( httpMessage );

        const methodIsHead = this.method === "head";

        httpMessage.checkBody();

        httpMessage.checkCache( this.method, this.headers );

        await httpMessage.checkBodyFunction();

        await httpMessage.checkHttpRange( this.headers, {
            "createBody": !methodIsHead,
            "maxRanges": 10,
        } );

        await httpMessage.checkCompression( this.headers, {
            "createBody": !methodIsHead,
            "compress": this.#server.httpCompress,
            "zlibOptions": this.#server.zlibOptions,
        } );

        const contentLength = httpMessage.contentLength;
        httpMessage.headers.delete( "content-length" );
        httpMessage.headers.delete( "transfer-encoding" );

        // add content-length header
        if ( httpMessage.hasBody ) {

            // only for HEAD method
            if ( methodIsHead ) {
                httpMessage.body?.destroy();

                // chunked transfer
                if ( contentLength == null ) {
                    httpMessage.headers.set( "transfer-encoding", "chunked" );
                }

                // know content length
                else {
                    httpMessage.headers.set( "content-length", contentLength );
                }
            }
        }
        else {
            httpMessage.headers.set( "content-length", 0 );
        }

        const body = httpMessage.createBody();

        // write head
        this.#res.cork( () => {

            // write status
            this.#res.writeStatus( httpMessage.status + " " + httpMessage.statusText );

            // write headers
            for ( const [ header, value ] of httpMessage.headers.entries() ) {
                if ( Array.isArray( value ) ) {
                    for ( const data of value ) {
                        this.#res.writeHeader( httpMessage.headers.getOriginalName( header ), data );
                    }
                }
                else {
                    this.#res.writeHeader( httpMessage.headers.getOriginalName( header ), value );
                }
            }

            // no body
            if ( !body ) {
                this.#res.endWithoutBody();
            }

            // write body buffer
            else if ( Buffer.isBuffer( body ) ) {
                this.#res.end( body );
            }
        } );

        // write body stream
        if ( body instanceof stream.Readable ) {
            await this.#writeStream( body, contentLength );
        }
    }

    async #writeStream ( stream, contentLength ) {
        this.once( "abort", () => stream.destroy() );

        var ok, done, chunk, lastOffset;

        return new Promise( resolve => {
            stream.once( "close", resolve );

            stream.once( "error", () => this.close() );

            stream.once( "end", () => {

                // end request, if chunked transfer was used
                if ( !this.#isAborted && !contentLength ) {
                    this.#res.cork( () => {
                        this.#res.endWithoutBody();
                    } );
                }
            } );

            stream.on( "data", buffer => {
                chunk = buffer;

                // first try
                if ( contentLength ) {
                    lastOffset = this.#res.getWriteOffset();

                    this.#res.cork( () => {
                        [ ok, done ] = this.#res.tryEnd( chunk, contentLength );
                    } );
                }
                else {
                    this.#res.cork( () => {
                        ok = this.#res.write( chunk );
                    } );
                }

                // all data sent to client
                if ( done ) {
                    stream.destroy();
                }

                // backpressure
                else if ( !ok ) {

                    // pause because backpressure
                    stream.pause();

                    this.#res.onWritable( offset => {
                        if ( !contentLength ) {
                            stream.resume();

                            return true;
                        }
                        else {

                            // only buffers are supported
                            this.#res.cork( () => {
                                [ ok, done ] = this.#res.tryEnd( chunk.subarray( offset - lastOffset ), contentLength );
                            } );

                            // all data sent to client
                            if ( done ) {
                                stream.destroy();
                            }

                            // no backpressure
                            else if ( ok ) {
                                stream.resume();
                            }

                            return ok;
                        }
                    } );
                }
            } );
        } );
    }

    #onEnd () {
        if ( this.#endEventSent ) return;

        this.#endEventSent = true;

        this.emit( "end" );
    }
}
