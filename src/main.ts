/*
 * Created with @iobroker/create-adapter v3.1.5
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
import * as utils from '@iobroker/adapter-core';

import { validateConfig } from './lib/config-validation';
import { DEFAULT_TIMEOUT_MS, ModbusClient } from './lib/modbus-client';
import { StateManager, type ChannelPath } from './lib/state-manager';
import {
    STOREDGE_CONTROL_REGISTERS,
    findStorEdgeControlDef,
    type StorEdgeControlRegisterDef,
} from './lib/storedge-control-map';
import { decodeRegisters, encodeFloat32le, encodeUint32le } from './lib/sunspec-decode';
import { COMMON_BASE } from './lib/sunspec-map';
import { SunSpecReader, type Logger } from './lib/sunspec-reader';

/**
 * Number of consecutive recoverable polling failures after which the adapter logs a
 * dedicated repeated-failure error (Req 8.5).
 */
const MAX_CONSECUTIVE_FAILURES = 10;

/** Base address of the first StorEdgeControlBlock read span (0xE004..0xE00C). */
const STOREDGE_BLOCK_SPAN_A_BASE = 0xe004;
/** Base address of the second StorEdgeControlBlock read span (0xE00D..0xE011). */
const STOREDGE_BLOCK_SPAN_B_BASE = 0xe00d;

/**
 * Slice the raw words for one StorEdgeControlBlock register def out of whichever
 * of the two read spans covers its address (Req 5.1, 5.2).
 *
 * @param def - The register definition being decoded.
 * @param spanA - Words read from {@link STOREDGE_BLOCK_SPAN_A_BASE} (0xE004..0xE00C).
 * @param spanB - Words read from {@link STOREDGE_BLOCK_SPAN_B_BASE} (0xE00D..0xE011).
 */
function wordsForStorEdgeDef(
    def: StorEdgeControlRegisterDef,
    spanA: readonly number[],
    spanB: readonly number[],
): number[] {
    if (def.address >= STOREDGE_BLOCK_SPAN_B_BASE) {
        const offset = def.address - STOREDGE_BLOCK_SPAN_B_BASE;
        return spanB.slice(offset, offset + def.length);
    }
    const offset = def.address - STOREDGE_BLOCK_SPAN_A_BASE;
    return spanA.slice(offset, offset + def.length);
}

/**
 * Map a StorEdgeControlBlock register's `kind` to the `decodeRegisters`/encode
 * datatype string it uses on the wire (Req 4.1-4.5).
 *
 * @param def - The register definition being decoded.
 */
function storEdgeWireDatatype(def: StorEdgeControlRegisterDef): 'uint16' | 'float32le' | 'uint32le' {
    if (def.kind === 'uint16') {
        return 'uint16';
    }
    if (def.kind === 'float32') {
        return 'float32le';
    }
    return 'uint32le';
}

/**
 * SolarEdge SunSpec reader adapter.
 *
 * Modbus TCP monitor: on start it validates the configuration and ensures the
 * `info.connection` indicator, the `inverter` channel, and the always-present
 * `StorEdgeControlBlock` channel (all nine Global StorEdge Control Block registers,
 * `read=true, write=true`) exist, then polls the inverter, every present meter (up
 * to 3) and battery (up to 2) SunSpec block, and the StorEdgeControlBlock registers
 * on the configured interval. Meter/battery channels are created on demand once a
 * slot is detected. The StorEdgeControlBlock is unconditional — there is no
 * configuration setting that gates it: it is created and subscribed on every start,
 * regardless of any admin config value. A non-acknowledged change to one of its nine
 * states is range-validated and, if valid, dispatched as a Modbus write via FC06
 * (uint16) or FC16 (float32le/uint32le) (see {@link handleStorEdgeControlChange}).
 */
class Sehybrid extends utils.Adapter {
    /** Reused Modbus client; reconnected by {@link pollOnce} after a failed cycle. */
    private modbusClient?: ModbusClient;
    /** Object/state manager for the inverter/meter channels. */
    private stateManager?: StateManager;
    /** SunSpec model detection + block decoding. */
    private reader?: SunSpecReader;
    /** Repeating poll timer handle, cleared on unload. */
    private pollTimer?: ioBroker.Interval;
    /** Count of consecutive failed polling cycles; reset to 0 on any success (Req 8.5). */
    private consecutiveFailures = 0;
    /** Overlap guard: true while a polling cycle is in flight (Req 5.5). */
    private polling = false;

