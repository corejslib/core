import "#lib/stream";
import net from "node:net";
import { resolve4 } from "#lib/dns";
import IpAddress from "#lib/ip/address";
import subnets from "#lib/ip/subnets";
import { connect, getDefaultPort } from "#lib/net";
import ProxyClient from "./client.js";

export default class ProxyServer extends net.Server {
    #address;
    #port;
    #proxy;
    #authorize;
    #checkConnection;
    #trustedSubnets;

    #sessionStarted;
    #bytesRead = 0;
    #bytesWritten = 0;

    // auth: async ( connection, password )
    // proxy: async ( connection )
    constructor ( { address, port, proxy, authorize, checkConnection, trustedSubnets } = {} ) {
        super();

        this.#address = address || "127.0.0.1";
        this.#port = port || 0;
        this.proxy = proxy;
        this.#authorize = authorize;
        this.#checkConnection = checkConnection;

        if ( trustedSubnets ) {
            if ( trustedSubnets === true ) {
                this.#trustedSubnets = true;
            }
            else {
                this.#trustedSubnets = Array.isArray( trustedSubnets )
                    ? trustedSubnets
                    : [ trustedSubnets ];
            }
        }
    }

    // properties
    get address () {
        return this.#address;
    }

    get port () {
        return this.#port;
    }

    get proxy () {
        return this.#proxy;
    }

    set proxy ( value ) {
        if ( !value ) this.#proxy = null;
        else if ( typeof value === "function" ) this.#proxy = value;
        else if ( Array.isArray( value ) ) this.#proxy = ProxyClient.new( ...value );
        else this.#proxy = ProxyClient.new( value );
    }

