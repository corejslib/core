import crypto from "node:crypto";
import fs from "node:fs";
import { pathExists } from "#lib/fs";
import Headers from "#lib/http/headers";
import Locale from "#lib/locale";
import PLURAL_EXPRESSIONS from "#lib/locale/plural-expressions";
import PoFileMessage from "#lib/locale/po-file/message";

export default class PoFile {
    #headers = new Headers();
    #messages;

    #language;
    #nplurals;
    #pluralExpression;
    #searchPath;
    #revisionDate;
    #singularIndex;

    constructor ( content ) {
        if ( content ) {
            if ( typeof content === "string" ) {
                this.#readPoFile( content );
            }
            else {
                this.#setHeaders( content.headers );

                if ( content.messages ) {
                    this.#messages = {};

                    for ( const [ id, message ] of Object.entries( content.messages ) ) {
                        this.#messages[ id ] = new PoFileMessage( this, id, message );
                    }
                }
            }
        }
    }

    // static
    static async fromFile ( path ) {
        const content = await fs.promises.readFile( path, "utf8" );

        return new this( content );
    }

    static fromFileSync ( path ) {
        const content = fs.readFileSync( path, "utf8" );

        return new this( content );
    }

    static async fromTemplateFile ( path, language ) {
        const poFile = await this.fromFile( path );

        poFile.#setLanguage( language );

        return poFile;
    }

    static async loadLanguageDomains ( locales, poFilesLocation, { locale, currency } = {} ) {
        locale ||= Locale.default;

        for ( const id of locales ) {
            const domain = new Locale( { id, currency } );

            const path = poFilesLocation + "/" + domain.language + ".po";

            if ( await pathExists( path ) ) {
                const poFile = await this.fromFile( path );

                domain.add( poFile.toLocale( id ) );
            }

            locale.domains.add( domain.id, domain );
        }

        return locale;
    }

    // properties
    get messages () {
        return this.#messages;
    }

    get language () {
        return this.#language;
    }

    get nplurals () {
        return this.#nplurals;
    }

    get pluralExpression () {
        return this.#pluralExpression;
    }

    get searchPath () {
        return this.#searchPath;
    }

    get revisionDate () {
        return this.#revisionDate;
    }

    get isTranslated () {
        if ( this.#messages ) {
            for ( const message of this ) {

                // skip obsolete message
                if ( message.isObsolete ) continue;

                // message is fuzzy
                if ( message.isFuzzy ) return false;

                // message is not translated
                if ( !message.isTranslated ) return false;
            }
        }

        return true;
    }

    get singularIndex () {
        this.#singularIndex ??= PLURAL_EXPRESSIONS[ this.language ].test( 1 );

        return this.#singularIndex;
    }

    get hash () {
        return crypto.hash( "SHA-256", this.toString() );
    }

    // public
    addExtractedMessages ( messages ) {
        if ( messages instanceof PoFile ) messages = messages.messages;

        if ( messages ) {
            this.#messages ??= {};

            for ( const [ id, message ] of Object.entries( messages ) ) {
                if ( this.#messages[ id ] ) {
                    this.#messages[ id ].addExtractedMessage( message );
                }
                else {
                    this.#messages[ id ] = new PoFileMessage( this, id, message );
                }
            }
        }

        return this;
    }

