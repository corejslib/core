import path from "node:path";
import fetch from "#lib/fetch";
import FormData from "#lib/form-data";
import mixins from "#lib/mixins";
import Mutex from "#lib/threads/mutex";
import Chats from "./bot/chats.js";
import Forums from "./bot/forums.js";
import Games from "./bot/games.js";
import InlineQuery from "./bot/inline-query.js";
import Location from "./bot/location.js";
import Me from "./bot/me.js";
import Messages from "./bot/messages.js";
import Payments from "./bot/payments.js";
import Polls from "./bot/polls.js";
import Stickers from "./bot/stickers.js";
import TelegramPassport from "./bot/telegram-passport.js";
import WebApps from "./bot/web-apps.js";
import WebHooks from "./bot/web-hooks.js";

const DEFAULT_UPDATES_LIMIT = 100,
    DEFAULT_UPDATES_TIMEOUT = 0,
    DISPATCHER = new fetch.Dispatcher( {
        "keepAliveTimeout": 60_000,
    } );

export default class TelegramBotApi extends mixins( Chats, Forums, Games, InlineQuery, Location, Me, Messages, Payments, Polls, Stickers, TelegramPassport, WebApps, WebHooks ) {
    #apiToken;
    #mutexSet = new Mutex.Set();

    constructor ( apiToken ) {
        super();

        this.#apiToken = apiToken;
    }

    // properties
    get apiToken () {
        return this.#apiToken;
    }

    set apiToken ( value ) {
        this.#apiToken = value;
    }

    // public
    async send ( method, data ) {
        return this[ method ]( data );
    }

    // https://core.telegram.org/bots/api#getupdates
    async getUpdates ( { offset, limit, timeout, allowedUpdates, signal } = {} ) {
        return this._doRequest(
            "getUpdates",
            {
                offset,
                "limit": limit || DEFAULT_UPDATES_LIMIT,
                "timeout": timeout || DEFAULT_UPDATES_TIMEOUT,
                "allowed_updates": allowedUpdates,
            },
            signal,
            0
        );
    }

    // https://core.telegram.org/bots/api#getfile
    async getFile ( fileId ) {
        var res;

        const fileIdMutex = this.#mutexSet.get( "get-file/" + fileId );

        if ( !fileIdMutex.tryLock() ) return fileIdMutex.wait();

        try {
            res = await this._doRequest( "getFile", {
                "file_id": fileId,
            } );
            if ( !res.ok ) throw res;

            const tmp = await this.#downloadFile( res.data.file_path, res.data.file_unique_id );
            if ( !tmp.ok ) throw tmp;

            res.data.file = tmp.data;
        }
        catch ( e ) {
            res = result.catch( e );
        }

        fileIdMutex.unlock( res );

        return res;
    }

    async getStream ( fileId ) {
        var res;

        res = await this._doRequest( "getFile", {
            "file_id": fileId,
        } );
        if ( !res.ok ) return res;

        const file = await fetch( `https://api.telegram.org/file/bot${ this.#apiToken }/${ res.data.file_path }` );
        if ( !file.ok ) return file;

        res.data.stream = file.body.setName( path.basename( res.data.file_path ) ).setSize( res.data.file_size );

        return res;
    }

    async downloadFile ( req, fileId, cacheControl ) {
        const res = await this.getFile( fileId, { "stream": true } );
        if ( !res.ok ) return req.end( 404 );

        if ( !res.data.stream.type ) {
            res.data.stream.setType( "application/octet-stream" );
        }

        return req.end( {
            "status": 200,
            "headers": {
                "cache-control": cacheControl,
            },
            "body": res.data.stream,
        } );
    }

    // https://core.telegram.org/bots/api#answercallbackquery
    async answerCallbackQuery ( data ) {
        return this._doRequest( "answerCallbackQuery", data );
    }

    // https://core.telegram.org/bots/api#getuserprofilephotos
    async getUserProfilePhotos ( data ) {
        return this._doRequest( "getUserProfilePhotos", data );
    }

    // protected
    async _doRequest ( method, body, signal, bodyTimeout ) {
        const headers = {};

        if ( !( body instanceof FormData ) ) {
            headers[ "content-type" ] = "application/json";

            if ( typeof body !== "string" ) {
                body = JSON.stringify( body );
            }
        }

        const res = await fetch( `https://api.telegram.org/bot${ this.#apiToken }/${ method }`, {
            "method": "POST",
            bodyTimeout,
            signal,
            headers,
            body,
            "dispatcher": DISPATCHER,
        } );

        // aborted by abort signal
        if ( signal?.aborted ) return result( res );

        try {
            const data = await res.json();

            if ( data === undefined ) return result( [ 500, "Telegram connection error" ] );

            if ( !data.ok ) return result( [ res.status, data.description ] );

            return result( 200, data.result );
        }
        catch ( e ) {
            return result.catch( e );
        }
    }

    // private
    async #downloadFile ( filePath, fileUniqueId ) {
        const mutex = this.#mutexSet.get( "download-file/" + fileUniqueId );

        if ( !mutex.tryLock() ) return mutex.wait();

        var res;

        try {
            res = await fetch( `https://api.telegram.org/file/bot${ this.#apiToken }/${ filePath }` );
            if ( !res.ok ) throw res;

            const tmp = await res.tmpFile( {
                "name": filePath,
                "type": "",
            } );

            res = result( 200, tmp );
        }
        catch ( e ) {
            res = result.catch( e );
        }

        mutex.unlock( res );

        return res;
    }
}
