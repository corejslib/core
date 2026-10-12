#!/usr/bin/env -S node

import path from "node:path";
import { pipeline } from "node:stream/promises";
import Cli from "#lib/cli";
import { readConfig } from "#lib/config";
import ExternalResourceBuilder from "#lib/external-resource-builder";
import Uws from "#lib/external-resources/uws";
import fetch from "#lib/fetch";
import { globSync } from "#lib/fs";
import tar from "#lib/tar";
import { TmpDir } from "#lib/tmp";

const UWS_VERSION = "20.71.0",
    ARCHITECTURES = new Set( [ "x64" ] );

const CLI = {
    "title": "Build resources",
    "options": {
        "force": {
            "description": "force build",
            "default": false,
            "schema": {
                "type": "boolean",
            },
        },
    },
};

await Cli.parse( CLI );

const uwsUrl = `https://github.com/uNetworking/uWebSockets.js/archive/refs/tags/v${ UWS_VERSION }.tar.gz`,
    tmp = new TmpDir();

const res = await fetch( uwsUrl );
if ( !res.ok ) throw res;

// download and unpack
await pipeline(
    res.body,
    tar.extract( {
        "cwd": tmp.path,
        "strip": 1,
    } )
);

const meta = { "uws": "v" + ( await readConfig( tmp.path + "/package.json" ) ).version },
    resources = [];

for ( const file of globSync( "*.node", { "cwd": tmp.path } ) ) {
    const [ platform, architecture, node ] = path.basename( file ).replace( "uws_", "" ).replace( ".node", "" ).split( "_", 3 );

    if ( !ARCHITECTURES.has( architecture ) ) continue;

    const resource = new Uws(
        tmp.path + "/" + file,
        {
            node,
            platform,
            architecture,
        },
        meta
    );

    resources.push( resource );
}

if ( resources.length ) {
    const res = await ExternalResourceBuilder.build( resources, { "force": process.cli.options.force } );

    if ( !res.ok ) process.exit( 1 );
}
