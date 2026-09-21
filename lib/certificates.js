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
        "hash": "SHA-256",
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

export async function createCertificate ( { domains, maxAge, commonName, ...attributes } = {} ) {
    if ( !Array.isArray( domains ) ) domains = [ domains ];

    // create certificate
    const certificate = new pki.Certificate();
    certificate.version = 2;
    certificate.serialNumber = new asn1.Integer( { "value": 1 } );

    // issuer common name
    if ( commonName ) {
        certificate.issuer.typesAndValues.push( new pki.AttributeTypeAndValue( {
            "type": "2.5.4.3",
            "value": new asn1.BmpString( { "value": commonName } ),
        } ) );
    }

    // subject common name
    if ( domains[ 0 ] ) {
        certificate.subject.typesAndValues.push( new pki.AttributeTypeAndValue( {
            "type": "2.5.4.3",
            "value": new asn1.BmpString( { "value": domains[ 0 ] } ),
        } ) );
    }

    // attributes
    for ( const [ key, value ] of Object.entries( attributes ) ) {
        if ( !ATTRIBUTES[ key ] ) continue;

        certificate.issuer.typesAndValues.push( new pki.AttributeTypeAndValue( {
            "type": ATTRIBUTES[ key ],
            "value": new asn1.BmpString( { value } ),
        } ) );

        certificate.subject.typesAndValues.push( new pki.AttributeTypeAndValue( {
            "type": ATTRIBUTES[ key ],
            "value": new asn1.BmpString( { value } ),
        } ) );
    }

    // validity period
    certificate.notBefore.value = new Date();
    certificate.notAfter.value = Interval.new( maxAge || DEFAULT_MAX_AGE ).addDate();

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
    const basicConstr = new pki.BasicConstraints( {
        "cA": false,
    } );

    certificate.extensions.push( new pki.Extension( {
        "extnID": "2.5.29.19",
        "critical": true,
        "extnValue": basicConstr.toSchema().toBER( false ),
        "parsedValue": basicConstr,
    } ) );

    // "KeyUsage" extension
    const bitArray = new ArrayBuffer( 1 ),
        bitView = new Uint8Array( bitArray );

    bitView[ 0 ] |= 1 << 7; // Key usage "digitalSignature" flag
    bitView[ 0 ] |= 1 << 8; // Key usage "nonRepudiation" flag

    const keyUsage = new asn1.BitString( { "valueHex": bitArray } );

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
    .split( /(.{64})/v )
    .filter( line => line )
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
    if ( !Array.isArray( domains ) ) domains = [ domains ];

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
            "value": new asn1.BmpString( { value } ),
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

    // subject key identifier
    const subjectKeyIdentifier = await crypto.subtle.digest(
        {
            "name": "SHA-1",
        },
        csr.subjectPublicKeyInfo.subjectPublicKey.valueBlock.valueHex
    );

    // pkcs-9-at-extensionRequest
    csr.attributes.push( new pki.Attribute( {
        "type": "1.2.840.113549.1.9.14",
        "values": [
            new pki.Extensions( {
                "extensions": [

                    // id-ce-subjectKeyIdentifier
                    new pki.Extension( {
                        "extnID": "2.5.29.14",
                        "critical": false,
                        "extnValue": new asn1.OctetString( { "valueHex": subjectKeyIdentifier } ).toBER( false ),
                    } ),

                    // id-ce-subjectAltName
                    new pki.Extension( {
                        "extnID": "2.5.29.17",
                        "critical": false,
                        "extnValue": altNames.toSchema().toBER( false ),
                    } ),

                    // pkcs-9-at-challengePassword
                    // new pki.Extension( {
                    //     "extnID": "1.2.840.113549.1.9.7",
                    //     "critical": false,
                    //     "extnValue": new asn1.PrintableString( { "value": "passwordChallenge" } ).toBER( false ),
                    // } ),
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
