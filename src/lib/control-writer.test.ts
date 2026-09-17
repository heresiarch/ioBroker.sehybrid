import { expect } from 'chai';
import fc from 'fast-check';
import type { ControlRegisterDef } from './control-registers';
import {
    EXPORT_CONFIG,
    REMOTE_CONTROL_CHARGE_LIMIT,
    REMOTE_CONTROL_COMMAND_MODE,
    REMOTE_CONTROL_COMMAND_TIMEOUT,
    REMOTE_CONTROL_DISCHARGE_LIMIT,
    STORAGE_CONTROL_MODE,
    STORAGE_DEFAULT_MODE,
} from './control-registers';
import { ModbusControlWriter } from './control-writer';
import type { IModbusClient, ModbusReadOptions, ModbusWriteOptions } from './modbus-client';
import { encodeFloat32le, encodeUint32le } from './sunspec-decode';

// ---------------------------------------------------------------------------
// Tasks 3.2 / 3.3 — Property tests for the reworked control-writer dispatch
// layer (SolarEdge documented initial-config + heartbeat procedure).
//
// The properties exercise ModbusControlWriter against a recording IModbusClient
// double. Every writeSingleRegister(address, value) (FC06) and
// writeMultipleRegisters(address, words) (FC16) call is captured so a property
// can assert EXACTLY which register was written, with which encoding, and how
// many times. Reads are no-ops — the control writer never issues reads.
//
// New write flow under test:
//  - write() selects FC06 for uint16 (0xE000/0xE004/0xE00A/0xE00D), FC16 +
//    encodeFloat32le for float32 (0xE010/0xE00E), and FC16 + encodeUint32le for
//    uint32 (0xE00B command timeout).
//  - applyEnable(computedLimit, { defaultFallbackMode, commandTimeout }) issues
//    the six-write initial-config sequence in order: 0xE000=0, 0xE004=4,
//    0xE00A=defaultFallbackMode, 0xE00D=4, 0xE00B=commandTimeout (uint32le, FC16),
//    0xE010=computedLimit (float32le, FC16).
//  - heartbeat(computedLimit, lastWritten, commandTimeout) renews 0xE00B and
//    re-asserts 0xE00D=4 unconditionally, refreshes 0xE010 write-only-if-changed,
//    and never writes 0xE000/0xE004/0xE00A.
// ---------------------------------------------------------------------------

/** StorEdge control-register addresses referenced by the properties. */
const ADDR_EXPORT_CONFIG = 0xe000; // 0xE000 — initial config only (=0)
const ADDR_STORAGE_CONTROL_MODE = 0xe004; // 0xE004 — initial config only (=4)
const ADDR_STORAGE_DEFAULT_MODE = 0xe00a; // 0xE00A — initial config only (=fallback)
const ADDR_REMOTE_COMMAND_TIMEOUT = 0xe00b; // 0xE00B — renewed every heartbeat (uint32le)
const ADDR_REMOTE_COMMAND_MODE = 0xe00d; // 0xE00D — re-asserted every heartbeat (=4)
const ADDR_REMOTE_DISCHARGE_LIMIT = 0xe010; // 0xE010 — write-only-if-changed

/** The command-mode value the writer asserts on 0xE004 and 0xE00D. */
const REMOTE_CONTROL_MODE = 4;

const RUNS = { numRuns: 100 };

/** A single recorded write: the FC used, the target address, and the payload. */
interface RecordedWrite {
    fc: 'FC06' | 'FC16';
    address: number;
    /** uint16 value for FC06, word array for FC16. */
    payload: number | number[];
}

/**
 * Test double implementing {@link IModbusClient} that records every write. FC06
 * writes (`writeSingleRegister`) and FC16 writes (`writeMultipleRegisters`) are
 * appended to {@link writes} in call order. Reads are no-ops that return empty
 * data — the control writer never reads. No real socket is opened.
 *
 * When `failAt` is set, the Nth (1-based) write call rejects instead of being
 * recorded, modelling a Modbus write failure during a heartbeat cycle.
 */
class RecordingClient implements IModbusClient {
    readonly writes: RecordedWrite[] = [];

    /** 1-based index of the write call that should reject; `undefined` = never fail. */
    failAt?: number;

