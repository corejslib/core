import "#lib/result";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { isMainThread, Worker } from "node:worker_threads";
import Events from "#lib/events";
import Counter from "#lib/threads/counter";

const WORKER_PATH = new URL( import.meta.resolve( "#lib/threads/worker-thread" ) );

export default class Threads {
    #onCall; // async ( method, args ) => {}
    #requestId = 0;
    #threads = {};
    #callbacks = [];
    #incomingEvents = new Events();
    #outgoingEvents = new Events();
    #startedThreadsCounter = new Counter();
    #isDestroying = false;

    constructor ( { onCall } = {} ) {
        this.#onCall = onCall;
    }

    // static
    static get isMainThread () {
        return isMainThread;
    }

    // properties
    get isDestroying () {
        return this.#isDestroying;
    }

    // public
    async start ( threads ) {

        // service is destroying
        if ( this.#isDestroying ) return result( -32_816 );

        const counter = new Counter();

        for ( const name in threads ) {
            let numberOfThreads = threads[ name ].numberOfThreads;

            // define number of threads
            if ( !numberOfThreads ) {
                numberOfThreads = os.cpus().length;
            }
            else if ( numberOfThreads < 0 ) {
                numberOfThreads = os.cpus().length + numberOfThreads;

                if ( numberOfThreads < 1 ) numberOfThreads = 1;
            }
            else if ( numberOfThreads > os.cpus().length ) {
                numberOfThreads = os.cpus().length;
            }

            const args = JSON.stringify( threads[ name ].args );

            // create threads
            for ( let n = 1; n <= numberOfThreads; n++ ) {
                counter.value++;

                let module;

                if ( typeof threads[ name ].module === "object" ) {
                    module = threads[ name ].module.href;
                }
                else if ( threads[ name ].module.startsWith( "file:" ) ) {
                    module = threads[ name ].module;
                }
                else {
                    module = pathToFileURL( threads[ name ].module ).href;
                }

                const thread = new Worker( WORKER_PATH, {
                    name,
                    "workerData": {
                        module,
                        args,
                        "mainThreadArgv1": globalThis[ Symbol.for( "mainThreadArgv1" ) ] || process.argv[ 1 ],
                    },
                } );

                this.#startedThreadsCounter.value++;

                thread._name = name;
                thread._listeners = {};

                this.#threads[ name ] ||= new Set();

                this.#threads[ name ].add( thread );

                thread.once( "exit", this.#onThreadExit.bind( this, thread ) );

                thread.on( "message", this.#onMessage.bind( this, thread ) );

                thread.once( "ready", () => counter.value-- );
            }
        }

        await counter.wait();

        return result( 200 );
    }

    async destroy () {
        if ( !this.#isDestroying ) {
            this.#isDestroying = true;

            // sent destroy message
            for ( const threads of Object.values( this.#threads ) ) {
                for ( const thread of threads ) {
                    thread.postMessage( JSON.stringify( {
                        "method": "/destroy",
                    } ) );
                }
            }
        }

        return this.#startedThreadsCounter.wait();
    }

    async call ( name, method, ...args ) {
        return this.#call( name, method, args, false );
    }

    voidCall ( name, method, ...args ) {
        this.#call( name, method, args, true );
    }

    async terminateThread ( name ) {
        const threads = this.#threads[ name ];

        if ( !threads ) return result( [ 404, "Threads not found" ] );

        if ( !threads.size ) return result( [ 404, "Threads has no workers" ] );

        for ( const thread of threads ) {
            await thread.terminate();
        }

        return result( 200 );
    }

    on ( name, listener ) {
        this.#incomingEvents.on( name, listener );

        return this;
    }

    once ( name, listener ) {
        this.#incomingEvents.once( name, listener );

        return this;
    }

    off ( name, listener ) {
        this.#incomingEvents.off( name, listener );

        return this;
    }

    publish ( name, ...args ) {
        this.#outgoingEvents.emit( name, args, {} );
    }

    link ( emitter, { on } = {} ) {
        const forwarder = ( name, args ) => this.#outgoingEvents.emit( name, args, {} );

        this.#outgoingEvents.link( emitter, { on, forwarder } );
    }

    forward ( emitter, { on, forwarder } ) {
        this.#incomingEvents.forward( emitter, { on, forwarder } );
    }

    // private
    async #call ( name, method, args, isVoid ) {

        // service is destroying
        if ( this.#isDestroying ) return result( -32_816 );

        const threads = this.#threads[ name ];

        if ( !threads ) return result( [ 404, "Threads not found" ] );

        if ( !threads.size ) return result( [ 404, "Threads has no workers" ] );

        const thread = threads.values().next().value;

        // rotate
        threads.delete( thread );
        threads.add( thread );

        if ( isVoid ) {
            thread.postMessage( JSON.stringify( {
                method,
                "params": args,
            } ) );
        }
        else {
            return new Promise( resolve => {
                const id = ++this.#requestId;

                this.#callbacks[ id ] = resolve;

                thread.postMessage( JSON.stringify( {
                    id,
                    method,
                    "params": args,
                } ) );
            } );
        }
    }

    async #onMessage ( thread, msg ) {
        msg = JSON.parse( msg );

        // request
        if ( msg.method ) {

            // subscribe
            if ( msg.method === "/subscribe" ) {
                const name = msg.params.shift();

                // already subscribed
                if ( thread._listeners[ name ] ) return;

                thread._listeners[ name ] = ( args, cache = {}, threadId ) => {
                    if ( threadId === thread.threadId ) return;

                    cache.msg ??= JSON.stringify( {
                        "method": "/publish",
                        "params": [ name, ...args ],
                    } );

                    thread.postMessage( cache.msg );
                };

                this.#outgoingEvents.on( name, thread._listeners[ name ] );
            }

            // unsubscribe
            else if ( msg.method === "/unsubscribe" ) {
                const name = msg.params.shift(),
                    listener = thread._listeners[ name ];

                // not subscribed
                if ( !listener ) return;

                delete thread._listeners[ name ];

                this.#outgoingEvents.off( name, listener );
            }

            // publish
            else if ( msg.method === "/publish" ) {
                const name = msg.params.shift();

                // forward to the other threas
                this.#outgoingEvents.emit( name, msg.params, {}, thread.threadId );

                // publish
                this.#incomingEvents.emit( name, ...msg.params );
            }

            // ready
            else if ( msg.method === "/ready" ) {
                thread.emit( "ready" );
            }

            // rpc call
            else {
                if ( this.#onCall ) {

                    // regular call
                    if ( msg.id ) {
                        let res;

                        try {
                            res = result.try( await this.#onCall( msg.method, msg.params ) );
                        }
                        catch ( e ) {
                            res = result.fromError( e );
                        }

                        thread.postMessage( JSON.stringify( {
                            "id": msg.id,
                            "result": res,
                        } ) );
                    }

                    // void call
                    else {
                        try {
                            this.#onCall( msg.method, msg.params );
                        }
                        catch ( e ) {
                            console.log( e );
                        }
                    }
                }

                // rpc calls are not supported
                else if ( msg.id ) {

                    // send response if call is not void
                    thread.postMessage( JSON.stringify( {
                        "id": msg.id,
                        "result": result( -32_800 ),
                    } ) );
                }
            }
        }

        // responce
        else {
            const callback = this.#callbacks[ msg.id ];

            if ( callback ) {
                delete this.#callbacks[ msg.id ];

                callback( result.fromJson( msg.result ) );
            }
        }
    }

    #onThreadExit ( thread, code ) {

        // remove thread
        this.#threads[ thread._name ].delete( thread );

        if ( !this.#threads[ thread._name ].size ) delete this.#threads[ thread._name ];

        // remove listeners
        for ( const name in thread._listeners ) {
            this.#outgoingEvents.off( name, thread._listeners[ name ] );

            delete thread._listeners[ name ];
        }

        this.#startedThreadsCounter.value--;
    }
}
