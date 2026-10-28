import { compare as utilsCompare } from "#lib/utils";

export class AvlNode {
    key;
    value;
    left;
    right;
    height;

    constructor ( key, value ) {
        this.key = key;
        this.value = value;
        this.left = null;
        this.right = null;
        this.height = 1;
    }
}

export default class AvlTree {
    #compare;
    #size = 0;
    #root = null;

    constructor ( { compare } = {} ) {
        this.#compare = typeof compare === "function"
            ? compare
            : utilsCompare;
    }

    // properties
    get compare () {
        return this.#compare;
    }

    get size () {
        return this.#size;
    }

    get root () {
        return this.#root;
    }

    get firstNode () {
        var node = this.#root;

        if ( node ) {
            while ( node.left ) node = node.left;
        }

        return node;
    }

    get lastNode () {
        var node = this.#root;

        if ( node ) {
            while ( node.right ) node = node.right;
        }

        return node;
    }

    // public
    has ( key ) {
        return this.#findNode( this.#root, key ) != null;
    }

    get ( key ) {
        const node = this.#findNode( this.#root, key );

        return node
            ? node.value
            : undefined;
    }

    set ( key, value ) {
        this.#root = this.#set( this.#root, key, value );

        return this;
    }

    delete ( key ) {
        this.#root = this.#delete( this.#root, key );

        return this;
    }

    clear () {
        this.#root = null;
        this.#size = 0;

        return this;
    }

    keys () {
        return this[ Symbol.iterator ]().map( node => node.key );
    }

    values () {
        return this[ Symbol.iterator ]().map( node => node.value );
    }

    entries () {
        return this[ Symbol.iterator ]().map( node => [ node.key, node.value ] );
    }

    toJSON () {
        return this.entries().toArray();
    }

    * [ Symbol.iterator ] () {
        var node = this.#root,
            stack = [];

        while ( true ) {
            if ( node ) {
                stack.push( node );

                node = node.left;
            }
            else {
                if ( stack.length ) {
                    node = stack.pop();

                    yield node;

                    node = node.right;
                }
                else {
                    break;
                }
            }
        }
    }

    [ Symbol.for( "nodejs.util.inspect.custom" ) ] ( depth, options, inspect ) {
        const spec = {
            "size": this.size,
        };

        return `${ this.constructor.name }: ${ inspect( spec ) }`;
    }

    // protected
    _createNode ( key, value ) {
        return new AvlNode( key, value );
    }

    _updateHeight ( node ) {
        node.height = 1 + Math.max( this.#height( node.left ), this.#height( node.right ) );
    }

    // private
    #findNode ( node, key ) {
        let current = node;

        while ( current ) {
            const cmp = this.#compare( key, current.key );

            if ( cmp === 0 ) return current;

            current = cmp < 0
                ? current.left
                : current.right;
        }
    }

    #delete ( node, key ) {
        if ( !node ) return;

        const cmp = this.#compare( key, node.key );

        if ( cmp < 0 ) {
            node.left = this.#delete( node.left, key );
        }
        else if ( cmp > 0 ) {
            node.right = this.#delete( node.right, key );
        }
        else {
            if ( !node.left || !node.right ) {
                const child = node.left
                    ? node.left
                    : node.right;

                this.#size--;

                if ( !child ) {
                    node = null;
                }
                else {
                    node = child;
                }
            }
            else {
                const successor = this.#minValueNode( node.right );
                node.key = successor.key;
                node.value = successor.value;

                node.right = this.#delete( node.right, successor.key );
            }
        }

        if ( !node ) return;

        return this.#balance( node );
    }

    #minValueNode ( node ) {
        let current = node;

        while ( current.left ) {
            current = current.left;
        }

        return current;
    }

    #height ( node ) {
        return node
            ? node.height
            : 0;
    }

    #balanceFactor ( node ) {
        return this.#height( node.left ) - this.#height( node.right );
    }

    #rotateRight ( y ) {
        const x = y.left,
            T2 = x.right;

        x.right = y;
        y.left = T2;

        this._updateHeight( y );
        this._updateHeight( x );

        return x;
    }

    #rotateLeft ( x ) {
        const y = x.right,
            T2 = y.left;

        y.left = x;
        x.right = T2;

        this._updateHeight( x );
        this._updateHeight( y );

        return y;
    }

    #balance ( node ) {
        this._updateHeight( node );
        const balance = this.#balanceFactor( node );

        // Left Left
        if ( balance > 1 && this.#balanceFactor( node.left ) >= 0 ) {
            return this.#rotateRight( node );
        }

        // Left Right
        if ( balance > 1 && this.#balanceFactor( node.left ) < 0 ) {
            node.left = this.#rotateLeft( node.left );

            return this.#rotateRight( node );
        }

        // Right Right
        if ( balance < -1 && this.#balanceFactor( node.right ) <= 0 ) {
            return this.#rotateLeft( node );
        }

        // Right Left
        if ( balance < -1 && this.#balanceFactor( node.right ) > 0 ) {
            node.right = this.#rotateRight( node.right );

            return this.#rotateLeft( node );
        }

        return node;
    }

    #set ( node, key, value ) {
        if ( !node ) {
            this.#size++;

            return this._createNode( key, value );
        }

        const cmp = this.#compare( key, node.key );

        if ( cmp < 0 ) {
            node.left = this.#set( node.left, key, value );
        }
        else if ( cmp > 0 ) {
            node.right = this.#set( node.right, key, value );
        }
        else {

            // ключ уже существует — просто обновляем значение
            node.value = value;

            return node;
        }

        return this.#balance( node );
    }
}
