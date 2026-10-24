import { fileURLToPath } from "node:url";
import Ajv from "#lib/ajv";
import { readConfig } from "#lib/config";
import { glob } from "#lib/fs";
import GlobPatterns from "#lib/glob/patterns";
import constants from "#lib/sql/constants";
import { sql } from "#lib/sql/query";
import Cron from "#lib/sql/schema/cron";

const SCHEMA_EVENTS = new Set( [ "_schema_cron/update", "_schema_cron/delete" ] );

let VALIDATOR;

function parseVersion ( file, dir ) {
    const match = file.match( /^(\d+)/v );

    if ( !match ) throw `Database schema file name must start with a number: ${ dir }/${ file }`;

    return Number( match[ 1 ] );
}

export default class SqlSchema {
    #dbh;
    #isLoaded = false;
    #emits = new GlobPatterns();
    #cron;
    #locks = {
        "migration": -1,
        "cron": -2,
    };

    constructor ( dbh ) {
        this.#dbh = dbh;
        this.#cron = new Cron( dbh );
    }

    // properties
    get _dbh () {
        return this.#dbh;
    }

    get isLoaded () {
        return this.#isLoaded;
    }

    get cron () {
        return this.#cron;
    }

    // public
    async load () {
        if ( this.#isLoaded ) return result( 200 );

        let res = await this.#dbh.select( sql`SELECT * FROM _schema` );
        if ( !res.ok ) return res;

        // apply emits
        if ( res.data ) {
            for ( const row of res.data ) {
                if ( row.emits ) this.#emits.add( row.emits );
            }
        }

        // load advisory locks, SQLite has no advisory locks table
        if ( this.#dbh.isPostgreSql ) {
            res = await this.#dbh.select( sql`SELECT id, lock FROM _schema_lock` );
            if ( !res.ok ) return res;

            if ( res.data ) {
                for ( const row of res.data ) this.#locks[ row.lock ] = row.id;
            }
        }

        this.#isLoaded = true;

        return result( 200 );
    }

    async migrate ( url, options ) {
        try {
            const path = fileURLToPath( url ),
                indexPath = path + "/index.yaml";

            // load schema index
            const meta = await readConfig( indexPath );

            VALIDATOR ||= new Ajv().compile( await readConfig( "#resources/schemas/sql.index.schema.yaml", { "resolve": import.meta.url } ) );

            if ( !VALIDATOR( meta ) ) throw `SQL index "${ indexPath }" is not valid, errors:\n${ JSON.stringify( VALIDATOR.errors, null, 4 ) }`;

            meta.patch ??= 0;

            // check type
            const type = new Set( Array.isArray( meta.type )
                ? meta.type
                : [ meta.type ] );
            if ( this.#dbh.isSqlite && !type.has( "sqlite" ) ) throw "Database schema type is not compatible with SQLite";
            if ( this.#dbh.isPostgreSql && !type.has( "postgresql" ) ) throw "Database schema type is not compatible with PostgreSQL";

            // validate emits
            if ( meta.emits ) {
                for ( const name of meta.emits ) {
                    if ( constants.reservedEvents.has( name ) ) throw `Database event name "${ name }" is reserved`;

                    if ( !name.startsWith( meta.module + "/" ) ) throw `Database event name "${ name }" must be prefixed with the module name "${ meta.module }/"`;

                    if ( this.#emits.has( name ) ) throw `Database event name "${ name }" is already registered`;
                }
            }

            // validate locks
            if ( meta.locks ) {
                for ( const name of meta.locks ) {
                    if ( !name.startsWith( meta.module + "/" ) ) throw `Database advisory lock name "${ name }" must be prefixed with the module name "${ meta.module }/"`;

                    if ( Object.hasOwn( this.#locks, name ) ) throw `Database advisory lock name "${ name }" is already registered`;
                }
            }

            const schema = new Map(),
                patches = new Map();

            // load schema
            let files = await glob( "*.js", { "cwd": path, "directories": false } );

            for ( const file of files ) {
                const version = parseVersion( file, path );

                if ( schema.has( version ) ) throw `Database schema patch ${ version } already exists: ${ path }/${ file }`;

                schema.set( version, await import( new URL( file, url + "/" ) ) );
            }

            // load patches
            files = await glob( "*.js", { "cwd": path + "/patches", "directories": false } );

            for ( const file of files ) {
                const version = parseVersion( file, path + "/patches" );

                if ( version === 0 ) throw `Database patch number must be > 0: ${ path }/patches/${ file }`;

                if ( patches.has( version ) ) throw `Database patch ${ version } already exists: ${ path }/patches/${ file }`;

                patches.set( version, await import( new URL( "patches/" + file, url + "/" ) ) );
            }

            // migrate
            const res = await this._migrate( meta, schema, patches, options );

            if ( res.ok ) {
                this.#isLoaded = true;

                // store emits
                if ( meta.emits ) this.#emits.add( meta.emits );

                // store locks
                if ( res.data?.locks ) Object.assign( this.#locks, res.data.locks );
            }

            return res;
        }
        catch ( e ) {
            return result.fromError( e );
        }
    }

    getLockId ( lock ) {
        if ( !Object.hasOwn( this.#locks, lock ) ) throw new Error( `Database advisory lock "${ lock }" is not registered` );

        return this.#locks[ lock ];
    }

    isEventValid ( name ) {
        return SCHEMA_EVENTS.has( name ) || this.#emits.test( name );
    }
}
