import { fileURLToPath } from "node:url";
import Ajv from "#lib/ajv";
import { readConfig } from "#lib/config";
import { glob } from "#lib/fs";
import GlobPatterns from "#lib/glob/patterns";
import constants from "#lib/sql/constants";
import { sql } from "#lib/sql/query";
import Cron from "#lib/sql/schema/cron";

const SCHEMA_EVENTS = new Set( [ "_schema_cron/update", "_schema_cron/delete" ] );

var VALIDATOR;

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

        var res = await this.#dbh.select( sql`SELECT * FROM _schema` );
        if ( !res.ok ) return res;

        // apply emits
        if ( res.data ) {
            for ( const row of res.data ) {
                if ( row.emits ) this.#emits.add( row.emits );
            }
        }

        res = await this.#dbh.select( sql`SELECT id, lock FROM _schema_lock` );
        if ( !res.ok ) return result( 200 );

        if ( res.data ) {
            for ( const row of res.data ) this.#locks[ row.lock ] = row.id;
        }

        this.#isLoaded = true;

        return result( 200 );
    }

    async migrate ( url, options ) {
        try {
            var res;

            const path = fileURLToPath( url ),
                indexPath = path + "/index.yaml";

            // load schema index
            const meta = await readConfig( indexPath );

            VALIDATOR ||= new Ajv().compile( await readConfig( "#resources/schemas/sql.index.schema.yaml", { "resolve": import.meta.url } ) );

            if ( !VALIDATOR( meta ) ) throw `SQL index "${ indexPath }" is not valid, errors:\n${ VALIDATOR.errors }`;

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

                    if ( !name.startsWith( meta.module + "/" ) ) throw `Database event name "${ name }" must be prefixed wuth the module name "${ meta.module }/"`;

                    if ( this.#emits.has( name ) ) throw `Database event name "${ name }" is already registered`;
                }
            }

            // validate locks
            if ( meta.locks ) {
                for ( const name of meta.locks ) {
                    if ( !name.startsWith( meta.module + "/" ) ) throw `Database advisory lock name "${ name }" must be prefixed wuth the module name "${ meta.module }/"`;

                    if ( this.#locks[ name ] ) throw `Database advisory lock name "${ name }" is already registered`;
                }
            }

            const schema = new Map(),
                patches = new Map();

            // load schema
            var files = await glob( "*.js", { "cwd": path, "directories": false } );

            for ( const file of files ) {
                const version = Number( file.match( /^(\d+)/v )[ 0 ] );

                if ( schema.has( version ) ) throw `Database schema patch ${ version } is already exists`;

                schema.set( version, await import( new URL( file, url + "/" ) ) );
            }

            // load patches
            files = await glob( "*.js", { "cwd": path + "/patches", "directories": false } );

            for ( const file of files ) {
                const version = Number( file.match( /^(\d+)/v )[ 0 ] );

                if ( version === 0 ) throw `Database patch number must be > 0: ${ path }/patches/${ file }`;

                if ( patches.has( version ) ) throw `Database patch ${ version } is already exists: ${ path }/patches/${ file }`;

                patches.set( version, await import( new URL( "patches/" + file, url + "/" ) ) );
            }

            // migrate
            res = await this._migrate( meta, schema, patches, options );

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
        const id = this.#locks[ lock ];

        if ( !id ) throw new Error( `Database advisory lock "${ lock }" is not registered` );

        return id;
    }

    isEventValid ( name ) {
        return SCHEMA_EVENTS.has( name ) || this.#emits.test( name );
    }
}
