// Modbus TCP client wrapper for the SolarEdge SunSpec reader with a tightly
// restricted write surface for StorEdge battery control.
//
// This is a thin wrapper over the `modbus-serial` library. It is no longer
// strictly read-only: alongside the read operations FC03 (read holding
// registers) and FC04 (read input registers), it exposes EXACTLY two write
// function codes — FC06 (write single register) and FC16 (write multiple
// registers). No coil write (FC05/FC15) or any other write function code is
// ever exposed or issued. This write surface is always available (there is no
// "control enabled" configuration gating it); the adapter targets these writes
// only at the nine StorEdgeControlBlock registers 0xE004, 0xE005, 0xE006,
// 0xE008, 0xE00A, 0xE00B, 0xE00D, 0xE00E, and 0xE010.
//
// Each network operation is bounded by a 10 second default timeout:
//  - `connect` races the TCP connect against a rejecting timeout and also passes
//    the timeout to the library and applies it via `setTimeout` for subsequent reads.
//  - `readHoldingRegisters` / `readInputRegisters` rely on the library's request
//    timeout (set via `setTimeout`) and additionally race a rejecting timeout so a
//    hung read cannot exceed the deadline.
//  - `writeSingleRegister` / `writeMultipleRegisters` apply the same timeout
//    mechanism as reads so a hung write cannot exceed the deadline.
//  - `close` resolves within 10 seconds even if the underlying close callback stalls.
//
// Validates: Requirements 2.1, 2.2, 2.5, 2.6, 2.7, 3.1, 3.2, 3.3, 3.5, 7.4, 7.6

import ModbusRTU from 'modbus-serial';

/** Default timeout in milliseconds applied to connect and read operations (Req 3.5, 7.4). */
export const DEFAULT_TIMEOUT_MS = 10000;

/** Maximum number of registers a single Modbus read request may cover (Req 3.2). */
export const MAX_REGISTERS_PER_READ = 125;

export interface ModbusReadOptions {
    /** Overall timeout for the operation in ms; defaults to {@link DEFAULT_TIMEOUT_MS} (Req 3.5). */
    timeoutMs?: number;
}

export interface ModbusWriteOptions {
    /** Overall timeout for the operation in ms; defaults to {@link DEFAULT_TIMEOUT_MS} (Req 2.6). */
    timeoutMs?: number;
}

/**
 * Modbus client with a restricted write surface.
 *
 * Implementations issue only FC03 (holding registers) and FC04 (input registers)
 * for reads, plus EXACTLY the FC06 (write single register) and FC16 (write
 * multiple registers) operations for writes (Req 3.1). No coil write (FC05/FC15)
 * or any other write function code is exposed (Req 3.2). This write surface is
 * always available — no configuration setting enables, disables, or alters it —
 * and the adapter targets the write operations only at the nine
 * StorEdgeControlBlock registers 0xE004, 0xE005, 0xE006, 0xE008, 0xE00A, 0xE00B,
 * 0xE00D, 0xE00E, and 0xE010 (Req 3.3).
 */
export interface IModbusClient {
    /** Open a TCP connection with a connect timeout (default 10s) (Req 7.4). */
    connect(host: string, port: number, unitId: number, timeoutMs?: number): Promise<void>;
    /** FC03 read; max 125 registers enforced (Req 3.2). */
    readHoldingRegisters(address: number, length: number, opts?: ModbusReadOptions): Promise<number[]>;
    /** FC04 read; max 125 registers enforced (Req 3.2). */
    readInputRegisters(address: number, length: number, opts?: ModbusReadOptions): Promise<number[]>;
    /** FC06 — write one uint16 value to a holding register. Rejects when not connected (Req 2.1, 2.5). */
    writeSingleRegister(address: number, value: number, opts?: ModbusWriteOptions): Promise<void>;
    /** FC16 — write a uint16 word array to consecutive holding registers. Rejects when not connected (Req 2.2, 2.5). */
    writeMultipleRegisters(address: number, values: number[], opts?: ModbusWriteOptions): Promise<void>;
    /** Whether a socket is currently open. */
    isConnected(): boolean;
    /** Close the socket; resolves within 10s and is a no-op when not connected (Req 7.6). */
    close(): Promise<void>;
}

