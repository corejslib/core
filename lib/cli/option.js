import Ajv from "#lib/ajv";
import { markdownToString, throwSpecError } from "#lib/cli/utils";

export default class Option {
    #cli;
    #name;
    #config;
    #required;
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

        if ( this.isArray && this.maxItems != null && this.maxItems < this.minItems ) this._throwSpecError( "maxItems must be >= minItems" );

        // check required
        if ( this.#config.required ) {
            if ( this.isArray ) {
                this._throwSpecError( "required can't be used with arrays" );
            }
            else if ( this.hasDefaultValue ) {
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

        // check default value
        if ( this.hasDefaultValue ) {
            if ( this.isArray ) this._throwSpecError( "default value can't be used with arrays" );
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

    get hasDefaultValue () {
        return this.defaultValue != null;
    }

    get defaultValue () {
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

    get isArray () {
        return this.#config.schema.type === "array";
    }

    get minItems () {
        if ( this.isArray ) {
            return this.#config.schema.minItems || 0;
        }
        else {
            return null;
        }
    }

    get maxItems () {
        if ( this.isArray ) {
            return this.#config.schema.maxItems;
        }
        else {
            return null;
        }
    }

    get isRequired () {
        if ( this.#required == null ) {
            this.#required = false;

            if ( this.isArray ) {
                if ( this.minItems ) {
                    this.#required = true;
                }
            }
            else if ( this.#config.required ) {
                this.#required = true;
            }
        }

        return this.#required;
    }

    get isRepeatable () {
        return this.maxItems > 1;
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
        const errors = [];

        // check required
        if ( this.value == null ) {
            if ( this.isRequired ) {
                errors.push( `${ this.prefix } "${ this.name }" is required.` );
            }
            else if ( this.hasDefaultValue ) {
                errors.push( ...this.addValue( this.defaultValue ) );
            }
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
            else if ( this.isArgument && !this.hasDefaultValue ) {
                tags.set( "Optional" );
            }

            // repeatable
            if ( this.isRepeatable ) {
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
        if ( !this.hasDefaultValue ) {
            return;
        }
        else if ( this.isBoolean ) {
            if ( this.defaultValue ) {
                return this._quoteValue( "yes" );
            }
            else {
                return;
            }
        }
        else {
            return this._quoteValue( this.defaultValue );
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
