import Events from "#lib/events";
import Headers from "#lib/http/headers";
import IpAddress from "#lib/ip/address";
import subnets from "#lib/ip/subnets";
import Message from "#lib/message";
import stream, { Readable } from "#lib/stream";
import { MultipartStreamDecoder } from "#lib/stream/multipart";

const localAddress = new IpAddress( "127.0.0.1" );

export default class HttpRequest extends Events {
    #server;
    #res;
    #socketContext;

    #isAborted = false;
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
    #endEventSent = false;
    #abortController = new AbortController();

    constructor ( server, req, res, socketContext ) {
        super();

        this.#server = server;
        this.#res = res;
        this.#socketContext = socketContext;

        this.#method = req.getMethod().toUpperCase();

        // headers
        this.#headers = new Headers();
        req.forEach( ( key, value ) => this.#headers.add( key, value ) );

        // has body
        this.#hasBody = Boolean( this.headers.contentLength.bytes || this.headers.transferEncoding.chunked );

        // remote address
        this.#clientRemoteAddress = this.#res.getProxiedRemoteAddressAsText();
        if ( !this.#clientRemoteAddress.byteLength ) this.#clientRemoteAddress = this.#res.getRemoteAddressAsText();
        this.#clientRemoteAddress = this.#clientRemoteAddress.byteLength
            ? new IpAddress( Buffer.from( this.#clientRemoteAddress ).toString() )
            : localAddress;

        // url
        const path = req.getUrl(),
            query = req.getQuery();

        var url;

        // invalid host header or ipv6 address must not break the request
        try {
            url = new URL( "http://" + ( this.headers.get( "host" ) || this.#clientRemoteAddress.toString() ) );
        }
        catch {
            url = new URL( "http://localhost" );
        }

        url.pathname = path;

        if ( query ) {
            url.search = "?" + query;
        }

        this.#url = url;

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
            this.#path = decodeURI( this.#url.pathname );
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
        if ( this.hasBody ) {
            if ( !this.#body ) {
                this.#body = new Readable( { read () {} } );

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
        }

        return this.#body;
    }

    // public
    async end ( options ) {
        if ( this.#isAborted || this.#isEnded ) return;

        this.#isEnded = true;

        try {
            await this.#end( options );
        }
        finally {

            // "end" event must be emitted even if the response failed
            this.#onEnd();
        }
    }

    // also calls abort callbacks
    close ( status ) {

        // already aborted, or the response is finished
        if ( this.#isAborted || this.#endEventSent ) return;

        // status can be sent only if the response is not started yet
        if ( status && !this.#isEnded ) {
            if ( typeof status !== "number" ) throw new Error( "Status must be a number" );

            this.#isEnded = true;

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
    async arrayBuffer ( { maxLength } = {} ) {
        return this.body?.arrayBuffer( { maxLength } );
    }

    async blob ( { maxLength, type } = {} ) {
        return this.body?.blob( {
            maxLength,
            type,
        } );
    }

    async buffer ( { maxLength } = {} ) {
        return this.body?.buffer( { maxLength } );
    }

    async bytes ( { maxLength } = {} ) {
        return this.body?.bytes( { maxLength } );
    }

    async json ( { maxLength } = {} ) {
        return this.body?.json( { maxLength } );
    }

    async text ( { maxLength, encoding } = {} ) {
        return this.body?.text( { maxLength, encoding } );
    }

    async toTmpFile ( { maxLength, ...tmpFileOptions } = {} ) {
        return this.body?.toTmpFile( {
            maxLength,
            ...tmpFileOptions,
        } );
    }

    toMessage () {
        return new Message( {
            "headers": this.headers,
            "body": this.body,
        } );
    }

    async parseMultipartBody ( { maxContentLength, maxBufferLength } = {} ) {
        return MultipartStreamDecoder.parseMultipartStream( this.body, {
            "boundary": this.headers.contentType.boundary,
            maxContentLength,
            maxBufferLength,
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
            if ( subnets.get( subnet )?.hasRangesIntersecting( address ) ) return true;
        }
    }

    async #end ( message ) {
        await using asyncDisposableStack = new AsyncDisposableStack();

        message = Message.new( message );
        asyncDisposableStack.use( message );

        const methodIsHead = this.method === "HEAD";

        // check file exists
        await message.checkBody();

        // check cache
        message.checkCache( this.method, this.headers );

        // add content-encoding middleware
        message.addContentEncodingMiddleware( {
            "headers": this.headers,
            "compress": this.#server.httpCompress,
            "zlibOptions": this.#server.zlibOptions,
        } );

        // add range middleware
        message.addContentRangeMiddleware( {
            "headers": this.headers,
            "maxRanges": 10,
        } );

        // add transfer-encoding middleware
        message.addTransferEncodingMiddleware( {
            "headers": this.headers,
            "compress": this.#server.httpCompress,
            "zlibOptions": this.#server.zlibOptions,
        } );

        var contentLength,
            body = await message.createBody();

        message.headers.transferEncoding.deleteChunked();

        if ( body == null ) {
            message.headers.contentLength.set( 0 );
        }
        else if ( methodIsHead ) {
            if ( body instanceof stream.Readable ) {
                body.destroy();

                message.headers.transferEncoding.setChunked();
            }

            body = null;
        }
        else {
            contentLength = message.contentLength;
            message.headers.contentLength.delete();
        }

        // write head
        this.#res.cork( () => {

            // write status
            this.#res.writeStatus( message.status + " " + message.statusText );

            // write headers
            for ( const [ name, value ] of message.headers.entries() ) {
                this.#res.writeHeader( name, value );
            }

            // no body
            if ( body == null ) {
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

        // begins chunked encoding mode and flushes headers immediately
        // if ( !contentLength ) {
        //     this.#res.cork( () => {
        //         this.#res.beginWrite();
        //     } );
        // }

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
