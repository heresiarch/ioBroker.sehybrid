// Control writer — the StorEdge battery-control dispatch layer.
//
// A thin dispatcher that maps a control-register write to the correct Modbus
// function code and on-the-wire encoding, extracted so dispatch/encoding are
// unit-testable without a live socket (via a mock IModbusClient). It centralizes
// FC selection: `uint16` control registers use FC06 (write single register);
// `float32` (little-endian word order) registers use FC16 (write multiple
// registers) with `encodeFloat32le`; and `uint32` (little-endian word order)
// registers use FC16 with `encodeUint32le` (the command timeout 0xE00B). It
// refuses any def that carries no `fc` with a descriptive error.
//
// The three orchestration helpers implement the control lifecycle:
//  - `applyEnable` runs SolarEdge's documented initial-config sequence IN ORDER:
//    0xE000=0, 0xE004=4, 0xE00A=defaultFallbackMode, 0xE00D=4,
//    0xE00B=commandTimeout (uint32le, FC16), 0xE010=computedLimit (float32le, FC16).
//  - `applyRevert` restores 0xE004 to the configured default storage control mode.
//  - `heartbeat` renews the command timeout 0xE00B (unconditionally) and re-asserts
//    the command mode 0xE00D=4 (unconditionally) every cycle, and refreshes the
//    discharge limit 0xE010 only when it changed (write-only-if-changed). It never
//    writes 0xE000, 0xE004, or 0xE00A.
//
// Validates: Requirements 2.3, 2.4, 2.5, 5.4, 8.1, 8.2, 8.3, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 10.1, 10.2, 11.1, 11.2, 11.3, 11.4, 12.1, 12.4, 12.5

import type { ControlRegisterDef } from './control-registers';
import {
    EXPORT_CONFIG,
    REMOTE_CONTROL_COMMAND_MODE,
    REMOTE_CONTROL_COMMAND_TIMEOUT,
    REMOTE_CONTROL_DISCHARGE_LIMIT,
    STORAGE_CONTROL_MODE,
    STORAGE_DEFAULT_MODE,
} from './control-registers';
import type { IModbusClient } from './modbus-client';
import { encodeFloat32le, encodeUint32le } from './sunspec-decode';

/** The command-mode value that selects remote control on 0xE004 and 0xE00D (Req 9). */
const REMOTE_CONTROL_MODE = 4;

/**
 * Options for the initial-config enable sequence.
 *
 * Carries the two configured values that `applyEnable` writes once on enable:
 * the fallback default mode (0xE00A) and the command-timeout keep-alive (0xE00B).
 */
export interface EnableOptions {
    /** Value written once to 0xE00A — the mode the inverter reverts to if comms break (Req 9.3). */
    defaultFallbackMode: number;
    /** Value written to 0xE00B on enable and renewed each heartbeat cycle, in seconds (Req 9.5, 10.2). */
    commandTimeout: number;
}

/**
 * Dispatches control-register writes to the correct Modbus call/encoding and
 * orchestrates the enable/revert/heartbeat lifecycle (Req 8–12).
 */
