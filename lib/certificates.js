import crypto from "node:crypto";
import * as asn1 from "asn1js";
import * as pki from "pkijs";
import externalResources from "#lib/external-resources";
import Interval from "#lib/interval";

// set crypto engine
pki.setEngine( "nodejs", new pki.CryptoEngine( { crypto } ) );

const DEFAULT_MAX_AGE = "10 years",
    ALGORITHM = {
        "name": "ECDSA",
        "namedCurve": "P-384",
        "hash": "SHA-384",
    },

    // https://www.alvestrand.no/objectid/2.5.4.html
    ATTRIBUTES = {
        "organizationName": "2.5.4.10",
        "organizationalUnitName": "2.5.4.11",
        "countryName": "2.5.4.6",
        "localityName": "2.5.4.7",
        "stateOrProvinceName": "2.5.4.8",
        "streetAddress": "2.5.4.9",
        "postalCode": "2.5.4.17",

        "title": "2.5.4.12",
        "description": "2.5.4.13",
        "businessCategory": "2.5.4.15",

        "name": "2.5.4.41",
        "givenName": "2.5.4.42",
        "surname": "2.5.4.4",
        "initials": "2.5.4.43",
    },
    CERTIFICATES_RESOURCE = await externalResources.add( "corejslib/core/resources/certificates" ).check(),
    DH_PARAMS_RESOURCE = await externalResources.add( "corejslib/core/resources/dh-params" ).check();

export const dhParamsPath = DH_PARAMS_RESOURCE.getResourcePath( "dh-params.pem" ),
    localDomain = "local.softvisio.net",
    localCertificatePath = CERTIFICATES_RESOURCE.getResourcePath( "local/certificate.pem" ),
    localPrivateKeyPath = CERTIFICATES_RESOURCE.getResourcePath( "local/private-key.pem" );

// RFC 5280: countryName must be PrintableString, everything else - UTF8String
function createAttributeValue ( type, value ) {
    return type === "countryName"
        ? new asn1.PrintableString( { "value": value } )
        : new asn1.Utf8String( { "value": value } );
}

function normalizeDomains ( domains ) {
    return [ domains ].flat().filter( domain => domain );
}

