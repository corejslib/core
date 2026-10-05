import List from "#lib/data-structures/list";
import ThreadsPool from "#lib/threads/pool";
import Signal from "#lib/threads/signal";

export default class ThreadsPoolQueue extends ThreadsPool {
    #list = new List();
    #signal = new Signal();

    // properties
    get isDestroyable () {
        if ( this.#list.length ) return false;

        return super.isDestroyable;
    }

    // public
    pushThread ( thread, { highPriority } = {} ) {
        const data = {
            "result": null,
        };

        if ( highPriority ) {
            this.#list.unshift( data );
        }
        else {
            this.#list.push( data );
        }

        this.runThread( thread, { highPriority } )
            .then( res => {
                data.result = res;

                this.#ready();
            } )
            .catch( e => console.error( e ) );
    }

    async getResult () {

        // list is empty
        if ( !this.#list.length ) return;

        const res = this.#getResult();

        if ( res ) {
            return res;
        }
        else {
            return this.#signal.wait();
        }
    }

    async* [ Symbol.asyncIterator ] () {
        var res;

        while ( ( res = await this.getResult() ) ) {
            yield res;
        }
    }

    // private
    #ready () {

        // give each ready result to exactly one waiting consumer
        while ( this.#signal.waitingThreads ) {
            const res = this.#getResult();

            if ( !res ) break;

            this.#signal.send( res );
        }

        // no more results will be produced, release remaining consumers
        if ( !this.#list.length && this.#signal.waitingThreads ) {
            this.#signal.broadcast();
        }
    }

    #getResult () {
        const firstEntry = this.#list.firstEntry;
        if ( !firstEntry ) return;

        const res = firstEntry.value.result;
        if ( !res ) return;

        this.#list.delete( firstEntry );

        return res;
    }
}
