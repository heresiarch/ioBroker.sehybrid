import { expect } from 'chai';
import fc from 'fast-check';
import { CONTROL_REGISTERS, REMOTE_CONTROL_COMMAND_TIMEOUT, STORAGE_DEFAULT_MODE } from './control-registers';
import { ModbusControlWriter } from './control-writer';
import type { IModbusClient, ModbusReadOptions, ModbusWriteOptions } from './modbus-client';
import { encodeFloat32le } from './sunspec-decode';

// ---------------------------------------------------------------------------
// Task 5.2 — Property tests for the control-writer dispatch layer.
//
// The three properties below exercise ModbusControlWriter against a recording
// IModbusClient double. Every writeSingleRegister(address, value) (FC06) and
// writeMultipleRegisters(address, words) (FC16) call is captured so a property
// can assert EXACTLY which register was written, with which encoding, and how
// many times. Reads are no-ops — the control writer never issues reads.
// ---------------------------------------------------------------------------

/** StorEdge control-register addresses referenced by the properties. */
const ADDR_STORAGE_CONTROL_MODE = 0xe004; // 0xE004 — re-asserted every active cycle
const ADDR_STORAGE_DEFAULT_MODE = 0xe00a; // 0xE00A — never written (read-only)
const ADDR_REMOTE_COMMAND_TIMEOUT = 0xe00b; // 0xE00B — never written (read-only)
const ADDR_REMOTE_COMMAND_MODE = 0xe00d; // 0xE00D — re-asserted every active cycle
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
 */
