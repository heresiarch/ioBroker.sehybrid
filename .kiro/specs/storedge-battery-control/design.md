# Design Document

## Overview

This feature adds **consumption-based** SolarEdge StorEdge battery discharge control onto the existing strictly read-only SunSpec adapter. Today the adapter only reads: `src/lib/modbus-client.ts` exposes FC03/FC04 with a 10 s rejecting-timer timeout and a documented read-only invariant (property-tested); `src/lib/state-manager.ts` derives `write=false` states from the SunSpec register map; `src/main.ts` runs a single `pollOnce` `setInterval` loop with an overlap guard, reconnect-on-failure, and `info.connection` handling, and there is **no** `this.on('stateChange', …)` subscription. `src/lib/sunspec-decode.ts` already decodes the StorEdge battery block (`0xE1xx`) as `float32le` — IEEE-754 with **little-endian word order** (low word first, bytes big-endian within each word); `BATTERY_MAP` in `src/lib/sunspec-map.ts` confirms every battery power/energy field uses `float32le`.

The feature drives the StorEdge Remote Control **discharge power limit** register `0xE010` from live household load. The adapter subscribes to two configurable **foreign** ioBroker states — total house consumption (W) and wallbox consumption (W) — and continuously computes `limit = min(max(house - wallbox, 0), maxDischargeLimit)`, writing that limit to `0xE010` (write-only-if-changed). A single master `controlEnabled` **config setting** (not a state) gates everything: OFF ⇒ strictly read-only (no writes, no subscriptions, no heartbeat, reads unchanged); ON ⇒ Control_Active — the adapter follows SolarEdge's documented "Configuration of the Storage Control for Remote Control mode" procedure, which separates a **one-time initial configuration** from a **repeated dynamic command loop**.

**Initial configuration (once, on enable).** In documented order the adapter disables the conflicting export configuration (`0xE000`=0, FC06), selects Remote Control storage mode (`0xE004`=4, FC06), sets the fallback default mode the inverter reverts to if communication is interrupted (`0xE00A`=configured `defaultFallbackMode`, FC06), sets the remote command mode (`0xE00D`=4, FC06), sets the command-timeout keep-alive (`0xE00B`=configured `commandTimeout` seconds, FC16 uint32 little-endian), and writes the initial discharge limit (`0xE010`=computed, FC16 float32le).

**Dynamic heartbeat (every poll cycle while active).** The adapter renews the command timeout (`0xE00B`=commandTimeout, FC16 uint32le, unconditionally), re-writes the command mode (`0xE00D`=4, FC06, unconditionally), and refreshes the discharge limit (`0xE010`, FC16 float32le, write-only-if-changed). The renewed short command timeout is the manufacturer-intended keep-alive; the initial-config registers `0xE000`, `0xE004`, and `0xE00A` are **not** re-asserted each cycle (`0xE004` is written again only on disable revert).

Because the renewed short command timeout (e.g. 120 s) is the primary keep-alive, Remote Control persists across cycles and this also sidesteps the community-reported inverter behavior of resetting oversized timeout values back to 3600 after 24 h. Disabling the StorEdge storage profile in the SolarEdge monitoring portal / SetApp is still **recommended** to avoid the ~10 s portal-side reversion on affected firmware — a **documented manual prerequisite surfaced as an admin warning**, not enforced by code (Req 15).

Design constraints that shape every decision below:

- **Reuse the existing poll loop.** The heartbeat lives in the `pollOnce` tail inside the existing `try`; no separate control timer is added (Req 11.5).
- **Keep control separate from the read model.** Control registers are a new module (`control-registers.ts`), never entries in `SUNSPEC_MAP`/`BATTERY_MAP`; control states are created outside the register-map-driven read model (Req 4.8, 13.6).
- **Reads are untouched.** FC03/FC04 behavior is unchanged; the only new client surface is `writeSingleRegister` (FC06) and `writeMultipleRegisters` (FC16) (Req 2.8, 3.2).
- **Little-endian multiword write encoding.** `encodeFloat32le` (for `0xE010`/`0xE00E`) and `encodeUint32le` (for `0xE00B`) must be the exact inverses of `decodeRegisters(..., 'float32le')` and `decodeRegisters(..., 'uint32le')` — low word first — the old MSW-first encoders would be wrong for this inverter (Req 5).
- **Custom React admin, not jsonConfig.** New settings live in `src-admin/src/components/Settings.tsx` with i18n, plus `src/lib/adapter-config.d.ts` and `io-package.json` `native` defaults.
- **No unload revert.** `onUnload` performs no control write (Req 12.6). Revert-to-default happens only when control is disabled.

Language for all code examples: **TypeScript** (matching the existing adapter).

## Architecture

### Component overview

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ main.ts  (Sehybrid extends utils.Adapter)                                       │
│                                                                                 │
│  onReady()                                                                      │
│    ├─ validateConfig(config)                    (config-validation.ts, extended)│
│    ├─ build ModbusClient / StateManager / SunSpecReader                         │
│    ├─ pollOnce()   ← connects the Modbus client on demand, then reads         │
│    ├─ if (config.controlEnabled):   ── enter CONTROL_ACTIVE ──┐  (AFTER connect) │
│    │     ├─ stateManager.ensureControlStates()                │                 │
│    │     ├─ subscribeStates('control.*')                      │                 │
│    │     ├─ subscribeForeignStates(houseId), (wallboxId)      │                 │
│    │     ├─ this.on('stateChange', onStateChange)             │                 │
│    │     └─ INITIAL CONFIG (in order):                        │                 │
│    │          0xE000=0, 0xE004=4, 0xE00A=defaultFallbackMode, │                 │
│    │          0xE00D=4, 0xE00B=commandTimeout, 0xE010=limit   │                 │
│    └─ setInterval(pollOnce, pollInterval*1000)                │                 │
│                                                               ▼                 │
│  onStateChange(id, state)                              ControlWriter (FC06/FC16)│
│    ├─ if !state || state.ack → ignore  (deletion / adapter-originated)          │
│    ├─ foreign source id → recompute limit → maybe write 0xE010                  │
│    ├─ expert control id  → write via ControlWriter (write-only-if-changed 0xE010)│
│    ├─ on success → setControlAck(name, val)                                     │
│    └─ on failure → log + retain prior acked value  (Modbus exception non-fatal) │
│                                                                                 │
│  pollOnce()  (existing reads unchanged)                                         │
│    └─ heartbeat tail (inside existing try, only while controlActive):           │
│         0xE00B=commandTimeout (FC16 uint32le, unconditional) ← keep-alive       │
│         0xE00D=4 (FC06, unconditional)                       ← keep-alive       │
│         0xE010=computedLimit (FC16 float32le, write-only-if-changed)            │
│                                                                                 │
│  onUnload()  → clear timer, close socket, NO control write                      │
└───────────────────────────────────────────────────────────────────────────────┘
        │ reads (FC03/FC04)          │ writes (FC06/FC16)          ▲ foreign states
        ▼                            ▼                             │ house / wallbox (W)
