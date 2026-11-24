#!/usr/bin/env -S node

import Browser from "#lib/browser";
import Cli from "#lib/cli";

const CLI = {
    "title": "Install Google Chrome browser",
    "options": {
        "log": {
            "description": "Hide install log",
            "default": true,
            "schema": {
                "type": "boolean",
            },
        },
    },
    "arguments": {
        "products": {
            "description": "Products to install",
            "schema": {
                "type": "array",
                "items": {
                    "enum": [

                        //
                        "chrome-for-testing",
                        "chrome-headless-shell",
                        "dependencies",
                    ],
                },
                "minItems": 1,
                "uniqueItems": true,
            },
        },
    },
};

await Cli.parse( CLI );

const products = new Set( process.cli.arguments.products );

const res = await Browser.installChrome( {
    "chromeForTesting": products.has( "chrome-for-testing" ),
    "chromeHeadlessShell": products.has( "chrome-headless-shell" ),
    "dependencies": products.has( "dependencies" ),
    "log": process.cli.options.log,
} );

if ( !res.ok ) process.exit( 1 );
