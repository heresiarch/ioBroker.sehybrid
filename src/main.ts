/*
 * Created with @iobroker/create-adapter v3.1.5
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
import * as utils from '@iobroker/adapter-core';

import { validateConfig } from './lib/config-validation';
import { computeDischargeLimit, type SourceSample } from './lib/consumption';
import { findControlDef, REMOTE_CONTROL_DISCHARGE_LIMIT } from './lib/control-registers';
import { ModbusControlWriter } from './lib/control-writer';
import { DEFAULT_TIMEOUT_MS, ModbusClient } from './lib/modbus-client';
import { StateManager, type ChannelPath } from './lib/state-manager';
import { decodeRegisters } from './lib/sunspec-decode';
import { COMMON_BASE } from './lib/sunspec-map';
import { SunSpecReader, type Logger } from './lib/sunspec-reader';

/**
 * Number of consecutive recoverable polling failures after which the adapter logs a
 * dedicated repeated-failure error (Req 8.5).
 */
const MAX_CONSECUTIVE_FAILURES = 10;

/**
 * Control-register addresses that a user-edited expert state may dispatch a write for
 * (Req 12.6, 13.4): the storage control mode (0xE004), the remote command mode
 * (0xE00D), and the discharge limit (0xE010). The initial-config-only registers
 * 0xE000/0xE00A and the adapter-renewed timeout 0xE00B are deliberately excluded, so a
 * user change never resolves to a write for them (defensive — no writable expert state
 * exists for those in the first place).
 */
const WRITABLE_EXPERT = new Set<number>([0xe004, 0xe00d, 0xe010]);

