import Cron from "#lib/cron";
import Events from "#lib/events";
import { sql } from "#lib/sql/query";
import LifecycleManager from "#lib/threads/lifecycle-manager";
import Mutex from "#lib/threads/mutex";

const SQL = {
    "startTask": sql`UPDATE _schema_cron SET last_start = CURRENT_TIMESTAMP, next_start = ? WHERE id = ? AND next_start <= CURRENT_TIMESTAMP`,

    "endTask": sql`UPDATE _schema_cron SET last_finish = CURRENT_TIMESTAMP, error = ?, status_text = ? WHERE id = ?`,
};

export default class DbhCron {
    #dbh;
    #tasks = {};
    #runningTasks = new Set();
    #events;
    #lockedDbh;
    #mutex = new Mutex();
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
    async sync ( dbh, module, meta ) {
        var res;

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
                    res = await dbh.do( sql`INSERT INTO _schema_cron ( module, name, cron, timezone, query, run_missed, next_start ) VALUES ( ?, ?, ?, ?, ?, ?, ? )`, [ module, name, meta.cron[ name ].cron, meta.cron[ name ].timezone, query, runMissed, cron.nextTickDate ] );

                    if ( !res.ok ) return res;
                }

                // update
                else if ( meta.cron[ name ].cron !== index[ name ].cron || meta.cron[ name ].timezone !== index[ name ].timezone || query !== index[ name ].query || runMissed !== Boolean( index[ name ].run_missed ) ) {
                    res = await dbh.do( sql`UPDATE _schema_cron SET cron = ?, timezone = ?, query = ?, run_missed = ?, next_start = ? WHERE id = ?`, [ meta.cron[ name ].cron, meta.cron[ name ].timezone, query, runMissed, cron.nextTickDate, index[ name ].id ] );

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

    async start () {
        return this.#lifecycleManager.start();
    }

    async stop () {
        return this.#lifecycleManager.stop();
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

        // forcibly close locked postgresql connection, running queries will fail
        if ( this.#lockedDbh ) {
            this.#lockedDbh.destroy();

            this.#lockedDbh = null;
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

        if ( data.run_missed && data.next_start && new Date( data.next_start ) <= new Date() ) {
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

            // checks state, catches errors, pairs beginThread / endThread
            await this.#lifecycleManager.runThread( this.#runTaskThread.bind( this, task ) );
        }
        finally {
            this.#runningTasks.delete( id );

            // must be called after the thread is finished
            // remove postgresql advisory lock
            this.#closeConnection();
        }
    }

    async #runTaskThread ( task ) {
        const dbh = await this.#getConnection();

        // locked by other process
        if ( !dbh ) return;

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

    async #getConnection () {

        // postgresql
        if ( this.#dbh.isPostgreSql ) {
            if ( this.#lockedDbh ) return this.#lockedDbh;

            if ( !this.#mutex.tryLock() ) return this.#mutex.wait();

            let dbh = null;

            try {
                dbh = await this.#dbh.createConnection();

                // set postgresql advisory lock
                const res = await dbh.selectRow( sql`SELECT pg_try_advisory_lock( ${ this.#dbh.schema.getLockId( "cron" ) } ) AS locked` );

                if ( res.data?.locked ) {
                    this.#lockedDbh = dbh;
                }

                // already locked in other process
                else {
                    dbh.destroy();

                    dbh = null;
                }
            }
            catch {
                dbh?.destroy();

                dbh = null;
            }
            finally {
                this.#mutex.unlock( dbh );
            }

            return dbh;
        }

        // sqlite
        else {
            return this.#dbh;
        }
    }

    #closeConnection () {
        if ( this.#lifecycleManager.activeThreadsCount ) return;

        // postgresql
        if ( this.#dbh.isPostgreSql && this.#lockedDbh ) {
            this.#lockedDbh.destroy();

            this.#lockedDbh = null;
        }
    }

    async #endTask ( dbh, id, res ) {
        await dbh.do( SQL.endTask, [ !res.ok, res.statusText, id ] );

        return res;
    }
}
