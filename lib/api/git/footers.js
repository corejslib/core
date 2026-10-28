import { toHeaderCase } from "#lib/naming-conventions";

export default class GitFooters {
    #footers = new Map();
    #toString;

    // properties
    get size () {
        return this.#footers.size;
    }

    // public
    has ( name ) {
        return this.#footers.has( name?.toLowerCase() );
    }

    get ( name ) {
        return this.#footers?.get( name.toLowerCase() )?.values;
    }

    add ( name, value ) {
        name = toHeaderCase( name.trim() );
        value = value.trim();

        const values = value
            ? [ value ]
            : [];

        const id = name.toLowerCase();

        if ( this.has( id ) ) {
            this.#footers.get( id ).values.push( ...values );
        }
        else {
            this.#footers.set( id, {
                name,
                values,
            } );
        }

        this.#clear();
    }

    toString () {
        if ( this.#toString == null ) {
            const lines = [];

            if ( this.size ) {
                for ( const footer of this.#footers
                    .values()
                    .toArray()
                    .sort( ( a, b ) => a.name.localeCompare( b.name ) ) ) {
                    if ( footer.values.length ) {
                        for ( const value of footer.values ) {
                            lines.push( footer.name + ": " + value );
                        }
                    }
                    else {
                        lines.push( footer.name + ":" );
                    }
                }
            }

            this.#toString = lines.join( "\n" );
        }

        return this.#toString;
    }

    toJSON () {
        return Object.fromEntries( this.#footers.values().map( ( { name, values } ) => [ name, values ] ) );
    }

    [ Symbol.for( "nodejs.util.inspect.custom" ) ] ( depth, options, inspect ) {
        const spec = Object.fromEntries( this.#footers.entries().map( ( [ key, value ] ) => [ key, value.values.join( ", " ) ] ) );

        return `${ this.constructor.name }: ${ inspect( spec ) }`;
    }

    // private
    #clear () {
        this.#toString = undefined;
    }
}
