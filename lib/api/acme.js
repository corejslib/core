import "#lib/result";
import crypto from "node:crypto";
import dns from "node:dns";
import net from "node:net";
import { createCsr } from "#lib/certificates";
import fetch from "#lib/fetch";
import Hostname from "#lib/hostname";
import subnets from "#lib/ip/subnets";
import Counter from "#lib/threads/counter";
import Mutex from "#lib/threads/mutex";
import { sleep } from "#lib/utils";

const DIRECTORIES = {
        "letsencrypt": {
            "staging": "https://acme-staging-v02.api.letsencrypt.org/directory",
            "production": "https://acme-v02.api.letsencrypt.org/directory",
        },
        "zerossl": {
            "production": "https://acme.zerossl.com/v2/DV90",
        },
    },
    STATUSES = {
        "invalid": new Set( [ "invalid" ] ),
        "pending": new Set( [ "pending", "processing" ] ),
        "ready": new Set( [ "ready", "valid" ] ),
        "valid": new Set( [ "valid" ] ),
    },
    MAX_BAD_NONCE_RETRIES = 5,
    WAIT_FOR_VALID_STATUS_TIMEOUT = 5 * 60 * 1000, // ms
    GET_CERTIFICATE_TIMEOUT = 30 * 60 * 1000, // ms
    HTTP_CHALLENGE_TIMEOUT = 10 * 1000, // ms
    HTTP_CHALLENGE_MAX_REDIRECTS = 5,
    HTTP_CHALLENGE_MAX_SIZE = 4096; // bytes

function isPublicAddress ( address ) {
    return !subnets.get( "local" ).hasRangesIntersecting( address ) && !subnets.get( "private" ).hasRangesIntersecting( address );
}

// returns resolved public address or null
function resolvePublicAddress ( domain ) {
    return new Promise( resolve => {
        try {
            dns.lookup( domain, ( e, address ) => {
                try {
                    resolve( address && isPublicAddress( address )
                        ? address
                        : null );
                }
                catch {
                    resolve( null );
                }
            } );
        }
        catch {
            resolve( null );
        }
    } );
}

// dns.lookup wrapper, that rejects local and private addresses, used on every connection
function lookupPublicAddress ( hostname, options, callback ) {
    dns.lookup( hostname, options, ( e, address, family ) => {
        if ( e ) return callback( e );

        try {
            const addresses = Array.isArray( address )
                ? address
                : [ { address, family } ];

            for ( const item of addresses ) {
                if ( !isPublicAddress( item.address ) ) {
                    return callback( new Error( "Address is not public" ) );
                }
            }
        }
        catch ( e_ ) {
            return callback( e_ );
        }

        callback( null, address, family );
    } );
}

// separate dispatcher for http-01 challenge verification: no proxy, no keep-alive, local and private addresses are rejected on every connection
const challengeDispatcher = new fetch.Dispatcher( {
    "checkCertificate": false, // certificate is not important here, only challenge content is checked
    "pipelining": 0,
    "connect": {
        "lookup": lookupPublicAddress,
    },
} );

// returns http-01 challenge content or null, redirects are followed manually
async function fetchChallengeContent ( url ) {
    try {
        for ( let redirects = 0; redirects <= HTTP_CHALLENGE_MAX_REDIRECTS; redirects++ ) {
            const res = await fetch( url, {
                "dispatcher": challengeDispatcher,
                "redirect": "manual",
                "signal": AbortSignal.timeout( HTTP_CHALLENGE_TIMEOUT ),
            } );

            // redirect
            if ( res.is3xx ) {
                const location = res.headers.get( "location" );

                res.body?.destroy();

                if ( !location ) return null;

                url = new URL( location, url );

                // ACME server follows redirects to http and https on standard ports only
                if ( url.protocol !== "http:" && url.protocol !== "https:" ) return null;

                if ( url.port && url.port !== "80" && url.port !== "443" ) return null;

                // connection to ip address does not call lookup, so ip addresses are not allowed
                if ( net.isIP( url.hostname.replaceAll( /^\[|\]$/gv, "" ) ) ) return null;

                continue;
            }

            if ( !res.ok ) {
                res.body?.destroy();

                return null;
            }

            return await res.text( {
                "maxLength": HTTP_CHALLENGE_MAX_SIZE,
            } );
        }
    }
    catch {}

    return null;
}

