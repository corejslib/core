import { compare } from "#lib/utils";
import AvlTreeNode from "./avl-tree/node.js";

export default class AvlTree {
    #comparator;
    #allowDuplicates;
    #root;
    #size = 0;

    constructor ( { comparator, allowDuplicates } = {} ) {
        this.#comparator = comparator || compare;
        this.#allowDuplicates = !!allowDuplicates;
    }

    // properties
    get allowDuplicates () {
        return this.#allowDuplicates;
    }

    get comparator () {
        return this.#comparator;
    }

    get size () {
        return this.#size;
    }

    get isEmpty () {
        return !this.#root;
    }

    get root () {
        return this.#root;
    }

    // public
    clear () {
        this.#root = null;
        this.#size = 0;
        return this;
    }

    has ( key ) {
        if ( this.#root ) {
            const comparator = this.#comparator;

            var node = this.#root;

            while ( node ) {
                var cmp = comparator( key, node.key );

                if ( cmp === 0 ) return true;
                else if ( cmp < 0 ) node = node.left;
                else node = node.right;
            }
        }
        return false;
    }

    get ( key ) {
        const root = this.#root,
            compare = this.#comparator;

        // if (root == null)    return;
        // if (key === root.key) return root;

        var subtree = root,
            cmp;

        while ( subtree ) {
            cmp = compare( key, subtree.key );

            if ( cmp === 0 ) return subtree;
            else if ( cmp < 0 ) subtree = subtree.left;
            else subtree = subtree.right;
        }

        return;
    }

    set ( key, value ) {
        return this.#set( key, value, false );
    }

    add ( key, value ) {
        return this.#set( key, value, this.#allowDuplicates );
    }

