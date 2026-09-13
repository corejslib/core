import fs from "node:fs";
import path from "node:path";
import { checkFsCaseSensitiveSync, pathExistsSync } from "#lib/fs";
import GlobPattern from "#lib/glob/pattern";
import GlobPatterns from "#lib/glob/patterns";

const IGNORE_GIT = new GlobPattern( "!/**/.git/" ),
    IGNORE_NODE_MODULES = new GlobPattern( "!/**/node_modules/" ),
    DEFAULT_IGNORE = [

        //
        IGNORE_GIT,
        IGNORE_NODE_MODULES,
    ],
    IGNORE_FILES = {
        ".gitignore": {
            "type": ".gitignore",
            "defaultFilename": ".gitignore",
            "defaultIgnore": [ IGNORE_GIT ],
            "root": ".git/",
            "searchInSubdirectories": true,
            "traverseIgnoredDirectories": false,
            "options": {
                "strict": false,
                "absolutePatterns": true,
                "normalizePatterns": false,
                "allowNegatedPatterns": true,
                "allowBraces": false,
                "allowGlob": true,
                "allowBrackets": true,
                "allowGlobstar": true,
                "allowExtGlob": false,
                "allowGlobalBasename": true,
            },
        },
        ".npmignore": {
            "type": ".gitignore",
            "defaultFilename": ".npmignore",
            "defaultIgnore": [ IGNORE_GIT, IGNORE_NODE_MODULES ],
            "root": "package.json",
            "searchInSubdirectories": true,
            "traverseIgnoredDirectories": false,
            "options": {
                "strict": false,
                "absolutePatterns": true,
                "normalizePatterns": false,
                "allowNegatedPatterns": true,
                "allowBraces": false,
                "allowGlob": true,
                "allowBrackets": true,
                "allowGlobstar": true,
                "allowExtGlob": false,
                "allowGlobalBasename": true,
            },
        },
        ".dockerignore": {
            "type": ".dockerignore",
            "defaultFilename": ".dockerignore",
            "defaultIgnore": null,
            "root": null,
            "searchInSubdirectories": false,
            "traverseIgnoredDirectories": true,
            "options": {
                "strict": false,
                "absolutePatterns": true,
                "normalizePatterns": true,
                "allowNegatedPatterns": true,
                "allowBraces": false,
                "allowGlob": true,
                "allowBrackets": true,
                "allowGlobstar": true,
                "allowExtGlob": false,
                "allowGlobalBasename": false,
            },
        },
        ".lintignore": {
            "type": null,
            "defaultFilename": ".lintignore",
            "defaultIgnore": [ IGNORE_GIT, IGNORE_NODE_MODULES ],
            "root": ".git/",
            "searchInSubdirectories": true,
            "traverseIgnoredDirectories": false,
            "options": {
                "strict": true,
                "absolutePatterns": true,
                "normalizePatterns": true,
                "allowNegatedPatterns": true,
                "allowBraces": true,
                "allowGlob": true,
                "allowBrackets": true,
                "allowGlobstar": true,
                "allowExtGlob": true,
                "allowGlobalBasename": true,
            },
        },
    };

export default class GlobSync {
    _cwd;
    _files;
    _directories;
    _absolute;
    _directoryMark;
    _maxDepth;
    _followSymlinks;
    _prefix = "/";
    _searchPatterns;
    _ignorePatterns;
    _ignoreFile;
    _ignoreFilenames;
    _found = [];

    constructor ( { cwd, files = true, directories, absolute, markDirectories, maxDepth, followSymlinks = true, defaultIgnore, ignoreFile, ignoreFilenames, ignoreCase, ...patternOptions } = {} ) {
        if ( !files ) directories ??= true;

        this._cwd = ( cwd
            ? path.resolve( process.cwd(), cwd )
            : process.cwd() ).replaceAll( "\\", "/" );

        this._files = files;
        this._directories = directories;
        this._absolute = Boolean( absolute );
        this._followSymlinks = Boolean( followSymlinks );
        this._maxDepth = maxDepth ?? Infinity;

        this._directoryMark = markDirectories
            ? "/"
            : "";

        if ( ignoreFile ) {
            this._ignoreFile = IGNORE_FILES[ ignoreFile ];
            if ( !this._ignoreFile ) throw new Error( "Invalid ignore file name" );

            if ( ignoreFilenames ) {
                if ( Array.isArray( ignoreFilenames ) ) {
                    this._ignoreFilenames = [ ...ignoreFilenames ];
                }
                else {
                    this._ignoreFilenames = [ ignoreFilenames ];
                }
            }
            else {
                this._ignoreFilenames = [ this._ignoreFile.defaultFilename ];
            }
        }

        ignoreCase ??= !checkFsCaseSensitiveSync();

        this._searchPatterns = new GlobPatterns( {
            ...patternOptions,
            "absolutePatterns": true,
            "normalizePatterns": true,
            ignoreCase,
        } );

        if ( this._ignoreFile ) {
            this._ignorePatterns = new GlobPatterns( {
                ...this._ignoreFile.options,
                ignoreCase,
            } );
        }

        // add default ignore patterns
        if ( defaultIgnore ) {
            this._searchPatterns.add( DEFAULT_IGNORE );
        }
        else if ( defaultIgnore == null ) {
            if ( this._ignoreFile?.defaultIgnore ) {
                this._searchPatterns.add( this._ignoreFile.defaultIgnore );
            }
            else {
                this._searchPatterns.add( DEFAULT_IGNORE );
            }
        }
    }