    /** Count of write calls seen so far (including the failing one). */
    private callCount = 0;

    constructor(failAt?: number) {
        this.failAt = failAt;
    }

    connect(_host: string, _port: number, _unitId: number, _timeoutMs?: number): Promise<void> {
        return Promise.resolve();
    }

    readHoldingRegisters(_address: number, _length: number, _opts?: ModbusReadOptions): Promise<number[]> {
        return Promise.resolve([]);
    }

    readInputRegisters(_address: number, _length: number, _opts?: ModbusReadOptions): Promise<number[]> {
        return Promise.resolve([]);
    }

    writeSingleRegister(address: number, value: number, _opts?: ModbusWriteOptions): Promise<void> {
        this.callCount++;
        if (this.failAt !== undefined && this.callCount === this.failAt) {
            return Promise.reject(
                new Error(`Modbus write failure at 0x${address.toString(16)} (call ${this.callCount})`),
            );
        }
        this.writes.push({ fc: 'FC06', address, payload: value });
        return Promise.resolve();
    }

    writeMultipleRegisters(address: number, values: number[], _opts?: ModbusWriteOptions): Promise<void> {
        this.callCount++;
        if (this.failAt !== undefined && this.callCount === this.failAt) {
            return Promise.reject(
                new Error(`Modbus write failure at 0x${address.toString(16)} (call ${this.callCount})`),
            );
        }
        this.writes.push({ fc: 'FC16', address, payload: values.slice() });
        return Promise.resolve();
    }

    isConnected(): boolean {
        return true;
    }

    close(): Promise<void> {
        return Promise.resolve();
    }
}

/**
 * All writes recorded against a given register address.
 *
 * @param client
 * @param address
 */
function writesTo(client: RecordingClient, address: number): RecordedWrite[] {
    return client.writes.filter(w => w.address === address);
}

