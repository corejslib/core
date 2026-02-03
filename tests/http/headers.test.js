#!/usr/bin/env node

import { deepStrictEqual } from "node:assert";
import { suite, test } from "node:test";
import Headers from "#lib/http/headers";
import { toKebabCase } from "#lib/naming-conventions";

const TESTS = [

    // accept-encoding
    {
        "headers": {
            "accept-encoding": "br;q=0.1, deflate, gzip;q=1.0, *;q=0.5    ",
        },
        "method": "acceptEncoding",
        "result": new Set( [ "deflate", "gzip", "*", "br" ] ),
    },

    // cookie
    {
        "headers": {
            "cookie": "a=1; b = 2 ; c=  1=2 3   ",
        },
        "method": "cookie",
        result ( res ) {
            for ( const name in res ) res[ name ] = res[ name ].value;

            deepStrictEqual(
                {
                    "a": "1",
                    "b": "2",
                    "c": "1=2 3",
                },
                res
            );
        },
    },

    // set-cookie
    {
        "headers": {
            "set-cookie": `name=value; expires=${ new Date( 1000 ).toUTCString() }; path=/  ; domain = .мама.google.com  ;Secure; HttpOnly; SameSite=none`,
        },
        "method": "setCookie",
        result ( res ) {
            res = res.map( cookie => cookie.toJSON() );

            deepStrictEqual(
                [
                    {
                        "name": "name",
                        "value": "value",
                        "maxAge": undefined,
                        "expires": new Date( 1000 ),
                        "path": "/",
                        "domain": "xn--80aa8ab.google.com",
                        "secure": true,
                        "httpOnly": true,
                        "sameSite": "none",
                        "partitioned": false,
                    },
                ],
                res
            );
        },
    },

    // www-authenticate
    {
        "headers": {
            "www-authenticate": `Digest realm="Test realm, with comma",   uri    =  "/"   , qop="auth, auth-int", algorithm=SHA-256   , nonce="7ypf/xlj9XXwfDPEoM4URrv/xwf94BcCAzFZH4GiTo0v", opaque = "FQhe/qaU925kfnzjCev0ciny7QMkPqMAFRtzCUYo5tdS"    `,
        },
        "method": "wwwAuthenticate",
        "result": {
            "scheme": "digest",
            "realm": "Test realm, with comma",
            "uri": "/",
            "qop": "auth, auth-int",
            "algorithm": "SHA-256",
            "nonce": "7ypf/xlj9XXwfDPEoM4URrv/xwf94BcCAzFZH4GiTo0v",
            "opaque": "FQhe/qaU925kfnzjCev0ciny7QMkPqMAFRtzCUYo5tdS",
        },
    },

    // content-disposition
    {
        "headers": {
            "content-disposition": `   form-data  ;    name = file  ; filename = "${ Buffer.from( "тест" ).toString( "binary" ) }-%22-;-.txt" ; fake1; fake2 = 234  `,
        },
        "method": "contentDisposition",
        "result": {
            "type": "form-data",
            "name": "file",
            "filename": `тест-"-;-.txt`,
        },
    },
];

suite( "http", () => {
    suite( "headers", () => {
        for ( let n = 0; n < TESTS.length; n++ ) {
            const _test = TESTS[ n ],
                id = `${ n }-${ toKebabCase( _test.method ) }`;

            test( `${ id }`, () => {
                const headers = new Headers( _test.headers );

                const res = typeof headers[ _test.method ] === "function"
                    ? headers[ _test.method ]()
                    : headers[ _test.method ];

                // console.log( "expected:", JSON.stringify( _test.result, null, 4 ) );
                // console.log( "result:", JSON.stringify( res, null, 4 ) );

                if ( typeof _test.result === "function" ) {
                    _test.result( res );
                }
                else {
                    deepStrictEqual( res, _test.result );
                }
            } );
        }
    } );
} );
