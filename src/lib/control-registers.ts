// StorEdge Power Control register definitions for the battery-control feature.
//
// This module is a pure, static definition set describing the StorEdge Power
// Control registers in the `0xExxx` range. It is deliberately kept fully separate
// from the SunSpec read map (`SUNSPEC_MAP`/`BATTERY_MAP` in `sunspec-map.ts`):
// these registers are never polled by the read loop and never appear in the
// SunSpec value table. Multi-word control registers use little-endian word order
// (low word first, bytes big-endian within each word), matching the adapter's
// existing `float32le`/`uint32le` decoding convention.
//
// Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 3.3, 3.4

/** Value encoding of a control register on the wire. */
export type ControlRegisterKind = 'uint16' | 'float32' | 'uint32';

/** Word order for multiword control registers; matches `float32le`/`uint32le`. */
export type ControlWordOrder = 'le';

/** One StorEdge control-register definition. */
export interface ControlRegisterDef {
    /** Stable key used as the control-state id leaf, e.g. 'storageControlMode'. */
    name: string;
    /** Absolute base-0 Modbus register address (0xExxx range). */
    address: number;
    /** Value encoding on the wire. */
    kind: ControlRegisterKind;
    /** Number of 16-bit registers (1 for uint16, 2 for float32/uint32). */
    length: number;
    /** Word order for multiword registers; single-word regs ignore this. */
    wordOrder?: ControlWordOrder;
    /** ioBroker `common.type` for the backing state. */
    iobType: 'number';
    /** Physical unit for `common.unit`, if any. */
    unit?: string;
    /** Inclusive minimum value for validation / documentation. */
    min: number;
    /** Inclusive maximum value for validation / documentation. */
    max: number;
    /** Write function code the adapter uses (FC06 uint16, FC16 multiword). Absent = never written. */
    fc?: 'FC06' | 'FC16';
    /**
     * Governs whether the backing EXPERT STATE is user-writable: `true` means the
     * expert state only reflects a value and never accepts user writes. Whether the
     * underlying register is written by the adapter is driven by `fc` presence, not
     * this flag.
     */
    readOnly?: boolean;
}

/** Export Configuration `0xE000` (uint16, 0..0xffff). Written once (=0) on enable. (Req 4.1) */
export const EXPORT_CONFIG: ControlRegisterDef = {
    name: 'exportConfig',
    address: 0xe000,
    kind: 'uint16',
    length: 1,
    iobType: 'number',
    min: 0,
    max: 0xffff,
    fc: 'FC06',
};

/** Storage Control Mode `0xE004` (uint16, 0..4). Selects the storage control mode. (Req 4.1) */
export const STORAGE_CONTROL_MODE: ControlRegisterDef = {
    name: 'storageControlMode',
    address: 0xe004,
    kind: 'uint16',
    length: 1,
    iobType: 'number',
    min: 0,
    max: 4,
    fc: 'FC06',
};

/** Storage Charge/Discharge Default Mode `0xE00A` (uint16, 0..7). Written once on enable (=configured fallback mode). (Req 4.3) */
export const STORAGE_DEFAULT_MODE: ControlRegisterDef = {
    name: 'storageDefaultMode',
    address: 0xe00a,
    kind: 'uint16',
    length: 1,
    iobType: 'number',
    min: 0,
    max: 7,
    fc: 'FC06',
};

/** Remote Control Command Timeout `0xE00B` (uint32 seconds, 0..86400). Written on enable and renewed each cycle (uint32le, FC16). (Req 4.4) */
export const REMOTE_CONTROL_COMMAND_TIMEOUT: ControlRegisterDef = {
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

/** Remote Control Command Mode `0xE00D` (uint16, 0..7). Selects the remote control command mode. (Req 4.4) */
export const REMOTE_CONTROL_COMMAND_MODE: ControlRegisterDef = {
    name: 'remoteControlCommandMode',
    address: 0xe00d,
    kind: 'uint16',
    length: 1,
    iobType: 'number',
    min: 0,
    max: 7,
    fc: 'FC06',
};

/** Remote Control Charge Limit `0xE00E` (float32 watts, 2 registers). Expert-only, optional. (Req 4.5) */
export const REMOTE_CONTROL_CHARGE_LIMIT: ControlRegisterDef = {
    name: 'remoteControlChargeLimit',
    address: 0xe00e,
    kind: 'float32',
    length: 2,
    wordOrder: 'le',
    iobType: 'number',
    unit: 'W',
    min: 0,
    max: Number.MAX_VALUE,
    fc: 'FC16',
};

/** Remote Control Discharge Limit `0xE010` (float32 watts, 2 registers). The consumption-driven target. (Req 4.6) */
export const REMOTE_CONTROL_DISCHARGE_LIMIT: ControlRegisterDef = {
    name: 'remoteControlDischargeLimit',
    address: 0xe010,
    kind: 'float32',
    length: 2,
    wordOrder: 'le',
    iobType: 'number',
    unit: 'W',
    min: 0,
    max: Number.MAX_VALUE,
    fc: 'FC16',
};

/**
 * All StorEdge control-register definitions. Kept separate from the SunSpec read
 * map — never polled and never in the SunSpec value table (Req 4.7).
 */
export const CONTROL_REGISTERS: readonly ControlRegisterDef[] = [
    EXPORT_CONFIG,
    STORAGE_CONTROL_MODE,
    STORAGE_DEFAULT_MODE,
    REMOTE_CONTROL_COMMAND_TIMEOUT,
    REMOTE_CONTROL_COMMAND_MODE,
    REMOTE_CONTROL_CHARGE_LIMIT,
    REMOTE_CONTROL_DISCHARGE_LIMIT,
];

/**
 * Resolve the control def for a given control-state id leaf, or `undefined`.
 *
 * @param name
 */
export function findControlDef(name: string): ControlRegisterDef | undefined {
    return CONTROL_REGISTERS.find(def => def.name === name);
}
