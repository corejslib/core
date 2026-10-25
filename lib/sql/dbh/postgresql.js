import "#lib/temporal";
import DigitalSize from "#lib/digital-size";
import Interval from "#lib/interval";
import { getDefaultPort } from "#lib/net";
import Numeric from "#lib/numeric";
import Dbh from "#lib/sql/dbh";
import { READ_ONLY_SQL_TRANSACTION } from "#lib/sql/dbh/postgresql/error-codes";
import { Sql } from "#lib/sql/query";
import { encodeBuffer, postgresqlDecoders } from "#lib/sql/types";
import ConnectionsManager from "#lib/threads/connections-manager";
import LifecycleManager from "#lib/threads/lifecycle-manager";
import PostgreSqlConnection from "./postgresql/connection.js";
import Events from "./postgresql/events.js";
import LargeObject from "./postgresql/large-object.js";
import Schema from "./postgresql/schema.js";

const DEFAULT_APP_NAME = "core",
    DEFAULT_MAX_CONNECTIONS = 10,
    DEFAULT_MAX_CONNECTIONS_PER_STANDBY = 10,
    DEFAULT_IDLE_TIMEOUT = "1 minute",
    DEFAULT_CHECK_CERTIFICATE = true,
    DEFAULT_LARGE_OBJECT_READ_SIZE = "64 KiB",
    LARGE_OBJECT_MAX_READ_SIZE = 2_147_483_647;

const SERVICE_DISCOVERY_HOSTNAME = "service-discovery",
    SOCKET_HOSTNAME = "local",
    DEFAULT_SOCKET_PATH = "/var/run/postgresql/.s.PGSQL.",
    DEFAULT_USERNAME = "postgres";

const DEFAULT_IDLE_TIMEOUT_MS = new Interval( DEFAULT_IDLE_TIMEOUT ).toMilliseconds().number,
    DEFAULT_LARGE_OBJECT_READ_SIZE_BYTES = new DigitalSize( DEFAULT_LARGE_OBJECT_READ_SIZE ).bytes;

// returns first non-empty value or null
function pick ( ...values ) {
    return values.find( value => value != null && value !== "" ) ?? null;
}

// option priority: options -> url component -> url search params
function getOption ( name, options, url, urlValue = null ) {
    return pick( options[ name ], urlValue, url.searchParams.get( name ) );
}

function decode ( value ) {
    return value
        ? decodeURIComponent( value )
        : null;
}

function parseInteger ( name, value, { min, max = Number.MAX_SAFE_INTEGER } ) {
    if ( value == null ) return null;

    const number = typeof value === "string"
        ? Number( value.trim() )
        : value;

    if ( !Number.isInteger( number ) || number < min || number > max ) {
        throw new TypeError( `PostgreSQL ${ name } value is invalid` );
    }

    return number;
}

function parsePort ( name, value ) {
    return parseInteger( name, value, {
        "min": 1,
        "max": 65_535,
    } );
}

function parseBoolean ( name, value ) {
    if ( value == null ) return null;

    if ( value === true || value === "true" ) return true;

    if ( value === false || value === "false" ) return false;

    throw new TypeError( `PostgreSQL ${ name } value is invalid` );
}

function parseIdleTimeout ( value ) {
    if ( value == null ) return null;

    const number = typeof value === "number"
            ? value
            : Number( value ),
        milliseconds = Number.isNaN( number )
            ? new Interval( value ).toMilliseconds().number
            : number;

    if ( !Number.isInteger( milliseconds ) || milliseconds < 0 ) {
        throw new TypeError( "PostgreSQL idleTimeout value is invalid" );
    }

    return milliseconds;
}

function splitHostPort ( value ) {
    const index = value.lastIndexOf( ":" );

    // no port, or ipv6 address without port
    if ( index === -1 || ( value.indexOf( ":" ) !== index && value[ index - 1 ] !== "]" ) ) {
        return [ value, null ];
    }

    return [ value.slice( 0, index ), value.slice( index + 1 ) ];
}

