import { isPlainObject, mergeObjects } from "#lib/utils";

let OPTIONS;

function toJSON ( value, replacer, key = "", holder ) {
    if ( typeof value?.toJSON === "function" ) {
        value = value.toJSON( key );
    }

    if ( typeof replacer === "function" ) {
        value = replacer.call( holder, key, value );
    }

    // Array
    if ( Array.isArray( value ) ) {
        return value.map( ( item, index ) => toJSON( item, replacer, String( index ), value ) );
    }

    // plain Object
    else if ( isPlainObject( value ) ) {
        const res = {},
            keys = Array.isArray( replacer )
                ? replacer.filter( propertyKey => Object.prototype.hasOwnProperty.call( value, propertyKey ) )
                : Object.keys( value );

        for ( const propertyKey of keys ) {
            const propertyValue = toJSON( value[ propertyKey ], replacer, propertyKey, value );

            if ( propertyValue !== undefined ) {
                res[ propertyKey ] = propertyValue;
            }
        }

        return res;
    }
    else {
        return value;
    }
}

export default class JsonContainer {
    #data;
    #options;

    constructor ( data, options ) {
        this.#data = data;
        this.#options = options;
    }

    // static
    static get options () {
        return OPTIONS;
    }

    static prepareJson ( data, replacer ) {
        return toJSON( data, replacer );
    }

    // properties
    get data () {
        return this.#data;
    }

    get options () {
        return this.#options;
    }

    // public
    toString () {
        if ( this.#data == null ) return this.#data;

        const options = OPTIONS;

        // create options
        this.#createOptions();

        try {
            return String( this.#data );
        }
        finally {
            OPTIONS = options;
        }
    }

    toJSON () {
        const options = OPTIONS;

        // create options
        this.#createOptions();

        try {
            return toJSON( this.#data );
        }
        finally {
            OPTIONS = options;
        }
    }

    // private
    #createOptions () {
        if ( this.#options ) {
            if ( OPTIONS ) {
                OPTIONS = mergeObjects( {}, this.#options, OPTIONS );
            }
            else {
                OPTIONS = this.#options;
            }
        }
    }
}
