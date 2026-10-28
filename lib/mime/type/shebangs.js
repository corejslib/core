export default class MimeTypeShebangs {
    #mimeType;
    #shebangs = new Map();

    constructor ( mimeType, shebangs ) {
        this.#mimeType = mimeType;

        if ( shebangs ) this.add( shebangs );
    }

    // properties
    get size () {
        return this.#shebangs.size;
    }

    // public
    has ( shebang ) {
        if ( shebang instanceof RegExp ) {
            shebang = shebang.toString();
        }

        return this.#shebangs.has( shebang );
    }

    get ( shebang ) {
        if ( shebang instanceof RegExp ) {
            shebang = shebang.toString();
        }

        return this.#shebangs.get( shebang );
    }

    add ( shebangs ) {
        if ( !( shebangs instanceof this.constructor ) ) {
            if ( !Array.isArray( shebangs ) ) shebangs = [ shebangs ];
        }

        for ( let shebang of shebangs ) {
            let regexp;

            if ( shebang instanceof RegExp ) {
                regexp = shebang;
                shebang = regexp.toString();
            }
            else {
                const idx = shebang.lastIndexOf( "/" ),
                    source = shebang.slice( 1, idx ),
                    flags = shebang.slice( idx + 1 );

                regexp = new RegExp( source, flags );
            }

            if ( !this.#shebangs.has( shebang ) ) {
                this.#shebangs.set( shebang, regexp );

                this.#mimeType.mime?.shebangs.add( this.#mimeType, regexp );
            }
        }

        return this;
    }

    delete ( shebangs ) {
        if ( !Array.isArray( shebangs ) ) shebangs = [ shebangs ];

        for ( let shebang of shebangs ) {
            if ( shebang instanceof RegExp ) {
                shebang = shebang.toString();
            }

            if ( this.#shebangs.has( shebang ) ) {
                this.#shebangs.delete( shebang );

                this.#mimeType.mime?.shebangs.delete( shebang );
            }
        }

        return this;
    }

    clear () {
        for ( const item of this.#shebangs ) {
            this.delete( item );
        }

        return this;
    }

    toJSON () {
        return this.#shebangs.size
            ? this.#shebangs.keys().toArray().sort()
            : undefined;
    }

    [ Symbol.iterator ] () {
        return this.#shebangs.values();
    }
}
