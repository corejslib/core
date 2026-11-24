#!/usr/bin/env -S node

import { fileURLToPath } from "node:url";
import ansi from "#lib/ansi";
import Api from "#lib/api";
import ServiceDiscovery from "#lib/api/service-discovery";
import Cli from "#lib/cli";
import File from "#lib/file";
import GlobPatterns from "#lib/glob/patterns";
import * as json5 from "#lib/json5";
import Message from "#lib/message";
import Table from "#lib/text/table";
import * as yaml from "#lib/yaml";

const DEFAULT_URL = "http://127.0.0.1:81/",
    DEFAULT_CLUSTER_URL = "ws://cluster:81/";

const CLI = {
    "title": "Core API client.",
    "globalOptions": {
        "url": {
            "short": "u",
            "description": "API URL.",
            "default": DEFAULT_URL,
            "schema": {
                "type": "string",
                "format": "url",
            },
        },
        "cluster-url": {
            "short": "c",
            "description": "Cluster service discovery API URL.",
            "default": DEFAULT_CLUSTER_URL,
            "schema": {
                "type": "string",
                "format": "url",
            },
        },
        "default-version": {
            "short": "v",
            "description": "Default API version.",
            "default": 1,
            "schema": {
                "type": "integer",
            },
        },
        "token": {
            "short": "t",
            "description": "API token.",
            "schema": {
                "type": "string",
            },
        },
        "locale": {
            "short": "l",
            "description": "API locale.",
            "schema": {
                "type": "string",
                "format": "locale",
            },
        },
        "json": {
            "short": "j",
            "description": "Output in JSON format.",
            "default": false,
            "schema": {
                "type": "boolean",
            },
        },
    },
    "commands": {
        "schema": {
            "title": "Get the API schema.",
            "arguments": {
                "method-pattern": {
                    "description": "API method glob patterns.",
                    "schema": {
                        "type": "array",
                        "items": { "type": "string", "format": "glob-pattern" },
                    },
                },
            },
        },

        "call": {
            "title": "Make an API call.",
            "arguments": {
                "method": {
                    "description": "API method.",
                    "required": true,
                    "schema": {
                        "type": "string",
                    },
                },
                "parameters": {
                    "description": "API method parameters in JSON format.",
                    "schema": {
                        "type": "string",
                    },
                },
            },
        },

        "listen": {
            "title": "Listen for API events.",
            "options": {
                "listen-system-events": {
                    "short": "s",
                    "description": 'Listen API system events, such as: `"connect"`, `"disconnect"`, `"sessionDisable"`, `"sessionDelete"`, `"sessionReload"`, `"accessDenied"`.',
                    "default": false,
                    "schema": { "type": "boolean" },
                },
            },
            "arguments": {
                "event": {
                    "description": "API event name.",
                    "schema": {
                        "type": "array",
                        "items": {
                            "type": "string",
                        },
                    },
                },
            },
        },
        "help": {
            "title": "Get help.",
        },
    },
};

class ApiCli {
    #url;
    #clusterUrl;
    #version;
    #token;
    #locale;
    #json;
    #api;

    constructor ( { url, clusterUrl, version, token, locale, json } ) {
        this.#url = url;
        this.#clusterUrl = clusterUrl;
        this.#version = version;
        this.#token = token;
        this.#locale = locale;
        this.#json = json;
    }

    // public
    async schema ( methodPatterns ) {
        const res = await this.#getApi().call( "/schema" );
        if ( !res.ok ) return this.#logError( res );

        let patterns;

        if ( methodPatterns ) {
            patterns = new GlobPatterns().add( methodPatterns );
        }

        const methods = new Map();

        // index methods
        for ( const version of Object.keys( res.data.versions ).sort() ) {
            for ( const module of Object.keys( res.data.versions[ version ] ).sort() ) {
                for ( const methodId of Object.keys( res.data.versions[ version ][ module ].methods ).sort() ) {
                    const method = res.data.versions[ version ][ module ].methods[ methodId ];

                    if ( patterns && !patterns.test( method.id ) ) continue;

                    methods.set( method.id, method );
                }
            }
        }

        if ( methods.size === 1 ) {
            this.#logMethod( methods.values().toArray()[ 0 ] );
        }
        else {
            if ( this.#json ) {
                console.log( JSON.stringify( res.data, null, 4 ) );
            }
            else {
                if ( res.data.emits?.length ) {
                    this.#logEmits( res.data.emits );

                    console.log();
                }

                this.#logMethods( methods.values() );
            }
        }

        return res;
    }

    async call ( method, ...args ) {
        const res = await this.#getApi().call( method, ...args );

        if ( !res.ok ) return this.#logError( res );

        console.log( JSON.stringify( res, null, 4 ) );

        return res;
    }

    async upload ( method, ...args ) {
        const res = await this.#getApi()
            .upload( method, ...args )
            .start();

        if ( !res.ok ) return this.#logError( res );

        console.log( JSON.stringify( res, null, 4 ) );

        return res;
    }

