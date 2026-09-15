import tar1 from "@corejslib/utils/tar";
import File from "#lib/file";
import { glob, globSync } from "#lib/fs";
import stream from "#lib/stream";
import { isPlainObject } from "#lib/utils";

const tar = { ...tar1 };

export default tar;

const _create = tar.create;

tar.create = function ( options, files, callback ) {
    if ( typeof files === "function" ) callback = files;

    if ( Array.isArray( options ) ) {
        files = options;
        options = {};
    }

    var res;

    if ( !files ) {

        // sync
        if ( options.sync ) {
            res = _create(
                options,
                globSync( "**", {
                    "cwd": options.cwd || process.cwd(),
                    "directories": false,
                } )
            );
        }

        // async
        else {
            res = glob( "**", {
                "cwd": options.cwd || process.cwd(),
                "directories": false,
            } ).then( files => _create( options, files, callback ) );
        }
    }
    else {
        res = _create( options, files, callback );
    }

    if ( !options.file ) {
        res = stream.pipeline( res, new stream.PassThrough(), e => {} );
    }

    return res;
};

Object.defineProperties( tar.Pack.prototype, {
    "__add": {
        "value": tar.Pack.prototype.add,
    },
    "add": {
        "value": function ( file, { path, mode = 0o0644 } = {} ) {
            if ( file instanceof File || isPlainObject( file ) ) {
                file = File.new( file );

                const size = file.size;

                if ( !size ) throw new Error( "File size is required" );

                // create the header
                const header = new tar.Header( {
                    "path": path || file.path,
                    size,
                    mode,
                    "type": "File",
                    "mtime": new Date(),
                    "uid": process.getuid
                        ? process.getuid()
                        : null,
                    "gid": process.getgid
                        ? process.getgid()
                        : null,
                    "uname": process.env.USER,
                    "gname": process.env.GROUP,
                } );

                // create the ReadEntry
                const readEntry = new tar.ReadEntry( header );

                return this.__add( stream.pipeline( file.stream(), readEntry, e => {} ) );
            }
            else {
                return this.__add( file );
            }
        },
    },
} );
