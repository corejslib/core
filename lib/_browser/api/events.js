import Events from "#lib/events";
import Signal from "#lib/threads/signal";
import { sleep } from "#lib/utils";

const LOCAL_EVENTS = new Set( [ "_uri-update", "connect", "disconnect", "sessionDisable", "sessionDelete", "sessionReload", "accessDenied" ] ),
    SYNC_DELAY = 1;

export default class ApiClientEvents {
    #api;
    #connectionsManager;
    #events;
    #listen = new Set();
    #pendingSubscribe = new Set();
    #pendingUnsubscribe = new Set();
    #connection;
    #syncStarted;
    #connectSignal = new Signal();

    constructor ( api, connectionsManager ) {
        this.#api = api;
        this.#connectionsManager = connectionsManager;

        this.#events = new Events( { "maxListeners": Infinity } ).watch( this.#watcher.bind( this ) );
    }

    // properties
    get isConnected () {
        return Boolean( this.#connection?.isConnected );
    }

    // public
    start () {
        this.#connect();

        return this;
    }

    async waitConnect ( { signal } = {} ) {
        if ( this.isConnected ) return;

        await this.#connectSignal.wait( { signal } );

        return this.isConnected;
    }

    on ( name, listener ) {
        if ( !this.isPersistent ) return this;

        this.#events.on( name, listener );

        return this;
    }

    once ( name, listener ) {
        if ( !this.isPersistent ) return this;

        this.#events.once( name, listener );

        return this;
    }

    off ( name, listener ) {
        if ( !this.isPersistent ) return this;

        this.#events.off( name, listener );

        return this;
    }

    emit ( event, args ) {
        this.#events.emit( event, ...( args || [] ) );
    }

    emitRemote ( event, args ) {

        // local event
        if ( LOCAL_EVENTS.has( event ) ) return;

        this.#events.emit( event, ...( args || [] ) );
    }

    // private
    async #connect () {
        if ( !this.#api.isPersistent ) return;

        this.#connection = await this.#connectionsManager.createConnection();

        this.#connection.on( "connect", () => {
            this.#connectSignal.broadcast();

            this.#pendingSubscribe = new Set( this.#listen );
            this.#pendingUnsubscribe.clear();

            this.emit( "connect" );

            this.#sync();
        } );

        this.#connection.on( "disconnect", () => {
            this.#connection = null;

            this.emit( "disconnect" );

            this.#connect();
        } );

        this.#connection.connect();
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

    async #sync ( newConnection ) {
        if ( this.#syncStarted ) return;
        this.#syncStarted = true;

        while ( true ) {
            await sleep( SYNC_DELAY );

            // not connected
            if ( !this.isConnected ) break;

            // nothing to sync
            if ( !this.#pendingSubscribe.size && !this.#pendingUnsubscribe.size ) return;

            // subscribe
            if ( this.#pendingSubscribe.size ) {
                this.#connection.voidCall( "/subscribe", [ ...this.#pendingSubscribe ] );

                this.#pendingSubscribe.clear();
            }

            // unsubscribe
            if ( this.#pendingUnsubscribe.size ) {
                this.#connection.voidCall( "/unsubscribe", [ ...this.#pendingUnsubscribe ] );

                this.#pendingUnsubscribe.clear();
            }
        }

        this.#syncStarted = false;
    }
}
