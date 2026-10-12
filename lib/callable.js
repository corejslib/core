const PROXY = {
    apply ( target, that, args ) {
        const { instance, method } = target();

        if ( typeof method === "function" ) {
            return Reflect.apply( method, instance, args );
        }
        else {
            return instance[ method ]( ...args );
        }
    },

    get ( target, property, receiver ) {
        const instance = target().instance,
            value = Reflect.get( instance, property );

        if ( typeof value === "function" ) {
            return new Proxy( value, {
                apply ( target, that, args ) {
                    return Reflect.apply( target, instance, args );
                },
            } );
        }
        else {
            return value;
        }
    },

    set ( target, property, value ) {
        Reflect.set( target().instance, property, value );
    },
};

// public
export class Callable extends Function {
    constructor ( method ) {
        super();

        const self = new Proxy( this, {
            apply ( target, that, args ) {
                if ( typeof method === "function" ) {
                    return Reflect.apply( method, self, args );
                }
                else {
                    return self[ method ]( ...args );
                }
            },
        } );

        // eslint-disable-next-line no-constructor-return
        return self;
    }
}

export function makeCallable ( instance, method, { name } = {} ) {
    const config = {
            instance,
            method,
        },
        target = function () {
            return config;
        };

    Object.defineProperty( target, "name", {
        "value": name || method,
        "configurable": true,
    } );

    return new Proxy( target, PROXY );
}
