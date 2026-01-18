import "#lib/result";
import tls from "node:tls";
import { resolveMx } from "#lib/dns";
import FormData from "#lib/form-data";
import { connect, getDefaultPort } from "#lib/net";
import ProxyClient from "#lib/net/proxy";
import Sasl from "#lib/sasl";
import stream from "#lib/stream";
import { Base64StreamEncoder } from "#lib/stream/base64";
import ThreadsPool from "#lib/threads/pool";

const DEFAULT_VERIFY_PORT = 25;
const DEFAULT_MAX_RUNNING_THREADS = 10;

const STATUS_REASON = {
    "200": "(nonstandard success response, see rfc876)",
    "211": "System status, or system help reply",
    "214": "Help message",
    "220": "Service ready",
    "221": "Service closing transmission channel",
    "235": "Authentication successful",
    "250": "Requested mail action okay, completed",
    "251": "User not local; will forward to <forward-path>",
    "252": "Cannot VRFY user, but will accept message and attempt delivery",
    "334": "Continue request",
    "354": "Start mail input; end with <CRLF>.<CRLF>",
    "421": "Service not available, closing transmission channel",
    "450": "Requested mail action not taken: mailbox unavailable",
    "451": "Requested action aborted: local error in processing",
    "452": "Requested action not taken: insufficient system storage",
    "500": "Syntax error, command unrecognised",
    "501": "Syntax error in parameters or arguments",
    "502": "Command not implemented",
    "503": "Bad sequence of commands",
    "504": "Command parameter not implemented",
    "521": "Does not accept mail (see rfc1846)",
    "530": "Access denied",
    "534": "Please log in via your web browser",
    "535": "AUTH failed with the remote server",
    "550": "Requested action not taken: mailbox unavailable",
    "551": "User not local; try <forward-path>",
    "552": "Requested mail action aborted: exceeded storage allocation",
    "553": "Requested action not taken: mailbox name not allowed",
    "554": "Transaction failed",
    "555": "Syntax error",
};

class SmtpConnection {
    #smtp;
    #socket;
    #isTls;
    #extensions = {};

    constructor ( smtp ) {
        this.#smtp = smtp;
    }

    // public
    async connect () {
        try {

            // proxy connection
            if ( this.#smtp.proxy ) {
                this.#socket = await this.#smtp.proxy.connect( {
                    "protocol": "smtp:",
                    "hostname": this.#smtp.hostname,
                    "port": this.#smtp.port,
                } );
            }

