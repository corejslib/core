import Locale from "#lib/locale";

export default class Locales {
    #locales;
    #defaultLocale;
    #localesBuilt;
    #languageLocale;
    #regionLocale;

    constructor ( locales, { defaultLocale } = {} ) {
        this.#locales = new Map();

        if ( locales ) {
            for ( const locale of locales ) {
                if ( !Locale.isValid( locale ) ) continue;

                this.#locales.set( locale, null );
            }
        }

        if ( !this.#locales.has( defaultLocale ) ) {
            if ( this.#locales.size === 1 ) {
                defaultLocale = this.#locales.keys().toArray()[ 0 ];
            }
            else {
                defaultLocale = Locale.defaultLocale;
            }
        }

        this.#defaultLocale = defaultLocale;
    }

    // properties
    get defaultLocale () {
        return this.#defaultLocale;
    }

    get size () {
        return this.#locales.size;
    }

    get locales () {
        return this.#locales.keys().toArray();
    }

    get languages () {
        if ( !this.#localesBuilt ) this.#buildLocales();

        return Object.keys( this.#languageLocale );
    }

    get reuin () {
        if ( !this.#localesBuilt ) this.#buildLocales();

        return Object.keys( this.#regionLocale );
    }

    // public
    has ( locale ) {
        return this.#locales.has( locale );
    }

    get ( locale ) {
        if ( !this.#localesBuilt ) this.#buildLocales();

        return this.#locales.get( locale );
    }

    getLanguageLocale ( language ) {
        if ( !this.#localesBuilt ) this.#buildLocales();

        return this.#languageLocale[ language ];
    }

    getRegionLocale ( country ) {
        if ( !this.#localesBuilt ) this.#buildLocales();

        return this.#regionLocale[ country ];
    }

    find ( { locale, language, region } = {} ) {
        if ( this.#locales.size <= 1 ) {
            return this.defaultLocale;
        }
        else if ( locale && this.#locales.has( locale ) ) {
            return locale;
        }
        else {
            if ( !this.#localesBuilt ) this.#buildLocales();

            if ( language && region && this.#locales.has( language + "-" + region ) ) {
                return language + "-" + region;
            }
            else if ( language && this.#languageLocale[ language ] ) {
                return this.#languageLocale[ language ];
            }
            else if ( region && this.#regionLocale[ region ] ) {
                return this.#regionLocale[ region ];
            }
            else {
                return this.defaultLocale;
            }
        }
    }

    merge ( locales, { defaultLocale } = {} ) {
        if ( !locales && ( !defaultLocale || defaultLocale === this.defaultLocale ) ) return this;

        const merged = {};

        for ( const locale of locales ) {
            if ( this.has( locale ) ) merged[ locale ] = true;
        }

        if ( !merged[ defaultLocale ] ) defaultLocale = this.defaultLocale;

        return new Locales( Object.keys( merged ), { defaultLocale } );
    }

    canChangeLocale ( currentLocale ) {
        if ( !this.#locales.size ) {
            return false;
        }
        else if ( this.#locales.size === 1 ) {
            return !this.#locales.has( currentLocale );
        }
        else {
            return true;
        }
    }

    [ Symbol.iterator ] () {
        if ( !this.#localesBuilt ) this.#buildLocales();

        return this.#locales.values();
    }

    toJSON () {
        return this.locales;
    }

    // private
    #buildLocales () {
        if ( this.#localesBuilt ) return;

        this.#localesBuilt = true;

        this.#languageLocale = {};
        this.#regionLocale = {};

        const languageIndex = {};

        for ( const id of this.#locales.keys() ) {
            const locale = new Locale( id );

            this.#locales.set( id, {
                id,
                "name": locale.name,
                "displayName": null,
                "language": locale.language,
                "languageName": new Locale( locale.language ).name,
                "region": locale.region,
            } );

            languageIndex[ locale.language ] ??= 0;
            languageIndex[ locale.language ]++;

            this.#languageLocale[ locale.language ] ??= locale.id;

            this.#regionLocale[ locale.region ] ??= locale.id;
        }

        for ( const locale of this.#locales.values() ) {
            if ( languageIndex[ locale.language ] === 1 ) {
                locale.displayName = locale.languageName;
            }
            else {
                locale.displayName = locale.name;
            }
        }
    }
}
