#!/usr/bin/env node

import { deepStrictEqual, throws } from "node:assert";
import { suite, test } from "node:test";
import Range from "#lib/range";
import { objectPick } from "#lib/utils";

function createTest ( tests, id ) {
    const name = id + ( tests[ id ].name
        ? "-" + tests[ id ].name
        : "" );

    test( name, () => {
        runTest( tests[ id ] );
    } );
}

function runTest ( test ) {
    if ( test.result ) {
        const range = new Range( test.range ),
            props = objectPick( range, Object.keys( test.result ) );

        deepStrictEqual( props, test.result );
    }
    else {
        throws( () => new Range( test.range ) );
    }
}

suite( "range", () => {
    suite( "validation", () => {
        const properties = {
                "contentLength": { "allowNegative": false },
                "start": { "allowNegative": true },
                "end": { "allowNegative": true },
                "length": { "allowNegative": false },
            },
            tests = [];

        for ( const [ name, { allowNegative } ] of Object.entries( properties ) ) {
            tests.push(
                {
                    "range": { [ name ]: -1 },
                    "result": allowNegative
                        ? {}
                        : null,
                },
                {
                    "range": { [ name ]: 0 },
                    "result": {},
                },
                {
                    "range": { [ name ]: 1 },
                    "result": {},
                }
            );

            for ( const value of [ "string", 1.1, NaN, Infinity ] ) {
                tests.push( {
                    "range": { [ name ]: value },
                    "result": null,
                } );
            }
        }

        for ( let n = 0; n < tests.length; n++ ) {
            createTest( tests, n );
        }
    } );

    suite( "no-content-length", () => {
        const tests = [

            // no content length
            {
                "range": {},
                "result": { "start": 0, "end": undefined, "length": undefined, "maxLength": undefined },
            },
            {
                "range": { "start": 1 },
                "result": { "start": 1, "end": undefined, "length": undefined, "maxLength": undefined },
            },
            {
                "range": { "start": 1, "end": 1 },
                "result": { "start": 1, "end": 1, "length": 0, "maxLength": 0 },
            },
            {
                "range": { "start": 1, "end": 3 },
                "result": { "start": 1, "end": 3, "length": undefined, "maxLength": 2 },
            },
            {
                "range": { "start": 1, "length": 0 },
                "result": { "start": 1, "end": 1, "length": 0, "maxLength": 0 },
            },
            {
                "range": { "start": 1, "length": 3 },
                "result": { "start": 1, "end": 4, "length": undefined, "maxLength": 3 },
            },
            {
                "range": { "start": 10, "end": 5 },
                "result": { "start": 0, "end": 0, "length": 0, "maxLength": 0 },
            },

            // start < 0
            {
                "range": { "start": -10 },
                "result": { "start": -10, "end": undefined, "length": undefined, "maxLength": 10 },
            },
            {
                "range": { "start": -10, "end": 0 },
                "result": { "start": 0, "end": 0, "length": 0, "maxLength": 0 },
            },
            {
                "range": { "start": -10, "end": 15 },
                "result": { "start": -10, "end": 15, "length": undefined, "maxLength": 15 },
            },

            // end < 0
            {
                "range": { "end": -10 },
                "result": { "start": 0, "end": -10, "length": undefined, "maxLength": undefined },
            },
            {
                "range": { "start": 10, "end": -10 },
                "result": { "start": 10, "end": -10, "length": undefined, "maxLength": undefined },
            },

            // start < 0, end < 0
            {
                "range": { "start": -10, "end": -10 },
                "result": { "start": -10, "end": -10, "length": 0, "maxLength": 0 },
            },
            {
                "range": { "start": -10, "end": -5 },
                "result": { "start": -10, "end": -5, "length": undefined, "maxLength": 5 },
            },
            {
                "range": { "start": -10, "end": -15 },
                "result": { "start": 0, "end": 0, "length": 0, "maxLength": 0 },
            },
        ];

        for ( let n = 0; n < tests.length; n++ ) {
            createTest( tests, n );
        }
    } );

    suite( "content-length", () => {
        const tests = [

            // content length
            {
                "range": { "contentLength": 0 },
                "result": { "start": 0, "end": 0, "length": 0, "maxLength": 0 },
            },
            {
                "range": { "contentLength": 10 },
                "result": { "start": 0, "end": 10, "length": 10, "maxLength": 10 },
            },
            {
                "range": { "contentLength": 100, "start": -10 },
                "result": { "start": 90, "end": 100, "length": 10, "maxLength": 10 },
            },
            {
                "range": { "contentLength": 100, "end": -10 },
                "result": { "start": 0, "end": 90, "length": 90, "maxLength": 90 },
            },
            {
                "range": { "contentLength": 100, "start": -50, "end": -10 },
                "result": { "start": 50, "end": 90, "length": 40, "maxLength": 40 },
            },
            {
                "range": { "contentLength": 100, "start": -50, "end": -60 },
                "result": { "start": 0, "end": 0, "length": 0, "maxLength": 0 },
            },
            {
                "range": { "contentLength": 100, "start": -500, "end": -60 },
                "result": { "start": 0, "end": 40, "length": 40, "maxLength": 40 },
            },
            {
                "range": { "contentLength": 100, "start": 20, "end": 160 },
                "result": { "start": 20, "end": 100, "length": 80, "maxLength": 80 },
            },
            {
                "range": { "contentLength": 100, "start": 120, "end": 20 },
                "result": { "start": 0, "end": 0, "length": 0, "maxLength": 0 },
            },
        ];

        for ( let n = 0; n < tests.length; n++ ) {
            createTest( tests, n );
        }
    } );

    suite( "strict", () => {
        const tests = [

            // no content length
            {
                "range": { "satisfiable": true, "start": -5, "end": -10 },
                "result": null,
            },
            {
                "range": { "satisfiable": true, "start": 10, "end": 5 },
                "result": null,
            },

            // has content length
            {
                "range": { "satisfiable": true, "contentLength": 100, "start": -5, "end": -10 },
                "result": null,
            },

            // boundaries
            {
                "range": { "strictBoundaries": true, "contentLength": 100, "start": 110, "end": 500 },
                "result": null,
            },
            {
                "range": { "strictBoundaries": true, "contentLength": 10, "start": 5, "end": 100 },
                "result": null,
            },
            {
                "range": { "strictBoundaries": true, "contentLength": 10, "start": -50, "end": 5 },
                "result": null,
            },
        ];

        for ( let n = 0; n < tests.length; n++ ) {
            createTest( tests, n );
        }
    } );

    suite( "inclusive", () => {
        const tests = [

            // no content length
            {
                "range": { "end": null, "inclusive": true },
                "result": { "end": undefined },
            },
            {
                "range": { "end": 0, "inclusive": true },
                "result": { "end": 1 },
            },
            {
                "range": { "end": 10, "inclusive": true },
                "result": { "end": 11 },
            },
            {
                "range": { "end": -1, "inclusive": true },
                "result": { "end": undefined },
            },
            {
                "range": { "end": -10, "inclusive": true },
                "result": { "end": -9 },
            },

            // content length
            {
                "range": { "contentLength": 10, "end": null, "inclusive": true },
                "result": { "end": 10 },
            },
            {
                "range": { "contentLength": 10, "end": 0, "inclusive": true },
                "result": { "end": 1 },
            },
            {
                "range": { "contentLength": 100, "end": 10, "inclusive": true },
                "result": { "end": 11 },
            },
            {
                "range": { "contentLength": 10, "end": -1, "inclusive": true },
                "result": { "end": 10 },
            },
            {
                "range": { "contentLength": 10, "end": -10, "inclusive": true },
                "result": { "end": 1 },
            },
            {
                "range": { "contentLength": 10, "end": -11, "inclusive": true },
                "result": { "end": 0 },
            },
            {
                "range": { "contentLength": 100, "end": -10, "inclusive": true },
                "result": { "end": 91 },
            },
        ];

        for ( let n = 0; n < tests.length; n++ ) {
            createTest( tests, n );
        }
    } );

    suite( "inclusive-end", () => {
        const tests = [

            // no content length
            {
                "range": { "end": null },
                "result": { "inclusiveEnd": undefined },
            },
            {
                "range": { "end": 0 },
                "result": { "inclusiveEnd": -1 },
            },
            {
                "range": { "end": 10 },
                "result": { "inclusiveEnd": 9 },
            },
            {
                "range": { "end": -1 },
                "result": { "inclusiveEnd": -1 },
            },
            {
                "range": { "start": 10, "end": -1 },
                "result": { "inclusiveEnd": -1 },
            },
            {
                "range": { "start": -10, "end": -5 },
                "result": { "inclusiveEnd": -1 },
            },
            {
                "range": { "start": -10, "end": 5 },
                "result": { "inclusiveEnd": -1 },
            },

            // content length
            {
                "range": { "contentLength": 10, "end": 0 },
                "result": { "inclusiveEnd": -1 },
            },
            {
                "range": { "contentLength": 10, "end": 10 },
                "result": { "inclusiveEnd": 9 },
            },
            {
                "range": { "contentLength": 10, "end": -10 },
                "result": { "inclusiveEnd": -1 },
            },
            {
                "range": { "contentLength": 10, "end": -100 },
                "result": { "inclusiveEnd": -1 },
            },
            {
                "range": { "contentLength": 10, "end": -1 },
                "result": { "inclusiveEnd": 8 },
            },
            {
                "range": { "contentLength": 10, "start": 5, "end": 5 },
                "result": { "inclusiveEnd": -1 },
            },
        ];

        for ( let n = 0; n < tests.length; n++ ) {
            createTest( tests, n );
        }
    } );
} );
