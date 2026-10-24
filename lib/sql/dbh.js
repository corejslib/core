import "#lib/result";
import ansi from "#lib/ansi";
import Monitoring from "#lib/devel/monitoring";
import { Sql, sql } from "./query.js";

export default class Dbh {

    // public
    queryToString ( query, params ) {
        if ( params && !Array.isArray( params ) ) {
            params = params.params;
        }

        // query object
        if ( query instanceof Sql ) {
            params ||= query.params;

            query = this.isSqlite
                ? query.sqliteQuery
                : query.query;
        }

        params ||= [];

        var length = params.length,
            idx = 0;

        // substitute params
        query = query.replaceAll( "?", () => {
            if ( idx >= length ) throw new RangeError( "SQL number of passed params is less, than number of placeholders in the query" );

            return this.quote( params[ idx++ ] );
        } );

        if ( idx < length ) throw new RangeError( "SQL number of passed params is greater, than number of placeholders in the query" );

        return query;
    }

    async explain ( query, { select = true, analyze, data = false, logData = false } = {} ) {

        // data
        if ( data ) {
            const monitoring = new Monitoring();

            var res = await this[ select
                ? "select"
                : "do" ]( query );

            var mark = monitoring.markSync();

            if ( !res.ok ) {
                console.log( res + "" );

                return res;
            }

            // print data
            if ( logData ) {
                console.log( "Data:" );
                console.log( res.data );
                console.log();
            }
        }

        // explain
        const explainQuery = sql( "EXPLAIN" + ( analyze
            ? " ANALYZE"
            : "" ) ).sql( query );

        const explain = await this.select( explainQuery );

        if ( !explain.ok ) return explain;

        console.log( "Explain:" );

        for ( const row of explain.data ) {
            console.log( row[ "QUERY PLAN" ] );
        }

        if ( data ) {
            console.log();
            console.log( res + "" );
            console.log( res.data?.length, "row(s) selected" );
            console.log( mark + "" );
        }

        return result( 200 );
    }

    // protected
    _onQueryError ( e, query, { meta, silent } = {} ) {
        if ( !silent ) {
            let msg = `SQL erorr: "${ ansi.hl( e.message || e ) }" in${ meta?.where
                ? " " + ansi.hl( meta.where ) + ","
                : "" } query:\n`;

            if ( meta?.position ) {
                msg += query.slice( 0, meta.position - 1 ) + ansi.bold.white.onRed( " ERROR IS HERE -> " ) + query.slice( meta.position - 1 );
            }
            else {
                msg += query;
            }

            if ( e.stack ) msg += "\n" + e.stack;

            console.error( msg );
        }

        return result.exception( [ 500, e.message || e ], null, { "code": meta?.code } );
    }
}
