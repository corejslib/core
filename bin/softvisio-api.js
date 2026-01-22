#!/usr/bin/env node

import ansi from "#lib/ansi";
import Api from "#lib/api";
import Cli from "#lib/cli";
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
            "description": "API token",
            "schema": {
                "type": "string",
            },
        },
        "locale": {
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
            "arguments": {
                "method": {
                    "description": "API method",
                    "required": true,
                    "schema": {
                        "type": "string",
                    },
                },
                "argument": {
                    "description": "API method argument in JSON format",
                    "schema": {
                        "type": "array",
                        "items": { "type": "string" },
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
        const parans = [];

        for ( const arg of args ) {
            parans.push( JSON.parse( arg ) );
        }

        const res = await this.#getApi().call( method, ...parans );

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
    res = await apiCli.call( process.cli.arguments.method, ...( process.cli.arguments.argument || [] ) );
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