            // direct connection
            else {
                this.#socket = await connect( {
                    "host": this.#smtp.hostname,
                    "port": this.#smtp.port,
                } );
            }
        }
        catch ( e ) {
            return result.catch( e );
        }

        // upgrade socket
        if ( this.#smtp.isTls ) {
            const res = await this.#startTls();
            if ( !res.ok ) return res;
        }

        // read initial message
        var res = await this.#read();
        if ( !res.ok ) return res;

        // ehlo
        const ehlo = await this.#ehlo();
        if ( !ehlo.ok ) return ehlo;

        // start tls
        if ( this.#smtp.isStartTls ) {
            res = await this.startTls();
            if ( !res.ok ) return res;
        }

        return ehlo;
    }

    destroy ( res ) {
        if ( this.#socket ) {
            this.#socket.destroy();

            this.#socket = null;
        }

        return res;
    }

    // commands
    async startTls () {
        if ( this.#isTls ) return result( [ 200, "Connection is already TLS" ] );

        if ( !this.#extensions.STARTTLS ) return result( [ 200, "TLS is not supported" ] );

        this.#write( "STARTTLS" );

        var res = await this.#read();
        if ( !res.ok ) return res;

        res = await this.#startTls();
        if ( !res.ok ) return res;

        // ehlo
        return this.#ehlo();
    }

    // supported methods in priority order: CRAM-MD5, PLAIN, LOGIN
    async auth () {
        if ( !this.#extensions.AUTH ) return this.destroy( result( [ 400, "Authentication is not supported" ] ) );

        const sasl = await Sasl.new( this.#extensions.AUTH.split( /\s+/ ), this.#smtp.username, this.#smtp.password );

        if ( !sasl ) return this.destroy( result( [ 535, "No authentication method supported" ] ) );

        var res;

        this.#write( "AUTH " + sasl.type );
        res = await this.#read();
        if ( res.status !== 334 ) return res;

        while ( true ) {
            const response = sasl.continue( res.data[ 0 ] );

            if ( !response ) return result( [ 535, "No authentication failed" ] );

            this.#write( response );

            res = await this.#read();

            if ( res.status !== 334 ) return res;
        }
    }

    async mailFrom ( value ) {
        this.#write( `MAIL FROM:<${ value || this.#smtp.username }>` );

        return this.#read();
    }

    async rcptTo ( to, { cc, bcc } = {} ) {
        var res;

        // to
        for ( const address of to ) {
            this.#write( `RCPT TO:<${ address }>` );

            res = await this.#read();
            if ( !res.ok ) return res;
        }

        // cc
        for ( const address of cc ) {
            this.#write( `RCPT TO:<${ address }>` );

            res = await this.#read();
            if ( !res.ok ) return res;
        }

        if ( !bcc ) return res;

        // bcc
        for ( const address of bcc ) {
            this.#write( `RCPT TO:<${ address }>` );

            res = await this.#read();
            if ( !res.ok ) return res;
        }

        return res;
    }

    async data ( { to, from, replyTo, cc, bcc, subject, text, html, attachments } ) {
        this.#write( "DATA" );

        var res = await this.#read();
        if ( res.status !== 354 ) return res;

        var header = "",
            body;

        from ||= this.#smtp.from;

        if ( !from ) from = `<${ this.#smtp.username }>`;
        else if ( !from.endsWith( ">" ) ) from += `<${ this.#smtp.username }>`;

        // headers
        header += `From: ${ from }\r\n`;

        if ( replyTo ) {
            if ( !replyTo.endsWith( ">" ) ) replyTo += `<${ this.#smtp.username }>`;

            header += `Reply-To: ${ replyTo }\r\n`;
        }

        if ( to ) header += `To: ${ to.join( "," ) }\r\n`;
        if ( cc && cc.length ) header += `Cc: ${ cc.join( "," ) }\r\n`;

        if ( subject ) header += `Subject: ${ subject }\r\n`;

        header += "MIME-Version: 1.0\r\n";

        header += `Date: ${ new Date().toDateString() }\r\n`;

        // has body
        if ( text || html || attachments ) {
            body = new FormData( { "type": "mixed" } );

            if ( text || html ) {
                const content = new FormData( { "type": "alternative" } );

                if ( text ) {
                    content.write( {
                        "headers": {
                            "content-type": "text/plain; charset=utf-8",
                            "content-transfer-encoding": "base64",
                        },
                        "body": text,
                        "transform": this.#encodeBase64.bind( this ),
                    } );
                }

                if ( html ) {
                    content.append( {
                        "headers": {
                            "content-type": "text/html; charset=utf-8",
                            "content-transfer-encoding": "base64",
                        },
                        "body": html,
                        "transform": this.#encodeBase64.bind( this ),
                    } );
                }

                body.write( content );
            }

            if ( attachments ) {
                for ( const attachment of attachments ) {
                    body.write( {
                        "headers": {
                            "content-transfer-encoding": "base64",
                        },
                        "body": attachment,
                        "transform": this.#encodeBase64.bind( this ),
                    } );
                }
            }

            header += `Content-Type: ${ body.type }\r\n`;
        }

        header += "\r\n";

        this.#write( header );

        if ( body ) {
            const res = await stream.promises
                .pipeline( body, this.#socket, {
                    "end": false,
                } )
                .then( () => result( 200 ) )
                .catch( e => result.catch( e, { "log": false } ) );

            if ( !res.ok ) return this.destroy( res );
        }

        this.#write( "." );

        return this.#read();
    }

    async rset () {
        this.#write( "RSET" );

        return this.#read();
    }

    async vrfy ( address ) {
        this.#write( `VRFY: <${ address }>` );

        return this.#read();
    }

    async noop () {
        this.#write( "NOOP" );

        return this.#read();
    }

    quit ( res ) {
        this.#write( "QUIT" );

        // do not read QUIT response
        return this.destroy( res || result( [ 221, STATUS_REASON[ 221 ] ] ) );
    }

    // private
    #write ( data ) {
        this.#socket.write( data + "\r\n" );
    }

    async #read () {
        var status;
        const lines = [];

        while ( true ) {
            const line = await this.#socket.readLine( { "eol": "\r\n", "encoding": "utf8" } ).catch( e => null );

            // protocol error or disconnected
            if ( line == null ) return this.destroy( result( [ 500, "SMTP server closed connection" ] ) );

            status = +line.slice( 0, 3 );

            lines.push( line.slice( 4 ) );

            // end of the response
            if ( line.charAt( 3 ) !== "-" ) break;
        }

        return result( [ status, STATUS_REASON[ status ] ], lines );
    }

    async #ehlo ( hostname ) {
        this.#write( `EHLO ${ hostname || "localhost.localdomain" }` );

        const res = await this.#read();
        if ( !res.ok ) return res;

        this.#extensions = {};

        for ( const line of res.data ) {
            const match = line.match( /^([\dA-Z]+)\s?(.*)/ );

            if ( match ) this.#extensions[ match[ 1 ] ] = match[ 2 ] || true;
        }

        return res;
    }

    async #startTls () {
        return new Promise( ( resolve, reject ) => {
            const socket = tls.connect( {
                "socket": this.#socket,
                "host": this.#smtp.hostname,
                "servername": this.#smtp.hostname,
            } );

            socket.once( "error", e => resolve( result( [ 500, e.message ] ) ) );

            socket.once( "secureConnect", () => {
                this.#socket = socket;
                this.#isTls = true;

                this.#socket.removeAllListeners( "error" );

                resolve( result( 200 ) );
            } );
        } );
    }

    #encodeBase64 ( data ) {
        if ( Buffer.isBuffer( data ) ) {
            return Buffer.from( data.toString( "base64" ) );
        }
        else {
            return stream.pipeline( data, new Base64StreamEncoder(), () => {} );
        }
    }
}

