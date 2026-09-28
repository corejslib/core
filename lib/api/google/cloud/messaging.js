import Oauth from "#lib/api/google/oauth";
import fetch from "#lib/fetch";

const DEFAULT_MAX_RUNNING_THREADS = 20;

export default class GoogleCloudMessaging {
    #oauth;
    #dispatcher = new fetch.Dispatcher( {
        "connections": DEFAULT_MAX_RUNNING_THREADS,
    } );

    constructor ( key ) {
        this.#oauth = new Oauth( key, "https://www.googleapis.com/auth/firebase.messaging" );
    }

    // public
    // DOCS: https://firebase.google.com/docs/cloud-messaging/send-topic-messages#using_the_http_v1_api
    async send ( message ) {
        const token = await this.#oauth.getToken();
        if ( !token.ok ) return token;

        const res = await fetch( `https://fcm.googleapis.com/v1/projects/${ this.#oauth.projectId }/messages:send`, {
            "method": "POST",
            "dispatcher": this.#dispatcher,
            "headers": {
                "Authorization": "Bearer " + token.data,
                "Content-Type": "application/json",
            },
            "body": JSON.stringify( { message } ),
        } );

        if ( res.ok ) {
            return result( 200, await res.json() );
        }
        else {
            try {
                const data = await res.json();

                return result( [ 500, data.error?.message || res.statusText ] );
            }
            catch {
                return result( res );
            }
        }
    }

    // DOCS: https://firebase.google.com/docs/cloud-messaging/manage-topic-subscriptions#manage-topic-subscriptions-server-side-api
    async subscribeToTopic ( topic, deviceToken ) {
        const token = await this.#oauth.getToken();
        if ( !token.ok ) return token;

        const res = await fetch( `https://fcm.googleapis.com/v1/projects/${ this.#oauth.projectId }/registrations/${ deviceToken }/topicSubscriptions?topic_name=${ topic }`, {
            "method": "POST",
            "dispatcher": this.#dispatcher,
            "headers": {
                "access_token_auth": "true",
                "Authorization": "Bearer " + token.data,
                "Content-Type": "application/json",
            },
            "body": JSON.stringify( {} ),
        } );

        if ( res.ok ) {
            const data = await res.json();

            return result( 200, data );
        }
        else {
            return result( res.status );
        }
    }

    // DOCS: https://firebase.google.com/docs/cloud-messaging/manage-topic-subscriptions#manage-topic-subscriptions-server-side-api
    async unsubscribeFromTopic ( topic, deviceToken ) {
        const token = await this.#oauth.getToken();
        if ( !token.ok ) return token;

        const res = await fetch( `https://fcm.googleapis.com/v1/projects/${ this.#oauth.projectId }/registrations/${ deviceToken }/topicSubscriptions/${ topic }`, {
            "method": "DELETE",
            "dispatcher": this.#dispatcher,
            "headers": {
                "access_token_auth": "true",
                "Authorization": "Bearer " + token.data,
                "Content-Type": "application/json",
            },
            "body": JSON.stringify( {} ),
        } );

        return result( res.status );
    }
}
