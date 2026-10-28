import ansi from "#lib/ansi";
import DigitalSize from "#lib/digital-size";
import Interval from "#lib/interval";
import Locale from "#lib/locale";
import Numeric from "#lib/numeric";
import Signal from "#lib/threads/signal";

const BAR_WIDTH = 30,
    BAR_TTY_SPACE_CHAR = "■",
    BAR_SPACE_CHAR = "·", // "⋯",
    BAR_VALUE_CHAR = "■",
    BAR_SPACE_COLOR = ansi.gray15,
    BAR_VALUE_COLOR = ansi.green,
    ELAPSED_LABEL = "T",
    ESTIMATED_LABEL = "ETA",
    SPEED_LABEL = "S",
    UNIT_STYLE = "short",
    UPDATE_INTERVAL = 1000;

export default class Progress {
    #outputStream;
    #tty;
    #unitStyle;
    #showBar;
    #locale;
    #bytes;
    #scale = 0;
    #percentScale = 2;
    #maxValue = 0;
    #value = 0;
    #elapsed = 0;
    #showStatus;
    #calculateElapsed;
    #started;
    #stopped;
    #signal;
    #autoUpdate;
    #autoUpdateInterval;
    #updateTimeout;
    #autoUpdateCallback;
    #scaleOpt;
    #percentOpt;
    #unitDisplayOpt;
    #durationStyleOpt;
    #secondLabel;

