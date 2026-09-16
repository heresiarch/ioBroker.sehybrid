// ioBroker state/object manager for the SolarEdge SunSpec reader.
//
// Owns idempotent channel/object creation and acknowledged value writes for the
// polled SunSpec values. State objects are grouped into per-device channels — the
// fixed `inverter` channel plus indexed device channels `meter.<n>` and
// `battery.<n>` (Req 6.9, 9.3, 10.5) — and their metadata is derived
// deterministically from the register definition: type, role, unit,
// read=true/write=false (Req 6.3–6.7, 10.6, 10.7).
//
// Indexed channel paths contain a dot (`meter.2`, `battery.1`); in ioBroker such
// an id nests the channel under a parent `meter` / `battery` container. The
// manager therefore ensures the parent folder object exists once before creating
// the indexed channel object, so each device's states live under a distinct,
// non-colliding id (Property 12).
//
// The manager keeps the adapter dependency minimal and structural (only the two
// object/state methods it actually uses) so it can be unit- and property-tested
// with a lightweight mock adapter (design Properties 3 & 7). Created channels and
// ensured states are tracked in Sets so repeat calls are genuine no-ops (Req 6.1,
// 6.2; Property 7) and rely on `setObjectNotExistsAsync` so pre-existing objects
// on disk are reused rather than recreated.
//
// Separately, and deliberately OUTSIDE the register-map-driven read model, the
// manager also creates the writable expert `control` states used by StorEdge
// battery control (ensureControlStates/setControlAck). These are declared
// explicitly — never sourced from SUNSPEC_MAP/BATTERY_MAP — and are the only
// write=true states in the adapter; the SunSpec read states remain write=false
// (Req 13.1, 13.2, 13.3, 13.6).
//
// Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 8.1, 9.3, 10.5, 10.6, 10.7,
// 13.1, 13.2, 13.3, 13.6

import type { SunSpecRegisterDef, SunSpecRole } from './sunspec-map';

/**
 * Channel path: the fixed `inverter` channel or an indexed device channel for a
 * meter (`meter.1|2|3`) or battery (`battery.1|2`) slot (Req 6.9, 9.3, 10.5).
 */
export type ChannelPath = 'inverter' | `meter.${1 | 2 | 3}` | `battery.${1 | 2}`;

/**
 * Backward-compatible alias for {@link ChannelPath}. Older call sites and tests
 * refer to `ChannelId`; both names denote the same set of channel path strings.
 */
export type ChannelId = ChannelPath;

/**
 * Minimal structural view of the running ioBroker adapter. Only the object/state
 * methods the state manager actually calls are required, which keeps the manager
 * decoupled from the full `ioBroker.Adapter` surface and easy to mock in tests.
 */
export interface StateManagerAdapter {
    setObjectNotExistsAsync(id: string, obj: ioBroker.SettableObject): ioBroker.SetObjectPromise;
    setStateAsync(id: string, state: ioBroker.SettableState): Promise<string>;
}

/** State/object manager contract used by the reader/orchestrator (design Req 6, 7.1). */
export interface IStateManager {
    /** Create the channel (and any parent folder) once; idempotent (Req 6.9, 9.3, 10.5). */
    ensureChannel(channel: ChannelPath): Promise<void>;
    /** Create the state object once from its register def; reuse if present (Req 6.1–6.7, 10.6, 10.7). */
    ensureState(channel: ChannelPath, def: SunSpecRegisterDef): Promise<void>;
    /** Write an engineering value with ack=true; no-op when value is null (Req 3.8, 6.8, 8.1). */
    writeValue(channel: ChannelPath, def: SunSpecRegisterDef, value: number | string | null): Promise<void>;
    /**
     * Create the expert `control` channel and all writable/read-only control states,
     * idempotently and outside the register-map-driven read model (Req 13.1–13.3, 13.6).
     * Only invoked when control is enabled.
     */
    ensureControlStates(): Promise<void>;
    /** Write an acknowledged value (val + ack=true) to a `control.<name>` state (Req 14.3). */
    setControlAck(name: string, value: number | boolean): Promise<void>;
}

