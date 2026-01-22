import ansi from "#lib/ansi";
import collectGarbage from "#lib/devel/collect-garbage";
import Monitoring from "#lib/devel/monitoring";
import Table from "#lib/text/table";
import Counter from "#lib/threads/counter";
import ThreadsPool from "#lib/threads/pool";

const WARMING_UP_ITERATIONS = 100;

class Benchmark {
    #title;
    #tests;
    #warmingUpIterations;
    #iterations;
    #seconds;
    #threads;
    #speedMatrix;
    #collectGarbageIterations;

    constructor ( title, tests, { warmingUpIterations, iterations, seconds, threads, speedMatrix, collectGarbageIterations } = {} ) {
        this.#title = title;
        this.#tests = tests;
        this.#warmingUpIterations = warmingUpIterations || WARMING_UP_ITERATIONS;
        this.#iterations = iterations || null;
        this.#seconds = seconds || null;
        this.#threads = threads || Infinity;
        this.#speedMatrix = speedMatrix;
        this.#collectGarbageIterations = collectGarbageIterations;

        if ( !this.iterations && !this.seconds ) throw "Iterations or seconds are required";
    }

    // properties
    get title () {
        return this.#title;
    }

    get warmingUpIterations () {
        return this.#warmingUpIterations;
    }

    get iterations () {
        return this.#iterations;
    }

    get seconds () {
        return this.#seconds;
    }

    get threads () {
        return this.#threads;
    }

    get speedMatrix () {
        return this.#speedMatrix;
    }

    get collectGarbageIterations () {
        return this.#collectGarbageIterations;
    }

    // public
    async run ( options, parent ) {
        console.log( `Benchmark: ${ this.title }` );

        console.log( `Iterations: ${ this.iterations }, seconds: ${ this.seconds }, threads: ${ this.threads }` );

        const meta = {};

        // create tests
        for ( const name of Object.keys( this.#tests ) ) {
            meta[ name ] = {
                name,
                "test": this.#tests[ name ],
                "iterations": this.warmingUpIterations,
                "collectGarbageIterations": this.#collectGarbageIterations,
                "maxDuration": null,
                "threads": 1,
                "async": null,
                "totalDuration": 0, // ms
                "avgDuration": 0, // ms per iteration
                "avgSpeed": 0, // iterations per ms
            };
        }

        // warming up
        for ( const name in meta ) {
            process.stdout.write( `Warming up "${ name }" (${ meta[ name ].async
                ? "async"
                : "sync" }, ${ this.warmingUpIterations } iterations) ... ` );

            await this.#bench( meta[ name ] );

            console.log( "done" );

            meta[ name ].iterations = this.iterations;

            if ( this.seconds ) {
                meta[ name ].maxDuration = this.seconds * 1000;
            }

            meta[ name ].threads = this.threads;
        }

        const table = this.#createBenchTable();

        var baseSpeed;

        // main tests cycle
        for ( const name in meta ) {
            await this.#bench( meta[ name ] );

            let relSpeed;

            if ( baseSpeed == null ) {
                baseSpeed = meta[ name ].avgSpeed;
            }
            else {
                relSpeed = meta[ name ].avgSpeed / baseSpeed;
            }

            table.write( {
                name,
                "iterations": meta[ name ].iterations,
                "duration": meta[ name ].totalDuration,
                "speed": meta[ name ].avgSpeed,
                relSpeed,
            } );
        }

        table.end();

        // speed matrix
        if ( this.speedMatrix ) {
            this.#printSpeedMatrix( meta );
        }
    }

    // private
    async #bench ( meta ) {
        collectGarbage();

        meta.totalDuration = 0; // ms
        meta.avgDuration = 0; // ms per iterations
        meta.avgSpeed = 0; // iterations per ms

        const test = meta.test;

        var iterations = 0,
            totalDuration = 0; // ms

        // detect sync / async
        if ( meta.async == null ) {
            const res = test();

            if ( res instanceof Promise ) {
                await res;

                meta.async = true;
            }
            else {
                meta.async = false;
            }
        }

        // test 1 thread
        if ( !meta.async || meta.threads === 1 ) {
            const monitoring = new Monitoring();

            while ( true ) {
                iterations++;

                monitoring.markSync();

                if ( meta.async ) {
                    await test();
                }
                else {
                    test();
                }

                totalDuration += monitoring.markSync().duration;

                // collect garbage
                if ( meta.collectGarbageIterations && !( iterations % meta.collectGarbageIterations ) ) {
                    collectGarbage();
                }

                if ( meta.iterations && iterations >= meta.iterations ) {
                    break;
                }
                else if ( meta.maxDuration && totalDuration >= meta.maxDuration ) {
                    break;
                }
            }
        }

        // test async, multiple threds
        else if ( meta.threads !== Infinity ) {
            iterations = meta.iterations;

            if ( !iterations ) throw "Iterations are required";

            const threadsPool = new ThreadsPool( {
                "maxRunningThreads": meta.threads,
                "maxWaitingThreads": Infinity,
            } ).pause();

            const counter = new Counter();

            // create threads pool
            for ( let j = 1; j <= iterations; j++ ) {
                counter.value++;

                threadsPool.runThread( test ).then( () => counter.value-- );
            }

            const monitoring = new Monitoring();

            // run threads
            threadsPool.resume();

            await counter.wait();

            totalDuration = monitoring.markSync().duration;
        }

        // test async, infinity threads
        else {
            iterations = meta.iterations;

            if ( !iterations ) throw "Iterations are required";

            const counter = new Counter();

            const monitoring = new Monitoring();

            for ( let j = 1; j <= iterations; j++ ) {
                counter.value++;

                test().then( () => counter.value-- );
            }

            await counter.wait();

            totalDuration = monitoring.markSync().duration;
        }

        meta.iterations = iterations;

        meta.totalDuration = totalDuration; // ms
        meta.avgDuration = meta.totalDuration / meta.iterations; // ms per iterations
        meta.avgSpeed = meta.iterations / meta.totalDuration; // iterations per ms
    }

