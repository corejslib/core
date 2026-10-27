export default class SaslMethod {
    #sasl;

    constructor ( sasl ) {
        this.#sasl = sasl;
    }

    // properties
    get username () {
        return this.#sasl.username;
    }

    get password () {
        return this.#sasl.password;
    }
}
