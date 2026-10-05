import constants from "#lib/sql/constants";
import { sql } from "#lib/sql/query";
import Signal from "#lib/threads/signal";

const SQL = {
    "publishQuery": sql`SELECT pg_notify( ?, ?::text )`.prepare(),
};

export default Super =>
    class extends ( Super || class {} ) {
        #pid;
        #connection;
        #isConnected = false;
        #listen = new Set();
        #pendingSubscribe = new Set();
        #pendingUnsubscribe = new Set();
        #waitConnectSignal = new Signal();
        #abortController = new AbortController();

        constructor () {
            super();

            // watch for notifications subscribe
            this.watch( this.#watcher.bind( this ) );
        }

        // properties
        get pid () {
            return this.#pid;
        }

        get isConnected () {
            return this.#isConnected;
        }

        get abortSignal () {
            return this.#abortController.signal;
        }

        // public
        async waitConnect ( signal ) {
            if ( this.#isConnected ) return true;

            if ( this.isDestroyed ) return false;

            await this.#waitConnectSignal.wait( { signal } );

            // false, if wait was aborted or object was destroyed
            return this.#isConnected;
        }

        async publish ( name, data ) {
            if ( !this.#isConnected ) return;

            return this.#connection.select( SQL.publishQuery, [ name, data ] );
        }

        // protected
        _connect () {
            if ( this.isDestroyed ) return;

            if ( this.#connection ) return;

            this.#connection = this._newConnection();
            this.#connection.once( "connect", this.#onConnect.bind( this ) );
            this.#connection.once( "destroy", this.#onDestroy.bind( this ) );
        }

        _destroy () {
            if ( this.#connection ) this.#connection.destroy();

            this.#waitConnectSignal.broadcast();

            if ( super._destroy ) return super._destroy();
        }

        // private
        #onConnect ( connection ) {
            if ( this.isDestroyed ) {
                this.#connection.destroy();

                return;
            }

            this.#isConnected = true;
            this.#pid = connection.pid;

            this.#pendingSubscribe = new Set( this.#listen );
            this.#pendingUnsubscribe.clear();

            this.#sync();

            this.#waitConnectSignal.broadcast();

            this.emit( "connect" );
        }

        #onDestroy () {
            const wasConnected = this.#isConnected;

            this.#connection = null;
            this.#isConnected = false;
            this.#pid = null;

            const abortController = this.#abortController;
            this.#abortController = new AbortController();
            abortController.abort();

            this._connect();

            if ( wasConnected ) this.emit( "disconnect" );
        }

        #watcher ( name, subscribe ) {

            // reserved event
            if ( constants.reservedEvents.has( name ) ) return;

            if ( subscribe ) {

                // check, that event name is enumerated in schema
                if ( this.schema.isLoaded && !this.schema.isEventValid( name ) ) throw `Event name "${ name }" is not emitted by the database`;

                this.#listen.add( name );
                this.#pendingSubscribe.add( name );
                this.#pendingUnsubscribe.delete( name );
            }
            else {
                this.#listen.delete( name );
                this.#pendingSubscribe.delete( name );
                this.#pendingUnsubscribe.add( name );
            }

            this.#sync();
        }

        async #sync () {
            if ( !this.#isConnected ) return;

            const sql = [];

            if ( this.#pendingSubscribe.size ) {
                this.#pendingSubscribe.forEach( name => sql.push( `LISTEN "${ name }";` ) );

                this.#pendingSubscribe.clear();
            }

            if ( this.#pendingUnsubscribe.size ) {
                this.#pendingUnsubscribe.forEach( name => sql.push( `UNLISTEN "${ name }";` ) );

                this.#pendingUnsubscribe.clear();
            }

            // nothing to sync
            if ( !sql.length ) return;

            const res = await this.#connection.do( sql.join( " " ) );

            if ( !this.#isConnected ) return;

            if ( !res.ok ) this.#connection.destroy();
        }
    };