    public constructor(options: Partial<utils.AdapterOptions> = {}) {
        super({
            ...options,
            name: 'sehybrid',
        });
        this.on('ready', this.onReady.bind(this));
        this.on('message', this.onMessage.bind(this));
        this.on('unload', this.onUnload.bind(this));
        // Bound so the StorEdgeControlBlock subscription (registered in onReady) has
        // a handler.
        this.on('stateChange', this.onStateChange.bind(this));
    }

    /**
     * Called when databases are connected and the adapter received its configuration.
     *
     * Sets the connection indicator to false, validates the config (guarding on a
     * missing host, Req 8.4), constructs the Modbus client / reader / state manager,
     * ensures the `inverter` channel and the always-present `StorEdgeControlBlock`
     * channel (unconditionally, on every start — no config setting gates it), then
     * runs the first poll and schedules the repeating timer (Req 5.4, 7.1, 8.1, 8.3).
     */
    private async onReady(): Promise<void> {
        // Ensure the connection indicator object exists (it is declared in
        // instanceObjects, but be defensive), then set it false before the first read (Req 7.1).
        await this.setObjectNotExistsAsync('info.connection', {
            type: 'state',
            common: {
                name: 'Device or service connected',
                type: 'boolean',
                role: 'indicator.connected',
                read: true,
                write: false,
                def: false,
            },
            native: {},
        });
        await this.setStateAsync('info.connection', false, true);

        // Validate the persisted configuration.
        const result = validateConfig(this.config);
        if (!result.valid) {
            // A missing/empty host is a hard configuration error: do not start polling (Req 8.4).
            if (result.errors.host) {
                this.log.error(
                    `Invalid host configuration: ${result.errors.host}. Set the inverter host in the adapter settings. Polling will not start.`,
                );
                await this.setStateAsync('info.connection', false, true);
                return;
            }
            // Any other invalid field: log and do not start polling either.
            const messages = Object.entries(result.errors)
                .map(([field, msg]) => `${field}: ${msg}`)
                .join('; ');
            this.log.error(`Invalid configuration, polling will not start: ${messages}`);
            await this.setStateAsync('info.connection', false, true);
            return;
        }

        // Build the runtime collaborators.
        const logger: Logger = {
            warn: (msg: string) => this.log.warn(msg),
            debug: (msg: string) => this.log.debug(msg),
        };
        this.reader = new SunSpecReader(logger);
        this.stateManager = new StateManager(this);
        this.modbusClient = new ModbusClient();

        // Ensure the fixed inverter channel up front (idempotent) (Req 6.9). Meter and
        // battery channels are created on demand per detected device during a cycle,
        // since which slots exist is only known after probing the device (Req 9.3, 10.5).
        await this.stateManager.ensureChannel('inverter');

        // Unconditional, every start: create the StorEdgeControlBlock channel and its
        // nine states, then subscribe to state changes on it. No config setting gates
        // this — it is always created and always writable (Req 8.1, 8.2, 8.3).
        await this.stateManager.ensureStorEdgeControlBlock();
        this.subscribeStates('StorEdgeControlBlock.*');

        this.log.info(
            `Starting SunSpec polling of ${this.config.host}:${this.config.port} (unit ${this.config.unitId}) every ${this.config.pollInterval}s`,
        );

        // Run one cycle immediately (Req 5.4).
        await this.pollOnce();

        // Schedule the repeating poll timer (Req 5.4).
        this.pollTimer = this.setInterval(() => {
            void this.pollOnce();
        }, this.config.pollInterval * 1000);
    }

    /**
     * Handle a subscribed state change under `StorEdgeControlBlock.*`. Guards drop
     * deletions and adapter-originated acks up front; the write dispatch is
     * delegated to {@link handleStorEdgeControlChange} so Modbus failures stay
     * contained (they are logged and non-fatal, never thrown out of the event
     * handler) (Req 7.1, 7.2).
     *
     * @param id - The changed state id.
     * @param state - New state, or null/undefined on deletion.
     */
    private onStateChange(id: string, state: ioBroker.State | null | undefined): void {
        // Deletion — ignore.
        if (!state) {
            return;
        }
        // Adapter-originated acknowledged write (poll-read or write-ack) — ignore to
        // prevent write loops.
        if (state.ack) {
            return;
        }
        // Delegate the async dispatch; errors are handled inside the helper.
        void this.handleStorEdgeControlChange(id, state);
    }

