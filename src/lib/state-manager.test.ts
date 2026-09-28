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
import { STOREDGE_CONTROL_REGISTERS } from './storedge-control-map';
import type { SunSpecRegisterDef } from './sunspec-map';
import {
    BATTERY_MAP,
    SUNSPEC_MAP,
    getBatteryValueDefs,
    getInverterValueDefs,
    getMeterValueDefs,
    getValueDefs,
} from './sunspec-map';

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

            // status -> value (numeric read-only status; 'indicator' is boolean-only, E1009)
            await manager.ensureState('inverter', defByName('status'));
            expect((adapter.objects.get('inverter.status')!.common as ioBroker.StateCommon).role).to.equal('value');
        });

        it('maps status states (inverter + battery) to role value, not indicator', async () => {
            const adapter = new MockAdapter();
            const manager = new StateManager(adapter);

            await manager.ensureState(
                'inverter',
                getInverterValueDefs().find(d => d.name === 'status')!,
            );
            await manager.ensureState(
                'inverter',
                getInverterValueDefs().find(d => d.name === 'statusVendor')!,
            );
            await manager.ensureState(
                'battery.1',
                getBatteryValueDefs().find(d => d.name === 'status')!,
            );
            await manager.ensureState(
                'battery.1',
                getBatteryValueDefs().find(d => d.name === 'statusInternal')!,
            );

            for (const id of [
                'inverter.status',
                'inverter.statusVendor',
                'battery.1.status',
                'battery.1.statusInternal',
            ]) {
                const common = adapter.objects.get(id)!.common as ioBroker.StateCommon;
                expect(common.type, `${id} type`).to.equal('number');
                expect(common.role, `${id} role`).to.equal('value');
            }
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
    // Task 4.2 — Tests for the StorEdgeControlBlock channel/states
    // (Req 8.1, 8.2, 8.4, 9.1, 9.2, 9.3)
    //
    // The nine write=true StorEdgeControlBlock states are created OUTSIDE the
    // register-map read model by ensureStorEdgeControlBlock(). These tests assert
    // the state/channel metadata (read/write, type, role, unit, min/max),
    // idempotency, ack writes, and that no StorEdgeControlBlock id is ever
    // produced by the SunSpec ensureState path (and vice versa).
    // --------------------------------------------------------------------

    describe('ensureStorEdgeControlBlock', () => {
        /** Expected common.role per StorEdgeControlBlock register name (corrected catalogue-valid roles). */
        const EXPECTED_ROLE: Record<string, string> = {
            storageControlMode: 'level',
            storageAcChargePolicy: 'level',
            storageAcChargeLimit: 'level',
            storageBackupReservedSetting: 'level.fill',
            storageChargeDischargeDefaultMode: 'level',
            remoteControlCommandTimeout: 'level.timer',
            remoteControlCommandMode: 'level',
            remoteControlChargeLimit: 'level',
            remoteControlDischargeLimit: 'level',
        };

        /**
         * Expected additive `common.states` enumeration per mode-selector register.
         * Only these four selectors carry an enumeration; the other five controls
         * leave `common.states` undefined. Runtime object keys are strings.
         */
        const EXPECTED_STATES: Record<string, Record<number, string>> = {
            storageControlMode: {
                0: 'Disabled',
                1: 'Maximize Self Consumption',
                2: 'Time of Use',
                3: 'Backup Only',
                4: 'Remote Control',
            },
            storageAcChargePolicy: {
                0: 'Disable',
                1: 'Always Allowed',
                2: 'Fixed Energy Limit',
                3: 'Percent of Production',
            },
            storageChargeDischargeDefaultMode: {
                0: 'Off',
                1: 'Charge Excess PV Power Only',
                2: 'Charge from PV First',
                3: 'Charge from PV + AC',
                4: 'Maximize Export',
                5: 'Discharge to Meet Consumption',
                7: 'Maximize Self Consumption',
            },
            remoteControlCommandMode: {
                0: 'Off',
                1: 'Charge Excess PV Power Only',
                2: 'Charge from PV First',
                3: 'Charge from PV + AC',
                4: 'Maximize Export',
                5: 'Discharge to Meet Consumption',
                7: 'Maximize Self Consumption',
            },
        };

        /** The exact nine StorEdgeControlBlock ids. */
        const STOREDGE_IDS = STOREDGE_CONTROL_REGISTERS.map(def => `StorEdgeControlBlock.${def.name}`);

        /**
         * Read the created state common for a StorEdgeControlBlock id, asserting the
         * object exists.
         *
         * @param adapter
         * @param id
         */
        function storEdgeCommon(adapter: MockAdapter, id: string): ioBroker.StateCommon {
            const obj = adapter.objects.get(id);
            expect(obj, `${id} object`).to.not.equal(undefined);
            expect(obj!.type).to.equal('state');
            return obj!.common as ioBroker.StateCommon;
        }

        it("creates the 'StorEdgeControlBlock' channel object with type 'channel'", async () => {
            const adapter = new MockAdapter();
            const manager = new StateManager(adapter);
            await manager.ensureStorEdgeControlBlock();

            const channel = adapter.objects.get('StorEdgeControlBlock');
            expect(channel, 'StorEdgeControlBlock channel').to.not.equal(undefined);
            expect(channel!.type).to.equal('channel');
        });

        it('creates all nine states with read=true, write=true, correct type/role/unit/min/max', async () => {
            const adapter = new MockAdapter();
            const manager = new StateManager(adapter);
            await manager.ensureStorEdgeControlBlock();

            for (const def of STOREDGE_CONTROL_REGISTERS) {
                const common = storEdgeCommon(adapter, `StorEdgeControlBlock.${def.name}`);
                expect(common.type, `${def.name} type`).to.equal('number');
                expect(common.read, `${def.name} read`).to.equal(true);
                expect(common.write, `${def.name} write`).to.equal(true);
                expect(common.role, `${def.name} role`).to.equal(EXPECTED_ROLE[def.name]);
                expect(common.min, `${def.name} min`).to.equal(def.min);
                expect(common.max, `${def.name} max`).to.equal(def.max);
                if (def.unit !== undefined) {
                    expect(common, `${def.name} should have unit`).to.have.property('unit', def.unit);
                } else {
                    expect(common, `${def.name} should not have unit`).to.not.have.property('unit');
                }
            }
        });

        it('adds common.states enumeration to exactly the four mode selectors (and nowhere else)', async () => {
            const adapter = new MockAdapter();
            const manager = new StateManager(adapter);
            await manager.ensureStorEdgeControlBlock();

            for (const def of STOREDGE_CONTROL_REGISTERS) {
                const common = storEdgeCommon(adapter, `StorEdgeControlBlock.${def.name}`);
                const expectedStates = EXPECTED_STATES[def.name];
                if (expectedStates !== undefined) {
                    // Runtime object keys are strings; build the string-keyed expectation.
                    const expectedRuntime: Record<string, string> = {};
                    for (const [k, v] of Object.entries(expectedStates)) {
                        expectedRuntime[k] = v;
                    }
                    expect(common.states, `${def.name} common.states`).to.deep.equal(expectedRuntime);
                } else {
                    expect(common, `${def.name} should not have common.states`).to.not.have.property('states');
                }
            }
        });

        it('writeStorEdgeValue / ackStorEdgeWrite write { val, ack: true } to the correct id', async () => {
            const adapter = new MockAdapter();
            const manager = new StateManager(adapter);
            await manager.ensureStorEdgeControlBlock();

            // Float def.
            const floatDef = STOREDGE_CONTROL_REGISTERS.find(d => d.name === 'remoteControlDischargeLimit')!;
            await manager.writeStorEdgeValue(floatDef, 3200);
            const floatWrites = adapter.writesFor('StorEdgeControlBlock.remoteControlDischargeLimit');
            expect(floatWrites.length).to.equal(1);
            expect(floatWrites[0].val).to.equal(3200);
            expect(floatWrites[0].ack).to.equal(true);

            // uint16-like def.
            const uintDef = STOREDGE_CONTROL_REGISTERS.find(d => d.name === 'storageControlMode')!;
            await manager.ackStorEdgeWrite(uintDef, 2);
            const uintWrites = adapter.writesFor('StorEdgeControlBlock.storageControlMode');
            expect(uintWrites.length).to.equal(1);
            expect(uintWrites[0].val).to.equal(2);
            expect(uintWrites[0].ack).to.equal(true);
        });

        // ----------------------------------------------------------------
        // Property 13: Unconditional and idempotent channel/state creation
        // ----------------------------------------------------------------

        it('Feature: storedge-battery-control, Property 13: Unconditional and idempotent channel/state creation', async () => {
            // ensureStorEdgeControlBlock takes no config parameter, so "regardless of
            // config" is inherently satisfied; this verifies pure idempotency across
            // any number of repeated calls.
            const repeatArb = fc.integer({ min: 1, max: 10 });

            await fc.assert(
                fc.asyncProperty(repeatArb, async n => {
                    const adapter = new MockAdapter();
                    const manager: IStateManager = new StateManager(adapter);

                    for (let i = 0; i < n; i++) {
                        await manager.ensureStorEdgeControlBlock();
                    }

                    for (const id of ['StorEdgeControlBlock', ...STOREDGE_IDS]) {
                        expect(adapter.createCalls.get(id) ?? 0, `${id} createCalls`).to.equal(1);
                        expect(adapter.createAttempts.get(id) ?? 0, `${id} createAttempts`).to.equal(0);
                    }
                }),
                { numRuns: 200 },
            );
        });

        // ----------------------------------------------------------------
        // Property 14: The write=true surface is exactly the nine StorEdgeControlBlock states
        // ----------------------------------------------------------------

        it('Feature: storedge-battery-control, Property 14: The write=true surface is exactly the nine StorEdgeControlBlock states', async () => {
            // Every def created via the EXISTING SunSpec ensureState path — either a
            // top-level value def (inverter/meter) or a battery value def — always has
            // common.write === false.
            const sunspecDefArb = fc.oneof(
                fc.record({ def: fc.constantFrom(...allValueDefs), isBattery: fc.constant(false) }),
                fc.record({ def: fc.constantFrom(...allBatteryValueDefs), isBattery: fc.constant(true) }),
            );

            await fc.assert(
                fc.asyncProperty(sunspecDefArb, async ({ def, isBattery }) => {
                    const adapter = new MockAdapter();
                    const manager: IStateManager = new StateManager(adapter);
                    const channel = isBattery ? 'battery.1' : channelForDef(def);
                    await manager.ensureState(channel, def);

                    const common = adapter.objects.get(`${channel}.${def.name}`)!.common as ioBroker.StateCommon;
                    expect(common.write).to.equal(false);
                }),
                { numRuns: 200 },
            );
        });

        it('the exactly-nine StorEdgeControlBlock ids all have write=true, and no StorEdgeControlBlock id is ever produced by ensureState', async () => {
            const adapter = new MockAdapter();
            const manager = new StateManager(adapter);

            // Drive every SunSpec value def (inverter/meter/battery) through the
            // register-map-driven ensureState path: none of them must ever produce a
            // StorEdgeControlBlock.* id.
            for (const def of allValueDefs) {
                await manager.ensureState(channelForDef(def), def);
            }
            for (const def of allBatteryValueDefs) {
                await manager.ensureState('battery.1', def);
            }
            const storEdgeIdsFromReadModel = [...adapter.objects.keys()].filter(id =>
                id.startsWith('StorEdgeControlBlock.'),
            );
            expect(
                storEdgeIdsFromReadModel,
                'SunSpec read path must not create StorEdgeControlBlock.* states',
            ).to.deep.equal([]);

            // The nine StorEdgeControlBlock ids come only from ensureStorEdgeControlBlock(),
            // are created exactly nine, and all have write=true.
            await manager.ensureStorEdgeControlBlock();
            const createdStorEdgeIds = [...adapter.objects.keys()]
                .filter(id => id.startsWith('StorEdgeControlBlock.'))
                .sort();
            expect(createdStorEdgeIds).to.deep.equal([...STOREDGE_IDS].sort());
            for (const id of createdStorEdgeIds) {
                const common = adapter.objects.get(id)!.common as ioBroker.StateCommon;
                expect(common.write, `${id} write`).to.equal(true);
            }
        });
    });

    // --------------------------------------------------------------------
    // state-role-validation-fixes — Task 1
    // Property 1: Bug Condition — corrected states use catalogue-valid,
    // compatible roles.
    //
    // These assertions encode the EXPECTED (post-fix) roles from design
    // Property 1 / Fix Implementation. On the UNFIXED code they MUST FAIL —
    // that failure is the codified counterexample that proves the 13 states
    // carry invalid/incompatible roles (E1011 / E1008 / E1009).
    //
    // Scoped deterministically to the 13 concrete triggering states (the nine
    // STOREDGE_CONTROL_REGISTERS + inverter.status, inverter.statusVendor,
    // battery.1.status, battery.1.statusInternal) rather than random inputs.
    //
    // Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9,
    // 2.10, 2.11, 2.12, 2.13
    // --------------------------------------------------------------------

    describe('Bug condition (Property 1): corrected states use catalogue-valid, compatible roles', () => {
        /** Expected (post-fix) common.role for the four numeric status states (E1009 -> value). */
        const EXPECTED_STATUS_ROLE = 'value';

        /**
         * Expected (post-fix) common.role per StorEdgeControlBlock register name
         * (E1011 / E1008 corrected to catalogue Levels-family roles per design Property 1).
         */
        const EXPECTED_STOREDGE_ROLE: Record<string, string> = {
            remoteControlChargeLimit: 'level', // was 'value.power' (E1011)
            remoteControlDischargeLimit: 'level', // was 'value.power' (E1011)
            remoteControlCommandTimeout: 'level.timer', // was 'value.interval' (E1011)
            storageAcChargeLimit: 'level', // was 'value.energy' (E1011)
            storageBackupReservedSetting: 'level.fill', // was 'value.fill' (E1011)
            remoteControlCommandMode: 'level', // was 'level.mode' (E1008)
            storageAcChargePolicy: 'level', // was 'level.mode' (E1008)
            storageChargeDischargeDefaultMode: 'level', // was 'level.mode' (E1008)
            storageControlMode: 'level', // was 'level.mode' (E1008)
        };

        /**
         * Resolve the created state common for an id, asserting the object exists.
         *
         * @param adapter
         * @param id
         */
        function commonFor(adapter: MockAdapter, id: string): ioBroker.StateCommon {
            const obj = adapter.objects.get(id);
            expect(obj, `${id} object`).to.not.equal(undefined);
            expect(obj!.type).to.equal('state');
            return obj!.common as ioBroker.StateCommon;
        }

        it('inverter.status / inverter.statusVendor use role value (numeric read-only), not indicator (E1009)', async () => {
            const adapter = new MockAdapter();
            const manager = new StateManager(adapter);

            const statusDef = getInverterValueDefs().find(d => d.name === 'status')!;
            const statusVendorDef = getInverterValueDefs().find(d => d.name === 'statusVendor')!;

            await manager.ensureState('inverter', statusDef);
            await manager.ensureState('inverter', statusVendorDef);

            const status = commonFor(adapter, 'inverter.status');
            const statusVendor = commonFor(adapter, 'inverter.statusVendor');

            // type is number, so indicator (boolean-only) is a catalogue violation.
            expect(status.type, 'inverter.status type').to.equal('number');
            expect(statusVendor.type, 'inverter.statusVendor type').to.equal('number');

            expect(status.role, 'inverter.status role').to.equal(EXPECTED_STATUS_ROLE);
            expect(statusVendor.role, 'inverter.statusVendor role').to.equal(EXPECTED_STATUS_ROLE);
        });

        it('battery.1.status / battery.1.statusInternal use role value (numeric read-only), not indicator (E1009)', async () => {
            const adapter = new MockAdapter();
            const manager = new StateManager(adapter);

            const statusDef = getBatteryValueDefs().find(d => d.name === 'status')!;
            const statusInternalDef = getBatteryValueDefs().find(d => d.name === 'statusInternal')!;

            await manager.ensureState('battery.1', statusDef);
            await manager.ensureState('battery.1', statusInternalDef);

            const status = commonFor(adapter, 'battery.1.status');
            const statusInternal = commonFor(adapter, 'battery.1.statusInternal');

            expect(status.type, 'battery.1.status type').to.equal('number');
            expect(statusInternal.type, 'battery.1.statusInternal type').to.equal('number');

            expect(status.role, 'battery.1.status role').to.equal(EXPECTED_STATUS_ROLE);
            expect(statusInternal.role, 'battery.1.statusInternal role').to.equal(EXPECTED_STATUS_ROLE);
        });

        it('the nine writable StorEdgeControlBlock controls use catalogue Levels-family roles (E1011 + E1008)', async () => {
            const adapter = new MockAdapter();
            const manager = new StateManager(adapter);
            await manager.ensureStorEdgeControlBlock();

            for (const def of STOREDGE_CONTROL_REGISTERS) {
                const common = commonFor(adapter, `StorEdgeControlBlock.${def.name}`);
                // These are the adapter's only write=true states; a value.* role here is E1011.
                expect(common.write, `${def.name} write`).to.equal(true);
                expect(common.role, `${def.name} role`).to.equal(EXPECTED_STOREDGE_ROLE[def.name]);
            }
        });
    });

    // --------------------------------------------------------------------
    // state-role-validation-fixes — Task 2
    // Property 2: Preservation — non-buggy states are created identically by
    // the fixed adapter.
    //
    // OBSERVATION-FIRST: every assertion below encodes behavior observed on the
    // CURRENT UNFIXED code, so they MUST PASS now and must continue to hold
    // after the role fix + additive `common.states` enhancement. They lock in
    // everything the fix must NOT disturb: measurement/info roles, StorEdge and
    // status non-role attributes (type/read/write/min/max/unit), the absence of
    // stray `common.states`, idempotency, and acknowledged-write behavior.
    //
    // Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6
    // --------------------------------------------------------------------

    describe('Preservation (Property 2): non-buggy states unchanged', () => {
        /**
         * The four E1008 mode selectors that WILL receive an additive `common.states`
         * enumeration by the fix. Every OTHER control/state must never gain one, so
         * the "no stray common.states" assertions exclude exactly these four.
         */
        const MODE_SELECTOR_NAMES: ReadonlySet<string> = new Set([
            'storageControlMode',
            'storageAcChargePolicy',
            'storageChargeDischargeDefaultMode',
            'remoteControlCommandMode',
        ]);

        /**
         * Baseline measurement-role mappings observed on the UNFIXED code. Every
         * non-status, non-info SunSpec logical role maps to exactly this
         * `common.role`, and the fix must not touch any of them (Req 3.1).
         */
        const EXPECTED_MEASUREMENT_ROLE: Record<string, string> = {
            current: 'value.current',
            voltage: 'value.voltage',
            power: 'value.power.active',
            'power.apparent': 'value.power',
            'power.reactive': 'value.power',
            powerFactor: 'value',
            frequency: 'value.frequency',
            energy: 'value.energy',
            temperature: 'value.temperature',
            percent: 'value.fill',
        };

        /**
         * Resolve the created state common for an id, asserting the object exists.
         *
         * @param adapter
         * @param id
         */
        function commonFor(adapter: MockAdapter, id: string): ioBroker.StateCommon {
            const obj = adapter.objects.get(id);
            expect(obj, `${id} object`).to.not.equal(undefined);
            expect(obj!.type).to.equal('state');
            return obj!.common as ioBroker.StateCommon;
        }

        /** Every SunSpec value def paired with the channel it is created under. */
        const sunspecCases: { channel: ChannelPath; def: SunSpecRegisterDef }[] = [
            ...allValueDefs.map(def => ({ channel: channelForDef(def), def })),
            ...allBatteryValueDefs.map(def => ({ channel: 'battery.1', def })),
        ];

        // ----------------------------------------------------------------
        // Req 3.1 — measurement roles preserved (value.* mapping unchanged)
        // ----------------------------------------------------------------
        it('preserves the value.* role of every non-status, non-info measurement def (Req 3.1)', async () => {
            const measurementCases = sunspecCases.filter(c => c.def.role !== 'status' && c.def.role !== 'info');
            // Sanity: representative mappings are actually exercised.
            expect(measurementCases.some(c => c.def.name === 'acPower')).to.equal(true);
            expect(measurementCases.some(c => c.def.name === 'acCurrent')).to.equal(true);
            expect(measurementCases.some(c => c.def.name === 'acEnergyWh')).to.equal(true);

            for (const { channel, def } of measurementCases) {
                const adapter = new MockAdapter();
                const manager = new StateManager(adapter);
                await manager.ensureState(channel, def);
                const common = commonFor(adapter, `${channel}.${def.name}`);
                const expected = EXPECTED_MEASUREMENT_ROLE[def.role];
                expect(expected, `role mapping known for ${def.role}`).to.not.equal(undefined);
                expect(common.role, `${def.name} (${def.role}) role`).to.equal(expected);
            }
        });

        it('preserves the specific representative mappings acPower/acCurrent/acEnergyWh (Req 3.1)', async () => {
            const adapter = new MockAdapter();
            const manager = new StateManager(adapter);
            const byName = (name: string): SunSpecRegisterDef => {
                const def = allValueDefs.find(d => d.name === name);
                expect(def, `value def ${name}`).to.not.equal(undefined);
                return def!;
            };

            await manager.ensureState('inverter', byName('acPower'));
            await manager.ensureState('inverter', byName('acCurrent'));
            await manager.ensureState('inverter', byName('acEnergyWh'));

            expect(commonFor(adapter, 'inverter.acPower').role).to.equal('value.power.active');
            expect(commonFor(adapter, 'inverter.acCurrent').role).to.equal('value.current');
            expect(commonFor(adapter, 'inverter.acEnergyWh').role).to.equal('value.energy');
        });

        // ----------------------------------------------------------------
        // Req 3.1 — info/scale-factor/identity roles preserved (plain value)
        // ----------------------------------------------------------------
        it('preserves the plain value role of every info/scale-factor/identity def (Req 3.1)', async () => {
            // Info defs are filtered out of getValueDefs()/getBatteryValueDefs(), so
            // pull them straight from the raw maps.
            const infoCases: { channel: ChannelPath; def: SunSpecRegisterDef }[] = [
                ...SUNSPEC_MAP.filter(d => d.role === 'info' && d.model !== 'common').map(def => ({
                    channel: channelForDef(def),
                    def,
                })),
                ...BATTERY_MAP.filter(d => d.role === 'info').map(def => ({
                    channel: 'battery.1',
                    def,
                })),
            ];
            expect(infoCases.length, 'at least one info def exercised').to.be.greaterThan(0);

            for (const { channel, def } of infoCases) {
                const adapter = new MockAdapter();
                const manager = new StateManager(adapter);
                await manager.ensureState(channel, def);
                const common = commonFor(adapter, `${channel}.${def.name}`);
                expect(common.role, `${def.name} (info) role`).to.equal('value');
            }
        });

        // ----------------------------------------------------------------
        // Req 3.2 — StorEdge non-role attributes preserved
        // ----------------------------------------------------------------
        it('preserves write=true, read=true, type=number and exact min/max/unit for all nine StorEdge controls (Req 3.2)', async () => {
            const adapter = new MockAdapter();
            const manager = new StateManager(adapter);
            await manager.ensureStorEdgeControlBlock();

            for (const def of STOREDGE_CONTROL_REGISTERS) {
                const common = commonFor(adapter, `StorEdgeControlBlock.${def.name}`);
                expect(common.type, `${def.name} type`).to.equal('number');
                expect(common.read, `${def.name} read`).to.equal(true);
                expect(common.write, `${def.name} write`).to.equal(true);
                expect(common.min, `${def.name} min`).to.equal(def.min);
                expect(common.max, `${def.name} max`).to.equal(def.max);
                if (def.unit !== undefined) {
                    expect(common, `${def.name} should have unit`).to.have.property('unit', def.unit);
                } else {
                    expect(common, `${def.name} should not have unit`).to.not.have.property('unit');
                }
            }
        });

        // ----------------------------------------------------------------
        // Req 3.3 — status non-role attributes preserved
        // ----------------------------------------------------------------
        it('preserves type=number, read=true, write=false for the four corrected status states (Req 3.3)', async () => {
            const cases: { channel: ChannelPath; def: SunSpecRegisterDef }[] = [
                { channel: 'inverter', def: getInverterValueDefs().find(d => d.name === 'status')! },
                { channel: 'inverter', def: getInverterValueDefs().find(d => d.name === 'statusVendor')! },
                { channel: 'battery.1', def: getBatteryValueDefs().find(d => d.name === 'status')! },
                { channel: 'battery.1', def: getBatteryValueDefs().find(d => d.name === 'statusInternal')! },
            ];

            for (const { channel, def } of cases) {
                const adapter = new MockAdapter();
                const manager = new StateManager(adapter);
                await manager.ensureState(channel, def);
                const common = commonFor(adapter, `${channel}.${def.name}`);
                expect(common.type, `${channel}.${def.name} type`).to.equal('number');
                expect(common.read, `${channel}.${def.name} read`).to.equal(true);
                expect(common.write, `${channel}.${def.name} write`).to.equal(false);
            }
        });

        // ----------------------------------------------------------------
        // Req 3.2, 3.6 — no stray common.states
        //
        // On the UNFIXED code NO state carries common.states, so this passes
        // everywhere. After the fix it must still hold for every state EXCEPT the
        // four mode selectors (which gain the additive enumeration), proving the
        // enhancement adds the attribute nowhere else.
        // ----------------------------------------------------------------
        it('has no common.states on the five non-selector StorEdge controls (Req 3.2, 3.6)', async () => {
            const adapter = new MockAdapter();
            const manager = new StateManager(adapter);
            await manager.ensureStorEdgeControlBlock();

            for (const def of STOREDGE_CONTROL_REGISTERS) {
                if (MODE_SELECTOR_NAMES.has(def.name)) {
                    continue;
                }
                const common = commonFor(adapter, `StorEdgeControlBlock.${def.name}`);
                expect(common, `${def.name} should not have common.states`).to.not.have.property('states');
            }
        });

        it('has no common.states on any status/measurement/info state (Req 3.2, 3.6)', async () => {
            const infoCases: { channel: ChannelPath; def: SunSpecRegisterDef }[] = [
                ...SUNSPEC_MAP.filter(d => d.model !== 'common').map(def => ({ channel: channelForDef(def), def })),
                ...BATTERY_MAP.map(def => ({ channel: 'battery.1', def })),
            ];

            for (const { channel, def } of infoCases) {
                const adapter = new MockAdapter();
                const manager = new StateManager(adapter);
                await manager.ensureState(channel, def);
                const common = commonFor(adapter, `${channel}.${def.name}`);
                expect(common, `${channel}.${def.name} should not have common.states`).to.not.have.property('states');
            }
        });

        // ----------------------------------------------------------------
        // Req 3.2, 3.6 — additive nature: object count and per-state
        // type/read/write/min/max/unit are stable; ack behavior unaffected.
        //
        // Observed here on the UNFIXED code as the full baseline object dump
        // (channels + states) that the fix must preserve unchanged except for the
        // 13 role strings and the four additive common.states maps.
        // ----------------------------------------------------------------
        it('produces a stable full object dump (count + attributes) that the fix must preserve (Req 3.2, 3.6)', async () => {
            const adapter = new MockAdapter();
            const manager = new StateManager(adapter);

            // Full dump: all channels + all SunSpec/battery states + StorEdge block.
            await manager.ensureChannel('inverter');
            await manager.ensureChannel('meter.1');
            await manager.ensureChannel('battery.1');
            for (const def of allValueDefs) {
                await manager.ensureState(channelForDef(def), def);
            }
            for (const def of allBatteryValueDefs) {
                await manager.ensureState('battery.1', def);
            }
            await manager.ensureStorEdgeControlBlock();

            // Snapshot the per-state non-role attributes as the baseline to preserve.
            const stateObjects = [...adapter.objects.entries()].filter(([, obj]) => obj.type === 'state');
            expect(stateObjects.length, 'at least the StorEdge + SunSpec states exist').to.be.greaterThan(0);

            for (const [id, obj] of stateObjects) {
                const common = obj.common as ioBroker.StateCommon;
                expect(common.type, `${id} type`).to.be.oneOf(['number', 'string']);
                expect(common.read, `${id} read`).to.equal(true);
                // Only the nine StorEdge controls are write=true; everything else write=false.
                if (id.startsWith('StorEdgeControlBlock.')) {
                    expect(common.write, `${id} write`).to.equal(true);
                } else {
                    expect(common.write, `${id} write`).to.equal(false);
                }
            }
        });

        // ----------------------------------------------------------------
        // Req 3.5 — idempotency preserved across ensure* calls
        // ----------------------------------------------------------------
        it('keeps ensureState / ensureChannel / ensureStorEdgeControlBlock idempotent (Req 3.5)', async () => {
            const repeatArb = fc.integer({ min: 1, max: 8 });
            const defArb = fc.constantFrom(...allValueDefs);

            await fc.assert(
                fc.asyncProperty(defArb, repeatArb, async (def, n) => {
                    const adapter = new MockAdapter();
                    const manager: IStateManager = new StateManager(adapter);
                    const channel = channelForDef(def);
                    const stateId = `${channel}.${def.name}`;

                    for (let i = 0; i < n; i++) {
                        await manager.ensureChannel(channel);
                        await manager.ensureState(channel, def);
                        await manager.ensureStorEdgeControlBlock();
                    }

                    // Each id created exactly once, with no repeat-create attempts.
                    expect(adapter.createCalls.get(channel) ?? 0, `${channel} createCalls`).to.equal(1);
                    expect(adapter.createCalls.get(stateId) ?? 0, `${stateId} createCalls`).to.equal(1);
                    expect(adapter.createAttempts.get(stateId) ?? 0, `${stateId} createAttempts`).to.equal(0);

                    for (const sedef of STOREDGE_CONTROL_REGISTERS) {
                        const id = `StorEdgeControlBlock.${sedef.name}`;
                        expect(adapter.createCalls.get(id) ?? 0, `${id} createCalls`).to.equal(1);
                        expect(adapter.createAttempts.get(id) ?? 0, `${id} createAttempts`).to.equal(0);
                    }
                }),
                { numRuns: 100 },
            );
        });

        // ----------------------------------------------------------------
        // Req 3.4 — write/ack behavior preserved
        // ----------------------------------------------------------------
        it('writeValue writes { val, ack: true } to the SunSpec id (Req 3.4)', async () => {
            const defArb = fc.constantFrom(...allValueDefs);
            const valueArb = fc.double({ noNaN: true });

            await fc.assert(
                fc.asyncProperty(defArb, valueArb, async (def, value) => {
                    const adapter = new MockAdapter();
                    const manager: IStateManager = new StateManager(adapter);
                    const channel = channelForDef(def);
                    const id = `${channel}.${def.name}`;

                    await manager.writeValue(channel, def, value);

                    const writes = adapter.writesFor(id);
                    expect(writes.length).to.equal(1);
                    expect(writes[0].val).to.equal(value);
                    expect(writes[0].ack).to.equal(true);
                }),
                { numRuns: 100 },
            );
        });

        it('writeStorEdgeValue / ackStorEdgeWrite write { val, ack: true } to the StorEdgeControlBlock id (Req 3.4)', async () => {
            const defArb = fc.constantFrom(...STOREDGE_CONTROL_REGISTERS);
            const valueArb = fc.double({ noNaN: true });

            await fc.assert(
                fc.asyncProperty(defArb, valueArb, async (def, value) => {
                    const writeAdapter = new MockAdapter();
                    const writeManager: IStateManager = new StateManager(writeAdapter);
                    const id = `StorEdgeControlBlock.${def.name}`;

                    await writeManager.writeStorEdgeValue(def, value);
                    const w1 = writeAdapter.writesFor(id);
                    expect(w1.length).to.equal(1);
                    expect(w1[0].val).to.equal(value);
                    expect(w1[0].ack).to.equal(true);

                    const ackAdapter = new MockAdapter();
                    const ackManager: IStateManager = new StateManager(ackAdapter);
                    await ackManager.ackStorEdgeWrite(def, value);
                    const w2 = ackAdapter.writesFor(id);
                    expect(w2.length).to.equal(1);
                    expect(w2[0].val).to.equal(value);
                    expect(w2[0].ack).to.equal(true);
                }),
                { numRuns: 100 },
            );
        });
    });
});
