import result from "#lib/result";

const DEFAULT_MAX_LISTENERS = 10,
    EVENT_CALLBACK = Symbol.for( "event-callback" ),
    FORWARD_SYNC = Object.freeze( { "sync": true } ),
    FORWARD_ASYNC = Object.freeze( { "sync": false } );

export default class Events {
    #maxListeners;
    #totalListeners = 0;
    #events = new Map();
    #watchers = new Set();
    #linked = new Map();
    #forwarded = new Map();

    constructor ( { maxListeners = DEFAULT_MAX_LISTENERS } = {} ) {
        this.#maxListeners = maxListeners;
    }

    // properties
    get maxListeners () {
        return this.#maxListeners;
    }

    set maxListeners ( value ) {
        this.#maxListeners = value;
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
        const names = name === undefined
            ? [ ...this.#events.keys() ]
            : [ name ];

        for ( const eventName of names ) {
            const event = this.#events.get( eventName );

            if ( !event ) continue;

            for ( const entry of event.index.values() ) {
                this.#offEntry( eventName, event, entry );
            }
        }

        return this;
    }

    // removes once listeners of the event without calling them, cascades to the forward targets
    offOnce ( name ) {
        const event = this.#events.get( name );

        if ( event ) {
            for ( const entry of event.index.values() ) {
                if ( entry.once ) this.#offEntry( name, event, entry );
            }
        }

        for ( const forward of this.#forwarded.values() ) {
            try {
                forward.offOnce( name );
            }
            catch ( e ) {
                console.error( e );
            }
        }

        return this;
    }

    emit ( name, ...args ) {
        const event = this.#events.get( name );

        if ( event ) {

            // listeners added during the emit are beyond this length and are not called by it
            const entries = this.#beginEmit( event ),
                length = entries.length;

            try {
                for ( let n = 0; n < length; n++ ) {
                    const entry = entries[ n ];

                    // removed before the emit or by one of the previous listeners
                    if ( !entry.active ) continue;

                    // remove before the call, so the listener can't be called twice by a recursive emit
                    if ( entry.once ) this.#offEntry( name, event, entry );

                    try {
                        const listener = entry.listener;

                        listener( ...args );
                    }
                    catch ( e ) {
                        console.error( e );
                    }
                }
            }
            finally {
                this.#finishEmit( event );
            }
        }

        this.#callForwarders( name, args );

        return this;
    }

    async runCallbacks ( name, ...args ) {
        const event = this.#events.get( name );

        var res;

        if ( event ) {

            // listeners added during the run are beyond this length and are not called by it
            const entries = this.#beginEmit( event ),
                length = entries.length;

            try {
                for ( let n = 0; n < length; n++ ) {
                    const entry = entries[ n ];

                    // removed while the previous callback was running
                    if ( !entry.active ) continue;

                    // after the first error the rest of the listeners are not called
                    const failed = res && !res.ok;

                    // remove before the call, so the listener can't be called twice by a recursive call
                    if ( entry.once ) this.#offEntry( name, event, entry );

                    if ( failed ) continue;

                    const listener = entry.listener;

                    try {
                        const callback = listener[ EVENT_CALLBACK ] || listener;

                        let value = callback( ...args );

                        // await only thenables, sync listeners don't cost a microtask
                        if ( typeof value?.then === "function" ) value = await value;

                        res = result.try( value, {
                            "allowUndefined": true,
                        } );
                    }
                    catch ( e ) {
                        res = result.fromError( e );
                    }
                }
            }
            finally {
                this.#finishEmit( event );
            }
        }

        // forward targets are the last links of the chain
        if ( this.#forwarded.size ) {
            const forwardRes = await this.#runForwarders( name, args, !!res && !res.ok );

            if ( forwardRes ) res = forwardRes;
        }

        return res || result( 200 );
    }

    hasListeners ( name ) {
        if ( name === undefined ) {
            return !!this.#totalListeners;
        }
        else {
            return !!this.#events.get( name )?.index.size;
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
            "names": new Map(),
            "watcher": ( name, subscribe ) => {

                // subscribe
                if ( subscribe ) {
                    let remoteNames = on( name );

                    // do not subscribe
                    if ( !remoteNames ) return;

                    if ( !Array.isArray( remoteNames ) ) remoteNames = [ remoteNames ];

                    const listener = ( ...args ) => forwarder( name, args, FORWARD_ASYNC ),
                        events = [];

                    listener[ EVENT_CALLBACK ] = ( ...args ) => forwarder( name, args, FORWARD_SYNC );

                    link.names.set( name, events );

                    for ( const remoteName of remoteNames ) {
                        events.push( [ remoteName, listener ] );

                        if ( emitter instanceof EventTarget ) {
                            emitter.addEventListener( remoteName, listener );
                        }
                        else {
                            emitter.on( remoteName, listener );
                        }
                    }
                }

                // unsubscribe
                else if ( link.names.has( name ) ) {
                    const events = link.names.get( name );

                    link.names.delete( name );

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

        // must be checked before the link is registered, otherwise a failed link stays registered
        if ( increaseMaxListeners ) {
            if ( !( "maxListeners" in emitter ) ) throw new Error( "Unable to increase max. listeners" );

            emitter.maxListeners += 1;

            link.increaseMaxListeners = true;
        }

        this.#linked.set( emitter, link );

        for ( const name of this.#events.keys() ) {
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

        // already forwarded
        if ( this.#forwarded.has( emitter ) ) this.unforward( emitter );

        on ||= name => name;

        forwarder ||= ( name, args, { sync } ) => {
            if ( sync ) {

                // target without runCallbacks is skipped
                return emitter.runCallbacks?.( name, ...args );
            }
            else {
                emitter.emit( name, ...args );
            }
        };

        const getRemoteNames = name => {
            const remoteNames = on( name );

            if ( !remoteNames ) return;

            return Array.isArray( remoteNames )
                ? remoteNames
                : [ remoteNames ];
        };

        const forward = {
            "watcher": ( name, args ) => {
                const remoteNames = getRemoteNames( name );

                if ( !remoteNames ) return;

                for ( const remoteName of remoteNames ) {
                    forwarder( remoteName, args, FORWARD_ASYNC );
                }
            },

            // returns undefined if the event is not forwarded
            "runner": async ( name, args ) => {
                const remoteNames = getRemoteNames( name );

                if ( !remoteNames ) return;

                var res;

                for ( const remoteName of remoteNames ) {
                    try {
                        let forwarderRes = forwarder( remoteName, args, FORWARD_SYNC );

                        // await only thenables
                        if ( typeof forwarderRes?.then === "function" ) forwarderRes = await forwarderRes;

                        // nothing was called, the target is skipped
                        if ( forwarderRes === undefined ) continue;

                        res = result.try( forwarderRes );
                    }
                    catch ( e ) {
                        res = result.fromError( e );
                    }

                    // the rest of the remote names are not called
                    if ( !res.ok ) break;
                }

                return res;
            },

            "offOnce": name => {
                const remoteNames = getRemoteNames( name );

                if ( !remoteNames ) return;

                // target is not an Events instance
                if ( typeof emitter.offOnce !== "function" ) return;

                for ( const remoteName of remoteNames ) {
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
        this.#forwarded.clear();

        return this;
    }

    clear () {
        return this.unlinkAll().unforwardAll().unwatchAll().offAll();
    }

    [ Symbol.dispose ] () {
        this.clear();
    }

    async [ Symbol.asyncDispose ] () {
        this.clear();
    }

    // private
    #createEvent () {
        return {

            // { listener, once, active }
            "entries": [],

            // listener -> active entry
            "index": new Map(),
            "emitting": 0,
            "dirty": false,
        };
    }

    // in place: nobody iterates the entries while the event is not emitting
    #compact ( event ) {
        const entries = event.entries;

        var length = 0;

        for ( let n = 0; n < entries.length; n++ ) {
            const entry = entries[ n ];

            if ( entry.active ) entries[ length++ ] = entry;
        }

        entries.length = length;
        event.dirty = false;
    }

    #beginEmit ( event ) {
        if ( event.dirty && !event.emitting ) this.#compact( event );

        event.emitting++;

        return event.entries;
    }

    #finishEmit ( event ) {

        // compact only when no nested emit is running
        if ( !--event.emitting && event.dirty ) this.#compact( event );
    }

    #on ( name, listener, once ) {
        var event = this.#events.get( name );

        if ( !event ) {
            event = this.#createEvent();

            this.#events.set( name, event );
        }

        const existing = event.index.get( listener );

        // replace listener, position is unchanged
        if ( existing ) {
            existing.once = once;
        }

        // add new listener
        else {

            // 0 - no limit
            if ( this.#maxListeners && event.index.size === this.#maxListeners ) {
                console.warn( new Error( `Events max. listeners limit exceeded for event "${ String( name ) }"` ) );
            }

            if ( event.dirty && !event.emitting ) this.#compact( event );

            const entry = { listener, once, "active": true };

            event.entries.push( entry );
            event.index.set( listener, entry );

            this.#totalListeners++;

            // subscribed
            if ( event.index.size === 1 ) {
                this.#callWatchers( name, true );
            }
        }
    }

    #off ( name, listener ) {
        const event = this.#events.get( name ),
            entry = event?.index.get( listener );

        if ( entry ) this.#offEntry( name, event, entry );
    }

    #offEntry ( name, event, entry ) {
        if ( !entry.active ) return;

        entry.active = false;
        event.index.delete( entry.listener );
        event.dirty = true;

        this.#totalListeners--;

        // unsubscribed
        if ( !event.index.size ) {
            this.#events.delete( name );

            // the event is gone, nothing to compact
            event.dirty = false;

            this.#callWatchers( name, false );
        }
    }

    #callForwarders ( name, args ) {
        if ( this.#forwarded.size ) {
            for ( const forward of this.#forwarded.values() ) {
                try {
                    forward.watcher( name, args );
                }
                catch ( e ) {
                    console.error( e );
                }
            }
        }
    }

    // returns the result of the last called target, or undefined if no target was called
    async #runForwarders ( name, args, failed ) {
        var res;

        // snapshot: targets added during the run are not called by it
        const targets = Array.from( this.#forwarded );

        for ( const [ emitter, forward ] of targets ) {

            // unforwarded while the previous target was running
            if ( this.#forwarded.get( emitter ) !== forward ) continue;

            // the chain is broken: the target is not called, but its once listeners are removed
            if ( failed ) {
                try {
                    forward.offOnce( name );
                }
                catch ( e ) {
                    console.error( e );
                }

                continue;
            }

            try {
                const targetRes = await forward.runner( name, args );

                if ( targetRes ) {
                    res = targetRes;
                    failed = !res.ok;
                }
            }
            catch ( e ) {
                res = result.fromError( e );
                failed = true;
            }
        }

        return res;
    }

    #callWatchers ( name, subscribe ) {
        if ( this.#watchers.size ) {
            for ( const listener of this.#watchers ) {
                try {
                    listener( name, subscribe );
                }
                catch ( e ) {
                    console.error( e );
                }
            }
        }

        if ( this.#linked.size ) {
            for ( const link of this.#linked.values() ) {
                try {
                    link.watcher( name, subscribe );
                }
                catch ( e ) {
                    console.error( e );
                }
            }
        }
    }

    #unlink ( emitter ) {
        const link = this.#linked.get( emitter );

        if ( !link ) return;

        this.#linked.delete( emitter );

        for ( const off of link.names.values() ) {
            for ( const event of off ) {
                if ( emitter instanceof EventTarget ) {
                    emitter.removeEventListener( ...event );
                }
                else {
                    emitter.off( ...event );
                }
            }
        }

        link.names.clear();

        if ( link.increaseMaxListeners ) {
            if ( "maxListeners" in emitter ) emitter.maxListeners -= 1;
        }
    }

    #unforward ( emitter ) {
        this.#forwarded.delete( emitter );
    }
}
