import "#lib/result";
import ansi from "#lib/ansi";
import Monitoring from "#lib/devel/monitoring";
import prepareQuery from "./prepare-query.js";
import { Sql, sql } from "./query.js";

export default class Dbh {

    // public
    queryToString ( query, params ) {

        // params is object
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

        return prepareQuery( this.isSqlite
            ? "sqlite"
            : "postgresql", query, params, this.quote.bind( this ) );
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
            let msg = `SQL erorr: "${ ansi.hl( e.message || e ) }"\nquery: `;

            query = query.trim();

            if ( meta?.position ) {
                msg += query.slice( 0, meta.position - 1 ) + ansi.bold.white.onRed( " ERROR IS HERE -> " ) + query.slice( meta.position - 1 );
            }
            else {
                msg += query;
            }

            if ( meta?.where ) {
                msg += "\nwhere: " + ansi.hl( meta.where.trim() );
            }

            if ( e.stack ) {
                msg += "\n" + e.stack;
            }

            console.error( msg );
        }

        return result.exception( [ 500, e.message || e ], null, { "code": meta?.code } );
    }
}
