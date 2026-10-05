import IndexedDeque from "#lib/data-structures/indexed-deque";
import Events from "#lib/events";
import ObjectsRegistry from "#lib/objects-registry";

class SignalsSet extends ObjectsRegistry {

    // protected
    _createTarget ( id, destroy, options ) {
        return new Signal( { id, destroy } );
    }

    _isTargetDestroyable ( target ) {
        return target.isDestroyable;
    }
}

export default class Signal {
    #id;
    #destroy;
    #isSent = false;
    #value;
    #waitingThreads = new IndexedDeque();
    #_events;

    constructor ( { id, destroy } = {} ) {
        this.#id = id;
        this.#destroy = destroy;
    }

    // static
    static get Set () {
        return SignalsSet;
    }

    // properties
    get id () {
        return this.#id;
    }

    get isDestroyable () {
        return !this.#_events?.hasListeners() && !this.isSent && !this.waitingThreads;
    }

    get isSent () {
        return this.#isSent;
    }

    get value () {
        return this.#value;
    }

    get waitingThreads () {
        return this.#waitingThreads.length;
    }

    // public
    send ( value ) {
        const wasEmpty = this.#clearSignal();

        if ( this.#waitingThreads.length ) {
            this.#waitingThreads.shift()( value );

            this.#checkEmpty( wasEmpty );
        }
        else {

            // store signal
            this.#isSent = true;
            this.#value = value;
        }

        return this;
    }

    trySend ( value ) {
        const wasEmpty = this.#clearSignal();

        if ( this.#waitingThreads.length ) {
            this.#waitingThreads.shift()( value );
        }

        this.#checkEmpty( wasEmpty );

        return this;
    }

    broadcast ( value ) {
        const wasEmpty = this.#clearSignal();

        if ( this.#waitingThreads.length ) {
            const waitingThreads = this.#waitingThreads;

            this.#waitingThreads = new IndexedDeque();

            for ( const resolver of waitingThreads ) resolver( value );
        }

        this.#checkEmpty( wasEmpty );

        return this;
    }

    async wait ( { highPriority, signal } = {} ) {
        if ( this.isSent ) {
            const value = this.#value;

            const wasEmpty = this.#clearSignal();

            this.#checkEmpty( wasEmpty );

            return value;
        }
        else {
            if ( signal?.aborted ) return;

            return new Promise( resolve => {
                const onAbort = () => {
                        this.#waitingThreads.delete( resolver );

                        resolve();

                        this.#checkEmpty( false );
                    },
                    resolver = res => {
                        signal?.removeEventListener( "abort", onAbort );

                        resolve( res );
                    };

                signal?.addEventListener( "abort", onAbort, { "once": true } );

                if ( highPriority ) {
                    this.#waitingThreads.unshift( resolver );
                }
                else {
                    this.#waitingThreads.push( resolver );
                }
            } );
        }
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

    #clearSignal () {
        const wasEmpty = !this.#isSent && !this.#waitingThreads.length;

        this.#isSent = false;
        this.#value = undefined;

        return wasEmpty;
    }

    #checkEmpty ( wasEmpty ) {
        if ( wasEmpty || this.#isSent || this.#waitingThreads.length ) return;

        this.#_events?.emit( "empty" );

        this.#destroyIfPossible();
    }
}
