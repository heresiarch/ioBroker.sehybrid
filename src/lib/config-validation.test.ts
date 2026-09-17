/**
 * Tests for the pure configuration validation module.
 *
 * Covers:
 * - Property 5: Configuration validation boundaries (task 2.2)
 * - Config defaults / boundary example tests (task 2.3)
 */

import { expect } from 'chai';
import fc from 'fast-check';
import type { ConfigValidationResult } from './config-validation';
import { CONFIG_BOUNDS, validateConfig } from './config-validation';

// The four fields validateConfig cares about. We build partial configs from these.
type TestConfig = {
    host?: unknown;
    port?: unknown;
    unitId?: unknown;
    pollInterval?: unknown;
};

// Independent oracle mirroring the documented bounds. Kept intentionally simple.
function isValidHost(host: unknown): boolean {
    return (
        typeof host === 'string' &&
        host.length >= CONFIG_BOUNDS.host.minLength &&
        host.length <= CONFIG_BOUNDS.host.maxLength
    );
}
function isValidInt(value: unknown, min: number, max: number): boolean {
    return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}
function isValidPort(port: unknown): boolean {
    return isValidInt(port, CONFIG_BOUNDS.port.min, CONFIG_BOUNDS.port.max);
}
function isValidUnitId(unitId: unknown): boolean {
    return isValidInt(unitId, CONFIG_BOUNDS.unitId.min, CONFIG_BOUNDS.unitId.max);
}
function isValidPollInterval(pollInterval: unknown): boolean {
    return isValidInt(pollInterval, CONFIG_BOUNDS.pollInterval.min, CONFIG_BOUNDS.pollInterval.max);
}

