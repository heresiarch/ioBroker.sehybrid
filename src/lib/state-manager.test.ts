/**
 * Tests for the ioBroker state/object manager (StateManager).
 *
 * Covers:
 * - Property 3 (write side): null values are not written; non-null values are
 *   written acknowledged (task 8.2; Req 3.8, 6.8, 8.1)
 * - Property 7: idempotent channel/state object creation (task 8.3; Req 6.1, 6.2)
 * - Unit tests for channel grouping and derived state metadata (task 8.4; Req 6.3–6.7, 6.9)
 *
 * A lightweight MockAdapter implements the minimal StateManagerAdapter surface and
 * records object/state calls so the manager's behavior can be asserted directly.
 */

import { expect } from 'chai';
import fc from 'fast-check';
import type { ChannelPath, IStateManager, StateManagerAdapter } from './state-manager';
import { StateManager } from './state-manager';
import type { SunSpecRegisterDef } from './sunspec-map';
import { getBatteryValueDefs, getInverterValueDefs, getMeterValueDefs, getValueDefs } from './sunspec-map';

// ---------------------------------------------------------------------------
// Mock adapter
// ---------------------------------------------------------------------------

/** A single recorded state write. */
interface WriteRecord {
    id: string;
    val: ioBroker.StateValue;
    ack: boolean | undefined;
}

/**
 * Minimal StateManagerAdapter implementation for tests.
 *
 * - setObjectNotExistsAsync mimics "not exists" semantics: the first call for an
 *   id records the object; subsequent calls for the same id do NOT overwrite it
 *   but bump a per-id createAttempts counter. Every call bumps createCalls[id].
 * - setStateAsync records the last state per id and appends to the writes[] log.
 */
class MockAdapter implements StateManagerAdapter {
    /** Objects that "exist" on disk, keyed by id (first write wins). */
    readonly objects = new Map<string, ioBroker.SettableObject>();
    /** Total number of setObjectNotExistsAsync calls per id. */
    readonly createCalls = new Map<string, number>();
    /** Number of calls that hit an already-existing id (no overwrite). */
    readonly createAttempts = new Map<string, number>();
    /** Last state written per id. */
    readonly states = new Map<string, ioBroker.SettableState>();
    /** Ordered log of every state write. */
    readonly writes: WriteRecord[] = [];

    setObjectNotExistsAsync(id: string, obj: ioBroker.SettableObject): ioBroker.SetObjectPromise {
        this.createCalls.set(id, (this.createCalls.get(id) ?? 0) + 1);
        if (this.objects.has(id)) {
            // Already present: not-exists semantics => do not overwrite.
            this.createAttempts.set(id, (this.createAttempts.get(id) ?? 0) + 1);
        } else {
            this.objects.set(id, obj);
        }
        return Promise.resolve({ id });
    }

    setStateAsync(id: string, state: ioBroker.SettableState): Promise<string> {
        this.states.set(id, state);
        this.writes.push({ id, val: state.val as ioBroker.StateValue, ack: state.ack });
        return Promise.resolve(id);
    }

