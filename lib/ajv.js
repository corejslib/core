import AjvBase from "ajv";
import ajvErrors from "ajv-errors";
import ajvFormats from "ajv-formats";
import ajvKeywords from "ajv-keywords";
import InstanceOfDefinitions from "ajv-keywords/dist/definitions/instanceof.js";
import AjvErrors from "#lib/ajv/errors";
import customFormats from "#lib/ajv/formats";
import customKeywords from "#lib/ajv/keywords";
import { readConfigSync } from "#lib/config";
import Locale from "#lib/locale";

// XXX https://github.com/luzlab/ajv-formats-draft2019/issues/28
// import ajvFormatsDraft2019 from "ajv-formats-draft2019";

// import ajvMergePatch from "ajv-merge-patch";

export default class Ajv extends AjvBase {
    #errors;

    constructor ( options = {} ) {
        super( {
            "strict": true,
            "allowUnionTypes": true,
            "coerceTypes": false,
            "allErrors": true,
            "useDefaults": true,
            ...options,
        } );

        // plugins
        ajvErrors( this, { "keepErrors": false, "singleError": true } );
        ajvFormats( this, {
            "mode": "full",
            "keywords": true,
            "formats": [
                "binary",
                "byte",

                // "date",
                // "date-time",
                "double",

                // "duration",
                "email",
                "float",
                "hostname",
                "int32",
                "int64",
                "ipv4",
                "ipv6",

                // "iso-date-time",
                // "iso-time",
                "json-pointer",
                "password",
                "regex",
                "relative-json-pointer",

                // "time",
                "uri",
                "uri-reference",
                "uri-template",

                // "url",
                "uuid",
            ],
        } );

        // XXX https://github.com/luzlab/ajv-formats-draft2019/issues/28
        // ajvFormatsDraft2019( this );
        ajvKeywords( this );

        // ajvMergePatch( this );

        // add custom formats
        this.addFormats( customFormats );

        // add custom keywords
        for ( const keyword of customKeywords ) {
            this.addKeyword( keyword );
        }
    }

    // static
    static registerInstance ( name, Class ) {
        InstanceOfDefinitions.CONSTRUCTORS[ name ] = Class;
    }

    // properties
    get errors () {
        return this.#errors;
    }

    set errors ( value ) {
        this.#errors = value
            ? new AjvErrors( value )
            : value;
    }

    // public
    addFormats ( formats ) {
        for ( const name in formats ) {
            super.addFormat( name, formats[ name ] );
        }

        return this;
    }

    compile ( schema ) {
        const _validate = super.compile( schema );

        return function validate ( data ) {
            if ( _validate( data ) ) {
                validate.errors = null;

                return true;
            }
            else {
                validate.errors = new AjvErrors( _validate.errors );

                return false;
            }
        };
    }

    compileFile ( path ) {
        return this.compile( readConfigSync( path ) );
    }

    validate ( schema, data ) {
        return super.validate( schema, data );
    }
}

Ajv.registerInstance( "Locale.L10nt", Locale.L10nt );
