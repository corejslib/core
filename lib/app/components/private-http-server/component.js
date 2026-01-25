import DigitalSize from "#lib/digital-size";
import Server from "#lib/http/server";
import { getRandomFreePort } from "#lib/net";

export default Super =>
    class extends Super {
        #port;

        // properties
        get port () {
            return this.#port;
        }

        // protected
        async _install () {
            return new Server( {
                "setRealIpFrom": this.config.setRealIpFrom,
                "realIpHeader": this.config.realIpHeader,
                "httpCompress": typeof this.config.httpCompress === "boolean"
                    ? this.config.httpCompress
                    : new DigitalSize( this.config.httpCompress ).bytes,
                "webSocketCompress": typeof this.config.webSocketCompress === "boolean"
                    ? this.config.webSocketCompress
                    : new DigitalSize( this.config.webSocketCompress ).bytes,
            } );
        }

        async _configure () {
            this.config.nginx.serverNames ||= [ this.app.env.name ];

            return result( 200 );
        }

        async _afterAppStarted () {
            const hasLocalNginx = this.app.nginx;

            var res;

            // start instance
            res = await this.instance.start( {
                "address": hasLocalNginx
                    ? `${ this.app.env.unixSocketsDir }/private-http-server.socket`
                    : this.config.address,
                "port": this.config.port,
                "exclusive": this.config.exclusive,
            } );

            if ( res.ok ) {
                this.#port = res.data.port;
            }
            else {
                console.error( `Private HTTP server unable bind to the porr: ${ this.config.port }` );

                return res;
            }

            // configure local nginx
            if ( hasLocalNginx ) {
                this.#port = this.config.port || ( await getRandomFreePort() );

                this.app.nginx.proxies.add( {
                    "private-http-server": {
                        "upstreamPort": this.#port,
                        "serverNames": this.config.nginx.serverNames,
                        "servers": [
                            {
                                ...this.config.nginx.server,
                                "port": this.#port,
                                "type": "http",
                            },
                        ],
                        "upstreams": this.instance.nginxAddress,
                    },
                } );
            }

            // configure upstream nginx
            if ( this.config.nginx.enabled && this.app.nginxUpstream ) {
                await this.app.nginxUpstream.addProxy( "private-http-server", {
                    "upstreamPort": this.#port,
                    "serverNames": this.config.nginx.serverNames,
                    "servers": [
                        {
                            ...this.config.nginx.server,
                            "port": this.config.nginx.port,
                            "type": "http",
                        },
                    ],
                } );
            }

            console.log( `Private HTTP server listening at: ${ hasLocalNginx
                ? `${ this.config.address }:${ this.#port }`
                : this.instance.nginxAddress }` );

            return result( 200 );
        }

        async _destroy () {
            return this.instance.stop();
        }
    };