function assertServiceDiscovery ( client, appName, serviceName ) {
    if ( !client ) throw new Error( "PostgreSQL connection require service discovery client" );

    if ( !appName ) throw new Error( "Service discovery require application name" );
    if ( !serviceName ) throw new Error( "Service discovery require service name" );
}

export default class DbhPostgreSql extends Dbh {
    #url;

    #protocol;
    #database;
    #serviceDiscovery;

    #username = null;
    #password = null;
    #hostname = null;
    #port = null;
    #socket = null;
    #appName;
    #serviceDiscoveryAppName = null;
    #serviceDiscoveryServiceName = null;
    #standbyHostname = null;
    #standbyPort = null;
    #standbyServiceDiscoveryAppName = null;
    #standbyServiceDiscoveryServiceName = null;
    #checkCertificate;
    #maxConnections;
    #standbyMaxConnections;
    #idleTimeout;
    #largeObjectReadSize;

    #schema = new Schema( this );
    #largeObject = new LargeObject( this );

    #primaryConnectionsManager;
    #standbyConnectionsManager;
    #events;
    #lifecycleManager;

    #decode = { ...postgresqlDecoders };

    constructor ( url, options = {} ) {
        super();

        url = new URL( url );

        this.#serviceDiscovery = options.serviceDiscovery;
        this.#protocol = url.protocol;

        this.#appName = getOption( "appName", options, url ) ?? DEFAULT_APP_NAME;

        // username and password are taken only from options or url, not from url search params
        this.#username = pick( options.username, decode( url.username ) ) ?? DEFAULT_USERNAME;
        this.#password = pick( options.password, decode( url.password ) );

        let urlDatabase = url.pathname.slice( 1 ),
            urlServiceDiscoveryAppName,
            urlServiceDiscoveryServiceName;

        // service-discovery: service-discovery/<appName>/<serviceName>/<database>
        if ( url.hostname === SERVICE_DISCOVERY_HOSTNAME ) {
            [ urlServiceDiscoveryAppName, urlServiceDiscoveryServiceName, urlDatabase ] = urlDatabase.split( "/", 3 );
        }

        // hostname and port are taken only from options or url, not from url search params
        const hostname = pick( options.hostname, url.hostname );

        // service-discovery, requirements are checked only if the hostname is service-discovery
        if ( hostname === SERVICE_DISCOVERY_HOSTNAME ) {

            // full names are taken only from options, from url they are parsed from the path
            this.#serviceDiscoveryAppName = pick( options.serviceDiscoveryAppName, urlServiceDiscoveryAppName );
            this.#serviceDiscoveryServiceName = pick( options.serviceDiscoveryServiceName, urlServiceDiscoveryServiceName );

            assertServiceDiscovery( this.#serviceDiscovery, this.#serviceDiscoveryAppName, this.#serviceDiscoveryServiceName );
        }
        else {
            this.#hostname = hostname;
            this.#port = parsePort( "port", pick( options.port, url.port ) ) ?? getDefaultPort( this.#protocol );
            this.#socket = getOption( "socket", options, url );

            // socket
            if ( this.#socket || this.#hostname === SOCKET_HOSTNAME ) this.#hostname = null;

            if ( !this.#hostname && !this.#socket ) {
                this.#socket = DEFAULT_SOCKET_PATH + this.#port;
            }
        }

        this.#database = options.database ?? urlDatabase ?? "";

        // standby
        let standbyHostname = pick( options.standbyHostname ),
            standbyPort = pick( options.standbyPort ),
            standbyServiceDiscoveryAppName = null,
            standbyServiceDiscoveryServiceName = null,
            isStandbyServiceDiscovery = standbyHostname === SERVICE_DISCOVERY_HOSTNAME;

        // url search param "standby": <hostname>[:<port>] or service-discovery/<appName>/<serviceName>, ignored if standbyHostname option is set
        const standby = standbyHostname
            ? null
            : url.searchParams.get( "standby" );

        if ( standby ) {

            // service-discovery
            if ( standby === SERVICE_DISCOVERY_HOSTNAME || standby.startsWith( SERVICE_DISCOVERY_HOSTNAME + "/" ) ) {
                isStandbyServiceDiscovery = true;

                [ standbyServiceDiscoveryAppName, standbyServiceDiscoveryServiceName ] = standby.split( "/" ).slice( 1, 3 );
            }

            // hostname[:port]
            else {
                let urlPort;

                [ standbyHostname, urlPort ] = splitHostPort( standby );

                standbyPort = pick( standbyPort, urlPort );
            }
        }

        // service-discovery, requirements are checked only if the standby hostname is service-discovery
        if ( isStandbyServiceDiscovery ) {

            // full names are taken only from options, from url they are parsed from the standby path
            this.#standbyServiceDiscoveryAppName = pick( options.standbyServiceDiscoveryAppName, standbyServiceDiscoveryAppName );
            this.#standbyServiceDiscoveryServiceName = pick( options.standbyServiceDiscoveryServiceName, standbyServiceDiscoveryServiceName );

            assertServiceDiscovery( this.#serviceDiscovery, this.#standbyServiceDiscoveryAppName, this.#standbyServiceDiscoveryServiceName );
        }
        else if ( standbyHostname ) {
            this.#standbyHostname = standbyHostname;
            this.#standbyPort = parsePort( "standbyPort", standbyPort ) ?? this.#port ?? getDefaultPort( this.#protocol );
        }

        // checkCertificate
        this.#checkCertificate = parseBoolean( "checkCertificate", getOption( "checkCertificate", options, url ) ) ?? DEFAULT_CHECK_CERTIFICATE;

        // maxConnections
        this.#maxConnections = parseInteger( "maxConnections", getOption( "maxConnections", options, url ), { "min": 1 } ) ?? DEFAULT_MAX_CONNECTIONS;

        // standbyMaxConnections
        this.#standbyMaxConnections = parseInteger( "standbyMaxConnections", getOption( "standbyMaxConnections", options, url ), { "min": 1 } ) ?? DEFAULT_MAX_CONNECTIONS_PER_STANDBY;

        // idleTimeout
        this.#idleTimeout = parseIdleTimeout( getOption( "idleTimeout", options, url ) ) ?? DEFAULT_IDLE_TIMEOUT_MS;

        // largeObjectReadSize
        this.#largeObjectReadSize = Math.min( new DigitalSize( getOption( "largeObjectReadSize", options, url ) ?? DEFAULT_LARGE_OBJECT_READ_SIZE ).bytes, LARGE_OBJECT_MAX_READ_SIZE );

        // primary
        if ( this.#serviceDiscoveryAppName ) {
            this.#primaryConnectionsManager = new ConnectionsManager( {
                "createConnection": this.#createPrimaryConnection.bind( this ),
                "idleTimeout": this.#idleTimeout,
                "maxConnectionsPerHost": this.#maxConnections,
                "serviceDiscovery": this.#serviceDiscovery,
                "appName": this.#serviceDiscoveryAppName,
                "serviceName": this.#serviceDiscoveryServiceName,
            } );
        }
        else {
            this.#primaryConnectionsManager = new ConnectionsManager( {
                "createConnection": this.#createPrimaryConnection.bind( this ),
                "idleTimeout": this.#idleTimeout,
                "maxConnectionsPerHost": this.#maxConnections,
                "uri": this.#socket
                    ? `unix:${ this.#socket }`
                    : `//${ this.#hostname }${ this.#port
                        ? ":" + this.#port
                        : "" }/`,
            } );
        }

