import IndexedDeque from "#lib/data-structures/indexed-deque";
import Events from "#lib/events";
import ProxyFinalizationRegistry from "#lib/proxy-finalization-registry";

class MutexesSet extends ProxyFinalizationRegistry {

    // protected
    _createTarget ( id, destroy, options ) {
        return new Mutex( { id, destroy } );
    }

    _isTargetDestroyable ( target ) {
        return target.isDestroyable;
    }
}

export default class Mutex {
    #id;
    #destroy;
    #locked = false;
    #waitingLocks = new IndexedDeque();
    #waitingThreads = new Set();
    #abortController = new AbortController();
    #_events;

    constructor ( { id, destroy } = {} ) {
        this.#id = id;
        this.#destroy = destroy;
    }

    // static
    static get Set () {
        return MutexesSet;
    }

    // properties
    get id () {
        return this.#id;
    }

    get isDestroyable () {
        return !this.isLocked && !this.#_events?.hasListeners() && !this.waitingLocks && !this.waitingThreads;
    }

    get isLocked () {
        return this.#locked;
    }

    get waitingLocks () {
        return this.#waitingLocks.length;
    }

    get waitingThreads () {
        return this.#waitingThreads.size;
    }

    get abortSignal () {
        return this.#abortController.signal;
    }

    // public
    tryLock () {
        if ( this.#locked ) {
            return false;
        }
        else {
            this.#onLock();

            return true;
        }
    }

    async lock ( { signal } = {} ) {
        if ( !this.#locked ) {
            this.#onLock();

            return true;
        }
        else {
            if ( signal?.aborted ) return false;

            return new Promise( resolve => {
                const onAbort = () => {
                        this.#waitingLocks.delete( resolver );

                        resolve( false );

                        this.#destroyIfPossible();
                    },
                    resolver = () => {
                        signal?.removeEventListener( "abort", onAbort );

                        resolve( true );
                    };

                signal?.addEventListener( "abort", onAbort, { "once": true } );

                this.#waitingLocks.push( resolver );
            } );
        }
    }

    unlock ( value ) {
        if ( !this.#locked ) return this;

        const abortController = this.#abortController;

        this.#abortController = new AbortController();
        abortController.abort();

        this.#runWaitingThreads( value );

        if ( this.#waitingLocks.length ) {
            this.#waitingLocks.shift()();
        }
        else {
            this.#locked = false;

            this.#_events?.emit( "unlock" );

            this.#destroyIfPossible();
        }

        return this;
    }

    async wait ( { signal } = {} ) {
        if ( !this.isLocked ) return;

        if ( signal?.aborted ) return;

        return new Promise( resolve => {
            const onAbort = () => {
                    this.#waitingThreads.delete( resolver );

                    resolve();

                    this.#destroyIfPossible();
                },
                resolver = res => {
                    signal?.removeEventListener( "abort", onAbort );

                    resolve( res );
                };

            signal?.addEventListener( "abort", onAbort, { "once": true } );

            this.#waitingThreads.add( resolver );
        } );
    }

    on ( name, listener ) {
        this.#events.on( name, listener );

        return this;
    }

    once ( name, listener ) {
        this.#events.once( name, listener );

        return this;
    }

    off ( name, listener ) {
        this.#events.off( name, listener );

        return this;
    }

    [ Symbol.dispose ] () {
        this.unlock();
    }

    async [ Symbol.asyncDispose ] () {
        this.unlock();
    }

    // private
    get #events () {
        if ( !this.#_events ) {
            this.#_events = new Events().watch( () => this.#destroyIfPossible() );
        }

        return this.#_events;
    }

    #destroyIfPossible () {
        if ( this.isDestroyable ) this.#destroy?.();
    }

    #onLock () {
        this.#locked = true;
    }

    #runWaitingThreads ( value ) {
        if ( !this.#waitingThreads.size ) return;

        const waitingThreads = this.#waitingThreads;

        this.#waitingThreads = new Set();

        for ( const resolver of waitingThreads ) {
            resolver( value );
        }
    }
}