    async listen ( events, { listenSystemEvents } = {} ) {
        if ( !Array.isArray( events ) ) events = [ events ];

        events = new Set( events );

        // add system events
        if ( listenSystemEvents ) {
            for ( const event of [ "connect", "disconnect", "sessionDisable", "sessionDelete", "sessionReload", "accessDenied" ] ) {
                events.add( event );
            }
        }

        const api = this.#getApi( {
            "persistent": true,
        } );

        for ( const event of events ) {
            if ( !event ) continue;

            api.on( event, ( ...args ) => {
                console.log( JSON.stringify(
                    {
                        event,
                        "arguments": args,
                    },
                    null,
                    4
                ) );
            } );
        }

        await new Promise( () => {} );

        return result( 200 );
    }

    // private
    #getApi ( { persistent } = {} ) {
        if ( !this.#api ) {
            const url = new URL( this.#url );

            let serviceDiscovery;

            if ( this.#clusterUrl && url.hostname === ServiceDiscovery.hostname ) {
                serviceDiscovery = new ServiceDiscovery( new Api( this.#clusterUrl ) );
            }

            this.#api ??= new Api( this.#url, {
                persistent,
                "version": this.#version,
                "token": this.#token,
                "locale": this.#locale,
                serviceDiscovery,
            } );
        }

        return this.#api;
    }

    #logError ( res ) {
        if ( res.ok ) return;

        if ( this.#json ) {
            console.log( JSON.stringify( res, null, 4 ) );
        }
        else {
            console.log( res + "" );
        }

        return res;
    }

    #logEmits ( emits ) {
        console.log( "Emits:\n" );

        for ( const name of emits ) {
            console.log( name );
        }
    }

    #logMethods ( methods ) {
        console.log( "Methods:\n" );

        const table = new Table( {
            "style": "borderless",
            "header": false,
            "columns": {
                "id": {
                    "title": ansi.hl( "ID" ),
                    "headerAlign": "start",
                    "headerValign": "end",
                },
                "title": {
                    "title": ansi.hl( "TITLE" ),
                    "headerAlign": "start",
                    "headerValign": "end",
                },
            },
        } ).pipe( process.stdout );

        for ( const method of methods ) {
            table.write( method );
        }

        table.end();
    }

    #logMethod ( method ) {
        if ( this.#json ) {
            console.log( JSON.stringify( method, null, 4 ) );
        }
        else {
            console.log( yaml.toYaml( method ) );
        }
    }
}

await Cli.parse( CLI );

const apiCli = new ApiCli( {
    "url": process.cli.globalOptions.url,
    "clusterUrl": process.cli.globalOptions[ "cluster-url" ],
    "version": process.cli.globalOptions[ "default-version" ],
    "token": process.cli.globalOptions.token,
    "locale": process.cli.globalOptions.locale,
    "json": process.cli.globalOptions.json,
} );

let res;

if ( process.cli.command === "schema" ) {
    res = await apiCli.schema( process.cli.arguments[ "method-pattern" ] );
}
else if ( process.cli.command === "call" ) {
    let args, hasAttachments;

    if ( process.cli.arguments.parameters ) {
        args = json5.fromJson5( process.cli.arguments.parameterparameters, ( key, value, context ) => {
            if ( typeof value === "string" ) {

                // attachment
                if ( value.startsWith( "attach:" ) ) {
                    hasAttachments = true;

                    // absolute path
                    if ( value.startsWith( "attach://" ) ) {
                        value = new Message( {
                            "body": new File( fileURLToPath( value.replace( /^attach:/v, "file:" ) ) ),
                        } );
                    }

                    // relative path
                    else {
                        value = new Message( {
                            "body": new File( value.slice( 5 ) ),
                        } );
                    }
                }
            }

            return value;
        } );

        if ( !Array.isArray( args ) ) {
            args = [ args ];
        }
    }
    else {
        args = [];
    }

    if ( hasAttachments ) {
        res = await apiCli.upload( process.cli.arguments.method, ...args );
    }
    else {
        res = await apiCli.call( process.cli.arguments.method, ...args );
    }
}
else if ( process.cli.command === "listen" ) {
    res = await apiCli.listen( process.cli.arguments.event, {
        "listenSystemEvents": process.cli.options[ "listen-system-events" ],
    } );
}
else if ( process.cli.command === "help" ) {
    res = result( 200 );

    const help = `
# \`zapi\` help

## Docker

Connect to the docker stack:

\`\`\`sh
docker run --rm -it \\
    --entrypoint=/usr/bin/bash \\
    --network=<STACK-NETWORK-NAME> \\
    ghcr.io/zerocluster/cluster
\`\`\`

Connect to the docker container:

\`\`\`sh
docker exec -it <CONTAINER-ID> bash
\`\`\`

## API call example

\`\`\`sh
MSYS2_ARG_CONV_EXCL="*" zapi --url "http://devel:81/" call "/v1/test" "$(
    cat << 'EOF'
[
    "argument-1",
    "argument-2",
    {
        "relative-attachment": "attach:1.mp3",
        "absolute-attachment": "attach:///1.mp3",
    }
]
EOF
)"
\`\`\`
`;

    console.log( Cli.markdownToString( help ) );
}

if ( res.ok ) {
    process.exit();
}
else {
    process.exit( 1 );
}
