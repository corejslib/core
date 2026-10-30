import SaslMethod from "./method.js";

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
        return Buffer.from( "\0" + this.username + "\0" + this.password ).toBase64();
    }
}