    setExtractedMessages ( poFile ) {
        const newMessages = poFile.toJSON().messages;

        if ( !newMessages && !this.#messages ) return this;

        this.#messages ??= {};

        // process old messages
        for ( const message of this ) {

            // mark old message as obsolete
            message.setObsolete( true );

            // delete message without translations
            if ( !message.translations?.length ) delete this.#messages[ message.id ];
        }

        // process new messages
        if ( newMessages ) {
            for ( const [ msgId, message ] of Object.entries( newMessages ) ) {
                if ( this.#messages[ msgId ] ) {

                    // merge messge
                    this.#messages[ msgId ].mergeExtractedMessage( message );

                    // enable message
                    this.#messages[ msgId ].setObsolete( false );
                }
                else {
                    this.#messages[ msgId ] = new PoFileMessage( this, msgId, message.toJSON() );
                }
            }
        }

        this.#sort();

        return this;
    }

    deleteObsoleteMessages () {
        for ( const message of this ) {

            // delete message
            if ( message.isObsolete ) delete this.#messages[ message.id ];
        }

        this.#sort();

        return this;
    }

    setRevisionDate ( date ) {
        date ||= new Date();

        this.#headers.set( "PO-Revision-Date", date.toISOString() );
        this.#revisionDate = date;

        return this;
    }

    toString () {
        return this.#writePoFile();
    }

    toJSON () {
        return {
            "headers": this.#headers,
            "messages": this.#messages,
        };
    }

    toLocale ( id ) {
        const locale = {
            id,
        };

        if ( this.#messages ) {
            for ( const message of this ) {

                // skip obsolete message
                if ( message.isObsolete ) continue;

                // message is not translated
                if ( !message.isTranslated ) continue;

                locale.messages ??= {};

                locale.messages[ message.id ] = {};

                locale.messages[ message.id ][ "" ] = message.singularTranslation;

                if ( message.pluralId ) {
                    locale.messages[ message.id ][ message.pluralId ] = message.translations;
                }
            }
        }

        return new Locale( locale );
    }

    [ Symbol.iterator ] () {
        return Object.values( this.#messages || {} ).values();
    }

    // private
    #setHeaders ( headers ) {
        if ( !headers ) return;

        this.#headers.add( headers );

        // x-search-path
        this.#searchPath = this.#headers.get( "x-search-path" ) || null;

        // language
        this.#language = this.#headers.get( "language" ) || null;

        // plural-forms
        if ( this.#headers.has( "plural-forms" ) ) {
            const pluralForms = this.#headers.get( "plural-forms" );

            this.#nplurals = +pluralForms.match( /nplurals=(\d+);/v )?.[ 1 ];
            this.#pluralExpression = pluralForms.match( /plural=([^;]+);/v )?.[ 1 ];
        }
        else {
            if ( PLURAL_EXPRESSIONS[ this.#language ] ) {
                this.#setLanguage( this.#language );
            }
            else {
                this.#nplurals = null;
                this.#pluralExpression = null;
            }
        }

        // po-revision-date
        if ( this.#headers.get( "po-revision-date" ) ) {
            const revisionDate = new Date( this.#headers.get( "po-revision-date" ) );

            if ( Number.isNaN( revisionDate.getTime() ) ) {
                this.#headers.delete( "po-revision-date" );
            }
            else {
                this.#revisionDate = revisionDate;
            }
        }
    }

    #setLanguage ( language ) {
        if ( !PLURAL_EXPRESSIONS[ language ] ) throw new Error( "Language is not valid" );

        // language
        this.#headers.set( "Language", language );
        this.#language = language;

        // plural-forms
        this.#headers.set( "Plural-Forms", `nplurals=${ PLURAL_EXPRESSIONS[ language ].nplurals }; plural=${ PLURAL_EXPRESSIONS[ language ].plural };` );

        this.#nplurals = PLURAL_EXPRESSIONS[ language ].nplurals;
        this.#pluralExpression = PLURAL_EXPRESSIONS[ language ].plural;
    }

    #readPoFile ( content ) {
        const lines = content
            .split( "\n" )
            .map( line => line.trim() )
            .filter( line => line );

        let message = this.#addMessage();

        while ( lines.length ) {
            let line = lines.shift();

            let prefix, previous;

            // comment
            if ( line.startsWith( "#" ) ) {

                // obsolete line
                if ( line.startsWith( "#~" ) ) {

                    // possible new message
                    if ( line.startsWith( "#~ msgid " ) ) {
                        message = this.#addMessage( message );
                    }

                    message.obsolete = true;

                    if ( line.startsWith( "#~ " ) ) {
                        prefix = "#~ ";
                        line = line.slice( 3 ).trim();
                    }

                    // obsolete previous line
                    else if ( line.startsWith( "#~| " ) ) {
                        prefix = "#~| ";
                        previous = true;
                        line = line.slice( 4 ).trim();
                    }
                }

                // previous line
                else if ( line.startsWith( "#| " ) ) {
                    prefix = "#| ";
                    previous = true;
                    line = line.slice( 3 ).trim();
                }

                // other comment
                else {

                    // try start new message
                    message = this.#addMessage( message );

                    // reference
                    if ( line.startsWith( "#: " ) ) {
                        message.references ||= [];

                        message.references.push( ...( line.slice( 3 ).match( /\u{2068}.*?\u{2069}|\S+/gv ) || [] ).map( reference => reference.replaceAll( /^\u{2068}|\u{2069}$/gv, "" ) ) );
                    }

                    // flags
                    else if ( line.startsWith( "#, " ) ) {
                        message.flags = line
                            .slice( 3 )
                            .split( "," )
                            .map( flag => flag.trim() )
                            .filter( flag => flag );
                    }

                    // translator comment
                    else if ( line.startsWith( "# " ) ) {
                        const comment = line.slice( 2 ).trim();

                        if ( comment ) {
                            message.translatorComments ??= [];

                            message.translatorComments.push( comment );
                        }
                    }

                    // extracted comment
                    else if ( line.startsWith( "#. " ) ) {
                        const comment = line.slice( 3 ).trim();

                        if ( comment ) {
                            message.extractedComments ??= [];

                            message.extractedComments.push( comment );
                        }
                    }
                    else {
                        throw `Po parsing error: ${ line }`;
                    }

                    continue;
                }
            }

            // msgctxt
            if ( line.startsWith( "msgctxt " ) ) {
                const string = this.#readPoString( line.slice( 8 ).trim(), lines, prefix );

                if ( string ) {
                    if ( previous ) {
                        message.contextPrevious = string;
                    }
                    else {
                        message.context = string;
                    }
                }
            }

            // msgid
            else if ( line.startsWith( "msgid " ) ) {

                // try start new message
                if ( !previous ) message = this.#addMessage( message );

                const string = this.#readPoString( line.slice( 6 ).trim(), lines, prefix );

                if ( previous ) {
                    message.idPrevious = string;
                }
                else {
                    message.id = string;
                }
            }

            // msgstr
            else if ( line.startsWith( "msgstr " ) ) {
                const string = this.#readPoString( line.slice( 7 ).trim(), lines, prefix );

                if ( string ) message.translations[ 0 ] = string;
            }

            // msgid_plural
            else if ( line.startsWith( "msgid_plural " ) ) {
                const string = this.#readPoString( line.slice( 13 ).trim(), lines, prefix );

                if ( string ) {
                    if ( previous ) {
                        message.pluralIdPrevious = string;
                    }
                    else {
                        message.pluralId = string;
                    }
                }
            }

            // msgstr[x]
            else if ( line.startsWith( "msgstr[" ) ) {
                const index = line.indexOf( "]" ),
                    idx = +line.slice( 7, index );

                if ( Number.isNaN( idx ) ) throw `Po invalid line: ${ line }`;

                const string = this.#readPoString( line.slice( index + 2 ).trim(), lines, prefix );

                if ( string ) message.translations[ idx ] = string;
            }
            else {
                throw `Po parsing error: ${ line }`;
            }
        }

        // add last message
        this.#addMessage( message );
    }

    #writePoFile () {
        var text = "";

        text += 'msgid ""\n';

        // write headers
        text += PoFileMessage.createPoString(
            "msgstr",
            this.#headers
                .values()
                .map( header => `${ header.headerOriginalName }: ${ header.value }\n` )
                .sort()
                .join( "" )
        );

        // write messages
        if ( this.#messages ) {
            for ( const message of this ) {
                text += "\n" + message;
            }
        }

        return text;
    }

