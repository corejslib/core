import "#lib/temporal";
import DigitalSize from "#lib/digital-size";
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
    DEFAULT_MAX_CONNECTIONS_PER_STANDBY = 3,
    DEFAULT_IDLE_TIMEOUT = 60_000, // 1 minute
    DEFAULT_CHECK_CERTIFICATE = true,
    DEFAULT_LARGE_OBJECT_READ_SIZE = "64 KiB",
    LARGE_OBJECT_MAX_READ_SIZE = 2_147_483_647;

const SERVICE_DISCOVERY_HOSTNAME = "service-discovery",
    SOCKET_HOSTNAME = "local",
    DEFAULT_SOCKET_PATH = "/var/run/postgresql/.s.PGSQL.",
    DEFAULT_USERNAME = "postgres";

export default class DbhPostgreSql extends Dbh {
    #url;

    #appName;
    #unixSocket;
    #protocol;
    #hostname;
    #port;
    #username;
    #password;
    #database;
    #maxConnections;
    #maxConnectionsPerStandby;
    #standbyHostname;
    #standbyPort;
    #checkCertificate;
    #idleTimeout;
    #serviceDiscovery;
    #primaryServiceDiscoveryAppName;
    #primaryServiceDiscoveryServiceName;
    #standbyServiceDiscoveryAppName;
    #standbyServiceDiscoveryServiceName;
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

        this.#appName = options.appName || url.searchParams.get( "appName" ) || DEFAULT_APP_NAME;

        this.#protocol = url.protocol;
        this.#username = ( options.username ?? decodeURIComponent( url.username ) ) || DEFAULT_USERNAME;
        this.#password = options.password ?? decodeURIComponent( url.password );

        let appName, serviceName, urlDatabase;

