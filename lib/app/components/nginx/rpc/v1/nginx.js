export default Super =>
    class extends Super {
        #apps = {};
        #connections = new Map();

        // public
        async [ "API_get-certificates" ] ( ctx, serverNames ) {
            if ( !Array.isArray( serverNames ) ) serverNames = [ serverNames ];

            if ( this.app.nginxUpstream ) {
                return this.app.nginxUpstream.getCertificates( serverNames );
            }
            else {
                const certificates = {};

                await Promise.all( serverNames.map( serverName => {
                    if ( this.app.acme?.canGetCertificate( serverName ) ) {
                        return this.app.acme
                            .getCertificate( serverName, {
                                "pem": true,
                            } )
                            .then( res => {
                                if ( res.ok ) {
                                    certificates[ serverName ] = {
                                        "certificate": res.data.certificate,
                                        "privateKey": res.data.privateKey,
                                        "fingerprint": res.data.fingerprint,
                                        "expires": res.data.expires,
                                    };
                                }
                                else {
                                    certificates[ serverName ] = null;
                                }
                            } );
                    }
                    else {
                        certificates[ serverName ] = null;
                    }
                } ) );

                return result( 200, certificates );
            }
        }

        async [ "API_clear-cache" ] ( ctx ) {
            await this.app.nginx.clearCache();

            return result( 200 );
        }

        async [ "API_update-proxies" ] ( ctx, appName, appServiceName, updateId, proxies ) {
            var appId = appName + "_" + appServiceName;

            const connection = ctx.connection;

            // register new connection
            if ( !this.#connections.has( connection ) ) {
                this.#connections.set( connection, appId );

                connection.once( "disconnect", this.#onDisconnect.bind( this ) );
            }
            else {
                appId = this.#connections.get( connection );
            }

            var app = this.#apps[ appId ];

            // register new app
            if ( !app ) {
                app = this.#apps[ appId ] = {
                    "id": appId,
                    "name": appName,
                    "serviceName": appServiceName,
                    "updateId": 0,
                    "connections": new Set(),
                    "proxies": new Set(),
                };
            }

            // register app connection
            app.connections.add( connection );

            // update proxies
            if ( app.updateId < updateId ) {
                app.updateId = updateId;

                // delete proxies
                for ( const proxy of app.proxies ) {
                    app.proxies.delete( proxy );

                    proxy.delete();
                }

                // create proxies
                for ( const [ serverName, proxyOptions ] of Object.entries( proxies || {} ) ) {
                    const proxyId = "api_" + appId + "_" + serverName;

                    this.app.nginx.proxies.add( {
                        [ proxyId ]: proxyOptions,
                    } );

                    const proxy = this.app.nginx.proxies.get( proxyId );

                    app.proxies.add( proxy );

                    console.log( `[nginx] add app proxy, app: ${ app.id }, proxy: ${ proxy.id }` );
                }
            }

            // set upstreams
            if ( app.proxies.size ) {
                const upstreams = [ ...app.connections ].map( connection => connection.remoteAddress );

                console.log( `[nginx] set app upstreams, app: ${ app.id }, upstreams: ${ upstreams.join( ", " ) }` );

                for ( const proxy of app.proxies ) {
                    proxy.upstreams.set( upstreams );
                }
            }

            return result( 200 );
        }

        // private
        #onDisconnect ( connection ) {
            const appId = this.#connections.get( connection ),
                app = this.#apps[ appId ],
                upstream = connection.remoteAddress;

            // delete connection
            this.#connections.delete( connection );
            app.connections.delete( connection );

            console.log( `[nginx] delete app upstream, app: ${ app.id }, upstream: ${ upstream }` );

            for ( const proxy of app.proxies ) {
                proxy.upstreams.delete( upstream );

                // delete proxies without upstreams
                if ( !proxy.upstreams.hasUpstreams ) {
                    app.proxies.delete( proxy );

                    proxy.delete();

                    console.log( `[nginx] delete app proxy, app: ${ app.id }, proxy: ${ proxy.id }` );
                }
            }

            // delete app without connections
            if ( !app.connections.size ) {
                delete this.#apps[ appId ];

                console.log( `[nginx] delete app, app: ${ app.id }` );
            }
        }
    };
