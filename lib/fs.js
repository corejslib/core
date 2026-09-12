import fs from "node:fs";
import path from "node:path";
import * as bits from "#lib/bits";
import Glob from "#lib/fs/glob";
import GlobSync from "#lib/fs/glob-sync";
import Range from "#lib/range";

const PERMISSION_INDEX = {
        "ur": 0,
        "uw": 1,
        "ux": 2,
        "gr": 3,
        "gw": 4,
        "gx": 5,
        "or": 6,
        "ow": 7,
        "ox": 8,
    },
    REPLACEMENT = "_";

let FS_IS_CASE_SENSITIVE;

// public
export function calculateMode ( mode, baseMode ) {
    if ( typeof mode === "number" ) return mode;

    if ( baseMode == null ) {
        baseMode = 0;
    }
    else if ( typeof baseMode === "string" ) {
        baseMode = calculateMode( baseMode );
    }

    if ( !isFullMode( mode ) ) {
        const fullMode = [ "?", "?", "?", "?", "?", "?", "?", "?", "?" ];

        for ( const group of mode.split( / +/v ) ) {

            // +rwx, u+rwx go-x
            const match = group.match( /^([gou]{1,3})?([+\-])([rwx]{1,3})$/v );

            if ( !match ) throw new Error( `File mode "${ mode }" is not valid` );

            const users = match[ 1 ] || "ugo",
                sign = match[ 2 ],
                permissions = match[ 3 ];

            for ( const user of users ) {
                for ( const permission of permissions ) {
                    const idx = PERMISSION_INDEX[ user + permission ];

                    fullMode[ idx ] = sign === "-"
                        ? "-"
                        : permission;
                }
            }
        }

        mode = fullMode.join( "" );
    }

    for ( let n = 0; n <= 8; n++ ) {

        // drop permission
        if ( mode[ n ] === "-" ) {
            baseMode = bits.dropBits( baseMode, 2 ** ( 8 - n ) );
        }

        // set permission
        else if ( mode[ n ] !== "?" ) {
            baseMode = bits.setBits( baseMode, 2 ** ( 8 - n ) );
        }
    }

    return baseMode;
}

export async function chmod ( path, mode ) {
    if ( typeof mode === "string" ) {
        if ( isBaseModeRequired( mode ) ) {
            var { "mode": baseMode } = await fs.promises.stat( path );

            baseMode = baseMode & 0o777;
        }

        mode = calculateMode( mode, baseMode );
    }

    return fs.promises.chmod( path, mode );
}

export function chmodSync ( path, mode ) {
    if ( typeof mode === "string" ) {
        if ( isBaseModeRequired( mode ) ) {
            var { "mode": baseMode } = fs.statSync( path );

            baseMode = baseMode & 0o777;
        }

        mode = calculateMode( mode, baseMode );
    }

    return fs.chmodSync( path, mode );
}

export async function pathExists ( path ) {
    return fs.promises
        .access( path )
        .then( () => true )
        .catch( e => {

            // file not found
            if ( e.code === "ENOENT" ) {
                return false;
            }
            else {
                throw e;
            }
        } );
}

export function pathExistsSync ( path ) {
    return fs.existsSync( path );
}

export async function sliceFile ( filePath, { range } = {} ) {
    if ( range ) {
        const stat = await fs.promises.stat( filePath );
        if ( !stat.isFile() ) throw new Error( "Path is not a file" );

        range = Range.new( range ).createRange( {
            "contentLength": stat.size,
        } );

        if ( range.length === 0 ) {
            return Buffer.from( "" );
        }
        else {
            let buffer = Buffer.alloc( range.length );

            const fh = await fs.promises.open( filePath ),
                { bytesRead } = await fh.read( buffer, 0, range.length, range.start );

            await fh.close();

            if ( bytesRead < buffer.length ) {
                buffer = buffer.subarray( 0, bytesRead );
            }

            return buffer;
        }
    }
    else {
        return fs.promises.readFile( filePath );
    }
}