    delete ( key ) {
        if ( !this.#root ) return null;

        var node = this.#root,
            compare = this.#comparator,
            cmp = 0;

        while ( node ) {
            cmp = compare( key, node.key );
            if ( cmp === 0 ) break;
            else if ( cmp < 0 ) node = node.left;
            else node = node.right;
        }

        // node not found
        if ( !node ) return null;

        var returnValue = node.clone(),
            max,
            min;

        if ( node.left ) {
            max = node.left;

            while ( max.left || max.right ) {
                while ( max.right ) max = max.right;

                node.key = max.key;
                node.value = max.value;
                if ( max.left ) {
                    node = max;
                    max = max.left;
                }
            }

            node.key = max.key;
            node.value = max.value;
            node = max;
        }

        if ( node.right ) {
            min = node.right;

            while ( min.left || min.right ) {
                while ( min.left ) min = min.left;

                node.key = min.key;
                node.value = min.value;
                if ( min.right ) {
                    node = min;
                    min = min.right;
                }
            }

            node.key = min.key;
            node.value = min.value;
            node = min;
        }

        var parent = node.parent,
            pp = node,
            newRoot;

        while ( parent ) {
            if ( parent.left === pp ) parent.balanceFactor -= 1;
            else parent.balanceFactor += 1;

            if ( parent.balanceFactor < -1 ) {

                // inlined
                // var newRoot = rightBalance(parent);
                if ( parent.right.balanceFactor === 1 ) this.#rotateRight( parent.right );
                newRoot = this.#rotateLeft( parent );

                if ( parent === this.#root ) this.#root = newRoot;
                parent = newRoot;
            }
            else if ( parent.balanceFactor > 1 ) {

                // inlined
                // var newRoot = leftBalance(parent);
                if ( parent.left.balanceFactor === -1 ) this.#rotateLeft( parent.left );
                newRoot = this.#rotateRight( parent );

                if ( parent === this.#root ) this.#root = newRoot;
                parent = newRoot;
            }

            if ( parent.balanceFactor === -1 || parent.balanceFactor === 1 ) break;

            pp = parent;
            parent = parent.parent;
        }

        if ( node.parent ) {
            if ( node.parent.left === node ) node.parent.left = null;
            else node.parent.right = null;
        }

        if ( node === this.#root ) this.#root = null;

        this.#size--;

        return returnValue;
    }

    next ( node ) {
        node ||= this.#root;

        var successor = node;

        if ( successor ) {
            if ( successor.right ) {
                successor = successor.right;

                while ( successor.left ) successor = successor.left;
            }
            else {
                successor = node.parent;

                while ( successor && successor.right === node ) {
                    node = successor;

                    successor = successor.parent;
                }
            }
        }

        return successor;
    }

    previous ( node ) {
        var predecessor = node;

        if ( predecessor ) {
            if ( predecessor.left ) {
                predecessor = predecessor.left;

                while ( predecessor.right ) predecessor = predecessor.right;
            }
            else {
                predecessor = node.parent;

                while ( predecessor && predecessor.left === node ) {
                    node = predecessor;

                    predecessor = predecessor.parent;
                }
            }
        }

        return predecessor;
    }

    isBalanced ( node ) {
        return this.#isBalanced( node || this.#root );
    }

    forEach ( callback ) {
        this.#forEach( callback );

        return this;
    }

    // walk key range from `low` to `high`. Stops if `fn` returns a value
    range ( low, high, callback ) {
        const q = [],
            compare = this.#comparator;

        let node = this.#root,
            cmp;

        while ( q.length !== 0 || node ) {
            if ( node ) {
                q.push( node );

                node = node.left;
            }
            else {
                node = q.pop();

                cmp = compare( node.key, high );

                if ( cmp > 0 ) {
                    break;
                }
                else if ( compare( node.key, low ) >= 0 ) {
                    if ( callback( node ) ) return this; // stop if smth is returned
                }

                node = node.right;
            }
        }

        return this;
    }

    ge ( key, callback ) {
        const q = [],
            compare = this.#comparator;

        let node = this.#root,
            cmp;

        while ( q.length !== 0 || node ) {
            if ( node ) {
                q.push( node );

                node = node.right;
            }
            else {
                node = q.pop();

                cmp = compare( node.key, key );

                if ( cmp <= 0 ) {
                    break;
                }
                else {
                    if ( callback( node ) ) return this; // stop if smth is returned
                }

                node = node.left;
            }
        }

        return this;
    }

    le ( key, callback ) {
        const q = [],
            compare = this.#comparator;

        let node = this.#root,
            cmp;

        while ( q.length !== 0 || node ) {
            if ( node ) {
                q.push( node );

                node = node.left;
            }
            else {
                node = q.pop();

                cmp = compare( node.key, key );

                if ( cmp > 0 ) {
                    break;
                }
                else {
                    if ( callback( node ) ) return this; // stop if smth is returned
                }

                node = node.right;
            }
        }

        return this;
    }

    // returns all keys in order
    keys () {
        const keys = [];

        this.#forEach( node => keys.push( node.key ) );

        return keys;
    }

    // returns values fields of all nodes in order
    values () {
        const values = [];

        this.#forEach( node => values.push( node.value ) );

        return values;
    }

    entries () {
        const entries = [];

        this.#forEach( node => entries.push( [ node.key, node.value ] ) );

        return entries;
    }

    // returns node at given index
    at ( index ) {

        // removed after a consideration, more misleading than useful
        // index = index % this.size;
        // if (index < 0) index = this.size - index;

        var current = this.#root;
        var s = [],
            done = false,
            i = 0;

        while ( !done ) {
            if ( current ) {
                s.push( current );

                current = current.left;
            }
            else {
                if ( s.length > 0 ) {
                    current = s.pop();

                    if ( i === index ) return current;

                    i++;

                    current = current.right;
                }
                else {
                    done = true;
                }
            }
        }
        return null;
    }

    shift () {
        const node = this.getFirstNode();

        if ( !node ) return;

        return this.delete( node.key );
    }

    pop () {
        const node = this.getLastNode();

        if ( !node ) return;

        return this.delete( node.key );
    }

    setEntries ( entries, { sort } = {} ) {
        if ( this.#size !== 0 ) throw new Error( "Tree is not empty" );

        const size = keys.length,
            keys = [],
            values = [];

        for ( const entry of entries ) {
            keys.push( entry[ 0 ] );
            values.push( entry[ 1 ] );
        }

        if ( sort ) this.#sort( keys, values, 0, size - 1, this.#comparator );

        this.#root = this.#load( null, keys, values, 0, size );

        this.#markBalance( this.#root );

        this.#size = size;

        return this;
    }

    toString ( printNode = n => n.key ) {
        const out = [];

        this.#row( this.#root, null, true, v => out.push( v ), printNode );

        return out.join( "" );
    }

    // returns node with the minimum key
    getFirstNode () {
        var node = this.#root;

        if ( !node ) return null;

        while ( node.left ) node = node.left;

        return node;
    }

    // returns node with the max key
    getLastNode () {
        var node = this.#root;
        if ( !node ) return null;
        while ( node.right ) node = node.right;
        return node;
    }

    // private
    #set ( key, value, allowDuplicates ) {
        if ( !this.#root ) {
            this.#root = new AvlTreeNode( {
                "parent": null,
                "left": null,
                "right": null,
                "balanceFactor": 0,
                key,
                value,
            } );

            this.#size++;

            return this.#root;
        }

        var compare = this.#comparator;
        var node = this.#root;
        var parent = null;
        var cmp = 0;

        // allow duplicates
        if ( allowDuplicates ) {
            while ( node ) {
                cmp = compare( key, node.key );

                parent = node;

                if ( cmp <= 0 ) node = node.left;
                else node = node.right;
            }
        }

        // no duplicates
        else {
            while ( node ) {
                cmp = compare( key, node.key );

                parent = node;

                if ( cmp === 0 ) {

                    // update value
                    node.value = value;

                    return null;
                }
                else if ( cmp < 0 ) {
                    node = node.left;
                }
                else {
                    node = node.right;
                }
            }
        }

        var newNode = new AvlTreeNode( {
            "left": null,
            "right": null,
            "balanceFactor": 0,
            parent,
            key,
            value,
        } );

        var newRoot;

        if ( cmp <= 0 ) parent.left = newNode;
        else parent.right = newNode;

        while ( parent ) {
            cmp = compare( parent.key, key );

            if ( cmp < 0 ) parent.balanceFactor -= 1;
            else parent.balanceFactor += 1;

            if ( parent.balanceFactor === 0 ) {
                break;
            }
            else if ( parent.balanceFactor < -1 ) {

                // inlined
                // var newRoot = rightBalance(parent);
                if ( parent.right.balanceFactor === 1 ) this.#rotateRight( parent.right );

                newRoot = this.#rotateLeft( parent );

                if ( parent === this.#root ) this.#root = newRoot;

                break;
            }
            else if ( parent.balanceFactor > 1 ) {

                // inlined
                // var newRoot = leftBalance(parent);
                if ( parent.left.balanceFactor === -1 ) this.#rotateLeft( parent.left );

                newRoot = this.#rotateRight( parent );

                if ( parent === this.#root ) this.#root = newRoot;

                break;
            }

            parent = parent.parent;
        }

        this.#size++;

        return newNode;
    }

    #height ( node ) {
        return node
            ? 1 + Math.max( this.#height( node.left ), this.#height( node.right ) )
            : 0;
    }

    #isBalanced ( root ) {
        if ( root == null ) return true; // If node is empty then return true

        // Get the height of left and right sub trees
        var lh = this.#height( root.left );
        var rh = this.#height( root.right );

        if ( Math.abs( lh - rh ) <= 1 && this.#isBalanced( root.left ) && this.#isBalanced( root.right ) ) return true;

        // If we reach here then tree is not height-balanced
        return false;
    }

    #row ( root, prefix, isTail, out, printNode ) {
        if ( !root ) return;

        var indent;

        if ( prefix == null ) {
            out( `${ printNode( root ) }\n` );

            indent = isTail
                ? ""
                : "│";
        }
        else {
            out( `${ prefix }${ isTail
                ? "└─ "
                : "├─ " }${ printNode( root ) }\n` );

            indent = prefix + ( isTail
                ? "   "
                : "│  " );
        }

        if ( root.left ) this.#row( root.left, indent, !root.right, out, printNode );

        if ( root.right ) this.#row( root.right, indent, true, out, printNode );
    }

    #markBalance ( node ) {
        if ( node == null ) return 0;

        const lh = this.#markBalance( node.left ),
            rh = this.#markBalance( node.right );

        node.balanceFactor = lh - rh;

        return Math.max( lh, rh ) + 1;
    }

    #rotateLeft ( node ) {
        var rightNode = node.right;
        node.right = rightNode.left;

        if ( rightNode.left ) rightNode.left.parent = node;

        rightNode.parent = node.parent;
        if ( rightNode.parent ) {
            if ( rightNode.parent.left === node ) {
                rightNode.parent.left = rightNode;
            }
            else {
                rightNode.parent.right = rightNode;
            }
        }

        node.parent = rightNode;
        rightNode.left = node;

        node.balanceFactor += 1;
        if ( rightNode.balanceFactor < 0 ) {
            node.balanceFactor -= rightNode.balanceFactor;
        }

        rightNode.balanceFactor += 1;
        if ( node.balanceFactor > 0 ) {
            rightNode.balanceFactor += node.balanceFactor;
        }

        return rightNode;
    }

    #rotateRight ( node ) {
        var leftNode = node.left;
        node.left = leftNode.right;
        if ( node.left ) node.left.parent = node;

        leftNode.parent = node.parent;
        if ( leftNode.parent ) {
            if ( leftNode.parent.left === node ) {
                leftNode.parent.left = leftNode;
            }
            else {
                leftNode.parent.right = leftNode;
            }
        }

        node.parent = leftNode;
        leftNode.right = node;

        node.balanceFactor -= 1;
        if ( leftNode.balanceFactor > 0 ) {
            node.balanceFactor -= leftNode.balanceFactor;
        }

        leftNode.balanceFactor -= 1;
        if ( node.balanceFactor < 0 ) {
            leftNode.balanceFactor += node.balanceFactor;
        }

        return leftNode;
    }