/**
 * Reject with the given error after `ms` milliseconds. The returned object carries
 * the timer handle so it can be cleared once the raced operation settles, preventing
 * a dangling timer from keeping the process alive.
 *
 * @param ms
 * @param message
 */
function rejectAfter(ms: number, message: string): { promise: Promise<never>; cancel: () => void } {
    let handle: ReturnType<typeof setTimeout>;
    const promise = new Promise<never>((_resolve, reject) => {
        handle = setTimeout(() => reject(new Error(message)), ms);
    });
    return { promise, cancel: () => clearTimeout(handle) };
}

/**
 * Modbus TCP client backed by `modbus-serial`.
 *
 * Holds a single `ModbusRTU` instance internally. Reads use FC03/FC04; writes use
 * EXACTLY FC06 (single register) and FC16 (multiple registers). No coil write
 * (FC05/FC15) or any other write function code is issued (Req 3.1, 3.2).
 */
export class ModbusClient implements IModbusClient {
    private readonly client: ModbusRTU;
    /** Our own connected flag, combined with the library's `isOpen` in {@link isConnected}. */
    private connected = false;

    constructor() {
        this.client = new ModbusRTU();
    }

    /**
     * Open a TCP connection to the inverter and select the Modbus unit id.
     *
     * The connect attempt is bounded by `timeoutMs` (default 10s, Req 7.4): the
     * library connect timeout is set via the TCP options and the whole attempt is
     * additionally raced against a rejecting timeout. The same timeout is applied
     * via `setTimeout` so subsequent read requests inherit the deadline (Req 3.5).
     *
     * @param host
     * @param port
     * @param unitId
     * @param timeoutMs
     */
    async connect(host: string, port: number, unitId: number, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<void> {
        const timeout = rejectAfter(timeoutMs, `Modbus connect to ${host}:${port} timed out after ${timeoutMs} ms`);
        try {
            await Promise.race([this.client.connectTCP(host, { port, timeout: timeoutMs }), timeout.promise]);
            this.client.setID(unitId);
            this.client.setTimeout(timeoutMs);
            this.connected = true;
        } catch (err) {
            this.connected = false;
            // Best-effort cleanup of a partially-opened socket; ignore close errors.
            try {
                await this.close();
            } catch {
                /* ignore */
            }
            throw new Error(`Failed to connect to ${host}:${port} (unit ${unitId}): ${describeError(err)}`);
        } finally {
            timeout.cancel();
        }
    }

    /**
     * FC03 — read holding registers.
     *
     * @param address
     * @param length
     * @param opts
     */
    async readHoldingRegisters(address: number, length: number, opts?: ModbusReadOptions): Promise<number[]> {
        return this.read('readHoldingRegisters', address, length, opts);
    }

    /**
     * FC04 — read input registers.
     *
     * @param address
     * @param length
     * @param opts
     */
    async readInputRegisters(address: number, length: number, opts?: ModbusReadOptions): Promise<number[]> {
        return this.read('readInputRegisters', address, length, opts);
    }

    /**
     * FC06 — write a single uint16 value to a holding register (Req 2.1). The value
     * must be an integer in `[0, 0xFFFF]`. Rejects when not connected (Req 2.5).
     *
     * @param address
     * @param value
     * @param opts
     */
    async writeSingleRegister(address: number, value: number, opts?: ModbusWriteOptions): Promise<void> {
        if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
            throw new Error(`Invalid register value ${value}: must be an integer in [0, 65535]`);
        }
        await this.write('writeRegister', address, value, opts);
    }

    /**
     * FC16 — write a uint16 word array to consecutive holding registers (Req 2.2).
     * The array must be non-empty and every word an integer in `[0, 0xFFFF]`.
     * Rejects when not connected (Req 2.5).
     *
     * @param address
     * @param values
     * @param opts
     */
    async writeMultipleRegisters(address: number, values: number[], opts?: ModbusWriteOptions): Promise<void> {
        if (!Array.isArray(values) || values.length < 1) {
            throw new Error('Invalid register values: must be a non-empty word array');
        }
        for (const word of values) {
            if (!Number.isInteger(word) || word < 0 || word > 0xffff) {
                throw new Error(`Invalid register word ${word}: must be an integer in [0, 65535]`);
            }
        }
        await this.write('writeRegisters', address, values, opts);
    }

