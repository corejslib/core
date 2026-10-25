import "#lib/result";
import Events from "#lib/events";
import Counter from "#lib/threads/counter";
import Mutex from "#lib/threads/mutex";
import Signal from "#lib/threads/signal";

const STATE_EVENT = Object.freeze( {
    "starting": "starting",
    "started": "start",
    "stopping": "stopping",
    "stopped": "stop",
    "destroying": "destroying",
    "destroyed": "destroy",
} );

export default class LifecycleManager {
    #idleTimeout;
    #onStart;
    #onStop;
    #onDestroy;
    #onDestroyThreads;
    #onIdle;

    // actual state
    #state = "stopped";

    // pending transitional state, which the manager is heading to
    #targetState = null;

    #startMutex = new Mutex();
    #stopMutex = new Mutex();
    #destroyMutex = new Mutex();
    #activeThreadsCounter = new Counter();
    #startAbortController;
    #stopAbortController;
    #events = new Events();
    #abortController = new AbortController();
    #startSignal = new Signal();
    #stopSignal = new Signal();
    #destroySignal = new Signal();
    #idleTimer;

    constructor ( { idleTimeout, onStart, onStop, onDestroy, onDestroyThreads, onIdle } = {} ) {
        this.#idleTimeout = idleTimeout;

        this.setOnStart( onStart );
        this.setOnStop( onStop );
        this.setOnDestroy( onDestroy );
        this.setOnDestroyThreads( onDestroyThreads );
        this.setOnIdle( onIdle );

        this.#activeThreadsCounter.on( "finish", () => {
            if ( this.#state === "started" ) {
                this.#events.emit( "idle" );

                this.#startIdleTimer();
            }
        } );
    }

    // properties
    get state () {
        return this.#targetState ?? this.#state;
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
        return this.state === "started" && !this.#activeThreadsCounter.value;
    }

    get canBeginThread () {
        return this.isStarted || this.isStarting;
    }

    get activeThreadsCount () {
        return this.#activeThreadsCounter.value;
    }

    get abortSignal () {
        return this.#abortController.signal;
    }

    get idleTimeout () {
        return this.#idleTimeout;
    }

    // public
    async start () {

        // destroyed
        if ( this.#isDestroyed ) return result( [ 500, "Destroyed" ] );

        // started
        if ( this.#isStarted && !this.#isStopping ) return result( 200 );

        // destroying
        if ( this.#isDestroying ) {
            if ( this.#isStarting ) {
                return this.#startMutex.wait();
            }
            else {
                return result( [ 500, "Destroying" ] );
            }
        }

        // starting
        if ( !this.#startMutex.tryLock() ) return this.#startMutex.wait();

        this.#setTargetState( "starting" );

        // must be created right after the lock, so other methods can always abort it
        this.#startAbortController = new AbortController();

        const signal = this.#startAbortController.signal;

        var res;

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
            res = result.try( await this.#onStart?.( signal ), {
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

            // service is not running
            this.#stopSignal.broadcast();
        }

        return res;
    }

    async stop () {

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

                // service is not running
                this.#stopSignal.broadcast();

                return res;
            }
        }

        this.#setState( "stopping" );

        try {

            // wait for active requests finished
            await this.#activeThreadsCounter.wait( { signal } );

            if ( signal.aborted ) throw result( [ 500, "Aborted" ] );

            // stop
            res = result.try( await this.#onStop?.( signal ), {
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

            this.#stopSignal.broadcast();
        }

        // failed, rollback
        else {
            this.#setState( "started", res );

            // service is started again, wake up those who wait for it
            this.#startSignal.broadcast();
        }

        return res;
    }

    async forceStop () {
        return this.destroyThreads().stop();
    }

    async destroy () {

        // destroyed
        if ( this.#isDestroyed ) return result( 200 );

        // destroying
        if ( !this.#destroyMutex.tryLock() ) return this.#destroyMutex.wait();

        // state is "destroying" from now on, regardless of the operations being awaited below
        this.#setTargetState( "destroying" );

        this.#events.emit( STATE_EVENT.destroying );

        // wait for start
        if ( this.#isStarting ) {
            this.#startAbortController.abort();

            await this.#startMutex.wait();
        }

        var res;

        // stop (if stop is already in progress, just waits for it)
        res = await this.stop();

        // last successful state, to which the manager is rolled back on failure
        const prevState = this.#state;

        // destroy, only if stopped
        if ( res.ok ) {

            // "destroying" event is already emitted
            this.#state = "destroying";

            this.#clearIdleTimer();

            try {
                res = result.try( await this.#onDestroy?.(), {
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

            this.#destroySignal.broadcast();
        }

        // failed, rollback
        else {
            this.#setState( prevState, res );
        }

        this.#startSignal.broadcast();
        this.#stopSignal.broadcast();

        return res;
    }

    async forceDestroy () {
        return this.destroyThreads().destroy();
    }

    destroyThreads () {
        this.#onDestroyThreads?.();

        this.#events.emit( "destroy-threads" );

        return this;
    }

    async waitStart ( { signal } = {} ) {

        // destroyed, or destroying (the service is about to stop)
        if ( this.#isDestroyed || this.#isDestroying ) return false;

        // "stopping" is not "started", the service is about to stop
        if ( this.#state === "started" ) return true;

        await this.#startSignal.wait( { signal } );

        return this.#state === "started";
    }

    async waitStop ( { signal } = {} ) {
        if ( this.#isNotRunning ) return true;

        await this.#stopSignal.wait( { signal } );

        return this.#isNotRunning;
    }

    async waitDestroy ( { signal } = {} ) {
        if ( this.#isDestroyed ) return true;

        await this.#destroySignal.wait( { signal } );

        return this.#isDestroyed;
    }

    beginThread () {
        this.#clearIdleTimer();

        this.#activeThreadsCounter.value++;

        this.#events.emit( "activity", this.#activeThreadsCounter.value );
    }

    endThread () {

        // ignore unpaired call
        if ( !this.#activeThreadsCounter.value ) return;

        this.#activeThreadsCounter.value--;

        this.#events.emit( "activity", this.#activeThreadsCounter.value );
    }

    async runThread ( callback, { signal } = {} ) {
        if ( !this.canBeginThread ) {
            return result( [ 500, "Unable to start thread (" + this.state + ")" ] );
        }

        // must be captured before the callback, the controller is replaced on stop
        signal = signal
            ? AbortSignal.any( [ signal, this.abortSignal ] )
            : this.abortSignal;

        if ( signal.aborted ) return result( [ 500, "Aborted" ] );

        this.beginThread();

        try {
            return result.try( await callback( signal ), {
                "allowUndefined": true,
            } );
        }
        catch ( e ) {
            return result.fromError( e, {
                "log": false,
            } );
        }
        finally {
            this.endThread();
        }
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

    setIdleTimeout ( value ) {
        this.#idleTimeout = value;

        // timer is running only in the "started" state, restart it with the new value
        if ( this.#state === "started" ) this.#startIdleTimer();

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

    setOnDestroyThreads ( callback ) {
        this.#onDestroyThreads = callback;

        return this;
    }

    setOnIdle ( callback ) {
        this.#onIdle = callback;

        return this;
    }

    // private
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

    // service is neither started nor starting, regardless of the public state
    get #isNotRunning () {
        return !this.#isStarted && !this.#isStarting;
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

        this.#idleTimer = setTimeout( async () => {
            this.#idleTimer = null;

            // activity could appear, or state could change, while the timer was pending
            if ( !this.isIdle ) return;

            try {
                await this.#onIdle?.();
            }
            catch {}
        }, this.#idleTimeout );

        this.#idleTimer.unref?.();
    }

    #clearIdleTimer () {
        if ( !this.#idleTimer ) return;

        clearTimeout( this.#idleTimer );

        this.#idleTimer = null;
    }
}
