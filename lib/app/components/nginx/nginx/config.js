import fs from "node:fs";
import path from "node:path";
import ejs from "#lib/ejs";
import Hostname from "#lib/hostname";
import NginxProxyDefaultServer from "./proxy/default-server.js";

const reouterConfigTemplate = ejs.fromFile( new URL( "../resources/server.stream-router.nginx.conf", import.meta.url ) );

export default class NginxConfig {
    #nginx;
    #useLocalSocket;
    #localAddress;
    #localAddressPort;

    constructor ( nginx ) {
        this.#nginx = nginx;

        if ( this.#nginx.config.localAddress === "unix:" ) {
            this.#useLocalSocket = true;
        }
        else {
            this.#useLocalSocket = false;

            const url = new URL( "tcp://" + this.#nginx.config.localAddress );

            this.#localAddress = url.hostname;
            this.#localAddressPort = +url.port;
        }
    }

    // properties
    get app () {
        return this.#nginx.app;
    }

    get nginx () {
        return this.#nginx;
    }

    async generate () {
        const groups = {},
            ports = {};

        // add ACME
        if ( this.app.acme?.httpEnabled ) {
            const id = "80/http/false/false";

            groups[ id ] = {
                id,
                "port": 80,
                "type": "http",
                "proxyProtocol": false,
                "ssl": false,
                "serverNames": new Map(),
                "localAddress": null,
            };
        }

        // group servers by port configuration
        for ( const proxy of this.nginx.proxies ) {
            for ( const server of proxy.servers ) {

                // proxy has no upstreams
                if ( !server.proxy.upstreams.hasUpstreams ) continue;

                const id = `${ server.port }/${ server.type }/${ !!server.ssl }/${ !!server.proxyProtocol }`;

                // init group
                groups[ id ] ??= {
                    id,
                    "port": server.port,
                    "type": server.type,
                    "proxyProtocol": !!server.proxyProtocol,
                    "ssl": !!server.ssl,
                    "serverNames": new Map(),
                    "localAddress": null,
                };

                const group = groups[ id ];

                // add server
                if ( server.isDefaultServer ) {

                    // group already has default server
                    if ( group.serverNames.has( "" ) ) continue;

                    group.serverNames.set( "", {
                        "serverName": this.nginx.defaultServerName,
                        server,
                    } );
                }
                else {
                    for ( const serverName of server.serverNames ) {

                        // group already has server name
                        if ( group.serverNames.has( serverName.name ) ) continue;

                        group.serverNames.set( serverName.name, {
                            serverName,
                            server,
                        } );
                    }
                }
            }
        }

        // add group default servers for "http" and "ssl" groups
        for ( const group of Object.values( groups ) ) {

            // group already has default server
            if ( group.serverNames.has( "" ) ) continue;

            if ( group.type === "http" || group.ssl ) {

                // create default server
                group.serverNames.set( "", {
                    "serverName": this.nginx.defaultServerName,
                    "server": new NginxProxyDefaultServer( this.nginx, {
                        "port": group.port,
                        "type": group.type,
                        "proxyProtocol": group.proxyProtocol,
                        "ssl": group.ssl,
                    } ),
                } );
            }
        }

        // create ports
        for ( const group of Object.values( groups ) ) {

            // init port
            ports[ group.port ] ??= {
                "port": group.port,
                "isUdp": null,
                "groups": new Set(),
                "defaultGroup": null,
                "defaultSslGroup": null,
            };

            const port = ports[ group.port ];

            // check "udp"
            if ( port.isUdp == null ) {
                port.isUdp = group.type === "udp";
            }
            else if ( port.isUdp || group.type === "udp" ) {
                console.warn( `[nginx] conflict on port "${ group.port }:${ group.port }". UDP services can not be mixed with the other services on the same port` );

                continue;
            }

            // "ssl" group
            if ( group.ssl ) {
                if ( group.serverNames.has( "" ) ) {
                    port.defaultSslGroup ??= group;
                }
            }

            // non-ssl group
            else {

                // port can contain only 1 non-ssl servers group
                if ( port.defaultGroup ) {
                    console.warn( `[nginx] conflict on port "${ group.port }:${ group.port }". Non-ssl services can not be mixed on the same port` );

                    continue;
                }
                else {
                    port.defaultGroup = group;
                }
            }

            port.groups.add( group );
        }

        // create routers
        for ( const port of Object.values( ports ) ) {

            // use router if port server groups size > 1
            if ( port.groups.size <= 1 ) continue;

            const router = ( port.router = {
                "port": port.port,
                "defaultLocalAddress": null,
                "defaultSslLocalAddress": null,
                "serverNames": new Map(),
            } );

            for ( const group of port.groups ) {
                group.localAddress = this.#createGroupLocalAddress( group );

                for ( const serverName of [ ...group.serverNames.keys() ].sort( this.#compareServerNames.bind( this ) ) ) {

                    // ignore default servers
                    if ( !serverName ) continue;

                    if ( router.serverNames.has( serverName ) ) continue;

                    router.serverNames.set( serverName, group.localAddress );
                }
            }

            router.defaultLocalAddress = port.defaultGroup?.localAddress;
            router.defaultSslLocalAddress = port.defaultSslGroup?.localAddress;
        }

        for ( const port of Object.values( ports ) ) {

            // generate servers
            for ( const group of port.groups ) {
                const configsPaths = {},
                    promises = [];

                for ( const { serverName, server } of group.serverNames.values() ) {
                    promises.push( server
                        .generateConfig( {
                            serverName,
                            "localAddress": group.localAddress,
                        } )
                        .then( config => {
                            configsPaths[ server.configPath ] ??= [];

                            configsPaths[ server.configPath ].push( {
                                serverName,
                                config,
                            } );
                        } ) );
                }

                await Promise.all( promises );

                for ( const [ configPath, configs ] of Object.entries( configsPaths ) ) {
                    await fs.promises.mkdir( path.dirname( configPath ), { "recursive": true } );

                    await fs.promises.writeFile(
                        configPath,
                        configs
                            .sort( ( a, b ) => this.#compareServerNames( a.serverName.name, b.serverName.name ) )
                            .map( config => config.config )
                            .join( "\n" )
                    );
                }
            }

            // generate upstreams
            const proxies = new Map();

            for ( const group of port.groups ) {
                for ( const { server } of group.serverNames.values() ) {
                    if ( !server.proxy ) continue;

                    if ( !proxies.has( server.proxy ) ) {
                        proxies.set( server.proxy, {
                            "hasHttpServers": false,
                            "hasStreamServers": false,
                        } );
                    }

                    if ( server.isHttp ) {
                        proxies.get( server.proxy ).hasHttpServers = true;
                    }
                    else {
                        proxies.get( server.proxy ).hasStreamServers = true;
                    }
                }
            }

            for ( const [ proxy, options ] of proxies.entries() ) {
                proxy.writeConfig( options );
            }

            // generate routers
            if ( port.router ) {
                const config = reouterConfigTemplate.render( {
                    "nginx": this.nginx,
                    "router": port.router,
                } );

                await fs.promises.mkdir( this.nginx.configsDir + "/stream-servers", { "recursive": true } );

                await fs.promises.writeFile( this.nginx.configsDir + `/stream-servers/${ port.port }-router.nginx.conf`, config );
            }
        }
    }

    // private
    #createGroupLocalAddress ( group ) {
        const port = this.#localAddressPort++;

        if ( this.#useLocalSocket ) {
            return "unix:" + this.#nginx.app.env.unixSocketsDir + `/nginx-${ port }.socket`;
        }
        else {
            return this.#localAddress + ":" + port;
        }
    }

    #compareServerNames ( a, b ) {
        return Hostname.compare( a.replaceAll( "*", "z" ), b.replaceAll( "*", "z" ) );
    }
}
