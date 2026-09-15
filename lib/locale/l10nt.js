import ejs from "#lib/ejs";
import JsonContainer from "#lib/json-container";
import Msgid from "#lib/locale/msgid";
import { mergeObjects } from "#lib/utils";

export default class L10nt {
    #locale;
    #singular;
    #plural;
    #pluralNumber;
    #localeDomain;
    #data;

    constructor ( locale, singular, { plural, pluralNumber, localeDomain, data } = {} ) {
        this.#locale = locale;

        // L10nt
        if ( singular instanceof L10nt ) {
            plural = singular.plural;

            pluralNumber = pluralNumber === undefined
                ? singular.pluralNumber
                : pluralNumber;

            localeDomain = localeDomain === undefined
                ? singular.localeDomain
                : localeDomain;

            data = this.#mergeData( singular.data, data );

            singular = singular.singular;
        }

        this.#singular = singular;
        this.#localeDomain = localeDomain;
        this.#pluralNumber = pluralNumber;

        // Ejs
        if ( ejs.isEjs( singular ) ) {
            this.#data = data;
        }

        // function
        else if ( typeof singular === "function" ) {
            this.#data = data;
        }
        else if ( typeof singular === "string" || singular instanceof Msgid ) {
            if ( plural ) {
                if ( typeof plural === "string" || plural instanceof Msgid ) {
                    this.#plural = plural;
                }
                else {
                    throw new TypeError( 'L10nt "plural" parameter is not valid' );
                }
            }
        }
        else {
            throw new TypeError( 'L10nt "singular" parameter is not valid' );
        }
    }

    // static
    static toString ( translation, options ) {
        if ( translation instanceof this ) {
            return translation.toString( options );
        }
        else {
            return translation?.toString();
        }
    }

    // properties
    get locale () {
        return this.#locale;
    }

    get singular () {
        return this.#singular;
    }

    get plural () {
        return this.#plural;
    }

    get pluralNumber () {
        return this.#pluralNumber;
    }

    get localeDomain () {
        return this.#localeDomain;
    }

    get data () {
        return this.#data;
    }

    // public
    toString ( options ) {
        return this.#translate( options ?? JsonContainer.options?.translation );
    }

    toJSON () {
        return this.#translate( JsonContainer.options?.translation );
    }

    [ Symbol.for( "nodejs.util.inspect.custom" ) ] ( depth, options, inspect ) {
        const spec = {
            "singular": typeof this.#singular === "function"
                ? "function"
                : ejs.isEjs( this.#singular )
                    ? "ejs"
                    : this.#singular,
        };

        if ( this.#plural ) {
            spec.plural = this.#plural;

            if ( this.#pluralNumber != null ) {
                spec.pluralNumber = this.#pluralNumber;
            }
        }

        if ( this.#localeDomain ) {
            spec.localeDomain = this.#localeDomain;
        }

        return `${ this.constructor.name }: ${ inspect( spec ) }`;
    }

    // private
    #translate ( { locale, localeDomain, pluralNumber, data } = {} ) {
        locale ||= this.#locale;

        localeDomain ||= this.#localeDomain;

        if ( localeDomain ) {
            localeDomain = locale.domains.get( localeDomain );

            if ( localeDomain ) locale = localeDomain;
        }

        if ( pluralNumber === undefined ) pluralNumber = this.#pluralNumber;

        // Ejs
        if ( ejs.isEjs( this.#singular ) ) {
            return this.#singular.render( {
                locale,
                msgid,
                pluralNumber,
                "data": this.#mergeData( this.#data, data ),
            } );
        }

        // function
        else if ( typeof this.#singular === "function" ) {
            return this.#singular( locale, {
                pluralNumber,
                "data": this.#mergeData( this.#data, data ),
            } );
        }
        else {
            return locale.l10n( this.#singular, this.#plural, pluralNumber );
        }
    }

    #mergeData ( oldData, data ) {
        if ( !data ) {
            return oldData;
        }
        else if ( !oldData ) {
            return data;
        }
        else {
            return mergeObjects( {}, oldData, data );
        }
    }
}