    #createBenchTable () {
        return new Table( {
            "columns": {
                "name": {
                    "title": ansi.hl( "Name" ),
                    "margin": [ 1, 1 ],
                },
                "iterations": {
                    "title": ansi.hl( "Iterations" ),
                    "width": 14,
                    "headerAlign": "center",
                    "align": "end",
                    "format": value => new Intl.NumberFormat( "en-US" ).format( value ),
                },
                "duration": {
                    "title": ansi.hl( "Duration\n(sec.)" ),
                    "width": 12,
                    "headerAlign": "center",
                    "align": "end",
                    "format": value => new Intl.NumberFormat( "en-US", { "minimumFractionDigits": 3 } ).format( value / 1000 ),
                },
                "speed": {
                    "title": ansi.hl( "Speed\n(iter./sec.)" ),
                    "width": 25,
                    "headerAlign": "center",
                    "align": "end",
                    "format": value => new Intl.NumberFormat( "en-US", { "minimumFractionDigits": 3 } ).format( value * 1000 ),
                },
                "relSpeed": {
                    "title": ansi.hl( "Relative\nSpeed" ),
                    "width": 15,
                    "headerAlign": "center",
                    "align": "end",
                    "format": this.#formatSpeed.bind( this ),
                },
            },
        } ).pipe( process.stdout );
    }

    #formatSpeed ( value ) {
        if ( value == null ) {
            return "-";
        }
        else {
            if ( value < 1 ) value = 0 - 1 / value;

            const text = new Intl.NumberFormat( "en-US", { "minimumFractionDigits": 2, "maximumFractionDigits": 2 } ).format( value );

            if ( value > 0 ) return ansi.ok( " +" + text + "x " );
            else if ( value < 0 ) return ansi.error( " " + text + "x " );
            else return text + "x ";
        }
    }

    #printSpeedMatrix ( meta ) {
        const tests = Object.keys( meta );

        if ( tests.length <= 1 ) return;

        console.log( "Speed matrix:" );

        const table = new Table( {
            "columns": {
                "__header__": {},
                ...Object.fromEntries( Object.values( meta ).map( meta => [
                    meta.name,
                    {
                        "title": ansi.hl( meta.name ),
                        "headerAlign": "center",
                        "align": "end",
                        "format": this.#formatSpeed.bind( this ),
                    },
                ] ) ),
            },
        } ).pipe( process.stdout );

        for ( const test1 of tests ) {
            const row = {
                "__header__": test1,
            };

            for ( const test2 of tests ) {
                if ( test1 === test2 ) {
                    row[ test2 ] = null;
                }
                else {
                    row[ test2 ] = meta[ test1 ].avgSpeed / meta[ test2 ].avgSpeed;
                }
            }

            table.write( row );
        }

        table.end();
    }
}

export default async function benchmark ( title, tests, { warmingUpIterations, iterations, seconds, threads, speedMatrix, collectGarbageIterations } = {} ) {
    const bench = new Benchmark( title, tests, {
        warmingUpIterations,
        iterations,
        seconds,
        threads,
        speedMatrix,
        collectGarbageIterations,
    } );

    return bench.run();
}
