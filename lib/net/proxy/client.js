import Events from "#lib/events";
import { getDefaultPort } from "#lib/net";
import Uuid from "#lib/uuid";

const PROTOCOL = {};

export default class ProxyClient extends Events {
    #protocol;
    #hostname = "";
    #port = "";
    #username = "";
    #password = "";
    #url;
    #basicAuth;
    #options = {};

    // static
    static new ( url, options = {} ) {
        if ( !url ) return;

        // url is proxy client object
        if ( url instanceof this ) return url;

        // url is string
        if ( typeof url === "string" ) {
            url = new URL( url );
        }

        const protocol = options.protocol || url.protocol;

        const Class = PROTOCOL[ protocol ];

        if ( !Class ) throw `Proxy client protocol is not valid: ${ protocol }`;

        const proxy = new Class();

        proxy._init( url, options );

        return proxy;
    }

    static register ( protocol, Class ) {
        PROTOCOL[ protocol ] = Class;
    }

    static generateSession () {
        return Uuid.v4();
    }

    _init ( url, options = {} ) {
        if ( typeof url === "string" ) url = new URL( url );

        if ( super._init ) super._init( url, options );

        this.#protocol = options.protocol || url.protocol;
        this.#hostname = options.hostname || url.hostname;
        this.#port = options.port || url.port || getDefaultPort( url.protocol );
        this.#username = options.username || decodeURIComponent( url.username );
        this.#password = options.password || decodeURIComponent( url.password );

        this.resolve = options.resolve ?? url.searchParams.get( "resolve" );
    }

    // options
    get _options () {
        return this.#options;
    }

    _set ( name, value ) {
        if ( value == null ) {
            if ( this.#options[ name ] != null ) {
                delete this.#options[ name ];

                this._updated();

                return true;
            }
        }
        else if ( this.#options[ name ] !== value ) {
            this.#options[ name ] = value;

            this._updated();

            return true;
        }
    }

    _buildOptions ( options ) {
        const _options = {};

        var value = options.resolve;

        if ( value === "true" || value === true ) value = true;
        else if ( value === "false" || value === false ) value = false;
        else value = null;

        if ( value != null ) _options.resolve = value;

        return _options;
    }

    // protocol
    get protocol () {
        return this.#protocol;
    }

    get isTls () {
        return false;
    }

    // hostname
    get hostname () {
        return this.#hostname;
    }

    set hostname ( value ) {
        value ||= "";

        // not updated
        if ( this.#hostname === value ) return;

        this.#hostname = value;

        this._updated();
    }

    // port
    get port () {
        return this.#port;
    }

    set port ( value ) {
        value ||= "";

        // not updated
        if ( this.#port === value ) return;

        this.#port = value;

        this._updated();
    }

    // username
    get username () {
        return this.#username;
    }

    set username ( value ) {
        value ||= "";

        // not updated
        if ( this.#username === value ) return;

        this.#username = value;

        this.#basicAuth = null;
        this._updated();
    }

    // password
    get password () {
        return this.#password;
    }

    set password ( value ) {
        value ||= "";

        // not updated
        if ( this.#password === value ) return;

        this.#password = value;

        this.#basicAuth = null;
        this._updated();
    }

    // resolve
    get resolve () {
        return this._options.resolve;
    }

    set resolve ( value ) {
        if ( value === "true" || value === true ) value = true;
        else if ( value === "false" || value === false ) value = false;
        else value = null;

        this._set( "resolve", value );
    }

    get basicAuth () {
        if ( this.#basicAuth == null && ( this.username !== "" || this.password !== "" ) ) {
            this.#basicAuth = Buffer.from( this.username.replaceAll( ":", "%3A" ) + ":" + this.password ).toBase64();
        }

        return this.#basicAuth;
    }

    get url () {
        if ( !this.#url ) {
            const url = this._buildUrl();

            url.searchParams.sort();

            this.#url = url;
        }

        return this.#url;
    }

    toString () {
        return this.url.href;
    }

    toJSON () {
        return this.url.href;
    }

    // protected
    _buildUrl () {
        var url;

        if ( this.protocol === "http:" ) {
            url = new URL( "http://local" );
        }
        else {
            url = new URL( this.protocol + "//" );
        }

        url.hostname = this.hostname;
        url.port = this.port;
        url.username = this.username;
        url.password = this.password;

        if ( this.resolve != null ) url.searchParams.set( "resolve", this.resolve );

        return url;
    }

    _updated () {
        this.#url = null;
    }
}