function parseRetryAfter ( value ) {
    if ( !value ) return null;

    const seconds = Number( value );

    if ( Number.isFinite( seconds ) ) return seconds;

    const date = Date.parse( value );

    return Number.isNaN( date )
        ? null
        : Math.max( 0, Math.ceil( ( date - Date.now() ) / 1000 ) );
}

// converts domain to lower case ascii (punycode) form, wildcard prefix is preserved
function toAscii ( domain ) {
    domain = domain.toLowerCase();

    const wildcard = domain.startsWith( "*." );

    if ( wildcard ) domain = domain.slice( 2 );

    // invalid domain is returned as is and will be rejected by validation
    const ascii = new Hostname( domain ).ascii || domain;

    return wildcard
        ? "*." + ascii
        : ascii;
}

export default class Acme {
    #directory;
    #email;
    #accountKey;
    #accountUrl;
    #directories;
    #jwk;
    #nonce;
    #mutex = new Mutex();

    constructor ( { provider, test, email, accountKey, accountUrl } = {} ) {
        provider ||= "letsencrypt";

        this.#email = email;

        if ( accountKey ) {

            // from DER
            if ( Buffer.isBuffer( accountKey ) ) {
                accountKey = crypto.createPrivateKey( {
                    "key": accountKey,
                    "type": "pkcs8",
                    "format": "der",
                } );
            }

            // to PEM
            if ( typeof accountKey === "object" ) {
                accountKey = accountKey.export( {
                    "type": "pkcs8",
                    "format": "pem",
                } );
            }

            this.#accountKey = accountKey;
        }

        this.#accountUrl = accountUrl;

        if ( this.#accountUrl && !this.#accountKey ) {
            throw new Error( "ACME account key is required when account url is provided" );
        }

        const environment = test
            ? "staging"
            : "production";

        this.#directory = DIRECTORIES[ provider ]?.[ environment ];

        if ( !this.#directory ) {
            throw new Error( `ACME provider "${ provider }" does not support "${ environment }" environment` );
        }
    }

    // static
    static canGetCertificate ( domains ) {
        if ( !Array.isArray( domains ) ) domains = [ domains ];

        if ( !domains.length ) return false;

        if ( domains.length > 100 ) return false;

        for ( const domain of domains ) {
            try {

                // wildcard domain
                if ( domain.startsWith( "*." ) ) {
                    const hostname = new Hostname( domain.slice( 2 ) );

                    if ( !hostname.isDomain || !hostname.isValid || hostname.isTld || !hostname.tldIsValid || hostname.isPublicSuffix ) {
                        return false;
                    }
                }

                // regular domain
                else {
                    const hostname = new Hostname( domain );

                    if ( !hostname.isDomain || !hostname.isValid || hostname.isTld || !hostname.tldIsValid || hostname.isPublicSuffix ) {
                        return false;
                    }
                }
            }
            catch {
                return false;
            }
        }

        return true;
    }

    // properties
    get accountKey () {
        return this.#accountKey;
    }

    get accountUrl () {
        return this.#accountUrl;
    }

    // public
    async getCertificate ( options = {} ) {
        try {
            return await this.#issueCertificate( options );
        }
        catch ( e ) {
            return result.fromError( e );
        }
    }

    async createAccount () {
        var res;

        if ( !this.#accountUrl ) {

            // generate account key
            if ( this.#mutex.tryLock() ) {
                try {
                    if ( !this.#accountKey ) {
                        const keyPair = await new Promise( ( resolve, reject ) => {
                            crypto.generateKeyPair(
                                "ec",
                                {
                                    "namedCurve": "P-384",
                                },
                                ( e, publicKey, privateKey ) => {
                                    if ( e ) {
                                        reject( e );
                                    }
                                    else {
                                        resolve( { publicKey, privateKey } );
                                    }
                                }
                            );
                        } );

                        this.#accountKey = keyPair.privateKey.export( {
                            "type": "pkcs8",
                            "format": "pem",
                        } );
                    }

                    // create account
                    res = await this.#createAccount();
                }
                catch ( e ) {
                    res = result.fromError( e );
                }

                this.#mutex.unlock( res );
            }
            else {
                res = await this.#mutex.wait();
            }

