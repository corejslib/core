import path from "node:path";
import Events from "#lib/events";
import { pathExists, pathExistsSync, sliceFile, sliceFileSync } from "#lib/fs";
import Range from "#lib/range";
import MimeExtnames from "./extnames.js";
import MimeFilenames from "./filenames.js";
import MimeShebangs from "./shebangs.js";
import MimeType from "./type.js";

const MAX_SHEBANG_LENGTH = 50,
    SHEBANG_RANGE = new Range( { "length": MAX_SHEBANG_LENGTH } );

export default class Mime {
    #types = {};
    #shebangs;
    #filenames;
    #extnames;
    #events = new Events();

    constructor () {
        this.#shebangs = new MimeShebangs( this );
        this.#filenames = new MimeFilenames( this );
        this.#extnames = new MimeExtnames( this );
    }

    // properties
    get shebangs () {
        return this.#shebangs;
    }

    get filenames () {
        return this.#filenames;
    }

    get extnames () {
        return this.#extnames;
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
                        mimeType = this.#extnames.get( extname );
                    }
                }
            }
        }

        return mimeType;
    }

    async findByShebang ( { path, content } = {} ) {
        if ( content ) {
            return this.#findByShebang( content );
        }
        else if ( path && ( await pathExists( path ) ) ) {
            content = await sliceFile( path, { "range": SHEBANG_RANGE } );

            content = content.toString( "latin1" );

            return this.#findByShebang( content );
        }
    }

    findByShebangSync ( { path, content } = {} ) {
        if ( content ) {
            return this.#findByShebang( content );
        }
        else if ( path && pathExistsSync( path ) ) {
            content = sliceFileSync( path, { "range": SHEBANG_RANGE } );

            content = content.toString( "latin1" );

            return this.#findByShebang( content );
        }
    }

    has ( essence ) {
        return Boolean( this.get( essence ) );
    }

    get ( essence ) {
        if ( essence instanceof MimeType ) {
            essence = essence.essence;
        }

        return this.#types[ essence ];
    }

    add ( mimeTypes ) {
        if ( !Array.isArray( mimeTypes ) ) mimeTypes = [ mimeTypes ];

        for ( const { essence, compressible, charset, shebangs, filenames, extnames } of mimeTypes ) {
            let mimeType = this.get( essence );

            if ( mimeType ) {
                mimeType.delete();
            }

            mimeType = new MimeType( this, essence, {
                compressible,
                charset,
            } );

            this.#types[ mimeType.essence ] = mimeType;

            if ( shebangs ) {
                for ( const shebang of shebangs ) mimeType.shebangs.add( shebang );
            }

            if ( filenames ) {
                for ( const filename of filenames ) mimeType.filenames.add( filename );
            }

            if ( extnames ) {
                for ( const extname of extnames ) mimeType.extnames.add( extname );
            }
        }

        return this;
    }

    delete ( mimeTypes ) {
        if ( !Array.isArray( mimeTypes ) ) mimeTypes = [ mimeTypes ];

        for ( const type of mimeTypes ) {
            const mimeType = this.get( type );

            if ( mimeType ) {
                delete this.#types[ type ];

                mimeType.delete();

                for ( const value of mimeType.shebangs ) {
                    delete this.#shebangs[ value ];
                }

                for ( const value of mimeType.filenames ) {
                    delete this.#filenames[ value ];
                }

                for ( const value of mimeType.extnames ) {
                    this.#extnames.delete( value );
                }
            }
        }

        return this;
    }

    clear () {
        for ( const type in this.#types ) {
            this.delete( type );
        }

        return this;
    }

    async update ( mimeTypes ) {
        const mime = new Mime().add( mimeTypes );

        const res = await this.#events.emitSync( "update", mime );

        if ( res.ok ) {
            this.clear();

            this.add( [ ...mime ] );
        }

        return res;
    }

    clone () {
        return new Mime().add( Object.values( this.#types ) );
    }

    toJSON () {
        return Object.values( this.#types ).sort( MimeType.compare );
    }

    * [ Symbol.iterator ] () {
        for ( const mimeType of Object.values( this.#types ) ) {
            yield mimeType;
        }
    }

    on ( name, listener ) {
        this.#events.on( name, listener );

        return this;
    }

    once ( name, listener ) {
        this.#events.once( name, listener );

        return this;
    }

    off ( name, listener ) {
        this.#events.off( name, listener );

        return this;
    }

    // private
    #findByShebang ( content ) {
        if ( content.startsWith( "#!" ) ) {
            for ( const [ shebang, mimeType ] of this.#shebangs ) {
                if ( content.startsWith( shebang ) ) return mimeType;
            }
        }
    }
}
