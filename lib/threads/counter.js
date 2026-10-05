import Events from "#lib/events";
import ObjectsRegistry from "#lib/objects-registry";

class CountersSet extends ObjectsRegistry {

    // protected
    _createTarget ( id, destroy, options = {} ) {
        return new Counter( { ...options, id, destroy } );
    }

    _isTargetDestroyable ( target ) {
        return target.isDestroyable;
    }
}

export default class Counter {
    #id;
    #destroy;
    #value = 0;
    #waitingThreads = new Set();
    #_events;

    constructor ( { id, destroy, value } = {} ) {
        this.#id = id;
        this.#destroy = destroy;

        if ( value ) this.#setValue( value );
    }

    // static
    static get Set () {
        return CountersSet;
    }

    // properties
    get id () {
        return this.#id;
    }

    get isDestroyable () {
        return this.isFinished && !this.waitingThreads && !this.#_events?.hasListeners();
    }

    get value () {
        return this.#value;
    }

    set value ( value ) {
        this.#setValue( value );
    }

    get isFinished () {
        return !this.#value;
    }

    get waitingThreads () {
        return this.#waitingThreads.size;
    }

    // public
    async wait ( { signal } = {} ) {
        if ( !this.#value ) return;

        if ( signal?.aborted ) return;

        return new Promise( resolve => {
            const onAbort = () => {
                    this.#waitingThreads.delete( resolver );

                    resolve();

                    this.#destroyIfPossible();
                },
                resolver = () => {
                    signal?.removeEventListener( "abort", onAbort );

                    resolve();
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

    #setValue ( value ) {
        if ( !Number.isInteger( value ) ) throw new TypeError( "Counter value must be integer" );

        if ( this.#value === value ) return;

        const oldValue = this.#value;

        this.#value = value;

        if ( !oldValue ) {
            this.#_events?.emit( "start" );
        }
        else if ( !this.#value ) {
            this.#runWaitingThreads();

            this.#_events?.emit( "finish" );

            this.#destroyIfPossible();
        }
    }

    #runWaitingThreads () {
        if ( !this.#waitingThreads.size ) return;

        const waitingThreads = this.#waitingThreads;

        this.#waitingThreads = new Set();

        for ( const resolver of waitingThreads ) {
            resolver();
        }
    }
}
