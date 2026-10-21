import result from "#lib/result";

const DEFAULT_MAX_LISTENERS = 10;

// avoids spread for the most common cases
function callListener ( listener, args ) {
    switch ( args.length ) {
        case 0:
            return listener();
        case 1:
            return listener( args[ 0 ] );
        case 2:
            return listener( args[ 0 ], args[ 1 ] );
        case 3:
            return listener( args[ 0 ], args[ 1 ], args[ 2 ] );
        case 4:
            return listener( args[ 0 ], args[ 1 ], args[ 2 ], args[ 3 ] );
        case 5:
            return listener( args[ 0 ], args[ 1 ], args[ 2 ], args[ 3 ], args[ 4 ] );
        default:
            return listener( ...args );
    }
}

export default class Events {
    #maxListeners;
    #totalListeners = 0;
    #seq = 0;
    #events = Object.create( null );
    #watchers = new Set();
    #linked = new Map();
    #forwarded = new Map();

    constructor ( { maxListeners = DEFAULT_MAX_LISTENERS } = {} ) {
        this.setMaxListeners( maxListeners );
    }

    // properties
    get maxListeners () {
        return this.#maxListeners;
    }

    set maxListeners ( value ) {
        this.setMaxListeners( value );
    }

    // public
    on ( name, listener ) {
        this.#on( name, listener, false );

        return this;
    }

    once ( name, listener ) {
        this.#on( name, listener, true );

        return this;
    }

    off ( name, listener ) {
        this.#off( name, listener );

        return this;
    }

