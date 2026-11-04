export default class ProxyBucket {
    #id;
    #options;

    #proxy;
    #lastRotated;
    #requests = 0;

    constructor ( id, options ) {
        this.#id = id;
        this.#options = options;
    }

    get id () {
        return this.#id;
    }

    get options () {
        return this.#options;
    }

    get proxy () {
        return this.#proxy;
    }

    get lastRotated () {
        return this.#lastRotated;
    }

    get requests () {
        return this.#requests;
    }

    // public
    getProxy () {
        this.#requests++;

        return this.#proxy;
    }

    setProxy ( proxy ) {
        this.setRotated();

        this.#proxy = proxy;
    }

    setRotated () {
        this.#lastRotated = Temporal.Now.instant();
        this.#requests = 0;
    }

    requireRotate () {
        const options = this.#options;

        // rotate by number of requests
        if ( options.rotateRequests && this.#requests >= options.rotateRequests ) return true;

        // rotate by timeout
        if ( options.rotateTimeout && this.#lastRotated && Date.now() - this.#lastRotated >= options.rotateTimeout * 1000 ) return true;
    }
}
