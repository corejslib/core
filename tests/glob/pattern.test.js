#!/usr/bin/env -S node

import { strictEqual } from "node:assert";
import { suite, test } from "node:test";
import GlobPattern from "#lib/glob/pattern";

function testPattern ( tests ) {
    for ( let n = 0; n < tests.length; n++ ) {
        test( n + "", () => {
            const pattern = new GlobPattern( ...( Array.isArray( tests[ n ].pattern )
                ? tests[ n ].pattern
                : [ tests[ n ].pattern ] ) );

            const res = tests[ n ].test( pattern );

            strictEqual( res, tests[ n ].result );
        } );
    }
}

function runTests ( tests ) {
    for ( const item of tests ) {
        if ( !Array.isArray( item.pattern ) ) {
            item.pattern = [ item.pattern ];
        }

        let id = item.pattern[ 0 ];

        if ( item.pattern[ 1 ] ) {
            for ( const name in item.pattern[ 1 ] ) {
                id += `,${ name }=${ item.pattern[ 1 ][ name ] }`;
            }
        }

        const pattern = new GlobPattern( ...item.pattern );

        for ( const expected of [ false, true ] ) {
            if ( !item[ expected ] ) continue;

            for ( const value of item[ expected ] ) {
                test( `${ id },${ value }`, () => {
                    const actual = pattern.test( value );

                    strictEqual( actual, expected, `Pattern: ${ pattern.pattern }, value: ${ value }` );
                } );
            }
        }
    }
}