    offAll ( name ) {
        if ( name ) {
            for ( const listener of [ ...( this.#events[ name ]?.keys() || [] ) ] ) {
                this.#off( name, listener );
            }
        }
        else {
            for ( const name of Object.keys( this.#events ) ) {
                for ( const listener of [ ...( this.#events[ name ]?.keys() || [] ) ] ) {
                    this.#off( name, listener );
                }
            }
        }

        return this;
    }

    offOnce ( name ) {
        for ( const rec of [ ...( this.#events[ name ]?.values() || [] ) ] ) {
            if ( rec.once ) this.#off( name, rec.listener );
        }

        // once listeners in forwarded emitters will not be called too
        for ( const forward of [ ...this.#forwarded.values() ] ) {
            forward.offOnce( name );
        }

        return this;
    }

    emit ( name, ...args ) {
        const list = this.#events[ name ];

        if ( !list && !this.#forwarded.size ) return this;

        if ( list ) {
            const seq = this.#seq;

            // map is iterated live, listeners added during the dispatch have greater seq and are skipped
            for ( const rec of list.values() ) {
                if ( rec.seq >= seq ) continue;

                if ( rec.once ) this.#off( name, rec.listener );

                try {
                    callListener( rec.listener, args );
                }
                catch ( e ) {
                    console.error( e );
                }
            }
        }

        if ( this.#forwarded.size ) {
            for ( const forward of [ ...this.#forwarded.values() ] ) {
                forward.watcher( name, args );
            }
        }

        return this;
    }

    async runCallbacks ( name, ...args ) {
        let res;

        const list = this.#events[ name ];

        if ( list ) {
            const seq = this.#seq;

            // map is iterated live, listeners added during the dispatch have greater seq and are skipped
            for ( const rec of list.values() ) {
                if ( rec.seq >= seq ) continue;

                if ( rec.once ) this.#off( name, rec.listener );

                if ( !res || res.ok ) {
                    try {
                        res = result.try( await callListener( rec.listener[ Symbol.for( "event-callback" ) ] || rec.listener, args ), {
                            "allowUndefined": true,
                        } );
                    }
                    catch ( e ) {
                        res = result.fromError( e );
                    }
                }
            }
        }

        for ( const forward of [ ...this.#forwarded.values() ] ) {

            // callbacks chain is interrupted, remove once listeners from forwarded emitter
            if ( res && !res.ok ) {
                forward.offOnce( name );

                continue;
            }

            const forwardedRes = await forward.runCallbacks( name, args );

            if ( forwardedRes ) res = forwardedRes;
        }

        return res || result( 200 );
    }

    hasListeners ( name ) {
        if ( name ) {
            return !!this.#events[ name ];
        }
        else {
            return !!this.#totalListeners;
        }
    }

    watch ( listener ) {
        this.#watchers.add( listener );

        return this;
    }

    unwatch ( listener ) {
        this.#watchers.delete( listener );

        return this;
    }

    unwatchAll () {
        this.#watchers.clear();

        return this;
    }

    link ( emitter, { on, forwarder, increaseMaxListeners } = {} ) {

        // already linked
        if ( this.#linked.has( emitter ) ) this.unlink( emitter );

        on ||= name => name;

        forwarder ||= ( name, args, { sync } ) => {
            if ( sync ) {
                return this.runCallbacks( name, ...args );
            }
            else {
                this.emit( name, ...args );
            }
        };

        const link = {
            "names": {},
            "watcher": ( name, subscribe ) => {

                // subscribe
                if ( subscribe ) {
                    let remoteNames = on( name );

                    // do not subscribe
                    if ( !remoteNames ) return;

                    if ( !Array.isArray( remoteNames ) ) remoteNames = [ remoteNames ];

                    const listener = ( ...args ) => forwarder( name, args, { "sync": false } );

                    listener[ Symbol.for( "event-callback" ) ] = ( ...args ) => forwarder( name, args, { "sync": true } );

                    link.names[ name ] = [];

                    for ( const remoteName of remoteNames ) {
                        link.names[ name ].push( [ remoteName, listener ] );

                        if ( emitter instanceof EventTarget ) {
                            emitter.addEventListener( remoteName, listener );
                        }
                        else {
                            emitter.on( remoteName, listener );
                        }
                    }
                }

                // unsubscribe
                else if ( link.names[ name ] ) {
                    const events = link.names[ name ];
                    delete link.names[ name ];

                    for ( const event of events ) {
                        if ( emitter instanceof EventTarget ) {
                            emitter.removeEventListener( ...event );
                        }
                        else {
                            emitter.off( ...event );
                        }
                    }
                }
            },
        };

        this.#linked.set( emitter, link );

        if ( increaseMaxListeners ) {
            if ( !( "maxListeners" in emitter ) ) {
                throw new Error( "Unable to increase max. listeners" );
            }

            if ( emitter.maxListeners !== 0 && emitter.maxListeners !== Infinity ) {
                emitter.maxListeners += 1;

                link.increaseMaxListeners = true;
            }
        }

        for ( const name of Object.keys( this.#events ) ) {
            link.watcher( name, true );
        }

        return this;
    }

    unlink ( emitter ) {
        this.#unlink( emitter );

        return this;
    }

    unlinkAll () {
        for ( const emitter of this.#linked.keys() ) {
            this.#unlink( emitter );
        }

        return this;
    }

    forward ( emitter, { on, forwarder } = {} ) {

        // already linked
        if ( this.#forwarded.has( emitter ) ) this.unforward( emitter );

        on ||= name => name;

        forwarder ||= ( name, args, { sync } = {} ) => {
            if ( sync && typeof emitter.runCallbacks === "function" ) {
                return emitter.runCallbacks( name, ...args );
            }
            else {
                emitter.emit( name, ...args );
            }
        };

        const getRemoteNames = name => {
            let remoteNames = on( name );

            if ( !remoteNames ) return [];

            if ( !Array.isArray( remoteNames ) ) remoteNames = [ remoteNames ];

            return remoteNames;
        };

        const forward = {
            "watcher": ( name, args ) => {
                for ( const remoteName of getRemoteNames( name ) ) {
                    forwarder( remoteName, args, { "sync": false } );
                }
            },

            "runCallbacks": async ( name, args ) => {
                let res;

                for ( const remoteName of getRemoteNames( name ) ) {

                    // callbacks chain is interrupted
                    if ( res && !res.ok ) {
                        if ( typeof emitter.offOnce === "function" ) emitter.offOnce( remoteName );

                        continue;
                    }

                    try {
                        const value = await forwarder( remoteName, args, { "sync": true } );

                        if ( result.isResult( value ) ) res = value;
                    }
                    catch ( e ) {
                        res = result.fromError( e );
                    }
                }

                return res;
            },

            "offOnce": name => {
                if ( typeof emitter.offOnce !== "function" ) return;

                for ( const remoteName of getRemoteNames( name ) ) {
                    emitter.offOnce( remoteName );
                }
            },
        };

        this.#forwarded.set( emitter, forward );

        return this;
    }

    unforward ( emitter ) {
        this.#unforward( emitter );

        return this;
    }

    unforwardAll () {
        for ( const emitter of this.#forwarded.keys() ) {
            this.#unforward( emitter );
        }

        return this;
    }

    clear () {
        return this.unlinkAll().unforwardAll().unwatchAll().offAll();
    }

    setMaxListeners ( value ) {
        if ( value === null ) value = Infinity;

        if ( value !== Infinity && ( !Number.isInteger( value ) || value < 0 ) ) {
            throw new TypeError( "maxListeners must be Infinity or a non-negative integer" );
        }

        this.#maxListeners = value;

        return this;
    }

    [ Symbol.dispose ] () {
        this.clear();
    }

    async [ Symbol.asyncDispose ] () {
        this.clear();
    }

    // private
    #on ( name, listener, once ) {
        const list = this.#events[ name ],
            rec = list?.get( listener );

        // listener is already registered
        if ( rec ) {
            rec.once = once;
        }

        // add new listener
        else {
            if ( this.#maxListeners !== 0 && this.#maxListeners !== Infinity && list?.size === this.#maxListeners ) {
                console.warn( new Error( `Events max. listeners limit exceeded for event "${ name }"` ) );
            }

            const newRec = { listener, once, "seq": this.#seq++ };

            if ( list ) {
                list.set( listener, newRec );
            }
            else {
                this.#events[ name ] = new Map( [ [ listener, newRec ] ] );
            }

            this.#totalListeners++;

            // subscribed
            if ( !list ) this.#callWatcheers( name, true );
        }
    }

    #off ( name, listener ) {
        const list = this.#events[ name ];

        if ( !list?.delete( listener ) ) return;

        this.#totalListeners--;

        // unsubscribed
        if ( !list.size ) {
            delete this.#events[ name ];

            this.#callWatcheers( name, false );
        }
    }

    #callWatcheers ( name, subscribe ) {
        if ( this.#watchers.size ) {
            for ( const listener of [ ...this.#watchers ] ) {
                listener( name, subscribe );
            }
        }

        if ( this.#linked.size ) {
            for ( const link of [ ...this.#linked.values() ] ) {
                link.watcher( name, subscribe );
            }
        }
    }

    #unlink ( emitter ) {
        const link = this.#linked.get( emitter );

        if ( !link ) return;

        this.#linked.delete( emitter );

        for ( const off of Object.values( link.names ) ) {
            for ( let n = 0; n < off.length; n++ ) {
                if ( emitter instanceof EventTarget ) {
                    emitter.removeEventListener( ...off[ n ] );
                }
                else {
                    emitter.off( ...off[ n ] );
                }
            }
        }

        if ( link.increaseMaxListeners && emitter.maxListeners > 1 ) {
            emitter.maxListeners -= 1;
        }
    }

    #unforward ( emitter ) {
        this.#forwarded.delete( emitter );
    }
}
