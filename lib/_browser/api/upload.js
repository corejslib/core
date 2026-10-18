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
    #body;
    #dispatcher;
    #fetchOptions;
    #abortController = new AbortController();
    #abortSignal;
    #size;

    #status = STATUS_NEW;

    #signal = new Signal();
    #result;

    #loaded = 0;
    #progress = 0;
    #progressText; // eslint-disable-line no-unused-private-class-members

    constructor ( api, { connection, url, body, dispatcher, signal, fetchOptions } ) {
        super();

        this.#api = api;
        this.#connection = connection;
        this.#url = url;
        this.#body = body;
        this.#dispatcher = dispatcher;
        this.#fetchOptions = fetchOptions;
        this.#size = body.size;

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

    get loaded () {
        return this.#loaded;
    }

    get progress () {
        if ( this.#progress == null ) this.#progress = this.#loaded / this.size;

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

            this._start( {
                "url": this.#url,
                "body": this.#body,
                "dispatcher": this.#dispatcher,
                "fetchOptions": this.#fetchOptions,
            } );
        }

        return this.#signal.wait();
    }

    abort () {
        if ( this.isFinished ) return;

        this.#abortController.abort();

        this.#result = result( [ 400, "Aborted" ] );

        this.#setStatus( STATUS_ABORTED );
    }

    // protected
    _setSize ( value ) {
        this.#size = value;
    }

    _setResult ( res ) {
        if ( this.isFinished ) return;

        this.#result = res;

        this.#setStatus( res.ok
            ? STATUS_OK
            : STATUS_ERROR );
    }

    _setProgress ( loaded ) {
        if ( loaded == null || loaded === this.#loaded ) return;

        this.#loaded = loaded;
        this.#progress = null;

        this.#updated();
    }

    // private
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