export default class Smtp {
    #url;
    #isTls;
    #isStartTls;
    #port;
    #username;
    #password;
    #from;
    #replyTo;
    #proxy;
    #threadsPool;

    constructor ( url, { proxy, maxRunningThreads } = {} ) {
        this.#url = new URL( url );
        this.proxy = proxy;

        if ( +this.#url.port === getDefaultPort( this.#url.protocol ) ) this.#url.port = "";

        this.#username = decodeURIComponent( this.#url.username );
        this.#password = decodeURIComponent( this.#url.password );
        this.#from = this.#url.searchParams.get( "from" );
        this.#replyTo = this.#url.searchParams.get( "replyTo" );

        this.#threadsPool = new ThreadsPool( { "maxRunningThreads": maxRunningThreads || DEFAULT_MAX_RUNNING_THREADS } );
    }

    // static
    // XXX
    static async verifyEmail ( email, { proxy } = {} ) {
        try {
            email = new URL( "smtp://" + email );
        }
        catch {
            return result( [ 400, "Email is invalid" ] );
        }

        const mx = await resolveMx( email.hostname );

        if ( !mx ) return result( [ 500, "Unable to resolve hostname" ] );

        var smtpHostname;

        for ( const row of mx ) {
            if ( row.exchange ) {
                smtpHostname = row.exchange;

                break;
            }
        }

        if ( !smtpHostname ) return result( [ 500, "Unable to find MX record" ] );

        const smtp = new this( `smtp://${ smtpHostname }:${ email.port || DEFAULT_VERIFY_PORT }`, { proxy } ),
            connection = new SmtpConnection( smtp );

        var res;

        TRANSACTION: {

            // connect
            res = await connection.connect();
            if ( !res.ok ) break TRANSACTION;

            // socket.write( "VRFY:" + email.username + "@" + email.hostname + "\r\n" );
            // res = await read( socket );
            // console.log( res + "" );

            res = await connection.mailFrom( "test@vasyns.com" );
            if ( !res.ok ) break TRANSACTION;

            res = connection.rcptTo( [ email.username + "@" + email.hostname ] );
            if ( !res.ok ) break TRANSACTION;
        }

        return connection.destroy( res );
    }

    // properties
    get url () {
        return this.#url.href;
    }

    get isTls () {
        this.#isTls ??= this.#url.protocol === "smtp+tls:";

        return this.#isTls;
    }

    get isStartTls () {
        this.#isStartTls ??= this.#url.protocol === "smtp+starttls:";

        return this.#isStartTls;
    }

    get hostname () {
        return this.#url.hostname;
    }

    get port () {
        if ( !this.#port ) {
            this.#port = +this.#url.port || getDefaultPort( this.#url.protocol );
        }

        return this.#port;
    }

    get username () {
        return this.#username;
    }

    get password () {
        return this.#password;
    }

    get from () {
        return this.#from;
    }

    get replyTo () {
        return this.#replyTo;
    }

    get proxy () {
        return this.#proxy;
    }

    set proxy ( value ) {
        this.#proxy = ProxyClient.new( value );
    }

    // public
    toString () {
        return this.#url.href;
    }

    toJSON () {
        return this.#url.href;
    }

    async destroy () {
        return this.#threadsPool.destroy();
    }

    async testSmtp () {
        return this.#threadsPool.runThread( this.#testSmtp.bind( this ), {
            "highPriority": true,
        } );
    }

    async sendEmail ( { to, from, replyTo, cc, bcc, subject, textBody, htmlBody, attachments } = {} ) {
        return this.#threadsPool.runThread( this.#sendEmail.bind( this, {
            to,
            from,
            replyTo,
            cc,
            bcc,
            subject,
            "text": textBody,
            "html": htmlBody,
            attachments,
        } ) );
    }

    // private
    async #testSmtp () {
        const connection = new SmtpConnection( this );

        var res;

        TRANSACTION: {

            // connect
            res = await connection.connect();
            if ( !res.ok ) break TRANSACTION;

            // auth
            res = await connection.auth();
            if ( !res.ok ) break TRANSACTION;
        }

        connection.destroy();

        return res;
    }

    async #sendEmail ( { to, from, replyTo, cc, bcc, subject, text, html, attachments } = {} ) {
        const connection = new SmtpConnection( this );

        var res;

        TRANSACTION: {

            // connect
            res = await connection.connect();
            if ( !res.ok ) break TRANSACTION;

            // auth
            res = await connection.auth();
            if ( !res.ok ) break TRANSACTION;

            // mailFrom
            res = await connection.mailFrom();
            if ( !res.ok ) break TRANSACTION;

            // prepare addresses
            const options = {
                "from": from || this.#from,
                "replyTo": replyTo || this.#replyTo,
                "to": [],
                "cc": [],
                "bcc": [],
                subject,
                text,
                html,
                attachments,
            };

            const addresses = new Set();

            // to
            if ( to ) {
                if ( !Array.isArray( to ) ) to = [ to ];

                for ( const address of to ) {
                    if ( addresses.has( address ) ) continue;

                    addresses.add( address );

                    options.to.push( address );
                }
            }

            // cc
            if ( cc ) {
                if ( !Array.isArray( cc ) ) cc = [ cc ];

                for ( const address of cc ) {
                    if ( addresses.has( address ) ) continue;

                    addresses.add( address );

                    options.cc.push( address );
                }
            }

            // bcc
            if ( bcc ) {
                if ( !Array.isArray( bcc ) ) bcc = [ bcc ];

                for ( const address of bcc ) {
                    if ( addresses.has( address ) ) continue;

                    addresses.add( address );

                    options.bcc.push( address );
                }
            }

            // rcptTo
            res = await connection.rcptTo( options.to, options );
            if ( !res.ok ) break TRANSACTION;

            // data
            res = await connection.data( options );
            if ( !res.ok ) break TRANSACTION;

            res = connection.quit();
        }

        connection.destroy();

        return res;
    }
}
