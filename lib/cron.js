import CronExpression from "#lib/cron/expression";
import Events from "#lib/events";
import { Timeout } from "#lib/timers";

export default class Cron extends Events {
    #expression;
    #maxTicks;
    #isStarted = false;
    #lastTickDate;
    #ticks = 0;
    #nextTickDate;
    #timeout;
    #ref = true;

    constructor ( expression, { timezone, ignoreSeconds, maxTicks } = {} ) {
        super();

        this.#maxTicks = maxTicks;

        this.#expression = new CronExpression( expression, { timezone, ignoreSeconds } );
    }

    // static
    static isValid ( expression, options ) {
        return CronExpression.isValid( expression, options );
    }

    // properties
    get expression () {
        return this.#expression.expression;
    }

    get timezone () {
        return this.#expression.timezone;
    }

    get maxTicks () {
        return this.#maxTicks;
    }

    get hasRef () {
        return this.#ref;
    }

    get ignoreSeconds () {
        return this.#expression.ignoreSeconds;
    }

    get hasSeconds () {
        return this.#expression.hasSeconds;
    }

    get isStarted () {
        return this.#isStarted;
    }

    get ticks () {
        return this.#ticks;
    }

    get lastTickDate () {
        return this.#lastTickDate;
    }

    get nextTickDate () {
        if ( this.#nextTickDate && Temporal.Instant.compare( this.#nextTickDate, Temporal.Now.instant() ) > 0 ) return this.#nextTickDate;

        this.#nextTickDate = this.getSchedule( {
            "maxItems": 1,
        } )[ 0 ];

        return this.#nextTickDate;
    }

    // public
    start () {
        if ( this.#isStarted ) return this;

        this.#lastTickDate = null;
        this.#ticks = 0;
        this.#isStarted = true;

        this.#setTimeout();

        return this;
    }

    stop () {
        if ( !this.#isStarted ) return this;

        this.#isStarted = false;

        this.#clearTimeout();

        this.emit( "stop", this );

        return this;
    }

    getSchedule ( { maxItems = 1, fromDate } = {} ) {
        return this.#expression.getSchedule( { maxItems, fromDate } );
    }

    tick () {
        this.#onTick( true );

        return this;
    }

    toString () {
        return this.#expression.toString();
    }

    toJSON () {
        return this.toString();
    }

    ref () {
        this.#ref = true;

        this.#timeout?.ref?.();

        return this;
    }

    unref () {
        this.#ref = false;

        this.#timeout?.unref?.();

        return this;
    }

    [ Symbol.for( "nodejs.util.inspect.custom" ) ] ( depth, options, inspect ) {
        const spec = {
            "expression": this.expression,
        };

        if ( this.timezone ) {
            spec.timezone = this.timezone;
        }

        spec.nextTickDate = this.nextTickDate.toString();

        return `${ this.constructor.name }: ${ inspect( spec ) }`;
    }

    // private
    #setTimeout () {
        this.#clearTimeout();

        const date = this.nextTickDate;

        if ( date ) {
            this.#timeout = new Timeout( date, () => this.#onTick( false, date ) );

            if ( !this.#ref ) this.#timeout.unref();
        }
    }

    #clearTimeout () {
        if ( this.#timeout ) {
            this.#timeout.clear();

            this.#timeout = null;
        }
    }

    #onTick ( manual, scheduledDate ) {

        // timer was fired after the cron was stopped
        if ( !manual && !this.#isStarted ) return;

        this.#lastTickDate = Temporal.Now.instant();
        this.#ticks++;

        let stop;

        if ( this.#maxTicks && this.#ticks >= this.#maxTicks ) {
            stop = true;
        }

        if ( !manual && !stop ) {

            // timer can be fired slightly earlier than the scheduled date,
            // so the next date is searched strictly after the date of the current tick,
            // otherwise the same tick can be scheduled twice
            const now = Temporal.Now.instant(),
                minDate = scheduledDate.add( { "milliseconds": 1 } );

            this.#nextTickDate = this.getSchedule( {
                "maxItems": 1,
                "fromDate": Temporal.Instant.compare( now, minDate ) > 0
                    ? now
                    : minDate,
            } )[ 0 ];

            this.#setTimeout();
        }

        this.emit( "tick", this );

        if ( stop ) this.stop();
    }
}