describe('config-validation => validateConfig', () => {
    // --------------------------------------------------------------------
    // Task 2.2 — Property-based test (design Property 5)
    // --------------------------------------------------------------------

    // Arbitraries producing a mix of valid and invalid values for each field.
    // For each field we cover: in-range, out-of-range, non-integer, and wrong-type.
    const hostArb: fc.Arbitrary<unknown> = fc.oneof(
        // valid strings (length 1..253)
        fc.string({ minLength: 1, maxLength: 253 }),
        // invalid: empty string
        fc.constant(''),
        // invalid: too long (254..300)
        fc.string({ minLength: 254, maxLength: 300 }),
        // invalid: wrong types
        fc.integer(),
        fc.boolean(),
        fc.constant(undefined),
        fc.constant(null),
    );

    const portArb: fc.Arbitrary<unknown> = fc.oneof(
        // valid integers inside [1, 65535]
        fc.integer({ min: 1, max: 65535 }),
        // invalid integers outside the range
        fc.integer({ min: -1000, max: 0 }),
        fc.integer({ min: 65536, max: 200000 }),
        // non-integers
        fc.double({ min: -1000, max: 200000, noNaN: true }).filter(n => !Number.isInteger(n)),
        // wrong types
        fc.string(),
        fc.constant(undefined),
    );

    const unitIdArb: fc.Arbitrary<unknown> = fc.oneof(
        // valid integers inside [0, 247]
        fc.integer({ min: 0, max: 247 }),
        // invalid integers outside the range
        fc.integer({ min: -100, max: -1 }),
        fc.integer({ min: 248, max: 1000 }),
        // non-integers
        fc.double({ min: -100, max: 1000, noNaN: true }).filter(n => !Number.isInteger(n)),
        // wrong types
        fc.string(),
        fc.constant(undefined),
    );

    const pollIntervalArb: fc.Arbitrary<unknown> = fc.oneof(
        // valid integers inside [5, 3600]
        fc.integer({ min: 5, max: 3600 }),
        // invalid integers outside the range
        fc.integer({ min: -100, max: 4 }),
        fc.integer({ min: 3601, max: 100000 }),
        // non-integers
        fc.double({ min: -100, max: 100000, noNaN: true }).filter(n => !Number.isInteger(n)),
        // wrong types
        fc.string(),
        fc.constant(undefined),
    );

    const configArb: fc.Arbitrary<TestConfig> = fc.record({
        host: hostArb,
        port: portArb,
        unitId: unitIdArb,
        pollInterval: pollIntervalArb,
    });

    it('Feature: solaredge-sunspec-reader, Property 5: Configuration validation boundaries', () => {
        fc.assert(
            fc.property(configArb, cfg => {
                const hostOk = isValidHost(cfg.host);
                const portOk = isValidPort(cfg.port);
                const unitIdOk = isValidUnitId(cfg.unitId);
                const pollOk = isValidPollInterval(cfg.pollInterval);
                const expectedValid = hostOk && portOk && unitIdOk && pollOk;

                const result: ConfigValidationResult = validateConfig(cfg as Partial<ioBroker.AdapterConfig>);

                // Validity matches the independent oracle.
                expect(result.valid).to.equal(expectedValid);

                // valid === (errors empty)
                expect(result.valid).to.equal(Object.keys(result.errors).length === 0);

                // Every out-of-bounds field must be named in the errors object.
                if (!hostOk) {
                    expect(result.errors).to.have.property('host');
                }
                if (!portOk) {
                    expect(result.errors).to.have.property('port');
                }
                if (!unitIdOk) {
                    expect(result.errors).to.have.property('unitId');
                }
                if (!pollOk) {
                    expect(result.errors).to.have.property('pollInterval');
                }
            }),
            { numRuns: 200 },
        );
    });

    // --------------------------------------------------------------------
    // Task 2.3 — Unit / example tests for defaults & boundary behavior
    // --------------------------------------------------------------------

    // A helper to build a config with the documented defaults, overriding fields as needed.
    function withDefaults(overrides: Partial<TestConfig> = {}): TestConfig {
        return { host: 'inverter.local', port: 502, unitId: 1, pollInterval: 30, ...overrides };
    }

    it('accepts the documented io-package defaults (host set, port 502, unitId 1, pollInterval 30)', () => {
        const result = validateConfig(withDefaults() as Partial<ioBroker.AdapterConfig>);
        expect(result.valid).to.equal(true);
        expect(result.errors).to.deep.equal({});
    });

    describe('port boundaries', () => {
        it('accepts port 1 (lower bound)', () => {
            expect(validateConfig(withDefaults({ port: 1 }) as Partial<ioBroker.AdapterConfig>).valid).to.equal(true);
        });
        it('accepts port 65535 (upper bound)', () => {
            expect(validateConfig(withDefaults({ port: 65535 }) as Partial<ioBroker.AdapterConfig>).valid).to.equal(
                true,
            );
        });
        it('rejects port 0 (below lower bound)', () => {
            const result = validateConfig(withDefaults({ port: 0 }) as Partial<ioBroker.AdapterConfig>);
            expect(result.valid).to.equal(false);
            expect(result.errors).to.have.property('port');
        });
        it('rejects port 65536 (above upper bound)', () => {
            const result = validateConfig(withDefaults({ port: 65536 }) as Partial<ioBroker.AdapterConfig>);
            expect(result.valid).to.equal(false);
            expect(result.errors).to.have.property('port');
        });
    });

    describe('unitId boundaries', () => {
        it('accepts unitId 0 (lower bound)', () => {
            expect(validateConfig(withDefaults({ unitId: 0 }) as Partial<ioBroker.AdapterConfig>).valid).to.equal(true);
        });
        it('accepts unitId 247 (upper bound)', () => {
            expect(validateConfig(withDefaults({ unitId: 247 }) as Partial<ioBroker.AdapterConfig>).valid).to.equal(
                true,
            );
        });
        it('rejects unitId -1 (below lower bound)', () => {
            const result = validateConfig(withDefaults({ unitId: -1 }) as Partial<ioBroker.AdapterConfig>);
            expect(result.valid).to.equal(false);
            expect(result.errors).to.have.property('unitId');
        });
        it('rejects unitId 248 (above upper bound)', () => {
            const result = validateConfig(withDefaults({ unitId: 248 }) as Partial<ioBroker.AdapterConfig>);
            expect(result.valid).to.equal(false);
            expect(result.errors).to.have.property('unitId');
        });
    });

    describe('pollInterval boundaries', () => {
        it('accepts pollInterval 5 (lower bound)', () => {
            expect(validateConfig(withDefaults({ pollInterval: 5 }) as Partial<ioBroker.AdapterConfig>).valid).to.equal(
                true,
            );
        });
        it('accepts pollInterval 3600 (upper bound)', () => {
            expect(
                validateConfig(withDefaults({ pollInterval: 3600 }) as Partial<ioBroker.AdapterConfig>).valid,
            ).to.equal(true);
        });
        it('rejects pollInterval 4 (below lower bound)', () => {
            const result = validateConfig(withDefaults({ pollInterval: 4 }) as Partial<ioBroker.AdapterConfig>);
            expect(result.valid).to.equal(false);
            expect(result.errors).to.have.property('pollInterval');
        });
        it('rejects pollInterval 3601 (above upper bound)', () => {
            const result = validateConfig(withDefaults({ pollInterval: 3601 }) as Partial<ioBroker.AdapterConfig>);
            expect(result.valid).to.equal(false);
            expect(result.errors).to.have.property('pollInterval');
        });
    });

    describe('host boundaries', () => {
        it("rejects empty host ''", () => {
            const result = validateConfig(withDefaults({ host: '' }) as Partial<ioBroker.AdapterConfig>);
            expect(result.valid).to.equal(false);
            expect(result.errors).to.have.property('host');
        });
        it("accepts single-character host 'a'", () => {
            expect(validateConfig(withDefaults({ host: 'a' }) as Partial<ioBroker.AdapterConfig>).valid).to.equal(true);
        });
        it('accepts a 253-character host (upper bound)', () => {
            const host = 'a'.repeat(253);
            expect(validateConfig(withDefaults({ host }) as Partial<ioBroker.AdapterConfig>).valid).to.equal(true);
        });
        it('rejects a 254-character host (above upper bound)', () => {
            const host = 'a'.repeat(254);
            const result = validateConfig(withDefaults({ host }) as Partial<ioBroker.AdapterConfig>);
            expect(result.valid).to.equal(false);
            expect(result.errors).to.have.property('host');
        });
    });

    // --------------------------------------------------------------------
    // Task 9.3 — Property-based tests for the control config rules
    // (design Properties 13-16; Requirements 17.1-17.5)
    //
    // Each property isolates ONE field: the base config supplies valid
    // connection fields (host/port/unitId/pollInterval) and valid values
    // for the other control fields, so only the field under test can fail.
    // Control fields are validated only when present, so leaving them out
    // must keep the config valid.
    // --------------------------------------------------------------------

    // The full set of fields validateConfig may inspect for control.
    type ControlTestConfig = TestConfig & {
        controlEnabled?: unknown;
        defaultStorageControlMode?: unknown;
        defaultFallbackMode?: unknown;
        commandTimeout?: unknown;
        houseConsumptionStateId?: unknown;
        wallboxConsumptionStateId?: unknown;
        maxDischargeLimit?: unknown;
        sourceMaxAgeSeconds?: unknown;
    };

    // A base config that is fully valid on every field validateConfig checks.
    // Overriding a single field lets each property test isolate that field.
    function baseValidControlConfig(overrides: Partial<ControlTestConfig> = {}): ControlTestConfig {
        return {
            host: 'inverter.local',
            port: 502,
            unitId: 1,
            pollInterval: 30,
            // control fields, all individually valid:
            defaultStorageControlMode: 1,
            maxDischargeLimit: 5000,
            sourceMaxAgeSeconds: 120,
            ...overrides,
        };
    }

    describe('Task 9.3 — control config validation properties', () => {
        // ----------------------------------------------------------------
        // Property 13: Default control mode bound (Req 17.1)
        // Accepted iff integer in [0, 4]; else errors.defaultStorageControlMode.
        // ----------------------------------------------------------------
        const defaultStorageControlModeArb: fc.Arbitrary<unknown> = fc.oneof(
            // valid integers in [0, 4]
            fc.integer({ min: 0, max: 4 }),
            // invalid integers outside the range
            fc.integer({ min: -50, max: -1 }),
            fc.integer({ min: 5, max: 50 }),
            // non-integers
            fc.double({ min: -50, max: 50, noNaN: true }).filter(n => !Number.isInteger(n)),
            // wrong types
            fc.string(),
            fc.boolean(),
        );

        it('Feature: storedge-battery-control, Property 13: Default control mode bound', () => {
            fc.assert(
                fc.property(defaultStorageControlModeArb, mode => {
                    const cfg = baseValidControlConfig({ defaultStorageControlMode: mode });
                    const expectedOk =
                        Number.isInteger(mode) &&
                        (mode as number) >= CONFIG_BOUNDS.defaultStorageControlMode.min &&
                        (mode as number) <= CONFIG_BOUNDS.defaultStorageControlMode.max;

                    const result = validateConfig(cfg as Partial<ioBroker.AdapterConfig>);

                    expect(result.valid).to.equal(expectedOk);
                    if (expectedOk) {
                        expect(result.errors).to.not.have.property('defaultStorageControlMode');
                    } else {
                        expect(result.errors).to.have.property('defaultStorageControlMode');
                    }
                }),
                { numRuns: 200 },
            );
        });

        // ----------------------------------------------------------------
        // Property 14: Max discharge limit positivity (Req 17.2)
        // Accepted iff a strictly positive finite number; else
        // errors.maxDischargeLimit.
        // ----------------------------------------------------------------
        const maxDischargeLimitArb: fc.Arbitrary<unknown> = fc.oneof(
            // valid: strictly positive finite numbers
            fc.double({ min: Number.MIN_VALUE, max: 1_000_000, noNaN: true, noDefaultInfinity: true }),
            // invalid: zero and negatives
            fc.constant(0),
            fc.double({ min: -1_000_000, max: 0, noNaN: true, noDefaultInfinity: true }),
            // invalid: non-finite numbers
            fc.constant(Number.NaN),
            fc.constant(Number.POSITIVE_INFINITY),
            fc.constant(Number.NEGATIVE_INFINITY),
            // wrong types
            fc.string(),
            fc.boolean(),
        );

        it('Feature: storedge-battery-control, Property 14: Max discharge limit positivity', () => {
            fc.assert(
                fc.property(maxDischargeLimitArb, limit => {
                    const cfg = baseValidControlConfig({ maxDischargeLimit: limit });
                    const expectedOk = typeof limit === 'number' && Number.isFinite(limit) && limit > 0;

                    const result = validateConfig(cfg as Partial<ioBroker.AdapterConfig>);

                    expect(result.valid).to.equal(expectedOk);
                    if (expectedOk) {
                        expect(result.errors).to.not.have.property('maxDischargeLimit');
                    } else {
                        expect(result.errors).to.have.property('maxDischargeLimit');
                    }
                }),
                { numRuns: 200 },
            );
        });

        // ----------------------------------------------------------------
        // Property 15: Source max age is a positive integer (Req 17.3)
        // Accepted iff a positive integer; else errors.sourceMaxAgeSeconds.
        // ----------------------------------------------------------------
        const sourceMaxAgeArb: fc.Arbitrary<unknown> = fc.oneof(
            // valid: positive integers
            fc.integer({ min: 1, max: 100_000 }),
            // invalid: zero and negative integers
            fc.constant(0),
            fc.integer({ min: -100_000, max: -1 }),
            // invalid: non-integers
            fc.double({ min: -100, max: 100_000, noNaN: true }).filter(n => !Number.isInteger(n)),
            // wrong types
            fc.string(),
            fc.boolean(),
        );

        it('Feature: storedge-battery-control, Property 15: Source max age is a positive integer', () => {
            fc.assert(
                fc.property(sourceMaxAgeArb, age => {
                    const cfg = baseValidControlConfig({ sourceMaxAgeSeconds: age });
                    const expectedOk = Number.isInteger(age) && (age as number) > 0;

                    const result = validateConfig(cfg as Partial<ioBroker.AdapterConfig>);

                    expect(result.valid).to.equal(expectedOk);
                    if (expectedOk) {
                        expect(result.errors).to.not.have.property('sourceMaxAgeSeconds');
                    } else {
                        expect(result.errors).to.have.property('sourceMaxAgeSeconds');
                    }
                }),
                { numRuns: 200 },
            );
        });

        // ----------------------------------------------------------------
        // Property 16: Default fallback mode bound (Req 17.2, 17.7)
        // Accepted iff integer in [0, 7]; else errors.defaultFallbackMode.
        // Isolates defaultFallbackMode: the base config supplies valid
        // connection + other control fields, so only this field can fail.
        // ----------------------------------------------------------------
        const defaultFallbackModeArb: fc.Arbitrary<unknown> = fc.oneof(
            // valid integers in [0, 7]
            fc.integer({ min: 0, max: 7 }),
            // invalid integers outside the range
            fc.integer({ min: -50, max: -1 }),
            fc.integer({ min: 8, max: 50 }),
            // non-integers
            fc.double({ min: -50, max: 50, noNaN: true }).filter(n => !Number.isInteger(n)),
            // wrong types
            fc.string(),
            fc.boolean(),
        );

        it('Feature: storedge-battery-control, Property 16: Default fallback mode bound', () => {
            fc.assert(
                fc.property(defaultFallbackModeArb, mode => {
                    const cfg = baseValidControlConfig({ defaultFallbackMode: mode });
                    const expectedOk =
                        Number.isInteger(mode) &&
                        (mode as number) >= CONFIG_BOUNDS.defaultFallbackMode.min &&
                        (mode as number) <= CONFIG_BOUNDS.defaultFallbackMode.max;

                    const result = validateConfig(cfg as Partial<ioBroker.AdapterConfig>);

                    expect(result.valid).to.equal(expectedOk);
                    if (expectedOk) {
                        expect(result.errors).to.not.have.property('defaultFallbackMode');
                    } else {
                        expect(result.errors).to.have.property('defaultFallbackMode');
                    }
                }),
                { numRuns: 200 },
            );
        });

        // ----------------------------------------------------------------
        // Property 17: Command timeout is a positive integer greater than the
        // poll interval (Req 10.3, 17.3, 17.7)
        // For arbitrary commandTimeout AND pollInterval (both varied), accepted
        // iff commandTimeout is a positive integer AND strictly greater than
        // pollInterval; else errors.commandTimeout. The base config's
        // pollInterval is varied within its valid range [5, 3600] so it never
        // itself fails and only commandTimeout drives the outcome.
        // ----------------------------------------------------------------
        const commandTimeoutArb: fc.Arbitrary<unknown> = fc.oneof(
            // valid: positive integers (may or may not exceed pollInterval)
            fc.integer({ min: 1, max: 10_000 }),
            // invalid: zero and negative integers
            fc.constant(0),
            fc.integer({ min: -10_000, max: -1 }),
            // non-integers
            fc.double({ min: -100, max: 10_000, noNaN: true }).filter(n => !Number.isInteger(n)),
            // wrong types
            fc.string(),
            fc.boolean(),
        );

        // pollInterval is always a valid integer in [5, 3600] so only
        // commandTimeout can drive the failure.
        const validPollIntervalArb: fc.Arbitrary<number> = fc.integer({
            min: CONFIG_BOUNDS.pollInterval.min,
            max: CONFIG_BOUNDS.pollInterval.max,
        });

        it('Feature: storedge-battery-control, Property 17: Command timeout is a positive integer greater than the poll interval', () => {
            fc.assert(
                fc.property(commandTimeoutArb, validPollIntervalArb, (commandTimeout, pollInterval) => {
                    const cfg = baseValidControlConfig({ commandTimeout, pollInterval });
                    const expectedOk =
                        Number.isInteger(commandTimeout) &&
                        (commandTimeout as number) > 0 &&
                        (commandTimeout as number) > pollInterval;

                    const result = validateConfig(cfg as Partial<ioBroker.AdapterConfig>);

                    // pollInterval is always valid, so it must never be flagged.
                    expect(result.errors).to.not.have.property('pollInterval');

                    expect(result.valid).to.equal(expectedOk);
                    if (expectedOk) {
                        expect(result.errors).to.not.have.property('commandTimeout');
                    } else {
                        expect(result.errors).to.have.property('commandTimeout');
                    }
                }),
                { numRuns: 200 },
            );
        });

        // ----------------------------------------------------------------
        // Property 20: Source ids required when control is enabled (Req 17.4)
        // With controlEnabled === true, both houseConsumptionStateId and
        // wallboxConsumptionStateId must be non-empty strings; when either is
        // missing/empty the respective field error is set. When controlEnabled
        // is false/absent they are not required.
        // ----------------------------------------------------------------

        // A value that is either a valid non-empty string id, or an invalid id
        // (empty string / wrong type / missing).
        const sourceIdArb: fc.Arbitrary<unknown> = fc.oneof(
            // valid: non-empty strings
            fc.string({ minLength: 1, maxLength: 60 }),
            // invalid: empty string
            fc.constant(''),
            // invalid: wrong types / missing
            fc.integer(),
            fc.boolean(),
            fc.constant(undefined),
            fc.constant(null),
        );

        function isValidId(id: unknown): boolean {
            return typeof id === 'string' && id.length > 0;
        }

        it('Feature: storedge-battery-control, Property 20: Source ids required when control is enabled', () => {
            fc.assert(
                fc.property(fc.boolean(), sourceIdArb, sourceIdArb, (controlEnabled, houseId, wallboxId) => {
                    const overrides: Partial<ControlTestConfig> = { controlEnabled };
                    // Only attach ids when they are defined so we can also exercise
                    // the "missing" case (undefined) without introducing the key.
                    if (houseId !== undefined) {
                        overrides.houseConsumptionStateId = houseId;
                    }
                    if (wallboxId !== undefined) {
                        overrides.wallboxConsumptionStateId = wallboxId;
                    }
                    const cfg = baseValidControlConfig(overrides);

                    const houseOk = isValidId(houseId);
                    const wallboxOk = isValidId(wallboxId);

                    const result = validateConfig(cfg as Partial<ioBroker.AdapterConfig>);

                    if (controlEnabled) {
                        // Ids are required only when control is enabled.
                        if (houseOk) {
                            expect(result.errors).to.not.have.property('houseConsumptionStateId');
                        } else {
                            expect(result.errors).to.have.property('houseConsumptionStateId');
                        }
                        if (wallboxOk) {
                            expect(result.errors).to.not.have.property('wallboxConsumptionStateId');
                        } else {
                            expect(result.errors).to.have.property('wallboxConsumptionStateId');
                        }
                        expect(result.valid).to.equal(houseOk && wallboxOk);
                    } else {
                        // When control is disabled, the ids are never required,
                        // regardless of their value, so the config stays valid.
                        expect(result.errors).to.not.have.property('houseConsumptionStateId');
                        expect(result.errors).to.not.have.property('wallboxConsumptionStateId');
                        expect(result.valid).to.equal(true);
                    }
                }),
                { numRuns: 200 },
            );
        });

        // ----------------------------------------------------------------
        // Regression example: a config with only the connection fields (no
        // control fields at all) remains valid — control fields are validated
        // only when present (Req 17.1-17.4).
        // ----------------------------------------------------------------
        it('accepts a connection-only config with no control fields present', () => {
            const cfg: TestConfig = { host: 'inverter.local', port: 502, unitId: 1, pollInterval: 30 };
            const result = validateConfig(cfg as Partial<ioBroker.AdapterConfig>);
            expect(result.valid).to.equal(true);
            expect(result.errors).to.deep.equal({});
        });
    });
});
