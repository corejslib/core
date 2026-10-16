import "#lib/result";
import Events from "#lib/events";
import Counter from "#lib/threads/counter";
import Mutex from "#lib/threads/mutex";
import Signal from "#lib/threads/signal";

const STATE = Object.freeze( {
        "CREATED": 0,
        "INITIALIZING": 1,
        "INITIALIZED": 2,
        "STARTING": 3,
        "STARTED": 4,
        "STOPPING": 5,
        "STOPPED": 6,
        "DESTROYING": 7,
        "DESTROYED": 8,
    } ),
    STATE_EVENT = Object.freeze( {
        [ STATE.CREATED ]: "created",
        [ STATE.INITIALIZING ]: "initializing",
        [ STATE.INITIALIZED ]: "initialized",
        [ STATE.STARTING ]: "starting",
        [ STATE.STARTED ]: "started",
        [ STATE.STOPPING ]: "stopping",
        [ STATE.STOPPED ]: "stopped",
        [ STATE.DESTROYING ]: "destroying",
        [ STATE.DESTROYED ]: "destroyed",
    } );

export default class LifecycleManager {
    static STATE = STATE;

    #idleTimeout;
    #onInit;
    #onStart;
    #onBeforeStop;
    #onStop;
    #onDestroy;

    #state = STATE.CREATED;
    #initMutex = new Mutex();
    #startMutex = new Mutex();
    #stopMutex = new Mutex();
    #destroyMutex = new Mutex();
    #activeRequestsCounter = new Counter();
    #startAbortController;
    #stopAbortController;
    #events = new Events();
    #abortController = new AbortController();
    #startSignal = new Signal();
    #idleTimer;

