import GoogleCloudMessagingApi from "#lib/api/google/cloud/messaging";
import Smtp from "#lib/api/smtp";
import Interval from "#lib/interval";
import L10nt from "#lib/locale/l10nt";
import sql from "#lib/sql";
import Counter from "#lib/threads/counter";
import { freezeObjectRecursively } from "#lib/utils";

const CLEAR_INTERVAL = 1000 * 60 * 60 * 24; // 24 hours

const PUSH_NOTIFICATION_GROUPS = new Set( [ "all", "guests", "users", "root" ] );

const SQL = {
    "insertInternalNotification": sql`INSERT INTO notification_internal ( subject, body, expires ) VALUES ( ?, ?, ? ) RETURNING id`.prepare(),

    "setUserNotificationSubscribed": sql`INSERT INTO user_notification ( user_id, notification_id, internal, email, telegram, push ) VALUES ( ?, get_notification_id( ? ), ?, ?, ?, ? ) ON CONFLICT ( user_id, notification_id ) DO UPDATE SET internal = EXCLUDED.internal, email = EXCLUDED.email, telegram = EXCLUDED.telegram, push = EXCLUDED.push`.prepare(),

    "setChannelSubscribed": {
        "internal": sql`INSERT INTO user_notification ( user_id, notification_id, internal ) VALUES ( ?, get_notification_id( ? ), ? ) ON CONFLICT ( user_id, notification_id ) DO UPDATE SET internal = EXCLUDED.internal`.prepare(),

        "email": sql`INSERT INTO user_notification ( user_id, notification_id, email ) VALUES ( ?, get_notification_id( ? ), ? ) ON CONFLICT ( user_id, notification_id ) DO UPDATE SET email = EXCLUDED.email`.prepare(),

        "telegram": sql`INSERT INTO user_notification ( user_id, notification_id, telegram ) VALUES ( ?, get_notification_id( ? ), ? ) ON CONFLICT ( user_id, notification_id ) DO UPDATE SET telegram = EXCLUDED.telegram`.prepare(),

        "push": sql`INSERT INTO user_notification ( user_id, notification_id, push ) VALUES ( ?, get_notification_id( ? ), ? ) ON CONFLICT ( user_id, notification_id ) DO UPDATE SET push = EXCLUDED.push`.prepare(),
    },
};

export default class {
    #app;
    #config;
    #channels;
    #smtp;
    #telegramBotId;
    #types;
    #hasEnabledChannels = false;
    #pushNotificationsPrefix;
    #googleCloudMessagingApi;
    #activityCounter = new Counter();

    constructor ( app, config ) {
        this.#app = app;
        this.#config = config;
    }

    // properties
    get app () {
        return this.#app;
    }

    get config () {
        return this.#config;
    }

    get dbh () {
        return this.#app.dbh;
    }

    get channels () {
        return this.#channels;
    }

    get telegramBotUsername () {
        return this.#telegramBot?.username;
    }

    get pushNotificationsPrefix () {
        return this.#pushNotificationsPrefix;
    }