/** Human-readable display names for the parent device folders (Req 6.9, 9.3, 10.5). */
const PARENT_NAMES: Record<'meter' | 'battery', string> = {
    meter: 'Meter',
    battery: 'Battery',
};

/**
 * Resolve the `common.name` display label for a channel path.
 *
 * - `inverter` -> `Inverter`
 * - `meter.<n>` -> `Meter <n>`
 * - `battery.<n>` -> `Battery <n>`
 *
 * @param channel - The channel path to label.
 */
function channelDisplayName(channel: ChannelPath): string {
    if (channel === 'inverter') {
        return 'Inverter';
    }
    const [group, index] = channel.split('.');
    return `${PARENT_NAMES[group as 'meter' | 'battery']} ${index}`;
}

/**
 * Map a logical SunSpec role to a valid ioBroker `common.role` string (Req 6.4).
 *
 * Every {@link SunSpecRole} has an entry so the mapping is total. The chosen roles
 * are standard ioBroker state roles (`value.*` for measurements, `indicator` for
 * status flags, plain `value` for unitless/dimensionless quantities).
 */
const ROLE_MAP: Record<SunSpecRole, string> = {
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
    status: 'indicator',
    info: 'value',
};

/** The dedicated expert channel under which all control states live (Req 13.3, 13.6). */
const CONTROL_CHANNEL = 'control';

/**
 * Static metadata for a single expert control state.
 *
 * These are declared explicitly here — deliberately NOT derived from
 * `CONTROL_REGISTERS`/`SUNSPEC_MAP`/`BATTERY_MAP` — so the control surface stays
 * outside the register-map-driven read model (Req 13.6). Each entry mirrors the
 * design's control-state table (design section 4).
 */
interface ControlStateDef {
    /** Leaf name; the state id is `control.<name>`. */
    name: string;
    /** ioBroker state value type. */
    type: 'number' | 'boolean';
    /** ioBroker `common.role`. */
    role: string;
    /** Optional engineering unit; omitted from `common` when undefined. */
    unit?: string;
    /** Whether the state is user-writable (`common.write`). */
    write: boolean;
}

/**
 * The expert control states created by {@link StateManager.ensureControlStates}.
 *
 * Writable raw registers (`0xE004`, `0xE00D`, `0xE010`) are `read=true, write=true`
 * (Req 13.1); the timeout register (`0xE00B`) and the two reflections are read-only
 * (`read=true, write=false`) (Req 13.2). All are marked `common.expert = true`.
 */
const CONTROL_STATE_DEFS: readonly ControlStateDef[] = [
    { name: 'storageControlMode', type: 'number', role: 'level.mode', write: true },
    { name: 'remoteControlCommandMode', type: 'number', role: 'level.mode', write: true },
    { name: 'remoteControlDischargeLimit', type: 'number', role: 'value.power', unit: 'W', write: true },
    { name: 'remoteControlCommandTimeout', type: 'number', role: 'value.interval', unit: 's', write: false },
    { name: 'computedDischargeLimit', type: 'number', role: 'value.power', unit: 'W', write: false },
    { name: 'controlActive', type: 'boolean', role: 'indicator', write: false },
];

/**
 * Idempotent ioBroker object/channel creator and acknowledged-value writer.
 *
 * Instantiated once per adapter run with the running adapter instance. Channel and
 * state creation are cached in-memory so repeat calls within a run do not re-issue
 * `setObjectNotExistsAsync`; combined with the "not exists" semantics this makes
 * `ensureChannel`/`ensureState` idempotent both in-process and against pre-existing
 * objects (Req 6.1, 6.2; Property 7).
 */
export class StateManager implements IStateManager {
    private readonly adapter: StateManagerAdapter;
    /** Channel/parent-folder ids already created this run, to skip redundant object calls. */
    private readonly createdChannels = new Set<string>();
    /** State ids already ensured this run, to make ensureState a no-op on repeat. */
    private readonly ensuredStates = new Set<string>();

    constructor(adapter: StateManagerAdapter) {
        this.adapter = adapter;
    }