┌──────────────────────────────────┐  ┌────────────────────────┐  ┌──────────────────────┐
│ ModbusClient (modbus-client.ts)  │  │ control-registers.ts   │  │ ConsumptionTracker    │
│  read: FC03 / FC04 (unchanged)   │  │  0xE000 0xE004 0xE00A   │  │  last house/wallbox   │
│  write: writeSingleRegister FC06 │  │  0xE00B 0xE00D 0xE00E   │  │  validity + compute   │
│         writeMultipleRegisters   │  │  0xE010 findControlDef  │  │  min(max(h-w,0),max)  │
│         FC16                     │  └────────────────────────┘  └──────────────────────┘
└──────────────────────────────────┘        │ le words (float32le / uint32le)
                                             ▼
                          sunspec-decode.ts: encodeFloat32le / encodeUint32le
                                   (exact inverses of the *le decoders)
```

### Control flow / state machine

The runtime adds one boolean **`controlActive`** on the adapter instance (mirrors `config.controlEnabled` after the `onReady` gate) plus a small value cache (last house, last wallbox, last-written `0xE010`). There is **no** timer and **no** separate scheduler — the existing poll loop *is* the heartbeat.

```
                     controlEnabled === false                 controlEnabled === true
                    ┌───────────────────────┐              ┌───────────────────────────────┐
   onReady gate ───▶│      READ_ONLY        │              │        CONTROL_ACTIVE           │
                    │  no writes            │  INITIAL     │  subscriptions live             │
                    │  no subscriptions     │  CONFIG      │  heartbeat each poll            │
                    │  no heartbeat         │  (in order): │  source-change recompute        │
                    │  FC03/FC04 unchanged  │  0xE000=0    │                                 │
                    └───────────────────────┘  0xE004=4    └─────────────────────────────────┘
                                              0xE00A=fallbackMode
                                   ───────▶   0xE00D=4      ───────▶
                                              0xE00B=commandTimeout (uint32le, FC16)
                                              0xE010=limit
                                              ◀───────────
                                       disable transition (controlEnabled flips false,
                                       re-evaluated on config change / onReady):
                                         write 0xE004 = defaultStorageControlMode (FC06)
                                         unsubscribe both sources + control.*
                                         stop heartbeat (controlActive=false)

   Each pollOnce cycle, AFTER the normal reads, INSIDE the existing try (HEARTBEAT):
     if (controlActive):
       write 0xE00B = commandTimeout (FC16 uint32le)  ← renew UNCONDITIONALLY every cycle
       write 0xE00D = 4              (FC06)           ← re-assert UNCONDITIONALLY every cycle
       if (computedLimit !== lastWritten0xE010):
         write 0xE010 = computedLimit (FC16 float32le)← refresh only when changed
         lastWritten0xE010 = computedLimit
     // NOT written during heartbeat: 0xE000, 0xE004, 0xE00A

   On a foreign source change (house or wallbox), or each poll:
     recompute limit = min(max(house - wallbox, 0), maxDischargeLimit)
     invalid source (missing / non-numeric / ts older than sourceMaxAgeSeconds) ⇒ limit = 0
     apply write-only-if-changed to 0xE010
```

The precise distinction the requirements demand: the initial-config registers `0xE000`, `0xE004`, and `0xE00A` are written **once** on enable and are **not** re-asserted every cycle (Req 11.4, 12.4, 12.5). The heartbeat instead **renews `0xE00B` unconditionally** (the manufacturer keep-alive, Req 10.2/11.1) and **re-writes `0xE00D`=4 unconditionally** (Req 11.2), while **`0xE010` is skipped when unchanged** (Req 8.2, 11.3). A heartbeat write that throws is caught by the *existing* cycle-failure path (`info.connection=false`, close socket, reconnect next cycle); it never terminates the adapter (Req 11.6).

Because `controlEnabled` is a config value, not a state, there is no `disableDischarge` boolean switch in the object tree. The enable/disable transition is driven by the `onReady` gate (and re-evaluated when the instance config changes, which restarts the adapter). A read-only status state (`control.controlActive`) may be exposed purely to reflect whether control is currently active — it is never used to trigger writes.

## Components and Interfaces

### 1. Modbus client — add write function codes (`src/lib/modbus-client.ts`)

Two write methods join `IModbusClient`/`ModbusClient`, reusing the **exact** timeout mechanism as reads: guard `!isConnected()` first, then `this.client.setTimeout(timeoutMs)` and race the library call against `rejectAfter(timeoutMs, …)` with `DEFAULT_TIMEOUT_MS` (10 s), cancelling the timer in `finally`. A shared private `write(fn, address, payload, opts)` mirrors the existing shared `read()` helper.

```ts
export interface ModbusWriteOptions {
    timeoutMs?: number; // defaults to DEFAULT_TIMEOUT_MS
}

export interface IModbusClient {
    // ... existing read methods unchanged (connect / readHoldingRegisters / readInputRegisters / isConnected / close) ...
    /** FC06 — write one uint16 to a holding register. Rejects when not connected. */
    writeSingleRegister(address: number, value: number, opts?: ModbusWriteOptions): Promise<void>;
    /** FC16 — write a uint16 word array to consecutive holding registers. Rejects when not connected. */
    writeMultipleRegisters(address: number, values: number[], opts?: ModbusWriteOptions): Promise<void>;
}
```

Implementation notes:

- `writeSingleRegister` validates `value` is an integer in `[0, 0xFFFF]` and forwards to the library `writeRegister(address, value)` (FC06).
- `writeMultipleRegisters` validates a non-empty word array (each `0..0xFFFF`) and forwards to the library `writeRegisters(address, values)` (FC16). Both float32 → two-word (`0xE010`/`0xE00E`) and uint32 → two-word (`0xE00B`) encoding is done by the caller (`ControlWriter`), keeping the client type-agnostic like its read side.
- Both reject with `Modbus client is not connected` when `!this.isConnected()` before issuing any library call, then apply the timeout race exactly as `read()` does.

**Revised read-only invariant.** The module header comment and `IModbusClient` doc are updated: the client is no longer *strictly* read-only. Its write surface is **restricted to exactly** FC06 single-register and FC16 multiple-register operations; the adapter targets those only at the StorEdge control registers `0xE000`, `0xE004`, `0xE00A`, `0xE00B`, `0xE00D`, `0xE010`, and (expert-optional) `0xE00E`. No coil write (FC05/FC15) or any other write function code is exposed. FC03/FC04 read behavior is unchanged (Req 2.8, 3.1, 3.2, 3.3, 3.4).

> The existing property test in `src/lib/modbus-client.test.ts` (**Property 4: read-only invariant**, which asserts `FORBIDDEN_WRITE_METHODS` includes `writeSingleRegister`/`writeMultipleRegisters`/`writeRegister`/`writeRegisters`) **must be revised**: move those four out of `FORBIDDEN_WRITE_METHODS` into the *allowed* write surface; keep all coil methods (`writeCoil`/`writeCoils`/FC05/FC15) forbidden; keep the "reads never issue a write" arm (over any sequence of reader ops only FC03/FC04 are issued).

### 2. Control-register definitions — new module (`src/lib/control-registers.ts`)

A separate definition set, distinct from `SUNSPEC_MAP`/`BATTERY_MAP`, describing the StorEdge Power Control registers in the `0xExxx` range. These are **not** polled by the read loop and never appear in the SunSpec value table (Req 4.8).

```ts
export type ControlRegisterKind = 'uint16' | 'float32' | 'uint32';
export type ControlWordOrder = 'le'; // little-endian word order for multiword regs (matches float32le/uint32le)

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
    wordOrder?: ControlWordOrder; // 'le' for float32/uint32 (Req 5.1)
    /** ioBroker common.type for the backing state. */
    iobType: 'number';
    /** Physical unit for common.unit, if any. */
    unit?: string;
    /** Inclusive value range for validation / documentation. */
    min: number;
    max: number;
    /** Write function code the adapter uses (FC06 uint16, FC16 multiword). Absent = read-only. */
    fc?: 'FC06' | 'FC16';
    /** True when the backing expert state is read-only (reflects a value, never user-writable). */
    readOnly?: boolean;
}