    // public
    async configure () {

        // get components notifications
        for ( const component of this.app.components ) {
            if ( component.id === "notifications" ) continue;

            const notifications = component.notificationsConfig;

            if ( !notifications ) continue;

            for ( const [ type, typeSpec ] of Object.entries( notifications ) ) {
                if ( this.#config.types[ type ] ) {
                    return result( [ 400, `Notifications type "${ type }" is already defined` ] );
                }

                this.#config.types[ type ] = typeSpec;
            }
        }

        this.#channels = structuredClone( this.config.channels );

        // internal notifications
        this.channels.internal.supported = true;
        if ( !this.channels.internal.enabled ) {
            this.channels.internal.editable = false;
            this.channels.internal.subscribed = false;
        }

        // email notifications
        if ( this.config.smtp ) {
            this.channels.email.supported = true;

            this.#smtp = new Smtp( this.config.smtp );
        }
        else {
            this.channels.email.supported = false;
            this.channels.email.enabled = false;
            this.channels.email.edirable = false;
            this.channels.email.subscribed = false;
        }

        // telegram notifications
        if ( this.config.telegramBot.apiToken && this.app.components.has( this.config.telegramBot.type ) ) {
            this.channels.telegram.supported = true;
        }
        else {
            this.channels.telegram.supported = false;
            this.channels.telegram.enabled = false;
            this.channels.telegram.editable = false;
            this.channels.telegram.subscribed = false;
        }

        // push notifications
        if ( this.config.firebase?.serviceAccount ) {
            this.channels.push.supported = true;

            this.#pushNotificationsPrefix = this.config.firebase.prefix
                ? this.config.firebase.prefix + "."
                : "";
            this.#googleCloudMessagingApi = new GoogleCloudMessagingApi( this.config.firebase.serviceAccount );
        }
        else {
            this.channels.push.supported = false;
            this.channels.push.enabled = false;
            this.channels.push.editable = false;
            this.channels.push.subscribed = false;

            this.#pushNotificationsPrefix = "";
        }

        freezeObjectRecursively( this.#channels );

        this.#types = this.config.types || {};

        // set notificatio channels defaults
        for ( const type of Object.values( this.#types ) ) {
            const channels = ( type.channels ??= {} );

            for ( const channel of Object.keys( this.channels ) ) {
                channels[ channel ] ??= {};

                if ( this.channels[ channel ].enabled ) {
                    channels[ channel ].enabled ??= true;
                }
                else {
                    channels[ channel ].enabled = false;
                }

                if ( channels[ channel ].enabled ) {
                    channels[ channel ].editable ??= this.channels[ channel ].editable ?? true;
                    channels[ channel ].subscribed ??= this.channels[ channel ].subscribed ?? true;

                    this.#hasEnabledChannels = true;
                }
                else {
                    channels[ channel ].editable = false;
                    channels[ channel ].subscribed = false;
                }
            }
        }

        return result( 200 );
    }

    async init () {
        var res;

        // migrate database
        res = await this.dbh.schema.migrate( new URL( "db", import.meta.url ) );
        if ( !res.ok ) return res;

        return result( 200 );
    }

    async start () {
        if ( this.channels.internal.enabled ) {
            setInterval( this.#clear.bind( this ), CLEAR_INTERVAL );
        }

        // create telegram bot
        if ( this.config.telegramBot.apiToken && this.app.telegram ) {
            const res = await this.app.telegram.bots.createStaticBot( this.config.telegramBot );

            if ( !res.ok ) return res;

            this.#telegramBotId = res.data.id;
        }

        return result( 200 );
    }

    async destroy () {
        return this.#activityCounter.wait();
    }

    async registerPushNotificationsToken ( token, userId ) {
        if ( !this.channels.push.supported ) return result( [ 503, "Push notifications are not supported" ] );

        var finalRes = result( 200 );

        const counter = new Counter();

        const then = res => {
            if ( !res.ok ) finalRes = res;
        };

        // prefix.all
        counter.value++;
        this.#googleCloudMessagingApi
            .subscribeToTopic( `${ this.#pushNotificationsPrefix }all`, token )
            .then( then )
            .finally( () => counter.value-- )
            .catch( e => console.error( e ) );

        if ( userId ) {

            // users
            counter.value++;
            this.#googleCloudMessagingApi
                .subscribeToTopic( `${ this.#pushNotificationsPrefix }users`, token )
                .then( then )
                .finally( () => counter.value-- )
                .catch( e => console.error( e ) );

            // root
            if ( this.app.userIsRoot( userId ) ) {
                counter.value++;
                this.#googleCloudMessagingApi
                    .subscribeToTopic( `${ this.#pushNotificationsPrefix }root`, token )
                    .then( then )
                    .finally( () => counter.value-- )
                    .catch( e => console.error( e ) );
            }

            // prefix.users.<user_id>
            counter.value++;
            this.#googleCloudMessagingApi
                .subscribeToTopic( `${ this.#pushNotificationsPrefix }users.${ userId }`, token )
                .then( then )
                .finally( () => counter.value-- )
                .catch( e => console.error( e ) );
        }
        else {

            // guests
            counter.value++;
            this.#googleCloudMessagingApi
                .subscribeToTopic( `${ this.#pushNotificationsPrefix }guests`, token )
                .then( then )
                .finally( () => counter.value-- )
                .catch( e => console.error( e ) );
        }

        await counter.wait();

        return finalRes;
    }

    async sendNotification ( type, users, subject, body, options = {} ) {
        if ( !this.#hasEnabledChannels ) return;

        // invalid notification type
        if ( !this.#types[ type ] ) throw `Notification type "${ type }" is invalid`;

        const channelUsers = {};

        if ( !Array.isArray( users ) ) users = [ users ];

        users = await this.app.users.getUsers( users );
        if ( !users ) return result( [ 500, "Unable to get users" ] );

        for ( const user of users ) {
            if ( !user.isEnabled ) continue;

            const defaultChannels = this.#types[ type ].channels,
                userChannels = user.notifications?.[ type ];

            for ( const channel in defaultChannels ) {
                if ( !defaultChannels[ channel ].enabled ) continue;

                const subscribed = defaultChannels[ channel ].editable
                    ? ( userChannels?.[ channel ] ?? defaultChannels[ channel ].subscribed )
                    : defaultChannels[ channel ].subscribed;

                if ( !subscribed ) continue;

                channelUsers[ channel ] ??= [];
                channelUsers[ channel ].push( user );
            }
        }

        const promises = [];

        // internal
        if ( channelUsers.internal?.length ) {
            promises.push( this.sendInternalNotification( channelUsers.internal, subject, body, options.internal ) );
        }

        // email
        if ( channelUsers.email?.length ) {
            promises.push( this.sendEmailNotification( channelUsers.email, subject, body, options.email ) );
        }

        // telegram
        if ( channelUsers.telegram?.length ) {
            promises.push( this.sendTelegramNotification( channelUsers.telegram, subject, body, options.telegram ) );
        }

        // push
        if ( channelUsers.push?.length ) {
            promises.push( this.sendPushNotification( channelUsers.push, subject, body, options.push ) );
        }

        return Promise.all( promises );
    }

    async sendInternalNotification ( users, subject, body, { maxAge } = {} ) {

        // service not available
        if ( !this.channels.internal.enabled ) return result( 503 );

        if ( !Array.isArray( users ) ) users = [ users ];

        users = await this.app.users.getUsers( users );
        if ( !users ) return result( [ 500, "Unable to get users" ] );

        if ( maxAge === undefined ) maxAge = this.config.internalNotificationsMaxAge;

        if ( maxAge ) {
            var expires = Interval.new( maxAge ).addDate();
        }

        const locales = {},
            userId = [];

        for ( const user of users ) {
            if ( !user.isEnabled ) continue;

            userId.push( user.id );

            locales[ user.locale ] ??= {
                "users": [],
                "subject": L10nt.toString( subject, { "localeDomain": user.locale } ),
                "body": L10nt.toString( body, { "localeDomain": user.locale } ),
            };

            locales[ user.locale ].users.push( user.id );
        }

        this.#activityCounter.value++;

        const res = await this.dbh.begin( async dbh => {
            for ( const locale of Object.values( locales ) ) {
                let res;

                res = await dbh.selectRow( SQL.insertInternalNotification, [ locale.subject, locale.body, expires ] );

                if ( !res.ok ) throw res;

                const notificationId = res.data.id;

                res = await dbh.do( sql`INSERT INTO notification_internal_user`.VALUES( locale.users.map( userId => {
                    return {
                        "user_id": userId,
                        "notification_internal_id": notificationId,
                    };
                } ) ) );

                if ( !res.ok ) throw res;
            }

            // send global api event
            this.app.publishToApi( "/notifications/update/", userId, { "inbox": true, "done": false } );
        } );

        this.#activityCounter.value--;

        return res;
    }

    async sendEmailNotification ( users, subject, body, options = {} ) {

        // service not available
        if ( !this.channels.email.supported ) return result( 503 );

        if ( !Array.isArray( users ) ) users = [ users ];

        users = await this.app.users.getUsers( users );
        if ( !users ) return result( [ 500, "Unable to get users" ] );

        const counter = new Counter();

        this.#activityCounter.value++;

        for ( const user of users ) {

            // user not found or disabled
            if ( !user.isEnabled ) continue;

            if ( user.emailIsLocal ) continue;

            counter.value++;

            this.sendEmail(

                //
                user.email,
                L10nt.toString( subject, { "localeDomain": user.locale } ),
                L10nt.toString( body, { "localeDomain": user.locale } ),
                options
            )
                .finally( () => counter.value-- )
                .catch( e => console.error( e ) );
        }

        await counter.wait();

        this.#activityCounter.value--;

        return result( 200 );
    }

    async sendTelegramNotification ( users, subject, body, options ) {
        if ( !this.channels.telegram.supported ) return;

        this.#activityCounter.value++;

        if ( !Array.isArray( users ) ) users = [ users ];

        users = await this.#telegramBot.users.getTelegramUsersByApiUserId( users );
        if ( !users ) return result( [ 500, "Unable to get users" ] );

        for ( const telegramUser of users ) {
            await telegramUser.sendNotification( subject, body );
        }

        this.#activityCounter.value--;

        return result( 200 );
    }

    // target: all, guests, users, root, <userId>
    async sendPushNotification ( targets, subject, body, options = {} ) {
        if ( !this.channels.push.supported ) return result( 503 );

        if ( !Array.isArray( targets ) ) targets = [ targets ];

        const message = { ...options };

        if ( subject || body ) {
            message.notification ||= {};
        }

        message.webpush ??= {};
        message.webpush.notification ??= {};
        message.webpush.notification.icon ??= "/favicon.ico";

        message.webpush.fcmOptions ??= {};
        message.webpush.fcmOptions.link ??= "/";

        const counter = new Counter();

        this.#activityCounter.value++;

        var topics = [],
            users = [];

        // filter targets
        for ( const target of targets ) {
            if ( PUSH_NOTIFICATION_GROUPS.has( target ) ) {
                topics.push( target );
            }
            else {
                users.push( target );
            }
        }

        if ( users.length ) {
            users = await this.app.users.getUsers( users );
            if ( !users ) return result( [ 500, "Unable to get users" ] );

            for ( const user of users ) {
                if ( !user.isEnabled ) continue;

                topics.push( "users." + user.id );
            }
        }

        for ( const topic of topics ) {
            counter.value++;

            this.#googleCloudMessagingApi
                .send( {
                    ...message,
                    "topic": this.#pushNotificationsPrefix + topic,
                    "notification": {
                        "title": subject,
                        body,
                        ...message.notification,
                    },
                } )
                .finally( () => counter.value-- )
                .catch( e => console.error( e ) );
        }

        await counter.wait();

        this.#activityCounter.value--;

        return result( 200 );
    }

    async sendEmail ( to, subject, body, options = {} ) {

        // service not available
        if ( !this.channels.email.supported ) return result( 503 );

        if ( !Array.isArray( to ) ) to = [ to ];

        // filter fake emails
        to.filter( email => !this.app.emailIsLocal( email ) );

        if ( !to.length ) return result( 200 );

        this.#activityCounter.value++;

        const res = await this.#smtp.sendEmail( {
            ...options,
            to,
            subject,
            "textBody": body,
        } );

        this.#activityCounter.value--;

        return res;
    }

    async getUserNotificationsProfile ( userId ) {
        if ( !this.#hasEnabledChannels ) return result( 200 );

        const user = await this.app.users.getUserById( userId );

        // user not found or disabled
        if ( !user?.isEnabled ) return result( 200 );

        const notifications = [];

        for ( const notification in this.#types ) {
            const defaultChannels = this.#types[ notification ].channels,
                userChannels = user.notifications?.[ notification ];

            const notificationProfile = {
                "id": notification,
                "name": this.#types[ notification ].name,
                "description": this.#types[ notification ].description,
                "channels": {},
            };

            notifications.push( notificationProfile );

            for ( const channel of Object.keys( this.channels ) ) {
                notificationProfile.channels[ channel ] = {
                    "enabled": defaultChannels[ channel ].enabled,
                    "editable": defaultChannels[ channel ].editable,
                    "subscribed": defaultChannels[ channel ].editable
                        ? ( userChannels?.[ channel ] ?? defaultChannels[ channel ].subscribed )
                        : defaultChannels[ channel ].subscribed,
                };
            }
        }

        return result( 200, notifications );
    }

    async setUserNotificationSubscribed ( { userId, notification, channel, subscribed } = {} ) {
        if ( !notification ) {
            if ( channel && !this.channels[ channel ] ) return result( [ 400, "Notification channel is not valid" ] );

            const values = [],
                set = {};

            for ( const notification in this.#types ) {
                if ( channel ) {
                    values.push( {
                        "user_id": userId,
                        notification,
                        [ channel ]: subscribed,
                    } );
                }
                else {
                    values.push( {
                        "user_id": userId,
                        "notification_id": sql`get_notification_id( ${ notification } )`,
                        "internal": subscribed,
                        "email": subscribed,
                        "telegram": subscribed,
                        "push": subscribed,
                    } );
                }
            }

            // no notifications
            if ( !values.length ) return result( 200 );

            if ( channel ) {
                set[ channel ] = sql( `EXCLUDED.${ channel }` );
            }
            else {
                set.internal = sql`EXCLUDED.internal`;
                set.email = sql`EXCLUDED.email`;
                set.telegram = sql`EXCLUDED.telegram`;
                set.push = sql`EXCLUDED.push`;
            }

            return this.dbh.do( sql`INSERT INTO user_notification`.VALUES( values ).sql`ON CONFLICT ( user_id, notification_id ) DO UPDATE`.SET( set ) );
        }
        else if ( channel ) {
            const defaultChannel = this.#types[ notification ]?.channels[ channel ];

            if ( !defaultChannel ) return result( [ 400, "Notification channel is not valid" ] );

            if ( !defaultChannel.editable ) return result( [ 400, "Unable to update notification channel" ] );

            return this.dbh.do( SQL.setChannelSubscribed[ channel ], [ userId, notification, subscribed ] );
        }
        else {
            if ( !this.#types[ notification ] ) return result( [ 404, "Notification is not valid" ] );

            return this.dbh.do( SQL.setUserNotificationSubscribed, [

                //
                userId,
                notification,
                subscribed,
                subscribed,
                subscribed,
                subscribed,
            ] );
        }
    }

    async getTelegramBotUserByApiUserId ( userId ) {
        if ( !this.channels.telegram.supported ) return null;

        return this.#telegramBot.users.getTelegramUserByApiUserId( userId );
    }

    // private
    get #telegramBot () {
        return this.app.telegram?.bots.getBotById( this.#telegramBotId );
    }

    async #clear () {
        var mutex;

        if ( this.app.cluster ) {
            mutex = this.app.cluster.mutexes.get( "api/notifications/clear" );

            if ( !( await mutex.tryLock() ) ) return;
        }

        const res = await this.dbh.select( sql`
WITH deleted AS (
    DELETE FROM
        notification_internal_user
    USING
        notification_internal
    WHERE
        notification_internal_user.notification_internal_id = notification_internal.id
        AND notification_internal.expires <= CURRENT_TIMESTAMP
    RETURNING
        notification_internal_user.user_id,
        notification_internal_user.done
)
SELECT
    user_id,
    count( nullif( done, TRUE ) )::int4::boolean AS inbox,
    count( nullif( done, FALSE ) )::int4::boolean AS done
FROM
    deleted
GROUP BY
    user_id
` );

        if ( res.data ) {
            for ( const row of res.data ) {
                const userId = row.user_id;
                delete row.user_id;

                this.app.publishToApi( "/notifications/update/" + userId, row );
            }
        }

        if ( mutex ) await mutex.unlock();
    }
}
