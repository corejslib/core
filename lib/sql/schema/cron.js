import Cron from "#lib/cron";
import Events from "#lib/events";
import { sql } from "#lib/sql/query";
import LifecycleManager from "#lib/threads/lifecycle-manager";

const SQL = {
    "insertTask": sql`
INSERT INTO
    _schema_cron
    (
        module,
        name,
        cron,
        timezone,
        query,
        run_missed,
        next_start
    )
VALUES
        ( ?, ?, ?, ?, ?, ?, ? )
`,

    "updateTask": sql`
UPDATE
    _schema_cron
SET
    cron = ?,
    timezone = ?,
    query = ?,
    run_missed = ?,
    next_start = ?
WHERE
    id = ?
`,

    "startTask": sql`UPDATE _schema_cron SET last_start = CURRENT_TIMESTAMP, next_start = ? WHERE id = ? AND next_start <= CURRENT_TIMESTAMP`,

    "endTask": sql`UPDATE _schema_cron SET last_finish = CURRENT_TIMESTAMP, error = ?, status_text = ? WHERE id = ?`,
};

export default class SqlSchemaCron {
    #dbh;
    #tasks = {};
    #runningTasks = new Set();
    #events;
    #taskConnections = new Set();
    #lifecycleManager;

    constructor ( dbh ) {
        this.#dbh = dbh;

        this.#lifecycleManager = new LifecycleManager( {
            "onStart": this.#start.bind( this ),
            "onStop": this.#stop.bind( this ),
            "onDestroyThreads": this.#destroyThreads.bind( this ),
        } );
    }

    // public
    async start () {
        return this.#lifecycleManager.start();
    }

    async stop () {
        return this.#lifecycleManager.stop();
    }

    async sync ( dbh, module, meta ) {
        let res;

        res = await dbh.select( sql`SELECT * FROM _schema_cron WHERE module = ?`.decode( { "query": String } ), [ module ] );
        if ( !res.ok ) return res;

        const index = {};

        if ( res.data ) {
            for ( const row of res.data ) {
                index[ row.name ] = row;
            }
        }

        if ( meta.cron ) {
            for ( const name in meta.cron ) {
                const query = JSON.stringify( Array.isArray( meta.cron[ name ].query )
                        ? meta.cron[ name ].query
                        : [ meta.cron[ name ].query ] ),
                    runMissed = Boolean( meta.cron[ name ].runMissed ?? true ),
                    cron = new Cron( meta.cron[ name ].cron, {
                        "timezone": meta.cron[ name ].timezone,
                    } );

                // insert
                if ( !index[ name ] ) {
                    res = await dbh.do( SQL.insertTask, [

                        //
                        module,
                        name,
                        cron.expression,
                        cron.timezone,
                        query,
                        runMissed,
                        cron.nextTickDate,
                    ] );

                    if ( !res.ok ) return res;
                }

                // update
                else if ( meta.cron[ name ].cron !== index[ name ].cron || meta.cron[ name ].timezone !== index[ name ].timezone || query !== index[ name ].query || runMissed !== Boolean( index[ name ].run_missed ) || !index[ name ].next_start ) {
                    res = await dbh.do( SQL.updateTask, [

                        //
                        cron.expression,
                        cron.timezone,
                        query,
                        runMissed,
                        cron.nextTickDate,
                        index[ name ].id,
                    ] );

                    if ( !res.ok ) return res;
                }

                delete index[ name ];
            }
        }

        const toDelete = Object.keys( index ).map( name => index[ name ].id );

        if ( toDelete.length ) {
            res = await dbh.do( sql`DELETE FROM _schema_cron WHERE id`.IN( toDelete ) );

            if ( !res.ok ) return res;
        }

        return res;
    }

    // private
    async #start ( signal ) {
        const res = await this.#dbh.select( sql`SELECT id, cron, timezone, query, run_missed, next_start FROM _schema_cron` );
        if ( !res.ok ) return res;

        // stopped while the query was running, nothing to clean up yet
        if ( signal.aborted ) return result( [ 500, "Aborted" ] );

        try {
            if ( this.#dbh.isPostgreSql ) {
                this.#events = new Events()
                    .link( this.#dbh )
                    .on( "_schema_cron/update", this.#addTask.bind( this ) )
                    .on( "_schema_cron/delete", data => this.#deleteTask( data.id ) );
            }

            if ( res.data ) {
                for ( const row of res.data ) {
                    this.#addTask( row );
                }
            }
        }
        catch ( e ) {

            // rollback, the manager does not call onStop if start failed
            this.#clear();

            throw e;
        }

        return result( 200 );
    }

    async #stop () {
        this.#clear();
    }

    #destroyThreads () {
        const connections = [ ...this.#taskConnections ];

        // forcibly close connections of running tasks, running queries will fail
        for ( const dbh of connections ) {
            dbh.destroy();
        }
    }

    #clear () {
        if ( this.#events ) {
            this.#events.clear();

            this.#events = null;
        }

        for ( const id of Object.keys( this.#tasks ) ) {
            this.#deleteTask( id );
        }
    }

    #addTask ( data ) {
        const id = data.id,
            queries = ( typeof data.query === "string"
                ? JSON.parse( data.query )
                : data.query ).map( query => sql( query ) );

        let task = this.#tasks[ id ];

        // schedule is not changed, update queries only
        if ( task && task.schedule === data.cron && task.timezone === data.timezone ) {
            task.queries = queries;
        }
        else {
            this.#deleteTask( id );

            task = {
                id,
                "schedule": data.cron,
                "timezone": data.timezone,
                "cron": new Cron( data.cron, { "timezone": data.timezone } ).on( "tick", () => this.#runTask( id ) ),
                queries,
            };

            this.#tasks[ id ] = task;

            task.cron.start();
        }

        if ( data.run_missed && data.next_start && Temporal.Instant.compare( Temporal.Instant.from( data.next_start ), Temporal.Now.instant() ) <= 0 ) {
            this.#runTask( id );
        }
    }

    #deleteTask ( id ) {
        const task = this.#tasks[ id ];

        if ( !task ) return;

        task.cron.stop();

        delete this.#tasks[ id ];
    }

    async #runTask ( id ) {
        const task = this.#tasks[ id ];

        if ( !task || this.#runningTasks.has( id ) ) return;

        this.#runningTasks.add( id );

        try {
            await this.#lifecycleManager.runThread( this.#runTaskThread.bind( this, task ) );
        }
        finally {
            this.#runningTasks.delete( id );
        }
    }

    async #runTaskThread ( task ) {

        // postgresql, every task has its own connection, which is destroyed when the task is finished
        if ( this.#dbh.isPostgreSql ) {
            return this.#dbh.createConnection( async dbh => {

                // connection can't be created, because the pool is stopped
                if ( !dbh ) return;

                this.#taskConnections.add( dbh );

                try {
                    await this.#execTask( dbh, task );
                }
                finally {
                    this.#taskConnections.delete( dbh );
                }
            } );
        }

        // sqlite
        return this.#execTask( this.#dbh, task );
    }

    async #execTask ( dbh, task ) {
        let res;

        try {

            // start task
            res = await dbh.do( SQL.startTask, [ task.cron.nextTickDate, task.id ] );
            if ( !res.ok ) throw res;

            // task is already started by other process
            if ( !res.meta.rows ) return;

            for ( const query of task.queries ) {
                res = await dbh.exec( query );

                if ( !res.ok ) throw res;
            }
        }
        catch ( e ) {
            res = Error.isError( e )
                ? result( [ 500, e.message ] )
                : e;
        }

        // end task
        await this.#endTask( dbh, task.id, res );
    }

    async #endTask ( dbh, id, res ) {
        await dbh.do( SQL.endTask, [ !res.ok, res.statusText, id ] );

        return res;
    }
}