/**
 * SolarEdge SunSpec reader adapter.
 *
 * Read-only Modbus TCP monitor: on start it validates the configuration and ensures the
 * `info.connection` indicator and the `inverter` channel exist, then polls the inverter
 * plus every present meter (up to 3) and battery (up to 2) SunSpec block on the
 * configured interval. Meter/battery channels are created on demand once a slot is
 * detected. In read-only mode (`config.controlEnabled` false) the adapter never issues
 * Modbus write function codes and never subscribes to state changes — it only writes
 * acknowledged values it read from the device. When control is enabled it additionally
 * drives the StorEdge Remote Control registers (see {@link enableControl}).
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

    /**
     * Control-register write dispatcher (FC06/FC16). Constructed only when
     * `config.controlEnabled` is true; absent in read-only mode (Req 1.6).
     */
    private controlWriter?: ModbusControlWriter;
    /**
     * True once the enable gate has put the inverter into Remote Control mode;
     * mirrors `config.controlEnabled` after the `onReady` gate. Stays false in
     * read-only mode so the poll loop skips the heartbeat (Req 1.2, 1.6).
     */
    private controlActive = false;
    /** Last received house-consumption sample (value + timestamp) for the compute cache. */
    private lastHouseSample?: SourceSample;
    /** Last received wallbox-consumption sample (value + timestamp) for the compute cache. */
    private lastWallboxSample?: SourceSample;
    /** Last value written to the discharge-limit register 0xE010 (write-only-if-changed). */
    private lastWritten0xE010?: number;

    public constructor(options: Partial<utils.AdapterOptions> = {}) {
        super({
            ...options,
            name: 'sehybrid',
        });
        this.on('ready', this.onReady.bind(this));
        this.on('message', this.onMessage.bind(this));
        this.on('unload', this.onUnload.bind(this));
        // Bound so control subscriptions have a handler; in read-only mode no
        // subscriptions are registered so it is never invoked.
        this.on('stateChange', this.onStateChange.bind(this));
    }

    /**
     * Called when databases are connected and the adapter received its configuration.
     *
     * Sets the connection indicator to false, validates the config (guarding on a
     * missing host, Req 8.4), constructs the Modbus client / reader / state manager,
     * ensures the channels, then — only when `config.controlEnabled` is true — enters
     * control mode (control states, subscriptions, enable sequence) before running the
     * first poll and scheduling the repeating timer (Req 1.6, 5.4, 7.1, 8.3).
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

        // --- Control gate (Req 1.6): ALL control wiring is gated on controlEnabled. -----
        // When false the adapter stays strictly read-only — no control states, no
        // subscriptions, no enable sequence, no heartbeat (Req 1.2-1.5); reads proceed
        // unchanged. When true, enter CONTROL_ACTIVE (Req 1.1, 1.3).
        if (this.config.controlEnabled === true) {
            await this.enableControl();
        } else if (this.controlActive) {
            // Disable (OFF) transition observed while the adapter is alive: run the
            // revert path (0xE004=default, unsubscribe, stop heartbeat) (Req 12.1-12.3).
            // A fresh onReady starts with controlActive=false and simply stays
            // READ_ONLY here — no control write, matching the no-unload-revert intent.
            await this.disableControl();
        }

        this.log.info(
            `Starting SunSpec polling of ${this.config.host}:${this.config.port} (unit ${this.config.unitId}) every ${this.config.pollInterval}s`,
        );

        // Run one cycle immediately, then schedule the repeating timer (Req 5.4).
        await this.pollOnce();
        this.pollTimer = this.setInterval(() => {
            void this.pollOnce();
        }, this.config.pollInterval * 1000);
    }

    /**
     * Enter CONTROL_ACTIVE: build the control writer, create the expert control
     * states, subscribe to the control branch and both configured foreign
     * consumption sources, seed the value cache, and run the enable sequence that
     * puts the inverter into Remote Control mode (Req 1.1, 1.3, 6.1, 9.1-9.3).
     *
     * Only invoked from {@link onReady} when `config.controlEnabled` is true. The
     * enable writes are wrapped so a Modbus failure is logged and non-fatal: the
     * adapter keeps running and `controlActive` stays true so the poll-loop
     * heartbeat retries the assertion next cycle (per design error handling).
     * Requires the collaborators built in {@link onReady} to exist.
     */
    private async enableControl(): Promise<void> {
        if (!this.modbusClient || !this.stateManager) {
            // Should not happen: collaborators are built before this runs.
            return;
        }

        this.controlWriter = new ModbusControlWriter(this.modbusClient);

        // Create the expert control states (outside the read model) and subscribe to
        // the control branch so expert edits reach onStateChange (Req 1.3).
        await this.stateManager.ensureControlStates();
        this.subscribeStates('control.*');

        // Subscribe to the configured foreign consumption sources (Req 6.1). Only
        // subscribe when the id is a non-empty string.
        const houseId = this.config.houseConsumptionStateId;
        const wallboxId = this.config.wallboxConsumptionStateId;
        if (typeof houseId === 'string' && houseId.length > 0) {
            this.subscribeForeignStates(houseId);
        }
        if (typeof wallboxId === 'string' && wallboxId.length > 0) {
            this.subscribeForeignStates(wallboxId);
        }

        // Seed the value cache from the current source values (Req 6.1). A missing
        // state leaves the corresponding sample undefined (treated as invalid).
        if (typeof houseId === 'string' && houseId.length > 0) {
            const state = await this.getForeignStateAsync(houseId);
            if (state) {
                this.lastHouseSample = { val: state.val, ts: state.ts };
            }
        }
        if (typeof wallboxId === 'string' && wallboxId.length > 0) {
            const state = await this.getForeignStateAsync(wallboxId);
            if (state) {
                this.lastWallboxSample = { val: state.val, ts: state.ts };
            }
        }

        // Compute the initial discharge limit from the seeded cache (Req 9.3).
        const initialLimit = computeDischargeLimit(
            this.lastHouseSample,
            this.lastWallboxSample,
            Date.now(),
            this.config.sourceMaxAgeSeconds,
            this.config.maxDischargeLimit,
        );

        // Initial-config sequence (SolarEdge documented order, Req 9.1-9.6):
        // 0xE000=0, 0xE004=4, 0xE00A=defaultFallbackMode, 0xE00D=4,
        // 0xE00B=commandTimeout (uint32le), 0xE010=initialLimit (float32le).
        // A failure here is logged and non-fatal: controlActive still becomes true so
        // the pollOnce heartbeat re-asserts Remote Control next cycle.
        try {
            await this.controlWriter.applyEnable(initialLimit, {
                defaultFallbackMode: this.config.defaultFallbackMode,
                commandTimeout: this.config.commandTimeout,
            });
            this.lastWritten0xE010 = initialLimit;
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            this.log.error(
                `Enable sequence failed: ${reason}. Control remains active; the heartbeat will retry next poll cycle.`,
            );
        }

        // Reflect status regardless of the enable-write outcome so the heartbeat runs.
        this.controlActive = true;
        try {
            await this.stateManager.setControlAck('controlActive', true);
            await this.stateManager.setControlAck('computedDischargeLimit', initialLimit);
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            this.log.warn(`Failed to reflect control status states: ${reason}`);
        }

        this.log.info('StorEdge battery control enabled (Remote Control mode)');
    }

    /**
     * Leave CONTROL_ACTIVE: run the disable/revert path used by the OFF transition
     * (control released while the adapter is alive to observe it).
     *
     * Restores 0xE004 to the configured default storage control mode (Req 12.1),
     * unsubscribes both foreign consumption sources and the `control.` branch,
     * then clears `controlActive` so subsequent poll cycles skip the heartbeat
     * (Req 12.2, 12.3). The revert write is wrapped so a Modbus failure is logged
     * and non-fatal. This method is NEVER called from {@link onUnload}: revert
     * happens on the OFF transition only, never on unload (Req 12.5).
     */
    private async disableControl(): Promise<void> {
        // Revert 0xE004 to the configured default mode (Req 12.1). Best-effort: a
        // failure is logged and does not prevent the rest of the teardown.
        if (this.controlWriter && this.controlActive) {
            try {
                await this.controlWriter.applyRevert(this.config.defaultStorageControlMode);
            } catch (error) {
                const reason = error instanceof Error ? error.message : String(error);
                this.log.error(
                    `Failed to revert storage control mode to ${this.config.defaultStorageControlMode} (0xE004): ${reason}.`,
                );
            }
        }

        // Unsubscribe both foreign sources and the control branch (Req 12.2).
        const houseId = this.config.houseConsumptionStateId;
        const wallboxId = this.config.wallboxConsumptionStateId;
        if (typeof houseId === 'string' && houseId.length > 0) {
            this.unsubscribeForeignStates(houseId);
        }
        if (typeof wallboxId === 'string' && wallboxId.length > 0) {
            this.unsubscribeForeignStates(wallboxId);
        }
        this.unsubscribeStates('control.*');

        // Stop the heartbeat: subsequent poll cycles skip control (Req 12.3).
        this.controlActive = false;
        try {
            await this.stateManager?.setControlAck('controlActive', false);
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            this.log.warn(`Failed to reflect control status state: ${reason}`);
        }

        this.log.info('StorEdge battery control disabled (reverted to default storage control mode)');
    }

    /**
     * Handle a subscribed state change (control branch or a foreign consumption
     * source). Guards drop deletions and adapter-originated acks up front; the
     * write dispatch is delegated to {@link handleStateChange} so Modbus failures
     * stay contained (they are logged and non-fatal, never thrown out of the
     * event handler) (Req 14.1, 14.2).
     *
     * @param id - The changed state id.
     * @param state - New state, or null/undefined on deletion.
     */
    private onStateChange(id: string, state: ioBroker.State | null | undefined): void {
        // Deletion — ignore (Req 13.5 boundary).
        if (!state) {
            return;
        }
        // Adapter-originated acknowledged write — ignore to prevent write loops (Req 13.5).
        if (state.ack) {
            return;
        }
        // Delegate the async dispatch; errors are handled inside the helper.
        void this.handleStateChange(id, state);
    }

    /**
     * Dispatch a non-acked, non-deletion state change (control branch or foreign
     * consumption source).
     *
     * Two routes:
     *  1. A configured foreign source (house/wallbox) updates the value cache,
     *     recomputes the discharge limit, and writes `0xE010` only when it changed
     *     (write-only-if-changed) (Req 6.1, 8.1, 8.2, 8.3).
     *  2. An expert control state under this instance's `control.` namespace is
     *     resolved via {@link findControlDef}; only ids in the writable-expert set
     *     `{0xE004, 0xE00D, 0xE010}` dispatch a write — unknown, read-only (no `fc`),
     *     and initial-config-only / renewed ids (0xE000/0xE00A/0xE00B) are ignored.
     *     `0xE010` honors write-only-if-changed, everything else is written directly.
     *     On success the value is acked so the re-entrant change is dropped by the ack
     *     guard (Req 12.6, 13.4, 13.5, 14.3).
     *
     * All Modbus writes are wrapped: a failure is logged and the previous acked
     * value / `lastWritten0xE010` is retained; nothing is thrown out (Req 14.1, 14.2).
     *
     * @param id - The changed state id (instance-namespaced for control states).
     * @param state - The new, non-acked state.
     */
    private async handleStateChange(id: string, state: ioBroker.State): Promise<void> {
        // Only act while control is active and the collaborators exist.
        if (!this.controlActive || !this.controlWriter || !this.stateManager) {
            return;
        }
        const controlWriter = this.controlWriter;
        const stateManager = this.stateManager;

        // --- Route 1: foreign consumption source change (Req 6.1, 8.1-8.3) --------
        const houseId = this.config.houseConsumptionStateId;
        const wallboxId = this.config.wallboxConsumptionStateId;
        if (id === houseId || id === wallboxId) {
            // Update the value cache with the fresh sample (value + timestamp).
            if (id === houseId) {
                this.lastHouseSample = { val: state.val, ts: state.ts };
            } else {
                this.lastWallboxSample = { val: state.val, ts: state.ts };
            }

            // Recompute the target discharge limit from the cache (Req 6.2-6.4, 7.x).
            const limit = computeDischargeLimit(
                this.lastHouseSample,
                this.lastWallboxSample,
                Date.now(),
                this.config.sourceMaxAgeSeconds,
                this.config.maxDischargeLimit,
            );

            // Write-only-if-changed: skip the FC16 write when the limit is unchanged
            // (Req 8.2). On failure, retain the previous lastWritten0xE010 (non-fatal).
            if (limit !== this.lastWritten0xE010) {
                try {
                    await controlWriter.write(REMOTE_CONTROL_DISCHARGE_LIMIT, limit);
                    this.lastWritten0xE010 = limit;
                    await stateManager.setControlAck('computedDischargeLimit', limit);
                } catch (error) {
                    const reason = error instanceof Error ? error.message : String(error);
                    this.log.error(
                        `Failed to write discharge limit ${limit} W to 0xE010: ${reason}. Retaining the previous value.`,
                    );
                }
            }
            return;
        }

        // --- Route 2: expert control state change (Req 13.4, 13.5, 14.x) ----------
        // Control ids are delivered in this instance's namespace, e.g.
        // `sehybrid.0.control.remoteControlDischargeLimit`. Match the control branch
        // and extract the leaf after the last '.'.
        const controlPrefix = `${this.namespace}.control.`;
        if (!id.startsWith(controlPrefix)) {
            return;
        }
        const leaf = id.slice(id.lastIndexOf('.') + 1);
        const def = findControlDef(leaf);
        // Ignore unless the id resolves to a writable expert register in the allowed
        // set {0xE004, 0xE00D, 0xE010}: unknown leaves, read-only registers (no write
        // function code), and initial-config-only / adapter-renewed registers
        // (0xE000/0xE00A/0xE00B, computedDischargeLimit, controlActive) never dispatch
        // a user-driven write (Req 12.6, 13.4, 13.5).
        if (!def || !def.fc || !WRITABLE_EXPERT.has(def.address)) {
            return;
        }

        const value = Number(state.val);
        try {
            if (def.address === REMOTE_CONTROL_DISCHARGE_LIMIT.address) {
                // 0xE010 honors write-only-if-changed: ack without writing when the
                // requested value already matches the last written limit (Req 13.4).
                if (value === this.lastWritten0xE010) {
                    await stateManager.setControlAck(leaf, value);
                    return;
                }
                await controlWriter.write(def, value);
                this.lastWritten0xE010 = value;
            } else {
                await controlWriter.write(def, value);
            }
            // Ack on success so the re-entrant change is dropped by the ack guard (Req 14.3).
            await stateManager.setControlAck(leaf, value);
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            this.log.error(
                `Failed to write control register ${leaf} (0x${def.address
                    .toString(16)
                    .toUpperCase()}) = ${value}: ${reason}. Retaining the previous acked value.`,
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

            // --- Control heartbeat tail (Req 11.1-11.5) -----------------------------
            // Only while control is active. Runs INSIDE this try so a heartbeat write
            // failure follows the existing cycle-failure path (info.connection=false,
            // close socket, reconnect next cycle) rather than being swallowed (Req 11.5).
            if (this.controlActive && this.controlWriter) {
                // Recompute the target limit from the value cache (Req 6.2-6.4, 7.x).
                const limit = computeDischargeLimit(
                    this.lastHouseSample,
                    this.lastWallboxSample,
                    Date.now(),
                    this.config.sourceMaxAgeSeconds,
                    this.config.maxDischargeLimit,
                );
                // Heartbeat: renew 0xE00B=commandTimeout and re-assert 0xE00D=4
                // UNCONDITIONALLY (keep-alive), refresh 0xE010 write-only-if-changed,
                // and do NOT re-assert 0xE000/0xE004/0xE00A (Req 11.1-11.4, 8.2, 10.2).
                this.lastWritten0xE010 = await this.controlWriter.heartbeat(
                    limit,
                    this.lastWritten0xE010,
                    this.config.commandTimeout,
                );
                // Reflect the current computed limit on the normal surface.
                await stateManager.setControlAck('computedDischargeLimit', limit);
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