    /**
     * Dispatch a non-acked, non-deletion change to a `StorEdgeControlBlock.<leaf>`
     * state.
     *
     * Resolves the leaf to its register def via {@link findStorEdgeControlDef};
     * ids outside the `StorEdgeControlBlock.` namespace or unknown leaves are
     * ignored. The candidate value is coerced to a number and range-validated
     * against `def.min`/`def.max`: an invalid value is logged and rejected — no
     * write, no ack, the previous value is retained. A valid value is dispatched as
     * a Modbus write via FC06 (uint16) or FC16 (float32le/uint32le), every time —
     * there is no write-only-if-changed suppression (Req 6.1-6.4, 7.1-7.5). On
     * success the value is acknowledged; on failure the error is logged and
     * non-fatal, and the previous acked value is retained.
     *
     * @param id - The changed state id (instance-namespaced).
     * @param state - The new, non-acked state.
     */
    private async handleStorEdgeControlChange(id: string, state: ioBroker.State): Promise<void> {
        const prefix = `${this.namespace}.StorEdgeControlBlock.`;
        if (!id.startsWith(prefix)) {
            return;
        }
        const leaf = id.slice(prefix.length);
        const def = findStorEdgeControlDef(leaf);
        if (!def) {
            return;
        }

        const value = Number(state.val);
        if (!Number.isFinite(value) || value < def.min || value > def.max) {
            this.log.error(
                `Rejected write to ${leaf} (0x${def.address.toString(16).toUpperCase()}): ${state.val} is outside the documented range [${def.min}, ${def.max}]`,
            );
            return;
        }

        try {
            if (def.kind === 'uint16') {
                await this.modbusClient!.writeSingleRegister(def.address, value);
            } else if (def.kind === 'float32') {
                await this.modbusClient!.writeMultipleRegisters(def.address, encodeFloat32le(value));
            } else {
                await this.modbusClient!.writeMultipleRegisters(def.address, encodeUint32le(value));
            }
            await this.stateManager!.ackStorEdgeWrite(def, value);
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            this.log.error(
                `Failed to write ${leaf} (0x${def.address.toString(16).toUpperCase()}) = ${value}: ${reason}. Retaining the previously acknowledged value.`,
            );
        }
    }

