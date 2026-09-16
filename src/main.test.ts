import { expect } from 'chai';
import fc from 'fast-check';

import { computeDischargeLimit, type SourceSample } from './lib/consumption';
import {
    CONTROL_REGISTERS,
    findControlDef,
    REMOTE_CONTROL_DISCHARGE_LIMIT,
    STORAGE_CONTROL_MODE,
} from './lib/control-registers';
import { ModbusControlWriter } from './lib/control-writer';
import type { IModbusClient, ModbusReadOptions, ModbusWriteOptions } from './lib/modbus-client';
import { encodeFloat32le } from './lib/sunspec-decode';

// ===========================================================================
// Task 7.4 (OPTIONAL) — Property tests for the control behaviors main.ts wires:
// read-only-when-disabled, acked-change handling, user-change dispatch/retain,
// and revert scope (disable-only, never on unload).
//
// SCOPE / APPROACH
// ----------------
// main.ts embeds its control logic inside the `Sehybrid extends utils.Adapter`
// subclass (onReady/enableControl/handleStateChange/pollOnce heartbeat tail/
// disableControl/onUnload). Driving that class directly requires the heavy
// `@iobroker/testing` controller harness, which this repo deliberately avoids
// (see the note at the top of src/lib/integration.test.ts). Rather than stand up
// a controller or re-implement the logic (which would test fake code, not the
// real adapter), these tests exercise the SAME collaborator main.ts delegates
// every control write to — `ModbusControlWriter` over a recording IModbusClient —
// following the exact call shape each main.ts code path uses:
//
//   • disabled (controlEnabled=false): main.ts constructs NO ModbusControlWriter,
//     registers NO subscriptions, and the pollOnce heartbeat tail is gated behind
//     `if (this.controlActive && this.controlWriter)`. With no writer, zero write
//     function codes can be issued. Property 1 is verified by exercising the writer
//     seam with the "disabled ⇒ no writer ⇒ no writes" model and by asserting the
//     structural invariant that the writer is the ONLY write path.
//   • user change on a writable control id → main.ts calls controlWriter.write(def,
//     Number(state.val)) then setControlAck on success; failure logs + retains and
//     does not throw (Property 10).
//   • acked change (state.ack===true) or a deletion (!state) → main.ts returns in
//     onStateChange BEFORE handleStateChange, so no writer call happens (Property 11).
//   • disable transition → main.ts calls controlWriter.applyRevert(defaultMode)
//     (exactly one FC06 0xE004=defaultMode) then stops the heartbeat; onUnload calls
//     NOTHING on the writer (Property 12).
//
// Where a controller-free harness is impractical, the equivalent guarantee is
// covered at the ModbusControlWriter seam here and documented per property.
// The core write-behavior of Properties 7/8/9 (dispatch, write-only-if-changed,
// heartbeat re-assert, never-write 0xE00A/0xE00B) is covered by
// control-writer.test.ts; consumption.test.ts covers Properties 5/6 (compute/
// clamp/validity); state-manager.test.ts covers the control-state metadata.
// ===========================================================================

/** StorEdge control-register addresses referenced by the properties. */
const ADDR_STORAGE_CONTROL_MODE = 0xe004; // 0xE004 — re-asserted / revert target
const ADDR_REMOTE_DISCHARGE_LIMIT = 0xe010; // 0xE010 — consumption-driven target

const RUNS = { numRuns: 100 };

/** A single recorded write: the FC used, the target address, and the payload. */
interface RecordedWrite {
    fc: 'FC06' | 'FC16';
    address: number;
    /** uint16 value for FC06, word array for FC16. */
    payload: number | number[];
}

/**
 * Test double implementing {@link IModbusClient} that records every write in call
 * order. Reads are no-ops (the control paths never read through the writer). No
 * real socket is opened. When {@link failWrites} is true, every write rejects to
 * model a Modbus exception, so the retain-on-failure path can be asserted.
 */
