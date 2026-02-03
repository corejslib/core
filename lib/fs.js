import fs from "node:fs";
import * as bits from "#lib/bits";
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
};

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

        for ( const group of mode.split( / +/ ) ) {

            // +rwx, u+rwx go-x
            const match = group.match( /^([gou]{1,3})?([+-])([rwx]{1,3})$/ );

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

export function sliceFileSync ( filePath, { range } = {} ) {
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

export async function rm ( path, { force = false, recursive = false, maxRetries = 0, retryDelay = 100, ifDirectoryEmpty, keepRoot } = {} ) {
    DIRECTORY: if ( ifDirectoryEmpty || keepRoot ) {
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
                    break DIRECTORY;
                }
            }

            throw e;
        }

        if ( ifDirectoryEmpty ) {

            // directory is not empty
            if ( files?.length ) return;
        }
        else if ( keepRoot ) {

            // directory is empty
            if ( !files?.length ) return;

            const promises = files.map( file =>
                fs.promises.rm( path + "/" + file, {
                    force,
                    recursive,
                    maxRetries,
                    retryDelay,
                } ) );

            return Promise.all( promises );
        }
    }

    return fs.promises.rm( path, {
        force,
        recursive,
        maxRetries,
        retryDelay,
    } );
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
