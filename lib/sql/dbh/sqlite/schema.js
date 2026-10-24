import { sql } from "#lib/sql/query";
import SqlSchema from "#lib/sql/schema";
import { compare } from "#lib/utils";

export default class DbhSqliteSchema extends SqlSchema {
    #schemaCreated = false;

    // protected
    async _migrate ( meta, schema, patches, options ) {
        const dbh = this._dbh;

        let res;

        try {

            // create migration schema
            if ( !this.#schemaCreated ) {
                res = this.#createSchema( dbh );

                if ( !res.ok ) throw res;

                this.#schemaCreated = true;
            }

            // process module
            const module = meta.module;

            // get current module version
            res = dbh.selectRow( sql`SELECT patch FROM _schema WHERE module = ?`, [ module ] );
            if ( !res.ok ) throw res;

            let moduleVersion = res.data?.patch;

            // apply full schema
            if ( schema.size ) {
                res = dbh.begin( dbh => {
                    for ( const version of [ ...schema.keys() ].sort( compare ) ) {
                        const patch = schema.get( version );

                        // apply functions
                        this.#applySchemaFunctions( dbh, module, version, patch );

                        // apply patch
                        if ( moduleVersion == null ) this.#applySchemaPatch( dbh, module, version, patch, options );
                    }

                    if ( moduleVersion == null ) {

                        // update module version
                        const res = dbh.do( sql`INSERT INTO _schema ( module, patch ) VALUES ( ?, ? )`, [ module, meta.patch ] );

                        if ( !res.ok ) throw res;
                    }
                } );

                if ( !res.ok ) throw res;

                // module version is changed only after the transaction is committed
                moduleVersion ??= meta.patch;
            }

            // apply schema patches
            if ( patches.size ) {
                for ( const version of [ ...patches.keys() ].sort( compare ) ) {
                    const patch = patches.get( version ),
                        needApply = version > moduleVersion;

                    res = dbh.begin( dbh => {

                        // apply functions
                        this.#applySchemaFunctions( dbh, module, version, patch );

                        if ( !needApply ) return;

                        // apply patch
                        this.#applySchemaPatch( dbh, module, version, patch, options );

                        // update module version
                        const res = dbh.do( sql`INSERT INTO _schema ( module, patch ) VALUES ( ?, ? ) ON CONFLICT ( module ) DO UPDATE SET patch = excluded.patch`, [ module, version ] );

                        if ( !res.ok ) throw res;
                    } );

                    if ( !res.ok ) throw res;

                    if ( needApply ) moduleVersion = version;
                }
            }

            // update module emits
            {
                const emits = new Set( meta.emits );

                res = dbh.do( sql`UPDATE _schema SET emits = ? WHERE module = ?`, [ emits.size
                    ? [ ...emits ].sort()
                    : null, module ] );

                if ( !res.ok ) throw res;
            }

            // update cron
            res = await this.cron.sync( dbh, module, meta );
            if ( !res.ok ) throw res;

            res = result( 200 );
        }
        catch ( e ) {
            res = result.fromError( e );
        }

        return res;
    }

    // private
    #createSchema ( dbh ) {
        return dbh.exec( sql`

CREATE TABLE IF NOT EXISTS _schema (
    module text PRIMARY KEY,
    patch int4 NOT NULL,
    emits json
);

CREATE TABLE IF NOT EXISTS _schema_cron (
    id integer PRIMARY KEY AUTOINCREMENT,
    module text NOT NULL,
    name text NOT NULL,
    cron text NOT NULL,
    timezone text,
    query json NOT NULL,
    run_missed boolean NOT NULL DEFAULT TRUE,
    next_start date,
    last_start date,
    last_finish date,
    error boolean NOT NULL DEFAULT FALSE,
    status_text text,
    UNIQUE ( module, name )
);

` );
    }

    #applySchemaPatch ( dbh, module, version, patch, options ) {
        const action = patch.default;

        if ( !action ) return;

        let res;

        if ( typeof action === "function" ) {
            try {
                res = action( dbh, options );

                if ( res instanceof Promise ) {

                    // prevent unhandled rejection
                    res.catch( () => {} );

                    throw new Error( "SQLite transactions must be synchronous" );
                }

                res = result.try( res, { "allowUndefined": true } );
            }
            catch ( e ) {
                res = result.fromError( e );
            }
        }
        else {
            res = dbh.exec( action );
        }

        if ( !res.ok ) throw result( [ 500, `Error applying patch for module "${ module }", patch "${ version }": ` + res.statusText ] );
    }

    #applySchemaFunctions ( dbh, module, version, patch ) {
        const functions = patch.functions;

        if ( !functions ) return;

        try {
            for ( const name in functions ) {
                dbh.function( name, functions[ name ] );
            }
        }
        catch ( e ) {
            throw result( [ 500, `Error applying functions for module "${ module }", patch "${ version }": ` + e ] );
        }
    }
}
