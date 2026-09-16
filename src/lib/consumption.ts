// Consumption tracker compute helper (pure functions, no ioBroker imports).
//
// Holds the source-validity predicate and the clamped discharge-limit computation
// so both are unit- and property-testable in isolation. See design.md
// "5. Consumption tracker + compute helper" (Req 6.2-6.4, 7.1-7.4).

/** A single consumption source sample as received from an ioBroker state. */
export interface SourceSample {
    /** Raw state value as received (may be non-numeric or undefined). */
    val: unknown;
    /** State timestamp (ms since epoch), as ioBroker provides on state.ts. */
    ts: number;
}

/**
 * A source is valid iff it is present, numeric (finite), and not older than
 * maxAgeSeconds (Req 6.2-6.4).
 *
 * @param sample The source sample to validate, or undefined when missing.
 * @param nowMs Current time in ms since epoch.
 * @param maxAgeSeconds Maximum allowed age of the sample in seconds.
 */
export function isSourceValid(sample: SourceSample | undefined, nowMs: number, maxAgeSeconds: number): boolean {
    if (sample === undefined) {
        return false;
    }
    if (!Number.isFinite(Number(sample.val))) {
        return false;
    }
    if (nowMs - sample.ts > maxAgeSeconds * 1000) {
        return false;
    }
    return true;
}

/**
 * Computed discharge limit in watts.
 *  - both valid    → min(max(house - wallbox, 0), maxDischargeLimit)   (Req 7.1-7.3)
 *  - either invalid → 0                                                (Req 7.4)
 *
 * @param house The house consumption source sample, or undefined when missing.
 * @param wallbox The wallbox consumption source sample, or undefined when missing.
 * @param nowMs Current time in ms since epoch.
 * @param maxAgeSeconds Maximum allowed age of a sample in seconds.
 * @param maxDischargeLimit Upper bound (watts) for the computed limit.
 */
export function computeDischargeLimit(
    house: SourceSample | undefined,
    wallbox: SourceSample | undefined,
    nowMs: number,
    maxAgeSeconds: number,
    maxDischargeLimit: number,
): number {
    if (!isSourceValid(house, nowMs, maxAgeSeconds) || !isSourceValid(wallbox, nowMs, maxAgeSeconds)) {
        return 0;
    }
    return Math.min(Math.max(Number(house!.val) - Number(wallbox!.val), 0), maxDischargeLimit);
}
