import childProcess from "node:child_process";
import fs from "node:fs";
import * as certificates from "#lib/certificates";
import DigitalSize from "#lib/digital-size";
import ejs from "#lib/ejs";
import { pathExists } from "#lib/fs";
import Interval from "#lib/interval";
import IpRange from "#lib/ip/range";
import subnets from "#lib/ip/subnets";
import mime from "#lib/mime";
import Counter from "#lib/threads/counter";
import Mutex from "#lib/threads/mutex";
import { sleep } from "#lib/utils";
import NginxConfig from "./nginx/config.js";
import Docker from "./nginx/docker.js";
import NginxProxies from "./nginx/proxies.js";
import NginxProxyServerName from "./nginx/proxy/server-name.js";

const nginxConfigTemplate = ejs.fromFile( new URL( "resources/nginx.conf", import.meta.url ) );

export default class Nginx {
    #app;
    #config;

    #dataDir;
    #cacheDir;
    #configsDir;
    #configPath;
    #setRealIpFromPath;
    #gzipMimeTypesPath;

    #docker;

    #mutexSet = new Mutex.Set();
    #proxies;
    #activityCounter = new Counter();

    #proc;
    #isStarted = false;
    #isDestroying = false;
    #pendingReload = false;

    #defaultServerName;

    #setRealIpFromSubnets;

