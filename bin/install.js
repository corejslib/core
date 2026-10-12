#!/usr/bin/env -S node

import Cli from "#lib/cli";
import externalResources from "#lib/external-resources";

const CLI = {
    "title": "Update resources",
    "options": {
        "force": {
            "description": "force update",
            "default": false,
            "schema": {
                "type": "boolean",
            },
        },
    },
};

await Cli.parse( CLI );

externalResources.add( "corejslib/core/resources/certificates" );
externalResources.add( "corejslib/core/resources/dh-params" );
externalResources.add( "corejslib/core/resources/geolite2-country" );
externalResources.add( "corejslib/core/resources/http" );
externalResources.add( "corejslib/core/resources/mime" );
externalResources.add( "corejslib/core/resources/public-suffixes" );
externalResources.add( "corejslib/core/resources/subnets" );
externalResources.add( "corejslib/core/resources/tld" );
externalResources.add( "corejslib/core/resources/user-agent" );
externalResources.add(
    {
        "id": "corejslib/core/resources/uws",
        "node": true,
        "caller": import.meta.url,
    },
    {
        "location": "package",
    }
);

const res = await externalResources.update( {
    "force": process.cli.options.force,
} );

if ( !res.ok ) process.exit( 1 );
