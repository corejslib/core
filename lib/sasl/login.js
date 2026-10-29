import SaslMethod from "#lib/sasl/method";

const METHOD = "LOGIN";

export default class SaslLogin extends SaslMethod {

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
        else if ( response === "VXNlcm5hbWU6" ) {
            return Buffer.from( this.username ).toBase64();
        }
        else if ( response === "UGFzc3dvcmQ6" ) {
            return Buffer.from( this.password ).toBase64();
        }
    }
}
