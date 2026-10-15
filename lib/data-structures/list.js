import ListEntry from "#lib/data-structures/list/entry";
import { compare as defaultCompare } from "#lib/utils";

export default class List {
    #length = 0;
    #firstEntry = null;
    #lastEntry = null;

    // properties
    get length () {
        return this.#length;
    }

    get firstEntry () {
        return this.#firstEntry;
    }

    get lastEntry () {
        return this.#lastEntry;
    }

    // public
    push ( value ) {
        var entry;

        if ( value instanceof ListEntry ) {
            entry = value;

            // entry already belongs to this list, move it to the end
            if ( entry.list === this ) {
                if ( entry === this.#lastEntry ) return entry;

                const previousEntry = entry.previousEntry,
                    nextEntry = entry.nextEntry;

                // entry is not last, so nextEntry always exists
                nextEntry.previousEntry = previousEntry;

                if ( previousEntry ) {
                    previousEntry.nextEntry = nextEntry;
                }
                else {
                    this.#firstEntry = nextEntry;
                }

                entry.previousEntry = this.#lastEntry;
                entry.nextEntry = null;
                this.#lastEntry.nextEntry = entry;
                this.#lastEntry = entry;

                return entry;
            }

            entry.delete();
        }
        else {
            entry = new ListEntry( value );
        }

        entry.list = this;

        if ( this.#lastEntry ) {
            entry.previousEntry = this.#lastEntry;
            this.#lastEntry.nextEntry = entry;
        }

        this.#lastEntry = entry;
        this.#firstEntry ||= entry;

        this.#length++;

        return entry;
    }

    pop () {
        if ( !this.#lastEntry ) return;

        const entry = this.#lastEntry;

        this.#lastEntry = entry.previousEntry;

        if ( this.#lastEntry ) {
            this.#lastEntry.nextEntry = null;
        }
        else {
            this.#firstEntry = null;
        }

        entry.list = null;
        entry.previousEntry = null;
        entry.nextEntry = null;

        this.#length--;

        return entry;
    }

    unshift ( value ) {
        var entry;

        if ( value instanceof ListEntry ) {
            entry = value;

            // entry already belongs to this list, move it to the start
            if ( entry.list === this ) {
                if ( entry === this.#firstEntry ) return entry;

                const previousEntry = entry.previousEntry,
                    nextEntry = entry.nextEntry;

                // entry is not first, so previousEntry always exists
                previousEntry.nextEntry = nextEntry;

                if ( nextEntry ) {
                    nextEntry.previousEntry = previousEntry;
                }
                else {
                    this.#lastEntry = previousEntry;
                }

                entry.previousEntry = null;
                entry.nextEntry = this.#firstEntry;
                this.#firstEntry.previousEntry = entry;
                this.#firstEntry = entry;

                return entry;
            }

            entry.delete();
        }
        else {
            entry = new ListEntry( value );
        }

        entry.list = this;

        if ( this.#firstEntry ) {
            entry.nextEntry = this.#firstEntry;
            this.#firstEntry.previousEntry = entry;
        }

        this.#firstEntry = entry;
        this.#lastEntry ||= entry;

        this.#length++;

        return entry;
    }

    shift () {
        if ( !this.#firstEntry ) return;

        const entry = this.#firstEntry;

        this.#firstEntry = entry.nextEntry;

        if ( this.#firstEntry ) {
            this.#firstEntry.previousEntry = null;
        }
        else {
            this.#lastEntry = null;
        }

        entry.list = null;
        entry.previousEntry = null;
        entry.nextEntry = null;

        this.#length--;

        return entry;
    }

    delete ( entry ) {
        if ( !entry.list ) return this;

        if ( entry.list !== this ) throw new Error( "Unable to delete entry" );

        const previousEntry = entry.previousEntry,
            nextEntry = entry.nextEntry;

        if ( previousEntry ) {
            previousEntry.nextEntry = nextEntry;
        }

        if ( nextEntry ) {
            nextEntry.previousEntry = previousEntry;
        }

        if ( entry === this.#firstEntry ) this.#firstEntry = nextEntry;

        if ( entry === this.#lastEntry ) this.#lastEntry = previousEntry;

        entry.list = null;
        entry.previousEntry = null;
        entry.nextEntry = null;

        this.#length--;

        return this;
    }

    clear () {
        var entry = this.#firstEntry;

        while ( entry ) {
            const nextEntry = entry.nextEntry;

            entry.list = null;
            entry.previousEntry = null;
            entry.nextEntry = null;

            entry = nextEntry;
        }

        this.#length = 0;
        this.#firstEntry = null;
        this.#lastEntry = null;

        return this;
    }

    sort ( compare = defaultCompare ) {
        if ( typeof compare !== "function" ) {
            throw new TypeError( "The comparison function must be either a function or undefined" );
        }

        if ( this.#length < 2 ) return this;

        const entries = [],
            undefinedEntries = [];

        for ( const entry of this ) {
            if ( entry.value === undefined ) {
                undefinedEntries.push( entry );
            }
            else {
                entries.push( entry );
            }
        }

        // default compare function is the same as in Array: compare as strings
        entries.sort( ( a, b ) => compare( a.value, b.value ) );

        // undefined values are always placed at the end, compare function is not called for them
        for ( const entry of undefinedEntries ) entries.push( entry );

        // relink entries, the list is not modified if compare function throws
        var previousEntry = null;

        for ( const entry of entries ) {
            entry.previousEntry = previousEntry;
            entry.nextEntry = null;

            if ( previousEntry ) previousEntry.nextEntry = entry;

            previousEntry = entry;
        }

        this.#firstEntry = entries[ 0 ];
        this.#lastEntry = previousEntry;

        return this;
    }

    * [ Symbol.iterator ] () {
        var entry = this.#firstEntry;

        while ( entry ) {
            const nextEntry = entry.nextEntry;

            yield entry;

            entry = nextEntry;
        }
    }

    * reverse () {
        var entry = this.#lastEntry;

        while ( entry ) {
            const previousEntry = entry.previousEntry;

            yield entry;

            entry = previousEntry;
        }
    }
}
