#!/usr/bin/env -S node

import { fileURLToPath } from "node:url";
import ansi from "#lib/ansi";
import Api from "#lib/api";
import Cli from "#lib/cli";
import File from "#lib/file";
import * as json5 from "#lib/json5";
import Message from "#lib/message";
import Table from "#lib/text/table";
import * as yaml from "#lib/yaml";

const CLI = {
    "title": "Core API client",
    "description": `
# Connect to the docker stack:

    docker run --rm -it --entrypoint=/usr/bin/bash --network=<STACK-NETWORK-NAME> ghcr.io/zerocluster/cluster

# Connect to the docker container:

    docker exec -it <CONTAINER-ID> bash
`.trim(),
    "globalOptions": {
        "url": {
            "short": "u",
            "description": "API url",
            "default": "http://127.0.0.1:81/api",
            "schema": {
                "type": "string",
                "format": "url",
            },
        },
        "default-version": {
            "short": "v",
            "description": "default API version",
            "default": 1,
            "schema": {
                "type": "integer",
            },
        },
        "token": {
            "short": "t",
            "description": "API token",
            "schema": {
                "type": "string",
            },
        },
        "locale": {
            "short": "l",
            "description": "API locale",
            "schema": {
                "type": "string",
                "format": "locale",
            },
        },
        "json": {
            "short": "j",
            "description": "output in JSON format",
            "default": false,
            "schema": {
                "type": "boolean",
            },
        },
    },
    "commands": {
        "schema": {
            "title": "Get API schema",
            "arguments": {
                "method": {
                    "description": "API method pattern",
                    "schema": {
                        "type": "string",
                    },
                },
            },
        },

        "call": {
            "title": "Make API call",
            "description": `
\`\`\`sh
MSYS2_ARG_CONV_EXCL="*" zapi --url "http://devel:81/api" call "/v1/test" "$(
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
`.trim(),
            "arguments": {
                "method": {
                    "description": "API method",
                    "required": true,
                    "schema": {
                        "type": "string",
                    },
                },
                "arguments": {
                    "description": "API method arguments in JSON format",
                    "schema": {
                        "type": "string",
                    },
                },
            },
        },

        "listen": {
            "title": "Listen API events",
            "options": {
                "listen-system-events": {
                    "short": "s",
                    "description": `Listen API system events, such as: "connect", "disconnect", "sessionDisable", "sessionDelete", "sessionReload", "accessDenied".`,
                    "default": false,
                    "schema": { "type": "boolean" },
                },
            },
            "arguments": {
                "event": {
                    "description": "API event name",
                    "schema": {
                        "type": "array",
                        "items": {
                            "type": "string",
                        },
                    },
                },
            },
        },
    },
};

class ApiCli {
    #url;
    #version;
    #token;
    #locale;
    #json;
    #api;

    constructor ( { url, version, token, locale, json } ) {
        this.#url = url;
        this.#version = version;
        this.#token = token;
        this.#locale = locale;
        this.#json = json;
    }

    // public
    async schema ( method ) {
        const res = await this.#getApi().call( "/schema" );

        if ( !res.ok ) return this.#logError( res );

        const methods = {};

        // index methods
        for ( const version of Object.keys( res.data.versions ).sort() ) {
            for ( const module of Object.keys( res.data.versions[ version ] ).sort() ) {
                for ( const methodId of Object.keys( res.data.versions[ version ][ module ].methods ).sort() ) {
                    const method = res.data.versions[ version ][ module ].methods[ methodId ];

                    methods[ method.id ] = method;
                }
            }
        }

        if ( method && methods[ method ] ) {
            this.#logMethod( methods[ process.cli.arguments.method ] );
        }
        else {
            if ( this.#json ) {
                console.log( JSON.stringify( res.data, null, 4 ) );
            }
            else {
                this.#logEmits( res.data.emits );

                console.log();

                this.#logMethods( Object.values( methods ) );
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
        this.#api ??= new Api( this.#url, {
            persistent,
            "version": this.#version,
            "token": this.#token,
            "locale": this.#locale,
        } );

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
    "version": process.cli.globalOptions[ "default-version" ],
    "token": process.cli.globalOptions.token,
    "locale": process.cli.globalOptions.locale,
    "json": process.cli.globalOptions.json,
} );

var res;

if ( process.cli.command === "schema" ) {
    res = await apiCli.schema( process.cli.arguments.method );
}
else if ( process.cli.command === "call" ) {
    let args, hasAttachments;

    if ( process.cli.arguments.arguments ) {
        args = json5.fromJson5( process.cli.arguments.arguments, ( key, value, context ) => {
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

if ( res.ok ) {
    process.exit();
}
else {
    process.exit( 1 );
}
