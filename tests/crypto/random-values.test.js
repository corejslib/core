#!/usr/bin/env -S node

import assert from "node:assert";
import crypto from "node:crypto";
import { suite, test } from "node:test";
import RandomValues from "#lib/crypto/random-values";
import Numeric from "#lib/numeric";

const TESTS = [
    { "min": 0, "max": 9, "generate": () => randomValues.getRandomDigit() },
    { "min": 0, "max": 1, "generate": () => randomValues.getRandomBinary() },
    { "min": Numeric.MIN_INT8.bigint, "max": Numeric.MAX_INT8.bigint, "generate": () => randomValues.getRandomInt8() },
    { "min": 0, "max": Numeric.MAX_UINT8.bigint, "generate": () => randomValues.getRandomUint8() },
    { "min": Numeric.MIN_INT16.bigint, "max": Numeric.MAX_INT16.bigint, "generate": () => randomValues.getRandomInt16() },
    { "min": 0, "max": Numeric.MAX_UINT16.bigint, "generate": () => randomValues.getRandomUint16() },

    // random int
    { "max": 1, "generate": max => randomValues.getRandomInt( max ) },
    { "max": 2, "generate": max => randomValues.getRandomInt( max ) },
    { "max": 3, "generate": max => randomValues.getRandomInt( max ) },
    { "max": 5, "generate": max => randomValues.getRandomInt( max ) },
    { "max": 10, "generate": max => randomValues.getRandomInt( max ) },
    { "max": 100, "generate": max => randomValues.getRandomInt( max ) },
    { "max": 1000, "generate": max => randomValues.getRandomInt( max ) },
    { "max": 10_000, "generate": max => randomValues.getRandomInt( max ) },

    // internal
    { "max": 1000, "generate": max => crypto.randomInt( 0, Number( max ) + 1 ) },
    { "max": 1000, "generate": max => Math.trunc( Math.random() * ( Number( max ) + 1 ) ) },
];

const iterations = 1_000_000,

    // family-wise a-level, probability of at least one false failure across the whole suite
    familyAlpha = 0.001,

    // Bonferroni correction: every test in TESTS is an independent chance to fail,
    // so the per-test a-level is divided by the number of tests to keep the
    // family-wise error rate at familyAlpha.
    alpha = familyAlpha / TESTS.length,

    randomValues = new RandomValues( 0xFFFF );

function getChi2Crit ( alpha, df ) {
    const t = Math.sqrt( -2 * Math.log( alpha ) ),
        z = t - ( 2.515517 + 0.802853 * t + 0.010328 * t * t ) / ( 1 + 1.432788 * t + 0.189269 * t * t + 0.001308 * t * t * t );

    // Wilson-Hilferty approximation, much more accurate than the Fisher
    // approximation for small df (e.g. binary / digit generators).
    return df * ( 1 - 2 / ( 9 * df ) + z * Math.sqrt( 2 / ( 9 * df ) ) ) ** 3;
}

function calculateChi2 ( { iterations, min = 0, max = 0, generate } ) {
    min = BigInt( min );
    max = BigInt( max );

    if ( min > max ) {
        [ min, max ] = [ max, min ];
    }

    const k = Number( max - min + 1n ),
        expectedFrequency = iterations / k;

    const values = {};

    for ( let v = min; v <= max; v++ ) {
        values[ v ] = {
            "frequency": 0,
        };
    }

    for ( let n = 0; n < iterations; n++ ) {
        const value = generate( max );

        if ( value < min || value > max ) throw `Value outside the range: ${ value }`;

        values[ value ].frequency++;
    }

    var chi2 = 0;

    for ( const value in values ) {
        chi2 += ( values[ value ].frequency - expectedFrequency ) ** 2 / expectedFrequency;
    }

    // degreese of freedom (df)
    const df = k - 1,
        chi2Crit = getChi2Crit( alpha, df );

    return {
        "min": Number( min ),
        "max": Number( max ),
        iterations,
        familyAlpha,
        "tests": TESTS.length,
        alpha,
        df,
        chi2,
        chi2Crit,
        "ok": chi2 <= chi2Crit,

        // values,
    };
}

suite( "crypto", () => {
    suite( "random-values", () => {
        for ( let n = 0; n < TESTS.length; n++ ) {
            test( `chi2Crit-${ n }`, async () => {
                const res = calculateChi2( {
                    iterations,
                    "min": 0,
                    ...TESTS[ n ],
                } );

                assert.ok( res.ok, JSON.stringify( res, null, 4 ) );
            } );
        }
    } );
} );
