export default class CliCommand {
    #name;
    #config;
    #module;
    #aliases;

    constructor ( name, config ) {
        this.#name = name;
        this.#config = config;
        this.#aliases = config.alias
            ? Array.isArray( config.alias )
                ? config.alias
                : [ config.alias ]
            : null;
    }

    get name () {
        return this.#name;
    }

    get short () {
        return this.#config.short;
    }

    get aliases () {
        return this.#aliases;
    }

    get title () {
        return this.#config.title;
    }

    // public
    async getModule () {
        if ( !this.#config.module ) {
            const config = { ...this.#config };

            delete config.short;

            return config;
        }
        else {
            if ( !this.#module ) {
                let module = this.#config.module;

                if ( typeof module === "function" ) module = await module();

                if ( typeof module === "string" || module instanceof URL ) module = ( await import( module ) ).default;

                this.#module = module;
            }

            return this.#module;
        }
    }
}