        // service-discovery
        if ( url.hostname === SERVICE_DISCOVERY_HOSTNAME ) {
            if ( !this.#serviceDiscovery ) throw new Error( "PostgreSQL connection require service discovery client" );

            [ appName, serviceName, urlDatabase ] = url.pathname.slice( 1 ).split( "/", 3 );

            if ( !appName ) throw new Error( "Service discovery require application name" );
            if ( !serviceName ) throw new Error( "Service discovery require service name" );

            this.#primaryServiceDiscoveryAppName = appName;
            this.#primaryServiceDiscoveryServiceName = serviceName;
        }
        else {
            urlDatabase = url.pathname.slice( 1 );

            this.#hostname = url.hostname;
            this.#port = +url.port || getDefaultPort( this.#protocol );

            // socket
            this.#unixSocket = url.searchParams.get( "socket" );

            if ( this.#unixSocket || this.#hostname === SOCKET_HOSTNAME ) this.#hostname = null;

            if ( !this.#hostname && !this.#unixSocket ) {
                this.#unixSocket = DEFAULT_SOCKET_PATH + this.#port;
            }
        }

        this.#database = options.database ?? urlDatabase ?? "";

        // stanby host
        this.#standbyHostname = options.standbyHost || url.searchParams.get( "standbyHost" );
        if ( this.#standbyHostname ) {

            // service-discovery
            if ( this.#standbyHostname.startsWith( SERVICE_DISCOVERY_HOSTNAME + "/" ) ) {
                if ( !this.#serviceDiscovery ) throw new Error( "PostgreSQL connection require service discovery client" );

                const [ standbyAppName, standbyServiceName ] = this.#standbyHostname.split( "/" ).slice( 1, 3 );

                if ( !standbyAppName ) throw new Error( "Service discovery require application name" );
                if ( !standbyServiceName ) throw new Error( "Service discovery require service name" );

                this.#standbyHostname = SERVICE_DISCOVERY_HOSTNAME;
                this.#standbyServiceDiscoveryAppName = standbyAppName;
                this.#standbyServiceDiscoveryServiceName = standbyServiceName;
            }
            else if ( this.#standbyHostname.includes( ":" ) ) {
                [ this.#standbyHostname, this.#standbyPort ] = this.#standbyHostname.split( ":", 2 );

                this.#standbyPort = Number( this.#standbyPort ) || getDefaultPort( this.#protocol );
            }
            else {
                this.#standbyPort = this.#port ?? getDefaultPort( this.#protocol );
            }
        }

        // check certificate
        this.#checkCertificate = options.checkCertificate ?? url.searchParams.get( "checkCertificate" );

        if ( this.#checkCertificate === "true" ) {
            this.#checkCertificate = true;
        }
        else if ( this.#checkCertificate === "false" ) {
            this.#checkCertificate = false;
        }

        if ( typeof this.#checkCertificate !== "boolean" ) {
            this.#checkCertificate = DEFAULT_CHECK_CERTIFICATE;
        }

        // maxConnections
        this.#maxConnections = +( options.maxConnections || url.searchParams.get( "maxConnections" ) || DEFAULT_MAX_CONNECTIONS );
        if ( !Number.isInteger( this.#maxConnections ) || this.#maxConnections < 1 ) {
            throw new TypeError( "PostgreSQL maxConnections value is invalid" );
        }

        // maxConnectionsPerStandby
        this.#maxConnectionsPerStandby = +( options.maxConnectionsPerStandby || url.searchParams.get( "maxConnectionsPerStandby" ) || DEFAULT_MAX_CONNECTIONS_PER_STANDBY );
        if ( !Number.isInteger( this.#maxConnectionsPerStandby ) || this.#maxConnectionsPerStandby < 1 ) {
            throw new TypeError( "PostgreSQL maxConnectionsPerStandby value is invalid" );
        }

        // idleTimeout
        this.#idleTimeout = +( options.idleTimeout ?? ( url.searchParams.get( "idleTimeout" ) || DEFAULT_IDLE_TIMEOUT ) );
        if ( !Number.isInteger( this.#idleTimeout ) || this.#idleTimeout < 0 ) {
            throw new TypeError( "PostgreSQL idleTimeout value is invalid" );
        }

        // largeObjectReadSize
        const largeObjectReadSize = options.largeObjectReadSize ?? ( url.searchParams.get( "largeObjectReadSize" ) || DEFAULT_LARGE_OBJECT_READ_SIZE );
        this.#largeObjectReadSize = new DigitalSize( largeObjectReadSize ).bytes;
        if ( this.#largeObjectReadSize > LARGE_OBJECT_MAX_READ_SIZE ) this.#largeObjectReadSize = LARGE_OBJECT_MAX_READ_SIZE;

        // primary
        if ( this.#primaryServiceDiscoveryAppName ) {
            this.#primaryConnectionsManager = new ConnectionsManager( {
                "createConnection": this.#createPrimaryConnection.bind( this ),
                "idleTimeout": this.#idleTimeout,
                "maxConnectionsPerHost": this.#maxConnections + 1, // 1 for events connection
                "reservedConnections": 0,
                "serviceDiscovery": this.#serviceDiscovery,
                "appName": this.#primaryServiceDiscoveryAppName,
                "serviceName": this.#primaryServiceDiscoveryServiceName,
            } );
        }
        else {
            this.#primaryConnectionsManager = new ConnectionsManager( {
                "createConnection": this.#createPrimaryConnection.bind( this ),
                "idleTimeout": this.#idleTimeout,
                "maxConnectionsPerHost": this.#maxConnections + 1, // 1 for events connection
                "reservedConnections": 0,
                "uri": this.#unixSocket
                    ? `unix:${ this.#unixSocket }`
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
                "maxConnectionsPerHost": this.#maxConnectionsPerStandby,
                "reservedConnections": 0,
                "serviceDiscovery": this.#serviceDiscovery,
                "appName": this.#standbyServiceDiscoveryAppName,
                "serviceName": this.#standbyServiceDiscoveryServiceName,
            } );
        }
        else {
            this.#standbyConnectionsManager = new ConnectionsManager( {
                "createConnection": this.#createStandbyConnection.bind( this ),
                "idleTimeout": this.#idleTimeout,
                "maxConnectionsPerHost": this.#maxConnectionsPerStandby,
                "reservedConnections": 0,
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

    get appName () {
        return this.#appName;
    }

    get unixSocket () {
        return this.#unixSocket;
    }

    get protocol () {
        return this.#protocol;
    }

    get hostname () {
        return this.#hostname;
    }

    get port () {
        return this.#port;
    }

    get username () {
        return this.#username;
    }

    get password () {
        return this.#password;
    }

    get database () {
        return this.#database;
    }

    get maxConnections () {
        return this.#maxConnections;
    }

    get maxConnectionsPerStandby () {
        return this.#maxConnectionsPerStandby;
    }

    get standbyHostname () {
        return this.#standbyHostname;
    }

    get standbyPort () {
        return this.#standbyPort;
    }

    get checkCertificate () {
        return this.#checkCertificate;
    }

    get idleTimeout () {
        return this.#idleTimeout;
    }

    get largeObjectReadSize () {
        return this.#largeObjectReadSize;
    }

    get url () {
        if ( !this.#url ) {
            const url = new URL( this.protocol + "//" );

            const addUsername = this.#username && this.#username !== DEFAULT_USERNAME,
                addPort = this.#port !== getDefaultPort( url.protocol ),
                addSocket = DEFAULT_SOCKET_PATH + getDefaultPort( url.protocol ) !== this.#unixSocket,
                addDatabase = Boolean( this.#database );

            // hostname
            if ( this.#hostname ) {
                url.hostname = this.#hostname;
                if ( addPort ) url.port = this.#port;
            }

            // service discovery
            else if ( this.#primaryServiceDiscoveryAppName ) {
                url.hostname = SERVICE_DISCOVERY_HOSTNAME;
                url.pathname = "/" + this.#primaryServiceDiscoveryAppName + "/" + this.#primaryServiceDiscoveryServiceName + ( addDatabase
                    ? "/" + this.#database
                    : "" );
            }

            // socket
            else {
                if ( addUsername || this.#password ) {
                    url.hostname = SOCKET_HOSTNAME;
                }

                if ( addSocket ) {
                    url.searchParams.set( "socket", this.#unixSocket );
                }
            }

            if ( addUsername ) url.username = this.#username;
            url.password = this.#password;
            if ( addDatabase && !this.#primaryServiceDiscoveryAppName ) url.pathname = this.#database;

            if ( this.#appName !== DEFAULT_APP_NAME ) url.searchParams.set( "appName", this.#appName );

            if ( this.#maxConnections !== DEFAULT_MAX_CONNECTIONS ) url.searchParams.set( "maxConnections", this.#maxConnections );
            if ( this.#idleTimeout !== DEFAULT_IDLE_TIMEOUT ) url.searchParams.set( "idleTimeout", this.#idleTimeout );

            // standby host
            if ( this.#standbyHostname ) {

                // service-discovery
                if ( this.#standbyServiceDiscoveryAppName ) {
                    url.searchParams.set( "standbyHost", `${ SERVICE_DISCOVERY_HOSTNAME }/${ this.#standbyServiceDiscoveryAppName }/${ this.#standbyServiceDiscoveryServiceName }` );
                }
                else {
                    if ( this.#standbyPort !== this.#port ) {
                        url.searchParams.set( "standbyHost", this.#standbyHostname + ":" + this.#standbyPort );
                    }
                    else {
                        url.searchParams.set( "standbyHost", this.#standbyHostname );
                    }
                }

                if ( this.#maxConnectionsPerStandby !== DEFAULT_MAX_CONNECTIONS_PER_STANDBY ) {
                    url.searchParams.set( "maxConnectionsPerStandby", this.#maxConnectionsPerStandby );
                }
            }

            if ( this.#checkCertificate !== DEFAULT_CHECK_CERTIFICATE ) {
                url.searchParams.set( "checkCertificate", this.#checkCertificate.toString() );
            }

            // largeObjectReadSize
            if ( this.#largeObjectReadSize !== new DigitalSize( DEFAULT_LARGE_OBJECT_READ_SIZE ).bytes ) {
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

    get pid () {
        return this.#events.pid;
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

    // XXX - stop cron
    async destroy () {
        console.log( "--- DESTROY" );
        return this.#lifecycleManager.destroy();
    }

    async forceDestroy () {
        return this.#lifecycleManager.forceDestroy();
    }

    // XXX - start cron
    async start () {
        console.log( "--- START" );
        return result( 200 );
    }

    // XXX - stop cron
    async stop () {
        console.log( "--- STOP" );
        return result( 200 );
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

    async createConnection ( { standby, signal } = {} ) {
        if ( standby && this.#standbyConnectionsManager.hasHosts ) {
            return this.#standbyConnectionsManager.createConnection( signal );
        }
        else {
            return this.#primaryConnectionsManager.createConnection( signal );
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
            this.schema.cron.start(),
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

    #createPrimaryConnection ( uri, lifecycleManager ) {
        return new PostgreSqlConnection( this, {
            uri,
            lifecycleManager,
            "globalEvents": this.#events,
            "isPrimary": true,
        } );
    }

    #createStandbyConnection ( uri, lifecycleManager ) {
        return new PostgreSqlConnection( this, {
            uri,
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
