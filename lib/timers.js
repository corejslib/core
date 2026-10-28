import Interval from "#lib/interval";
import isBrowser from "#lib/is-browser";

const MAX_TIMEOUT = 0x7FFF_FFFF;

export class Timeout {
    #delay;
    #target;
    #callback;
    #repeat;
    #signal;
    #iteration = 0;
    #signalListener;
    #timeout;
    #ref = true;
    #isDone = false;
    #isAborted = false;

    constructor ( delay, callback, { repeat, signal } = {} ) {
        this.#repeat = repeat;

        // Date
        if ( delay instanceof Date ) {
            this.#repeat = null;

            this.#target = delay.getTime() || 0;
        }

        // Temporal.Instant
        else if ( delay instanceof Temporal.Instant ) {
            this.#repeat = null;

            this.#target = delay.epochMilliseconds;
        }

        // Temporal.ZonedDateTime
        else if ( delay instanceof Temporal.ZonedDateTime ) {
            this.#repeat = null;

            this.#target = delay.epochMilliseconds;
        }

        // Interval string
        else if ( typeof delay === "string" ) {
            delay = new Interval( delay ).toMilliseconds().rounded.number;
        }

        // Interval
        else if ( delay instanceof Interval ) {
            delay = delay.toMilliseconds().rounded.number;
        }

        // absolute date is used, delay is not needed
        if ( this.#target != null ) {
            this.#delay = 0;
        }
        else {
            this.#delay = delay || 0;
        }

        this.#callback = callback;

        if ( signal ) {

            // signal is already aborted
            if ( signal.aborted ) {
                this.#onAbort();

                return;
            }

            this.#signal = signal;

            this.#signalListener = this.#onAbort.bind( this );

            signal.addEventListener( "abort", this.#signalListener );
        }

        // nothing to iterate
        if ( this.#repeat < 0 ) {
            this.#clear();
        }

        // start iteration
        else {
            this.#start();
        }
    }

    // properties
    get isAborted () {
        return this.#isAborted;
    }

    get isDone () {
        return this.#isDone;
    }

    get repeat () {
        return this.#repeat;
    }

    get iteration () {
        return this.#iteration;
    }

    hasRef () {
        return this.#ref;
    }

    // public
    clear () {
        this.#clear();

        return this;
    }

    ref () {
        this.#ref = true;

        if ( !isBrowser ) {
            this.#timeout?.ref();
        }

        return this;
    }

    unref () {
        this.#ref = false;

        if ( !isBrowser ) {
            this.#timeout?.unref();
        }

        return this;
    }

    // private
    #clear () {
        this.#isDone = true;

        this.#callback = null;

        this.#clearTimeout();

        if ( this.#signal ) {
            this.#signal.removeEventListener( "abort", this.#signalListener );

            this.#signalListener = null;

            this.#signal = null;
        }
    }

    #clearTimeout () {
        if ( this.#timeout ) {
            clearTimeout( this.#timeout );

            this.#timeout = null;
        }
    }

    // start the next iteration
    #start () {
        this.#clearTimeout();

        // the target date is calculated for each iteration, so that long intervals are repeated correctly
        this.#wait( this.#target ?? Date.now() + this.#delay );
    }

    #wait ( target ) {
        const delay = target - Date.now();

        // long timeout is split into several parts
        if ( delay > MAX_TIMEOUT ) {
            this.#setGlobalTimeout( MAX_TIMEOUT, () => this.#wait( target ) );
        }
        else {
            this.#setGlobalTimeout( delay, this.#onTimeout.bind( this ) );
        }
    }

    #setGlobalTimeout ( delay, callback ) {
        this.#timeout = globalThis.setTimeout( callback, delay );

        if ( !isBrowser && !this.#ref ) this.#timeout.unref();
    }

    #onAbort () {
        this.#isAborted = true;

        this.#clear();
    }

    #onTimeout () {

        // timer can be fired slightly earlier than the target date
        if ( this.#target != null && this.#target > Date.now() ) {
            this.#wait( this.#target );
        }
        else {
            this.#onDone();
        }
    }

    #onDone () {
        this.#iteration += 1;

        const callback = this.#callback;

        // next iteration
        if ( this.#repeat && this.#repeat > this.#iteration ) {
            this.#start();
        }

        // done
        else {
            this.#clear();
        }

        callback();
    }
}

export async function sleep ( delay, { signal } = {} ) {
    if ( signal ) {
        if ( signal.aborted ) return;

        return new Promise( resolve => {
            var timeout;

            const onDone = () => {
                timeout?.clear();

                signal.removeEventListener( "abort", onDone );

                resolve();
            };

            signal.addEventListener( "abort", onDone );

            timeout = new Timeout( delay, onDone );
        } );
    }
    else {
        return new Promise( resolve => new Timeout( delay, resolve ) );
    }
}
