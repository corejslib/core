export const LIFECYCLE_EVENTS = new Map( [
        [ "connect", "start" ],
        [ "disconnect", "stop" ],
        [ "destroy", "destroy" ],
    ] ),
    TRANSACTION_EVENTS = new Set( [ "commit", "rollback" ] ),
    LOCAL_EVENTS = new Set( Iterator.concat( LIFECYCLE_EVENTS.keys(), TRANSACTION_EVENTS ) ),
    READ_ONLY_TEST_FLAG = Symbol( "readonly-test" );
