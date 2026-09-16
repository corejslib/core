import { mergeObjects } from "#lib/utils";

let OPTIONS;

function toJSON ( value ) {
    if ( typeof value?.toJSON === "function" ) {
        value = value.toJSON();
    }

    if ( Array.isArray( value ) ) {
        return value.map( toJSON );
    }
    else if ( value && typeof value === "object" ) {
        const out = {};

        for ( const key of Object.keys( value ) ) {
            out[ key ] = toJSON( value[ key ] );
        }

        return out;
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
