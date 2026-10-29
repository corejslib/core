import fetch from "#lib/fetch";

// NOTE https://docs.docker.com/registry/spec/api/

const DEFAULT_REGISTRY = "index.docker.io";
const API_VERSION = "v2";

export default class DockerRegistry {
    #username;
    #password;
    #registry;

    #id;
    #basicAuth;
    #bearerAuth = {};
    #urlAuthCache = {};

    constructor ( username, password, registry ) {
        this.#username = username;
        this.#password = password;
        this.#registry = registry || DEFAULT_REGISTRY;
    }

    // properties
    get id () {
        this.#id ??= this.#registry + ":" + this.#username;

        return this.#id;
    }

    // public
    // NOTE: not works for docker hub
    // NOTE: for harbor works only for administrators
    async getCatalog () {
        const url = "https://" + this.#registry + "/" + API_VERSION + "/_catalog";

        const res = await this.#request( url );

        if ( !res.ok ) return res;

        const data = await res.json();

        return result( 200, data );
    }

    async getTags ( repo ) {
        const url = "https://" + this.#registry + "/" + API_VERSION + "/" + repo + "/tags/list";

        const res = await this.#request( url );

        if ( !res.ok ) return res;

        const data = await res.json();

        return result( 200, data );
    }

    async getManifest ( repo, tag ) {
        const url = "https://" + this.#registry + "/" + API_VERSION + "/" + repo + "/manifests/" + ( tag || "latest" );

        const res = await this.#request( url, null, { "accept": "application/vnd.docker.distribution.manifest.v2+json" } );

        if ( !res.ok ) return res;

        const data = await res.json();

        data.digest = res.headers.get( "docker-content-digest" );

        return result( 200, data );
    }

    async deleteImage ( repo, tag ) {
        const manifest = await this.getManifest( repo, tag );

        if ( !manifest.ok ) return manifest;

        const url = "https://" + this.#registry + "/" + API_VERSION + "/" + repo + "/manifests/" + manifest.data.digest;

        return this.#request( url, "DELETE" );
    }

    // private
    async #request ( url, method, headers = {} ) {
        var authorization = this.#urlAuthCache[ url ];

        if ( authorization ) {
            if ( authorization.basic ) authorization = authorization.basic;
            else if ( authorization.bearer ) authorization = await this.#getBearerAuth( authorization.bearer );
        }

        while ( true ) {
            const res = await fetch( url, {
                method,
                "headers": {
                    ...headers,
                    authorization,
                },
            } );

            if ( !res.ok ) {

                // authorization error
                if ( res.status === 401 ) {

                    // invalid auth
                    if ( authorization ) return result( res );

                    const wwwAuthenticate = res.headers.wwwAuthenticate;

                    if ( !wwwAuthenticate.scheme ) return result( res );

                    if ( wwwAuthenticate.scheme === "basic" ) {
                        authorization = this.#getBasicAuth();

                        this.#urlAuthCache[ url ] ||= {};
                        this.#urlAuthCache[ url ].basic = this.#getBasicAuth();
                    }
                    else if ( wwwAuthenticate.scheme === "bearer" ) {
                        const authUrl = wwwAuthenticate.realm + "?service=" + wwwAuthenticate.service + "&scope=" + wwwAuthenticate.scope;

                        authorization = await this.#getBearerAuth( authUrl );

                        // unable to get bearer token
                        if ( !authorization ) return result( res );

                        this.#urlAuthCache[ url ] ||= {};
                        this.#urlAuthCache[ url ].bearer = authUrl;
                    }
                    else {
                        return result( [ 500, "Invalid authentication scheme" ] );
                    }

                    // repeat request with authorization
                    continue;
                }

                // other error
                else {
                    return result( res );
                }
            }

            // ok
            else {
                return res;
            }
        }
    }

    #getBasicAuth () {
        this.#basicAuth ??= "Basic " + Buffer.from( this.#username + ":" + this.#password ).toBase64();

        return this.#basicAuth;
    }

    async #getBearerAuth ( url ) {
        if ( this.#bearerAuth[ url ] && this.#bearerAuth[ url ].expires > Date.now() ) return this.#bearerAuth[ url ].token;

        const res = await fetch( url, {
            "headers": {
                "authorization": this.#getBasicAuth(),
            },
        } );

        if ( !res.ok ) return;

        const json = await res.json();

        this.#bearerAuth[ url ] = {
            "expires": Date.parse( json.issued_at ) + json.expires_in * 1000 - 3000,
            "token": "Bearer " + json.token,
        };

        return this.#bearerAuth[ url ].token;
    }
}