    #readPoString ( firstLine, lines, prefix ) {

        // dequote first line
        var string = firstLine.slice( 1, -1 );

        while ( lines.length ) {
            let line = lines[ 0 ].trim();

            if ( prefix ) {
                if ( line.startsWith( prefix ) ) {
                    line = line.slice( prefix.length ).trim();
                }
                else {
                    break;
                }
            }

            if ( !line.startsWith( '"' ) ) break;

            lines.shift();

            // dequote
            string += line.slice( 1, -1 );
        }

        // unescape
        return string.replaceAll( /\\["\\nt]/gv, match => {
            if ( match === `\\"` ) return `"`;
            else if ( match === "\\n" ) return "\n";
            else if ( match === "\\t" ) return "\t";
            else if ( match === "\\\\" ) return "\\";
            else return match;
        } );
    }

    #addMessage ( message ) {
        if ( message ) {

            // message has no id
            if ( message.id == null ) {
                return message;
            }

            // headers
            else if ( message.id === "" ) {
                if ( message.translations[ 0 ] ) {
                    const headers = {};

                    for ( const line of message.translations[ 0 ].split( "\n" ) ) {
                        const idx = line.indexOf( ":" );

                        if ( idx < 1 ) continue;

                        const key = line.slice( 0, idx ).trim(),
                            value = line.slice( idx + 1 ).trim();

                        headers[ key ] = value;
                    }

                    this.#setHeaders( headers );
                }
            }

            // message
            else {
                this.#messages ??= {};

                this.#messages[ message.id ] = new PoFileMessage( this, message.id, message );
            }
        }

        return {
            "id": null,
            "translations": [],
        };
    }

    #sort () {
        if ( !this.#messages ) return;

        this.#messages = Object.fromEntries( Object.entries( this.#messages ).sort( ( a, b ) => a[ 1 ].compare( b[ 1 ] ) ) );
    }
}