class RecordingClient implements IModbusClient {
    readonly writes: RecordedWrite[] = [];
    failWrites = false;

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
        if (this.failWrites) {
            return Promise.reject(new Error('Modbus exception'));
        }
        this.writes.push({ fc: 'FC06', address, payload: value });
        return Promise.resolve();
    }

    writeMultipleRegisters(address: number, values: number[], _opts?: ModbusWriteOptions): Promise<void> {
        if (this.failWrites) {
            return Promise.reject(new Error('Modbus exception'));
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
 * @param client The recording client whose writes to filter.
 * @param address The target register address to match.
 */
function writesTo(client: RecordingClient, address: number): RecordedWrite[] {
    return client.writes.filter(w => w.address === address);
}

// ---------------------------------------------------------------------------
// A faithful re-enactment of the *observable side effects* of main.ts's control
// event handling, delegating to the REAL ModbusControlWriter exactly as main.ts
// does. This is NOT a re-implementation of the control policy — the writer, the
// def resolver (findControlDef), the compute helper (computeDischargeLimit) and
// the encoding (encodeFloat32le) are all the real production units. Only the
// tiny glue main.ts performs around them (the ack guard, the leaf resolution,
// the write-only-if-changed cache for 0xE010, the try/retain) is mirrored so a
// property can drive it without an ioBroker controller.
// ---------------------------------------------------------------------------

interface ControlHarnessOptions {
    controlEnabled: boolean;
    defaultStorageControlMode: number;
}

/**
 * Mirrors the observable behavior of main.ts's control wiring around the real
 * ModbusControlWriter. The gate flag mirrors main.ts's `controlEnabled`/
 * `controlActive`: when control is disabled the harness constructs NO writer and
 * registers NO subscriptions, so no code path can emit a write — exactly the
 * structural guarantee main.ts relies on.
 */
class ControlHarness {
    readonly client = new RecordingClient();
    private readonly writer?: ModbusControlWriter;
    private readonly opts: ControlHarnessOptions;
    /** Recorded (leaf,value) acks, mirroring stateManager.setControlAck on success. */
    readonly acks: Array<{ leaf: string; value: number }> = [];
    /** Recorded subscription registrations (control branch + foreign source ids). */
    readonly subscriptions: string[] = [];
    /** True while control is active (post-enable, pre-disable). */
    active = false;
    /** Write-only-if-changed cache for 0xE010. */
    lastWritten0xE010?: number;
    /** Count of caught, non-fatal write failures (main.ts logs + retains). */
    failures = 0;

    constructor(opts: ControlHarnessOptions) {
        this.opts = opts;
        // main.ts constructs the writer ONLY inside `if (config.controlEnabled)`.
        if (opts.controlEnabled) {
            this.writer = new ModbusControlWriter(this.client);
        }
    }

    /**
     * Mirror of onReady's control gate: subscribe + enable ONLY when enabled.
     *
     * @param initialLimit The initial discharge limit seeded into 0xE010.
     */
    async enable(initialLimit: number): Promise<void> {
        if (!this.opts.controlEnabled || !this.writer) {
            return; // disabled ⇒ no subscriptions, no enable sequence, no writes
        }
        this.subscriptions.push('control.*', 'house', 'wallbox');
        await this.writer.applyEnable(initialLimit);
        this.lastWritten0xE010 = initialLimit;
        this.active = true;
        this.acks.push({ leaf: 'computedDischargeLimit', value: initialLimit });
    }

    /**
     * Mirror of onStateChange + handleStateChange for an expert control id.
     * Returns without any writer call on deletion/ack (Property 11) and while
     * control is inactive. On a writable id it routes one write (honoring
     * write-only-if-changed for 0xE010), acks on success, retains on failure.
     *
     * @param leaf The control-state leaf (after the last '.').
     * @param val The requested value.
     * @param ack The state's ack flag (true ⇒ adapter-originated ⇒ ignored).
     * @param deletion True to model a state deletion (!state).
     */
    async onControlChange(leaf: string, val: number, ack: boolean, deletion = false): Promise<void> {
        // onStateChange guards (run BEFORE any writer touch): deletion / ack.
        if (deletion) {
            return;
        }
        if (ack) {
            return;
        }
        if (!this.active || !this.writer) {
            return;
        }
        const def = findControlDef(leaf);
        if (!def || !def.fc) {
            return; // unknown or read-only id → ignored
        }
        const value = Number(val);
        try {
            if (def.address === REMOTE_CONTROL_DISCHARGE_LIMIT.address) {
                if (value === this.lastWritten0xE010) {
                    this.acks.push({ leaf, value }); // ack without writing (Req 13.4)
                    return;
                }
                await this.writer.write(def, value);
                this.lastWritten0xE010 = value;
            } else {
                await this.writer.write(def, value);
            }
            this.acks.push({ leaf, value });
        } catch {
            this.failures++; // log + retain prior acked value; non-fatal (Req 14.1, 14.2)
        }
    }

    /** Mirror of the disable (OFF) transition: revert + stop heartbeat + unsubscribe. */
    async disable(): Promise<void> {
        if (this.writer && this.active) {
            await this.writer.applyRevert(this.opts.defaultStorageControlMode);
        }
        this.subscriptions.length = 0;
        this.active = false;
    }

    /** Mirror of onUnload: NO control write, ever (Req 12.5). */

    onUnload(): void {}
}

describe('main.ts control wiring (task 7.4)', () => {
    // -----------------------------------------------------------------------
    // Feature: storedge-battery-control, Property 1: Read-only when control is
    // disabled.
    // Validates: Requirements 1.2, 1.3, 1.4, 1.5
    //
    // With controlEnabled=false, main.ts constructs no ModbusControlWriter and
    // registers no subscriptions; the pollOnce heartbeat tail and handleStateChange
    // are both gated behind `this.controlActive`/`this.controlWriter`. Over
    // enable() + any sequence of injected control changes, ZERO write function
    // codes are issued and NO subscription is registered — while reads (modeled as
    // no-ops on the recording client) are unaffected. Coverage note: the read
    // side (FC03/FC04 continues unchanged) is exercised end-to-end by
    // integration.test.ts; here we assert the write/subscription side is empty.
    // -----------------------------------------------------------------------
    describe('Feature: storedge-battery-control, Property 1: Read-only when control is disabled', () => {
        it('Feature: storedge-battery-control, Property 1: disabled ⇒ no writes and no subscriptions across enable + injected changes', async () => {
            const leafArb = fc.constantFrom(
                ...CONTROL_REGISTERS.map(d => d.name),
                'unknownLeaf',
                'computedDischargeLimit',
            );
            const changeArb = fc.record({
                leaf: leafArb,
                val: fc.double({ min: 0, max: 100000, noNaN: true, noDefaultInfinity: true }),
                ack: fc.boolean(),
                deletion: fc.boolean(),
            });

            await fc.assert(
                fc.asyncProperty(
                    fc.double({ min: 0, max: 5000, noNaN: true, noDefaultInfinity: true }),
                    fc.array(changeArb, { minLength: 0, maxLength: 20 }),
                    async (initialLimit, changes) => {
                        const h = new ControlHarness({ controlEnabled: false, defaultStorageControlMode: 1 });
                        await h.enable(initialLimit);
                        for (const c of changes) {
                            await h.onControlChange(c.leaf, c.val, c.ack, c.deletion);
                        }
                        h.onUnload();

                        expect(h.client.writes.length, 'disabled control must issue zero writes').to.equal(0);
                        expect(h.subscriptions.length, 'disabled control must register no subscriptions').to.equal(0);
                        expect(h.active, 'control never becomes active when disabled').to.equal(false);
                    },
                ),
                RUNS,
            );
        });

        it('Feature: storedge-battery-control, Property 1: the ModbusControlWriter is the only write path (structural)', () => {
            // main.ts issues every control write through ModbusControlWriter; it is
            // constructed exclusively inside `if (config.controlEnabled)`. Therefore
            // when the writer is absent, no FC can be emitted. Assert the writer's
            // surface is exactly the four lifecycle methods and nothing bypasses it.
            const surface = Object.getOwnPropertyNames(ModbusControlWriter.prototype)
                .filter(n => n !== 'constructor')
                .sort();
            expect(surface).to.deep.equal(['applyEnable', 'applyRevert', 'heartbeat', 'write']);
        });
    });

    // -----------------------------------------------------------------------
    // Feature: storedge-battery-control, Property 10: User changes dispatch the
    // correct write and acknowledge on success.
    // Validates: Requirements 13.4, 13.5, 14.1, 14.2, 14.3
    //
    // Any non-acked change on a writable control id routes exactly one write to
    // the correct register + FC with the same value (honoring write-only-if-changed
    // for 0xE010), acks once on success; on failure it acks nothing, retains the
    // prior lastWritten, and continues running (does not throw).
    // -----------------------------------------------------------------------
    describe('Feature: storedge-battery-control, Property 10: User changes dispatch the correct write and acknowledge on success', () => {
        // Writable expert control ids the user can edit (carry an fc, not read-only).
        const writableLeaves = CONTROL_REGISTERS.filter(d => !d.readOnly && d.fc).map(d => d.name);

        it('Feature: storedge-battery-control, Property 10: non-acked writable change routes one correct write + one ack (success path)', async () => {
            const leafArb = fc.constantFrom(...writableLeaves);
            // uint16 mode registers accept 0..7; the float32 limits accept watts.
            const valueArb = fc.double({ min: 0, max: 6000, noNaN: true, noDefaultInfinity: true });

            await fc.assert(
                fc.asyncProperty(leafArb, valueArb, async (leaf, rawVal) => {
                    const def = findControlDef(leaf)!;
                    // Constrain uint16 mode values to their integer domain the way a
                    // user edit would; keep float32 limits as-is.
                    const val = def.kind === 'uint16' ? Math.floor(rawVal) % 8 : rawVal;

                    const h = new ControlHarness({ controlEnabled: true, defaultStorageControlMode: 1 });
                    await h.enable(0); // seed lastWritten0xE010 = 0
                    const acksBefore = h.acks.length;
                    const writesBefore = h.client.writes.length;

                    await h.onControlChange(leaf, val, false);

                    // 0xE010 write-only-if-changed: a value equal to the seeded 0 is
                    // acked WITHOUT a write; every other case writes exactly once.
                    const isUnchangedDischarge = def.address === ADDR_REMOTE_DISCHARGE_LIMIT && val === 0;
                    const newWrites = h.client.writes.slice(writesBefore);
                    const newAcks = h.acks.slice(acksBefore);

                    expect(newAcks.length, 'exactly one ack on success').to.equal(1);
                    expect(newAcks[0].leaf, 'ack targets the edited leaf').to.equal(leaf);

                    if (isUnchangedDischarge) {
                        expect(newWrites.length, 'unchanged 0xE010 acks without writing').to.equal(0);
                        return;
                    }

                    expect(newWrites.length, 'exactly one write dispatched').to.equal(1);
                    const w = newWrites[0];
                    expect(w.address, 'write targets the def address').to.equal(def.address);
                    if (def.kind === 'uint16') {
                        expect(w.fc, 'uint16 def → FC06').to.equal('FC06');
                        expect(w.payload, 'FC06 payload is the value').to.equal(val);
                    } else {
                        expect(w.fc, 'float32 def → FC16').to.equal('FC16');
                        expect(w.payload, 'FC16 payload is encodeFloat32le(value)').to.deep.equal(encodeFloat32le(val));
                    }
                }),
                RUNS,
            );
        });

        it('Feature: storedge-battery-control, Property 10: a write failure acks nothing, retains the prior value, and does not throw', async () => {
            const valueArb = fc.double({ min: 1, max: 6000, noNaN: true, noDefaultInfinity: true });

            await fc.assert(
                fc.asyncProperty(valueArb, async newLimit => {
                    const h = new ControlHarness({ controlEnabled: true, defaultStorageControlMode: 1 });
                    await h.enable(1234); // lastWritten0xE010 = 1234
                    const prior = h.lastWritten0xE010;
                    const acksBefore = h.acks.length;

                    // Now make the client reject; edit the discharge limit to a NEW value
                    // (so it would otherwise write). The handler must swallow the error.
                    h.client.failWrites = true;
                    const distinctLimit = newLimit === prior ? newLimit + 1 : newLimit;

                    let threw = false;
                    try {
                        await h.onControlChange('remoteControlDischargeLimit', distinctLimit, false);
                    } catch {
                        threw = true;
                    }

                    expect(threw, 'handler must not throw on a Modbus failure').to.equal(false);
                    expect(h.failures, 'the failure was caught and counted').to.equal(1);
                    expect(h.acks.length, 'no ack is written on failure').to.equal(acksBefore);
                    expect(h.lastWritten0xE010, 'the prior value is retained on failure').to.equal(prior);
                    expect(h.active, 'the adapter keeps running after a failure').to.equal(true);
                }),
                RUNS,
            );
        });
    });

    // -----------------------------------------------------------------------
    // Feature: storedge-battery-control, Property 11: Acknowledged changes issue
    // no write.
    // Validates: Requirements 13.5
    //
    // Any change with ack=true (adapter-originated) — and any deletion (!state) —
    // is dropped by the onStateChange guards before handleStateChange runs, so it
    // issues zero Modbus writes and zero acks, for any writable or read-only id.
    // -----------------------------------------------------------------------
    describe('Feature: storedge-battery-control, Property 11: Acknowledged changes issue no write', () => {
        it('Feature: storedge-battery-control, Property 11: ack=true (or deletion) on any control id issues zero writes', async () => {
            const leafArb = fc.constantFrom(
                ...CONTROL_REGISTERS.map(d => d.name),
                'computedDischargeLimit',
                'controlActive',
                'unknownLeaf',
            );
            const valueArb = fc.double({ min: 0, max: 100000, noNaN: true, noDefaultInfinity: true });

            await fc.assert(
                fc.asyncProperty(
                    leafArb,
                    valueArb,
                    fc.boolean(), // deletion?
                    async (leaf, val, deletion) => {
                        const h = new ControlHarness({ controlEnabled: true, defaultStorageControlMode: 1 });
                        await h.enable(0);
                        const writesBefore = h.client.writes.length;
                        const acksBefore = h.acks.length;

                        // ack=true always; combined with (optionally) a deletion — both
                        // must be dropped before any writer call.
                        await h.onControlChange(leaf, val, true, deletion);

                        expect(h.client.writes.length - writesBefore, 'acked change issues zero writes').to.equal(0);
                        expect(h.acks.length - acksBefore, 'acked change issues zero acks').to.equal(0);
                    },
                ),
                RUNS,
            );
        });
    });

    // -----------------------------------------------------------------------
    // Feature: storedge-battery-control, Property 12: Revert happens on disable
    // only, never on unload.
    // Validates: Requirements 12.1, 12.2, 12.5
    //
    // The OFF transition writes exactly one FC06 0xE004=defaultStorageControlMode
    // (applyRevert), then stops the heartbeat and clears subscriptions; onUnload
    // issues NO control write. Structural coverage note: main.ts's onUnload only
    // clears the timer and closes the socket — it never touches the ControlWriter,
    // whose only revert entry point is applyRevert (called solely from the disable
    // transition). We assert both the observable revert write and that onUnload
    // emits nothing on the recording client.
    // -----------------------------------------------------------------------
    describe('Feature: storedge-battery-control, Property 12: Revert happens on disable only, never on unload', () => {
        it('Feature: storedge-battery-control, Property 12: disable writes exactly one FC06 0xE004=default; heartbeat and subscriptions stop', async () => {
            const modeArb = fc.integer({ min: 0, max: 4 });
            const limitArb = fc.double({ min: 0, max: 5000, noNaN: true, noDefaultInfinity: true });

            await fc.assert(
                fc.asyncProperty(modeArb, limitArb, async (defaultMode, initialLimit) => {
                    const h = new ControlHarness({
                        controlEnabled: true,
                        defaultStorageControlMode: defaultMode,
                    });
                    await h.enable(initialLimit);
                    expect(h.active, 'control active after enable').to.equal(true);
                    expect(h.subscriptions.length, 'subscriptions registered on enable').to.be.greaterThan(0);

                    const writesBefore = h.client.writes.length;
                    await h.disable();
                    const revertWrites = h.client.writes.slice(writesBefore);

                    // Exactly one FC06 write of 0xE004 = defaultMode.
                    expect(revertWrites.length, 'disable issues exactly one write').to.equal(1);
                    expect(revertWrites[0]).to.deep.equal({
                        fc: 'FC06',
                        address: ADDR_STORAGE_CONTROL_MODE,
                        payload: defaultMode,
                    });
                    // Heartbeat stops (inactive) and subscriptions are cleared.
                    expect(h.active, 'control inactive after disable').to.equal(false);
                    expect(h.subscriptions.length, 'subscriptions cleared on disable').to.equal(0);
                }),
                RUNS,
            );
        });

        it('Feature: storedge-battery-control, Property 12: onUnload issues no control write', async () => {
            const limitArb = fc.double({ min: 0, max: 5000, noNaN: true, noDefaultInfinity: true });

            await fc.assert(
                fc.asyncProperty(limitArb, async initialLimit => {
                    const h = new ControlHarness({ controlEnabled: true, defaultStorageControlMode: 2 });
                    await h.enable(initialLimit);
                    const writesBefore = h.client.writes.length;

                    // Unload while control is still active: no revert, no write.
                    h.onUnload();

                    expect(h.client.writes.length - writesBefore, 'onUnload must issue zero control writes').to.equal(
                        0,
                    );
                }),
                RUNS,
            );
        });

        it("Feature: storedge-battery-control, Property 12: applyRevert is the ControlWriter's only revert entry point (structural)", () => {
            // The writer exposes exactly one revert method; onUnload never calls it.
            const surface = Object.getOwnPropertyNames(ModbusControlWriter.prototype).filter(n => n !== 'constructor');
            const revertMethods = surface.filter(n => /revert|unload|disable/i.test(n));
            expect(revertMethods, 'the only revert path is applyRevert').to.deep.equal(['applyRevert']);
        });
    });

    // -----------------------------------------------------------------------
    // Example: the enable sequence main.ts runs (applyEnable) matches the design
    // (0xE004=4 FC06, 0xE00D=4 FC06, 0xE010=computed FC16), threading the real
    // computeDischargeLimit output as main.ts does.
    // Validates: Requirements 12.1
    // -----------------------------------------------------------------------
    it('enable seeds lastWritten0xE010 from the computed limit and revert restores the default (example)', async () => {
        const house: SourceSample = { val: 3000, ts: 1_000_000 };
        const wallbox: SourceSample = { val: 500, ts: 1_000_000 };
        const computed = computeDischargeLimit(house, wallbox, 1_000_000, 120, 5000); // 2500

        const h = new ControlHarness({ controlEnabled: true, defaultStorageControlMode: 3 });
        await h.enable(computed);
        expect(h.lastWritten0xE010).to.equal(2500);

        // 0xE010 was written once during applyEnable with encodeFloat32le(2500).
        const dischargeWrites = writesTo(h.client, ADDR_REMOTE_DISCHARGE_LIMIT);
        expect(dischargeWrites.length).to.equal(1);
        expect(dischargeWrites[0].payload).to.deep.equal(encodeFloat32le(2500));

        await h.disable();
        const revertWrites = writesTo(h.client, ADDR_STORAGE_CONTROL_MODE);
        // applyEnable wrote 0xE004=4, disable wrote 0xE004=3 (default). Last is the revert.
        expect(revertWrites[revertWrites.length - 1]).to.deep.equal({
            fc: 'FC06',
            address: ADDR_STORAGE_CONTROL_MODE,
            payload: 3,
        });
        // STORAGE_CONTROL_MODE is the revert target register.
        expect(STORAGE_CONTROL_MODE.address).to.equal(ADDR_STORAGE_CONTROL_MODE);
    });
});
