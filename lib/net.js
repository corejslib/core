import net from "node:net";

var TLS;

const DEFAULT_PORTS = {
    "ftp:": 21,
    "ftps:": 990,
    "gopher:": 70,
    "http:": 80,
    "https:": 443,
    "ws:": 80,
    "wss:": 443,
    "postgresql:": 5432,
    "postgresql+tls:": 5432,
    "redis:": 6379,
    "redis+tls:": 6379,
    "smtp:": 25,
    "smtp+tls:": 465,
    "smtp+starttls:": 587,
    "ssh:": 22,
};

export function getDefaultPort ( protocol ) {
    return DEFAULT_PORTS[ protocol ];
}

export async function getRandomFreePort ( host ) {
    host ||= "127.0.0.1";

    return new Promise( resolve => {
        const srv = net.createServer( sock => sock.end() );

        srv.listen( 0, host, () => {
            const port = srv.address().port;

            srv.close();

            resolve( port );
        } );
    } );
}

export async function isPortFree ( port, host ) {
    host ||= "127.0.0.1";

    try {
        const socket = await connect( {
            host,
            port,
        } );

        socket.destroy();

        return false;
    }
    catch ( e ) {

        // port is free
        if ( e.code === "ECONNREFUSED" ) {
            return true;
        }

        // error
        else {
            return false;
        }
    }
}

export async function connect ( { tls, checkCertificate = true, connectTimeout, ...options } = {}, onConnect ) {
    if ( tls ) {
        TLS ??= ( await import( "node:tls" ) ).default;

        options.rejectUnauthorized = !!checkCertificate;
    }

    var socket, error, timeout, callback;

    if ( connectTimeout ) {
        timeout = setTimeout( () => socket.destroy( "Connection timeout" ), connectTimeout );
    }

    await new Promise( ( resolve, reject ) => {
        callback = e => {

            // connection error
            if ( e ) {
                reject( e );
            }

            // connected
            else {
                resolve();
            }
        };

        if ( tls ) {
            socket = TLS.connect( options, callback );
        }
        else {
            socket = net.connect( options, callback );
        }

        socket.once( "error", callback );
    } ).catch( e => {
        error = e;
    } );

    socket.off( "error", callback );
    socket.off( tls
        ? "secureConnect"
        : "connect", callback );

    if ( error ) throw error;

    if ( socket.destroyed ) throw "Connection closed";

    if ( onConnect ) {
        callback = e => {
            error = e;
        };

        socket.once( "error", callback );

        try {
            await onConnect( socket );
        }
        catch ( e ) {
            error = e;

            socket.destroy();
        }

        socket.off( "error", callback );
    }

    clearTimeout( timeout );

    if ( error ) throw error;

    if ( socket.destroyed ) throw "Connection closed";

    return socket;
}

export async function tryConnect ( port, host ) {
    host ||= "127.0.0.1";

    return new Promise( resolve => {
        const socket = net.connect( {
            host,
            port,
        } );

        socket.once( "connect", () => {
            socket.destroy();

            resolve( true );
        } );

        socket.once( "error", () => {
            socket.destroy();

            resolve( false );
        } );
    } );
}