            if ( !res.ok ) return res;
        }

        return result( 200 );
    }

    canGetCertificate ( domains ) {
        return this.constructor.canGetCertificate( domains );
    }

    // private
    async #issueCertificate ( { domains, checkDomain, createChallenge, deleteChallenge, timeout = GET_CERTIFICATE_TIMEOUT, ...attributes } = {} ) {
        var res;

        if ( !Array.isArray( domains ) ) domains = [ domains ];

        // domain names are case insensitive and ACME server works with ascii (punycode) form only
        domains = domains.map( domain => {
            return typeof domain === "string"
                ? toAscii( domain )
                : domain;
        } );

        // remove duplicates
        domains = [ ...new Set( domains ) ];

        // pre-check domains
        if ( !this.canGetCertificate( domains ) ) return result( [ 400, "Domains are not valid" ] );

        if ( typeof createChallenge !== "function" || typeof deleteChallenge !== "function" ) {
            return result( [ 400, "createChallenge and deleteChallenge callbacks are required" ] );
        }

        const deadline = Date.now() + timeout;

        // init
        if ( !this.#accountUrl ) {
            res = await this.createAccount();
            if ( !res.ok ) return res;
        }

        // prepare domains
        const baseDomains = new Set( domains.map( name => {
                return name.startsWith( "*." )
                    ? name.slice( 2 )
                    : name;
            } ) ),
            records = await Promise.all( [ ...baseDomains ].map( async domain => {
                return {
                    domain,
                    "dnsTxtRecordName": `_acme-challenge.${ domain }`,
                    "resolved": await resolvePublicAddress( domain ),
                };
            } ) ),
            index = Object.fromEntries( records.map( record => [ record.domain, record ] ) );

        // pre-check domains
        if ( checkDomain ) {
            let checked = true;

            const counter = new Counter();

            for ( const record of Object.values( index ) ) {
                const canGetCertificate = checkDomain( { ...record } );

                if ( canGetCertificate instanceof Promise ) {
                    counter.value++;

                    canGetCertificate
                        .then( canGetCertificate => {
                            if ( !canGetCertificate ) {
                                checked = false;
                            }

                            counter.value--;
                        } )
                        .catch( e => {
                            console.error( e );

                            checked = false;

                            counter.value--;
                        } );
                }
                else {
                    if ( !canGetCertificate ) checked = false;
                }
            }

            await counter.wait();

            if ( !checked ) return result( [ 400, "Domains check failed" ] );
        }

        // create order
        res = await this.#createOrder( {
            "identifiers": domains.map( domain => ( { "type": "dns", "value": domain } ) ),
        } );
        if ( !res.ok ) return res;

        const order = res.data;

        res = await this.#getAuthorizations( order );
        if ( !res.ok ) return res;

        const authorizations = res.data;

        for ( const authorization of authorizations ) {

            // timeout
            if ( Date.now() >= deadline ) return result( [ 500, "Timeout getting certificate" ] );

            // authorization is already valid (reused by ACME server)
            if ( authorization.status === "valid" ) continue;

            const record = index[ authorization.identifier.value ];

            let authorizationDone, challengeSubmitted, lastError;

            for ( const challenge of authorization.challenges ) {

                // timeout
                if ( Date.now() >= deadline ) return result( [ 500, "Timeout getting certificate" ] );

                // only http-01 and dns-01 are supported
                if ( challenge.type !== "http-01" && challenge.type !== "dns-01" ) continue;

                const type = challenge.type,
                    httpLocation = `/.well-known/acme-challenge/${ challenge.token }`,
                    token = challenge.token,
                    content = this.#getChallengeKeyAuthorization( challenge );

                if ( authorization.wildcard && type !== "dns-01" ) continue;

                if ( type === "http-01" && !record.resolved ) continue;

                try {

                    // create challenge
                    res = await createChallenge( {
                        ...record,
                        type,
                        httpLocation,
                        token,
                        content,
                    } );
                    if ( !res.ok ) throw res;

                    const dnsTtl = res.data?.dnsTtl;

                    // verify challenge
                    res = await this.#verifyChallenge( {
                        ...record,
                        type,
                        httpLocation,
                        token,
                        content,
                        dnsTtl,
                        deadline,
                    } );
                    if ( !res.ok ) throw res;

                    // complete challenge
                    res = await this.#completeChallenge( challenge );
                    if ( !res.ok ) throw res;

                    challengeSubmitted = true;

                    // wait for challenge verified
                    res = await this.#waitForValidStatus( challenge.url, { deadline } );
                    if ( !res.ok ) throw res;

                    authorizationDone = true;
                }
                catch ( e ) {
                    lastError = e;
                }

                // delete challenge
                try {
                    await deleteChallenge( {
                        ...record,
                        type,
                        httpLocation,
                        token,
                    } );
                }
                catch ( e ) {
                    console.error( e );
                }

                // if ACME server has rejected submitted challenge, authorization is invalid now and other challenges can't be used
                if ( authorizationDone || challengeSubmitted ) break;
            }

            // authorization failed
            if ( !authorizationDone ) {

                // deactivate authorization
                await this.#deactivateAuthorization( authorization );

                const name = authorization.wildcard
                        ? "*." + record.domain
                        : record.domain,
                    reason = lastError?.statusText || lastError?.message;

                return result( [ 500, `ACME failed authorize domain: "${ name }"` + ( reason
                    ? `: ${ reason }`
                    : "" ) ] );
            }
        }

        // create csr
        const { csr, privateKey } = await createCsr( domains, attributes );

        // finalize order
        res = await this.#finalizeOrder( order, csr );
        if ( !res.ok ) return res;

        res = await this.#getCertificate( res.data, { deadline } );
        if ( !res.ok ) return res;

        const x509Certificate = new crypto.X509Certificate( res.data );

        return result( 200, {
            "certificate": res.data.toString(),
            privateKey,
            "fingerprint": x509Certificate.fingerprint512,
            "expires": new Date( x509Certificate.validTo ),
        } );
    }

    async #createAccount () {
        const data = {
            "termsOfServiceAgreed": true,
        };

        if ( this.#email ) {
            data.contact = [ "mailto:" + this.#email ];
        }

        const res = await this.#apiResourceRequest( "newAccount", data, {
            "includeJwsKid": false,
        } );

        // account created
        if ( res.status === 200 || res.status === 201 ) {
            this.#accountUrl = res.meta.location;
        }

        return res;
    }

    async #createOrder ( data ) {
        const res = await this.#apiResourceRequest( "newOrder", data );

        if ( res.status !== 201 ) {
            return res;
        }
        else if ( !res.meta.location ) {
            return result( [ 500, "ACME order url not returned" ] );
        }
        else {
            res.data.url = res.meta.location;

            return result( 200, res.data );
        }
    }

    async #getAuthorizations ( order ) {
        const data = [];

        if ( order.authorizations ) {
            for ( const url of order.authorizations ) {
                const res = await this.#apiRequest( url );

                if ( !res.ok ) return res;

                res.data.url = url;

                data.push( res.data );
            }
        }

        return result( 200, data );
    }

    #getChallengeKeyAuthorization ( challenge ) {
        const jwk = this.#getJwk(),
            keysum = crypto.createHash( "SHA256" ).update( JSON.stringify( jwk ) ),
            thumbprint = keysum.digest( "base64url" ),
            res = `${ challenge.token }.${ thumbprint }`;

        if ( challenge.type === "http-01" ) {
            return res;
        }
        else if ( challenge.type === "dns-01" || challenge.type === "tls-alpn-01" ) {
            const shasum = crypto.createHash( "SHA256" ).update( res );

            return shasum.digest( "base64url" );
        }
    }

    async #verifyChallenge ( { type, domain, dnsTxtRecordName, httpLocation, content, dnsTtl, deadline = Infinity } ) {
        var attempt,
            interval = 3; // seconds

        if ( type === "http-01" ) {
            attempt = 10;
        }
        else if ( type === "dns-01" ) {
            dnsTtl ||= 60; // seconds
            attempt = 2;
            interval = dnsTtl + 1;
        }
        else {
            attempt = 10;
        }

        while ( true ) {

            // http
            if ( type === "http-01" ) {
                const text = await fetchChallengeContent( new URL( `http://${ domain }${ httpLocation }` ) );

                if ( text === content ) {
                    return result( 200 );
                }
            }

            // dns
            else if ( type === "dns-01" ) {
                const resolver = new dns.Resolver();
                resolver.setServers( [ "1.1.1.1" ] );

                const res = await new Promise( resolve => {
                    resolver.resolveTxt( dnsTxtRecordName, ( error, records ) => {
                        if ( error ) return resolve( result.fromError( error, { "log": false } ) );

                        if ( records ) {
                            for ( const record of records ) {
                                for ( const value of record ) {
                                    if ( value === content ) return resolve( result( 200 ) );
                                }
                            }
                        }

                        resolve( result( 500 ) );
                    } );
                } );

                if ( res.ok ) return result( 200 );
            }

            // not supported
            else {
                return result( [ 400, "Challenge type is not supported" ] );
            }

            attempt--;

            if ( attempt <= 0 || Date.now() >= deadline ) break;

            await sleep( interval * 1000 );
        }

        return result( [ 500, "Challenge verification error" ] );
    }

    async #completeChallenge ( challenge ) {
        return this.#apiRequest( challenge.url, {} );
    }

    async #waitForValidStatus ( url, { name = "Challenge", completeStatuses = STATUSES.ready, deadline = Infinity } = {} ) {
        const timeout = Math.min( Date.now() + WAIT_FOR_VALID_STATUS_TIMEOUT, deadline );

        while ( true ) {
            const res = await this.#apiRequest( url );

            // request error
            if ( !res.ok ) return res;

            // complete
            if ( completeStatuses.has( res.data.status ) ) {
                return res;
            }

            // invalid
            else if ( STATUSES.invalid.has( res.data.status ) ) {
                return result( [ 500, `${ name } is not valid` ] );
            }

            // pending (or not yet in the target status)
            else if ( STATUSES.pending.has( res.data.status ) || STATUSES.ready.has( res.data.status ) ) {
                if ( Date.now() >= timeout ) return result( [ 500, "Timeout waiting for valid status" ] );

                await sleep( 3000 );
            }

            // unknown status (deactivated, expired, revoked, etc.)
            else {
                return result( [ 500, `Unexpected status: ${ res.data.status }` ] );
            }
        }
    }

    async #deactivateAuthorization ( authorization ) {
        const data = {
            "status": "deactivated",
        };

        const res = await this.#apiRequest( authorization.url, data );

        if ( !res.ok ) return res;

        res.data.url = authorization.url;

        return res;
    }

    async #finalizeOrder ( order, csr ) {
        const res = await this.#apiRequest( order.finalize, {
            csr,
        } );

        if ( !res.ok ) return res;

        res.data.url = order.url;

        return res;
    }

    async #getCertificate ( order, { deadline } = {} ) {
        var res;

        if ( !STATUSES.valid.has( order.status ) ) {
            res = await this.#waitForValidStatus( order.url, {
                "name": "Order",
                "completeStatuses": STATUSES.valid,
                deadline,
            } );

            if ( !res.ok ) return res;

            order = res.data;
        }

        if ( !order.certificate ) {
            return result( [ 500, "Unable to download certificate, URL not found" ] );
        }

        res = await this.#apiRequest( order.certificate, null, {
            "accept": "application/pem-certificate-chain",
        } );

        if ( !res.ok ) return res;

        if ( !Buffer.isBuffer( res.data ) ) {
            return result( [ 500, "Unexpected certificate format returned by ACME server" ] );
        }

        return res;
    }

    async #getResourceUrl ( resource ) {
        if ( !this.#directories ) {
            const res = await this.#getDirectories();

            if ( !res.ok ) return res;
        }

        const url = this.#directories[ resource ];

        if ( !url ) return result( [ 400, "Resource url not found" ] );

        return result( 200, url );
    }

    async #getDirectories () {
        if ( !this.#directories ) {
            try {
                const res = await fetch( this.#directory );

                if ( !res.ok ) return res;

                const directories = await res.json();

                if ( !directories || typeof directories !== "object" ) {
                    return result( [ 500, "Invalid ACME directory" ] );
                }

                this.#directories = directories;
            }
            catch ( e ) {
                return result.fromError( e );
            }
        }

        return result( 200, this.#directories );
    }

    async #apiRequest ( url, data, { includeJwsKid = true, accept = null } = {} ) {
        const kid = includeJwsKid
            ? this.#accountUrl
            : null;

        const res = await this.#signedRequest( url, data, {
            kid,
            accept,
        } );

        return res;
    }

    async #apiResourceRequest ( resource, data, { includeJwsKid = true } = {} ) {
        var res;

        res = await this.#getResourceUrl( resource );
        if ( !res.ok ) return res;

        const url = res.data;

        return this.#apiRequest( url, data, {
            includeJwsKid,
        } );
    }

    async #signedRequest ( url, payload, { kid = null, accept = null } = {}, attempts = 0 ) {

        // nonce can be used only once, use nonce from the previous response or request a new one
        let nonce = this.#nonce;

        this.#nonce = null;

        if ( !nonce ) {
            const res = await this.#getNonce();
            if ( !res.ok ) return res;

            nonce = res.data;
        }

        // sign body and send request
        const data = this.#createSignedBody( url, payload, { nonce, kid } ),
            headers = {
                "content-type": "application/jose+json",
            };

        if ( accept ) headers.accept = accept;

        let res, body, isCertificate, meta;

        try {
            res = await fetch( url, {
                "method": "POST",
                headers,
                "body": JSON.stringify( data ),
            } );

            // every response contains fresh nonce, save it for the next request
            const replayNonce = res.headers.get( "replay-nonce" );

            if ( replayNonce ) this.#nonce = replayNonce;

            isCertificate = res.ok && res.headers.contentType.type === "application/pem-certificate-chain";

            body = isCertificate
                ? await res.buffer()
                : await res.json().catch( () => null );

            meta = {
                "location": res.headers.get( "location" ),
                "link": res.headers.get( "link" ),

                // seconds, useful for rate limit errors
                "retryAfter": parseRetryAfter( res.headers.get( "retry-after" ) ),
            };
        }
        catch ( e ) {
            return result.fromError( e );
        }

        // retry on bad nonce - https://tools.ietf.org/html/draft-ietf-acme-acme-10#section-6.4
        if ( !isCertificate && res.status === 400 && body?.type === "urn:ietf:params:acme:error:badNonce" && attempts < MAX_BAD_NONCE_RETRIES ) {
            return this.#signedRequest(
                url,
                payload,
                {
                    kid,
                    accept,
                },
                attempts + 1
            );
        }

        return result( [ res.status, body?.detail ], body, meta );
    }

    async #getNonce () {
        var res;

        res = await this.#getResourceUrl( "newNonce" );
        if ( !res.ok ) return res;

        let nonce;

        try {
            res = await fetch( res.data, {
                "method": "HEAD",
            } );
            if ( !res.ok ) return res;

            nonce = res.headers.get( "replay-nonce" );
        }
        catch ( e ) {
            return result.fromError( e );
        }

        if ( !nonce ) {
            return result( [ 500, "Get nonce failed" ] );
        }
        else {
            return result( 200, nonce );
        }
    }

    #createSignedBody ( url, payload = null, { nonce = null, kid = null } = {} ) {
        const jwk = this.#getJwk();

        let headerAlg = "RS256",
            signerAlg = "SHA256";

        // https://datatracker.ietf.org/doc/html/rfc7518#section-3.1
        if ( jwk.crv && jwk.kty === "EC" ) {
            headerAlg = "ES256";

            if ( jwk.crv === "P-384" ) {
                headerAlg = "ES384";
                signerAlg = "SHA384";
            }
            else if ( jwk.crv === "P-521" ) {
                headerAlg = "ES512";
                signerAlg = "SHA512";
            }
        }

        // prepare body and signer
        const res = this.#prepareSignedBody( headerAlg, url, payload, { nonce, kid } );

        const signer = crypto.createSign( signerAlg ).update( `${ res.protected }.${ res.payload }`, "utf8" );

        // signature - https://stackoverflow.com/questions/39554165
        res.signature = signer.sign(
            {
                "key": this.#accountKey,
                "padding": crypto.constants.RSA_PKCS1_PADDING,
                "dsaEncoding": "ieee-p1363",
            },
            "base64url"
        );

        return res;
    }

    #getJwk () {
        if ( !this.#jwk ) {
            const jwk = crypto.createPublicKey( this.#accountKey ).export( {
                "format": "jwk",
            } );

            // sort keys
            this.#jwk = Object.keys( jwk )
                .sort()
                .reduce( ( result, key ) => {
                    result[ key ] = jwk[ key ];

                    return result;
                }, {} );
        }

        return this.#jwk;
    }

    #prepareSignedBody ( alg, url, payload = null, { nonce = null, kid = null } = {} ) {
        const header = { alg, url };

        // nonce
        if ( nonce ) {
            header.nonce = nonce;
        }

        // kID or jwk
        if ( kid ) {
            header.kid = kid;
        }
        else {
            header.jwk = this.#getJwk();
        }

        return {
            "payload": payload
                ? Buffer.from( JSON.stringify( payload ) ).toString( "base64url" )
                : "",
            "protected": Buffer.from( JSON.stringify( header ) ).toString( "base64url" ),
        };
    }
}
