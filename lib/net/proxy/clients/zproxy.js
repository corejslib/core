import mixins from "#lib/mixins";
import OptionsCity from "../mixins/city.js";
import OptionsCountry from "../mixins/country.js";
import OptionsRotating from "../mixins/rotating.js";
import OptionsSession from "../mixins/session.js";
import OptionsState from "../mixins/state.js";
import OptionsZone from "../mixins/zone.js";
import Upstream from "../upstream.js";

const DEFAULT_HOSTNAME = "proxy.softvisio.net",
    DEFAULT_PORT = 8085;

export default class ProxyClientZproxy extends mixins( OptionsZone, OptionsCountry, OptionsState, OptionsCity, OptionsSession, OptionsRotating, Upstream ) {
    #isTls = false;

    // properties
    get isHttp () {
        return true;
    }

    get isSocks5 () {
        return true;
    }

    get isTls () {
        return this.#isTls;
    }

    // public
    async getProxy ( options ) {
        const bucket = this._getBucket( options );

        if ( !bucket.proxy ) bucket.setProxy( this._buildProxy( bucket ) );

        return bucket.getProxy();
    }

    async getNextProxy ( options ) {
        return this.getProxy( options );
    }

    async getRandomProxy ( options ) {
        return this.getProxy( options );
    }

    // protected
    _init ( url, options = {} ) {
        if ( typeof url === "string" ) url = new URL( url );

        if ( super._init ) super._init( url, options );

        this.hostname ||= DEFAULT_HOSTNAME;
        this.port ||= DEFAULT_PORT;

        if ( this.protocol === "zproxy+tls:" ) {
            this.#isTls = true;
        }
    }

    _buildUrl () {
        const url = super._buildUrl();

        // remove default ports
        if ( +url.port === DEFAULT_PORT ) url.port = "";

        // remove default hostname
        if ( url.hostname === DEFAULT_HOSTNAME ) url.hostname = "";

        return url;
    }

    _buildProxy ( bucket ) {
        const proxy = super._buildProxy( bucket );

        const options = bucket.options;

        const username = new URLSearchParams();

        if ( proxy.username !== "" ) username.set( "username", proxy.username );

        if ( options.zone ) username.set( "zone", options.zone );
        if ( options.country ) username.set( "country", options.country );
        if ( options.state ) username.set( "state", options.state );
        if ( options.city ) username.set( "city", options.city );
        if ( options.resolve != null ) username.set( "resolve", options.resolve );
        if ( options.session ) username.set( "session", options.session );

        if ( options.rotateRequests != null ) username.set( "rotateRequests", options.rotateRequests );
        if ( options.rotateTimeout != null ) username.set( "rotateTimeout", options.rotateTimeout );
        if ( options.rotateRandom != null ) username.set( "rotateRandom", options.rotateRandom );

        proxy.username = username.toString();

        return proxy;
    }
}

ProxyClientZproxy.register( "zproxy:", ProxyClientZproxy );
ProxyClientZproxy.register( "zproxy+tls:", ProxyClientZproxy );
