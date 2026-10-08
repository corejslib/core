export default class PoFileMessage {
    #poFile;
    #id;
    #obsolete;
    #references = new Set();
    #flags = new Set();
    #translatorComments = new Set();
    #extractedComments = new Set();
    #context;
    #contextPrevious;
    #idPrevious;
    #pluralId;
    #pluralIdPrevious;
    #translations;

    constructor ( poFile, id, { obsolete, references, flags, translatorComments, extractedComments, context, contextPrevious, idPrevious, pluralId, pluralIdPrevious, translations } = {} ) {
        this.#poFile = poFile;
        this.#id = id;
        this.setObsolete( obsolete );
        this.#context = context;
        this.#contextPrevious = contextPrevious;
        this.#idPrevious = idPrevious;
        this.#pluralId = pluralId;
        this.#pluralIdPrevious = pluralIdPrevious;
        this.setTranslations( translations );

        this.#addSetValues( this.#references, references );
        this.#addSetValues( this.#flags, flags );
        this.#addSetValues( this.#translatorComments, translatorComments );
        this.#addSetValues( this.#extractedComments, extractedComments );
    }

    // static
    static createPoString ( tag, string, prefix ) {
        prefix ??= "";

        // escape
        string = ( string ?? "" ).replaceAll( /[\t"\\]/gv, match => {
            if ( match === `"` ) return `\\"`;
            else if ( match === "\t" ) return "\\t";
            else if ( match === "\\" ) return "\\\\";
        } );

        if ( string.includes( "\n" ) ) {
            let text = `${ prefix }${ tag } ""\n`;

            const lines = string.split( "\n" ),
                lastLine = lines.pop();

            for ( const line of lines ) text += `${ prefix }"${ line }\\n"\n`;

            if ( lastLine !== "" ) text += `${ prefix }"${ lastLine }"\n`;

            return text;
        }
        else {
            return `${ prefix }${ tag } "${ string }"\n`;
        }
    }

    // properties
    get id () {
        return this.#id;
    }

    get isObsolete () {
        return this.#obsolete;
    }

    get pluralId () {
        return this.#pluralId;
    }

    get references () {
        return this.#references;
    }

    get flags () {
        return this.#flags;
    }

    get context () {
        return this.#context;
    }

    get extractedComments () {
        return this.#extractedComments;
    }

    get translations () {
        return this.#translations;
    }

    get isFuzzy () {
        return this.#flags.has( "fuzzy" );
    }

    get singularIndex () {
        return this.#poFile.singularIndex;
    }

    get singularTranslation () {
        return this.#translations?.[ this.singularIndex ];
    }

    get isTranslated () {

        // message not translated
        if ( !this.#translations?.[ this.singularIndex ] ) return false;

        // check plural forms translated
        if ( this.#pluralId ) {
            if ( this.#translations.length !== this.#poFile.nplurals ) return false;

            for ( let n = 0; n < this.#translations.length; n++ ) {
                if ( !this.#translations[ n ] ) return false;
            }
        }

        return true;
    }

    // public
    toString () {
        let text = "";

        const currentPrefix = this.#obsolete
                ? "#~ "
                : "",
            previousPrefix = this.#obsolete
                ? "#~| "
                : "#| ";

        // translator comments
        if ( this.#translatorComments.size ) {
            for ( const comment of this.#translatorComments ) {
                text += `# ${ comment }\n`;
            }
        }

        // extracted comments
        if ( this.#extractedComments.size ) {
            for ( const comment of this.#extractedComments ) {
                text += `#. ${ comment }\n`;
            }
        }

        // references
        if ( this.#references.size ) {
            for ( let reference of [ ...this.#references ].sort() ) {
                if ( reference.includes( " " ) ) reference = `\u{2068}${ reference }\u{2069}`;

                text += "#: " + reference + "\n";
            }
        }

        // flags
        if ( this.#flags?.size ) text += `#, ${ [ ...this.#flags ].sort().join( ", " ) }\n`;

        // previous msgctxt
        if ( this.#contextPrevious ) text += this.constructor.createPoString( "msgctxt", this.#contextPrevious, previousPrefix );

        // previous msgid
        if ( this.#idPrevious ) text += this.constructor.createPoString( "msgid", this.#idPrevious, previousPrefix );

        // previous msgid_plural
        if ( this.#pluralIdPrevious ) text += this.constructor.createPoString( "msgid_plural", this.#pluralIdPrevious, previousPrefix );

        // msgctxt
        if ( this.#context ) text += this.constructor.createPoString( "msgctxt", this.#context, currentPrefix );

        // msgid
        text += this.constructor.createPoString( "msgid", this.#id, currentPrefix );

        // plural
        if ( this.#pluralId ) {
            text += this.constructor.createPoString( "msgid_plural", this.#pluralId, currentPrefix );

            const nplurals = this.#poFile.nplurals || this.#translations?.length || 1;

            for ( let n = 0; n < nplurals; n++ ) {
                text += this.constructor.createPoString( `msgstr[${ n }]`, this.#translations?.[ n ], currentPrefix );
            }
        }

        // single
        else {
            text += this.constructor.createPoString( "msgstr", this.#translations?.[ this.singularIndex ], currentPrefix );
        }

        return text;
    }

    toJSON () {
        return {
            "obsolete": this.#obsolete,
            "references": [ ...this.#references ],
            "flags": [ ...this.#flags ],
            "translatorComments": [ ...this.#translatorComments ],
            "extractedComments": [ ...this.#extractedComments ],
            "context": this.#context,
            "contextPrevious": this.#contextPrevious,
            "idPrevious": this.#idPrevious,
            "pluralId": this.#pluralId,
            "pluralIdPrevious": this.#pluralIdPrevious,
            "translations": this.#translations,
        };
    }

    addExtractedMessage ( { pluralId, references, flags, extractedComments, context } = {} ) {

        // plural id
        if ( pluralId ) {
            if ( !this.#pluralId ) {
                this.#pluralId = pluralId;
            }
            else if ( pluralId !== this.#pluralId ) {
                throw `Plural form conflict found:

Message:
${ this.id }

Old plural id:
${ this.#pluralId }

New plural Id:
${ pluralId }
`;
            }
        }

        // references
        if ( references ) {
            this.#addSetValues( this.#references, references );
        }

        // flags
        if ( flags ) {
            this.#addSetValues( this.#flags, flags );
        }

        // extracted comments
        if ( extractedComments ) {
            this.#addSetValues( this.#extractedComments, extractedComments );
        }

        // context
        if ( context ) this.#context = context;

        return this;
    }

    mergeExtractedMessage ( { pluralId, references, flags, extractedComments, context } = {} ) {

        // plural id
        if ( ( pluralId || null ) !== ( this.#pluralId || null ) ) {
            this.#pluralId = pluralId || null;

            this.#translations = undefined;
            this.setFuzzy( false );
        }

        // references
        if ( references ) {
            this.#references = new Set();
            this.#addSetValues( this.#references, references );
        }

        // flags
        if ( flags ) {
            const fuzzy = this.#flags.has( "fuzzy" );

            this.#flags = new Set();
            this.#addSetValues( this.#flags, flags );

            // keep fuzzy flag
            if ( fuzzy ) this.#flags.add( "fuzzy" );
        }

        // extracted comments
        if ( extractedComments ) {
            this.#extractedComments = new Set();
            this.#addSetValues( this.#extractedComments, extractedComments );
        }

        // context
        this.#context = context;

        // previous context
        this.#contextPrevious = null;

        return this;
    }

    compare ( message ) {
        if ( this.isObsolete && !message.isObsolete ) return 1;
        else if ( !this.isObsolete && message.isObsolete ) return -1;

        if ( !this.isObsolete ) {
            if ( this.isFuzzy && !message.isFuzzy ) return -1;
            else if ( !this.isFuzzy && message.isFuzzy ) return 1;
        }

        return this.id.localeCompare( message.id );
    }

    setObsolete ( value ) {
        this.#obsolete = !!value;

        return this;
    }

    setFuzzy ( value ) {
        if ( value ) {
            this.#flags.add( "fuzzy" );
        }
        else {
            this.#flags.delete( "fuzzy" );
        }

        return this;
    }

    setTranslations ( translations ) {
        if ( !translations ) {
            this.#translations = undefined;
        }
        else if ( !this.#pluralId ) {
            this.setSingularTranslation( translations[ this.singularIndex ] );
        }
        else {
            this.#translations = translations;
        }

        return this;
    }

    setSingularTranslation ( string ) {
        if ( !string ) {
            if ( !this.#translations ) return this;

            this.#translations[ this.singularIndex ] = "";

            for ( const translation of this.#translations ) {
                if ( translation ) return this;
            }

            this.#translations = undefined;
        }
        else {
            this.#translations ||= [];

            this.#translations[ this.singularIndex ] = string;
        }

        return this;
    }

    // private
    #addSetValues ( set, values ) {
        if ( !values ) return;

        if ( !Array.isArray( values ) && !( values instanceof Set ) ) values = [ values ];

        for ( const value of values ) {
            if ( !value ) continue;

            set.add( value );
        }
    }
}
