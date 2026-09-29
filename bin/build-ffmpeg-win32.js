#!/usr/bin/env -S node

import Cli from "#lib/cli";
import ExternalResourceBuilder from "#lib/external-resource-builder";
import FfmpegWin32 from "#lib/external-resources/ffmpeg-win32";

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
    "arguments": {
        "pattern": {
            "description": "Filter resources using glob patterns.",
            "schema": { "type": "array", "items": { "type": "string" } },
        },
    },
};

await Cli.parse( CLI );

const res = await ExternalResourceBuilder.build(
    [

        //
        FfmpegWin32,
    ],
    {
        "force": process.cli.options.force,
        "patterns": process.cli.arguments.pattern,
    }
);

if ( !res.ok ) process.exit( 1 );
