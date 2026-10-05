export default class ProxyRegistry {
    #targets = {};
    #finalizationRegistry;

    constructor () {
        this.#finalizationRegistry = new FinalizationRegistry( this.#onProxyDestroy.bind( this ) );
    }

    // public
    has ( id ) {
        return !!this.#targets[ id ];
    }

    get ( id, options ) {
        if ( !id ) throw new Error( "Id is required" );

        var target;

        if ( !this.#targets[ id ] ) {
            target = this._createTarget( id, this.#destroyTarget.bind( this, id ), options );

            this.#targets[ id ] = {
                "proxies": 1,
                target,
            };
        }
        else {
            target = this.#targets[ id ].target;

            this.#targets[ id ].proxies++;
        }

        const proxy = new Proxy( target, this._getProxyHandler() );

        this.#finalizationRegistry.register( proxy, id );

        return proxy;
    }

    // protected
    _getProxyHandler () {
        return {
            get ( target, property ) {
                const value = target[ property ];

                if ( typeof value === "function" ) {
                    return value.bind( target );
                }
                else {
                    return value;
                }
            },

            set ( target, property, value ) {
                target[ property ] = value;

                return true;
            },
        };
    }

    _createTarget ( id, destroy, options ) {
        throw "Method not implemented";
    }

    _isTargetDestroyable ( target ) {
        throw "Method not implemented";
    }

    // private
    #onProxyDestroy ( id ) {
        this.#targets[ id ].proxies--;

        this.#destroyTarget( id );
    }

    #destroyTarget ( id ) {
        if ( this.#targets[ id ].proxies ) return;

        if ( !this._isTargetDestroyable( this.#targets[ id ].target ) ) return;

        delete this.#targets[ id ];
    }
}
