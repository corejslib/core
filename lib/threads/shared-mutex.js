import ProxyFinalizationRegistry from "#lib/proxy-finalization-registry";
import Counter from "#lib/threads/counter";

class SharedMutexesSet extends ProxyFinalizationRegistry {
    #api;
    #clusterId;

    constructor ( api, { clusterId } = {} ) {
        super();

        this.#api = api;
        this.#clusterId = clusterId;
    }

    // properties
    get clusterId () {
        return this.#clusterId;
    }

    // protected
    _createTarget ( id, destroy, options ) {
        return new SharedMutex( this.#api, id, { "clusterId": this.#clusterId, destroy } );
    }

    _isTargetDestroyable ( target ) {
        return target.isDestroyable;
    }
}

export default class SharedMutex {
    #api;
    #id;
    #clusterId;
    #destroy;
    #clusterMutexId;
    #waitingLocks = 0;
    #lockId;
    #disconnectListener;
    #abortController = new AbortController();
    #operationsCounter = new Counter();

    constructor ( api, id, { clusterId, destroy } = {} ) {
        this.#api = api;
        this.#id = id;
        this.#clusterId = clusterId;
        this.#destroy = destroy;

        this.#clusterMutexId = clusterId
            ? clusterId + "/" + id
            : id;
    }

    // static
    static get Set () {
        return SharedMutexesSet;
    }

    // properties
    get id () {
        return this.#id;
    }

    get clusterId () {
        return this.#clusterId;
    }

    get waitingLocks () {
        return this.#waitingLocks;
    }

    get abortSignal () {
        return this.#abortController.signal;
    }

    get isDestroyable () {
        return !this.#operationsCounter.value;
    }

    // public
    async isLocked ( { signal } = {} ) {
        if ( this.#lockId ) return true;

        this.#startOperation();

        var res;

        while ( true ) {
            if ( signal?.aborted ) break;

            res = await this.#api.call( "mutexes/is-locked", this.#clusterMutexId );

            if ( res.ok ) break;

            await this.#api.waitConnect( signal );
        }

        return this.#finishOperation( res?.data );
    }

    async tryLock ( { signal } = {} ) {
        this.#startOperation();

        var res;

        while ( true ) {
            if ( signal?.aborted ) break;

            res = await this.#api.call( "mutexes/try-lock", this.#clusterMutexId );

            if ( res.ok ) break;

            await this.#api.waitConnect( signal );
        }

        // locked
        if ( res?.data ) {
            this.#onLock( res.data );

            return this.#finishOperation( true );
        }

        // not locked
        else {
            return this.#finishOperation( false );
        }
    }

    async lock ( { signal } = {} ) {
        this.#startOperation();

        this.#waitingLocks++;

        var res;

        while ( true ) {
            if ( signal?.aborted ) break;

            res = await this.#api.call( {
                "method": "mutexes/lock",
                "args": [ this.#clusterMutexId ],
                signal,
            } );

            if ( res.ok ) break;

            await this.#api.waitConnect( signal );
        }

        const locked = Boolean( res?.data );

        // locked
        if ( locked ) this.#onLock( res.data );

        this.#waitingLocks--;

        return this.#finishOperation( locked );
    }

    async unlock () {

        // not locked
        if ( !this.#lockId ) return true;

        const lockId = this.#lockId;

        this.#startOperation();

        const res = await this.#api.call( "mutexes/unlock", this.#clusterMutexId, lockId );

        if ( res.ok ) {

            // unlocked
            if ( res.data ) this.#onUnlock( lockId );

            return this.#finishOperation( res.data );
        }

        // connection error, unlocked automatically
        else {
            return this.#finishOperation( true );
        }
    }

    [ Symbol.dispose ] () {
        this.unlock();
    }

    async [ Symbol.asyncDispose ] () {
        await this.unlock();
    }

    // private
    #onLock ( lockId ) {

        // previous lock was already released on the server, but the unlock response has not been processed yet
        if ( this.#lockId ) this.#onUnlock();

        this.#startOperation();

        this.#lockId = lockId;

        // subscribe
        this.#disconnectListener = () => this.#onUnlock();
        this.#api.once( "disconnect", this.#disconnectListener );
    }

    #onUnlock ( lockId ) {
        if ( !this.#lockId ) return;

        // stale unlock of a lock that has already been replaced by a newer one
        if ( lockId && lockId !== this.#lockId ) return;

        this.#lockId = null;

        const abortController = this.#abortController;

        this.#abortController = new AbortController();
        abortController.abort();

        // unsubscribe
        if ( this.#disconnectListener ) {
            this.#api.off( "disconnect", this.#disconnectListener );

            this.#disconnectListener = null;
        }

        this.#finishOperation();
    }

    #startOperation () {
        this.#operationsCounter.value++;
    }

    #finishOperation ( res ) {
        this.#operationsCounter.value--;

        if ( this.isDestroyable ) this.#destroy?.();

        return res;
    }
}