    /**
     * Run one polling cycle: (re)connect if needed, detect + read the inverter block,
     * then every present meter (up to 3) and battery (up to 2) slot, and write
     * acknowledged values. Sets `info.connection` true on a successful cycle and false on
     * any thrown error, retaining the last values on failure. `info.connection` reflects
     * the inverter read succeeding; the absence of a meter/battery slot is not a failure
     * (Req 3.3, 3.4, 5.4, 5.6, 6.8, 7.2, 7.3, 7.5, 8.2, 8.3, 8.5, 9.3, 9.4, 10.5, 10.9).
     */
    private async pollOnce(): Promise<void> {
        // Overlap guard: if the previous cycle is still running, skip this tick (Req 5.5).
        if (this.polling) {
            this.log.debug('Previous polling cycle still running; skipping this tick');
            return;
        }
        if (!this.modbusClient || !this.reader || !this.stateManager) {
            // Should not happen once onReady succeeded, but stay defensive.
            return;
        }
        this.polling = true;

        const client = this.modbusClient;
        const reader = this.reader;
        const stateManager = this.stateManager;

        try {
            // Ensure a live connection; reconnect after a prior failure (Req 7.4).
            if (!client.isConnected()) {
                this.log.debug(`Connecting to ${this.config.host}:${this.config.port} (unit ${this.config.unitId})`);
                await client.connect(this.config.host, this.config.port, this.config.unitId, DEFAULT_TIMEOUT_MS);
            }

            // --- Inverter block (Req 3.3) -------------------------------------------
            const inverterModel = await reader.detectInverterModel(client);
            if (inverterModel === null) {
                // A missing inverter block is a recoverable anomaly; the reader already
                // logged a warning (Req 3.9). Nothing to write this cycle.
                this.log.warn('No inverter SunSpec block detected this cycle; retaining previous values');
            } else {
                const inverterValues = await reader.readInverter(client, inverterModel);
                for (const { def, value } of inverterValues) {
                    // writeValue is a no-op for null values (NOT_IMPLEMENTED/skipped) (Req 3.8, 6.8).
                    await stateManager.writeValue('inverter', def, value);
                }
                this.log.debug(`Wrote ${inverterValues.length} inverter value(s) (model ${inverterModel})`);
            }

            // --- Meter blocks (Req 9.3, 9.4) ----------------------------------------
            // Probe meter slots 1..3; a system may legitimately have no meter, so an
            // absent slot is simply skipped and never fails the cycle. Channels are
            // created on demand for each detected slot.
            const meters = await reader.detectMeters(client);
            for (const meter of meters) {
                const channel = `meter.${meter.index}` as ChannelPath;
                await stateManager.ensureChannel(channel);
                const values = await reader.readMeterSlot(client, meter);
                for (const { def, value } of values) {
                    await stateManager.writeValue(channel, def, value);
                }
                this.log.debug(`Wrote ${values.length} value(s) for meter.${meter.index} (model ${meter.model})`);
            }
            if (meters.length === 0) {
                this.log.debug('No meters detected this cycle');
            }

            // --- Battery blocks (Req 10.5, 10.9) ------------------------------------
            // Probe battery slots 1..2; an absent slot is skipped and never fails the
            // cycle. Channels are created on demand for each detected slot.
            const batteries = await reader.detectBatteries(client);
            for (const battery of batteries) {
                const channel = `battery.${battery.index}` as ChannelPath;
                await stateManager.ensureChannel(channel);
                const values = await reader.readBatterySlot(client, battery);
                for (const { def, value } of values) {
                    await stateManager.writeValue(channel, def, value);
                }
                this.log.debug(`Wrote ${values.length} value(s) for battery.${battery.index}`);
            }
            if (batteries.length === 0) {
                this.log.debug('No batteries detected this cycle');
            }

            // --- StorEdgeControlBlock read (Req 5.1-5.4) ----------------------------
            // Minimal round-trips: the nine registers span two contiguous windows —
            // 0xE004..0xE00C (9 words: Storage_Control_Mode, Storage_AC_Charge_Policy,
            // Storage_AC_Charge_Limit [2w], Storage_Backup_Reserved_Setting [2w],
            // Storage_Charge_Discharge_Default_Mode, Remote_Control_Command_Timeout
            // [2w]) and 0xE00D..0xE011 (5 words: Remote_Control_Command_Mode,
            // Remote_Control_Charge_Limit [2w], Remote_Control_Discharge_Limit [2w]).
            // There is no gap within either span, but a register-map discontinuity
            // between the two windows is not assumed, so they are read as two
            // requests rather than one — mirroring the existing segmented-read
            // pattern used for the battery block elsewhere in this adapter. A read
            // failure here propagates out of this try and is handled by the existing
            // catch block below, exactly like an inverter/meter/battery read failure
            // (no special-casing) (Req 5.4).
            const blockWordsA = await client.readHoldingRegisters(0xe004, 9); // 0xE004..0xE00C
            const blockWordsB = await client.readHoldingRegisters(0xe00d, 5); // 0xE00D..0xE011
            for (const def of STOREDGE_CONTROL_REGISTERS) {
                const words = wordsForStorEdgeDef(def, blockWordsA, blockWordsB);
                const value = decodeRegisters(words, storEdgeWireDatatype(def));
                if (value !== null) {
                    await stateManager.writeStorEdgeValue(def, value as number);
                }
            }

            // Cycle completed without throwing: connection is up (Req 7.2, 7.5).
            await this.setStateAsync('info.connection', true, true);
            if (this.consecutiveFailures > 0) {
                this.log.info('Connection to inverter restored');
            }
            this.consecutiveFailures = 0;
        } catch (error) {
            // Any connect/read failure or timeout: mark disconnected, retain last values,
            // and reconnect next cycle (Req 5.6, 7.3, 7.4). Do NOT stop the timer.
            const reason = error instanceof Error ? error.message : String(error);
            this.consecutiveFailures++;
            await this.setStateAsync('info.connection', false, true);
            this.log.error(`Polling cycle failed: ${reason}`);

            // Close the socket so the next cycle performs a fresh connect (Req 7.4).
            try {
                await client.close();
            } catch {
                /* best-effort: ignore close errors */
            }

            // Escalate on repeated failures but keep scheduling (Req 8.5).
            if (this.consecutiveFailures === MAX_CONSECUTIVE_FAILURES) {
                this.log.error(
                    `${MAX_CONSECUTIVE_FAILURES} consecutive polling cycles failed; the inverter appears unreachable. Continuing to retry every ${this.config.pollInterval}s.`,
                );
            }
        } finally {
            this.polling = false;
        }
    }