export function sliceFileSync ( filePath, { range } = {} ) {
    if ( range ) {
        const stat = fs.statSync( filePath );
        if ( !stat.isFile() ) throw new Error( "Path is not a file" );

        range = Range.new( range ).createRange( {
            "contentLength": stat.size,
        } );

        if ( range.length === 0 ) {
            return Buffer.from( "" );
        }
        else {
            let buffer = Buffer.alloc( range.length );

            const fd = fs.openSync( filePath ),
                bytesRead = fs.readSync( fd, buffer, 0, range.length, range.start );

            fs.closeSync( fd );

            if ( bytesRead < buffer.length ) {
                buffer = buffer.subarray( 0, bytesRead );
            }

            return buffer;
        }
    }
    else {
        return fs.readFileSync( filePath );
    }
}

export async function rmEmptyDir ( path ) {
    let files;

    try {
        files = await fs.promises.readdir( path );
    }
    catch ( e ) {

        // path is not exists
        if ( e.code === "ENOENT" ) {
            return;
        }

        // path is not a directory
        // else if ( e.code === "ENOTDIR" ) {
        //     return;
        // }

        throw e;
    }

    // directory is not empty
    if ( files?.length ) return;

    return fs.promises.rmdir( path );
}

export async function rmDirEntries ( path, { force = false, maxRetries = 0, retryDelay = 100 } = {} ) {
    let files;

    try {
        files = await fs.promises.readdir( path );
    }
    catch ( e ) {
        if ( force ) {

            // path not exists
            if ( e.code === "ENOENT" ) {
                return;
            }

            // path is not a directory
            else if ( e.code === "ENOTDIR" ) {
                return;
            }
        }

        throw e;
    }

    // directory is empty
    if ( !files?.length ) return;

    const promises = files.map( file => {
        return fs.promises.rm( path + "/" + file, {
            force,
            maxRetries,
            retryDelay,
        } );
    } );

    return Promise.all( promises );
}

export function sanitizeFilename ( filename, { windows = true, replacement, unicode = true } = {} ) {
    replacement ??= REPLACEMENT;

    if ( /^\.+$/v.test( filename ) ) {
        return filename.replaceAll( ".", replacement );
    }

    if ( windows ) {
        if ( /^(?:con|prn|aux|nul|com\d|lpt\d)(?:\..*)?$/iv.test( filename ) ) {
            filename = replacement + filename;
        }

        filename = filename.replace( /[ .]$/v, replacement );
    }

    if ( unicode ) {
        filename = filename.replaceAll( /["*\/:<>?\\\|]/gv, char => String.fromCodePoint( char.codePointAt( 0 ) + 0xFEE0 ) );
    }

    filename = filename.replaceAll( /[\u{0}-\u{1F}"*\/:<>?\\\|\u{80}-\u{9F}]/gv, replacement ).replace( /^ /v, replacement );

    return filename;
}

export function isValidPath ( filePath ) {
    return !/[":<>?\\\|]/v.test( filePath );
}

export async function glob ( patterns, options ) {
    return new Glob( options ).find( patterns );
}

export function globSync ( patterns, options ) {
    return new GlobSync( options ).find( patterns );
}

export async function checkFsCaseSensitive () {
    if ( FS_IS_CASE_SENSITIVE == null ) {
        FS_IS_CASE_SENSITIVE = !( await pathExists( createCaseSensitivePath() ) );
    }

    return FS_IS_CASE_SENSITIVE;
}

export function checkFsCaseSensitiveSync () {
    if ( FS_IS_CASE_SENSITIVE == null ) {
        FS_IS_CASE_SENSITIVE = !pathExistsSync( createCaseSensitivePath() );
    }

    return FS_IS_CASE_SENSITIVE;
}

// private
function isFullMode ( mode ) {
    return mode.length === 9 && !mode.includes( " " );
}

function isBaseModeRequired ( mode ) {
    if ( isFullMode( mode ) ) {
        return mode.includes( "?" );
    }
    else {
        return true;
    }
}

function createCaseSensitivePath () {
    const dirname = path.dirname( process.argv[ 0 ] );

    let basename = path.basename( process.argv[ 0 ] );

    if ( /[a-z]/v.test( basename ) ) {
        basename = basename.toUpperCase();
    }
    else if ( /[A-Z]/v.test( basename ) ) {
        basename = basename.toLowerCase();
    }
    else {
        throw new Error( "Unable to create case-sensiitive path" );
    }

    return path.join( dirname, basename );
}
