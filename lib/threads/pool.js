import "#lib/result";
import Deque from "#lib/data-structures/deque";
import Events from "#lib/events";
import ObjectsRegistry from "#lib/objects-registry";
import Signal from "#lib/threads/signal";

const DEFAULT_MAX_RUNNING_THREADS = 1,
    DEFAULT_MAX_WAITING_THREADS = Infinity;

class ThreadsPoolsSet extends ObjectsRegistry {

    // protected
    _createTarget ( id, destroy, options = {} ) {
        return new ThreadsPool( { ...options, id, destroy } );
    }

    _isTargetDestroyable ( target ) {
        return target.isDestroyable;
    }
}

export default class ThreadsPool {
    #id;
    #destroy;
    #maxRunningThreads;
    #maxWaitingThreads;
    #runningThreads = 0;
    #waitingThreads = new Deque();
    #isPaused = false;
    #isDestroying = false;
    #destroySignal;
    #_events;

    constructor ( { id, destroy, maxRunningThreads, maxWaitingThreads } = {} ) {
        this.#id = id;
        this.#destroy = destroy;
        this.#setMaxRunningThreads( maxRunningThreads ?? DEFAULT_MAX_RUNNING_THREADS );
        this.maxWaitingThreads = maxWaitingThreads ?? DEFAULT_MAX_WAITING_THREADS;
    }

    // static
    static get Set () {
        return ThreadsPoolsSet;
    }

    // properties
    get id () {
        return this.#id;
    }

    get isDestroyable () {
        return !this.#_events?.hasListeners() && this.isEmpty && !this.isPaused;
    }

    get maxRunningThreads () {
        return this.#maxRunningThreads;
    }

    set maxRunningThreads ( value ) {
        const oldValue = this.#maxRunningThreads;

        this.#setMaxRunningThreads( value );

        if ( this.#maxRunningThreads > oldValue ) {
            this.#runWaitingThreads();
        }
    }

    get maxWaitingThreads () {
        return this.#maxWaitingThreads;
    }

    set maxWaitingThreads ( value ) {
        if ( value !== Infinity && ( !Number.isInteger( value ) || value < 0 ) ) throw new TypeError( "ThreadsPool maxWaitingThreads value must be integer >= 0 or Infinity" );

        this.#maxWaitingThreads = value;
    }

    get runningThreads () {
        return this.#runningThreads;
    }

    get freeThreads () {
        if ( this.#isDestroying ) return 0;

        return this.#realFreeThreads;
    }

    get waitingThreads () {
        return this.#waitingThreads.length;
    }

    get freeWaitingThreads () {
        if ( this.#isDestroying ) return 0;

        const freeWaitingThreads = this.#maxWaitingThreads - this.waitingThreads;

        return freeWaitingThreads < 0
            ? 0
            : freeWaitingThreads;
    }

    get totalThreads () {
        return this.#maxRunningThreads + this.#maxWaitingThreads;
    }

    get totalFreeThreads () {
        return this.freeThreads + this.freeWaitingThreads;
    }

    get isEmpty () {
        return !this.#runningThreads && !this.waitingThreads;
    }

    get isPaused () {
        return this.#isPaused;
    }

    get isDestroying () {
        return this.#isDestroying;
    }

    get stats () {
        return {
            "maxRunningThreads": this.maxRunningThreads,
            "maxWaitingThreads": this.maxWaitingThreads,
            "totalThreads": this.totalThreads,
            "runningThreads": this.runningThreads,
            "freeThreads": this.freeThreads,
            "waitingThreads": this.waitingThreads,
            "freeWaitingThreads": this.freeWaitingThreads,
            "totalFreeThreads": this.totalFreeThreads,
        };
    }

    // public
    async runThread ( thread, { highPriority } = {} ) {
        return this.#runThread( thread, highPriority );
    }

    pause () {
        this.#isPaused = true;

        // waiting threads will never run
        if ( this.#isDestroying ) this.#rejectWaitingThreads();

        return this;
    }

    resume () {
        if ( this.#isPaused ) {
            this.#isPaused = false;

            this.#runWaitingThreads();

            // paused pool could not be destroyed
            this.#destroyIfPossible();
        }

        return this;
    }

    async destroy () {
        if ( !this.#isDestroying ) {
            this.#isDestroying = true;
            this.#destroySignal = new Signal();
        }

        // paused pool will never run waiting threads, reject them
        if ( this.#isPaused ) this.#rejectWaitingThreads();

        if ( this.isEmpty ) return;

        return this.#destroySignal.wait();
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

    get #realFreeThreads () {
        if ( this.#isPaused ) return 0;

        const freeThreads = this.#maxRunningThreads - this.#runningThreads;

        return freeThreads < 0
            ? 0
            : freeThreads;
    }

    #destroyIfPossible () {
        if ( this.isDestroyable ) this.#destroy?.();
    }

    #setMaxRunningThreads ( value ) {
        if ( !Number.isInteger( value ) || value <= 0 ) throw new TypeError( "ThreadsPool maxRunningThreads value must be integer > 0" );

        this.#maxRunningThreads = value;
    }

    async #runThread ( thread, highPriority ) {

        // service is destroying
        if ( this.#isDestroying ) return result( -32_816 );

        // start thread immediately
        if ( this.#realFreeThreads ) {
            this.#runningThreads++;
        }

        // add thread to the queue
        else {

            // queue is full, too many requests
            if ( !this.freeWaitingThreads ) return result( -32_802 );

            const canRun = await new Promise( resolve => {
                if ( highPriority ) {
                    this.#waitingThreads.unshift( resolve );
                }
                else {
                    this.#waitingThreads.push( resolve );
                }
            } );

            // rejected, pool is destroying
            if ( !canRun ) return result( -32_816 );
        }

        var res;

        // run thread
        try {
            res = result.try( await thread(), { "allowUndefined": true } );
        }
        catch ( e ) {
            res = result.fromError( e );
        }

        // finish thread
        this.#runningThreads--;

        this.#runWaitingThreads();

        this.#checkEmpty();

        return res;
    }

    #runWaitingThreads () {

        // run waiting threads
        while ( this.waitingThreads && this.#realFreeThreads ) {
            this.#runningThreads++;

            this.#waitingThreads.shift()( true );
        }

        // has free threads
        if ( this.freeThreads ) this.#_events?.emit( "freeThreads", this );
    }

    #rejectWaitingThreads () {
        if ( !this.waitingThreads ) return;

        while ( this.waitingThreads ) {
            this.#waitingThreads.shift()( false );
        }

        this.#checkEmpty();
    }

    // must be called only after the pool has become empty (a thread finished or waiting threads were rejected)
    #checkEmpty () {
        if ( !this.isEmpty ) return;

        // destroy complete
        if ( this.#isDestroying ) this.#destroySignal.broadcast();

        this.#_events?.emit( "empty", this );

        this.#destroyIfPossible();
    }
}
