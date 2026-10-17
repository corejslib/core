import "#lib/result";
import Events from "#lib/events";
import Counter from "#lib/threads/counter";
import Mutex from "#lib/threads/mutex";
import Signal from "#lib/threads/signal";

const STATE_EVENT = Object.freeze( {
    "created": "create",
    "initializing": "initializing",
    "initialized": "initialize",
    "starting": "starting",
    "started": "start",
    "stopping": "stopping",
    "stopped": "stopp",
    "destroying": "destroying",
    "destroyed": "destroy",
} );

export default class LifecycleManager {
    #idleTimeout;
    #onInit;
    #onStart;
    #onStop;
    #onDestroy;

    // init is performed only once, the result (ok or failed) is stored here
    #initResult = null;

    // actual state
    #state = "created";

    // pending transitional state, which the manager is heading to
    #targetState = null;

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

    constructor ( { idleTimeout, onInit, onStart, onStop, onDestroy } = {} ) {
        this.#idleTimeout = idleTimeout;

        this.setOnInit( onInit );
        this.setOnStart( onStart );
        this.setOnStop( onStop );
        this.setOnDestroy( onDestroy );

        this.#activeRequestsCounter.on( "finish", () => {
            if ( this.#state === "started" ) {
                this.#events.emit( "idle" );

                this.#startIdleTimer();
            }
        } );
    }

    // properties
    get idleTimeout () {
        return this.#idleTimeout;
    }

    // current settled state, or the transitional state, which the manager is heading to
    get state () {
        return this.#targetState ?? this.#state;
    }

    get isInitializing () {
        return this.state === "initializing";
    }

    // init was performed successfully, regardless of the current state
    get isInitialized () {
        return this.#initResult?.ok === true;
    }

    get isStarting () {
        return this.state === "starting";
    }

    get isStarted () {
        return this.state === "started";
    }

    get isStopping () {
        return this.state === "stopping";
    }

    get isStopped () {
        return this.state === "stopped";
    }

    get isDestroying () {
        return this.state === "destroying";
    }

    get isDestroyed () {
        return this.state === "destroyed";
    }

    get isIdle () {
        return this.state === "started" && !this.#activeRequestsCounter.value;
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
        if ( this.#isDestroyed ) return result( [ 400, "Destroyed" ] );

        // already initialized, or failed (init is performed only once)
        if ( this.#initResult ) {
            return this.#initResult.ok
                ? result( 200 )
                : this.#initResult;
        }

        // destroying
        if ( this.#isDestroying ) {
            if ( this.#isInitializing ) {
                return this.#initMutex.wait();
            }
            else {
                return result( [ 400, "Destroying" ] );
            }
        }

        // initializing
        if ( !this.#initMutex.tryLock() ) return this.#initMutex.wait();

        // do not override the target state of the operation, which called init
        if ( !this.#targetState ) this.#setTargetState( "initializing" );

        const prevState = this.#state;

        this.#setState( "initializing" );

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

        this.#initResult = res;

        this.#initMutex.unlock( res );

        this.#clearTargetState( "initializing" );

        // initialized
        if ( res.ok ) {
            this.#setState( "initialized", res );
        }

        // failed, rollback, start is not possible anymore, wake up those who wait for it
        else {
            this.#setState( prevState, res );

            this.#startSignal.broadcast();
        }

        return res;
    }

    async start ( options ) {

        // destroyed
        if ( this.#isDestroyed ) return result( [ 400, "Destroyed" ] );

        // init failed
        if ( this.#isInitFailed ) return this.#initResult;

        // started
        if ( this.#isStarted && !this.#isStopping ) return result( 200 );

        // destroying
        if ( this.#isDestroying ) {
            if ( this.#isStarting ) {
                return this.#startMutex.wait();
            }
            else {
                return result( [ 400, "Destroying" ] );
            }
        }

        // starting
        if ( !this.#startMutex.tryLock() ) return this.#startMutex.wait();

        this.#setTargetState( "starting" );

        // must be created right after the lock, so other methods can always abort it
        this.#startAbortController = new AbortController();

        const signal = this.#startAbortController.signal;

        var res;

        // init, if it has not been performed yet
        if ( !this.isInitialized ) {
            res = await this.init();

            if ( res.ok && signal.aborted ) res = result( [ 400, "Aborted" ] );

            if ( !res.ok ) {
                this.#startMutex.unlock( res );

                this.#clearTargetState( "starting" );

                return res;
            }
        }

        // wait for stop
        if ( this.#isStopping ) {
            this.#stopAbortController.abort();

            await this.#stopMutex.wait();

            // stop was aborted or failed, service is still started
            if ( this.#isStarted ) {
                res = result( 200 );

                this.#startMutex.unlock( res );

                this.#clearTargetState( "starting" );

                return res;
            }
        }

        // last successful state, to which the manager is rolled back on failure
        const prevState = this.#state;

        this.#setState( "starting" );

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

        this.#clearTargetState( "starting" );

        // started
        if ( res.ok ) {
            this.#setState( "started", res );

            this.#startSignal.broadcast();
        }

        // failed, rollback
        else {
            this.#setState( prevState, res );
        }

        return res;
    }

    async stop ( options ) {

        // init failed
        if ( this.#isInitFailed ) return this.#initResult;

        // stopped
        if ( !this.#isStarted && !this.#isStarting ) return result( 200 );

        // stopping
        if ( !this.#stopMutex.tryLock() ) return this.#stopMutex.wait();

        this.#setTargetState( "stopping" );

        // must be created right after the lock, so other methods can always abort it
        this.#stopAbortController = new AbortController();

        const signal = this.#stopAbortController.signal;

        var res, abortController;

        // wait for start
        if ( this.#isStarting ) {
            this.#startAbortController.abort();

            await this.#startMutex.wait();

            // start was aborted or failed, service is not started
            if ( !this.#isStarted ) {
                res = result( 200 );

                this.#stopMutex.unlock( res );

                this.#clearTargetState( "stopping" );

                return res;
            }
        }

        this.#setState( "stopping" );

        try {

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

        this.#clearTargetState( "stopping" );

        if ( res.ok ) {
            this.#setState( "stopped", res );
        }

        // failed, rollback
        else {
            this.#setState( "started", res );
        }

        return res;
    }

    async destroy ( options ) {

        // destroyed
        if ( this.#isDestroyed ) return result( 200 );

        // destroying
        if ( !this.#destroyMutex.tryLock() ) return this.#destroyMutex.wait();

        // state is "destroying" from now on, regardless of the operations being awaited below
        this.#setTargetState( "destroying" );

        this.#events.emit( STATE_EVENT.destroying );

        // wait for init
        if ( this.#isInitializing ) await this.#initMutex.wait();

        // wait for start
        if ( this.#isStarting ) {
            this.#startAbortController.abort();

            await this.#startMutex.wait();
        }

        var res;

        // stop (if stop is already in progress, just waits for it),
        // not required if init failed, service could not be started
        res = this.#isInitFailed
            ? result( 200 )
            : await this.stop();

        // last successful state, to which the manager is rolled back on failure
        const prevState = this.#state;

        // destroy, only if stopped
        if ( res.ok ) {

            // "destroying" event is already emitted
            this.#state = "destroying";

            this.#clearIdleTimer();

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
        }

        this.#destroyMutex.unlock( res );

        this.#clearTargetState( "destroying" );

        // destroyed
        if ( res.ok ) {
            this.#setState( "destroyed", res );
        }

        // failed, rollback
        else {
            this.#setState( prevState, res );
        }

        this.#startSignal.broadcast();

        return res;
    }

    async waitStart ( { signal } = {} ) {
        if ( this.#isStarted ) return true;

        if ( this.#isDestroyed || this.#isDestroying ) return false;

        // init failed
        if ( this.#isInitFailed ) return false;

        await this.#startSignal.wait( { signal } );

        return this.#isStarted;
    }

    onExternalStop () {
        if ( this.#isStarted ) {
            this.#setState( "stopped", result( 200 ) );
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

    async _onStop ( signal, options ) {
        return this.#onStop?.( signal, options );
    }

    async _onDestroy ( options ) {
        return this.#onDestroy?.( options );
    }

    // private

    // operation is in progress (mutex is locked), regardless of the public state
    get #isInitializing () {
        return this.#initMutex.isLocked;
    }

    get #isStarting () {
        return this.#startMutex.isLocked;
    }

    get #isStopping () {
        return this.#stopMutex.isLocked;
    }

    get #isDestroying () {
        return this.#destroyMutex.isLocked;
    }

    // based on the actual state, regardless of the public state
    get #isStarted () {
        return this.#state === "started" || this.#state === "stopping";
    }

    get #isDestroyed () {
        return this.#state === "destroyed";
    }

    get #isInitFailed () {
        return this.#initResult?.ok === false;
    }

    #setState ( state, res ) {
        this.#state = state;

        if ( state === "started" ) {
            this.#startIdleTimer();
        }
        else {
            this.#clearIdleTimer();
        }

        this.#events.emit( STATE_EVENT[ state ], res );
    }

    #setTargetState ( state ) {

        // "destroying" can't be overridden by any other transition
        if ( this.#targetState === "destroying" && state !== "destroying" ) return;

        this.#targetState = state;
    }

    #clearTargetState ( state ) {

        // clear only if the target was not overridden by another operation
        if ( this.#targetState === state ) {
            this.#targetState = null;
        }
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
