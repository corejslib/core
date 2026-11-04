import fs from "node:fs";
import os from "node:os";

const ramTotal = os.totalmem();

class MonitoringState {
    #hasCpu;
    #hasRam;
    #hasHdd;
    #hddPath;
    #time;
    #date;
    #cpu;
    #ramFree;
    #rssUsed;
    #hddTotal;
    #hddFree;

    constructor ( { cpu, ram, hdd, hddPath } = {} ) {
        this.#time = process.hrtime.bigint();
        this.#date = Temporal.Now.instant();

        if ( cpu ) {
            this.#hasCpu = true;

            this.#cpu = this.#getCpuUsage();
        }

        if ( ram ) {
            this.#hasRam = true;

            this.#ramFree = os.freemem();
            this.#rssUsed = process.memoryUsage.rss();
        }

        if ( hdd ) {
            this.#hasHdd = true;
            this.#hddPath = hddPath || process.cwd();
        }
    }

    // properties
    get hasCpu () {
        return this.#hasCpu;
    }

    get hasRam () {
        return this.#hasRam;
    }

    get hasHdd () {
        return this.#hasHdd;
    }

    get hddPath () {
        return this.#hddPath;
    }

    get time () {
        return this.#time;
    }

    get date () {
        return this.#date;
    }

    get cpu () {
        return this.#cpu;
    }

    get ramTotal () {
        return ramTotal;
    }

    get ramFree () {
        return this.#ramFree;
    }

    get ramUsed () {
        return this.ramTotal - this.ramFree;
    }

    get rssUsed () {
        return this.#rssUsed;
    }

    get hddTotal () {
        return this.#hddTotal;
    }

    get hddFree () {
        return this.#hddFree;
    }

    get hddUsed () {
        return this.hddTotal - this.hddFree;
    }

    // public
    async init () {
        if ( this.hasHdd ) {
            const stat = await fs.promises.statfs( this.hddPath );

            this.#hddTotal = stat.blocks * stat.bsize;
            this.#hddFree = stat.bfree * stat.bsize;
        }

        return this;
    }

    initSync () {
        if ( this.hasHdd ) {
            const stat = fs.statfsSync( this.hddPath );

            this.#hddTotal = stat.blocks * stat.bsize;
            this.#hddFree = stat.bfree * stat.bsize;
        }

        return this;
    }

    // private
    #getCpuUsage () {
        var user = 0,
            nice = 0,
            system = 0,
            idle = 0,
            irq = 0,
            total;

        const cpus = os.cpus();

        for ( var cpu in cpus ) {
            user += cpus[ cpu ].times.user;
            nice += cpus[ cpu ].times.nice;
            system += cpus[ cpu ].times.sys;
            irq += cpus[ cpu ].times.irq;
            idle += cpus[ cpu ].times.idle;
        }

        total = user + nice + system + idle + irq;

        return {
            user,
            system,
            nice,
            irq,
            "idle": idle,
            "total": total,
        };
    }
}

export function createState ( options ) {
    const state = new MonitoringState( options );

    return state.init();
}

export function createStateSync ( options ) {
    const state = new MonitoringState( options );

    return state.initSync();
}