export async function createCertificate ( { domains, maxAge, commonName, ...attributes } = {} ) {
    domains = normalizeDomains( domains );

    // create certificate
    const certificate = new pki.Certificate();
    certificate.version = 2;
    certificate.serialNumber = new asn1.Integer( { "value": 1 } );

    // issuer common name, issuer must not be empty
    if ( commonName || domains[ 0 ] ) {
        certificate.issuer.typesAndValues.push( new pki.AttributeTypeAndValue( {
            "type": "2.5.4.3",
            "value": new asn1.Utf8String( { "value": commonName || domains[ 0 ] } ),
        } ) );
    }

    // subject common name
    if ( domains[ 0 ] ) {
        certificate.subject.typesAndValues.push( new pki.AttributeTypeAndValue( {
            "type": "2.5.4.3",
            "value": new asn1.Utf8String( { "value": domains[ 0 ] } ),
        } ) );
    }

    // attributes
    for ( const [ key, value ] of Object.entries( attributes ) ) {
        if ( !ATTRIBUTES[ key ] ) continue;

        certificate.issuer.typesAndValues.push( new pki.AttributeTypeAndValue( {
            "type": ATTRIBUTES[ key ],
            "value": createAttributeValue( key, value ),
        } ) );

        certificate.subject.typesAndValues.push( new pki.AttributeTypeAndValue( {
            "type": ATTRIBUTES[ key ],
            "value": createAttributeValue( key, value ),
        } ) );
    }

    // XXX https://github.com/PeculiarVentures/PKI.js/issues/588
    // validity period
    // eslint-disable-next-line unicorn/prefer-temporal
    certificate.notBefore.value = new Date( Temporal.Now.instant().toString() );

    // XXX https://github.com/PeculiarVentures/PKI.js/issues/588
    // eslint-disable-next-line unicorn/prefer-temporal
    certificate.notAfter.value = new Date( Interval.new( maxAge || DEFAULT_MAX_AGE )
        .addDate()
        .toString() );

    // extensions are not a part of certificate by default, it's an optional array
    certificate.extensions = [];

    // subject alternative name
    if ( domains.length ) {
        const altNames = new pki.GeneralNames( {
            "names": domains.map( domain => {
                return new pki.GeneralName( {
                    "type": 2,
                    "value": domain,
                } );
            } ),
        } );

        certificate.extensions.push( new pki.Extension( {
            "extnID": "2.5.29.17",
            "critical": false,
            "extnValue": altNames.toSchema().toBER( false ),
        } ) );
    }

    // "BasicConstraints" extension
    const basicConstraints = new pki.BasicConstraints( {
        "cA": false,
    } );

    certificate.extensions.push( new pki.Extension( {
        "extnID": "2.5.29.19",
        "critical": true,
        "extnValue": basicConstraints.toSchema().toBER( false ),
        "parsedValue": basicConstraints,
    } ) );

    // "KeyUsage" extension
    // bit 0 is the most significant bit of the first byte
    const bitArray = new ArrayBuffer( 1 ),
        bitView = new Uint8Array( bitArray );

    bitView[ 0 ] |= 1 << 7; // Key usage "digitalSignature" flag (bit 0)
    bitView[ 0 ] |= 1 << 6; // Key usage "nonRepudiation" flag (bit 1)

    const keyUsage = new asn1.BitString( {
        "valueHex": bitArray,
        "unusedBits": 6,
    } );

    certificate.extensions.push( new pki.Extension( {
        "extnID": "2.5.29.15",
        "critical": true,
        "extnValue": keyUsage.toBER( false ),
        "parsedValue": keyUsage,
    } ) );

    // generate key pair
    const keyPair = await crypto.subtle.generateKey( ALGORITHM, true, [ "sign", "verify" ] );

    // exporting public key into "subjectPublicKeyInfo" value of certificate
    await certificate.subjectPublicKeyInfo.importKey( keyPair.publicKey );

    // signing final certificate
    await certificate.sign( keyPair.privateKey, ALGORITHM.hash );

    return {
        "certificate": `-----BEGIN CERTIFICATE-----
${ certificate
    .toString( "base64" )
    .match( /.{1,64}/gv )
    .join( "\n" ) }
-----END CERTIFICATE-----
`,
        "privateKey": crypto.KeyObject.from( keyPair.privateKey ).export( {
            "type": "pkcs8",
            "format": "pem",
        } ),
    };
}

export async function createCsr ( domains, attributes = {} ) {
    domains = normalizeDomains( domains );

    if ( !domains.length ) throw new Error( "At least one domain is required" );

    // generate key pair
    const keyPair = await crypto.subtle.generateKey( ALGORITHM, true, [ "sign", "verify" ] );

    const csr = new pki.CertificationRequest();

    // subject common name
    csr.subject.typesAndValues.push( new pki.AttributeTypeAndValue( {
        "type": "2.5.4.3",
        "value": new asn1.Utf8String( { "value": domains[ 0 ] } ),
    } ) );

    // attributes
    for ( const [ key, value ] of Object.entries( attributes ) ) {
        if ( !ATTRIBUTES[ key ] ) continue;

        csr.subject.typesAndValues.push( new pki.AttributeTypeAndValue( {
            "type": ATTRIBUTES[ key ],
            "value": createAttributeValue( key, value ),
        } ) );
    }

    await csr.subjectPublicKeyInfo.importKey( keyPair.publicKey );

    csr.attributes = [];

    // subject alternative name
    const altNames = new pki.GeneralNames( {
        "names": domains.map( domain => {
            return new pki.GeneralName( {
                "type": 2,
                "value": domain,
            } );
        } ),
    } );

    // pkcs-9-at-extensionRequest
    csr.attributes.push( new pki.Attribute( {
        "type": "1.2.840.113549.1.9.14",
        "values": [
            new pki.Extensions( {
                "extensions": [

                    // id-ce-subjectAltName
                    new pki.Extension( {
                        "extnID": "2.5.29.17",
                        "critical": false,
                        "extnValue": altNames.toSchema().toBER( false ),
                    } ),
                ],
            } ).toSchema(),
        ],
    } ) );

    // signing final PKCS#10 request
    await csr.sign( keyPair.privateKey, ALGORITHM.hash );

    return {
        "csr": csr.toString( "base64url" ),
        "privateKey": crypto.KeyObject.from( keyPair.privateKey ).export( {
            "type": "pkcs8",
            "format": "pem",
        } ),
    };
}
