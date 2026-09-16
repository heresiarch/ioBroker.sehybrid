// Control writer — the StorEdge battery-control dispatch layer.
//
// A thin dispatcher that maps a control-register write to the correct Modbus
// function code and on-the-wire encoding, extracted so dispatch/encoding are
// unit-testable without a live socket (via a mock IModbusClient). It centralizes
// FC selection: `uint16` control registers use FC06 (write single register) and
// `float32` (little-endian word order) registers use FC16 (write multiple
// registers) with `encodeFloat32le`. It never writes the read-only defs (0xE00A
// storage default mode, 0xE00B remote-control command timeout) — those carry no
// `fc` and are refused defensively.
//
// The three orchestration helpers implement the control lifecycle:
//  - `applyEnable` runs the enable sequence (0xE004=4, 0xE00D=4, 0xE010=limit).
//  - `applyRevert` restores 0xE004 to the configured default storage control mode.
//  - `heartbeat` re-asserts the command modes every cycle and refreshes the
//    discharge limit only when it changed (write-only-if-changed).
//
// Validates: Requirements 2.3, 2.4, 5.4, 8.1, 8.2, 8.3, 9.1, 9.2, 9.3, 10.1, 11.1, 11.2, 11.3, 12.1, 12.4

import type { ControlRegisterDef } from './control-registers';
import { REMOTE_CONTROL_COMMAND_MODE, REMOTE_CONTROL_DISCHARGE_LIMIT, STORAGE_CONTROL_MODE } from './control-registers';
import type { IModbusClient } from './modbus-client';
import { encodeFloat32le } from './sunspec-decode';

/** The command-mode value that selects remote control on 0xE004 and 0xE00D (Req 9). */
const REMOTE_CONTROL_MODE = 4;

/**
 * Dispatches control-register writes to the correct Modbus call/encoding and
 * orchestrates the enable/revert/heartbeat lifecycle (Req 8–12).
 */
export interface ControlWriter {
    /** Write one control register by its def: FC06 for uint16, FC16 + encodeFloat32le for float32. */
    write(def: ControlRegisterDef, value: number): Promise<void>;
    /** Enable sequence: 0xE004=4 (FC06), 0xE00D=4 (FC06), 0xE010=limit (FC16). (Req 9) */
    applyEnable(computedLimit: number): Promise<void>;
    /** Disable/revert: 0xE004 = defaultStorageControlMode (FC06). (Req 12.1) */
    applyRevert(defaultStorageControlMode: number): Promise<void>;
    /** Heartbeat: 0xE004=4 (FC06) + 0xE00D=4 (FC06) unconditional; 0xE010 only if changed. (Req 11) */
    heartbeat(computedLimit: number, lastWritten: number | undefined): Promise<number | undefined>;
}

/**
 * Concrete {@link ControlWriter} backed by an injected {@link IModbusClient}.
 *
 * All encoding/FC selection lives in {@link write}; the lifecycle helpers route
 * through it (using the exported writable defs) so the mapping stays centralized
 * and independently testable with a mock client.
 */
export class ModbusControlWriter implements ControlWriter {
    private readonly client: IModbusClient;

    /**
     * @param client Modbus client whose restricted write surface (FC06/FC16) this
     *   writer dispatches to. Injected so the writer is testable with a mock.
     */
    constructor(client: IModbusClient) {
        this.client = client;
    }

    /**
     * Write one control register selected by its def.
     *
     * Refuses any def that is `readOnly` or carries no `fc` (the never-written
     * 0xE00A storage default mode and 0xE00B command timeout) with a descriptive
     * error (Req 12.4). Encoding is chosen by `def.kind`: `uint16` → FC06
     * `writeSingleRegister`; `float32` with `wordOrder === 'le'` → FC16
     * `writeMultipleRegisters` with `encodeFloat32le` (Req 2.3, 2.4, 5.4).
     *
     * @param def Control-register definition describing address, kind and FC.
     * @param value Engineering value to encode and write.
     */
    async write(def: ControlRegisterDef, value: number): Promise<void> {
        if (def.readOnly || !def.fc) {
            throw new Error(
                `Refusing to write read-only control register ${def.name} at 0x${def.address.toString(16).toUpperCase()}`,
            );
        }

        switch (def.kind) {
            case 'uint16':
                // FC06 — single holding register (Req 2.3).
                await this.client.writeSingleRegister(def.address, value);
                return;
            case 'float32':
                if (def.wordOrder !== 'le') {
                    throw new Error(
                        `Unsupported word order '${String(def.wordOrder)}' for float32 control register ${def.name}`,
                    );
                }
                // FC16 — two holding registers, little-endian word order (Req 2.4, 5.4).
                await this.client.writeMultipleRegisters(def.address, encodeFloat32le(value));
                return;
            default:
                // uint32 (0xE00B) is never written; readOnly refusal above covers it.
                throw new Error(`Unsupported control-register kind '${def.kind}' for ${def.name}`);
        }
    }

    /**
     * Run the enable sequence in order: 0xE004=4 (FC06), 0xE00D=4 (FC06),
     * 0xE010=computedLimit (FC16) (Req 9.1, 9.2, 9.3).
     *
     * @param computedLimit Initial discharge limit in watts to write to 0xE010.
     */
    async applyEnable(computedLimit: number): Promise<void> {
        await this.write(STORAGE_CONTROL_MODE, REMOTE_CONTROL_MODE);
        await this.write(REMOTE_CONTROL_COMMAND_MODE, REMOTE_CONTROL_MODE);
        await this.write(REMOTE_CONTROL_DISCHARGE_LIMIT, computedLimit);
    }

    /**
     * Revert on disable: restore 0xE004 to the configured default storage control
     * mode via FC06 (Req 12.1).
     *
     * @param defaultStorageControlMode Storage control mode to restore (0..4).
     */
    async applyRevert(defaultStorageControlMode: number): Promise<void> {
        await this.write(STORAGE_CONTROL_MODE, defaultStorageControlMode);
    }

    /**
     * Heartbeat cycle: re-assert the command modes 0xE004=4 and 0xE00D=4
     * UNCONDITIONALLY every call (Req 11.1, 11.2), then refresh 0xE010 only when
     * `computedLimit` differs from `lastWritten` (write-only-if-changed, Req 8.2,
     * 11.3).
     *
     * @param computedLimit Current discharge limit in watts.
     * @param lastWritten The last value written to 0xE010, or `undefined` if none.
     * @returns The new last-written value: `computedLimit` when the limit was
     *   written, otherwise `lastWritten` unchanged.
     */
    async heartbeat(computedLimit: number, lastWritten: number | undefined): Promise<number | undefined> {
        await this.write(STORAGE_CONTROL_MODE, REMOTE_CONTROL_MODE);
        await this.write(REMOTE_CONTROL_COMMAND_MODE, REMOTE_CONTROL_MODE);

        if (computedLimit !== lastWritten) {
            await this.write(REMOTE_CONTROL_DISCHARGE_LIMIT, computedLimit);
            return computedLimit;
        }
        return lastWritten;
    }
}
