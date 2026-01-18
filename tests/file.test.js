#!/usr/bin/env node

import "#lib/stream";
import { strictEqual } from "node:assert";
import fs from "node:fs";
import { suite, test } from "node:test";
import { TmpFile } from "#lib/tmp";

suite( "file", () => {
    suite( "stream", () => {
        const file = new TmpFile(),
            content = "0123456789";

        fs.writeFileSync( file.path, content );

        const TESTS = [

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

        for ( let n = 0; n < TESTS.length; n++ ) {
            test( n + "", async () => {
                const stream = file.stream( {
                        "range": {
                            "start": TESTS[ n ].start,
                            "end": TESTS[ n ].end,
                        },
                    } ),
                    text = await stream.text(),
                    slice = content.slice( TESTS[ n ].start ?? undefined, TESTS[ n ].end ?? undefined );

                strictEqual( slice.length, stream.size );
                strictEqual( slice, text );
            } );
        }
    } );
} );
