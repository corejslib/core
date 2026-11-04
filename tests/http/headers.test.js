#!/usr/bin/env -S node

import { deepStrictEqual } from "node:assert";
import { suite, test } from "node:test";
import { instantToHttpDate } from "#lib/dates";
import Headers from "#lib/http/headers";

const TESTS = [

    // accept-encoding
    {
        "headers": {
            "accept-encoding": "br;q=0.1, deflate, gzip;q=1.0, *;q=0.5    ",
        },
        "result": headers => {
            deepStrictEqual(
                headers.acceptEncoding.encodings,
                new Set( [

                    //
                    "deflate",
                    "gzip",
                    "*",
                    "br",
                ] )
            );
        },
    },

    // cookie
    {
        "headers": {
            "cookie": `a="1"; b = ccc ; c=  "1=2 3"   `,
        },
        "result": headers => {
            const cookies = {};

            for ( const cookie of Object.values( headers.cookie.cookies ) ) {
                cookies[ cookie.name ] = cookie.value;
            }

            deepStrictEqual(
                {
                    "a": `"1"`,
                    "b": "ccc",
                    "c": `"1=2 3"`,
                },
                cookies
            );
        },
    },

    // set-cookie
    {
        "headers": {
            "set-cookie": `name=value; expires=${ instantToHttpDate( Temporal.Instant.fromEpochMilliseconds( 1000 ) ) }; path=/  ; domain = .мама.google.com  ;Secure; HttpOnly; SameSite=none`,
        },
        "result": headers => {
            const cookies = headers.setCookie.cookies.map( cookie => cookie.toJSON() );

            deepStrictEqual(
                [
                    {
                        "name": "name",
                        "value": "value",
                        "maxAge": undefined,
                        "expires": Temporal.Instant.fromEpochMilliseconds( 1000 ),
                        "path": "/",
                        "domain": "xn--80aa8ab.google.com",
                        "secure": true,
                        "httpOnly": true,
                        "sameSite": "none",
                        "partitioned": false,
                    },
                ],
                cookies
            );
        },
    },

    // www-authenticate
    {
        "headers": {
            "www-authenticate": `Digest realm="Test realm, \\"with\\" comma -- мама",   uri    =  "/"   , qop="auth, auth-int", algorithm=SHA-256   , nonce="7ypf/xlj9XXwfDPEoM4URrv/xwf94BcCAzFZH4GiTo0v", opaque = "FQhe/qaU925kfnzjCev0ciny7QMkPqMAFRtzCUYo5tdS"    `,
        },
        "result": headers => {
            const header = headers.wwwAuthenticate;

            deepStrictEqual(
                {
                    "scheme": header.scheme,
                    "realm": header.realm,
                    "uri": header.uri,
                    "qop": header.qop,
                    "algorithm": header.algorithm,
                    "nonce": header.nonce,
                    "opaque": header.opaque,
                },
                {
                    "scheme": "digest",
                    "realm": `Test realm, "with" comma -- мама`,
                    "uri": "/",
                    "qop": "auth, auth-int",
                    "algorithm": "SHA-256",
                    "nonce": "7ypf/xlj9XXwfDPEoM4URrv/xwf94BcCAzFZH4GiTo0v",
                    "opaque": "FQhe/qaU925kfnzjCev0ciny7QMkPqMAFRtzCUYo5tdS",
                }
            );
        },
    },

    // content-disposition
    {
        "headers": {
            "content-disposition": `   form-data  ;    name = "file \\%22 ---"  ; filename = "тест-%22-;-.txt" ; fake1; fake2 = 234  `,
        },
        "result": headers => {
            const header = headers.contentDisposition;

            deepStrictEqual(
                {
                    "type": header.type,
                    "name": header.name,
                    "filename": header.filename,
                },
                {
                    "type": "form-data",
                    "name": `file \\" ---`,
                    "filename": 'тест-"-;-.txt',
                }
            );
        },
    },

    // if-match
    {
        "headers": {
            "if-match": `   W/"sdds" , " dd,;dd ", W/wew; w"we"w, aaa","bbb  `,
        },
        "result": headers => {
            deepStrictEqual(
                [ ...headers.ifMatch.etags ],
                [

                    //
                    `W/"sdds"`,
                    `" dd,;dd "`,
                    `W/wew; w"we"w`,
                    `aaa","bbb`,
                ]
            );
        },
    },

    // range
    {
        "headers": {
            "range": " bytes = 2-3 , 4- , -33  ",
        },
        "result": headers => {
            deepStrictEqual( headers.range.ranges?.toHttpRange(), "2-3,4-,-33" );
        },
    },

    // content-type
    {
        "headers": {
            "content-type": `  text/plain  ; boundary="----aaa"  ; charset="UTF8"  `,
        },
        "result": headers => {
            const header = headers.contentType;

            deepStrictEqual(
                {
                    "type": header.type,
                    "charset": header.charset,
                    "boundary": header.boundary,
                },
                {
                    "type": "text/plain",
                    "charset": "utf8",
                    "boundary": "----aaa",
                }
            );
        },
    },
];

suite( "http", () => {
    suite( "headers", () => {
        for ( let n = 0; n < TESTS.length; n++ ) {
            const _test = TESTS[ n ],
                id = `${ n }`;

            test( `${ id }`, () => {
                const headers = new Headers( _test.headers );

                _test.result( headers );
            } );
        }
    } );
} );