export const EXPORT_CONFIG: ControlRegisterDef = {                 // Req 4.1 — written once (=0) on enable
    name: 'exportConfig', address: 0xe000, kind: 'uint16', length: 1, iobType: 'number', min: 0, max: 0xffff, fc: 'FC06',
};
export const STORAGE_CONTROL_MODE: ControlRegisterDef = {          // Req 4.2 — enable (=4) + disable-revert only
    name: 'storageControlMode', address: 0xe004, kind: 'uint16', length: 1, iobType: 'number', min: 0, max: 4, fc: 'FC06',
};
export const STORAGE_DEFAULT_MODE: ControlRegisterDef = {          // Req 4.3 — written once on enable (=fallback)
    name: 'storageDefaultMode', address: 0xe00a, kind: 'uint16', length: 1, iobType: 'number', min: 0, max: 7, fc: 'FC06',
};
export const REMOTE_CONTROL_COMMAND_TIMEOUT: ControlRegisterDef = {// Req 4.4 — enable + renewed each cycle (uint32le, FC16)
    name: 'remoteControlCommandTimeout', address: 0xe00b, kind: 'uint32', length: 2, wordOrder: 'le', iobType: 'number', unit: 's', min: 0, max: 86400, fc: 'FC16',
};
export const REMOTE_CONTROL_COMMAND_MODE: ControlRegisterDef = {   // Req 4.5 — enable + each cycle (=4)
    name: 'remoteControlCommandMode', address: 0xe00d, kind: 'uint16', length: 1, iobType: 'number', min: 0, max: 7, fc: 'FC06',
};
export const REMOTE_CONTROL_CHARGE_LIMIT: ControlRegisterDef = {   // Req 4.6 — expert-only, optional
    name: 'remoteControlChargeLimit', address: 0xe00e, kind: 'float32', length: 2, wordOrder: 'le', iobType: 'number', unit: 'W', min: 0, max: Number.MAX_VALUE, fc: 'FC16',
};
export const REMOTE_CONTROL_DISCHARGE_LIMIT: ControlRegisterDef = {// Req 4.7 — enable + each cycle write-only-if-changed
    name: 'remoteControlDischargeLimit', address: 0xe010, kind: 'float32', length: 2, wordOrder: 'le', iobType: 'number', unit: 'W', min: 0, max: Number.MAX_VALUE, fc: 'FC16',
};

export const CONTROL_REGISTERS: readonly ControlRegisterDef[] = [
    EXPORT_CONFIG, STORAGE_CONTROL_MODE, STORAGE_DEFAULT_MODE, REMOTE_CONTROL_COMMAND_TIMEOUT,
    REMOTE_CONTROL_COMMAND_MODE, REMOTE_CONTROL_CHARGE_LIMIT, REMOTE_CONTROL_DISCHARGE_LIMIT,
];

/** Resolve the control def for a given control-state id leaf, or undefined. */
export function findControlDef(name: string): ControlRegisterDef | undefined;
```

Every def now carries an `fc`: FC06 for the uint16 registers (`0xE000`, `0xE004`, `0xE00A`, `0xE00D`) and FC16 for the multiword registers (`0xE00B` uint32le, `0xE010`/`0xE00E` float32le), matching the writes each register receives (Req 4.1–4.7, 3.4). `0xE00B` (`remoteControlCommandTimeout`) is now **written** (FC16, `wordOrder:'le'`) — it is set on enable and renewed each cycle — so it no longer carries `readOnly`; the def's `readOnly` flag now only governs whether the backing *expert state* accepts user writes (the timeout expert state stays read-only, reflecting the renewed value, Req 13.2). `0xE00A` (`storageDefaultMode`) is likewise now writable (once, on enable) and no longer `readOnly`. For multiword registers `wordOrder: 'le'` selects `encodeFloat32le` (float32) or `encodeUint32le` (uint32) in the writer.

### 3. Little-endian multiword encoding (`src/lib/sunspec-decode.ts`)

The discharge limit is a float32 and the command timeout is a uint32, both written via FC16 in little-endian word order. Two encoders are colocated with their decoders so each round-trip is provable.

**float32** — `decodeRegisters(words, 'float32le')` reads **words[1] as high, words[0] as low** (bytes big-endian within each word). `encodeFloat32le` is its exact inverse (already present):

```ts
/**
 * Encode a float32 into two 16-bit words in LITTLE-ENDIAN WORD ORDER — the exact
 * inverse of decodeRegisters(words, 'float32le'). The low word is words[0] and the
 * high word is words[1]; bytes within each word are big-endian.
 * Verified: encodeFloat32le(5000) === [0x4000, 0x459c].  (Req 5.1, 5.2, 5.3)
 */
export function encodeFloat32le(value: number): [number, number] {
    const buf = Buffer.allocUnsafe(4);
    buf.writeFloatBE(value, 0);
    const high = buf.readUInt16BE(0); // most-significant 16 bits
    const low = buf.readUInt16BE(2);  // least-significant 16 bits
    return [low, high]; // words[0]=low, words[1]=high (little-endian WORD order)
}
```

**uint32** (NEW) — `decodeRegisters(words, 'uint32le')` returns `toUint32(words[1], words[0])`, i.e. **words[0] is the low word, words[1] the high word**. `encodeUint32le` is its exact inverse, low word first:

```ts
/**
 * Encode an unsigned 32-bit integer into two 16-bit words in LITTLE-ENDIAN WORD
 * ORDER — the exact inverse of decodeRegisters(words, 'uint32le'). words[0] is the
 * low 16 bits, words[1] the high 16 bits. Used for the command timeout 0xE00B.
 * (Req 4.4, 5.1)
 */
