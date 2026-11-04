import Locale from "#lib/locale";

const locale = new Locale();

export default class MonitoringMark {
    #startState;
    #endState;
    #duration;

    constructor ( stateA, stateB ) {
        if ( stateA.date <= stateB.date ) {
            this.#startState = stateA;
            this.#endState = stateB;
        }
        else {
            this.#startState = stateB;
            this.#endState = stateA;
        }
    }

    // properties
    get startState () {
        return this.#startState;
    }

    get endState () {
        return this.#endState;
    }

    get hasCpu () {
        return this.#startState.hasCpu && this.#endState.hasCpu;
    }

    get hasRam () {
        return this.#startState.hasRam && this.#endState.hasRam;
    }

    get hasHdd () {
        return this.#startState.hasHdd && this.#endState.hasHdd;
    }

    get duration () {
        return ( this.#duration ??= Number( this.#endState.time - this.#startState.time ) / 1_000_000 );
    }

    get startDate () {
        return this.#startState.date;
    }

    get endDate () {
        return this.#endState.date;
    }

    get cpuUsed () {
        if ( this.hasCpu ) {
            return 1 - ( this.#endState.cpu.idle - this.#startState.cpu.idle ) / ( this.#endState.cpu.total - this.#startState.cpu.total );
        }
        else {
            return null;
        }
    }

    get ramTotal () {
        if ( this.hasRam ) {
            return this.#endState.ramTotal;
        }
        else {
            return null;
        }
    }

    get ramFree () {
        if ( this.hasRam ) {
            return this.#endState.ramFree;
        }
        else {
            return null;
        }
    }

    get ramFreePercent () {
        if ( this.hasRam ) {
            return this.ramFree / this.ramTotal;
        }
        else {
            return null;
        }
    }

    get ramFreeDelta () {
        if ( this.hasRam ) {
            return this.#endState.ramFree - this.#startState.ramFree;
        }
        else {
            return null;
        }
    }

    get ramUsed () {
        if ( this.hasRam ) {
            return this.ramTotal - this.ramFree;
        }
        else {
            return null;
        }
    }

    get ramUsedPercent () {
        if ( this.hasRam ) {
            return this.ramUsed / this.ramTotal;
        }
        else {
            return null;
        }
    }

    get ramUsedDelta () {
        if ( this.hasRam ) {
            return this.ramUsed - ( this.#startState.ramTotal - this.#startState.ramFree );
        }
        else {
            return null;
        }
    }

    get rssUsed () {
        if ( this.hasRam ) {
            return this.#endState.rssUsed;
        }
        else {
            return null;
        }
    }

    get rssUsedPercent () {
        if ( this.hasRam ) {
            return this.rssUsed / this.ramTotal;
        }
        else {
            return null;
        }
    }

    get rssUsedDelta () {
        if ( this.hasRam ) {
            return this.#endState.rssUsed - this.#startState.rssUsed;
        }
        else {
            return null;
        }
    }

    get hddTotal () {
        if ( this.hasHdd ) {
            return this.#endState.hddTotal;
        }
        else {
            return null;
        }
    }

    get hddFree () {
        if ( this.hasHdd ) {
            return this.#endState.hddFree;
        }
        else {
            return null;
        }
    }

    get hddFreePercent () {
        if ( this.hasHdd ) {
            return this.hddFree / this.hddTotal;
        }
        else {
            return null;
        }
    }

    get hddFreeDelta () {
        if ( this.hasHdd ) {
            return this.#endState.hddFree - this.#startState.hddFree;
        }
        else {
            return null;
        }
    }

    get hddUsed () {
        if ( this.hasHdd ) {
            return this.hddTotal - this.hddFree;
        }
        else {
            return null;
        }
    }

    get hddUsedPercent () {
        if ( this.hasHdd ) {
            return this.hddUsed / this.hddTotal;
        }
        else {
            return null;
        }
    }

    get hddUsedDelta () {
        if ( this.hasHdd ) {
            return this.hddUsed - ( this.#startState.hddTotal - this.#startState.hddFree );
        }
        else {
            return null;
        }
    }

    // public
    toString () {
        let string = `duration: ${ locale.formatDuration( this.duration ) }`;

        if ( this.hasCpu ) {
            string += `\ncpu usage: ${ locale.formatPercent( this.cpuUsed ) }`;
        }

        if ( this.hasRam ) {
            string += `\nrss used: ${ locale.formatDigitalSize( this.rssUsed ) }, rss delta: ${ locale.formatDigitalSize( this.rssUsedDelta, "signDisplay:always" ) }`;
        }

        if ( this.hasHdd ) {
            string += `\nhdd total: ${ locale.formatDigitalSize( this.hddTotal ) }, hdd free: ${ locale.formatDigitalSize( this.hddFree ) }, hdd free delta: ${ locale.formatDigitalSize( this.hddFreeDelta, "signDisplay:always" ) }`;
        }

        return string;
    }

    toJSON () {
        const json = {
            "start": this.startDate.toString(),
            "end": this.endDate.toString(),
            "duration": this.duration,
        };

        if ( this.hasCpu ) {
            json.cpuUsed = this.cpuUsed;
        }

        if ( this.hasRam ) {
            json.ramTotal = this.ramTotal;

            json.ramFree = this.ramFree;
            json.ramFreePercent = this.ramFreePercent;
            json.ramFreeDelta = this.ramFreeDelta;

            json.ramUsed = this.ramUsed;
            json.ramUsedPercent = this.ramUsedPercent;
            json.ramUsedDelta = this.ramUsedDelta;

            json.rssUsed = this.rssUsed;
            json.rssUsedPercent = this.rssUsedPercent;
            json.rssUsedDelta = this.rssUsedDelta;
        }

        if ( this.hasHdd ) {
            json.hddTotal = this.hddTotal;

            json.hddFree = this.hddFree;
            json.hddFreePercent = this.hddFreePercent;
            json.hddFreeDelta = this.hddFreeDelta;

            json.hddUsed = this.hddUsed;
            json.hddUsedPercent = this.hddUsedPercent;
            json.hddUsedDelta = this.hddUsedDelta;
        }

        return json;
    }
}