    // public
    async start ( { address, port } = {} ) {
        port ||= this.#port;

        if ( address ) this.#address = address;

        return new Promise( resolve => {
            this.on( "connection", this.#onConnect.bind( this ) );

            this.once( "listening", () => {
                this.#port = super.address().port;

                resolve( result( 200 ) );
            } );

            super.listen( port, this.#address );
        } );
    }

    createProxyClient ( options = {} ) {
        if ( !this.port ) return;

        return ProxyClient.new( "cproxy:", {
            ...options,
            "hostname": this.address,
            "port": this.port,
        } );
    }

    getPlaywrightProxy () {
        return {
            "server": "socks5://" + this.address + ":" + this.port,
        };
    }

    startSession () {
        this.#sessionStarted = true;

        this.#bytesRead = 0;
        this.#bytesWritten = 0;
    }

    endSession () {
        this.#sessionStarted = false;

        const stat = {
            "bytesRead": this.#bytesRead,
            "bytesWritten": this.#bytesWritten,
        };

        this.#bytesRead = 0;
        this.#bytesWritten = 0;

        return stat;
    }

    // private
    async #onConnect ( clientSocket ) {
        var chunk,
            remoteAddress = new IpAddress( clientSocket.remoteAddress );

        while ( true ) {
            chunk = await clientSocket.readChunk( 1 ).catch( e => null );
            if ( !chunk ) return clientSocket.end();

            // socks5 connection
            if ( chunk[ 0 ] === 0x05 ) return this.#processSocks5Connection( clientSocket, remoteAddress );

            // read method
            let method = await clientSocket.readLine( { "eol": " ", "encoding": "latin1", "maxLength": 10 } ).catch( e => null );
            if ( !method ) return clientSocket.end();

            method = chunk.toString( "latin1" ) + method;

            // proxy protocol
            if ( method === "PROXY" ) {
                let proxyProtocolHeader = await clientSocket.readLine( { "eol": "\r\n", "encoding": "latin1", "maxLength": 1000 } ).catch( e => null );
                if ( !proxyProtocolHeader ) return clientSocket.end();

                // proxy protocol disabled
                if ( !this.#trustedSubnets ) continue;

                let proxyProtocolTrusted;

                // check proxy protocol trusted subnets
                if ( this.#trustedSubnets === true ) {
                    proxyProtocolTrusted = true;
                }
                else {
                    for ( const subnet of this.#trustedSubnets ) {
                        if ( subnets.get( subnet )?.hasRangesIntersecting( remoteAddress ) ) {
                            proxyProtocolTrusted = true;

                            break;
                        }
                    }
                }

                // proxy protocol is trusted
                if ( proxyProtocolTrusted ) {
                    proxyProtocolHeader = proxyProtocolHeader.split( " " );

                    if ( proxyProtocolHeader[ 0 ] !== "UNKNOWN" ) {
                        try {
                            remoteAddress = new IpAddress( proxyProtocolHeader[ 1 ] );
                        }
                        catch {
                            return clientSocket.end();
                        }
                    }
                }
            }

            // http connection
            else {
                return this.#processHttpConnection( clientSocket, remoteAddress, method );
            }
        }
    }

    async #processHttpConnection ( clientSocket, remoteAddress, method ) {
        const connection = {
            "type": "http",
            method,
            "url": null,
            remoteAddress,
            "options": {},
        };

        var password, headers;

        // read http headers
        headers = await clientSocket.readHttpHeaders().catch( e => null );
        if ( !headers ) return clientSocket.end();

        headers = headers.split( "\r\n" );

        // parse method
        method = headers[ 0 ].split( " " );

        // connect method
        if ( connection.method === "CONNECT" ) {
            try {
                connection.url = new URL( "https://" + method[ 0 ] );
            }
            catch {

                // invalid url
                return clientSocket.end( "HTTP/1.1 400 Bad Request\r\n\r\n" );
            }
        }

        // http connection
        else {
            try {
                connection.url = new URL( method[ 0 ] );
            }
            catch {

                // invalid url
                return clientSocket.end( "HTTP/1.1 400 Bad Request\r\n\r\n" );
            }
        }

        const patched = {};

        // patch headers
        for ( let n = 1; n < headers.length; n++ ) {
            const idx = headers[ n ].indexOf( ":" );

            if ( idx === -1 ) continue;

            const name = headers[ n ].slice( 0, idx ),
                id = name.trim().toLowerCase();

            // proxy-connection: - added by Chrome
            if ( id === "proxy-connection" ) {
                headers[ n ] = null;
            }

            // proxy-authorization:
            else if ( id === "proxy-authorization" ) {
                const value = headers[ n ]
                    .slice( idx + 1 )
                    .replace( /basic/iv, "" )
                    .trim();

                // try to decode auth credentials
                try {
                    const credentials = Buffer.from( value, "base64" ).toString();

                    const idx = credentials.indexOf( ":" );

                    // no password provided
                    if ( idx === -1 ) {
                        connection.options = this.#parseUsername( credentials );
                    }
                    else {
                        connection.options = this.#parseUsername( credentials.slice( 0, idx ) );
                        password = credentials.slice( idx + 1 );
                    }
                }
                catch {}

                headers[ n ] = null;
            }

            // host:
            else if ( id === "host" ) {
                if ( patched[ id ] ) {
                    headers[ n ] = null;
                }
                else {
                    headers[ n ] = name + ": " + connection.url.hostname;
                }
            }

            // connection:
            else if ( id === "connection" ) {
                if ( patched[ id ] ) {
                    headers[ n ] = null;
                }
                else {
                    headers[ n ] = name + ": close";
                }
            }

            patched[ id ] = true;
        }

        // authorize
        if ( this.#authorize ) {

            // authorize
            connection.auth = await this.#authorize( connection, password );

            // auth error
            if ( !connection.auth ) {
                return clientSocket.end( `HTTP/1.1 407 Proxy Authentication Required\r
Proxy-Authenticate: Basic realm="Proxy Authentication Required"\r
\r
` );
            }
        }

        // create tunnel
        let proxy = this.#proxy;

        if ( typeof proxy === "function" ) {
            proxy = await proxy( connection );
        }

        const serverSocket = await this.#createServerSocket( proxy, connection );
        if ( !serverSocket ) return clientSocket.end();

        // incoming method is CONNECT
        if ( connection.method === "CONNECT" ) {
            clientSocket.write( "HTTP/1.1 200 OK\r\n\r\n" );
        }

        // incoming connection method is HTTP
        else {
            method[ 0 ] = connection.url.pathname + connection.url.search;

            headers[ 0 ] = connection.method + " " + method.join( " " );

            if ( !patched[ "host" ] ) {
                headers.push( "Host: " + connection.url.hostname );
            }

            if ( !patched[ "connection" ] ) {
                headers.push( "Connection: close" );
            }

            serverSocket.write( headers.filter( header => header ).join( "\r\n" ) + "\r\n\r\n" );
        }

        clientSocket.removeAllListeners();
        serverSocket.removeAllListeners();

        clientSocket.once( "error", e => {} );
        serverSocket.once( "error", e => {} );

        // calc session traffic
        if ( this.#sessionStarted ) {
            this.#bytesRead += serverSocket.bytesRead;
            this.#bytesWritten += serverSocket.bytesWritten;

            clientSocket.on( "data", data => {
                this.#bytesWritten += data.length;
            } );

            serverSocket.on( "data", data => {
                this.#bytesRead += data.length;
            } );
        }

        clientSocket.once( "close", e => serverSocket.destroy() );
        serverSocket.once( "close", e => {
            clientSocket.destroy();

            this.emit( "stat", {
                connection,
                "bytesRead": serverSocket.bytesRead,
                "bytesWritten": serverSocket.bytesWritten,
            } );
        } );

        serverSocket.unref();

        serverSocket.pipe( clientSocket );
        clientSocket.pipe( serverSocket );
    }

    async #processSocks5Connection ( clientSocket, remoteAddress ) {
        const connection = {
            "type": "socks",
            "url": new URL( "socks5://" ),
            remoteAddress,
            "options": {},
        };

        var password;

        var chunk = await clientSocket.readChunk( 1 ).catch( e => null );
        if ( !chunk ) return clientSocket.end();

        const NAUTH = chunk[ 0 ];

        chunk = await clientSocket.readChunk( NAUTH ).catch( e => null );
        if ( !chunk ) return clientSocket.end();

        const authMethods = {};

        for ( const authMethod of chunk ) {
            authMethods[ authMethod ] = true;
        }

        // use username / password auth
        if ( authMethods[ 2 ] ) {

            // choose username / password auth method
            clientSocket.write( Buffer.from( [ 0x05, 0x02 ] ) );

            chunk = await clientSocket.readChunk( 2 ).catch( e => null );
            if ( !chunk || chunk[ 0 ] !== 0x01 ) return clientSocket.end();

            // read username
            if ( chunk[ 1 ] ) {
                chunk = await clientSocket.readChunk( chunk[ 1 ] ).catch( e => null );
                if ( !chunk ) return clientSocket.end();

                connection.options = this.#parseUsername( chunk.toString() );
            }

            // read passsword length
            chunk = await clientSocket.readChunk( 1 ).catch( e => null );
            if ( !chunk ) return clientSocket.end();

            // read password
            if ( chunk[ 0 ] ) {
                chunk = await clientSocket.readChunk( chunk[ 0 ] ).catch( e => null );
                if ( !chunk ) return clientSocket.end();

                password = chunk.toString();
            }

            // authorize
            if ( this.#authorize ) {

                // authorize
                connection.auth = await this.#authorize( connection, password );

                // reject auth
                if ( !connection.auth ) {
                    return clientSocket.end( Buffer.from( [ 0x01, 0xFF ] ) );
                }
            }

            // accept auth
            clientSocket.write( Buffer.from( [ 0x01, 0x00 ] ) );
        }

        // no auth
        else if ( authMethods[ 0 ] ) {

            // choose "no authentication" method
            clientSocket.write( Buffer.from( [ 0x05, 0x00 ] ) );
        }

        // unsupported auth method
        else {

            // no acceptable auth methods were offered
            return clientSocket.end( Buffer.from( [ 0x05, 0xFF ] ) );
        }

        // ver, cmd, rsv, dstaddr_type
        chunk = await clientSocket.readChunk( 4 ).catch( e => null );
        if ( !chunk || chunk[ 0 ] !== 0x05 ) return clientSocket.end();

        // not a "establish a TCP/IP stream connection" request
        if ( chunk[ 1 ] !== 0x01 ) return clientSocket.end();

        // ipV4 addr
        if ( chunk[ 3 ] === 0x01 ) {
            chunk = await clientSocket.readChunk( 4 ).catch( e => null );
            if ( !chunk ) return clientSocket.end();

            // convert to literal ip addr
            connection.url.hostname = new IpAddress( chunk.readUInt32BE() ).toString();
        }

        // ipv6 addr
        else if ( chunk[ 3 ] === 0x04 ) {

            // TODO currently not supported
            return clientSocket.end();
        }

        // domain name
        else if ( chunk[ 3 ] === 0x03 ) {
            const domainNameLength = await clientSocket.readChunk( 1 ).catch( e => null );
            if ( !domainNameLength ) return clientSocket.end();

            chunk = await clientSocket.readChunk( domainNameLength[ 0 ] ).catch( e => null );
            if ( !chunk ) return clientSocket.end();

            connection.url.hostname = chunk.toString();
        }

        // invalid DSTADDR_TYPE
        else {
            return clientSocket.end();
        }

        // read port
        chunk = await clientSocket.readChunk( 2 ).catch( e => null );
        if ( !chunk ) return clientSocket.end();

        connection.url.port = chunk.readUInt16BE();

        // create tunnel
        let proxy = this.#proxy;

        if ( typeof proxy === "function" ) {
            proxy = await proxy( connection );
        }

        const serverSocket = await this.#createServerSocket( proxy, connection );
        if ( !serverSocket ) return clientSocket.end();

        clientSocket.write( Buffer.from( [ 0x05, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00 ] ) );

        clientSocket.removeAllListeners();
        serverSocket.removeAllListeners();

        clientSocket.once( "error", e => {} );
        serverSocket.once( "error", e => {} );

        // calc sessiontraffic
        if ( this.#sessionStarted ) {
            this.#bytesRead += serverSocket.bytesRead;
            this.#bytesWritten += serverSocket.bytesWritten;

            clientSocket.on( "data", data => {
                this.#bytesWritten += data.length;
            } );

            serverSocket.on( "data", data => {
                this.#bytesRead += data.length;
            } );
        }

        clientSocket.once( "close", e => serverSocket.destroy() );
        serverSocket.once( "close", e => {
            clientSocket.destroy();

            this.emit( "stat", {
                connection,
                "bytesRead": serverSocket.bytesRead,
                "bytesWritten": serverSocket.bytesWritten,
            } );
        } );

        serverSocket.unref();

        serverSocket.pipe( clientSocket );
        clientSocket.pipe( serverSocket );
    }

    async #createServerSocket ( proxy, connection ) {
        if ( this.#checkConnection ) {
            const hostnameAddress = await resolve4( connection.url.hostname );

            if ( !hostnameAddress ) return;

            const port = connection.url.port || getDefaultPort( connection.url.protocol );

            if ( !this.#checkConnection( hostnameAddress, port ) ) return;

            connection.options.hostnameAddress = hostnameAddress;
        }

        // proxied connection
        if ( proxy ) {
            return proxy.connect( connection.url, connection.options ).catch( e => {} );
        }

        // direct connection
        else {
            return this.#createDirectConnection( connection.url ).catch( e => {} );
        }
    }

    async #createDirectConnection ( url ) {
        return connect( {
            "host": url.hostname,
            "port": url.port || getDefaultPort( url.protocol ),
        } );
    }

    #parseUsername ( username ) {
        const data = {};

        for ( const [ name, value ] of new URLSearchParams( username ) ) data[ name ] = value;

        return data;
    }
}