    constructor ( app, config ) {
        this.#app = app;
        this.#config = config;

        this.#dataDir = this.#app.env.dataDir + "/nginx";

        this.#cacheDir ??= this.#dataDir + "/cache";

        this.#configsDir = this.app.env.tmpDir + "/nginx";

        this.#configPath ??= this.#configsDir + "/nginx.conf";

        this.#setRealIpFromPath = this.#configsDir + "/set-real-ip-from.nginx.conf";
        this.#gzipMimeTypesPath = this.#configsDir + "/gzip-mime-types.nginx.conf";

        this.#proxies = new NginxProxies( this );

        process.on( "exit", () => this.#proc?.kill( "SIGTERM" ) );

        subnets.on( "add", this.#onSubnetsUpdate.bind( this ) );
        subnets.on( "delete", this.#onSubnetsUpdate.bind( this ) );
        subnets.on( "update", this.#onSubnetsUpdate.bind( this ) );
    }

    // properties
    get app () {
        return this.#app;
    }

    get config () {
        return this.#config;
    }

    get isStarted () {
        return this.#isStarted;
    }

    get isDestroying () {
        return this.#isDestroying;
    }

    get dataDir () {
        return this.#dataDir;
    }

    get cacheDir () {
        return this.#cacheDir;
    }

    get configsDir () {
        return this.#configsDir;
    }

    get setRealIpFromPath () {
        return this.#setRealIpFromPath;
    }

    get gzipMimeTypesPath () {
        return this.#gzipMimeTypesPath;
    }

    get privateHrrpServerUpstream () {
        const component = this.app.components.get( "privateHttpServer" );

        if ( !component ) return null;

        return "private-http-server";
    }

    get proxies () {
        return this.#proxies;
    }

    get listenIpV4 () {
        return !this.config.listenIpFamily || this.config.listenIpFamily === 4;
    }

    get listenIpV6 () {
        return !this.config.listenIpFamily || this.config.listenIpFamily === 6;
    }

    get defaultServerName () {
        return ( this.#defaultServerName ??= new NginxProxyServerName( this ) );
    }

    get dhParamsPath () {
        return certificates.dhParamsPath;
    }

    // public
    async start () {
        var res;

        if ( this.#isStarted ) return result( 200 );

        await this.#updateConfig();

        res = await this.test();
        if ( !res.ok ) return res;

        this.#activityCounter.value++;

        // start nginx
        this.#proc = childProcess.spawn( "nginx", [ "-c", this.#configPath ], {
            "detached": true,
            "stdio": "inherit",
        } );

        this.#proc.on( "exit", this.#onNginxExit.bind( this ) );

        this.#isStarted = true;

        // start docker swarm listener
        if ( this.config.dockerEnabled ) {
            this.#docker = new Docker( this );

            await this.#docker.start();
        }

        return result( 200 );
    }

    async destroy () {
        this.#isDestroying = true;

        // stop docker watcher
        await this.#docker?.stop();
        this.#docker = null;

        // stop nginx
        return this._stop();
    }

    async reload () {
        return this.#updateConfig();
    }

    async test () {
        if ( this.isDestroying ) return result( [ 400, "Nginx is destroying" ] );

        const mutex = this.#mutexSet.get( "test" );

        await mutex.lock();

        const res = await new Promise( resolve => {
            childProcess.execFile(
                "nginx",
                [ "-t", "-c", this.#configPath ],
                {
                    "encoding": "utf8",
                    "maxBuffer": Infinity,
                },
                ( error, stdout, stderr ) => {
                    if ( error ) {
                        resolve( result( [ 400, stderr ] ) );
                    }
                    else {
                        resolve( result( 200 ) );
                    }
                }
            );
        } );

        mutex.unlock();

        return res;
    }

    validatePort ( port ) {
        if ( !port ) return;

        port = Number( port );

        if ( port < 1 || port > 65_535 ) return;

        return port;
    }

    // protected
    async _stop () {
        this.#proc?.kill( "SIGTERM" );

        return this.#activityCounter.wait();
    }

    async _stopGraceful () {
        this.#proc?.kill( "SIGQUIT" );

        return this.#activityCounter.wait();
    }

    _stopWorkersGraceful () {
        this.#proc?.kill( "SIGWINCH" );
    }

    _upgradeExecutable () {
        this.#proc?.kill( "SIGUSR2" );
    }

    _reopenLogFiles () {
        this.#proc?.kill( "SIGUSR1" );
    }

    // private
    #onNginxExit ( code, signal ) {
        this.#isStarted = false;

        this.#proc = null;

        this.#docker?.stop();
        this.#docker = null;

        console.log( `[nginx] process exited, code: ${ code }` );

        this.#activityCounter.value--;

        process.destroy( { code } );
    }

    async #updateConfig () {
        const mutex = this.#mutexSet.get( "reload" );

        if ( !mutex.tryLock() ) {
            this.#pendingReload = true;

            return mutex.wait();
        }

        // wait for nginx reloaded
        await sleep( 1000 );

        var config;

        while ( true ) {
            this.#pendingReload = false;

            // remove all configs
            fs.rmSync( this.configsDir, { "recursive": true, "force": true } );

            // create http cache directory
            if ( !( await pathExists( this.#cacheDir ) ) ) fs.mkdirSync( this.#cacheDir, { "recursive": true } );

            config = new NginxConfig( this );

            await config.generate();

            if ( !this.#pendingReload ) break;
        }

        // write nginx config
        this.#writeNginxConfig();

        this.#proc?.kill( "SIGHUP" );

        mutex.unlock();
    }

    #writeNginxConfig () {

        // generate nginx config
        const config = nginxConfigTemplate.render( {
            "nginx": this,

            "maxBodySize": DigitalSize.new( this.config.maxBodySize ).toNginx(),

            "cacheMaxSize": DigitalSize.new( this.config.cacheMaxSize ).toNginx(),
            "cacheMinFree": DigitalSize.new( this.config.cacheMinFree ).toNginx(),
            "cacheInactive": Interval.new( this.config.cacheInactive ).toNginx(),
            "cacheBypass": this.config.cacheBypass,
        } );

        // deploy nginx config
        fs.mkdirSync( this.configsDir, { "recursive": true } );
        fs.writeFileSync( this.#configPath, config );

        this.#writeSetRealIpFromConfig();
        this.#writeGzipMimeTypesConfig();
    }

    #writeSetRealIpFromConfig () {
        this.#setRealIpFromSubnets = new Set();

        fs.writeFileSync( this.#setRealIpFromPath, this.#buildSetRealIpFrom( this.#config.setRealIpFrom ) );
    }

    #writeGzipMimeTypesConfig () {
        const types = [

            //
            "gzip_types",

            "application/json",
            "text/css",
            "test/javascript",
            "text/plain",
        ];

        for ( const type of mime ) {
            if ( type.essence === "text/html" ) continue;

            // if ( type.compressible ) types.push( type.essence );
        }

        fs.writeFileSync( this.#gzipMimeTypesPath, types.join( "\n" ) + "\n;\n" );
    }

    #buildSetRealIpFrom ( config ) {
        const setRealIpFrom = [ "# unix socket\nset_real_ip_from    unix:;\n" ];

        const ranges = {};

        if ( config?.length ) {
            for ( const subnet of config ) {
                if ( IpRange.isValid( subnet ) ) {
                    ranges.custom ||= [];

                    ranges.custom.push( subnet );
                }
                else {
                    this.#setRealIpFromSubnets.add( subnet );

                    const range = subnets.get( subnet )?.toJSON();

                    if ( !range?.length ) continue;

                    ranges[ subnet ] = range;
                }
            }
        }

        for ( const range of Object.keys( ranges ).sort() ) {
            setRealIpFrom.push( `# ${ range }\n` + ranges[ range ].map( cidr => `set_real_ip_from    ${ cidr };\n` ).join( "" ) );
        }

        return setRealIpFrom.join( "\n" );
    }

    #onSubnetsUpdate ( name ) {
        if ( this.#setRealIpFromSubnets?.has( name ) ) this.reload();
    }
}