    constructor ( { maxValue, showStatus = true, calculateElapsed = true, outputStream = process.stdout, tty, unitStyle, showBar = true, locale, bytes, autoUpdate = true, autoUpdateInterval } = {} ) {
        this.#maxValue = maxValue;
        this.#showStatus = Boolean( showStatus );
        this.#calculateElapsed = Boolean( calculateElapsed );
        this.#outputStream = outputStream;
        this.#tty = Boolean( tty ?? this.#outputStream?.isTTY );
        this.#unitStyle = unitStyle || UNIT_STYLE;
        this.#showBar = Boolean( showBar );
        this.#locale = locale || Locale.default;
        this.#bytes = Boolean( bytes );
        this.#autoUpdate = Boolean( autoUpdate );
        this.#autoUpdateInterval = autoUpdateInterval || UPDATE_INTERVAL;

        this.#scaleOpt = { "scale": this.#scale };
        this.#percentOpt = `minimumFractionDigits:${ this.#percentScale },maximumFractionDigits:${ this.#percentScale }`;
        this.#unitDisplayOpt = `unitDisplay:${ this.#unitStyle }`;
        this.#durationStyleOpt = `style:${ this.#unitStyle }`;
        this.#secondLabel = this.#locale.formatName( "second", `type:dateTimeField,style:${ this.#unitStyle }` );

        this.#autoUpdateCallback = this.#update.bind( this, {
            "updateStatus": true,
        } );
    }

    // properties
    get maxValue () {
        return this.#maxValue;
    }

    get value () {
        return this.#value;
    }

    get percent () {
        if ( this.#maxValue ) {
            return this.#value / this.#maxValue;
        }
        else {
            return 0;
        }
    }

    get started () {
        return this.#started;
    }

    get stopped () {
        return this.#stopped;
    }

    get elapsed () {
        return this.#elapsed;
    }

    get estimated () {
        if ( this.#maxValue ) {
            const speed = this.speed;

            if ( speed ) {
                const value = this.#maxValue - this.#value;

                if ( value === 0 ) {
                    return 0;
                }
                else {
                    return value / speed;
                }
            }
            else {
                return Infinity;
            }
        }
        else {
            return;
        }
    }

    get speed () {
        if ( this.#elapsed ) {
            return this.#value / this.#elapsed;
        }
        else {
            return 0;
        }
    }

    // public
    showStatus () {
        if ( !this.#showStatus && this.#outputStream ) {
            this.#showStatus = true;

            if ( this.#started ) this.#updateStatus();
        }

        return this;
    }

    start () {
        if ( !this.#started ) {
            this.#started = Temporal.Now.instant();

            this.#update( {
                "updateStatus": true,
            } );
        }

        return this;
    }

    stop () {
        if ( !this.#stopped ) {
            this.#update( {
                "updateStatus": true,
                "stop": true,
            } );
        }

        return this;
    }

    setProgress ( { value, elapsed } = {} ) {
        if ( !this.#stopped ) {
            let update;

            if ( value != null ) {
                update = true;

                this.#value = value;
            }

            if ( elapsed != null && !this.#calculateElapsed ) {
                update = true;

                this.#elapsed = elapsed;
            }

            if ( update ) {
                this.#update();
            }
        }

        return this;
    }

    addProgress ( { value, elapsed } = {} ) {
        if ( !this.#stopped ) {
            let update;

            if ( value ) {
                update = true;

                this.#value += value;
            }

            if ( elapsed && !this.#calculateElapsed ) {
                update = true;

                this.#elapsed += elapsed;
            }

            if ( update ) {
                this.#update();
            }
        }

        return this;
    }

    update () {
        this.#update( {
            "updateStatus": true,
        } );

        return this;
    }

    async wait () {
        if ( this.#stopped ) return;

        this.#signal ??= new Signal();

        return this.#signal.wait();
    }

    // private
    #update ( { stop, updateStatus } = {} ) {
        if ( this.#stopped ) return;

        // check stop condition
        if ( this.#value >= this.#maxValue ) {
            stop = true;
            updateStatus = true;

            this.#value = this.#maxValue;
        }

        if ( stop ) {
            this.#started ??= Temporal.Now.instant();
            this.#stopped = Temporal.Now.instant();

            if ( this.#calculateElapsed ) {
                this.#elapsed = this.#stopped.epochMilliseconds - this.#started.epochMilliseconds;
            }
        }
        else {
            if ( this.#calculateElapsed && this.#started ) {
                this.#elapsed = Temporal.Now.instant().epochMilliseconds - this.#started.epochMilliseconds;
            }
        }

        if ( updateStatus ) {
            this.#updateStatus();
        }

        if ( stop ) {
            this.#signal?.broadcast();
        }
    }

    #updateStatus () {
        this.#stopUpdateStatus();

        if ( !this.#showStatus ) return;

        let status;

        const tty = this.#tty,
            value = this.#bytes
                ? this.#locale.formatDigitalSize( new DigitalSize( this.#value ), this.#unitDisplayOpt )
                : Numeric.truncate( this.#value, this.#scaleOpt ),
            elapsed = this.#locale.formatDuration( new Interval( this.#elapsed, "milliseconds" ).truncate( "seconds" ), this.#durationStyleOpt );

        let speed;

        if ( this.#bytes ) {
            speed = this.#locale.formatDigitalSize( this.speed * 1000, this.#unitDisplayOpt ) + "/" + this.#secondLabel;
        }
        else {
            speed = Numeric.truncate( this.speed * 1000, this.#scaleOpt ) + "/" + this.#secondLabel;
        }

        using disposableStack = new DisposableStack();
        disposableStack.use( ansi.pushEnabled( tty ) );

        if ( this.#maxValue ) {
            const percent = this.#locale.formatPercent( this.percent, this.#percentOpt ),
                maxValue = this.#bytes
                    ? this.#locale.formatDigitalSize( new DigitalSize( this.#maxValue ), this.#unitDisplayOpt )
                    : Numeric.truncate( this.#maxValue, this.#scaleOpt );

            let bar;

            if ( this.#showBar ) {
                const barWidth = BAR_WIDTH,
                    valueWidth = this.#value === this.#maxValue
                        ? barWidth
                        : Math.trunc( ( this.#value * barWidth ) / this.#maxValue ),
                    barSpaceChar = tty
                        ? BAR_TTY_SPACE_CHAR
                        : BAR_SPACE_CHAR;

                bar = "[" + BAR_VALUE_COLOR( BAR_VALUE_CHAR.repeat( valueWidth ) ) + BAR_SPACE_COLOR( barSpaceChar.repeat( barWidth - valueWidth ) ) + "] ";
            }
            else {
                bar = "";
            }

            if ( this.#stopped ) {
                status = `${ bar }${ percent } (${ value }/${ maxValue }); ${ ELAPSED_LABEL }: ${ elapsed }; ${ SPEED_LABEL }: ${ speed }`;
            }
            else {
                const estimated = this.#locale.formatRelativeDate( new Interval( this.estimated, "milliseconds" ), this.#durationStyleOpt );

                status = `${ bar }${ percent } (${ value }/${ maxValue }); ${ ELAPSED_LABEL }: ${ elapsed }; ${ ESTIMATED_LABEL }: ${ estimated }; ${ SPEED_LABEL }: ${ speed }`;
            }
        }
        else {
            status = `${ value }; ${ ELAPSED_LABEL }: ${ elapsed }; ${ SPEED_LABEL }: ${ speed }`;
        }

        if ( tty ) {
            this.#outputStream.write( "\u{1B}[2K\r" + status + ( this.#stopped
                ? "\n"
                : "" ) );
        }
        else {
            this.#outputStream.write( status + "\n" );
        }

        if ( !this.#stopped && this.#autoUpdate ) {
            this.#updateTimeout = setTimeout( this.#autoUpdateCallback, this.#autoUpdateInterval );
        }
    }

    #stopUpdateStatus () {
        clearTimeout( this.#updateTimeout );

        this.#updateTimeout = null;
    }
}
