// StorEdge Global StorEdge Control Block register definitions.
//
// Pure, static data describing the nine manufacturer-documented registers at base
// address 0xE004 (mirrored at 0xF704). This module is a SIBLING of sunspec-map.ts:
// it is never polled via the SunSpec read model and never appears in SUNSPEC_MAP /
// BATTERY_MAP. Multi-word registers use little-endian word order (low word first,
// bytes big-endian within each word) — the same float32le/uint32le convention
// already implemented in sunspec-decode.ts for the 0xE1xx battery block.
//
// Requirements: 2.3, 2.4, 3.1-3.10, 4.1-4.5, 8.4

/** Value encoding of a StorEdgeControlBlock register on the wire. */
export type StorEdgeControlKind = 'uint16' | 'float32' | 'uint32';

/** Word order for multiword registers; little-endian word order (matches float32le/uint32le). */
export type StorEdgeWordOrder = 'le';

/**
 * Conservative upper bound for Battery_Max_Power (W), used as the Documented_Range
 * maximum for Remote_Control_Charge_Limit (0xE00E) and Remote_Control_Discharge_Limit
 * (0xE010). The manufacturer table specifies these two registers' maximum as
 * "Battery Max Power" rather than a fixed number — an inverter-model-specific
 * wattage the adapter has no reliable runtime source for. SolarEdge StorEdge battery
 * packs top out around 5000 W per battery; this constant is doubled to 10000 W to
 * accommodate multi-battery installs (matching the existing two-slot battery support)
 * without under-rejecting a legitimate two-battery configuration, while still catching
 * obviously invalid input.
 */
export const BATTERY_MAX_POWER_W = 10000;

/** One StorEdgeControlBlock register definition. */
export interface StorEdgeControlRegisterDef {
    /** Stable key used as the StorEdgeControlBlock state id leaf, e.g. 'storageControlMode'. */
    name: string;
    /** Absolute base-0 Modbus register address (0xExxx range). */
    address: number;
    /** Value encoding on the wire. */
    kind: StorEdgeControlKind;
    /** Number of 16-bit registers (1 for uint16, 2 for float32/uint32). */
    length: number;
    /** Word order for multiword registers; single-word regs omit this. */
    wordOrder?: StorEdgeWordOrder;
    /** ioBroker `common.type` for the backing state. */
    iobType: 'number';
    /** Physical unit for `common.unit`, if any. */
    unit?: string;
    /** Inclusive minimum of the manufacturer's Documented_Range. */
    min: number;
    /** Inclusive maximum of the manufacturer's Documented_Range. */
    max: number;
    /** Write function code: FC06 for uint16, FC16 for the multiword registers. */
    fc: 'FC06' | 'FC16';
}

/** Storage Control Mode `0xE004` (uint16, 0..4). Selects the storage control mode. */
export const STORAGE_CONTROL_MODE: StorEdgeControlRegisterDef = {
    name: 'storageControlMode',
    address: 0xe004,
    kind: 'uint16',
    length: 1,
    iobType: 'number',
    min: 0,
    max: 4,
    fc: 'FC06',
};

/** Storage AC Charge Policy `0xE005` (uint16, 0..3). Selects the AC charge policy. */
export const STORAGE_AC_CHARGE_POLICY: StorEdgeControlRegisterDef = {
    name: 'storageAcChargePolicy',
    address: 0xe005,
    kind: 'uint16',
    length: 1,
    iobType: 'number',
    min: 0,
    max: 3,
    fc: 'FC06',
};

/** Storage AC Charge Limit `0xE006` (float32, KWh or %, 0..Max_Float). */
export const STORAGE_AC_CHARGE_LIMIT: StorEdgeControlRegisterDef = {
    name: 'storageAcChargeLimit',
    address: 0xe006,
    kind: 'float32',
    length: 2,
    wordOrder: 'le',
    iobType: 'number',
    unit: 'kWh',
    min: 0,
    max: Number.MAX_VALUE,
    fc: 'FC16',
};

