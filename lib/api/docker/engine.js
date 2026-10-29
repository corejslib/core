import ContainersMixin from "#lib/api/docker/engine/containers";
import ImagesMixin from "#lib/api/docker/engine/images";
import ServicesMixin from "#lib/api/docker/engine/services";
import SystemMixin from "#lib/api/docker/engine/system";
import fetch from "#lib/fetch";
import mixins from "#lib/mixins";
import { pipeline } from "#lib/stream";
import { JsonStreamDecoder } from "#lib/stream/json";

// NOTE https://docs.docker.com/engine/api/latest/

const API_VERSION = "1.52",
    DEFAULT_SOCKET_PATH = "/var/run/docker.sock",
    DISPATCHER = new fetch.Dispatcher( {
        "connect": {
            "socketPath": DEFAULT_SOCKET_PATH,
        },
    } );

export default class DockerEngine extends mixins( ContainersMixin, ImagesMixin, ServicesMixin, SystemMixin ) {

    // protected
    _getImageAuth ( image, credentials ) {
        const domain = image.split( "/", 1 )[ 0 ];

        return credentials[ domain ] || credentials[ "https://index.docker.io/v1/" ];
    }

    async _doRequest ( method, path, { stream, signal, params, body, registryAuth, registryConfig } = {} ) {
        const url = new URL( "http://local/v" + API_VERSION + "/" + path );

        if ( params ) {
            for ( const name in params ) {
                if ( params[ name ] === undefined ) {
                    continue;
                }
                else if ( typeof params[ name ] === "object" ) {
                    url.searchParams.set( name, JSON.stringify( params[ name ] ) );
                }
                else {
                    url.searchParams.set( name, params[ name ] );
                }
            }
        }

        var headers = {};

        if ( registryAuth ) {
            headers[ "x-registry-auth" ] = Buffer.from( JSON.stringify( registryAuth ) ).toBase64();
        }

        if ( registryConfig ) {
            headers[ "x-registry-config" ] = Buffer.from( JSON.stringify( registryConfig ) ).toBase64();
        }

        const res = await fetch( url, {
            method,
            headers,
            body,
            "dispatcher": DISPATCHER,
            "bodyTimeout": stream
                ? 0
                : null,
            signal,
        } );

        var data;

        if ( res.ok ) {

            // stream
            if ( stream ) {
                const jsonStreamDecoder = new JsonStreamDecoder();

                pipeline( res.body, jsonStreamDecoder, () => {} );

                return result( 200, jsonStreamDecoder );
            }

            // json data
            else {
                try {
                    data = await res.json();
                }
                catch ( e ) {
                    return result.fromError( e );
                }

                return result( 200, data );
            }
        }

        // error
        else {
            try {
                data = await res.json();
            }
            catch ( e ) {
                return result.fromError( e );
            }

            return result( [ res.status, data?.message || res.statusText ] );
        }
    }
}
