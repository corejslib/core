import path from "node:path";
import { pathExists, pathExistsSync, sliceFile, sliceFileSync } from "#lib/fs";
import Range from "#lib/range";
import { isEmptyObject } from "#lib/utils";
import MimeExtnames from "./extnames.js";
import MimeFilenames from "./filenames.js";
import MimeShebangs from "./shebangs.js";
import MimeType from "./type.js";

const MAX_SHEBANG_LENGTH = 100,
    SHEBANG_RANGE = new Range( { "length": MAX_SHEBANG_LENGTH } );

export default class Mime {
    #types = new Map();
    #extnames;
    #filenames;
    #shebangs;

    constructor () {
        this.#extnames = new MimeExtnames( this );
        this.#filenames = new MimeFilenames( this );
        this.#shebangs = new MimeShebangs( this );
    }

    // properties
    get maxShebangLength () {
        return MAX_SHEBANG_LENGTH;
    }

    get extnames () {
        return this.#extnames;
    }

    get filenames () {
        return this.#filenames;
    }

    get shebangs () {
        return this.#shebangs;
    }

    // public
    async find ( { filename, path, content } = {} ) {
        var mimeType;

        mimeType = this.findByFilename( filename || path );

        if ( !mimeType && ( path || content ) ) {
            mimeType = await this.findByShebang( { path, content } );
        }

        return mimeType;
    }

    findSync ( { filename, path, content } = {} ) {
        var mimeType;

        mimeType = this.findByFilename( filename || path );

        if ( !mimeType && ( path || content ) ) {
            mimeType = this.findByShebangSync( { path, content } );
        }

        return mimeType;
    }

    findByFilename ( filename ) {
        var mimeType;

        if ( filename ) {
            const basename = path.basename( filename );

            if ( basename ) {
                mimeType = this.#filenames.findMimeType( basename );

                if ( !mimeType ) {
                    const extname = path.extname( basename );

                    if ( extname ) {
                        mimeType = this.#extnames.findMimeType( extname );
                    }
                }
            }
        }

        return mimeType;
    }

    async findByShebang ( { path, content } = {} ) {
        if ( content ) {
            return this.#shebangs.findMimeType( content );
        }
        else if ( path && ( await pathExists( path ) ) ) {
            content = await sliceFile( path, { "range": SHEBANG_RANGE } );

            content = content.toString( "latin1" );

            return this.#shebangs.findMimeType( content );
        }
    }

    findByShebangSync ( { path, content } = {} ) {
        if ( content ) {
            return this.#shebangs.findMimeType( content );
        }
        else if ( path && pathExistsSync( path ) ) {
            content = sliceFileSync( path, { "range": SHEBANG_RANGE } );

            content = content.toString( "latin1" );

            return this.#shebangs.findMimeType( content );
        }
    }

    has ( essence ) {
        if ( essence instanceof MimeType ) {
            essence = essence.essence;
        }

        return this.#types.has( essence );
    }

    get ( essence ) {
        if ( essence instanceof MimeType ) {
            essence = essence.essence;
        }

        return this.#types.get( essence );
    }

    add ( mimeTypes, { replace } = {} ) {
        if ( mimeTypes instanceof this.constructor || Array.isArray( mimeTypes ) ) {
            for ( const mimeType of mimeTypes ) {
                this.#add( mimeType, replace );
            }
        }
        else {
            for ( const essence in mimeTypes ) {
                this.#add(
                    {
                        ...mimeTypes[ essence ],
                        essence,
                    },
                    replace
                );
            }
        }

        return this;
    }

    delete ( mimeTypes ) {
        if ( !Array.isArray( mimeTypes ) ) mimeTypes = [ mimeTypes ];

        for ( const type of mimeTypes ) {
            const mimeType = this.get( type );

            if ( mimeType ) {
                this.#types.delete( type );

                mimeType.delete();

                for ( const value of mimeType.extnames ) {
                    this.#extnames.delete( value );
                }

                for ( const value of mimeType.filenames ) {
                    this.#filenames.delete( value );
                }

                for ( const value of mimeType.shebangs ) {
                    this.#shebangs.delete( value );
                }
            }
        }

        return this;
    }

    clear () {
        for ( const type of this.#types.keys() ) {
            this.delete( type );
        }

        return this;
    }

    clone () {
        return new Mime().add( this );
    }

    toJSON () {
        const json = {};

        for ( const mimeType of this.#types.values().toArray().sort( MimeType.compare ) ) {
            const { essence, ...options } = mimeType.toJSON();

            json[ essence ] = isEmptyObject( options )
                ? null
                : options;
        }

        return json;
    }

    [ Symbol.iterator ] () {
        return this.#types.values();
    }

    // prrivate
    #add ( { essence, compressible, charset, extnames, filenames, shebangs }, replace ) {
        let mimeType = this.get( essence );

        // replace mime type
        if ( mimeType && replace ) {
            mimeType.delete();

            mimeType = null;
        }

        if ( mimeType ) {
            if ( compressible !== undefined ) mimeType.setCompressible( compressible );

            if ( charset !== undefined ) mimeType.setCharset( charset );
        }
        else {
            mimeType = new MimeType( {
                "mime": this,
                essence,
                compressible,
                charset,
            } );

            this.#types.set( mimeType.essence, mimeType );
        }

        if ( extnames ) mimeType.extnames.add( extnames );

        if ( filenames ) mimeType.filenames.add( filenames );

        if ( shebangs ) mimeType.shebangs.add( shebangs );
    }
}