/** Storage Backup Reserved Setting `0xE008` (float32, %, 0..100). */
export const STORAGE_BACKUP_RESERVED_SETTING: StorEdgeControlRegisterDef = {
    name: 'storageBackupReservedSetting',
    address: 0xe008,
    kind: 'float32',
    length: 2,
    wordOrder: 'le',
    iobType: 'number',
    unit: '%',
    min: 0,
    max: 100,
    fc: 'FC16',
};

/** Storage Charge/Discharge Default Mode `0xE00A` (uint16, 0..7). The default charge/discharge mode. */
export const STORAGE_CHARGE_DISCHARGE_DEFAULT_MODE: StorEdgeControlRegisterDef = {
    name: 'storageChargeDischargeDefaultMode',
    address: 0xe00a,
    kind: 'uint16',
    length: 1,
    iobType: 'number',
    min: 0,
    max: 7,
    fc: 'FC06',
};

/** Remote Control Command Timeout `0xE00B` (uint32, seconds, 0..86400, uint32le, FC16). */
export const REMOTE_CONTROL_COMMAND_TIMEOUT: StorEdgeControlRegisterDef = {
    name: 'remoteControlCommandTimeout',
    address: 0xe00b,
    kind: 'uint32',
    length: 2,
    wordOrder: 'le',
    iobType: 'number',
    unit: 's',
    min: 0,
    max: 86400,
    fc: 'FC16',
};

/** Remote Control Command Mode `0xE00D` (uint16, 0..7). Selects the remote control command mode. */
export const REMOTE_CONTROL_COMMAND_MODE: StorEdgeControlRegisterDef = {
    name: 'remoteControlCommandMode',
    address: 0xe00d,
    kind: 'uint16',
    length: 1,
    iobType: 'number',
    min: 0,
    max: 7,
    fc: 'FC06',
};

/** Remote Control Charge Limit `0xE00E` (float32, W, 0..Battery_Max_Power, float32le, FC16). */
export const REMOTE_CONTROL_CHARGE_LIMIT: StorEdgeControlRegisterDef = {
    name: 'remoteControlChargeLimit',
    address: 0xe00e,
    kind: 'float32',
    length: 2,
    wordOrder: 'le',
    iobType: 'number',
    unit: 'W',
    min: 0,
    max: BATTERY_MAX_POWER_W,
    fc: 'FC16',
};

/** Remote Control Discharge Limit `0xE010` (float32, W, 0..Battery_Max_Power, float32le, FC16). */
export const REMOTE_CONTROL_DISCHARGE_LIMIT: StorEdgeControlRegisterDef = {
    name: 'remoteControlDischargeLimit',
    address: 0xe010,
    kind: 'float32',
    length: 2,
    wordOrder: 'le',
    iobType: 'number',
    unit: 'W',
    min: 0,
    max: BATTERY_MAX_POWER_W,
    fc: 'FC16',
};

/**
 * All nine Global StorEdge Control Block register definitions, in manufacturer
 * table order. Kept separate from the SunSpec read map — never polled via the
 * SunSpec model and never an entry in SUNSPEC_MAP/BATTERY_MAP (Req 3.10, 8.4).
 */
export const STOREDGE_CONTROL_REGISTERS: readonly StorEdgeControlRegisterDef[] = [
    STORAGE_CONTROL_MODE,
    STORAGE_AC_CHARGE_POLICY,
    STORAGE_AC_CHARGE_LIMIT,
    STORAGE_BACKUP_RESERVED_SETTING,
    STORAGE_CHARGE_DISCHARGE_DEFAULT_MODE,
    REMOTE_CONTROL_COMMAND_TIMEOUT,
    REMOTE_CONTROL_COMMAND_MODE,
    REMOTE_CONTROL_CHARGE_LIMIT,
    REMOTE_CONTROL_DISCHARGE_LIMIT,
];

/**
 * Resolve the StorEdgeControlBlock register def for a given state-id leaf, or
 * `undefined` if the name does not match any of the nine registers.
 *
 * @param name
 */
export function findStorEdgeControlDef(name: string): StorEdgeControlRegisterDef | undefined {
    return STOREDGE_CONTROL_REGISTERS.find(def => def.name === name);
}
