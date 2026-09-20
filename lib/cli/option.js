import Ajv from "#lib/ajv";
import ansi from "#lib/ansi";

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

        if ( this.maxItems && this.maxItems < this.minItems ) this._throwSpecError( "maxItems must be >= minItems" );

        if ( this.#config.required != null && this.isArray ) this._throwSpecError( "required can't be used with arrays" );

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
                if ( this.#config.required ) this.#minItems = 1;
                else this.#minItems = 0;
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
            this.#helpDescription = this.description;

            var tags = new Map();

            // required
            if ( this.isRequired ) {
                tags.set( "REQUIRED" );
            }

            // repeatable
            if ( this.isArray ) {
                tags.set( "REPEATABLE" );
            }

            // min
            if ( this.itemSchema.minimum != null ) {
                tags.set( "MIN", this.itemSchema.minimum );
            }

            // max
            if ( this.itemSchema.maximum != null ) {
                tags.set( "MAX", this.itemSchema.maximum );
            }

            // enum
            if ( this.itemSchema.enum ) {
                tags.set( "ALLOWED VALUES", this.itemSchema.enum.map( value => this._quoteValue( value ) ).join( ", " ) );
            }

            // defaulr, do not print default value for boolean options
            if ( this.default != null && ( !this.isBoolean || this.isNegatable ) ) {
                tags.set( "DEFAULT", this._getHelpDefaultValue() );
            }

            // add tags
            if ( tags.size ) {
                if ( !this.#helpDescription.endsWith( "\n" ) && !this.#helpDescription.endsWith( "\r" ) ) {
                    this.#helpDescription += " ";
                }

                this.#helpDescription += [ ...tags.entries() ]
                    .map( ( [ name, value ] ) => {
                        name = ansi.bold.underline( name );

                        if ( value == null ) {
                            return name + ".";
                        }
                        else {
                            return name + ": " + value + ".";
                        }
                    } )
                    .join( " " );
            }
        }

        return this.#helpDescription;
    }

    // protected
    _throwSpecError ( error ) {
        console.log( `Argument "${ this.name }" ${ error }.` );

        process.exit( 2 );
    }

    _quoteValue ( value ) {
        if ( typeof value === "string" ) {
            return `"${ value }"`;
        }
        else {
            return value;
        }
    }

    _getHelpDefaultValue () {
        return this._quoteValue( this.default );
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
