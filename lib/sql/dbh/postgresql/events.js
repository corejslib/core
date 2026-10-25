import "#lib/result";
import Events from "#lib/events";
import constants from "#lib/sql/constants";
import { sql } from "#lib/sql/query";
import LifecycleManager from "#lib/threads/lifecycle-manager";
import Signal from "#lib/threads/signal";
import { sleep } from "#lib/utils";

const SYNC_DELAY = 1,
    LOCAL_EVENTS = constants.reservedEvents;

const SQL = {
    "publishQuery": sql`SELECT pg_notify( ?, ?::text )`.prepare(),
};

const quoteIdentifier = name => `"${ name.replaceAll( '"', '""' ) }"`;

export default class ApiClientEvents {
    #api;
    #connectionsManager;
    #events;
    #listen = new Set();
    #pendingSubscribe = new Set();
    #pendingUnsubscribe = new Set();
    #connection;
    #syncStarted = false;
    #connectSignal = new Signal();
    #connectAbortController;
    #lifecycleManager;

    constructor ( api, connectionsManager ) {
        this.#api = api;
        this.#connectionsManager = connectionsManager;

        this.#events = new Events( { "maxListeners": Infinity } ).watch( this.#watcher.bind( this ) );

        this.#lifecycleManager = new LifecycleManager( {
            "onStart": this.#start.bind( this ),
            "onStop": this.#stop.bind( this ),
        } );
    }

    // properties
    get isConnected () {
        return Boolean( this.#connection?.isConnected );
    }

    get maxListeners () {
        return this.#events.maxListeners;
    }

    set maxListeners ( value ) {
        this.#events.maxListeners = value;
    }

    get abortSignal () {
        return this.#connectAbortController.signal;
    }

    // public
    async start () {
        return this.#lifecycleManager.start();
    }

    async stop () {
        return this.#lifecycleManager.stop();
    }

    async waitConnect ( { signal } = {} ) {
        if ( this.isConnected ) return true;

        await this.#connectSignal.wait( { signal } );

        return this.isConnected;
    }

    on ( event, callback ) {
        this.#checkEvent( event );

        this.#events.on( event, callback );

        return this;
    }

    once ( event, callback ) {
        this.#checkEvent( event );

        this.#events.once( event, callback );

        return this;
    }

    off ( event, callback ) {
        this.#checkEvent( event );

        this.#events.off( event, callback );

        return this;
    }

    async publish ( event, data ) {

        // connection can be lost while waiting
        if ( !( await this.waitConnect() ) ) return result( [ 503, "Database is not connected" ] );

        return this.#connection.select( SQL.publishQuery, [ event, data ] );
    }

    emit ( event, args ) {
        this.#events.emit( event, ...( args || [] ) );
    }

    emitRemote ( event, data ) {

        // local event
        if ( LOCAL_EVENTS.has( event ) ) return;

        this.#events.emit( event, data );
    }

    hasListeners ( event ) {
        return this.#events.hasListeners( event );
    }

    // private
    async #start () {
        this.#connectAbortController = new AbortController();

        this.#connect( this.#connectAbortController.signal );

        return result( 200 );
    }

    async #stop () {

        // stale reconnect loop must not survive a quick restart
        this.#connectAbortController?.abort();
        this.#connectAbortController = null;

        return result( 200 );
    }

    async #connect ( signal ) {
        while ( !signal.aborted ) {
            if ( !this.#lifecycleManager.canBeginThread ) return;

            try {
                await this.#connectionsManager.lockConnection(
                    async dbh => {
                        if ( !dbh ) return;

                        const connected = await dbh.waitConnect( { signal } );
                        if ( !connected ) return;

                        this.#connection = dbh;

                        this.#pendingSubscribe = new Set( this.#listen );
                        this.#pendingUnsubscribe.clear();

                        this.#connectSignal.broadcast();

                        this.emit( "connect" );

                        this.#sync();

                        try {
                            await dbh.waitDisconnect();
                        }
                        finally {
                            if ( this.#connection === dbh ) {
                                this.#connection = null;
                            }

                            this.emit( "disconnect" );
                        }
                    },
                    {
                        signal,
                        "exclusive": true,
                    }
                );
            }
            catch ( e ) {
                console.warn( "Events connection error:", e );
            }

            await sleep( 1000 );
        }
    }

    #checkEvent ( event ) {

        // local event
        if ( LOCAL_EVENTS.has( event ) ) return;

        // check, that event name is enumerated in schema
        if ( this.#api.schema.isLoaded && !this.#api.schema.isEventValid( event ) ) {
            throw `Event name "${ event }" is not emitted by the database`;
        }
    }

    #watcher ( event, subscribe ) {

        // local event
        if ( LOCAL_EVENTS.has( event ) ) return;

        // subscribed to event
        if ( subscribe ) {
            this.#listen.add( event );
            this.#pendingSubscribe.add( event );
            this.#pendingUnsubscribe.delete( event );
        }

        // unsubscribed from event
        else {
            this.#listen.delete( event );
            this.#pendingSubscribe.delete( event );
            this.#pendingUnsubscribe.add( event );
        }

        this.#sync();
    }

    async #sync () {
        if ( this.#syncStarted ) return;
        this.#syncStarted = true;

        try {
            while ( true ) {
                await sleep( SYNC_DELAY );

                const connection = this.#connection;

                // not connected
                if ( !connection?.isConnected ) break;

                // nothing to sync
                if ( !this.#pendingSubscribe.size && !this.#pendingUnsubscribe.size ) break;

                const queries = [];

                // subscribe
                if ( this.#pendingSubscribe.size ) {
                    for ( const name of this.#pendingSubscribe ) {
                        queries.push( `LISTEN ${ quoteIdentifier( name ) };` );
                    }

                    this.#pendingSubscribe.clear();
                }

                // unsubscribe
                if ( this.#pendingUnsubscribe.size ) {
                    for ( const name of this.#pendingUnsubscribe ) {
                        queries.push( `UNLISTEN ${ quoteIdentifier( name ) };` );
                    }

                    this.#pendingUnsubscribe.clear();
                }

                const res = await connection.do( queries.join( " " ) );

                if ( !res.ok ) {
                    console.warn( "Failed to subscribe postgresql events" );

                    connection.destroy();

                    break;
                }
            }
        }
        finally {
            this.#syncStarted = false;
        }
    }
}