    async ensureChannel(channel: ChannelPath): Promise<void> {
        // Indexed device channels (meter.<n>, battery.<n>) nest under a parent
        // container object; ensure that folder exists once before the channel
        // itself so the ids are structurally valid and never collide (Property 12).
        if (channel !== 'inverter') {
            const group = channel.split('.')[0] as 'meter' | 'battery';
            await this.ensureContainer(group, 'folder', PARENT_NAMES[group]);
        }
        await this.ensureContainer(channel, 'channel', channelDisplayName(channel));
    }

    /**
     * Create a channel/folder object once and remember it for the run.
     *
     * @param id - The object id to create (channel path or parent group id).
     * @param type - The ioBroker object type ('folder' for parents, 'channel' otherwise).
     * @param name - The `common.name` display label.
     */
    private async ensureContainer(id: string, type: 'folder' | 'channel', name: string): Promise<void> {
        if (this.createdChannels.has(id)) {
            return;
        }
        await this.adapter.setObjectNotExistsAsync(id, {
            type,
            common: {
                name,
            },
            native: {},
        });
        this.createdChannels.add(id);
    }

    async ensureState(channel: ChannelPath, def: SunSpecRegisterDef): Promise<void> {
        const id = `${channel}.${def.name}`;
        if (this.ensuredStates.has(id)) {
            return;
        }

        // Derive the state metadata deterministically from the register def
        // (Req 6.3 type, 6.4 role, 6.5/6.6 unit, 6.7 read/write).
        const common: ioBroker.StateCommon = {
            name: def.name,
            type: def.iobType,
            role: ROLE_MAP[def.role],
            read: true,
            write: false,
        };
        // Set `common.unit` only when the def declares a unit; omit the property
        // entirely otherwise (Req 6.5, 6.6).
        if (def.unit !== undefined) {
            common.unit = def.unit;
        }

        await this.adapter.setObjectNotExistsAsync(id, {
            type: 'state',
            common,
            native: {},
        });
        this.ensuredStates.add(id);
    }

    async writeValue(channel: ChannelPath, def: SunSpecRegisterDef, value: number | string | null): Promise<void> {
        // NOT_IMPLEMENTED / skipped values arrive as null and must not be written;
        // the previously acknowledged value (if any) is retained (Req 3.8).
        if (value === null) {
            return;
        }
        // Defensive: guarantee the object exists before writing (idempotent).
        await this.ensureState(channel, def);
        // Every value received from the inverter is written acknowledged (Req 6.8, 8.1).
        await this.adapter.setStateAsync(`${channel}.${def.name}`, { val: value, ack: true });
    }

    async ensureControlStates(): Promise<void> {
        // Create the dedicated expert channel first so the control states nest under
        // it. `common.expert = true` groups the whole branch as advanced in admin
        // (Req 13.3). This is deliberately separate from the SunSpec channels created
        // by ensureChannel, and never sourced from the register map (Req 13.6).
        if (!this.createdChannels.has(CONTROL_CHANNEL)) {
            await this.adapter.setObjectNotExistsAsync(CONTROL_CHANNEL, {
                type: 'channel',
                common: {
                    name: 'Control',
                    expert: true,
                },
                native: {},
            });
            this.createdChannels.add(CONTROL_CHANNEL);
        }

        // Create each control state explicitly from the static table (not the register
        // map), reusing the same Set-based idempotency + setObjectNotExistsAsync pattern
        // as the SunSpec states so repeat calls are genuine no-ops (Property 7).
        for (const def of CONTROL_STATE_DEFS) {
            const id = `${CONTROL_CHANNEL}.${def.name}`;
            if (this.ensuredStates.has(id)) {
                continue;
            }

            const common: ioBroker.StateCommon = {
                name: def.name,
                type: def.type,
                role: def.role,
                read: true,
                write: def.write,
                expert: true,
            };
            if (def.unit !== undefined) {
                common.unit = def.unit;
            }

            await this.adapter.setObjectNotExistsAsync(id, {
                type: 'state',
                common,
                native: {},
            });
            this.ensuredStates.add(id);
        }
    }

    async setControlAck(name: string, value: number | boolean): Promise<void> {
        // Acknowledged write to a control state so an adapter-originated write does not
        // re-trigger onStateChange (the handler ignores ack=true changes) (Req 14.3).
        await this.adapter.setStateAsync(`${CONTROL_CHANNEL}.${name}`, { val: value, ack: true });
    }
}
