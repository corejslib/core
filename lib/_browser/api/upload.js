import Events from "#lib/events";
import result from "#lib/result";
import Signal from "#lib/threads/signal";

const STATUS_NEW = 0;
const STATUS_STARTED = 1;
const STATUS_ABORTED = 10;
const STATUS_OK = 11;
const STATUS_ERROR = 12;

const STATUS = {
    [ STATUS_NEW ]: "Waiting",
    [ STATUS_STARTED ]: "Uploading",
    [ STATUS_ABORTED ]: "Aborted",
    [ STATUS_OK ]: "Finished",
    [ STATUS_ERROR ]: "Error",
};

export default class Upload extends Events {
    #api;
    #connection;
    #url;
    #headers;
    #body;
    #fetchOptions;
    #abortController = new AbortController();
    #abortSignal;
    #size;

    #status = STATUS_NEW;

    #signal = new Signal();
    #result;

    #uploaded = 0;
    #progress = 0;
    #progressText; // eslint-disable-line no-unused-private-class-members

    constructor ( api, { connection, url, headers, body, signal, fetchOptions } ) {
        super();

        this.#api = api;
        this.#connection = connection;
        this.#url = url;
        this.#headers = headers;
        this.#body = body;
        this.#fetchOptions = fetchOptions;
        this.#size = body.contentLength;

        if ( signal ) {
            this.#abortSignal = AbortSignal.any( [ this.#abortController.signal, signal ] );
        }
        else {
            this.#abortSignal = this.#abortController.signal;
        }
    }

    // properties
    get api () {
        return this.#api;
    }

    get size () {
        return this.#size;
    }

    get abortSignal () {
        return this.#abortSignal;
    }

    get statusText () {
        return STATUS[ this.#status ];
    }

    get result () {
        return this.#result;
    }

    get isNew () {
        return this.#status === STATUS_NEW;
    }

    get isStarted () {
        return this.#status === STATUS_STARTED;
    }

    get isAborted () {
        if ( !this.isFinished ) return null;

        return this.#status === STATUS_ABORTED;
    }

    get isOk () {
        if ( !this.isFinished ) return null;

        return this.#status === STATUS_OK;
    }

    get isError () {
        if ( !this.isFinished ) return null;

        return this.#status === STATUS_ERROR;
    }

    get isFinished () {
        return this.#status > STATUS_STARTED;
    }

    get uploaded () {
        return this.#uploaded;
    }

    get progress () {
        if ( this.#progress == null ) {
            this.#progress = this.#uploaded / this.#size;
        }

        return this.#progress;
    }

    get progressText () {
        var text = `${ this.statusText } - ${ Math.floor( this.progress * 100 ) }%`;

        return text;
    }

    // public
    async start () {
        if ( this.#connection.isDestroyed ) {
            const res = result( [ 500, "Connection is destroyed" ] );

            this._setResult( res );

            return res;
        }

        if ( this.isFinished ) return this.#result;

        if ( !this.isStarted ) {
            this.#setStatus( STATUS_STARTED );

            this.#runStart();
        }

        // could be finished synchronously, the signal was broadcasted already
        if ( this.isFinished ) return this.#result;

        return this.#signal.wait();
    }

    abort () {
        if ( this.isFinished ) return;

        // result and status must be set before the signal is aborted, abort listeners can be synchronous
        this.#result = result( [ 400, "Aborted" ] );

        this.#setStatus( STATUS_ABORTED );

        this.#abortController.abort();
    }

    [ Symbol.for( "nodejs.util.inspect.custom" ) ] ( depth, options, inspect ) {
        const spec = {
            "size": this.#size,
            "uploaded": this.uploaded,
            "progress": this.progress,
            "statusText": this.statusText,
        };

        return `${ this.constructor.name }: ${ inspect( spec ) }`;
    }

    // protected
    _setSize ( value ) {
        this.#size = value;
    }

    _setProgress ( uploaded ) {
        if ( uploaded == null || uploaded === this.#uploaded ) return;

        this.#uploaded = uploaded;
        this.#progress = null;

        this.#updated();
    }

    _setResult ( res ) {
        if ( this.isFinished ) return;

        this.#result = res;

        this.#setStatus( res.ok
            ? STATUS_OK
            : STATUS_ERROR );
    }

    // private
    async #runStart () {
        try {
            await this._start( {
                "url": this.#url,
                "headers": this.#headers,
                "body": this.#body,
                "fetchOptions": this.#fetchOptions,
            } );
        }
        catch ( e ) {
            this._setResult( result.fromError( e ) );
        }
    }

    #setStatus ( status ) {
        if ( this.#status === status ) return;

        this.#status = status;

        this.#updated();

        if ( this.isFinished ) {

            // clear events listeners
            this.offAll();

            this.#signal.broadcast( this.#result );
        }
    }

    #updated () {
        this.#progressText = null;

        this.emit( "progress", this );
    }
}