    isConnected(): boolean {
        return this.connected && this.client.isOpen;
    }

    /**
     * Close the socket. Safe to call when not connected (no-op). Resolves within
     * `DEFAULT_TIMEOUT_MS` even if the underlying close callback never fires (Req 7.6).
     */
    async close(): Promise<void> {
        this.connected = false;
        if (!this.client.isOpen) {
            return;
        }
        await new Promise<void>(resolve => {
            const handle = setTimeout(resolve, DEFAULT_TIMEOUT_MS);
            try {
                this.client.close(() => {
                    clearTimeout(handle);
                    resolve();
                });
            } catch {
                clearTimeout(handle);
                resolve();
            }
        });
    }

    /**
     * Shared implementation for the two read function codes. Guards the register
     * count (Req 3.2), enforces the per-request timeout (Req 3.5), requires an open
     * connection, and returns the numeric register data. Rejects with a descriptive
     * Error rather than throwing synchronously.
     *
     * @param fn
     * @param address
     * @param length
     * @param opts
     */
    private async read(
        fn: 'readHoldingRegisters' | 'readInputRegisters',
        address: number,
        length: number,
        opts?: ModbusReadOptions,
    ): Promise<number[]> {
        const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

        if (!Number.isInteger(length) || length < 1) {
            throw new Error(`Invalid register length ${length}: must be a positive integer`);
        }
        if (length > MAX_REGISTERS_PER_READ) {
            throw new Error(`Cannot read ${length} registers in one request: maximum is ${MAX_REGISTERS_PER_READ}`);
        }
        if (!this.isConnected()) {
            throw new Error('Modbus client is not connected');
        }

        // Apply the per-request timeout to the underlying client, then race against a
        // rejecting timeout so a hung read cannot exceed the deadline (Req 3.5).
        this.client.setTimeout(timeoutMs);
        const timeout = rejectAfter(timeoutMs, `Modbus ${fn} at ${address}+${length} timed out after ${timeoutMs} ms`);
        try {
            const result = await Promise.race([this.client[fn](address, length), timeout.promise]);
            return result.data;
        } catch (err) {
            throw new Error(`Modbus ${fn} at address ${address} (length ${length}) failed: ${describeError(err)}`);
        } finally {
            timeout.cancel();
        }
    }

    /**
     * Shared implementation for the two write function codes. Mirrors {@link read}:
     * requires an open connection (rejecting before any library call is issued,
     * Req 2.5), applies the per-request timeout (Req 2.6), and races the library
     * call against a rejecting timeout so a hung write cannot exceed the deadline.
     * Rejects with a descriptive Error rather than throwing synchronously.
     *
     * @param fn
     * @param address
     * @param payload
     * @param opts
     */
    private async write(
        fn: 'writeRegister' | 'writeRegisters',
        address: number,
        payload: number | number[],
        opts?: ModbusWriteOptions,
    ): Promise<void> {
        const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

        if (!this.isConnected()) {
            throw new Error('Modbus client is not connected');
        }

        // Apply the per-request timeout to the underlying client, then race against a
        // rejecting timeout so a hung write cannot exceed the deadline (Req 2.6).
        this.client.setTimeout(timeoutMs);
        const timeout = rejectAfter(timeoutMs, `Modbus ${fn} at ${address} timed out after ${timeoutMs} ms`);
        try {
            const call =
                fn === 'writeRegister'
                    ? this.client.writeRegister(address, payload as number)
                    : this.client.writeRegisters(address, payload as number[]);
            await Promise.race([call, timeout.promise]);
        } catch (err) {
            throw new Error(`Modbus ${fn} at address ${address} failed: ${describeError(err)}`);
        } finally {
            timeout.cancel();
        }
    }
}

/**
 * Extract a readable message from an unknown thrown value.
 *
 * @param err
 */
function describeError(err: unknown): string {
    if (err instanceof Error) {
        return err.message;
    }
    return String(err);
}