export interface ControlWriter {
    /**
     * Write one control register by its def:
     *   uint16 → writeSingleRegister (FC06);
     *   float32 wordOrder 'le' → writeMultipleRegisters(address, encodeFloat32le(value)) (FC16);
     *   uint32  wordOrder 'le' → writeMultipleRegisters(address, encodeUint32le(value))  (FC16).
     * Refuses any def with no `fc`.
     */
    write(def: ControlRegisterDef, value: number): Promise<void>;
    /**
     * Initial configuration sequence, in documented order (Req 9):
     *   0xE000=0, 0xE004=4, 0xE00A=opts.defaultFallbackMode, 0xE00D=4,
     *   0xE00B=opts.commandTimeout (uint32le, FC16), 0xE010=computedLimit (float32le, FC16).
     */
    applyEnable(computedLimit: number, opts: EnableOptions): Promise<void>;
    /** Disable/revert: 0xE004 = defaultStorageControlMode (FC06). (Req 12.1) */
    applyRevert(defaultStorageControlMode: number): Promise<void>;
    /**
     * Heartbeat (Req 10.2, 11): renew 0xE00B=commandTimeout (uint32le, FC16) unconditionally,
     * write 0xE00D=4 (FC06) unconditionally, write 0xE010 only if changed. Does NOT write
     * 0xE000, 0xE004, or 0xE00A. Returns the new lastWritten for 0xE010.
     */
    heartbeat(
        computedLimit: number,
        lastWritten: number | undefined,
        commandTimeout: number,
    ): Promise<number | undefined>;
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
     * Refuses any def that carries no `fc` with a descriptive error (Req 12.4).
     * Encoding is chosen by `def.kind`: `uint16` → FC06 `writeSingleRegister`;
     * `float32` with `wordOrder === 'le'` → FC16 `writeMultipleRegisters` with
     * `encodeFloat32le`; `uint32` with `wordOrder === 'le'` → FC16
     * `writeMultipleRegisters` with `encodeUint32le` (the command timeout 0xE00B)
     * (Req 2.3, 2.4, 2.5, 5.4).
     *
     * @param def Control-register definition describing address, kind and FC.
     * @param value Engineering value to encode and write.
     */
    async write(def: ControlRegisterDef, value: number): Promise<void> {
        if (!def.fc) {
            throw new Error(
                `Refusing to write control register ${def.name} at 0x${def.address.toString(16).toUpperCase()} — no function code defined`,
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
            case 'uint32':
                if (def.wordOrder !== 'le') {
                    throw new Error(
                        `Unsupported word order '${String(def.wordOrder)}' for uint32 control register ${def.name}`,
                    );
                }
                // FC16 — two holding registers, little-endian word order (Req 2.5, 5.4).
                await this.client.writeMultipleRegisters(def.address, encodeUint32le(value));
                return;
            default:
                throw new Error(`Unsupported control-register kind '${String(def.kind)}' for ${def.name}`);
        }
    }

    /**
     * Run SolarEdge's documented initial-config sequence IN ORDER (Req 9):
     *  1. 0xE000 (export config) = 0                       (FC06, Req 9.1)
     *  2. 0xE004 (storage control mode) = 4                (FC06, Req 9.2)
     *  3. 0xE00A (storage default mode) = defaultFallbackMode (FC06, Req 9.3)
     *  4. 0xE00D (remote command mode) = 4                 (FC06, Req 9.4)
     *  5. 0xE00B (command timeout) = commandTimeout        (uint32le, FC16, Req 9.5)
     *  6. 0xE010 (discharge limit) = computedLimit         (float32le, FC16, Req 9.6)
     *
     * @param computedLimit Initial discharge limit in watts to write to 0xE010.
     * @param opts Enable options carrying the fallback default mode and command timeout.
     */
    async applyEnable(computedLimit: number, opts: EnableOptions): Promise<void> {
        await this.write(EXPORT_CONFIG, 0);
        await this.write(STORAGE_CONTROL_MODE, REMOTE_CONTROL_MODE);
        await this.write(STORAGE_DEFAULT_MODE, opts.defaultFallbackMode);
        await this.write(REMOTE_CONTROL_COMMAND_MODE, REMOTE_CONTROL_MODE);
        await this.write(REMOTE_CONTROL_COMMAND_TIMEOUT, opts.commandTimeout);
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
     * Heartbeat cycle: renew the command timeout 0xE00B=commandTimeout
     * (uint32le, FC16) UNCONDITIONALLY (Req 10.2, 11.1) and re-assert the command
     * mode 0xE00D=4 (FC06) UNCONDITIONALLY (Req 11.2), then refresh 0xE010 only
     * when `computedLimit` differs from `lastWritten` (write-only-if-changed,
     * Req 8.2, 11.3). Does NOT write 0xE000, 0xE004, or 0xE00A (Req 11.4, 12.5).
     *
     * @param computedLimit Current discharge limit in watts.
     * @param lastWritten The last value written to 0xE010, or `undefined` if none.
     * @param commandTimeout Command-timeout keep-alive to renew on 0xE00B, in seconds.
     * @returns The new last-written value: `computedLimit` when the limit was
     *   written, otherwise `lastWritten` unchanged.
     */
    async heartbeat(
        computedLimit: number,
        lastWritten: number | undefined,
        commandTimeout: number,
    ): Promise<number | undefined> {
        await this.write(REMOTE_CONTROL_COMMAND_TIMEOUT, commandTimeout);
        await this.write(REMOTE_CONTROL_COMMAND_MODE, REMOTE_CONTROL_MODE);

        if (computedLimit !== lastWritten) {
            await this.write(REMOTE_CONTROL_DISCHARGE_LIMIT, computedLimit);
            return computedLimit;
        }
        return lastWritten;
    }
}
