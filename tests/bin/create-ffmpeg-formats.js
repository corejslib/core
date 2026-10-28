#!/usr/bin/env -S node

import childProcess from "node:child_process";
import { writeConfig } from "#lib/config";
import externalResources from "#lib/external-resources";

const FFMPEG_RESOURCE = await externalResources.add( `corejslib/core/resources/ffmpeg-${ process.platform }` ).check(),
    FFMPEG_EXECUTABLE_PATH = FFMPEG_RESOURCE.getResourcePath( "bin/ffmpeg" + ( process.platform === "win32"
        ? ".exe"
        : "" ) );

const formats = getFormats();

await writeConfig( "ffmpeg-formats.json", formats, {
    "readable": true,
} );

function getFormats () {
    const formats = {},
        data = execFfmpeg( "-formats" );

    for ( const line of data.split( /\r?\n/v ).slice( 5 ) ) {
        const [ type, format ] = line.trim().split( / +/v, 2 );

        formats[ format ] = {
            format,
            "encode": type[ 1 ] === "E",
            "decode": type[ 0 ] === "D",
            "device": type[ 2 ] === "d",
            "extnames": [],
            "type": null,
        };
    }

    for ( const format of Object.values( formats ) ) {
        parseFormat( format );
    }

    return formats;
}

function parseFormat ( format ) {
    if ( format.encode ) {
        const data = execFfmpeg( "-i", format.format, "-h", "muxer=" + format.format );

        for ( let line of data.split( /\r?\n/v ) ) {
            line = line.trim();

            if ( line.startsWith( "Common extensions:" ) ) {
                const extnames = line
                    .slice( 19, -1 )
                    .split( "," )
                    .map( extname => `.${ extname }` );

                format.extnames = [ ...new Set( Iterator.concat( format.extnames, extnames ) ) ].sort();
            }
            else if ( line.startsWith( "Mime type:" ) ) {
                format.type = line.slice( 11, -1 );
            }
        }
    }

    if ( format.decode ) {
        const data = execFfmpeg( "-i", format.format, "-h", "demuxer=" + format.format );

        for ( let line of data.split( /\r?\n/v ) ) {
            line = line.trim();

            if ( line.startsWith( "Common extensions:" ) ) {
                const extnames = line
                    .slice( 19, -1 )
                    .split( "," )
                    .map( extname => `.${ extname }` );

                format.extnames = [ ...new Set( Iterator.concat( format.extnames, extnames ) ) ].sort();
            }
        }
    }
}

function execFfmpeg ( ...args ) {
    return childProcess.execFileSync( FFMPEG_EXECUTABLE_PATH, [ "-hide_banner", ...args ], {
        "encoding": "utf8",
    } );
}
