/**
 * Tests for the pure consumption compute helper (`consumption.ts`).
 *
 * Covers:
 * - Feature: storedge-battery-control, Property 5: Computed discharge limit
 *   clamps to [0, maxDischargeLimit]
 * - Feature: storedge-battery-control, Property 6: Invalid or stale source
 *   forces the limit to zero
 * - Direct coverage of `isSourceValid`
 *
 * Task 3.2. Requirements: 6.2, 6.3, 6.4, 7.1, 7.2, 7.3, 7.4.
 */

import { expect } from 'chai';
import fc from 'fast-check';
import type { SourceSample } from './consumption';
import { computeDischargeLimit, isSourceValid } from './consumption';

const RUNS = { numRuns: 100 };

// A stable "now" so freshness is controlled deterministically via ts offsets.
const NOW_MS = 1_700_000_000_000;

// Finite float values that survive Number() as finite numbers (the "valid val" space).
const finiteValArb: fc.Arbitrary<number> = fc.double({
    min: -1_000_000,
    max: 1_000_000,
    noNaN: true,
    noDefaultInfinity: true,
});

// Positive max discharge limit (Req 7.2 upper bound; must be > 0 to be meaningful).
const maxDischargeLimitArb: fc.Arbitrary<number> = fc.double({
    min: 1,
    max: 1_000_000,
    noNaN: true,
    noDefaultInfinity: true,
});

const maxAgeSecondsArb: fc.Arbitrary<number> = fc.integer({ min: 1, max: 86_400 });

// Build a FRESH, finite-numeric sample: age strictly within [0, maxAge*1000] ms.
function freshValidSample(val: number, maxAgeSeconds: number, ageMs: number): SourceSample {
    return { val, ts: NOW_MS - ageMs };
}

// Values whose Number(...) is NOT finite (invalid by Req 6.3). Note that the
// implementation validates via Number(val), so coercible-to-finite values such
// as null (→0), '' (→0) or [] (→0) are deliberately excluded here — those are
// numerically valid. We only include values that coerce to NaN/±Infinity.
const nonNumericValArb: fc.Arbitrary<unknown> = fc.oneof(
    fc.constant(NaN),
    fc.constant(Infinity),
    fc.constant(-Infinity),
    fc.constant('not-a-number'),
    fc.constant('12abc'),
    fc.constant({}),
    fc.constant([1, 2, 3]),
    fc.constant(undefined),
);

describe('consumption => isSourceValid', () => {
    it('is false when the sample is missing (Req 6.2)', () => {
        expect(isSourceValid(undefined, NOW_MS, 120)).to.equal(false);
    });

    it('valid iff present AND finite-numeric AND fresh (Req 6.2-6.4)', () => {
        fc.assert(
            fc.property(
                fc.oneof(
                    finiteValArb, // finite numeric
                    nonNumericValArb, // non-finite / non-numeric
                ),
                maxAgeSecondsArb,
                // ageMs spans both fresh and stale relative to maxAge*1000.
                fc.integer({ min: 0, max: 200_000_000 }),
                (val, maxAgeSeconds, ageMs) => {
                    const sample: SourceSample = { val, ts: NOW_MS - ageMs };
                    const fresh = NOW_MS - sample.ts <= maxAgeSeconds * 1000;
                    const numericFinite = Number.isFinite(Number(val));
                    const expected = numericFinite && fresh;
                    expect(isSourceValid(sample, NOW_MS, maxAgeSeconds)).to.equal(expected);
                },
            ),
            RUNS,
        );
    });

    it('is false for a stale sample even when numeric (Req 6.4)', () => {
        fc.assert(
            fc.property(finiteValArb, maxAgeSecondsArb, (val, maxAgeSeconds) => {
                // Age just over the allowed window ⇒ stale.
                const staleAgeMs = maxAgeSeconds * 1000 + 1;
                const sample: SourceSample = { val, ts: NOW_MS - staleAgeMs };
                expect(isSourceValid(sample, NOW_MS, maxAgeSeconds)).to.equal(false);
            }),
            RUNS,
        );
    });

    it('is true for a numeric sample exactly at the freshness boundary (Req 6.4)', () => {
        fc.assert(
            fc.property(finiteValArb, maxAgeSecondsArb, (val, maxAgeSeconds) => {
                // Age exactly at the window ⇒ still valid (nowMs - ts <= maxAge*1000).
                const boundaryAgeMs = maxAgeSeconds * 1000;
                const sample: SourceSample = { val, ts: NOW_MS - boundaryAgeMs };
                expect(isSourceValid(sample, NOW_MS, maxAgeSeconds)).to.equal(true);
            }),
            RUNS,
        );
    });
});

