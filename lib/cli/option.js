import Ajv from "#lib/ajv";
import { markdownToString, throwSpecError } from "#lib/cli/utils";

export default class Option {
    #cli;
    #name;
    #config;
    #minItems;
    #maxItems;
    #value;
    #validator;
    #arrayValidator;
    #helpDescription;

    constructor ( cli, name, config ) {
        this.#cli = cli;
        this.#name = name;
        this.#config = config;

        // check description
        this.#config.description = this.#config.description.trim();
        if ( /\n/v.test( this.#config.description ) ) {
            if ( /^[a-z]/v.test( this.#config.description ) ) {
                this._throwSpecError( "description must start with capital letter" );
            }
        }
        else if ( /^[a-z]|\.$/v.test( this.#config.description ) ) {
            this._throwSpecError( 'description must start with capital letter and not ends with "."' );
        }

        if ( this.maxItems && this.maxItems < this.minItems ) this._throwSpecError( "maxItems must be >= minItems" );

        // check required
        if ( this.#config.required != null ) {
            if ( this.isArray ) {
                this._throwSpecError( "required can't be used with arrays" );
            }
            else if ( this.default != null ) {
                this._throwSpecError( "required can't be used with default value" );
            }
        }

        // compile json schema
        try {
            this.#validator = new Ajv( {
                "coerceTypes": true,
            } ).compile( {
                "type": "object",
                "properties": {
                    "value": this.itemSchema,
                },
            } );

            if ( this.isArray ) {
                this.#arrayValidator = new Ajv( {
                    "coerceTypes": true,
                } ).compile( this.#config.schema );
            }
        }
        catch ( e ) {
            throw `${ this.prefix } "${ this.name }" error compiling schema:\n${ JSON.stringify( config.schema, null, 4 ) }\n${ e }`;
        }

        // set default value
        if ( this.default != null ) {
            if ( this.isArray ) this._throwSpecError( "default value can't be used with arrays" );

            const errors = this.addValue( this.default );

            if ( errors.length ) this._throwSpecError( errors[ 0 ] );
        }
    }

    // properties
    get cli () {
        return this.#cli;
    }

    get prefix () {
        return this.isArgument
            ? "Argument"
            : "Option";
    }

    get name () {
        return this.#name;
    }

    get description () {
        return this.#config.description;
    }

    get default () {
        return this.#config.default;
    }

    get itemSchema () {
        return this.isArray
            ? this.#config.schema.items
            : this.#config.schema;
    }

    get type () {
        return this.itemSchema.type;
    }

    get isRequired () {
        return this.default == null && this.minItems > 0;
    }

    get minItems () {
        if ( this.#minItems == null ) {
            if ( this.isArray ) {
                this.#minItems = this.#config.schema.minItems || 0;
            }
            else {
                if ( this.#config.required ) {
                    this.#minItems = 1;
                }
                else {
                    this.#minItems = 0;
                }
            }
        }

        return this.#minItems;
    }

    get maxItems () {
        if ( this.#maxItems == null ) {
            if ( this.isArray ) {
                this.#maxItems = this.#config.schema.maxItems || 0;
            }
            else {
                this.#maxItems = 1;
            }
        }

        return this.#maxItems;
    }

    get isArray () {
        return this.#config.schema.type === "array";
    }

    get value () {
        return this.#value;
    }

    // public
    addValue ( value ) {
        var errors = [],
            data = { value },
            isValid = this.#validator( data );

        if ( !isValid ) {
            errors.push( `${ this.prefix } "${ this.name }" ${ this.#validator.errors.messages[ 0 ] }` );
        }
        else {
            if ( this.isArray ) {
                if ( this.maxItems && this.#value && this.#value.length === this.maxItems ) {
                    errors.push( `${ this.prefix } "${ this.name }" can be repeated not more than ${ this.maxItems } time(s)` );
                }

                this.#value ||= [];

                this.#value.push( data.value );
            }
            else {
                this.#value = data.value;
            }
        }

        return errors;
    }

    validate () {
        var errors = [];

        // check required
        if ( this.isRequired && this.value == null ) {
            errors.push( `${ this.prefix } "${ this.name }" is required.` );
        }

        // check array
        else if ( this.isArray ) {

            // check minItems
            if ( this.minItems && this.value.length < this.minItems ) {
                errors.push( `${ this.prefix } "${ this.name }" must be specified at least ${ this.minItems } time(s).` );
            }

            // check maxItems
            if ( this.maxItems && this.value.length > this.maxItems ) {
                errors.push( `${ this.prefix } "${ this.name }" must be specified not more than ${ this.maxItems } time(s).` );
            }

            // validate array
            if ( this.value && !this.#arrayValidator( this.value ) ) {
                errors.push( `${ this.prefix } "${ this.name }" ${ this.#arrayValidator.errors.messages[ 0 ] }` );
            }
        }

        return errors;
    }

    getHelpDescription () {
        if ( this.#helpDescription == null ) {
            this.#helpDescription = markdownToString( this.description );

            const tags = new Map();

            // required
            if ( this.isRequired ) {
                tags.set( "Required" );
            }
            else if ( this.isArgument ) {
                tags.set( "Optional" );
            }

            // repeatable
            if ( this.isArray ) {
                tags.set( "Repeatable" );
            }

            // min
            if ( this.itemSchema.minimum != null ) {
                tags.set( "Min", this._quoteValue( this.itemSchema.minimum ) );
            }

            // max
            if ( this.itemSchema.maximum != null ) {
                tags.set( "Max", this._quoteValue( this.itemSchema.maximum ) );
            }

            // enum
            if ( this.itemSchema.enum ) {
                tags.set( "Allowed values", this.itemSchema.enum.map( value => "`" + this._quoteValue( value ) + "`" ).join( ", " ) );
            }

            // default value
            const defaultValue = this._getHelpDefaultValue();

            if ( defaultValue != null ) {
                tags.set( "Default", defaultValue );
            }

            // add tags
            if ( tags.size ) {
                const tagsHelp = tags
                    .entries()
                    .map( ( [ name, value ] ) => {
                        name = "**" + name + "**";

                        if ( value == null ) {
                            return name;
                        }
                        else {
                            return name + ": " + value;
                        }
                    } )
                    .toArray()
                    .join( ". " );

                // multi-line description
                if ( /\n/v.test( this.#helpDescription ) ) {
                    this.#helpDescription += "\n";
                }
                else {
                    this.#helpDescription += ". ";
                }

                this.#helpDescription += markdownToString( tagsHelp );
            }
        }

        return this.#helpDescription;
    }

    // protected
    _throwSpecError ( error ) {
        throwSpecError( `Argument "${ this.name }" ${ error }.` );
    }

    _quoteValue ( value ) {
        if ( typeof value === "string" ) {
            value = `"${ value }"`;
        }

        return "`" + value + "`";
    }

    _getHelpDefaultValue () {
        if ( this.default == null ) {
            return;
        }
        else if ( this.isBoolean ) {
            if ( this.default ) {
                return this._quoteValue( "on" );
            }
            else {
                return;
            }
        }
        else {
            return this._quoteValue( this.default );
        }
    }

    _getHelpType () {
        if ( this.itemSchema.format ) {
            return this.itemSchema.format;
        }
        else if ( this.type ) {
            return this.type;
        }
        else {
            return "value";
        }
    }
}
