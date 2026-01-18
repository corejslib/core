import { sql } from "#lib/sql/query";
import uuid from "#lib/uuid";

const SQL = {
    "begin": sql`BEGIN`.prepare(),
    "commit": sql`COMMIT`.prepare(),
    "rollback": sql`ROLLBACK`.prepare(),
};

export default Super =>
    class TransactionsSync extends ( Super || class {} ) {

        // public
        begin ( callback, { mode } = {} ) {
            const dbh = this,
                savepointId = dbh.inTransaction
                    ? uuid()
                    : null;

            const begin = mode
                ? "BEGIN " + mode
                : SQL.begin;

            // start transaction
            var res = dbh.do( savepointId
                ? `SAVEPOINT "${ savepointId }"`
                : begin );

            // transaction started
            if ( res.ok ) {
                try {

                    // call transaction body
                    res = callback( dbh );

                    if ( res instanceof Promise ) throw new Error( "SQLite transactions must be synchronous" );

                    res = result.try( res, { "allowUndefined": true } );
                }
                catch ( e ) {
                    res = result.catch( e );
                }

                // commit
                if ( res.ok ) {
                    const commitRes = dbh.do( savepointId
                        ? `RELEASE SAVEPOINT "${ savepointId }"`
                        : SQL.commit );

                    // commit failed
                    if ( !commitRes.ok ) {
                        res = commitRes;
                    }
                }

                // rollback
                else {
                    dbh.do( savepointId
                        ? `ROLLBACK TO SAVEPOINT "${ savepointId }"`
                        : SQL.rollback );
                }
            }

            return res;
        }
    };
