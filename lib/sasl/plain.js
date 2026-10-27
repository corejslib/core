import SaslMethod from "#lib/sasl/method";

const METHOD = "PLAIN";

export default class SaslPlain extends SaslMethod {

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
        return Buffer.from( "\0" + this.username + "\0" + this.password ).toString( "base64" );
    }
}
