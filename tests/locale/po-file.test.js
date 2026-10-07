#!/usr/bin/env -S node

import { deepStrictEqual, strictEqual } from "node:assert";
import { suite, test } from "node:test";
import PoFile from "#lib/locale/po-file";

suite( "locale", () => {
    suite( "po file", () => {
        test( "revision date", () => {
            const date = new Date( "2024-01-02T03:04:05.000Z" ),
                poFile = new PoFile( `msgid ""\nmsgstr ""\n"PO-Revision-Date: ${ date.toISOString() }\\n"\n` );

            deepStrictEqual( poFile.revisionDate, date );

            const updatedDate = new Date( "2025-06-07T08:09:10.000Z" );

            poFile.setRevisionDate( updatedDate );

            deepStrictEqual( poFile.revisionDate, updatedDate );
        } );

        test( "invalid revision date", () => {
            const poFile = new PoFile( 'msgid ""\nmsgstr ""\n"PO-Revision-Date: invalid\\n"\n' );

            strictEqual( poFile.revisionDate, undefined );
            strictEqual( poFile.toString().includes( "PO-Revision-Date" ), false );
        } );
    } );
} );
