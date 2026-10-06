import "#lib/result";
import Counter from "#lib/threads/counter";
import Mutex from "#lib/threads/mutex";
import Signal from "#lib/threads/signal";

export default class ActivityController {
    #isInitialized = false;
    #isStarted = false;
    #isDestroyed = false;
    #initMutex = new Mutex();
    #startMutex = new Mutex();
    #stopMutex = new Mutex();
    #destroyMutex = new Mutex();
    #activeRequestsCounter = new Counter();
    #startAbortController;
    #stopAbortController;
    #abortController = new AbortController();
    #doInit;
    #doStart;
    #doBeforeStop;
    #doStop;
    #doDestroy;
    #startSignal = new Signal();

    constructor ( { doInit, doStart, doBeforeStop, doStop, doDestroy } = {} ) {
        this.setDoInit( doInit );
        this.setDoStart( doStart );
        this.setDoBeforeStop( doBeforeStop );
        this.setDoStop( doStop );
        this.setDoDestroy( doDestroy );
    }

    // properties
    get isInitializing () {
        return this.#initMutex.isLocked;
    }

    get isInitialized () {
        return this.#isInitialized;
    }

    get isStarted () {
        return this.#isStarted;
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
        return this.#isDestroyed;
    }

    get activeRequestsCount () {
        return this.#activeRequestsCounter.value;
    }

    get abortSignal () {
        return this.#abortController.signal;
    }

    get doInit () {
        return this.#doInit;
    }

    get doStart () {
        return this.#doStart;
    }

    get doBeforeStop () {
        return this.#doBeforeStop;
    }

    get doStop () {
        return this.#doStop;
    }

    get doDestroy () {
        return this.#doDestroy;
    }

    // public
    async init ( options ) {

        // destroyed
        if ( this.#isDestroyed ) return result( [ 400, "Destroyed" ] );

        // initialized
        if ( this.#isInitialized ) return result( 200 );

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

        var res;

        // init
        try {
            res = result.try( await this._doInit( options ), {
                "allowUndefined": true,
            } );
        }
        catch ( e ) {
            res = result.fromError( e, {
                "log": false,
            } );
        }

        // initialized
        if ( res.ok ) {
            this.#isInitialized = true;
        }

        this.#initMutex.unlock( res );

        return res;
    }

    async start ( options ) {

        // destroyed
        if ( this.#isDestroyed ) return result( [ 400, "Destroyed" ] );

        // started
        if ( this.#isStarted && !this.isStopping ) return result( 200 );

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
            if ( this.#isStarted ) {
                res = result( 200 );

                this.#startMutex.unlock( res );

                return res;
            }
        }

        // start
        try {
            res = result.try( await this._doStart( signal, options ), {
                "allowUndefined": true,
            } );
        }
        catch ( e ) {
            res = result.fromError( e, {
                "log": false,
            } );
        }

        // started
        if ( res.ok ) {
            this.#isStarted = true;

            this.#startSignal.broadcast();
        }

        this.#startMutex.unlock( res );

        return res;
    }

    async stop ( options ) {

        // stopped
        if ( !this.#isStarted && !this.isStarting ) return result( 200 );

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
            if ( !this.#isStarted ) {
                res = result( 200 );

                this.#stopMutex.unlock( res );

                return res;
            }
        }

        try {

            // before stop
            res = result.try( await this._doBeforeStop( signal, options ), {
                "allowUndefined": true,
            } );
            if ( !res.ok ) throw res;

            // wait for active requests finished
            await this.#activeRequestsCounter.wait( { signal } );

            if ( signal.aborted ) throw result( [ 400, "Aborted" ] );

            // stop
            res = result.try( await this._doStop( signal, options ), {
                "allowUndefined": true,
            } );
            if ( !res.ok ) throw res;

            // stopped
            this.#isStarted = false;

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

        return res;
    }

    async waitStarted ( signal ) {
        if ( this.#isStarted ) return true;

        if ( this.#isDestroyed || this.isDestroying ) return false;

        await this.#startSignal.wait( { signal } );

        return this.#isStarted;
    }

    // XXX
    onExternalStop () {}

    async destroy ( options ) {

        // destroyed
        if ( this.#isDestroyed ) return result( 200 );

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

        var res;

        // destroy
        try {
            res = result.try( await this._doDestroy( options ), {
                "allowUndefined": true,
            } );
        }
        catch ( e ) {
            res = result.fromError( e, {
                "log": false,
            } );
        }

        // destroyed
        if ( res.ok ) {
            this.#isDestroyed = true;
        }

        this.#destroyMutex.unlock( res );

        return res;
    }

    beginActivity () {
        this.#activeRequestsCounter.value++;
    }

    endActivity () {

        // ignore unpaired call
        if ( !this.#activeRequestsCounter.value ) return;

        this.#activeRequestsCounter.value--;
    }

    setDoInit ( callback ) {
        this.#doInit = callback;

        return this;
    }

    setDoStart ( callback ) {
        this.#doStart = callback;

        return this;
    }

    setDoBeforeStop ( callback ) {
        this.#doBeforeStop = callback;

        return this;
    }

    setDoStop ( callback ) {
        this.#doStop = callback;

        return this;
    }

    setDoDestroy ( callback ) {
        this.#doDestroy = callback;

        return this;
    }

    // protected
    async _doInit ( options ) {
        return this.#doInit?.( options );
    }

    async _doStart ( signal, options ) {
        return this.#doStart?.( signal, options );
    }

    async _doBeforeStop ( signal, options ) {
        return this.#doBeforeStop?.( signal, options );
    }

    async _doStop ( signal, options ) {
        return this.#doStop?.( signal, options );
    }

    async _doDestroy ( options ) {
        return this.#doDestroy?.( options );
    }
}
