export default class CliCommand {
    #name;
    #spec;
    #module;
    #aliases;

    constructor ( name, spec ) {
        this.#name = name;
        this.#spec = spec;
        this.#aliases = spec.alias
            ? Array.isArray( spec.alias )
                ? spec.alias
                : [ spec.alias ]
            : null;
    }

    get name () {
        return this.#name;
    }

    get short () {
        return this.#spec.short;
    }

    get aliases () {
        return this.#aliases;
    }

    get title () {
        return this.#spec.title;
    }

    // public
    async getModule () {
        if ( !this.#spec.module ) {
            const config = { ...this.#spec };

            delete config.short;

            return config;
        }
        else {
            if ( !this.#module ) {
                let module = this.#spec.module;

                if ( typeof module === "function" ) module = await module();

                if ( typeof module === "string" || module instanceof URL ) module = ( await import( module ) ).default;

                this.#module = module;
            }

            return this.#module;
        }
    }
}
