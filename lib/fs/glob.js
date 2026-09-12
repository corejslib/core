import fs from "node:fs";
import path from "node:path";
import { pathExists } from "#lib/fs";
import GlobSync from "#lib/fs/glob-sync";

export default class Glob extends GlobSync {

    // public
    async find ( patterns ) {
        if ( !( await pathExists( this._cwd ) ) ) return this._found;

        // init ignore patterns
        // exit if one of the parent directories is not traversable
        if ( this._ignoreFile && !( await this._initIgnoreFile() ) ) return this._found;

        // add search patterns
        this._searchPatterns.add( patterns, {
            "prefix": this._prefix,
        } );

        // calc max. depth
        this._maxDepth = Math.max( this._maxDepth, this._searchPatterns.maxDepth );

        // exit if depth = 0
        if ( !this._maxDepth ) return this._found;

        // exit if cwd is not traversable
        if ( !this._testDirectoryTraversable( "", this._prefix ) ) return this._found;

        await this._readDir( "", 1 );

        if ( this._absolute ) {
            return this._found.map( file => path.posix.join( this._cwd, file ) );
        }
        else {
            return this._found;
        }
    }

    // protected
    async _initIgnoreFile () {

        // if ignore file has no root - do nothing
        if ( !this._ignoreFile.root ) {
            return true;
        }

        const parentDirectories = [];

        let root = this._cwd;

        // try to find root
        // collect parent directories
        while ( true ) {

            // check root
            const stat = await fs.promises.stat( path.posix.join( root + "/" + this._ignoreFile.root ), {
                "throwIfNoEntry": false,
            } );

            if ( stat ) {
                const dir = this._ignoreFile.root.endsWith( "/" );

                // root found
                if ( ( dir && stat.isDirectory() ) || ( !dir && stat.isFile() ) ) {
                    break;
                }
            }

            const parent = path.dirname( root );
            if ( parent === root ) break;

            parentDirectories.push( parent );

            root = parent;
        }

        // root is cwd
        if ( !parentDirectories.length ) return true;

        this._prefix = path.posix.join( "/", path.posix.relative( root, this._cwd ) );

        for ( let n = parentDirectories.length - 1; n >= 0; n-- ) {
            const parentDirectory = parentDirectories[ n ],
                prefix = path.posix.join( "/", path.posix.relative( root, parentDirectory ) );

            // exit if parent directory is not traversable
            // do not check for root directory
            if ( prefix !== "/" ) {
                if ( !this._testDirectoryTraversable( prefix, "" ) ) return false;
            }

            // try to load ignore file, if directory is traversable
            await this._addIgnoreFiles( parentDirectory, prefix );
        }

        return true;
    }

    async _addIgnoreFiles ( absoluteDirectory, prefix ) {
        if ( !this._ignoreFile ) return;

        let ignoreFile;

        for ( let filename of this._ignoreFilenames ) {
            filename = absoluteDirectory + "/" + filename;

            if ( await pathExists( filename ) ) {
                ignoreFile = filename;
                break;
            }
        }

        if ( !ignoreFile ) return;

        const content = await fs.promises.readFile( ignoreFile, "utf8" );

        for ( let pattern of content.split( "\n" ) ) {
            pattern = pattern.trim();

            if ( !pattern || pattern.startsWith( "#" ) ) continue;

            pattern = this._prepareIgnorePattern( pattern, prefix );

            if ( !pattern ) continue;

            this._ignorePatterns.add( pattern, {
                prefix,
            } );
        }
    }

    async _readDir ( cwdRelativeDirectory, depth ) {
        const absoluteDirectory = path.posix.join( this._cwd, cwdRelativeDirectory ),
            prefix = path.posix.join( this._prefix, cwdRelativeDirectory ),
            subDirectories = [];

        // load ignore file for cwd or subdirs (if allowed)
        if ( depth === 1 || this._ignoreFile?.searchInSubdirectories ) {
            await this._addIgnoreFiles( absoluteDirectory, prefix );
        }

        let entries;

        // read directory entries
        try {
            entries = await fs.promises.readdir( absoluteDirectory, { "withFileTypes": true } );
        }
        catch ( e ) {

            // ignore permissions error
            if ( e.code === "EPERM" ) {
                entries = [];
            }
            else {
                throw e;
            }
        }

        for ( const entry of entries ) {
            const type = await this._getEntryType( absoluteDirectory, entry ),
                entryCwdRelativePath = path.posix.join( cwdRelativeDirectory, entry.name );

            // directory
            if ( type === "directory" ) {

                // sub-directory is traversable
                if ( depth < this._maxDepth && this._testDirectoryTraversable( entry.name, prefix ) ) {
                    subDirectories.push( entryCwdRelativePath );
                }

                if ( this._directories ) {

                    // sub-directory is denied by the ignore patterns
                    if ( this._ignorePatterns?.testList( [ entry.name, entry.name + "/" ], { prefix } ) ) {
                        continue;
                    }

                    // sub-directory is allowed
                    if ( this._searchPatterns.test( [ entry.name, entry.name + "/" ], { prefix } ) ) {
                        this._found.push( entryCwdRelativePath + this._directoryMark );
                    }
                }
            }

            // file
            else if ( this._files && type === "file" ) {

                // file is denied by ignore patterns
                if ( this._ignorePatterns?.testList( entry.name, { prefix } ) ) {
                    continue;
                }

                // file is allowed
                if ( this._searchPatterns.test( entry.name, { prefix } ) ) {
                    this._found.push( entryCwdRelativePath );
                }
            }
        }

        // process sub-directories
        for ( const name of subDirectories ) {
            await this._readDir( name, depth + 1 );
        }
    }

    async _getEntryType ( root, entry ) {
        if ( this._followSymlinks && entry.isSymbolicLink() ) {
            const target = await fs.promises.readlink( path.posix.join( root, entry.name ) );

            entry = await fs.promises.stat( target );
        }

        if ( entry.isDirectory() ) {
            return "directory";
        }
        else if ( entry.isFile() ) {
            return "file";
        }
    }
}