        // standby
        if ( this.#standbyServiceDiscoveryAppName ) {
            this.#standbyConnectionsManager = new ConnectionsManager( {
                "createConnection": this.#createStandbyConnection.bind( this ),
                "idleTimeout": this.#idleTimeout,
                "maxConnectionsPerHost": this.#standbyMaxConnections,
                "serviceDiscovery": this.#serviceDiscovery,
                "appName": this.#standbyServiceDiscoveryAppName,
                "serviceName": this.#standbyServiceDiscoveryServiceName,
            } );
        }
        else {
            this.#standbyConnectionsManager = new ConnectionsManager( {
                "createConnection": this.#createStandbyConnection.bind( this ),
                "idleTimeout": this.#idleTimeout,
                "maxConnectionsPerHost": this.#standbyMaxConnections,
                "uri": this.#standbyHostname
                    ? `//${ this.#standbyHostname }${ this.#standbyPort
                        ? ":" + this.#standbyPort
                        : "" }/`
                    : null,
            } );
        }

        this.#events = new Events( this, this.#primaryConnectionsManager );

        this.#lifecycleManager = new LifecycleManager( {
            "onStart": this.#start.bind( this ),
            "onStop": this.#stop.bind( this ),
            "onDestroy": this.#stop.bind( this ),
            "onDestroyThreads": this.#destroyConnections.bind( this ),
        } );

        this.#lifecycleManager.start();
    }

    // properties
    get isPostgreSql () {
        return true;
    }

    get protocol () {
        return this.#protocol;
    }

    get database () {
        return this.#database;
    }

    get username () {
        return this.#username;
    }

    get password () {
        return this.#password;
    }

    get hostname () {
        return this.#hostname;
    }

    get port () {
        return this.#port;
    }

    get socket () {
        return this.#socket;
    }

    get appName () {
        return this.#appName;
    }

    get serviceDiscoveryAppName () {
        return this.#serviceDiscoveryAppName;
    }

    get serviceDiscoveryServiceName () {
        return this.#serviceDiscoveryServiceName;
    }

    get standbyHostname () {
        return this.#standbyHostname;
    }

    get standbyPort () {
        return this.#standbyPort;
    }

    get standbyServiceDiscoveryAppName () {
        return this.#standbyServiceDiscoveryAppName;
    }

    get standbyServiceDiscoveryServiceName () {
        return this.#standbyServiceDiscoveryServiceName;
    }

    get checkCertificate () {
        return this.#checkCertificate;
    }

    get maxConnections () {
        return this.#maxConnections;
    }

    get standbyMaxConnections () {
        return this.#standbyMaxConnections;
    }

    get idleTimeout () {
        return this.#idleTimeout;
    }

    get largeObjectReadSize () {
        return this.#largeObjectReadSize;
    }

    get url () {
        if ( !this.#url ) {
            const url = new URL( this.#protocol + "//" ),
                defaultPort = getDefaultPort( url.protocol ),
                addUsername = this.#username && this.#username !== DEFAULT_USERNAME,
                addPort = this.#port !== defaultPort,
                addSocket = DEFAULT_SOCKET_PATH + defaultPort !== this.#socket,
                addDatabase = Boolean( this.#database );

            // service discovery
            if ( this.#serviceDiscoveryAppName ) {
                url.hostname = SERVICE_DISCOVERY_HOSTNAME;
                url.pathname = "/" + this.#serviceDiscoveryAppName + "/" + this.#serviceDiscoveryServiceName + ( addDatabase
                    ? "/" + this.#database
                    : "" );
            }

            // hostname
            else if ( this.#hostname ) {
                url.hostname = this.#hostname;

                if ( addPort ) url.port = this.#port;
            }

            // socket
            else {
                if ( addUsername || this.#password ) {
                    url.hostname = SOCKET_HOSTNAME;
                }

                if ( addSocket ) {
                    url.searchParams.set( "socket", this.#socket );
                }
            }

            if ( addUsername ) url.username = this.#username;
            if ( this.#password ) url.password = this.#password;
            if ( addDatabase && !this.#serviceDiscoveryAppName ) url.pathname = this.#database;

            if ( this.#appName !== DEFAULT_APP_NAME ) url.searchParams.set( "appName", this.#appName );

            // standby
            if ( this.#standbyServiceDiscoveryAppName ) {
                url.searchParams.set( "standby", `${ SERVICE_DISCOVERY_HOSTNAME }/${ this.#standbyServiceDiscoveryAppName }/${ this.#standbyServiceDiscoveryServiceName }` );
            }
            else if ( this.#standbyHostname ) {
                url.searchParams.set( "standby", this.#standbyPort !== ( this.#port ?? defaultPort )
                    ? `${ this.#standbyHostname }:${ this.#standbyPort }`
                    : this.#standbyHostname );
            }

            if ( ( this.#standbyServiceDiscoveryAppName || this.#standbyHostname ) && this.#standbyMaxConnections !== DEFAULT_MAX_CONNECTIONS_PER_STANDBY ) {
                url.searchParams.set( "standbyMaxConnections", this.#standbyMaxConnections );
            }

            if ( this.#checkCertificate !== DEFAULT_CHECK_CERTIFICATE ) {
                url.searchParams.set( "checkCertificate", this.#checkCertificate.toString() );
            }

            if ( this.#maxConnections !== DEFAULT_MAX_CONNECTIONS ) {
                url.searchParams.set( "maxConnections", this.#maxConnections );
            }

            // idleTimeout
            if ( this.#idleTimeout !== DEFAULT_IDLE_TIMEOUT_MS ) {
                url.searchParams.set( "idleTimeout", new Interval( this.#idleTimeout ).toString() );
            }

            // largeObjectReadSize
            if ( this.#largeObjectReadSize !== DEFAULT_LARGE_OBJECT_READ_SIZE_BYTES ) {
                url.searchParams.set(
                    "largeObjectReadSize",
                    new DigitalSize( this.#largeObjectReadSize ).toString( {
                        "units": null,
                    } )
                );
            }

            url.searchParams.sort();

            this.#url = url.href;
        }

        return this.#url;
    }

    get main () {
        return this;
    }

    get schema () {
        return this.#schema;
    }

    get largeObject () {
        return this.#largeObject;
    }

    get decode () {
        return this.#decode;
    }

    get isConnected () {
        return this.#events.isConnected;
    }

    get isDestroyed () {
        return this.#lifecycleManager.isDestroyed;
    }

    get inTransaction () {
        return false;
    }

    get maxListeners () {
        return this.#events.maxListeners;
    }

    set maxListeners ( value ) {
        this.#events.maxListeners = value;
    }

    get abortSignal () {
        return this.#events.abortSignal;
    }

    // public
    async connect () {
        return this.#lifecycleManager.start();
    }

    async disconnect () {
        return this.#lifecycleManager.stop();
    }

    async forceDisconnect () {
        return this.#lifecycleManager.forceStop();
    }

    async destroy () {
        return this.#lifecycleManager.destroy();
    }

    async forceDestroy () {
        return this.#lifecycleManager.forceDestroy();
    }

    async start () {
        return this.schema.cron.start();
    }

    async stop () {
        return this.schema.cron.stop();
    }

    toString () {
        return this.url;
    }

    toJSON () {
        return this.url;
    }

    quote ( value ) {

        // null
        if ( value == null ) {
            return "NULL";
        }
        else {

            // string
            if ( typeof value === "string" ) {
                return "'" + value.replaceAll( "'", "''" ) + "'";
            }

            // number
            else if ( typeof value === "number" ) {
                return String( value );
            }

            // boolean
            else if ( typeof value === "boolean" ) {
                return value === true
                    ? "TRUE"
                    : "FALSE";
            }

            // bigint
            else if ( typeof value === "bigint" ) {
                return value.toString();
            }

            // object
            else if ( typeof value === "object" ) {

                // View, https://www.postgresql.org/docs/current/static/datatype-binary.html
                if ( ArrayBuffer.isView( value ) ) {
                    if ( !Buffer.isBuffer( value ) ) {
                        value = Buffer.from( value.buffer, value.byteOffset, value.byteLength );
                    }

                    return `'${ encodeBuffer( value ) }'`;
                }

                // ArrayBuffer
                else if ( value instanceof ArrayBuffer ) {
                    return `'${ encodeBuffer( Buffer.from( value ) ) }'`;
                }

                // Date
                else if ( value instanceof Date ) {
                    return `'${ value.toISOString() }'`;
                }

                // Temporal.Instant
                else if ( value instanceof Temporal.Instant ) {
                    return `'${ value.toString() }'`;
                }

                // Temporal.ZonedDateTime
                else if ( value instanceof Temporal.ZonedDateTime ) {
                    return `'${ value.toInstant().toString() }'`;
                }

                // Numeric
                else if ( Numeric.isNumeric( value ) ) {
                    return value.toString();
                }

                // object
                else {
                    return "'" + JSON.stringify( value ).replaceAll( "'", "''" ) + "'";
                }
            }

            // invalid type
            else {
                throw new TypeError( `Unsupported SQL parameter type "${ typeof value }"` );
            }
        }
    }

    async waitConnect ( { signal } = {} ) {
        return this.#events.waitConnect( { signal } );
    }

    on ( event, callback ) {
        this.#events.on( event, callback );

        return this;
    }

    once ( event, callback ) {
        this.#events.once( event, callback );

        return this;
    }

    off ( event, callback ) {
        this.#events.off( event, callback );

        return this;
    }

    async publish ( event, data ) {
        return this.#events.publish( event, data );
    }

    async exec ( query, params ) {
        const connection = await this.#getConnection();

        if ( !connection ) return result( [ 500, "Unable to get connection" ] );

        return connection.exec( query, params );
    }

    async do ( query, params ) {
        const connection = await this.#getConnection();

        if ( !connection ) return result( [ 500, "Unable to get connection" ] );

        return connection.do( query, params );
    }

    async select ( query, params ) {
        return this.#select( "select", query, params );
    }

    async selectRow ( query, params ) {
        return this.#select( "selectRow", query, params );
    }

    async read ( query, options ) {
        const primary = query.isReadOnly === false || options?.summaryQuery?.isReadOnly === false;

        const dbh = await this.#getConnection( {
            "standby": !primary,
        } );

        if ( !dbh ) return result( [ 500, "Unable to get connection" ] );

        return dbh.read( query, options );
    }

    async lock ( callback, { standby, signal, exclusive = true } = {} ) {
        const wrapper = async dbh => {
            if ( !dbh ) {
                return result( [ 500, "Unable to get connection" ] );
            }
            else {
                return dbh.lock( callback );
            }
        };

        if ( standby && this.#standbyConnectionsManager.hasHosts ) {
            return this.#standbyConnectionsManager.lockConnection( wrapper, { signal, exclusive } );
        }
        else {
            return this.#primaryConnectionsManager.lockConnection( wrapper, { signal, exclusive } );
        }
    }

    async begin ( callback, { standby, mode, signal } = {} ) {
        const wrapper = async dbh => {
            if ( !dbh ) {
                return result( [ 500, "Unable to get connection" ] );
            }
            else {
                return dbh.begin( callback, { mode } );
            }
        };

        if ( standby && this.#standbyConnectionsManager.hasHosts ) {
            return this.#standbyConnectionsManager.lockConnection( wrapper, {
                signal,
                "exclusive": true,
            } );
        }
        else {
            return this.#primaryConnectionsManager.lockConnection( wrapper, {
                signal,
                "exclusive": true,
            } );
        }
    }

    async createConnection ( callback, { standby, signal } = {} ) {
        if ( standby && this.#standbyConnectionsManager.hasHosts ) {
            return this.#standbyConnectionsManager.createConnection( callback, { signal } );
        }
        else {
            return this.#primaryConnectionsManager.createConnection( callback, { signal } );
        }
    }

    [ Symbol.for( "nodejs.util.inspect.custom" ) ] ( depth, options, inspect ) {
        const spec = {
            "url": this.url,
        };

        return `${ this.constructor.name }: ${ inspect( spec ) }`;
    }

    // private
    async #start () {
        const res = await this.#doStart();

        // failed to start some services, rollback (already stopped services are skipped by lifecycle)
        if ( !res.ok ) await this.#doStop();

        return res;
    }

    async #stop () {
        const res = await this.#doStop();

        // failed to stop some services, rollback (already started services are skipped by lifecycle)
        if ( !res.ok ) await this.#doStart();

        return res;
    }

    async #destroyConnections () {
        this.#primaryConnectionsManager.destroyConnections();

        this.#standbyConnectionsManager.destroyConnections();
    }

    async #doStart () {
        const results = await Promise.all( [

            //
            this.#primaryConnectionsManager.start(),
            this.#standbyConnectionsManager.start(),
            this.#events.start(),
        ] );

        return results.find( res => !res.ok ) ?? result( 200 );
    }

    async #doStop () {
        const results = await Promise.all( [

            //
            this.#primaryConnectionsManager.stop(),
            this.#standbyConnectionsManager.stop(),
            this.#events.stop(),
            this.schema.cron.stop(),
        ] );

        return results.find( res => !res.ok ) ?? result( 200 );
    }

    async #select ( method, query, params ) {
        let connection;

        if ( query instanceof Sql && query.id ) {
            if ( query.isReadOnly == null ) {
                connection = await this.#getConnection( {
                    "standby": true,
                } );

                if ( !connection ) return result( [ 500, "Unable to get connection" ] );

                if ( connection.isPrimary ) {
                    return connection[ method ]( query, params );
                }
                else {
                    let options;

                    if ( params && !Array.isArray( params ) ) {
                        options = {
                            ...params,
                            "_readOnlyTest": true,
                        };
                    }
                    else {
                        options = {
                            params,
                            "_readOnlyTest": true,
                        };
                    }

                    const res = await connection[ method ]( query, options );

                    if ( !res.ok ) {

                        // query is not read-only, repeat on primary
                        if ( res.meta?.code === READ_ONLY_SQL_TRANSACTION ) {
                            query.readOnly( false );

                            return this[ method ]( query, params );
                        }
                        else {
                            return res;
                        }
                    }

                    // query is read-only
                    else {
                        query.readOnly( true );

                        return res;
                    }
                }
            }
            else if ( query.isReadOnly ) {
                connection = await this.#getConnection( {
                    "standby": true,
                } );
            }
            else {
                connection = await this.#getConnection( {
                    "standby": false,
                } );
            }
        }
        else {
            connection = await this.#getConnection();
        }

        if ( !connection ) return result( [ 500, "Unable to get connection" ] );

        return connection[ method ]( query, params );
    }

    #createPrimaryConnection ( connectionsManager, uri, lifecycleManager ) {
        return new PostgreSqlConnection( this, {
            uri,
            connectionsManager,
            lifecycleManager,
            "globalEvents": this.#events,
            "isPrimary": true,
        } );
    }

    #createStandbyConnection ( uri, connectionsManager, lifecycleManager ) {
        return new PostgreSqlConnection( this, {
            uri,
            connectionsManager,
            lifecycleManager,
            "globalEvents": this.#events,
            "isPrimary": false,
        } );
    }

    async #getConnection ( { standby } = {} ) {
        if ( standby && this.#standbyConnectionsManager.hasHosts ) {
            return this.#standbyConnectionsManager.getConnection();
        }
        else {
            return this.#primaryConnectionsManager.getConnection();
        }
    }
}
