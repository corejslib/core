import CacheLruEntry from "#lib/cache/lru/entry";
import List from "#lib/data-structures/list";
import Events from "#lib/events";
import Interval from "#lib/interval";

export default class CacheLru {
    #maxSize = null;
    #maxAge = 0;
    #autoDeleteExpiredEntries;

    #list = new List();
    #map = new Map();
    #events = new Events();

    constructor ( { maxSize, maxAge, autoDeleteExpiredEntries = true } = {} ) {
        this.#setMaxSize( maxSize );

        if ( maxAge ) this.#setMaxAge( maxAge );

        this.#autoDeleteExpiredEntries = autoDeleteExpiredEntries;
    }

    // properties
    get maxSize () {
        return this.#maxSize;
    }

    set maxSize ( value ) {
        if ( !this.#setMaxSize( value ) ) return;

        // truncate cache
        if ( this.#maxSize && this.#map.size > this.#maxSize ) {

            // remove expired entries
            this.deleteExpiredEntries();

            while ( this.#map.size > this.#maxSize ) {
                this.#delete( this.#list.firstEntry );
            }
        }
    }

    get maxAge () {
        return this.#maxAge;
    }

    set maxAge ( value ) {
        this.#setMaxAge( value );
    }

    get autoDeleteExpiredEntries () {
        return this.#autoDeleteExpiredEntries;
    }

    get size () {
        return this.#map.size;
    }

    // public
    has ( key ) {
        const listEntry = this.#map.get( key );

        if ( !listEntry ) return false;

        if ( listEntry.value.isExpired ) {
            this.#delete( listEntry );

            return false;
        }
        else {
            return true;
        }
    }

    get ( key, { silent } = {} ) {
        const listEntry = this.#map.get( key );

        if ( !listEntry ) return;

        // entry is expired
        if ( listEntry.value.isExpired ) {

            // delete entry
            this.#delete( listEntry );
        }

        // entry is not expired
        else {

            // move key to the top of the cache
            if ( !silent ) this.#list.push( listEntry );

            // return value
            return listEntry.value.value;
        }
    }

    set ( key, value, maxAge ) {
        if ( maxAge == null ) {
            maxAge = this.#maxAge;
        }
        else if ( !maxAge ) {
            maxAge = 0;
        }
        else {
            maxAge = Interval.new( maxAge ).toMilliseconds().rounded.number;
        }

        const add = maxAge >= 0;

        let listEntry = this.#map.get( key );

        // key is exists
        if ( listEntry ) {

            // delete old entry
            this.#delete( listEntry );
        }

        // key is not exists, cache size limit reached
        else if ( add && this.#maxSize && this.#map.size >= this.#maxSize ) {

            // remove first cached entry
            this.#delete( this.#list.firstEntry );
        }

        // do not add entry if it was expired
        if ( !add ) return;

        const cacheEntry = new CacheLruEntry( this, key, value, maxAge );

        listEntry = this.#list.push( cacheEntry );

        this.#map.set( key, listEntry );
    }

    delete ( key ) {
        const listEntry = this.#map.get( key );

        if ( !listEntry ) return;

        // save value before entry is destroyed
        const value = listEntry.value.value;

        this.#delete( listEntry );

        return value;
    }

    clear ( { silent } = {} ) {
        this.#map = new Map();

        const list = this.#list;
        this.#list = new List();

        const doDelete = this.#autoDeleteExpiredEntries,
            emit = !silent && this.#events.hasListeners( "delete" );

        if ( doDelete || emit ) {
            for ( const listEntry of list ) {
                if ( doDelete ) {
                    listEntry.value.delete();
                }

                if ( emit ) {
                    this.#events.emit( "delete", listEntry.value.key, listEntry.value.value );
                }
            }
        }
    }

    deleteExpiredEntries () {

        // iterate over a copy, because entries are removed from the list during iteration
        for ( const listEntry of this.#list ) {
            if ( listEntry.value.isExpired ) this.#delete( listEntry );
        }
    }

    on ( event, callback ) {
        this.#events.on( event, callback );

        return this;
    }

    once ( event, callback ) {
        this.#events.once( event, callback );

        return this;
    }

    off ( event, callback ) {
        this.#events.off( event, callback );

        return this;
    }

    // protected
    _getListEntry ( key ) {
        const listEntry = this.#map.get( key );

        if ( listEntry && listEntry.value.isExpired ) {
            this.#delete( listEntry );

            return;
        }

        return listEntry;
    }

    // private
    #setMaxSize ( value ) {
        if ( !value || value === Infinity ) {
            value = null;
        }
        else if ( !Number.isInteger( value ) || value < 0 ) {
            throw new TypeError( "CacheLru maxSize value is invalid" );
        }

        // not updated
        if ( value === this.#maxSize ) return;

        this.#maxSize = value;

        return true;
    }

    #setMaxAge ( value ) {
        this.#maxAge = value
            ? Interval.new( value ).toMilliseconds().rounded.number
            : 0;
    }

    #delete ( listEntry ) {
        this.#map.delete( listEntry.value.key );

        listEntry.delete();

        listEntry.value.delete();

        this.#events.emit( "delete", listEntry.value.key, listEntry.value.value );
    }
}
