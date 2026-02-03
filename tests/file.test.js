#!/usr/bin/env node

import "#lib/stream";
import { strictEqual } from "node:assert";
import fs from "node:fs";
import { suite, test } from "node:test";
import { TmpFile } from "#lib/tmp";

const CONTENT = "0123456789",
    TESTS = [

        //
        { "start": undefined, "end": undefined },
        { "start": null, "end": null },
        { "start": null, "end": 80 },
        { "start": 3, "end": null },
        { "start": 0, "end": 0 },
        { "start": 0, "end": 1 },
        { "start": 0, "end": 3 },
        { "start": 0, "end": -3 },
        { "start": -7, "end": -3 },
        { "start": -7, "end": -8 },
    ];

suite( "file", () => {
    suite( "slice", () => {
        for ( let n = 0; n < TESTS.length; n++ ) {
            test( n + "", async () => {
                await using file = new TmpFile();

                fs.writeFileSync( file.path, CONTENT );

                const text = await file
                        .slice( {
                            "start": TESTS[ n ].start,
                            "end": TESTS[ n ].end,
                        } )
                        .text(),
                    slice = CONTENT.slice( TESTS[ n ].start ?? undefined, TESTS[ n ].end ?? undefined );

                strictEqual( slice, text );
            } );
        }
    } );

    suite( "stream", () => {
        for ( let n = 0; n < TESTS.length; n++ ) {
            test( n + "", async () => {
                await using file = new TmpFile();

                fs.writeFileSync( file.path, CONTENT );

                const stream = file.stream( {
                        "range": {
                            "start": TESTS[ n ].start,
                            "end": TESTS[ n ].end,
                        },
                    } ),
                    text = await stream.text(),
                    slice = CONTENT.slice( TESTS[ n ].start ?? undefined, TESTS[ n ].end ?? undefined );

                strictEqual( slice.length, stream.size );
                strictEqual( slice, text );
            } );
        }
    } );
} );