    // public
    find ( patterns ) {
        if ( !pathExistsSync( this._cwd ) ) return this._found;

        // init ignore patterns
        // exit if one of the parent directories is not traversable
        if ( this._ignoreFile && !this._initIgnoreFile() ) return this._found;

        // add search patterns
        this._searchPatterns.add( patterns, {
            "prefix": this._prefix,
        } );

        // calc max. depth
        this._maxDepth = Math.min( this._maxDepth, this._searchPatterns.maxDepth );

        // exit if depth = 0
        if ( !this._maxDepth ) return this._found;

        // exit if cwd is not traversable
        if ( !this._testDirectoryTraversable( "", this._prefix ) ) return this._found;

        this._readDir( "", 1 );

        if ( this._absolute ) {
            return this._found.map( file => path.posix.join( this._cwd, file ) );
        }
        else {
            return this._found;
        }
    }

    // protected
    _initIgnoreFile () {

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
            const stat = fs.statSync( path.posix.join( root + "/" + this._ignoreFile.root ), {
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
            this._addIgnoreFiles( parentDirectory, prefix );
        }

        return true;
    }

    _addIgnoreFiles ( absoluteDirectory, prefix ) {
        if ( !this._ignoreFile ) return;

        let ignoreFile;

        for ( let filename of this._ignoreFilenames ) {
            filename = absoluteDirectory + "/" + filename;

            if ( pathExistsSync( filename ) ) {
                ignoreFile = filename;
                break;
            }
        }

        if ( !ignoreFile ) return;

        const content = fs.readFileSync( ignoreFile, "utf8" );

        for ( let pattern of content.split( "\n" ) ) {
            pattern = pattern.trim();

            if ( !pattern || pattern.startsWith( "#" ) ) continue;

            pattern = this._prepareIgnorePattern( pattern );

            if ( !pattern ) continue;

            this._ignorePatterns.add( pattern, {
                prefix,
            } );
        }
    }

    _readDir ( cwdRelativeDirectory, depth ) {
        const absoluteDirectory = path.posix.join( this._cwd, cwdRelativeDirectory ),
            prefix = path.posix.join( this._prefix, cwdRelativeDirectory ),
            subDirectories = [];

        // load ignore file for cwd or subdirs (if allowed)
        if ( depth === 1 || this._ignoreFile?.searchInSubdirectories ) {
            this._addIgnoreFiles( absoluteDirectory, prefix );
        }

        let entries;

        // read directory entries
        try {
            entries = fs.readdirSync( absoluteDirectory, { "withFileTypes": true } );
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
            const type = this._getEntryType( absoluteDirectory, entry ),
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
            this._readDir( name, depth + 1 );
        }
    }

    _getEntryType ( root, entry ) {
        if ( this._followSymlinks && entry.isSymbolicLink() ) {
            const target = fs.readlinkSync( path.posix.join( root, entry.name ) );

            entry = fs.statSync( target );
        }

        if ( entry.isDirectory() ) {
            return "directory";
        }
        else if ( entry.isFile() ) {
            return "file";
        }
    }

    _testDirectoryTraversable ( cwdRelativeDirectory, prefix ) {

        // directory is ignored by search patterns
        if ( this._searchPatterns.testDenied( [ cwdRelativeDirectory, path.posix.join( cwdRelativeDirectory, "/" ) ], { prefix } ) ) {
            return false;
        }

        if ( this._ignoreFile?.traverseIgnoredDirectories ) return true;

        if ( this._ignorePatterns?.testList( [ cwdRelativeDirectory, path.posix.join( cwdRelativeDirectory, "/" ) ], { prefix } ) ) {
            return false;
        }

        return true;
    }

    _prepareIgnorePattern ( pattern ) {
        if ( this._ignoreFile.type === ".dockerignore" ) {
            pattern += "/**";
        }

        return pattern;
    }
}
