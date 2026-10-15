import List from "#lib/data-structures/list";

export default class Queue {
    #list;

    constructor () {
        this.#list = new List();
    }

    // properties
    get length () {
        return this.#list.length;
    }

    // public
    push ( ...values ) {
        for ( const value of values ) {
            this.#list.push( value );
        }
    }

    shift () {
        return this.#list.shift()?.value;
    }

    clear () {
        return this.#list.clear();
    }

    * [ Symbol.iterator ] () {
        for ( const entry of this.#list ) {
            yield entry.value;
        }
    }
}
