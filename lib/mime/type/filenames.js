import { createPattern } from "#lib/mime/utils";

export default class MimeTypeFilenames {
    #mimeType;
    #patterns = new Map();

    constructor ( mimeType, filenames ) {
        this.#mimeType = mimeType;

        if ( filenames ) this.add( filenames );
    }

    // properties
    get size () {
        return this.#patterns.size;
    }

    // public
    has ( pattern ) {
        return this.#patterns.has( createPattern( pattern ).id );
    }

    add ( patterns ) {
        if ( !( patterns instanceof this.constructor ) ) {
            if ( !Array.isArray( patterns ) ) patterns = [ patterns ];
        }

        for ( let pattern of patterns ) {
            pattern = createPattern( pattern );

            if ( !this.#patterns.has( pattern.id ) ) {
                this.#patterns.set( pattern.id, pattern );

                this.#mimeType.mime?.filenames.add( this.#mimeType, pattern );
            }
        }

        return this;
    }

    delete ( patterns ) {
        if ( !Array.isArray( patterns ) ) patterns = [ patterns ];

        for ( let pattern of patterns ) {
            pattern = createPattern( pattern );

            if ( this.#patterns.has( pattern.id ) ) {
                this.#patterns.delete( pattern.id );

                this.#mimeType.mime?.filenames.delete( pattern );
            }
        }

        return this;
    }

    clear () {
        for ( const pattern of this.#patterns.values() ) {
            this.delete( pattern );
        }

        return this;
    }

    toJSON () {
        return this.#patterns.size
            ? this.#patterns
                .values()
                .map( pattern => pattern.pattern )
                .toArray()
                .sort()
            : undefined;
    }

    test ( filename ) {
        for ( const pattern of this.#patterns.values() ) {
            if ( pattern.test( filename ) ) return true;
        }

        return false;
    }

    [ Symbol.iterator ] () {
        return this.#patterns.values();
    }
}