describe('consumption => computeDischargeLimit', () => {
    // ------------------------------------------------------------------
    // Feature: storedge-battery-control, Property 5:
    // Computed discharge limit clamps to [0, maxDischargeLimit]
    // ------------------------------------------------------------------
    it('Property 5: clamps to [0, maxDischargeLimit] for valid, fresh sources (Req 7.1-7.3)', () => {
        fc.assert(
            fc.property(
                finiteValArb, // house val
                finiteValArb, // wallbox val
                maxAgeSecondsArb,
                maxDischargeLimitArb,
                // Two independent fresh ages, each within the window.
                fc.integer({ min: 0, max: 1000 }),
                fc.integer({ min: 0, max: 1000 }),
                (houseVal, wallboxVal, maxAgeSeconds, maxDischargeLimit, houseAgeMs, wallboxAgeMs) => {
                    // Keep ages strictly inside the freshness window.
                    const cap = maxAgeSeconds * 1000;
                    const house = freshValidSample(houseVal, maxAgeSeconds, Math.min(houseAgeMs, cap));
                    const wallbox = freshValidSample(wallboxVal, maxAgeSeconds, Math.min(wallboxAgeMs, cap));

                    const result = computeDischargeLimit(house, wallbox, NOW_MS, maxAgeSeconds, maxDischargeLimit);
                    const expected = Math.min(Math.max(houseVal - wallboxVal, 0), maxDischargeLimit);

                    expect(result).to.equal(expected);
                    expect(result).to.be.at.least(0);
                    expect(result).to.be.at.most(maxDischargeLimit);
                },
            ),
            RUNS,
        );
    });

    it('Property 5: negative difference yields 0 (Req 7.2)', () => {
        fc.assert(
            fc.property(
                finiteValArb,
                fc.double({ min: 1, max: 500_000, noNaN: true, noDefaultInfinity: true }),
                maxDischargeLimitArb,
                (houseVal, positiveDelta, maxDischargeLimit) => {
                    // wallbox strictly greater than house ⇒ negative difference.
                    const house: SourceSample = { val: houseVal, ts: NOW_MS };
                    const wallbox: SourceSample = { val: houseVal + positiveDelta, ts: NOW_MS };
                    const result = computeDischargeLimit(house, wallbox, NOW_MS, 120, maxDischargeLimit);
                    expect(result).to.equal(0);
                },
            ),
            RUNS,
        );
    });

    it('Property 5: difference above the max yields the max (Req 7.3)', () => {
        fc.assert(
            fc.property(
                fc.double({ min: 0, max: 100_000, noNaN: true, noDefaultInfinity: true }),
                maxDischargeLimitArb,
                fc.double({ min: 1, max: 500_000, noNaN: true, noDefaultInfinity: true }),
                (wallboxVal, maxDischargeLimit, overshoot) => {
                    // house - wallbox = maxDischargeLimit + overshoot > maxDischargeLimit.
                    const houseVal = wallboxVal + maxDischargeLimit + overshoot;
                    const house: SourceSample = { val: houseVal, ts: NOW_MS };
                    const wallbox: SourceSample = { val: wallboxVal, ts: NOW_MS };
                    const result = computeDischargeLimit(house, wallbox, NOW_MS, 120, maxDischargeLimit);
                    expect(result).to.equal(maxDischargeLimit);
                },
            ),
            RUNS,
        );
    });

    // ------------------------------------------------------------------
    // Feature: storedge-battery-control, Property 6:
    // Invalid or stale source forces the limit to zero
    // ------------------------------------------------------------------
    it('Property 6: any missing / non-numeric / stale source forces the limit to 0 (Req 6.2-6.4, 7.4)', () => {
        // An arbitrary that yields either a valid fresh sample, or an invalid one
        // (missing / non-numeric / stale), parameterized by the freshness window.
        // The `valid` flag records whether the sample is expected to pass isSourceValid.
        const sampleArb = (maxAgeSeconds: number): fc.Arbitrary<{ sample: SourceSample | undefined; valid: boolean }> =>
            fc.oneof(
                // valid: fresh, finite-numeric
                fc
                    .record({ val: finiteValArb, ageMs: fc.integer({ min: 0, max: maxAgeSeconds * 1000 }) })
                    .map(({ val, ageMs }) => ({ sample: { val, ts: NOW_MS - ageMs }, valid: true })),
                // invalid: missing
                fc.constant({ sample: undefined, valid: false }),
                // invalid: non-numeric val (fresh timestamp so only the value makes it invalid)
                fc.record({ val: nonNumericValArb }).map(({ val }) => ({
                    sample: { val, ts: NOW_MS },
                    valid: false,
                })),
                // invalid: stale (numeric but older than the window)
                fc
                    .record({ val: finiteValArb, extraMs: fc.integer({ min: 1, max: 10_000_000 }) })
                    .map(({ val, extraMs }) => ({
                        sample: { val, ts: NOW_MS - (maxAgeSeconds * 1000 + extraMs) },
                        valid: false,
                    })),
            );

        fc.assert(
            fc.property(
                maxAgeSecondsArb.chain(maxAgeSeconds =>
                    fc.record({
                        maxAgeSeconds: fc.constant(maxAgeSeconds),
                        maxDischargeLimit: maxDischargeLimitArb,
                        house: sampleArb(maxAgeSeconds),
                        wallbox: sampleArb(maxAgeSeconds),
                    }),
                ),
                ({ maxAgeSeconds, maxDischargeLimit, house, wallbox }) => {
                    // Only exercise the "at least one source invalid" case.
                    fc.pre(!house.valid || !wallbox.valid);
                    const result = computeDischargeLimit(
                        house.sample,
                        wallbox.sample,
                        NOW_MS,
                        maxAgeSeconds,
                        maxDischargeLimit,
                    );
                    expect(result).to.equal(0);
                },
            ),
            RUNS,
        );
    });

    it('Property 6: explicit undefined house or wallbox forces 0 (Req 7.4)', () => {
        fc.assert(
            fc.property(finiteValArb, maxDischargeLimitArb, (val, maxDischargeLimit) => {
                const fresh: SourceSample = { val, ts: NOW_MS };
                expect(computeDischargeLimit(undefined, fresh, NOW_MS, 120, maxDischargeLimit)).to.equal(0);
                expect(computeDischargeLimit(fresh, undefined, NOW_MS, 120, maxDischargeLimit)).to.equal(0);
                expect(computeDischargeLimit(undefined, undefined, NOW_MS, 120, maxDischargeLimit)).to.equal(0);
            }),
            RUNS,
        );
    });
});
