import crypto from "node:crypto";
import SaslMethod from "#lib/sasl/method";

const METHOD = "CRAM-MD5";

export default class SaslCramMd5 extends SaslMethod {

    // static
    static get method () {
        return METHOD;
    }

    // properties
    get method () {
        return METHOD;
    }

    // public
    continue ( response ) {
        if ( !response ) {
            return this.method;
        }
        else {
            const challenge = Buffer.from( response, "base64" ).toString( "ascii" ),
                hmacMd5 = crypto.createHmac( "MD5", this.password );

            hmacMd5.update( challenge );

            return Buffer.from( this.username + " " + hmacMd5.digest( "hex" ) ).toString( "base64" );
        }
    }
}
