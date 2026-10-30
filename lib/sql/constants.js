export const RESERVED_EVENTS = new Set( [

    // dbh
    "connect",
    "disconnect",
    "destroy",
    "commit",
    "rollback",
] );

export const READ_ONLY_TEST_FLAG = Symbol( "readOnlyTest" );