describe('control-writer', () => {
    // -----------------------------------------------------------------------
    // Feature: storedge-battery-control, Property 2: FC06/FC16 forwarding and
    // function-code selection.
    // Validates: Requirements 2.3, 2.4, 2.5
    //
    // write() maps each control-register def to the correct Modbus function code
    // and on-the-wire encoding:
    //   uint16  (0xE000/0xE004/0xE00A/0xE00D) → FC06 writeSingleRegister(addr, value)
    //   float32 (0xE010/0xE00E)               → FC16 writeMultipleRegisters(addr, encodeFloat32le(value))
    //   uint32  (0xE00B command timeout)      → FC16 writeMultipleRegisters(addr, encodeUint32le(value))
    // -----------------------------------------------------------------------
    describe('Feature: storedge-battery-control, Property 2: FC06/FC16 forwarding and function-code selection', () => {
        it('Feature: storedge-battery-control, Property 2: each def is dispatched to the correct FC and encoding', async () => {
            // uint16 registers → FC06 with the raw integer value.
            const uint16Defs: ControlRegisterDef[] = [
                EXPORT_CONFIG,
                STORAGE_CONTROL_MODE,
                STORAGE_DEFAULT_MODE,
                REMOTE_CONTROL_COMMAND_MODE,
            ];
            // float32 registers → FC16 with encodeFloat32le.
            const float32Defs: ControlRegisterDef[] = [REMOTE_CONTROL_DISCHARGE_LIMIT, REMOTE_CONTROL_CHARGE_LIMIT];

            const uint16ValueArb = fc.integer({ min: 0, max: 0xffff });
            const float32ValueArb = fc.double({ min: 0, max: 100000, noNaN: true, noDefaultInfinity: true });
            const uint32ValueArb = fc.integer({ min: 0, max: 86400 });

            // ---- uint16 defs → FC06 ----
            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 0, max: uint16Defs.length - 1 }),
                    uint16ValueArb,
                    async (defIndex, value) => {
                        const def = uint16Defs[defIndex];
                        const client = new RecordingClient();
                        const writer = new ModbusControlWriter(client);

                        await writer.write(def, value);

                        expect(client.writes.length, 'uint16 write issues exactly one Modbus call').to.equal(1);
                        expect(client.writes[0]).to.deep.equal({ fc: 'FC06', address: def.address, payload: value });
                    },
                ),
                RUNS,
            );

            // ---- float32 defs → FC16 + encodeFloat32le ----
            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 0, max: float32Defs.length - 1 }),
                    float32ValueArb,
                    async (defIndex, value) => {
                        const def = float32Defs[defIndex];
                        const client = new RecordingClient();
                        const writer = new ModbusControlWriter(client);

                        await writer.write(def, value);

                        expect(client.writes.length, 'float32 write issues exactly one Modbus call').to.equal(1);
                        expect(client.writes[0]).to.deep.equal({
                            fc: 'FC16',
                            address: def.address,
                            payload: encodeFloat32le(value),
                        });
                    },
                ),
                RUNS,
            );

            // ---- uint32 (0xE00B command timeout) → FC16 + encodeUint32le ----
            await fc.assert(
                fc.asyncProperty(uint32ValueArb, async commandTimeout => {
                    const client = new RecordingClient();
                    const writer = new ModbusControlWriter(client);

                    await writer.write(REMOTE_CONTROL_COMMAND_TIMEOUT, commandTimeout);

                    expect(client.writes.length, 'uint32 write issues exactly one Modbus call').to.equal(1);
                    expect(client.writes[0].fc, '0xE00B must be written via FC16').to.equal('FC16');
                    expect(client.writes[0].address, '0xE00B address').to.equal(ADDR_REMOTE_COMMAND_TIMEOUT);
                    expect(
                        client.writes[0].payload,
                        '0xE00B payload must be encodeUint32le(commandTimeout)',
                    ).to.deep.equal(encodeUint32le(commandTimeout));
                }),
                RUNS,
            );
        });

        it('Feature: storedge-battery-control, Property 2: write() refuses a def carrying no function code', async () => {
            const valueArb = fc.double({ min: 0, max: 100000, noNaN: true, noDefaultInfinity: true });

            await fc.assert(
                fc.asyncProperty(valueArb, async value => {
                    // Synthetic def with fc undefined — write() must refuse it and
                    // issue no Modbus call.
                    const synthetic: ControlRegisterDef = {
                        name: 'syntheticNoFc',
                        address: 0xe0ff,
                        kind: 'uint16',
                        length: 1,
                        iobType: 'number',
                        min: 0,
                        max: 0xffff,
                        // fc intentionally omitted
                    };

                    const client = new RecordingClient();
                    const writer = new ModbusControlWriter(client);

                    let rejected = false;
                    try {
                        await writer.write(synthetic, value);
                    } catch {
                        rejected = true;
                    }

                    expect(rejected, 'write() on a def with no fc must be refused').to.equal(true);
                    expect(client.writes.length, 'refused write must issue no Modbus call').to.equal(0);
                }),
                RUNS,
            );
        });
    });

    // -----------------------------------------------------------------------
    // Feature: storedge-battery-control, Property 9: Initial configuration writes
    // the full sequence in order.
    // Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5, 9.6
    //
    // For any computedLimit, defaultFallbackMode (0..7) and commandTimeout,
    // applyEnable issues EXACTLY these six writes IN ORDER and no other register:
    //   1. FC06 0xE000 = 0
    //   2. FC06 0xE004 = 4
    //   3. FC06 0xE00A = defaultFallbackMode
    //   4. FC06 0xE00D = 4
    //   5. FC16 0xE00B = encodeUint32le(commandTimeout)
    //   6. FC16 0xE010 = encodeFloat32le(computedLimit)
    // -----------------------------------------------------------------------
    describe('Feature: storedge-battery-control, Property 9: Initial configuration writes the full sequence in order', () => {
        it('Feature: storedge-battery-control, Property 9: applyEnable issues exactly the six initial-config writes in order', async () => {
            const limitArb = fc.double({ min: 0, max: 100000, noNaN: true, noDefaultInfinity: true });
            const fallbackArb = fc.integer({ min: 0, max: 7 });
            const timeoutArb = fc.integer({ min: 0, max: 86400 });

            await fc.assert(
                fc.asyncProperty(
                    limitArb,
                    fallbackArb,
                    timeoutArb,
                    async (computedLimit, defaultFallbackMode, commandTimeout) => {
                        const client = new RecordingClient();
                        const writer = new ModbusControlWriter(client);

                        await writer.applyEnable(computedLimit, { defaultFallbackMode, commandTimeout });

                        // Exactly the six documented writes, in order, and nothing else.
                        expect(client.writes).to.deep.equal([
                            { fc: 'FC06', address: ADDR_EXPORT_CONFIG, payload: 0 },
                            { fc: 'FC06', address: ADDR_STORAGE_CONTROL_MODE, payload: REMOTE_CONTROL_MODE },
                            { fc: 'FC06', address: ADDR_STORAGE_DEFAULT_MODE, payload: defaultFallbackMode },
                            { fc: 'FC06', address: ADDR_REMOTE_COMMAND_MODE, payload: REMOTE_CONTROL_MODE },
                            {
                                fc: 'FC16',
                                address: ADDR_REMOTE_COMMAND_TIMEOUT,
                                payload: encodeUint32le(commandTimeout),
                            },
                            {
                                fc: 'FC16',
                                address: ADDR_REMOTE_DISCHARGE_LIMIT,
                                payload: encodeFloat32le(computedLimit),
                            },
                        ]);
                    },
                ),
                RUNS,
            );
        });
    });

    // -----------------------------------------------------------------------
    // Feature: storedge-battery-control, Property 8: Discharge limit is written
    // only when it changes.
    // Validates: Requirements 8.1, 8.2, 8.3
    //
    // A model threads the returned lastWritten across a sequence of heartbeat
    // calls. 0xE010 (via FC16 writeMultipleRegisters) is written EXACTLY on the
    // steps where the computed limit differs from the previous written value,
    // never when unchanged; each write encodes the limit as encodeFloat32le; and
    // the returned lastWritten equals the value actually written (or is left
    // unchanged when the step was skipped). commandTimeout is threaded through.
    // -----------------------------------------------------------------------
    describe('Feature: storedge-battery-control, Property 8: Discharge limit is written only when it changes', () => {
        it('Feature: storedge-battery-control, Property 8: 0xE010 is refreshed exactly on changed steps and lastWritten tracks each write', async () => {
            // A sequence of computed limits. Draw from a small pool of finite
            // watt values so repeats (unchanged steps) occur frequently.
            const limitArb = fc.constantFrom(0, 1, 250, 1000, 2500, 5000, 4999.5, 3333.25);
            const seqArb = fc.array(limitArb, { minLength: 1, maxLength: 20 });
            const timeoutArb = fc.integer({ min: 1, max: 86400 });

            await fc.assert(
                fc.asyncProperty(seqArb, timeoutArb, async (limits, commandTimeout) => {
                    const client = new RecordingClient();
                    const writer = new ModbusControlWriter(client);

                    // Reference model: which steps SHOULD write 0xE010, and the
                    // expected lastWritten thread.
                    let modelLast: number | undefined = undefined;
                    const expectedWrites: number[] = []; // limits that should be written, in order

                    let lastWritten: number | undefined = undefined;
                    for (const limit of limits) {
                        const before = writesTo(client, ADDR_REMOTE_DISCHARGE_LIMIT).length;
                        const returned = await writer.heartbeat(limit, lastWritten, commandTimeout);
                        const after = writesTo(client, ADDR_REMOTE_DISCHARGE_LIMIT).length;

                        if (limit !== modelLast) {
                            // Changed step: exactly one 0xE010 write, returns the new limit.
                            expect(after - before, 'changed step must write 0xE010 exactly once').to.equal(1);
                            expect(returned, 'changed step must return the new limit').to.equal(limit);
                            expectedWrites.push(limit);
                            modelLast = limit;
                        } else {
                            // Unchanged step: no 0xE010 write, lastWritten unchanged.
                            expect(after - before, 'unchanged step must not write 0xE010').to.equal(0);
                            expect(returned, 'unchanged step must return the prior lastWritten').to.equal(lastWritten);
                        }

                        lastWritten = returned;
                    }

                    // Every recorded 0xE010 write, in order, encodes the expected
                    // limit via encodeFloat32le (FC16 word array).
                    const dischargeWrites = writesTo(client, ADDR_REMOTE_DISCHARGE_LIMIT);
                    expect(dischargeWrites.length, 'number of 0xE010 writes').to.equal(expectedWrites.length);
                    dischargeWrites.forEach((w, i) => {
                        expect(w.fc, '0xE010 must be written via FC16').to.equal('FC16');
                        expect(w.payload, '0xE010 payload must be encodeFloat32le(limit)').to.deep.equal(
                            encodeFloat32le(expectedWrites[i]),
                        );
                    });
                }),
                RUNS,
            );
        });
    });

    // -----------------------------------------------------------------------
    // Feature: storedge-battery-control, Property 10: Heartbeat renews the timeout
    // and command mode but never the initial-config registers.
    // Validates: Requirements 10.1, 10.2, 11.1, 11.2, 11.3, 11.4, 12.5
    //
    // Over N heartbeat cycles: EXACTLY N FC16 writes of 0xE00B=encodeUint32le(
    // commandTimeout) and N FC06 writes of 0xE00D=4 (both unconditional); 0xE010
    // only on the cycles where the limit changed; and ZERO writes to 0xE000,
    // 0xE004, and 0xE00A.
    // -----------------------------------------------------------------------
    describe('Feature: storedge-battery-control, Property 10: Heartbeat renews the timeout and command mode but never the initial-config registers', () => {
        it('Feature: storedge-battery-control, Property 10: N cycles renew 0xE00B and 0xE00D=4, refresh 0xE010 only on change, never touch 0xE000/0xE004/0xE00A', async () => {
            const limitArb = fc.constantFrom(0, 1, 500, 1500, 5000, 2500.5);
            const seqArb = fc.array(limitArb, { minLength: 1, maxLength: 25 });
            const timeoutArb = fc.integer({ min: 1, max: 86400 });

            await fc.assert(
                fc.asyncProperty(seqArb, timeoutArb, async (limits, commandTimeout) => {
                    const client = new RecordingClient();
                    const writer = new ModbusControlWriter(client);

                    // Count the model's expected changed cycles.
                    let modelLast: number | undefined = undefined;
                    let expectedDischargeWrites = 0;

                    let lastWritten: number | undefined = undefined;
                    for (const limit of limits) {
                        lastWritten = await writer.heartbeat(limit, lastWritten, commandTimeout);
                        if (limit !== modelLast) {
                            expectedDischargeWrites++;
                            modelLast = limit;
                        }
                    }

                    const n = limits.length;

                    // 0xE00B is renewed exactly once per cycle via FC16, encoded uint32le.
                    const timeoutWrites = writesTo(client, ADDR_REMOTE_COMMAND_TIMEOUT);
                    expect(timeoutWrites.length, 'exactly N renewals of 0xE00B').to.equal(n);
                    for (const w of timeoutWrites) {
                        expect(w.fc, '0xE00B must be FC16').to.equal('FC16');
                        expect(w.payload, '0xE00B must be encodeUint32le(commandTimeout)').to.deep.equal(
                            encodeUint32le(commandTimeout),
                        );
                    }

                    // 0xE00D=4 is re-asserted exactly once per cycle via FC06.
                    const commandModeWrites = writesTo(client, ADDR_REMOTE_COMMAND_MODE);
                    expect(commandModeWrites.length, 'exactly N writes of 0xE00D').to.equal(n);
                    for (const w of commandModeWrites) {
                        expect(w.fc, '0xE00D must be FC06').to.equal('FC06');
                        expect(w.payload, '0xE00D must be re-asserted to 4').to.equal(REMOTE_CONTROL_MODE);
                    }

                    // 0xE010 is written only on the cycles where the limit changed.
                    const dischargeWrites = writesTo(client, ADDR_REMOTE_DISCHARGE_LIMIT);
                    expect(dischargeWrites.length, '0xE010 written only on changed cycles').to.equal(
                        expectedDischargeWrites,
                    );

                    // The initial-config-only registers are NEVER written by heartbeat.
                    expect(
                        writesTo(client, ADDR_EXPORT_CONFIG).length,
                        '0xE000 (export config) must never be written by heartbeat',
                    ).to.equal(0);
                    expect(
                        writesTo(client, ADDR_STORAGE_CONTROL_MODE).length,
                        '0xE004 (storage control mode) must never be written by heartbeat',
                    ).to.equal(0);
                    expect(
                        writesTo(client, ADDR_STORAGE_DEFAULT_MODE).length,
                        '0xE00A (storage default mode) must never be written by heartbeat',
                    ).to.equal(0);
                }),
                RUNS,
            );
        });
    });

    // -----------------------------------------------------------------------
    // Feature: storedge-battery-control, Property 11: Heartbeat write failures are
    // non-fatal.
    // Validates: Requirements 11.6, 14.2
    //
    // When a control write during a heartbeat cycle throws a Modbus exception, the
    // writer propagates it as a rejected promise (the caller/pollOnce routes it
    // through the existing cycle-failure path rather than swallowing it). Once a
    // write in the cycle fails, no further writes in that cycle are issued.
    // -----------------------------------------------------------------------
    describe('Feature: storedge-battery-control, Property 11: Heartbeat write failures are non-fatal', () => {
        it('Feature: storedge-battery-control, Property 11: heartbeat rejects when a write fails and issues no writes after the failing one', async () => {
            const limitArb = fc.double({ min: 0, max: 100000, noNaN: true, noDefaultInfinity: true });
            const timeoutArb = fc.integer({ min: 1, max: 86400 });
            // A heartbeat that writes a changed limit issues up to three writes:
            // 0xE00B (call 1), 0xE00D (call 2), 0xE010 (call 3). Fail one of them.
            const failAtArb = fc.integer({ min: 1, max: 3 });

            await fc.assert(
                fc.asyncProperty(limitArb, timeoutArb, failAtArb, async (limit, commandTimeout, failAt) => {
                    const client = new RecordingClient(failAt);
                    const writer = new ModbusControlWriter(client);

                    // lastWritten undefined so the limit is treated as changed and
                    // heartbeat attempts the 0xE010 write too (the third call).
                    let rejected = false;
                    try {
                        await writer.heartbeat(limit, undefined, commandTimeout);
                    } catch {
                        rejected = true;
                    }

                    expect(rejected, 'heartbeat must reject (propagate) when a write fails').to.equal(true);

                    // The failing write short-circuits the cycle: exactly failAt-1
                    // writes were recorded (the ones before the failure), and none
                    // after.
                    expect(client.writes.length, 'no writes are issued after the failing write in the cycle').to.equal(
                        failAt - 1,
                    );
                }),
                RUNS,
            );
        });
    });

    // -----------------------------------------------------------------------
    // Example tests: the exact call order of applyEnable and applyRevert.
    // Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 12.1
    // -----------------------------------------------------------------------
    describe('control-writer lifecycle (examples)', () => {
        it('applyEnable issues, in order, the six documented initial-config writes', async () => {
            const client = new RecordingClient();
            const writer = new ModbusControlWriter(client);
            const limit = 5000;
            const defaultFallbackMode = 1;
            const commandTimeout = 120;

            await writer.applyEnable(limit, { defaultFallbackMode, commandTimeout });

            expect(client.writes).to.deep.equal([
                { fc: 'FC06', address: ADDR_EXPORT_CONFIG, payload: 0 },
                { fc: 'FC06', address: ADDR_STORAGE_CONTROL_MODE, payload: REMOTE_CONTROL_MODE },
                { fc: 'FC06', address: ADDR_STORAGE_DEFAULT_MODE, payload: defaultFallbackMode },
                { fc: 'FC06', address: ADDR_REMOTE_COMMAND_MODE, payload: REMOTE_CONTROL_MODE },
                { fc: 'FC16', address: ADDR_REMOTE_COMMAND_TIMEOUT, payload: encodeUint32le(commandTimeout) },
                { fc: 'FC16', address: ADDR_REMOTE_DISCHARGE_LIMIT, payload: encodeFloat32le(limit) },
            ]);
        });

        it('applyRevert issues a single FC06 write of 0xE004=mode', async () => {
            const client = new RecordingClient();
            const writer = new ModbusControlWriter(client);
            const mode = 1;

            await writer.applyRevert(mode);

            expect(client.writes).to.deep.equal([{ fc: 'FC06', address: ADDR_STORAGE_CONTROL_MODE, payload: mode }]);
        });
    });
});