suite( "glob-pattern", () => {
    suite( "static", () => {
        const tests = [
            {
                "pattern": [ "path" ],
                "test": pattern => pattern.test( "PATH", { "ignoreCase": true } ),
                "result": true,
            },
            {
                "pattern": [ "path" ],
                "test": pattern => pattern.test( "PATH", { "ignoreCase": false } ),
                "result": false,
            },
            {
                "pattern": [ "aaa/bbb" ],
                "test": pattern => pattern.test( "aaa/bbb", { "ignoreCase": false } ),
                "result": true,
            },

            // prefix, normalize
            {
                "pattern": [ "aaa/ccc///aaa/bbb" ],
                "test": pattern => {
                    return pattern.test( "aaa/bbb", {
                        "prefix": "aaa/bbb/../ccc//",
                        "normalize": true,
                        "ignoreCase": false,
                    } );
                },
                "result": true,
            },
        ];

        testPattern( tests );
    } );

    suite( "star", () => {
        const tests = [
            {
                "pattern": [ "*" ],
                "true": [ "a" ],
                "false": [ "", "/a/" ],
            },
            {
                "pattern": [ "/*" ],
                "true": [ "/a" ],
                "false": [ "", "/a/" ],
            },
            {
                "pattern": [ "/*/" ],
                "true": [ "/a/" ],
                "false": [ "", "/a" ],
            },
            {
                "pattern": [ "a*b" ],
                "true": [ "ab", "a1b", "a12b" ],
                "false": [ "" ],
            },
        ];

        runTests( tests );
    } );

    suite( "globstar-**", () => {
        const tests = [

            // `**`
            {
                "pattern": [ "**" ],
                "true": [ "/", "/a", "/a/", "/a/b", "/a/b/", "a", "a/", "a/b", "a/b/" ],
                "false": [ "" ],
            },

            // `**` with prefix `/`
            {
                "pattern": [ "**", { "prefix": "/" } ],
                "true": [ "/-a", "/a", "/a/", "/a/b" ],
                "false": [ "", "/", "a", "a/", "a/b", "a/b/" ],
            },

            // `**` with prefix `/prefix`
            {
                "pattern": [ "**", { "prefix": "/prefix" } ],
                "true": [ "/prefix/a", "/prefix/a/", "/prefix/a/b", "/prefix/a/b/" ],
                "false": [ "", "/", "/prefix", "/prefix/", "/prefix-a" ],
            },
        ];

        runTests( tests );
    } );

    suite( "globstar-**/", () => {
        const tests = [
            {
                "pattern": [ "**/" ],
                "true": [ "/", "/a/", "/a/b/", "a/", "a/b/" ],
                "false": [ "", "/a", "/a/b", "a", "a/b" ],
            },
            {
                "pattern": [ "**/a/b" ],
                "true": [ "/a/b", "a/b" ],
                "false": [ "", "/", "/a", "/a/", "/a/b/", "a", "a/", "a/b/" ],
            },
            {
                "pattern": [ "**/", { "prefix": "/" } ],
                "true": [ "/a/", "/a/b/" ],
                "false": [ "", "/", "/-a", "/a", "/a/b", "a", "a/", "a/b", "a/b/" ],
            },
            {
                "pattern": [ "**/", { "prefix": "/prefix" } ],
                "true": [ "/prefix/a/", "/prefix/a/b/" ],
                "false": [ "", "/", "/prefix/", "/prefix", "/prefix-a", "/prefix/a", "/prefix/a/b" ],
            },
        ];

        runTests( tests );
    } );

    suite( "globstar-/**", () => {
        const tests = [
            {
                "pattern": [ "/**" ],
                "true": [ "/", "/a", "/a/", "/a/b", "/a/b/" ],
                "false": [ "", "a", "a/", "a/b", "a/b/" ],
            },
            {
                "pattern": [ "a/b/**" ],
                "true": [ "a/b", "a/b/" ],
                "false": [ "", "/", "/a", "/a/", "/a/b", "/a/b/", "a", "a/" ],
            },
            {
                "pattern": [ "/**", { "prefix": "/" } ],
                "true": [ "/-a", "/a", "/a/", "/a/b", "/a/b/" ],
                "false": [ "", "/", "a", "a/", "a/b", "a/b/" ],
            },
            {
                "pattern": [ "/**", { "prefix": "/prefix" } ],
                "true": [ "/prefix/a", "/prefix/a/", "/prefix/a/b", "/prefix/a/b/" ],
                "false": [ "", "/", "/prefix/", "/prefix", "/prefix-a" ],
            },
        ];

        runTests( tests );
    } );

    suite( "globstar-/**/", () => {
        const tests = [
            {
                "pattern": [ "/**/" ],
                "true": [ "/a/b/" ],
                "false": [ "", "/", "/a", "/a/b", "a", "a/b", "a/b/" ],
            },
            {
                "pattern": [ "/**/", { "prefix": "prefix" } ],
                "true": [ "prefix/a/", "prefix/a/b/" ],
                "false": [ "", "/", "prefix", "prefix/", "prefix/a", "prefix/a/b" ],
            },
            {
                "pattern": [ "a/**/" ],
                "true": [ "a/b/" ],
                "false": [ "a/", "a/b" ],
            },
            {
                "pattern": [ "a/**/", { "prefix": "prefix" } ],
                "true": [ "prefix/a/b/" ],
                "false": [ "prefix/a/", "prefix/a/b" ],
            },
            {
                "pattern": [ "a/**/b" ],
                "true": [ "a/b", "a/1/2/b" ],
                "false": [ "a/", "a/b/" ],
            },
            {
                "pattern": [ "a/**/b", { "prefix": "prefix" } ],
                "true": [ "prefix/a/b", "prefix/a/1/2/b" ],
                "false": [ "prefix/a/", "prefix/a/b/" ],
            },
        ];

        runTests( tests );
    } );

    suite( "directories", () => {
        const tests = [
            {
                "pattern": [ "a" ],
                "true": [ "a" ],
                "false": [ "a/" ],
            },
            {
                "pattern": [ "a/" ],
                "true": [ "a/" ],
                "false": [ "a" ],
            },
            {
                "pattern": [ "**" ],
                "true": [ "a", "a/" ],
                "false": [],
            },
            {
                "pattern": [ "**/" ],
                "true": [ "a/" ],
                "false": [ "a" ],
            },
        ];

        runTests( tests );
    } );

    suite( "other", () => {
        const tests = [
            {
                "pattern": [ "a*b", { "allowBraces": true } ],
                "test": pattern => pattern.regexp.source,
                "result": String.raw`^a[^\/]*b$`,
            },
            {
                "pattern": [ "*{a,\\*b}", { "allowBraces": true } ],
                "test": pattern => pattern.regexp.source,
                "result": String.raw`^(?:[^\/]*a|[^\/]*\*b)$`,
            },
        ];

        testPattern( tests );
    } );
} );