class RecordingClient implements IModbusClient {
    readonly writes: RecordedWrite[] = [];

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
        this.writes.push({ fc: 'FC06', address, payload: value });
        return Promise.resolve();
    }

    writeMultipleRegisters(address: number, values: number[], _opts?: ModbusWriteOptions): Promise<void> {
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
    // Feature: storedge-battery-control, Property 7: Discharge limit is written
    // only when it changes.
    // Validates: Requirements 8.1, 8.2, 8.3, 11.3
    //
    // A model threads the returned lastWritten across a sequence of heartbeat
    // calls. 0xE010 (via FC16 writeMultipleRegisters) is written EXACTLY on the
    // steps where the computed limit differs from the previous written value,
    // never when unchanged; each write encodes the limit as encodeFloat32le; and
    // the returned lastWritten equals the value actually written (or is left
    // unchanged when the step was skipped).
    // -----------------------------------------------------------------------
    describe('Feature: storedge-battery-control, Property 7: Discharge limit is written only when it changes', () => {
        it('Feature: storedge-battery-control, Property 7: 0xE010 is refreshed exactly on changed steps and lastWritten tracks each write', async () => {
            // A sequence of computed limits. Draw from a small pool of finite
            // watt values so repeats (unchanged steps) occur frequently.
            const limitArb = fc.constantFrom(0, 1, 250, 1000, 2500, 5000, 4999.5, 3333.25);
            const seqArb = fc.array(limitArb, { minLength: 1, maxLength: 20 });

            await fc.assert(
                fc.asyncProperty(seqArb, async limits => {
                    const client = new RecordingClient();
                    const writer = new ModbusControlWriter(client);

                    // Reference model: which steps SHOULD write 0xE010, and the
                    // expected lastWritten thread.
                    let modelLast: number | undefined = undefined;
                    const expectedWrites: number[] = []; // limits that should be written, in order

                    let lastWritten: number | undefined = undefined;
                    for (const limit of limits) {
                        const before = writesTo(client, ADDR_REMOTE_DISCHARGE_LIMIT).length;
                        const returned = await writer.heartbeat(limit, lastWritten);
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
    // Feature: storedge-battery-control, Property 8: Command modes are
    // re-asserted every active cycle.
    // Validates: Requirements 11.1, 11.2, 11.3
    //
    // Over N heartbeat calls, EXACTLY N FC06 writes of 0xE004=4 and N of
    // 0xE00D=4 occur regardless of whether the limit changed; 0xE010 is written
    // only on the cycles where the limit changed.
    // -----------------------------------------------------------------------
    describe('Feature: storedge-battery-control, Property 8: Command modes are re-asserted every active cycle', () => {
        it('Feature: storedge-battery-control, Property 8: N cycles issue N writes of 0xE004=4 and 0xE00D=4, 0xE010 only when changed', async () => {
            const limitArb = fc.constantFrom(0, 1, 500, 1500, 5000, 2500.5);
            const seqArb = fc.array(limitArb, { minLength: 1, maxLength: 25 });

            await fc.assert(
                fc.asyncProperty(seqArb, async limits => {
                    const client = new RecordingClient();
                    const writer = new ModbusControlWriter(client);

                    // Count the model's expected changed cycles.
                    let modelLast: number | undefined = undefined;
                    let expectedDischargeWrites = 0;

                    let lastWritten: number | undefined = undefined;
                    for (const limit of limits) {
                        lastWritten = await writer.heartbeat(limit, lastWritten);
                        if (limit !== modelLast) {
                            expectedDischargeWrites++;
                            modelLast = limit;
                        }
                    }

                    const n = limits.length;

                    // 0xE004=4 is re-asserted exactly once per cycle via FC06.
                    const controlModeWrites = writesTo(client, ADDR_STORAGE_CONTROL_MODE);
                    expect(controlModeWrites.length, 'exactly N writes of 0xE004').to.equal(n);
                    for (const w of controlModeWrites) {
                        expect(w.fc, '0xE004 must be FC06').to.equal('FC06');
                        expect(w.payload, '0xE004 must be re-asserted to 4').to.equal(REMOTE_CONTROL_MODE);
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
                }),
                RUNS,
            );
        });
    });

    // -----------------------------------------------------------------------
    // Feature: storedge-battery-control, Property 9: The timeout and
    // default-mode registers are never written.
    // Validates: Requirements 10.1, 10.2, 12.4
    //
    // Over any sequence of write()/applyEnable()/applyRevert()/heartbeat() calls
    // with arbitrary values, no write ever targets 0xE00B (remote-control command
    // timeout) or 0xE00A (storage default mode). Additionally, write() on those
    // two read-only defs is refused (rejects/throws).
    // -----------------------------------------------------------------------
    describe('Feature: storedge-battery-control, Property 9: The timeout and default-mode registers are never written', () => {
        it('Feature: storedge-battery-control, Property 9: no op sequence ever writes 0xE00A or 0xE00B', async () => {
            // The writable defs the property may drive write() with.
            const writableDefs = CONTROL_REGISTERS.filter(d => !d.readOnly && d.fc);

            type Op =
                | { kind: 'write'; defIndex: number; value: number }
                | { kind: 'applyEnable'; limit: number }
                | { kind: 'applyRevert'; mode: number }
                | { kind: 'heartbeat'; limit: number };

            const valueArb = fc.double({ min: 0, max: 100000, noNaN: true, noDefaultInfinity: true });

            const opArb: fc.Arbitrary<Op> = fc.oneof(
                fc.record({
                    kind: fc.constant<'write'>('write'),
                    defIndex: fc.integer({ min: 0, max: writableDefs.length - 1 }),
                    value: valueArb,
                }),
                fc.record({ kind: fc.constant<'applyEnable'>('applyEnable'), limit: valueArb }),
                fc.record({ kind: fc.constant<'applyRevert'>('applyRevert'), mode: fc.integer({ min: 0, max: 4 }) }),
                fc.record({ kind: fc.constant<'heartbeat'>('heartbeat'), limit: valueArb }),
            );

            await fc.assert(
                fc.asyncProperty(fc.array(opArb, { minLength: 1, maxLength: 20 }), async ops => {
                    const client = new RecordingClient();
                    const writer = new ModbusControlWriter(client);

                    let lastWritten: number | undefined = undefined;
                    for (const op of ops) {
                        switch (op.kind) {
                            case 'write':
                                await writer.write(writableDefs[op.defIndex], op.value);
                                break;
                            case 'applyEnable':
                                await writer.applyEnable(op.limit);
                                break;
                            case 'applyRevert':
                                await writer.applyRevert(op.mode);
                                break;
                            case 'heartbeat':
                                lastWritten = await writer.heartbeat(op.limit, lastWritten);
                                break;
                        }
                    }

                    // No write ever targets the never-written registers.
                    expect(
                        writesTo(client, ADDR_STORAGE_DEFAULT_MODE).length,
                        '0xE00A (storage default mode) must never be written',
                    ).to.equal(0);
                    expect(
                        writesTo(client, ADDR_REMOTE_COMMAND_TIMEOUT).length,
                        '0xE00B (remote-control command timeout) must never be written',
                    ).to.equal(0);
                }),
                RUNS,
            );
        });

        it('Feature: storedge-battery-control, Property 9: write(STORAGE_DEFAULT_MODE) and write(REMOTE_CONTROL_COMMAND_TIMEOUT) are refused', async () => {
            const valueArb = fc.double({ min: 0, max: 86400, noNaN: true, noDefaultInfinity: true });

            await fc.assert(
                fc.asyncProperty(valueArb, valueArb, async (defaultModeValue, timeoutValue) => {
                    const client = new RecordingClient();
                    const writer = new ModbusControlWriter(client);

                    // write(STORAGE_DEFAULT_MODE, x) — read-only, must reject.
                    let defaultModeRejected = false;
                    try {
                        await writer.write(STORAGE_DEFAULT_MODE, defaultModeValue);
                    } catch {
                        defaultModeRejected = true;
                    }
                    expect(defaultModeRejected, 'write(STORAGE_DEFAULT_MODE) must be refused').to.equal(true);

                    // write(REMOTE_CONTROL_COMMAND_TIMEOUT, x) — read-only, must reject.
                    let timeoutRejected = false;
                    try {
                        await writer.write(REMOTE_CONTROL_COMMAND_TIMEOUT, timeoutValue);
                    } catch {
                        timeoutRejected = true;
                    }
                    expect(timeoutRejected, 'write(REMOTE_CONTROL_COMMAND_TIMEOUT) must be refused').to.equal(true);

                    // The refusals emit no Modbus write of any kind.
                    expect(client.writes.length, 'refused writes must issue no Modbus call').to.equal(0);
                }),
                RUNS,
            );
        });
    });

    // -----------------------------------------------------------------------
    // Example tests: the exact call order of applyEnable and applyRevert.
    // Validates: Requirements 8.1, 9.1, 9.2, 9.3, 12.1
    // -----------------------------------------------------------------------
    describe('control-writer lifecycle (examples)', () => {
        it('applyEnable issues, in order, FC06 0xE004=4, FC06 0xE00D=4, FC16 0xE010=encodeFloat32le(limit)', async () => {
            const client = new RecordingClient();
            const writer = new ModbusControlWriter(client);
            const limit = 5000;

            await writer.applyEnable(limit);

            expect(client.writes).to.deep.equal([
                { fc: 'FC06', address: ADDR_STORAGE_CONTROL_MODE, payload: REMOTE_CONTROL_MODE },
                { fc: 'FC06', address: ADDR_REMOTE_COMMAND_MODE, payload: REMOTE_CONTROL_MODE },
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
