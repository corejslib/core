import { isPlainObject } from "#lib/utils";

export function prepareParams ( params ) {
    if ( !params.length ) {
        return;
    }
    else if ( params.length === 1 && isPlainObject( params[ 0 ] ) ) {
        return params[ 0 ];
    }
    else {
        return params;
    }
}