    #sort ( keys, values, left, right, compare ) {
        if ( left >= right ) return;

        const pivot = keys[ ( left + right ) >> 1 ];
        let i = left - 1;
        let j = right + 1;

        while ( true ) {
            do i++;
            while ( compare( keys[ i ], pivot ) < 0 );
            do j--;
            while ( compare( keys[ j ], pivot ) > 0 );
            if ( i >= j ) break;

            let tmp = keys[ i ];
            keys[ i ] = keys[ j ];
            keys[ j ] = tmp;

            tmp = values[ i ];
            values[ i ] = values[ j ];
            values[ j ] = tmp;
        }

        this.#sort( keys, values, left, j, compare );

        this.#sort( keys, values, j + 1, right, compare );
    }

    #load ( parent, keys, values, start, end ) {
        const size = end - start;

        if ( size > 0 ) {
            const middle = start + Math.floor( size / 2 ),
                key = keys[ middle ],
                value = values[ middle ],
                node = new AvlTreeNode( { key, value, parent } );

            node.left = this.#load( node, keys, values, start, middle );
            node.right = this.#load( node, keys, values, middle + 1, end );

            return node;
        }
        return null;
    }

    #forEach ( callback ) {
        var current = this.#root;
        var s = [],
            done = false,
            index = 0;

        while ( !done ) {

            // reach the left most Node of the current Node
            if ( current ) {

                // place pointer to a tree node on the stack before traversing the node's left subtree
                s.push( current );
                current = current.left;
            }
            else {

                // backTrack from the empty subtree and visit the Node at the top of the stack; however, if the stack is
                // empty you are done
                if ( s.length > 0 ) {
                    current = s.pop();

                    callback( current, index++ );

                    // we have visited the node and its left subtree. Now, it's right subtree's turn
                    current = current.right;
                }
                else {
                    done = true;
                }
            }
        }

        return this;
    }
}