export function encodeUint32le(value: number): [number, number] {
    const v = value >>> 0;                 // coerce into unsigned 32-bit
    const low = v & 0xffff;                // least-significant 16 bits
    const high = (v >>> 16) & 0xffff;      // most-significant 16 bits
    return [low, high]; // words[0]=low, words[1]=high (little-endian WORD order)
}
```

The old MSW-first `encodeFloat32` (which returned `[high, low]`) is **wrong for this inverter and must not be used**. `ControlWriter` selects `encodeFloat32le` for any `float32` def with `wordOrder:'le'` (`0xE010`/`0xE00E`) and `encodeUint32le` for the `uint32` def with `wordOrder:'le'` (`0xE00B`).

### 4. State manager — control states (`src/lib/state-manager.ts`)

A new concept is added alongside the SunSpec state creation, deliberately **outside** the register-map-driven read model (Req 13.6). The existing `ensureChannel`/`ensureState`/`writeValue` (SunSpec, `write=false`) are untouched.

```ts
export interface IStateManager {
    // ... existing methods unchanged ...
    /** Create the `control` channel and all control states (idempotent). Only called when controlEnabled. */
    ensureControlStates(): Promise<void>;
    /** Write an acknowledged value to a control state (val + ack=true). */
    setControlAck(name: string, value: number): Promise<void>;
}
```

`ensureControlStates()` creates the `control` channel and, for each control def, a state. Writable expert raw registers get **`read=true, write=true`**; the timeout register is **read-only** (`read=true, write=false`) and reflects the value the heartbeat renews each cycle; a read-only status reflection exposes whether control is active. All are grouped/marked as expert/advanced (Req 13.3) via a dedicated `control` channel plus `common.expert = true` (advanced/expert grouping in ioBroker admin).

| State id                                | type    | role             | unit | read | write | notes                                  |
| --------------------------------------- | ------- | ---------------- | ---- | ---- | ----- | -------------------------------------- |
| `control.storageControlMode`            | number  | `level.mode`     | —    | true | true  | expert raw `0xE004` (Req 13.1)         |
| `control.remoteControlCommandMode`      | number  | `level.mode`     | —    | true | true  | expert raw `0xE00D` (Req 13.1)         |
| `control.remoteControlDischargeLimit`   | number  | `value.power`    | W    | true | true  | expert raw `0xE010` (Req 13.1)         |
| `control.remoteControlCommandTimeout`   | number  | `value.interval` | s    | true | false | read-only; reflects renewed `0xE00B` (Req 13.2) |
| `control.computedDischargeLimit`        | number  | `value.power`    | W    | true | false | normal-surface reflection of the limit |
| `control.controlActive`                 | boolean | `indicator`      | —    | true | false | status: control currently active       |

The `0xE00B` expert state stays `write=false` even though the register is now written by the adapter: users never set the timeout directly; the state simply reflects the renewed `commandTimeout` value the heartbeat sends. There is no other structural change to the control-state table (Req 13.2).

`setControlAck(name, value)` writes `{ val, ack: true }` to `control.<name>`. Because these states are created explicitly (not from the register map), they are the only `write=true` states in the adapter; a test asserts no control state is produced from `SUNSPEC_MAP`/`BATTERY_MAP` (Req 13.6).

### 5. Consumption tracker + compute helper (`src/lib/consumption.ts`, pure)

A pure helper module holding the validity predicate and the clamped-limit computation so both are unit- and property-testable without ioBroker.

```ts
export interface SourceSample {
    /** Raw state value as received (may be non-numeric or undefined). */
    val: unknown;
    /** State timestamp (ms since epoch), as ioBroker provides on state.ts. */
    ts: number;
}

/** A source is valid iff present, numeric (finite), and not older than maxAgeSeconds. (Req 6.2-6.4) */
export function isSourceValid(sample: SourceSample | undefined, nowMs: number, maxAgeSeconds: number): boolean;

/**
 * Computed discharge limit in watts.
 *  - both valid   → min(max(house - wallbox, 0), maxDischargeLimit)   (Req 7.1-7.3)
 *  - either invalid → 0                                               (Req 7.4)
 */
