import DnsWatcher from "#lib/dns/watcher";
import Signal from "#lib/threads/signal";

class Stats {
    #pool;

    constructor ( pool ) {
        this.#pool = pool;
    }

    // public
    toString () {
        return JSON.stringify( this.toJSON(), null, 4 );
    }

    toJSON () {
        const connections = this.#pool._connections;

        return {
            "primary": {
                "maxConnections": this.#pool.maxConnections,
                "totalConnections": connections.primary.total,
                "idleConnections": connections.primary.idle.size,
                "activeConnections": connections.primary.active.size,
                "lockedConnections": connections.primary.locked.size,
            },
            "standby": {
                "maxConnectionsPerStandby": this.#pool.maxConnectionsPerStandby,
                "totalConnections": connections.standby.total,
                "idleConnections": connections.standby.idle.size,
                "activeConnections": connections.standby.active.size,
            },
        };
    }
}

export default Super =>
    class extends ( Super || class {} ) {
        #stats = new Stats( this );
        #idleTimeouts = new Map();
        #dnsWatcher;

        #destroyedConnection;

        #primaryConnections = {
            "total": 0,
            "idle": new Set(),
            "active": new Set(),
            "locked": new Set(),
            "signal": new Signal(),
        };

        #standbyConnections = {
            "total": 0,
            "hosts": {},
            "idle": new Set(),
            "active": new Set(),
            "signal": new Signal(),
        };

        // properties
        get stats () {
            return this.#stats;
        }

        get _connections () {
            return {
                "primary": this.#primaryConnections,
                "standby": this.#standbyConnections,
            };
        }

        // protected
        async _getConnection ( { lock, standby } = {} ) {

            // dbh is destroyed
            if ( this.isDestroyed ) {
                return this.#getFakeConnection();
            }

            if ( standby ) {
                if ( !this.standbyHostname ) {
                    standby = false;
                }
                else if ( !this.#dnsWatcher ) {
                    this.#dnsWatcher = new DnsWatcher( this.standbyHostname ).unref().start();
                }
            }

            const connections = standby
                ? this.#standbyConnections
                : this.#primaryConnections;

            while ( true ) {
                let dbh;

                // do not lock last connection to avoid deadlocks
                const lastConnection = !standby && lock && this.maxConnections - connections.locked.size <= 1;

                // try to get idle primary / standby connection, do not lock last connection
                if ( connections.idle.size && !lastConnection ) {
                    dbh = connections.idle.values().next().value;

                    this.#deleteIdleTimeout( dbh );
                    connections.idle.delete( dbh );

                    if ( lock ) {
                        connections.locked.add( dbh );
                    }
                    else {
                        connections.active.add( dbh );
                    }
                }

                // standby
                else if ( standby ) {
                    const addresses = await this.#dnsWatcher.lookup(),
                        hosts = connections.hosts;

                    let standbyAddress;

                    // standby is not available, create destroyed standby connection
                    if ( !addresses.size && !connections.active.size ) {
                        return this.#getFakeConnection();
                    }

                    // can create new standby connection
                    else if ( connections.total < addresses.size * this.maxConnectionsPerStandby ) {
                        let addrConnections = Infinity;

                        // find standby host with the minimal number of connections
                        for ( const address of addresses ) {

                            // new standby host
                            if ( !hosts[ address ] ) {
                                standbyAddress = address;

                                break;
                            }

                            // host max connections reached
                            else if ( hosts[ address ] >= this.maxConnectionsPerStandby ) {
                                continue;
                            }

                            // find host with the minimal number of connections
                            else if ( hosts[ address ] < addrConnections ) {
                                standbyAddress = address;

                                addrConnections = hosts[ standbyAddress ];
                            }
                        }
                    }

                    // create standby connection
                    if ( standbyAddress ) {
                        connections.total++;

                        hosts[ standbyAddress ] ||= 0;
                        hosts[ standbyAddress ]++;

                        dbh = this._newConnection( { standbyAddress } );

                        dbh.on( "destroy", this.#onConnectionDestroy.bind( this ) );
                        dbh.on( "idle", this.#onConnectionIdle.bind( this ) );

                        connections.active.add( dbh );
                    }

                    // reuse active standby connection
                    else {
                        dbh = connections.active.values().next().value;

                        // rotate
                        connections.active.delete( dbh );
                        connections.active.add( dbh );
                    }
                }

                // create new primary connection
                else if ( connections.total < this.maxConnections && !lastConnection ) {
                    connections.total++;

                    dbh = this._newConnection();

                    dbh.on( "destroy", this.#onConnectionDestroy.bind( this ) );
                    dbh.on( "idle", this.#onConnectionIdle.bind( this ) );

                    if ( lock ) {
                        connections.locked.add( dbh );
                    }
                    else {
                        connections.active.add( dbh );
                    }
                }

                // try to get active primary connection
                else if ( !lock && connections.active.size ) {
                    dbh = connections.active.values().next().value;

                    // rotate
                    connections.active.delete( dbh );
                    connections.active.add( dbh );
                }

                // wait for primary connection unlock
                else {
                    await connections.signal.wait();

                    continue;
                }

                return dbh;
            }
        }

        _destroy () {
            this.#dnsWatcher?.stop();

            for ( const connections of [ this.#primaryConnections, this.#standbyConnections ] ) {
                for ( const connection of connections.idle ) connection.destroy();

                for ( const connection of connections.active ) connection.destroy();

                if ( connections.locked ) {
                    for ( const connection of connections.locked ) connection.destroy();
                }

                connections.signal.broadcast();
            }

            if ( super._destroy ) return super._destroy();
        }

        // private
        #onConnectionDestroy ( dbh, res ) {
            const connections = dbh.isPrimary
                ? this.#primaryConnections
                : this.#standbyConnections;

            this.#deleteIdleTimeout( dbh );
            connections.total--;
            connections.idle.delete( dbh );
            connections.active.delete( dbh );

            // primary
            if ( dbh.isPrimary ) {
                connections.locked.delete( dbh );
            }

            // standby
            else {

                // decrease standby addr connections
                connections.hosts[ dbh.standbyAddress ]--;
                if ( !connections.hosts[ dbh.standbyAddress ] ) delete connections.hosts[ dbh.standbyAddress ];

                if ( !res.ok ) this.#dnsWatcher.reset();
            }

            connections.signal.trySend();
        }

        #onConnectionIdle ( dbh ) {

            // connetion is in the transaction state, destroy
            if ( dbh.inTransaction ) {
                dbh.destroy();
            }

            // idle
            else {
                const connections = dbh.isPrimary
                    ? this.#primaryConnections
                    : this.#standbyConnections;

                this.#deleteIdleTimeout( dbh );

                // set idle timeout
                if ( this.idleTimeout ) {
                    this.#idleTimeouts.set(
                        dbh,
                        setTimeout( () => dbh.destroy( result( [ 200, "Database connection closed on timeout" ] ) ), this.idleTimeout )
                    );
                }

                connections.idle.add( dbh );
                connections.active.delete( dbh );

                // primary
                if ( dbh.isPrimary ) {
                    connections.locked.delete( dbh );
                }

                connections.signal.trySend();
            }
        }

        #deleteIdleTimeout ( dbh ) {
            clearTimeout( this.#idleTimeouts.get( dbh ) );

            this.#idleTimeouts.delete( dbh );
        }

        #getFakeConnection () {
            this.#destroyedConnection ??= this._newConnection( {
                "destroyed": true,
                "standbyAddress": "0.0.0.0",
            } );

            return this.#destroyedConnection;
        }
    };
