import RangeTree from "#lib/data-structures/range-tree";
import Events from "#lib/events";
import IpAddress from "#lib/ip/address";
import IpRange from "#lib/ip/range";
import Ranges from "#lib/ranges";

export default class IpRanges extends Events {
    #name;
    #rangeTree4 = new RangeTree();
    #rangeTree6 = new RangeTree();
    #json;
    #string;
    #ranges4;
    #ranges6;

    constructor ( { name, ranges } = {} ) {
        super();

        this.#name = name || undefined;

        if ( ranges ) this.#add( ranges );
    }

    // static
    static new ( ipRanges ) {
        if ( ipRanges instanceof this ) {
            return ipRanges;
        }
        else {
            return new this( ipRanges );
        }
    }

    // properties
    get name () {
        return this.#name;
    }

    // public
    has ( ipRange ) {
        ipRange = IpRange.new( ipRange );

        if ( ipRange.isIpV4 ) {
            return this.#rangeTree4.has( ipRange.range );
        }
        else {
            return this.#rangeTree6.has( ipRange.range );
        }
    }

    add ( ipRanges ) {
        const updated = this.#add( ipRanges );

        if ( updated ) this.#onUpdate();

        return this;
    }

    set ( ipRanges ) {
        ipRanges = this.#normalizeRanges( ipRanges );

        let updated = false;

        // find ranges to add
        for ( const ipRange of ipRanges ) {
            if ( !this.has( ipRange ) ) {
                updated = true;

                break;
            }
        }

        // find ranges to delete
        if ( !updated ) {
            const keys = new Set( ipRanges.map( ipRange => ipRange.id ) );

            for ( const ipRange of this ) {
                if ( !keys.has( ipRange.id ) ) {
                    updated = true;

                    break;
                }
            }
        }

        if ( updated ) {
            this.#clear();

            this.#add( ipRanges );

            this.#onUpdate();
        }

        return this;
    }

    delete ( ipRanges ) {
        const updated = this.#delete( ipRanges );

        if ( updated ) this.#onUpdate();

        return this;
    }

    clear () {
        const updated = this.#clear();

        if ( updated ) this.#onUpdate();

        return this;
    }

    getRandomAddressV4 () {
        return new IpAddress( this.#getRanges4().getRandomValue() );
    }

    getRandomAddressV6 () {
        return new IpAddress( this.#getRanges6().getRandomValue() );
    }

    hasRangesIntersecting ( ipRange ) {
        return this.#findRanges( ipRange, "hasRangesIntersecting" );
    }

    hasRangesContaining ( ipRange ) {
        return this.#findRanges( ipRange, "hasRangesContaining" );
    }

    hasRangesCoveredBy ( ipRange ) {
        return this.#findRanges( ipRange, "hasRangesCoveredBy" );
    }

    findRangesIntersecting ( ipRange ) {
        return this.#findRanges( ipRange, "findRangesIntersecting" );
    }

    findRangesContaining ( ipRange ) {
        return this.#findRanges( ipRange, "findRangesContaining" );
    }

    findRangesCoveredBy ( ipRange ) {
        return this.#findRanges( ipRange, "findRangesCoveredBy" );
    }

    toString () {
        if ( this.#string == null ) {
            this.#string = this.toJSON().join( ", " );
        }

        return this.#string;
    }

    toJSON () {
        if ( !this.#json ) {
            this.#json = [

                //
                ...this.#rangeTree4.values(),
                ...this.#rangeTree6.values(),
            ];
        }

        return this.#json;
    }

    [ Symbol.iterator ] () {
        return this.toJSON()[ Symbol.iterator ]();
    }

    // private
    #normalizeRanges ( ipRanges ) {
        if ( typeof ipRanges === "string" ) {
            ipRanges = ipRanges.split( "," ).map( range => range.trim() );
        }
        else if ( !Array.isArray( ipRanges ) ) {
            ipRanges = [ ipRanges ];
        }

        return ipRanges.filter( ipRange => ipRange ).map( ipRange => IpRange.new( ipRange ) );
    }

    #add ( ipRanges ) {
        ipRanges = this.#normalizeRanges( ipRanges );

        let updated = false;

        for ( const ipRange of ipRanges ) {
            if ( ipRange.isIpV4 ) {
                if ( !this.#rangeTree4.has( ipRange.range ) ) {
                    this.#rangeTree4.set( ipRange.range, ipRange );
                    updated = true;
                }
            }
            else {
                if ( !this.#rangeTree6.has( ipRange.range ) ) {
                    this.#rangeTree6.set( ipRange.range, ipRange );
                    updated = true;
                }
            }
        }

        if ( updated ) this.#clearCache();

        return updated;
    }

    #delete ( ipRanges ) {
        ipRanges = this.#normalizeRanges( ipRanges );

        let updated = false;

        for ( const ipRange of ipRanges ) {
            if ( ipRange.isIpV4 ) {
                if ( this.#rangeTree4.has( ipRange.range ) ) {
                    this.#rangeTree4.delete( ipRange.range );
                    updated = true;
                }
            }
            else {
                if ( this.#rangeTree6.has( ipRange.range ) ) {
                    this.#rangeTree6.delete( ipRange.range );
                    updated = true;
                }
            }
        }

        if ( updated ) this.#clearCache();

        return updated;
    }

    #clear () {
        let updated = false;

        if ( this.#rangeTree4.size ) {
            this.#rangeTree4.clear();
            updated = true;
        }

        if ( this.#rangeTree6.size ) {
            this.#rangeTree6.clear();
            updated = true;
        }

        if ( updated ) this.#clearCache();

        return updated;
    }

    #clearCache () {
        this.#json = null;
        this.#string = null;
        this.#ranges4 = null;
        this.#ranges6 = null;
    }

    #onUpdate () {
        this.emit( "update" );
    }

    #findRanges ( ipRange, methodName ) {
        ipRange = IpRange.new( ipRange );

        const tree = ipRange.isIpV4
            ? this.#rangeTree4
            : this.#rangeTree6;

        return tree[ methodName ]( ipRange.range );
    }

    #getRanges4 () {
        if ( !this.#ranges4 ) {
            this.#ranges4 = new Ranges( this.#rangeTree4
                .values()
                .map( ipRange => ipRange.range )
                .toArray() );
        }

        return this.#ranges4;
    }

    #getRanges6 () {
        if ( !this.#ranges6 ) {
            this.#ranges6 = new Ranges( this.#rangeTree6
                .values()
                .map( ipRange => ipRange.range )
                .toArray() );
        }

        return this.#ranges6;
    }
}
