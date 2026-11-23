export const LIFECYCLE_EVENTS = new Map( [
        [ "connect", "start" ],
        [ "disconnect", "stop" ],
        [ "destroy", "destroy" ],
    ] ),
    TRANSACTION_EVENTS = new Set( [ "commit", "rollback" ] ),
    READ_ONLY_TEST_FLAG = Symbol( "readonly-test" );
