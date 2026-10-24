import Dbh from "#lib/sql/dbh";
import PostgreSql from "#lib/sql/dbh/postgresql";
import SqLite from "#lib/sql/dbh/sqlite";
import { sql } from "#lib/sql/query";

Object.defineProperty( sql, "new", {
    "configurable": false,
    "writable": false,
    "value": function ( url, options ) {
        if ( url instanceof Dbh ) return url;

        let Class;

        if ( url instanceof URL ) {
            if ( url.protocol === "postgresql:" || url.protocol === "postgresql+tls:" ) {
                Class = PostgreSql;
            }
            else {
                Class = SqLite;
            }
        }
        else if ( url.startsWith( "postgresql:" ) || url.startsWith( "postgresql+tls:" ) ) {
            Class = PostgreSql;
        }
        else {
            Class = SqLite;
        }

        return new Class( url, options );
    },
} );

export default sql;
