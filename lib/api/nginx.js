import Api from "#lib/api";
import Mutex from "#lib/threads/mutex";

export default class NginxApi {
    #appName;
    #appServiceName;
    #api;
    #proxies = {};
    #updateId;
    #mutex = new Mutex();
    #abortController = new AbortController();

    constructor ( url, appName, appServiceName ) {
        this.#appName = appName;
        this.#appServiceName = appServiceName;

        this.#api = new Api( url ).on( "disconnect", this.#onDisconnect.bind( this ) );
    }

    // properties
    get appName () {
        return this.#appName;
    }

    get appServiceName () {
        return this.#appServiceName;
    }

    // public
    destroy () {
        this.#abortController.abort();
    }

    async getCertificates ( serverNames ) {
        return this.#api.call( "nginx/get-certificates", serverNames );
    }

    async addProxy ( serverName, proxyOptions ) {
        if ( !this.#proxies[ serverName ] ) {
            this.#proxies[ serverName ] = proxyOptions;

            await this.#createUpdateId();

            this.#update();
        }

        return result( 200 );
    }

    async deleteProxy ( serverName ) {
        if ( this.#proxies[ serverName ] ) {
            delete this.#proxies[ serverName ];

            await this.#createUpdateId();

            this.#update();
        }

        return result( 200 );
    }

    async setServerNames ( serverName, serverNames ) {
        const proxy = this.#proxies[ serverName ];

        if ( !proxy ) return result( [ 404, "Nginx proxy not found" ] );

        proxy.serverNames = [ ...new Set( serverNames || [] ) ];

        await this.#createUpdateId();

        return result( 200 );
    }

    // private
    async #createUpdateId () {
        const updateId = Date.now();

        if ( updateId <= this.#updateId ) {
            this.#updateId++;
        }
        else {
            this.#updateId = updateId;
        }
    }

    async #onDisconnect () {
        this.#update();
    }

    async #update () {
        const signal = this.#abortController.signal;

        if ( signal.aborted ) return;

        if ( !this.#mutex.tryLock() ) return;

        while ( true ) {
            if ( signal.aborted ) break;

            if ( !( await this.#api.waitConnect( signal ) ) ) break;

            const updateId = this.#updateId;

            const res = await this.#api.call( "nginx/update-proxies", this.#appName, this.#appServiceName, updateId, this.#proxies );

            if ( res.ok && updateId === this.#updateId ) {
                break;
            }
        }

        this.#mutex.unlock();
    }
}
