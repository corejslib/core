import IndexedList from "#lib/data-structures/indexed-list";

export default class Deque {
    #list;

    constructor () {
        this.#list = new IndexedList();
    }

    // properties
    get length () {
        return this.#list.length;
    }

    // public
    has ( value ) {
        return this.#list.has( value );
    }

    delete ( value ) {
        this.#list.delete( value );
    }

    push ( ...values ) {
        for ( const value of values ) {
            this.#list.push( value );
        }
    }

    pop () {
        return this.#list.pop()?.value;
    }

    unshift ( ...values ) {
        for ( const value of values ) {
            this.#list.unshift( value );
        }
    }

    shift () {
        return this.#list.shift()?.value;
    }

    clear () {
        this.#list.clear();
    }

    * [ Symbol.iterator ] () {
        for ( const entry of this.#list ) {
            yield entry.value;
        }
    }
}