    /**
     * Handle admin message-box requests. Currently supports `testConnection`, which
     * validates the supplied endpoint and probes the SunSpec identity block without
     * touching the running poll connection (Req 2.2, 2.3, 2.4, 2.5).
     *
     * @param obj - Incoming message; a reply is only sent when `obj.callback` is set.
     */
    private onMessage(obj: ioBroker.Message): void {
        if (typeof obj !== 'object' || !obj.message) {
            return;
        }
        if (obj.command === 'testConnection') {
            void this.handleTestConnection(obj);
        }
    }

    /**
     * Validate the endpoint from the message and probe the SunSpec Common block.
     *
     * Validation failures reply `validationError` within 1 s without opening a socket
     * (Req 2.4). Otherwise a temporary Modbus client connects within 10 s, reads the
     * identity block, and the socket is always closed afterwards (Req 2.2, 2.3, 2.5).
     *
     * @param obj - The `testConnection` message; a reply is sent when `obj.callback` is set.
     */
    private async handleTestConnection(obj: ioBroker.Message): Promise<void> {
        const reply = (response: Record<string, unknown>): void => {
            if (obj.callback) {
                this.sendTo(obj.from, obj.command, response, obj.callback);
            }
        };

        const msg = (obj.message ?? {}) as { host?: unknown; port?: unknown; unitId?: unknown };
        const host = typeof msg.host === 'string' ? msg.host : '';
        const port = typeof msg.port === 'number' ? msg.port : Number(msg.port);
        const unitId = typeof msg.unitId === 'number' ? msg.unitId : Number(msg.unitId);

        // Validate host/port/unitId only; supply a valid pollInterval so it never
        // blocks the connection test (pollInterval is irrelevant here) (Req 2.4).
        const result = validateConfig({ host, port, unitId, pollInterval: 30 });
        const relevantErrors = Object.entries(result.errors).filter(([field]) => field !== 'pollInterval');
        if (relevantErrors.length > 0) {
            const message = relevantErrors.map(([field, err]) => `${field}: ${err}`).join('; ');
            reply({ result: 'validationError', message });
            return;
        }

        const client = new ModbusClient();
        try {
            await client.connect(host, port, unitId, DEFAULT_TIMEOUT_MS);

            // Read the SunSpec identifier ("SunS") plus manufacturer/model identity.
            const idWords = await client.readHoldingRegisters(COMMON_BASE, 2);
            const sunsId = decodeRegisters(idWords, 'uint32');
            // 0x53756e53 == "SunS": the SunSpec well-known marker.
            if (sunsId !== 0x53756e53) {
                reply({
                    result: 'failure',
                    message: `Device at ${host}:${port} did not return a SunSpec identifier`,
                });
                return;
            }

            const manuWords = await client.readHoldingRegisters(COMMON_BASE + 4, 16);
            const modelWords = await client.readHoldingRegisters(COMMON_BASE + 20, 16);
            const manufacturer = decodeRegisters(manuWords, 'string');
            const model = decodeRegisters(modelWords, 'string');

            reply({
                result: 'success',
                manufacturer: typeof manufacturer === 'string' ? manufacturer : '',
                model: typeof model === 'string' ? model : '',
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            reply({ result: 'failure', message });
        } finally {
            // Always release the temporary socket (Req 2.5).
            try {
                await client.close();
            } catch {
                /* best-effort: ignore close errors */
            }
        }
    }

    /**
     * Called when the adapter shuts down. Clears the poll timer and closes any open
     * Modbus socket within 10 s, then invokes the callback under all circumstances (Req 7.6).
     *
     * @param callback - Callback that must be invoked to complete unloading.
     */
    private onUnload(callback: () => void): void {
        // NOTE: no control write on unload — revert to the default storage control
        // mode happens ONLY on the disable (OFF) transition via disableControl(),
        // never here (Req 12.5). Unload just clears the timer and closes the socket.
        try {
            if (this.pollTimer) {
                this.clearInterval(this.pollTimer);
                this.pollTimer = undefined;
            }
            const client = this.modbusClient;
            if (!client) {
                callback();
                return;
            }
            // Close the socket (resolves within 10 s per the client contract, Req 7.6),
            // then always invoke the callback.
            void client
                .close()
                .catch(() => {
                    /* best-effort: ignore close errors during unload */
                })
                .finally(() => callback());
        } catch (error) {
            this.log.error(`Error during unloading: ${(error as Error).message}`);
            callback();
        }
    }
}

if (require.main !== module) {
    // Export the constructor in compact mode
    module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new Sehybrid(options);
} else {
    // otherwise start the instance directly
    (() => new Sehybrid())();
}