export function computeDischargeLimit(
    house: SourceSample | undefined,
    wallbox: SourceSample | undefined,
    nowMs: number,
    maxAgeSeconds: number,
    maxDischargeLimit: number,
): number;
```

`isSourceValid` returns false when the sample is missing, when `Number(val)` is not finite, or when `nowMs - ts > maxAgeSeconds * 1000`. `computeDischargeLimit` first checks both sources with `isSourceValid`; if either is invalid it returns `0`; otherwise it clamps `house - wallbox` to `[0, maxDischargeLimit]`.

The adapter instance holds the **value cache**: the last received house `SourceSample`, the last received wallbox `SourceSample`, and `lastWritten0xE010` (number | undefined). On any source change or each poll, the adapter recomputes the limit from the cache and applies write-only-if-changed.

### 6. Control writer — dispatch layer (`src/lib/control-writer.ts`)

A thin dispatcher mapping a control-register write to the correct Modbus call and encoding, extracted so dispatch/encoding are unit-testable without a live socket.

```ts
export interface EnableOptions {
    /** Value written once to 0xE00A (fallback the inverter reverts to). */
    defaultFallbackMode: number;
    /** Value written to 0xE00B on enable and renewed each cycle, in seconds. */
    commandTimeout: number;
}

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
    heartbeat(computedLimit: number, lastWritten: number | undefined, commandTimeout: number): Promise<number | undefined>;
}
```

`write` refuses any def without an `fc` (defensive). It selects encoding by `def.kind`: `uint16` → `writeSingleRegister(address, value)` (FC06); `float32` with `wordOrder:'le'` → `writeMultipleRegisters(address, encodeFloat32le(value))` (FC16); `uint32` with `wordOrder:'le'` → `writeMultipleRegisters(address, encodeUint32le(value))` (FC16) — this is the new branch for `0xE00B`. `applyEnable` performs the full six-write initial-config sequence **in order**, taking `defaultFallbackMode` and `commandTimeout` via the `EnableOptions` object. `heartbeat` renews `0xE00B` and re-writes `0xE00D` unconditionally, applies write-only-if-changed to `0xE010`, and returns the new `lastWritten0xE010` so the caller updates its cache (unchanged when the `0xE010` write was skipped).

### 7. main.ts — subscription, dispatch, heartbeat, revert

**`onReady` additions**, only when `config.controlEnabled` (the gate for *all* control wiring, Req 1.6):

1. `await this.stateManager.ensureControlStates();`
2. `this.subscribeStates('control.*');`
3. `this.subscribeForeignStates(this.config.houseConsumptionStateId);` and the wallbox id (Req 6.1).
4. Register the handler in the constructor: `this.on('stateChange', this.onStateChange.bind(this));`.
5. Seed the value cache from `getForeignStateAsync` for both ids, compute the initial limit, then run the **initial-config sequence** `applyEnable(computedLimit, { defaultFallbackMode: config.defaultFallbackMode, commandTimeout: config.commandTimeout })` → `0xE000=0`, `0xE004=4`, `0xE00A=defaultFallbackMode`, `0xE00D=4`, `0xE00B=commandTimeout`, `0xE010=computed` (Req 9). Seed `lastWritten0xE010 = computedLimit` and set `controlActive = true`.

**Ordering:** the control gate runs **after** the first `pollOnce()` in `onReady`, not before it. `pollOnce()` connects the Modbus client on demand (`if (!isConnected()) await connect(...)`), so running it first ensures the enable sequence writes to an already-connected client instead of failing with “Modbus client is not connected” on startup. That first cycle runs with `controlActive` still false, so its heartbeat tail is a no-op. If the first `pollOnce()` cannot connect (inverter briefly unreachable), the enable sequence is deferred non-fatally (logged at warn) and the per-cycle heartbeat runs the initial configuration once the connection is established (Req 9, 11.6, 14.2).

When `config.controlEnabled` is false, none of the above runs: no `ensureControlStates`, no subscriptions, no handler effect, no initial-config sequence, no heartbeat (Req 1.2–1.5). Reads proceed unchanged.

**`onStateChange(id, state)`**:

```
if (!state) return;                          // deletion — ignore (Req 13.5 boundary)
if (state.ack) return;                        // adapter-originated ack — ignore (Req 13.5)
if (id === houseId || id === wallboxId) {     // foreign source change
    update value cache (val + ts);
    const limit = computeDischargeLimit(house, wallbox, Date.now(), maxAge, maxDischargeLimit);
    if (limit !== lastWritten0xE010) { await controlWriter.write(0xE010def, limit); lastWritten0xE010 = limit; }
    return;
}
const leaf = id after last '.'                // expert control state
const def = findControlDef(leaf);
// Only the writable expert states 0xE004/0xE00D/0xE010 accept user changes (Req 13.1).
// 0xE000/0xE00A/0xE00B are written by the adapter but have no writable expert state,
// so a user change never resolves to them; guard defensively on the writable set.
const WRITABLE_EXPERT = new Set([0xe004, 0xe00d, 0xe010]);
if (!def || !def.fc || !WRITABLE_EXPERT.has(def.address)) return; // unknown / non-writable-state id → ignore
try {
    if (def.address === 0xE010) {             // honor write-only-if-changed for 0xE010 (Req 13.4)
        if (Number(state.val) === lastWritten0xE010) { await setControlAck(leaf, state.val); return; }
        await controlWriter.write(def, Number(state.val)); lastWritten0xE010 = Number(state.val);
    } else {
        await controlWriter.write(def, Number(state.val));
    }
    await stateManager.setControlAck(leaf, Number(state.val));   // ack on success (Req 14.3)
} catch (e) {
    this.log.error(...);                       // log + retain prior acked value (Req 14.1); non-fatal (Req 14.2)
}
```

Because the ack write is `ack=true`, the re-entrant `onStateChange` for it is dropped by the guard, so no write loop occurs (Req 13.5).

**`pollOnce` heartbeat tail** — appended after the existing inverter/meter/battery reads, **inside the same `try`** so a heartbeat failure follows the existing cycle-failure path (`info.connection=false`, close, reconnect next cycle) (Req 11.6):

```
// ... existing reads unchanged ...
if (this.controlActive) {
    const limit = computeDischargeLimit(house, wallbox, Date.now(), maxAge, maxDischargeLimit);
    // 0xE00B renewed + 0xE00D re-asserted UNCONDITIONALLY every cycle (Req 10.2, 11.1, 11.2)
    // 0xE000/0xE004/0xE00A NOT written here (Req 11.4); 0xE010 refreshed only when changed (Req 11.3, 8.2)
    this.lastWritten0xE010 = await controlWriter.heartbeat(limit, this.lastWritten0xE010, this.config.commandTimeout);
    await stateManager.setControlAck('computedDischargeLimit', limit); // reflect normal-surface value
}
```

**Disable transition.** `controlEnabled` is a config setting; flipping it false (via admin config change, which restarts the instance, re-evaluated in `onReady`) drives the revert: `applyRevert(config.defaultStorageControlMode)` writes `0xE004=default` (Req 12.1), then the adapter unsubscribes both sources and `control.*` and leaves `controlActive=false` so subsequent cycles skip the heartbeat (Req 12.2, 12.3). If the running instance can observe the flip without restart, the same revert path is invoked; otherwise the restart's fresh `onReady` sees `controlEnabled=false` and simply stays in READ_ONLY (no writes at all) — in that case the inverter's own command timeout eventually returns it to default. The design revert path (write default mode) is invoked whenever the adapter is alive to observe the OFF transition.

**`onUnload`** is unchanged and performs **no** control write (Req 12.6): it clears the timer and closes the socket only.

### 8. Configuration type + defaults (`src/lib/adapter-config.d.ts`, `io-package.json`)

```ts
interface AdapterConfig {
    host: string;
    port: number;
    unitId: number;
    pollInterval: number;
    // --- control (this feature) ---
    controlEnabled: boolean;             // master gate, default false (Req 16.2)
    defaultStorageControlMode: number;   // 0..4, written to 0xE004 on disable, default 1
    defaultFallbackMode: number;         // 0..7, written once to 0xE00A on enable, default 1
    commandTimeout: number;              // seconds, written to 0xE00B on enable + each cycle, default 120
    houseConsumptionStateId: string;     // foreign state id (W), default ''
    wallboxConsumptionStateId: string;   // foreign state id (W), default ''
    maxDischargeLimit: number;           // W, positive, default 5000
    sourceMaxAgeSeconds: number;         // positive int, default 120
}
```

`io-package.json` `native` gains:

```json
"controlEnabled": false,
"defaultStorageControlMode": 1,
"defaultFallbackMode": 1,
"commandTimeout": 120,
"houseConsumptionStateId": "",
"wallboxConsumptionStateId": "",
"maxDischargeLimit": 5000,
"sourceMaxAgeSeconds": 120
```

### 9. Config validation (`src/lib/config-validation.ts`)

`ConfigField` gains `'defaultStorageControlMode' | 'defaultFallbackMode' | 'commandTimeout' | 'houseConsumptionStateId' | 'wallboxConsumptionStateId' | 'maxDischargeLimit' | 'sourceMaxAgeSeconds'`. New rules (each error keyed by the offending field, Req 17.7):

- `defaultStorageControlMode`: integer in `[0, 4]` → else `defaultStorageControlMode` error (Req 17.1).
- `defaultFallbackMode`: integer in `[0, 7]` → else `defaultFallbackMode` error (Req 17.2).
- `commandTimeout`: a positive integer (`Number.isInteger && > 0`) **and** strictly greater than `pollInterval` (so each renewal outlives one poll cycle) → else `commandTimeout` error (Req 17.3).
- `maxDischargeLimit`: a positive number (`> 0`) → else `maxDischargeLimit` error (Req 17.4).
- `sourceMaxAgeSeconds`: a positive integer (`Number.isInteger && > 0`) → else `sourceMaxAgeSeconds` error (Req 17.5).
- When `controlEnabled` is true: `houseConsumptionStateId` and `wallboxConsumptionStateId` must be non-empty strings → else the respective field error (Req 17.6). When `controlEnabled` is false these are not required.

The existing `testConnection` handler still passes only host/port/unitId (plus a valid `pollInterval`); control fields are absent there, so they are validated only when present. Note: the `commandTimeout > pollInterval` rule is **reintroduced** here — but with a new motivation. It is no longer about an inverter-side revert window; it now guarantees the per-cycle timeout renewal always sets a value that outlives the interval until the next renewal (Req 10.3, 17.3).

### 10. React admin UI (`src-admin/src/components/Settings.tsx` + i18n)

New control settings are added below the existing connection fields. All labels go through `I18n.t(...)` and every new key is added to all eleven `src-admin/src/i18n/*.json` files (en, de, ru, pt, nl, fr, it, es, pl, uk, zh-cn):

- **Enable battery control** — `Checkbox` bound to `native.controlEnabled`, with a **prominent warning** rendered immediately next to it describing the **recommended** StorEdge portal prerequisite (Req 15.2): disabling the StorEdge storage profile in the SolarEdge monitoring portal / SetApp before enabling is recommended to avoid a ~10 s portal-side reversion on affected firmware, while noting that the renewed command timeout is the primary keep-alive.
- **Default Storage Control Mode** — MUI `Select` with **exactly five** options (Req 16.3): `0` Disabled; `1` Maximize Self Consumption; `2` Time of Use / Profile programming; `3` Backup Only; `4` Remote Control.
- **Default fallback mode** — numeric field bound to `native.defaultFallbackMode` (0..7), default 1 (Req 16.5).
- **Command timeout (s)** — numeric field bound to `native.commandTimeout`, default 120 (Req 16.5).
- **House consumption state id** — foreign-state-id text input bound to `native.houseConsumptionStateId` (Req 16.4).
- **Wallbox consumption state id** — foreign-state-id text input bound to `native.wallboxConsumptionStateId` (Req 16.4).
- **Max discharge limit (W)** — numeric field, default 5000.
- **Source max age (s)** — numeric field, default 120.

Validation is shared: `currentConfig()` is extended with the eight control fields and `validateConfig` drives per-field `error`/`helperText` exactly as the existing fields do (including per-field errors for the new **Default fallback mode** and **Command timeout (s)** fields). New i18n keys (English values shown) — every key is added to all eleven `src-admin/src/i18n/*.json` files:

```json
"Enable battery control": "Enable battery control",
"StorEdge portal warning": "Disabling the StorEdge storage profile in the SolarEdge monitoring portal / SetApp before enabling control is recommended to avoid a portal-side reversion on affected firmware. The renewed command timeout is the primary keep-alive.",
"Default Storage Control Mode": "Default Storage Control Mode",
"Default fallback mode": "Default fallback mode",
"Command timeout (s)": "Command timeout (s)",
"House consumption state": "House consumption state (W)",
"Wallbox consumption state": "Wallbox consumption state (W)",
"Max discharge limit (W)": "Max discharge limit (W)",
"Source max age (s)": "Source max age (s)",
"Mode 0 Disabled": "Disabled",
"Mode 1 Maximize Self Consumption": "Maximize Self Consumption",
"Mode 2 Time of Use": "Time of Use / Profile programming",
"Mode 3 Backup Only": "Backup Only",
"Mode 4 Remote Control": "Remote Control",
"Invalid default control mode": "Default control mode must be an integer between 0 and 4",
"Invalid default fallback mode": "Default fallback mode must be an integer between 0 and 7",
"Invalid command timeout": "Command timeout must be a positive integer greater than the poll interval",
"Invalid max discharge limit": "Max discharge limit must be a positive number",
"Invalid source max age": "Source max age must be a positive integer",
"Source id required": "A foreign state id is required when control is enabled"
```

## Data Models

### Control register (wire model)

| Register                        | Address  | Kind    | Words | Word order | FC   | Written?                | Notes                                          |
| ------------------------------- | -------- | ------- | ----- | ---------- | ---- | ----------------------- | ---------------------------------------------- |
| Export Configuration            | `0xE000` | uint16  | 1     | —          | FC06 | **written once** (=0) on enable | conflicts with Remote Control (Req 9.1) |
| Storage Control Mode            | `0xE004` | uint16  | 1     | —          | FC06 | enable (=4) + disable-revert only | range 0..4 (Req 9.2, 12.1, 12.4)     |
| Storage Default Mode            | `0xE00A` | uint16  | 1     | —          | FC06 | **written once** (=fallback) on enable | range 0..7 (Req 9.3, 12.5)     |
| Remote Control Command Timeout  | `0xE00B` | uint32  | 2     | le         | FC16 | enable + **renewed each cycle** | seconds, range 0..86400; `encodeUint32le` (Req 4.4, 10) |
| Remote Control Command Mode     | `0xE00D` | uint16  | 1     | —          | FC06 | enable + each cycle (=4) | range 0..7; 4 = discharge to explicit limit   |
| Remote Control Charge Limit     | `0xE00E` | float32 | 2     | le         | FC16 | expert-only, optional   | watts; `encodeFloat32le`                       |
| Remote Control Discharge Limit  | `0xE010` | float32 | 2     | le         | FC16 | enable + each cycle write-only-if-changed | watts; `encodeFloat32le`; 5000 W = `[0x4000, 0x459c]` |

Encoding: uint16 written verbatim (FC06); float32 encoded **little-endian word order** (`encodeFloat32le`, low word first, bytes big-endian within each word) via FC16 — the exact inverse of `decodeRegisters(..., 'float32le')`; uint32 (`0xE00B`) encoded **little-endian word order** (`encodeUint32le`, low word first) via FC16 — the exact inverse of `decodeRegisters(..., 'uint32le')`. Both `*le` decoders already serve the `0xE1xx` battery block.

### Control state (ioBroker model)

Under the expert/advanced `control` channel:

- `control.storageControlMode` (number, W/A raw `0xE004`, read+write)
- `control.remoteControlCommandMode` (number, raw `0xE00D`, read+write)
- `control.remoteControlDischargeLimit` (number W, raw `0xE010`, read+write)
- `control.remoteControlCommandTimeout` (number s, raw `0xE00B`, read-only; reflects the renewed value)
- `control.computedDischargeLimit` (number W, normal-surface reflection, read-only)
- `control.controlActive` (boolean status, read-only)

There is **no** `disableDischarge` boolean switch — the master enable is the `controlEnabled` config setting, not a state.

### Runtime state (adapter instance)

- `controlActive: boolean` — true after the `onReady` gate when `controlEnabled` is true; drives the heartbeat tail.
- `lastHouseSample: SourceSample | undefined` — last house consumption value + timestamp.
- `lastWallboxSample: SourceSample | undefined` — last wallbox consumption value + timestamp.
- `lastWritten0xE010: number | undefined` — last value written to the discharge-limit register, for write-only-if-changed.

## Error Handling

- **Write while disconnected** — `ModbusClient` write methods reject with `Modbus client is not connected` before any library call; `onStateChange` logs and retains the previous acked value; the heartbeat tail throw is caught by the cycle-failure path (Req 2.6, 14.1).
- **Write timeout** — bounded by `DEFAULT_TIMEOUT_MS` (10 s) via the same rejecting-timer race as reads; treated as a write failure (log + retain) (Req 2.7).
- **Modbus exception (e.g. exception 144 / illegal server response)** — a write throwing a Modbus exception is **non-fatal**: `onStateChange` logs and retains; the heartbeat path routes it through the existing cycle-failure handling. In particular, the per-cycle `0xE00B` timeout renewal (FC16 uint32le) can throw such an exception on some firmware; that follows the cycle-failure path and never terminates the adapter (Req 14.2, 11.6).
- **Invalid / stale source** — a missing, non-numeric, or too-old source makes `computeDischargeLimit` return **0**, so a bad feed parks discharge at zero rather than commanding a wrong limit (Req 6.2–6.4, 7.4).
- **Acked / deletion change** — ignored up front, preventing the adapter's own ack writes from re-triggering writes and skipping deletions (Req 13.5).
- **Unknown / read-only-state control id** — a change resolving to no def, or to a control state that is `write=false` (the `0xE00B` timeout reflection), is ignored; foreign ids other than the two configured sources are never subscribed.
- **`0xE000` / `0xE004` / `0xE00A` not written during heartbeat** — these initial-config registers are written only on enable (`0xE000`/`0xE00A` once; `0xE004` on enable and disable-revert). The `heartbeat` method contains no code path that writes them (Req 11.4, 12.4, 12.5).
- **Invalid control config** — `validateConfig` reports per-field errors (including `defaultFallbackMode` and `commandTimeout`); when `controlEnabled` is true and a control field is invalid the adapter follows the existing "invalid config → log and do not start" pattern for the control path, while read polling still runs when host is valid.
- **No revert on shutdown** — `onUnload` issues no write (Req 12.6); the inverter's own command timeout (last renewed value) governs behavior if the adapter dies while holding control.
- **Portal-revert mitigation** — the renewed short `commandTimeout` on `0xE00B` each cycle is the primary keep-alive; the recommended portal-profile-disabled prerequisite avoids the ~10 s portal-side revert on affected firmware (documented + admin warning, Req 15).

## Testing Strategy

Dual approach: **property tests** for input-varying logic (write encoding, computed-limit clamping, source validity, write-only-if-changed, dispatch, validation, heartbeat/initial-config write counting) and **example/edge tests** for deterministic wiring and fixed-value actions. Property tests run ≥100 iterations and are tagged `Feature: storedge-battery-control, Property {n}: {text}`.

### Unit / property tests

- **FC06/FC16 forwarding & selection** — property: `writeSingleRegister` forwards exactly `(address, uint16)`, `writeMultipleRegisters` forwards exactly `(address, words)` to a recording client double, and `ControlWriter.write` selects FC06 for uint16 defs, FC16 + `encodeFloat32le` for float32 defs, and FC16 + `encodeUint32le` for the uint32 def `0xE00B` (Property 2).
- **Not-connected rejection** — property: any write kind/args with `isConnected()===false` ⇒ rejects and issues no library call (Property 3).
- **float32le round-trip** — property over finite float32 values: `decodeRegisters(encodeFloat32le(v), 'float32le') === v` (bit-exact after rounding), plus the fixed vector `encodeFloat32le(5000) === [0x4000, 0x459c]` (Property 4).
- **uint32le round-trip** — property over uint32 values: `decodeRegisters(encodeUint32le(v), 'uint32le') === v`, low word first (Property 5).
- **Computed-limit clamping** — property over house/wallbox/max: result equals `min(max(house-wallbox,0),max)` and lies in `[0, max]` (Property 6); invalid/stale source ⇒ 0 (Property 7).
- **Write-only-if-changed** — model-based property over a sequence of computed limits: `0xE010` write count equals the number of values differing from the previous written value, and `lastWritten` tracks the last write (Property 8).
- **Initial-config sequence** — property: `applyEnable(limit, opts)` issues exactly the six writes `0xE000=0`, `0xE004=4`, `0xE00A=defaultFallbackMode`, `0xE00D=4`, `0xE00B=commandTimeout` (uint32le, FC16), `0xE010=limit` (float32le, FC16) **in that order** (Property 9).
- **Heartbeat renew/re-assert** — property over N active cycles: exactly N unconditional writes of `0xE00B=commandTimeout` (uint32le) and N of `0xE00D=4`, `0xE010` written only on changed cycles, and **no** write to `0xE000`, `0xE004`, or `0xE00A`; none after disable (Property 10).
- **Dispatch / ack / ignore-acked** — property: any non-acked change on a writable control id routes one write to the correct register+FC with the same value and acks once on success; a failing write acks nothing (retains prior); any `ack=true` change issues zero writes (Properties 12, 13).
- **Read-only-when-disabled** — property: with `controlEnabled=false`, across `onReady` + N poll cycles + injected state changes, zero write function codes are issued and no subscription is registered (Property 1).
- **Revert scope** — property/example: the OFF transition writes `0xE004=default` and stops the heartbeat; `onUnload` issues no control write (Property 14).
- **Config validation** — properties over `defaultStorageControlMode` (int [0,4]), `defaultFallbackMode` (int [0,7]), `commandTimeout` (positive int and `> pollInterval`), `maxDischargeLimit` (>0), `sourceMaxAgeSeconds` (positive int), and the required-non-empty source ids when `controlEnabled` (Properties 15–20), each asserting the field-keyed error.
- **Control-state metadata** — example: each expert writable state has `read=true, write=true`; the `0xE00B` timeout state is `read=true, write=false` (reflects the renewed value); no control state derives from `SUNSPEC_MAP`/`BATTERY_MAP` (supports Property 14/13.6).

### Revised existing property test

`src/lib/modbus-client.test.ts` **Property 4 (read-only invariant)** is revised: `writeSingleRegister`/`writeMultipleRegisters`/`writeRegister`/`writeRegisters` move out of `FORBIDDEN_WRITE_METHODS` into the allowed write surface; coil methods stay forbidden; the "reads issue only FC03/FC04" arm remains.

### Integration

`src/lib/integration.test.ts` gains a control scenario against a mock client: enable → verify the ordered initial-config sequence (`0xE000=0`, `0xE004=4`, `0xE00A=fallback`, `0xE00D=4`, `0xE00B=commandTimeout`, `0xE010=limit`) → drive two source changes and two poll cycles → verify per-cycle renewal of `0xE00B`, re-assert of `0xE00D`, write-only-if-changed on `0xE010`, and **no** re-write of `0xE000`/`0xE004`/`0xE00A` → disable → verify `0xE004=default` and heartbeat stops.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Read-only when control is disabled

*For any* sequence of poll cycles and injected state changes, when `controlEnabled` is false the adapter issues zero Modbus write function codes, registers no consumption-source or control-state subscription, and performs no heartbeat, while its FC03/FC04 read polling continues unchanged.

**Validates: Requirements 1.2, 1.3, 1.4, 1.5**

### Property 2: FC06/FC16 forwarding and function-code selection

*For any* register address and any value, `writeSingleRegister(address, v)` forwards exactly that address and uint16 value via FC06 and `writeMultipleRegisters(address, words)` forwards exactly that address and word array via FC16, issuing no other write; and the control writer selects FC06 for every uint16 register (`0xE000`, `0xE004`, `0xE00A`, `0xE00D`), FC16 with `encodeFloat32le` for every float32 register (`0xE010`, `0xE00E`), and FC16 with `encodeUint32le` for the uint32 register (`0xE00B`).

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.4**

### Property 3: Writes are rejected when not connected

*For any* write kind (FC06 or FC16) and any arguments, when the client is not connected the operation rejects with a descriptive error and no underlying library write method is called.

**Validates: Requirements 2.6**

### Property 4: float32le encoding round-trips against the existing decoder

*For any* finite float32 value `v`, `decodeRegisters(encodeFloat32le(v), 'float32le')` reproduces `v` (bit-exact after float32 rounding) with the low word first and big-endian bytes within each word, and in particular `encodeFloat32le(5000)` equals `[0x4000, 0x459c]`.

**Validates: Requirements 5.1, 5.2, 5.3, 5.4**

### Property 5: uint32le encoding round-trips against the existing decoder

*For any* unsigned 32-bit integer `v`, `decodeRegisters(encodeUint32le(v), 'uint32le')` reproduces `v` exactly, with the low 16-bit word first (`words[0]`) and the high word second (`words[1]`); the encoder is the exact inverse of `decodeRegisters(..., 'uint32le')` used for the command timeout `0xE00B`.

**Validates: Requirements 4.4, 5.1**

### Property 6: Computed discharge limit clamps to `[0, maxDischargeLimit]`

*For any* valid house and wallbox consumption values and any `maxDischargeLimit`, the computed limit equals `min(max(house - wallbox, 0), maxDischargeLimit)`; in particular a negative difference yields 0 and a difference above `maxDischargeLimit` yields `maxDischargeLimit`, so the result always lies in `[0, maxDischargeLimit]`.

**Validates: Requirements 7.1, 7.2, 7.3**

### Property 7: Invalid or stale source forces the limit to zero

*For any* pair of source samples in which at least one is missing, non-numeric, or older than `sourceMaxAgeSeconds`, the computed discharge limit is 0.

**Validates: Requirements 6.2, 6.3, 6.4, 7.4**

### Property 8: Discharge limit is written only when it changes

*For any* sequence of computed discharge limits, `0xE010` is written exactly on those steps where the value differs from the last value written to `0xE010`, is not written when the value is unchanged, and the last-written value is updated to each value actually written.

**Validates: Requirements 8.1, 8.2, 8.3**

### Property 9: Initial configuration writes the full sequence in order

*For any* computed limit, `defaultFallbackMode`, and `commandTimeout`, enabling control issues exactly the six writes, in this order: `0xE000 = 0` (FC06), `0xE004 = 4` (FC06), `0xE00A = defaultFallbackMode` (FC06), `0xE00D = 4` (FC06), `0xE00B = commandTimeout` (FC16, `encodeUint32le`), and `0xE010 = computedLimit` (FC16, `encodeFloat32le`); no other register is written during initial configuration.

**Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 10.1**

### Property 10: Heartbeat renews the timeout and command mode but never the initial-config registers

*For any* sequence of poll cycles while control is active, each cycle issues one unconditional FC16 write of `0xE00B = commandTimeout` (`encodeUint32le`) and one unconditional FC06 write of `0xE00D = 4` regardless of their previous values, refreshes `0xE010` only subject to the write-only-if-changed rule, and issues **no** write to Export Configuration `0xE000`, Storage Control Mode `0xE004`, or Storage Default Mode `0xE00A`; after control is disabled no such writes occur in subsequent cycles.

**Validates: Requirements 10.2, 11.1, 11.2, 11.3, 11.4, 11.5, 12.3, 12.4, 12.5**

### Property 11: Heartbeat write failures are non-fatal

*For any* heartbeat cycle in which a control write throws a Modbus exception, the adapter follows the existing poll-cycle failure path and continues running rather than terminating.

**Validates: Requirements 11.6, 14.2**

### Property 12: User changes dispatch the correct write and acknowledge on success

*For any* non-acknowledged change on a writable expert control state, the adapter dispatches exactly one write to that register using the correct function code with the same value (honoring write-only-if-changed for `0xE010`); on success it sets the state once with `ack=true`, and on failure it writes no new acknowledged value and retains the previously acknowledged value while continuing to run.

**Validates: Requirements 13.4, 14.1, 14.3**

### Property 13: Acknowledged changes issue no write

*For any* control-state change carrying `ack=true`, the adapter issues zero Modbus writes, so adapter-originated acknowledgments never trigger further writes.

**Validates: Requirements 13.5**

### Property 14: Revert happens on disable only, never on unload

*For any* execution, disabling control (the `controlEnabled` OFF transition) writes `defaultStorageControlMode` to `0xE004` and stops the heartbeat and source subscriptions, whereas adapter unload performs no control write.

**Validates: Requirements 12.1, 12.2, 12.6**

### Property 15: Default control mode bound

*For any* number, the validator accepts `defaultStorageControlMode` if and only if it is an integer in `[0, 4]`; otherwise it reports an error keyed by `defaultStorageControlMode`.

**Validates: Requirements 17.1, 17.7**

### Property 16: Default fallback mode bound

*For any* number, the validator accepts `defaultFallbackMode` if and only if it is an integer in `[0, 7]`; otherwise it reports an error keyed by `defaultFallbackMode`.

**Validates: Requirements 17.2, 17.7**

### Property 17: Command timeout is a positive integer greater than the poll interval

*For any* number and any poll interval, the validator accepts `commandTimeout` if and only if it is a positive integer strictly greater than the poll interval; otherwise it reports an error keyed by `commandTimeout`.

**Validates: Requirements 10.3, 17.3, 17.7**

### Property 18: Max discharge limit positivity

*For any* number, the validator accepts `maxDischargeLimit` if and only if it is strictly positive; otherwise it reports an error keyed by `maxDischargeLimit`.

**Validates: Requirements 17.4, 17.7**

### Property 19: Source max age is a positive integer

*For any* number, the validator accepts `sourceMaxAgeSeconds` if and only if it is a positive integer; otherwise it reports an error keyed by `sourceMaxAgeSeconds`.

**Validates: Requirements 17.5, 17.7**

### Property 20: Source ids required when control is enabled

*For any* configuration with `controlEnabled` true, the validator accepts the configuration only when both `houseConsumptionStateId` and `wallboxConsumptionStateId` are non-empty strings; otherwise it reports an error keyed by the offending source-id field.

**Validates: Requirements 17.6, 17.7**