    /**
     * Convenience: writes recorded for a given id.
     *
     * @param id
     */
    writesFor(id: string): WriteRecord[] {
        return this.writes.filter(w => w.id === id);
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Inverter models 101/102/103 -> 'inverter'; meter models 201–204 -> 'meter.1'.
 *
 * @param def
 */
function channelForDef(def: SunSpecRegisterDef): ChannelPath {
    return def.model === 201 || def.model === 202 || def.model === 203 || def.model === 204 ? 'meter.1' : 'inverter';
}

const allValueDefs = getValueDefs();
const inverterValueDefs = getInverterValueDefs();
const meterValueDefs = getMeterValueDefs();
const allBatteryValueDefs = getBatteryValueDefs();

describe('state-manager => StateManager', () => {
    // --------------------------------------------------------------------
    // Task 8.2 — Property 3 (write side): null/ack behavior
    // --------------------------------------------------------------------

    it('Feature: solaredge-sunspec-reader, Property 3: null values are not written, non-null values are written with ack=true', async () => {
        // Choose from the concrete measurement defs, paired with a value that is
        // either null or a number/string.
        const defArb = fc.constantFrom(...allValueDefs);
        const valueArb: fc.Arbitrary<number | string | null> = fc.oneof(
            fc.constant<null>(null),
            fc.double({ noNaN: true }),
            fc.integer(),
            fc.string(),
        );

        await fc.assert(
            fc.asyncProperty(defArb, valueArb, async (def, value) => {
                const adapter = new MockAdapter();
                const manager: IStateManager = new StateManager(adapter);
                const channel = channelForDef(def);
                const id = `${channel}.${def.name}`;

                await manager.writeValue(channel, def, value);

                const writes = adapter.writesFor(id);
                if (value === null) {
                    // No state write recorded for a null value.
                    expect(writes.length).to.equal(0);
                } else {
                    // Exactly one acknowledged write of the exact value.
                    expect(writes.length).to.equal(1);
                    expect(writes[0].val).to.equal(value);
                    expect(writes[0].ack).to.equal(true);
                }
            }),
            { numRuns: 200 },
        );
    });

    // --------------------------------------------------------------------
    // Task 8.3 — Property 7: idempotent object creation
    // --------------------------------------------------------------------

    it('Feature: solaredge-sunspec-reader, Property 7: Idempotent object creation', async () => {
        const defArb = fc.constantFrom(...allValueDefs);
        const repeatArb = fc.integer({ min: 1, max: 10 });

        await fc.assert(
            fc.asyncProperty(defArb, repeatArb, async (def, n) => {
                const adapter = new MockAdapter();
                const manager: IStateManager = new StateManager(adapter);
                const channel = channelForDef(def);
                const stateId = `${channel}.${def.name}`;

                // Ensuring the same state N times issues at most one create call.
                for (let i = 0; i < n; i++) {
                    await manager.ensureState(channel, def);
                }
                expect(adapter.createCalls.get(stateId) ?? 0).to.equal(1);
                expect(adapter.createAttempts.get(stateId) ?? 0).to.equal(0);

                // Ensuring the same channel N times also creates it at most once.
                for (let i = 0; i < n; i++) {
                    await manager.ensureChannel(channel);
                }
                expect(adapter.createCalls.get(channel) ?? 0).to.equal(1);
                expect(adapter.createAttempts.get(channel) ?? 0).to.equal(0);
            }),
            { numRuns: 200 },
        );
    });

    // --------------------------------------------------------------------
    // Task 8.4 — Unit tests: channel grouping & metadata
    // --------------------------------------------------------------------

    describe('ensureChannel', () => {
        it("creates the 'inverter' channel object with type 'channel' and name 'Inverter'", async () => {
            const adapter = new MockAdapter();
            const manager = new StateManager(adapter);
            await manager.ensureChannel('inverter');
            const obj = adapter.objects.get('inverter');
            expect(obj).to.not.equal(undefined);
            expect(obj!.type).to.equal('channel');
            expect((obj!.common as ioBroker.ChannelCommon).name).to.equal('Inverter');
        });

        it("creates the 'meter.1' channel (type 'channel', name 'Meter 1') under a 'meter' folder", async () => {
            const adapter = new MockAdapter();
            const manager = new StateManager(adapter);
            await manager.ensureChannel('meter.1');

            const parent = adapter.objects.get('meter');
            expect(parent).to.not.equal(undefined);
            expect(parent!.type).to.equal('folder');
            expect((parent!.common as ioBroker.ChannelCommon).name).to.equal('Meter');

            const obj = adapter.objects.get('meter.1');
            expect(obj).to.not.equal(undefined);
            expect(obj!.type).to.equal('channel');
            expect((obj!.common as ioBroker.ChannelCommon).name).to.equal('Meter 1');
        });
    });

    describe('ensureState metadata', () => {
        /**
         * Find a representative def by name from the value defs.
         *
         * @param name
         */
        function defByName(name: string): SunSpecRegisterDef {
            const def = allValueDefs.find(d => d.name === name);
            expect(def, `expected a value def named ${name}`).to.not.equal(undefined);
            return def!;
        }

        it("derives type/role/read/write/unit for a power value (acPower, unit 'W')", async () => {
            const adapter = new MockAdapter();
            const manager = new StateManager(adapter);
            const def = defByName('acPower');
            await manager.ensureState('inverter', def);

            const obj = adapter.objects.get('inverter.acPower');
            expect(obj).to.not.equal(undefined);
            expect(obj!.type).to.equal('state');
            const common = obj!.common as ioBroker.StateCommon;
            expect(common.type).to.equal(def.iobType);
            expect(common.type).to.equal('number');
            expect(common.role).to.equal('value.power.active');
            expect(common.read).to.equal(true);
            expect(common.write).to.equal(false);
            expect(common.unit).to.equal('W');
        });

        it('maps role -> ioBroker common.role for representative quantities', async () => {
            const adapter = new MockAdapter();
            const manager = new StateManager(adapter);

            // current -> value.current
            await manager.ensureState('inverter', defByName('acCurrent'));
            expect((adapter.objects.get('inverter.acCurrent')!.common as ioBroker.StateCommon).role).to.equal(
                'value.current',
            );

            // energy -> value.energy
            await manager.ensureState('inverter', defByName('acEnergyWh'));
            expect((adapter.objects.get('inverter.acEnergyWh')!.common as ioBroker.StateCommon).role).to.equal(
                'value.energy',
            );

            // status -> indicator
            await manager.ensureState('inverter', defByName('status'));
            expect((adapter.objects.get('inverter.status')!.common as ioBroker.StateCommon).role).to.equal('indicator');
        });

        it("omits the 'unit' key entirely when the def declares no unit (status)", async () => {
            const adapter = new MockAdapter();
            const manager = new StateManager(adapter);
            const def = defByName('status');
            expect(def.unit).to.equal(undefined);

            await manager.ensureState('inverter', def);
            const common = adapter.objects.get('inverter.status')!.common as ioBroker.StateCommon;
            expect(common).to.not.have.property('unit');
        });

        it("includes the 'unit' key iff the def declares a unit (all value defs)", async () => {
            const adapter = new MockAdapter();
            const manager = new StateManager(adapter);
            for (const def of allValueDefs) {
                const channel = channelForDef(def);
                await manager.ensureState(channel, def);
                const common = adapter.objects.get(`${channel}.${def.name}`)!.common as ioBroker.StateCommon;
                if (def.unit !== undefined) {
                    expect(common, `${def.name} should have unit`).to.have.property('unit', def.unit);
                } else {
                    expect(common, `${def.name} should not have unit`).to.not.have.property('unit');
                }
            }
        });
    });

    describe('writeValue', () => {
        it('writes non-null values acknowledged (ack=true)', async () => {
            const adapter = new MockAdapter();
            const manager = new StateManager(adapter);
            const def = getInverterValueDefs().find(d => d.name === 'acPower')!;
            await manager.writeValue('inverter', def, 1234);

            const writes = adapter.writesFor('inverter.acPower');
            expect(writes.length).to.equal(1);
            expect(writes[0].val).to.equal(1234);
            expect(writes[0].ack).to.equal(true);
        });
    });

    describe('channel grouping', () => {
        it("places inverter defs under 'inverter.<name>'", async () => {
            const adapter = new MockAdapter();
            const manager = new StateManager(adapter);
            const def = inverterValueDefs[0];
            await manager.ensureState('inverter', def);
            expect(adapter.objects.has(`inverter.${def.name}`)).to.equal(true);
        });

        it("places meter defs under 'meter.1.<name>'", async () => {
            const adapter = new MockAdapter();
            const manager = new StateManager(adapter);
            const def = meterValueDefs[0];
            await manager.ensureState('meter.1', def);
            expect(adapter.objects.has(`meter.1.${def.name}`)).to.equal(true);
        });

        it('writes inverter and meter values under their respective channels', async () => {
            const adapter = new MockAdapter();
            const manager = new StateManager(adapter);
            const invDef = inverterValueDefs[0];
            const meterDef = meterValueDefs[0];

            await manager.writeValue('inverter', invDef, 1);
            await manager.writeValue('meter.1', meterDef, 2);

            expect(adapter.writesFor(`inverter.${invDef.name}`).length).to.equal(1);
            expect(adapter.writesFor(`meter.1.${meterDef.name}`).length).to.equal(1);
        });
    });

    // --------------------------------------------------------------------
    // Task 18.2 — Property 12: per-device channel isolation
    // --------------------------------------------------------------------

    describe('Feature: solaredge-sunspec-reader, Property 12: Per-device channel isolation', () => {
        const batteryValueDefs = allBatteryValueDefs;

        it('creates parent folders once and distinct indexed channel objects', async () => {
            const adapter = new MockAdapter();
            const manager = new StateManager(adapter);

            await manager.ensureChannel('meter.1');
            await manager.ensureChannel('meter.2');
            await manager.ensureChannel('battery.1');

            // Parent folder objects exist once each, as type 'folder'.
            const meterParent = adapter.objects.get('meter');
            const batteryParent = adapter.objects.get('battery');
            expect(meterParent, 'meter parent folder').to.not.equal(undefined);
            expect(meterParent!.type).to.equal('folder');
            expect((meterParent!.common as ioBroker.ChannelCommon).name).to.equal('Meter');
            expect(batteryParent, 'battery parent folder').to.not.equal(undefined);
            expect(batteryParent!.type).to.equal('folder');
            expect((batteryParent!.common as ioBroker.ChannelCommon).name).to.equal('Battery');

            // Indexed channel objects exist and are of type 'channel'.
            for (const id of ['meter.1', 'meter.2', 'battery.1']) {
                const obj = adapter.objects.get(id);
                expect(obj, `${id} channel`).to.not.equal(undefined);
                expect(obj!.type).to.equal('channel');
            }
            expect((adapter.objects.get('meter.1')!.common as ioBroker.ChannelCommon).name).to.equal('Meter 1');
            expect((adapter.objects.get('meter.2')!.common as ioBroker.ChannelCommon).name).to.equal('Meter 2');
            expect((adapter.objects.get('battery.1')!.common as ioBroker.ChannelCommon).name).to.equal('Battery 1');

            // Repeated ensureChannel calls do not recreate any object (createCalls == 1 per id).
            await manager.ensureChannel('meter.1');
            await manager.ensureChannel('meter.2');
            await manager.ensureChannel('battery.1');
            for (const id of ['meter', 'battery', 'meter.1', 'meter.2', 'battery.1']) {
                expect(adapter.createCalls.get(id) ?? 0, `${id} createCalls`).to.equal(1);
            }
        });

        it('writes the same def name under different device slots to distinct, non-colliding ids', async () => {
            const adapter = new MockAdapter();
            const manager = new StateManager(adapter);

            const meterDef = meterValueDefs[0];
            await manager.writeValue('meter.1', meterDef, 10);
            await manager.writeValue('meter.2', meterDef, 20);

            const id1 = `meter.1.${meterDef.name}`;
            const id2 = `meter.2.${meterDef.name}`;
            expect(id1).to.not.equal(id2);
            expect(adapter.writesFor(id1).length).to.equal(1);
            expect(adapter.writesFor(id2).length).to.equal(1);
            expect(adapter.writesFor(id1)[0].val).to.equal(10);
            expect(adapter.writesFor(id2)[0].val).to.equal(20);

            // A battery def lands under battery.<n>.<name>, distinct from meter ids.
            const batteryDef = batteryValueDefs[0];
            await manager.writeValue('battery.1', batteryDef, 30);
            const batId = `battery.1.${batteryDef.name}`;
            expect(batId).to.not.equal(id1);
            expect(batId).to.not.equal(id2);
            expect(adapter.writesFor(batId).length).to.equal(1);
        });

        it('writeValue over battery value defs writes exactly one ack=true state at battery.1.<name>', async () => {
            const defArb = fc.constantFrom(...batteryValueDefs);
            const valueArb = fc.double({ noNaN: true });

            await fc.assert(
                fc.asyncProperty(defArb, valueArb, async (def, value) => {
                    const adapter = new MockAdapter();
                    const manager: IStateManager = new StateManager(adapter);
                    const id = `battery.1.${def.name}`;

                    await manager.writeValue('battery.1', def, value);

                    const writes = adapter.writesFor(id);
                    expect(writes.length).to.equal(1);
                    expect(writes[0].val).to.equal(value);
                    expect(writes[0].ack).to.equal(true);

                    // No writes leaked to any other id.
                    expect(adapter.writes.length).to.equal(1);
                }),
                { numRuns: 100 },
            );
        });
    });

    // --------------------------------------------------------------------
    // Task 4.2 — Example tests for control-state metadata
    // (Req 13.1, 13.2, 13.3, 13.6)
    //
    // The writable expert `control` states are created OUTSIDE the register-map
    // read model by ensureControlStates(). These tests assert the state/channel
    // metadata (expert flag, read/write, type, unit), idempotency, ack writes,
    // and that no control id is ever derived from the SunSpec register map.
    // --------------------------------------------------------------------

    describe('ensureControlStates metadata (Req 13.1, 13.2, 13.3, 13.6)', () => {
        /** The exact six control ids from the design's control-state table. */
        const CONTROL_IDS = [
            'control.storageControlMode',
            'control.remoteControlCommandMode',
            'control.remoteControlDischargeLimit',
            'control.remoteControlCommandTimeout',
            'control.computedDischargeLimit',
            'control.controlActive',
        ] as const;

        /**
         * Read the created state common for a control id, asserting the object exists.
         *
         * @param adapter
         * @param id
         */
        function controlCommon(adapter: MockAdapter, id: string): ioBroker.StateCommon {
            const obj = adapter.objects.get(id);
            expect(obj, `${id} object`).to.not.equal(undefined);
            expect(obj!.type).to.equal('state');
            return obj!.common as ioBroker.StateCommon;
        }

        it("marks the 'control' channel object as expert (Req 13.3)", async () => {
            const adapter = new MockAdapter();
            const manager = new StateManager(adapter);
            await manager.ensureControlStates();

            const channel = adapter.objects.get('control');
            expect(channel, 'control channel').to.not.equal(undefined);
            expect(channel!.type).to.equal('channel');
            const common = channel!.common as ioBroker.ChannelCommon;
            expect(common.name).to.equal('Control');
            expect((common as ioBroker.ChannelCommon & { expert?: boolean }).expert).to.equal(true);
        });

        it('creates each expert writable raw state as read+write with correct type/unit (Req 13.1, 13.3)', async () => {
            const adapter = new MockAdapter();
            const manager = new StateManager(adapter);
            await manager.ensureControlStates();

            // storageControlMode (raw 0xE004): number, read+write, expert, no unit.
            const storageMode = controlCommon(adapter, 'control.storageControlMode');
            expect(storageMode.type).to.equal('number');
            expect(storageMode.read).to.equal(true);
            expect(storageMode.write).to.equal(true);
            expect(storageMode.expert).to.equal(true);
            expect(storageMode).to.not.have.property('unit');

            // remoteControlCommandMode (raw 0xE00D): number, read+write, expert, no unit.
            const commandMode = controlCommon(adapter, 'control.remoteControlCommandMode');
            expect(commandMode.type).to.equal('number');
            expect(commandMode.read).to.equal(true);
            expect(commandMode.write).to.equal(true);
            expect(commandMode.expert).to.equal(true);
            expect(commandMode).to.not.have.property('unit');

            // remoteControlDischargeLimit (raw 0xE010): number W, read+write, expert.
            const dischargeLimit = controlCommon(adapter, 'control.remoteControlDischargeLimit');
            expect(dischargeLimit.type).to.equal('number');
            expect(dischargeLimit.read).to.equal(true);
            expect(dischargeLimit.write).to.equal(true);
            expect(dischargeLimit.expert).to.equal(true);
            expect(dischargeLimit.unit).to.equal('W');
        });

        it('creates remoteControlCommandTimeout as read-only (read=true, write=false) with unit s (Req 13.2)', async () => {
            const adapter = new MockAdapter();
            const manager = new StateManager(adapter);
            await manager.ensureControlStates();

            const timeout = controlCommon(adapter, 'control.remoteControlCommandTimeout');
            expect(timeout.type).to.equal('number');
            expect(timeout.read).to.equal(true);
            expect(timeout.write).to.equal(false);
            expect(timeout.expert).to.equal(true);
            expect(timeout.unit).to.equal('s');
        });

        it('creates computedDischargeLimit (W) and controlActive (boolean) as read-only reflections (Req 13.2)', async () => {
            const adapter = new MockAdapter();
            const manager = new StateManager(adapter);
            await manager.ensureControlStates();

            const computed = controlCommon(adapter, 'control.computedDischargeLimit');
            expect(computed.type).to.equal('number');
            expect(computed.read).to.equal(true);
            expect(computed.write).to.equal(false);
            expect(computed.unit).to.equal('W');

            const active = controlCommon(adapter, 'control.controlActive');
            expect(active.type).to.equal('boolean');
            expect(active.read).to.equal(true);
            expect(active.write).to.equal(false);
        });

        it('is idempotent: calling ensureControlStates twice issues no duplicate creates (Property 7)', async () => {
            const adapter = new MockAdapter();
            const manager = new StateManager(adapter);

            await manager.ensureControlStates();
            await manager.ensureControlStates();

            // The control channel and every control state are created exactly once,
            // and no call ever hit an already-existing id (Set-based no-op).
            for (const id of ['control', ...CONTROL_IDS]) {
                expect(adapter.createCalls.get(id) ?? 0, `${id} createCalls`).to.equal(1);
                expect(adapter.createAttempts.get(id) ?? 0, `${id} createAttempts`).to.equal(0);
            }
        });

        it('setControlAck(name, value) writes { val, ack: true } to control.<name> (Req 13.6)', async () => {
            const adapter = new MockAdapter();
            const manager = new StateManager(adapter);
            await manager.ensureControlStates();

            await manager.setControlAck('remoteControlDischargeLimit', 3200);
            await manager.setControlAck('controlActive', true);

            const numWrites = adapter.writesFor('control.remoteControlDischargeLimit');
            expect(numWrites.length).to.equal(1);
            expect(numWrites[0].val).to.equal(3200);
            expect(numWrites[0].ack).to.equal(true);

            const boolWrites = adapter.writesFor('control.controlActive');
            expect(boolWrites.length).to.equal(1);
            expect(boolWrites[0].val).to.equal(true);
            expect(boolWrites[0].ack).to.equal(true);
        });

        it('derives no control state from the SunSpec register map; control ids are exactly the six design states (Req 13.6)', async () => {
            const adapter = new MockAdapter();
            const manager = new StateManager(adapter);

            // Ensuring every SunSpec value def via the register-map-driven read path
            // must never produce an id under `control.`.
            for (const def of allValueDefs) {
                await manager.ensureState(channelForDef(def), def);
            }
            for (const def of allBatteryValueDefs) {
                await manager.ensureState('battery.1', def);
            }
            const controlIdsFromReadModel = [...adapter.objects.keys()].filter(id => id.startsWith('control.'));
            expect(controlIdsFromReadModel, 'SunSpec read path must not create control.* states').to.deep.equal([]);

            // Control states come only from ensureControlStates(), and are exactly
            // the six ids from the design table (plus the `control` channel object).
            await manager.ensureControlStates();
            const createdControlIds = [...adapter.objects.keys()].filter(id => id.startsWith('control.')).sort();
            expect(createdControlIds).to.deep.equal([...CONTROL_IDS].sort());
        });
    });
});