    constructor ( { idleTimeout, onInit, onStart, onBeforeStop, onStop, onDestroy } = {} ) {
        this.#idleTimeout = idleTimeout;

        this.setOnInit( onInit );
        this.setOnStart( onStart );
        this.setOnBeforeStop( onBeforeStop );
        this.setOnStop( onStop );
        this.setOnDestroy( onDestroy );

        this.#activeRequestsCounter.on( "finish", () => {
            if ( this.#state === STATE.STARTED ) {
                this.#events.emit( "idle" );

                this.#startIdleTimer();
            }
        } );
    }

    // properties
    get state () {
        return this.#state;
    }

    get isInitializing () {
        return this.#initMutex.isLocked;
    }

    get isInitialized () {
        return this.#state !== STATE.CREATED && this.#state !== STATE.INITIALIZING;
    }

    get isStarted () {
        return this.#state === STATE.STARTED || this.#state === STATE.STOPPING;
    }

    get isStarting () {
        return this.#startMutex.isLocked;
    }

    get isStopping () {
        return this.#stopMutex.isLocked;
    }

    get isDestroying () {
        return this.#destroyMutex.isLocked;
    }

    get isDestroyed () {
        return this.#state === STATE.DESTROYED;
    }

    get isIdle () {
        return this.#state === STATE.STARTED && !this.#activeRequestsCounter.value;
    }

    get activeRequestsCount () {
        return this.#activeRequestsCounter.value;
    }

    get abortSignal () {
        return this.#abortController.signal;
    }

    // public
    async init ( options ) {

        // destroyed
        if ( this.isDestroyed ) return result( [ 400, "Destroyed" ] );

        // initialized
        if ( this.isInitialized ) return result( 200 );

        // destroying
        if ( this.isDestroying ) {
            if ( this.isInitializing ) {
                return this.#initMutex.wait();
            }
            else {
                return result( [ 400, "Destroying" ] );
            }
        }

        // initializing
        if ( !this.#initMutex.tryLock() ) return this.#initMutex.wait();

        const prevState = this.#state;

        this.#setState( STATE.INITIALIZING );

        var res;

        // init
        try {
            res = result.try( await this._onInit( options ), {
                "allowUndefined": true,
            } );
        }
        catch ( e ) {
            res = result.fromError( e, {
                "log": false,
            } );
        }

        this.#initMutex.unlock( res );

        // initialized
        if ( res.ok ) {
            this.#setState( STATE.INITIALIZED, res );
        }
        else {
            this.#setState( prevState, res );
        }

        return res;
    }

    async start ( options ) {

        // destroyed
        if ( this.isDestroyed ) return result( [ 400, "Destroyed" ] );

        // started
        if ( this.isStarted && !this.isStopping ) return result( 200 );

        // destroying
        if ( this.isDestroying ) {
            if ( this.isStarting ) {
                return this.#startMutex.wait();
            }
            else {
                return result( [ 400, "Destroying" ] );
            }
        }

        // starting
        if ( !this.#startMutex.tryLock() ) return this.#startMutex.wait();

        // must be created right after the lock, so other methods can always abort it
        this.#startAbortController = new AbortController();

        const signal = this.#startAbortController.signal;

        var res;

        // wait for stop
        if ( this.isStopping ) {
            this.#stopAbortController.abort();

            await this.#stopMutex.wait();

            // stop was aborted or failed, service is still started
            if ( this.isStarted ) {
                res = result( 200 );

                this.#startMutex.unlock( res );

                return res;
            }
        }

        this.#setState( STATE.STARTING );

        // start
        try {
            res = result.try( await this._onStart( signal, options ), {
                "allowUndefined": true,
            } );
        }
        catch ( e ) {
            res = result.fromError( e, {
                "log": false,
            } );
        }

        this.#startMutex.unlock( res );

        // started
        if ( res.ok ) {
            this.#setState( STATE.STARTED, res );

            this.#startSignal.broadcast();
        }
        else {
            this.#setState( STATE.STOPPED, res );
        }

        return res;
    }

    async stop ( options ) {

        // stopped
        if ( !this.isStarted && !this.isStarting ) return result( 200 );

        // stopping
        if ( !this.#stopMutex.tryLock() ) return this.#stopMutex.wait();

        // must be created right after the lock, so other methods can always abort it
        this.#stopAbortController = new AbortController();

        const signal = this.#stopAbortController.signal;

        var res, abortController;

        // wait for start
        if ( this.isStarting ) {
            this.#startAbortController.abort();

            await this.#startMutex.wait();

            // start was aborted or failed, service is not started
            if ( !this.isStarted ) {
                res = result( 200 );

                this.#stopMutex.unlock( res );

                return res;
            }
        }

        this.#setState( STATE.STOPPING );

        try {

            // before stop
            res = result.try( await this._onBeforeStop( signal, options ), {
                "allowUndefined": true,
            } );
            if ( !res.ok ) throw res;

            // wait for active requests finished
            await this.#activeRequestsCounter.wait( { signal } );

            if ( signal.aborted ) throw result( [ 400, "Aborted" ] );

            // stop
            res = result.try( await this._onStop( signal, options ), {
                "allowUndefined": true,
            } );
            if ( !res.ok ) throw res;

            // stopped
            abortController = this.#abortController;
            this.#abortController = new AbortController();
        }
        catch ( e ) {
            res = result.fromError( e, {
                "log": false,
            } );
        }

        this.#stopMutex.unlock( res );

        abortController?.abort();

        if ( res.ok ) {
            this.#setState( STATE.STOPPED, res );
        }
        else {
            this.#setState( STATE.STARTED, res );
        }

        return res;
    }

    async destroy ( options ) {

        // destroyed
        if ( this.isDestroyed ) return result( 200 );

        // destroying
        if ( !this.#destroyMutex.tryLock() ) return this.#destroyMutex.wait();

        // wait for init
        if ( this.isInitializing ) await this.#initMutex.wait();

        // wait for start
        if ( this.isStarting ) {
            this.#startAbortController.abort();

            await this.#startMutex.wait();
        }

        // wait for stop
        if ( this.isStopping ) {
            this.#stopAbortController.abort();

            await this.#stopMutex.wait();
        }

        const prevState = this.#state;

        this.#setState( STATE.DESTROYING );

        var res;

        // destroy
        try {
            res = result.try( await this._onDestroy( options ), {
                "allowUndefined": true,
            } );
        }
        catch ( e ) {
            res = result.fromError( e, {
                "log": false,
            } );
        }

        this.#destroyMutex.unlock( res );

        // destroyed
        if ( res.ok ) {
            this.#setState( STATE.DESTROYED, res );
        }
        else {
            this.#setState( prevState, res );
        }

        this.#startSignal.broadcast();

        return res;
    }

    async waitStarted ( { signal } = {} ) {
        if ( this.isStarted ) return true;

        if ( this.isDestroyed || this.isDestroying ) return false;

        await this.#startSignal.wait( { signal } );

        return this.isStarted;
    }

    onExternalStop () {
        if ( this.isStarted ) {
            this.#setState( STATE.STOPPED, result( 200 ) );
        }
    }

    beginActivity () {
        this.#clearIdleTimer();

        this.#activeRequestsCounter.value++;

        this.#events.emit( "activity", this.#activeRequestsCounter.value );
    }

    endActivity () {

        // ignore unpaired call
        if ( !this.#activeRequestsCounter.value ) return;

        this.#activeRequestsCounter.value--;

        this.#events.emit( "activity", this.#activeRequestsCounter.value );
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

    setOnInit ( callback ) {
        this.#onInit = callback;

        return this;
    }

    setOnStart ( callback ) {
        this.#onStart = callback;

        return this;
    }

    setOnBeforeStop ( callback ) {
        this.#onBeforeStop = callback;

        return this;
    }

    setOnStop ( callback ) {
        this.#onStop = callback;

        return this;
    }

    setOnDestroy ( callback ) {
        this.#onDestroy = callback;

        return this;
    }

    // protected
    async _onInit ( options ) {
        return this.#onInit?.( options );
    }

    async _onStart ( signal, options ) {
        return this.#onStart?.( signal, options );
    }

    async _onBeforeStop ( signal, options ) {
        return this.#onBeforeStop?.( signal, options );
    }

    async _onStop ( signal, options ) {
        return this.#onStop?.( signal, options );
    }

    async _onDestroy ( options ) {
        return this.#onDestroy?.( options );
    }

    // private
    #setState ( state, res ) {
        this.#state = state;

        if ( state === STATE.STARTED ) {
            this.#startIdleTimer();
        }
        else {
            this.#clearIdleTimer();
        }

        this.#events.emit( STATE_EVENT[ state ], res );
    }

    #startIdleTimer () {
        this.#clearIdleTimer();

        if ( !this.#idleTimeout || !this.isIdle ) return;

        this.#idleTimer = setTimeout( () => {
            this.#idleTimer = null;

            // activity could appear, or state could change, while the timer was pending
            if ( !this.isIdle ) return;

            this.stop();
        }, this.#idleTimeout );

        this.#idleTimer.unref?.();
    }

    #clearIdleTimer () {
        if ( !this.#idleTimer ) return;

        clearTimeout( this.#idleTimer );

        this.#idleTimer = null;
    }
}
