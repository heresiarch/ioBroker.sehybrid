# Design Document

## Overview

This feature exposes the SolarEdge StorEdge **Global StorEdge Control Block** — nine manufacturer-documented registers at base address `0xE004` (mirrored at `0xF704`) — as a new, always-present, always-active ioBroker channel named `StorEdgeControlBlock`, added onto the existing strictly read-only SunSpec adapter. Today the adapter reads only: `src/lib/modbus-client.ts` exposes FC03/FC04 with a shared 10 s rejecting-timer timeout and a documented read-only invariant (property-tested); `src/lib/state-manager.ts` derives `write=false` states from the SunSpec register map; `src/main.ts` runs a single `pollOnce` `setInterval` loop with an overlap guard, reconnect-on-failure, and `info.connection` handling, and there is no `this.on('stateChange', …)` subscription. `src/lib/sunspec-decode.ts` already decodes/encodes little-endian-word-order values as `float32le`/`uint32le` (`decodeRegisters`, `encodeFloat32le`, `encodeUint32le`) for the `0xE1xx` battery block; this exact convention is reused unchanged for the control block.

**What changed from the previous (deleted) design.** The prior iteration of this feature was consumption-based: a master `controlEnabled` config switch gated a `ControlWriter` lifecycle (`applyEnable`/`heartbeat`/`applyRevert`) that computed a discharge limit from two foreign house/wallbox consumption states and drove only `0xE010` (plus a fixed initial-configuration sequence touching `0xE000`, `0xE004`, `0xE00A`, `0xE00B`, `0xE00D`). That entire mechanism is **deleted**: there is no `Control_Enabled`/`controlEnabled`, no `Computed_Discharge_Limit`, no `consumption.ts`, no `houseConsumptionStateId`/`wallboxConsumptionStateId`, no heartbeat renewal loop, no initial-configuration write sequence, no `EnableOptions`/`applyEnable`/`heartbeat`/`applyRevert` lifecycle, no `defaultStorageControlMode`/`defaultFallbackMode`/`commandTimeout` config fields, and no StorEdge portal-profile prerequisite or admin warning. `ControlWriter` as a stateful lifecycle class is gone.

**What replaces it.** The adapter now exposes all nine registers of the Global StorEdge Control Block — not just `0xE010` — as one flat, always-on, unconditionally-created channel. There is no master enable switch and no admin configuration of any kind for this feature: the channel and its nine states are created unconditionally at every adapter startup, independent of any config value. The nine registers are read every `pollOnce` cycle on the same schedule as the inverter/meter/battery blocks, and each state is updated with the **live device value** with `ack=true`. The same nine states accept user writes: on a non-acknowledged change, the adapter range-validates the candidate against the register's documented bounds and, if valid, writes it via FC06 or FC16 using the existing little-endian encoding; every validation-passing write is sent (there is no "write-only-if-changed" suppression this time — Requirement 7.2 explicitly forbids it, unlike the old `0xE010`-only design). The user decides what to write to these registers and when — for example from their own ioBroker scripts — the adapter itself never computes a target value or drives one from any other source. These nine `StorEdgeControlBlock` states are the only `write=true` states in the adapter.

Design constraints that shape every decision below:

- **Reuse the existing poll loop.** The nine-register read is appended to the `pollOnce` tail inside the existing `try`, on the existing schedule; no separate timer.
- **Keep control separate from the read model.** The register definitions are a new, standalone module — a sibling of `sunspec-map.ts`, never an entry in `SUNSPEC_MAP`/`BATTERY_MAP` — and the states are created outside the register-map-driven read model (Req 5.1, 8.4).
- **Reads are untouched.** FC03/FC04 behavior is unchanged; the only client surface used by this feature is `writeSingleRegister` (FC06) and `writeMultipleRegisters` (FC16), now exercised **unconditionally** rather than behind any enable gate (Req 1.8, 2.1, 2.2).
- **Little-endian multiword encoding, reused.** `encodeFloat32le`/`encodeUint32le` and `decodeRegisters(..., 'float32le'|'uint32le')` already exist in `sunspec-decode.ts` (proven against the `0xE1xx` battery block) and are reused verbatim — no new encoding logic (Req 4).
- **No admin surface for this feature.** No config field, no React settings section, no i18n keys. The channel behaves identically regardless of any admin setting (Req 8.3).
- **No lifecycle.** No enable/disable, no heartbeat, no revert-on-disable/unload. The nine states are simply always readable and always writable.

Language for all code examples: **TypeScript** (matching the existing adapter).

## Architecture

### Component overview

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│ main.ts  (Sehybrid extends utils.Adapter)                                       │
│                                                                                   │
│  onReady()                                                                       │
│    ├─ validateConfig(config)              (unchanged: host/port/unitId/pollInterval)│
│    ├─ build ModbusClient / StateManager / SunSpecReader                          │
│    ├─ stateManager.ensureStorEdgeControlBlock()   ← UNCONDITIONAL, every start   │
│    ├─ subscribeStates('StorEdgeControlBlock.*')   ← UNCONDITIONAL, every start   │
│    ├─ this.on('stateChange', onStateChange)       ← registered in constructor    │
│    ├─ pollOnce()                          (connects the client on demand)        │
│    └─ setInterval(pollOnce, pollInterval*1000)                                   │
│                                                                                   │
│  onStateChange(id, state)                                                        │
│    ├─ if !state → ignore (deletion)                                              │
│    ├─ if state.ack → ignore (adapter-originated readback)                        │
│    ├─ leaf not under 'StorEdgeControlBlock.' → ignore (not this feature)          │
│    ├─ no matching register def → ignore (unknown leaf)                           │
│    ├─ Range_Validation against def.min/def.max                                   │
│    │     invalid → log error, do NOT write, do NOT ack (retain previous)         │
│    │     valid   → write via FC06 (uint16) or FC16 (float32le/uint32le)          │
│    ├─ on success → ack with the written value                                    │
│    └─ on failure (disconnected/timeout/exception) → log, retain, non-fatal       │
│                                                                                   │
│  pollOnce()  (existing inverter/meter/battery reads unchanged)                    │
│    └─ StorEdgeControlBlock read tail (inside the existing try, every cycle):     │
│         read span 0xE004..0xE00C (9 words) + span 0xE00D..0xE011 (5 words)       │
│         decode each of the 9 defs by kind/wordOrder                              │
│         writeValue-style ack each state with the live value (ack=true)           │
│                                                                                   │
│  onUnload()  → clear timer, close socket (unchanged, no control write)           │
└─────────────────────────────────────────────────────────────────────────────────┘
        │ reads (FC03/FC04, unchanged)      │ writes (FC06/FC16, unconditional)
        ▼                                    ▼
┌──────────────────────────────────┐   ┌──────────────────────────────────────┐
│ ModbusClient (modbus-client.ts)  │   │ storedge-control-map.ts (NEW, sibling │
│  read: FC03 / FC04 (unchanged)   │   │ of sunspec-map.ts — never polled via  │
│  write: writeSingleRegister FC06 │   │ the SunSpec read model)               │
│         writeMultipleRegisters   │   │  0xE004 0xE005 0xE006 0xE008 0xE00A   │
│         FC16                     │   │  0xE00B 0xE00D 0xE00E 0xE010          │
└──────────────────────────────────┘   │  findStorEdgeControlDef()             │
              │ le words               └──────────────────────────────────────┘
              ▼
   sunspec-decode.ts: decodeRegisters(..., 'float32le'|'uint32le'|'uint16')
                       encodeFloat32le / encodeUint32le   (reused, unchanged)
```

### Control flow

There is no state machine and no enable/disable transition. The channel is either being read (every poll cycle) or being written (on a non-acked state change); both paths are always active from the moment `onReady` completes.

```
onReady (every adapter start, unconditionally):
  ensureStorEdgeControlBlock()          // channel + 9 states, read=true write=true
  subscribeStates('StorEdgeControlBlock.*')
  (stateChange handler already registered in the constructor)

Each pollOnce cycle, AFTER the existing inverter/meter/battery reads, INSIDE the existing try:
  words1 = readHoldingRegisters(0xE004, 9)   // covers 0xE004..0xE00C (through the 2nd word of 0xE00B's uint32)
  words2 = readHoldingRegisters(0xE00D, 5)   // covers 0xE00D..0xE011 (through the 2nd word of 0xE010's float32)
  for each of the 9 defs:
    decode from the appropriate span using def.kind/def.wordOrder
    writeValue-style ack the state: { val: decoded, ack: true }
  // a read failure here follows the NORMAL cycle-failure path (info.connection=false,
  // close socket, reconnect next cycle) — no special-casing (Req 5.4)

On a state change under 'StorEdgeControlBlock.<leaf>':
  if !state → return                          // deletion
  if state.ack → return                        // adapter's own read-back ack
  def = findStorEdgeControlDef(leaf)
  if !def → return                              // unknown leaf, ignore
  if value < def.min || value > def.max:
    log.error(...); return                      // reject pre-write, retain previous, no ack
  write via FC06 (uint16) or FC16 (float32le/uint32le encoding), EVERY time (Req 7.2)
  on success → ack with the written value
  on failure (disconnected / timeout / Modbus exception) → log.error(...); retain; non-fatal
```

## Components and Interfaces

### 1. Register definitions — new module (`src/lib/storedge-control-map.ts`)

A flat, static definition list for the nine registers, deliberately a **sibling** of `sunspec-map.ts` — never an entry in `SUNSPEC_MAP`/`BATTERY_MAP`, never polled via the SunSpec model, never mixed with inverter/meter/battery defs (Req 3.10, 8.4).

```ts
// StorEdge Global StorEdge Control Block register definitions.
//
// Pure, static data describing the nine manufacturer-documented registers at base
// address 0xE004 (mirrored at 0xF704). This module is a SIBLING of sunspec-map.ts:
// it is never polled via the SunSpec read model and never appears in SUNSPEC_MAP /
// BATTERY_MAP. Multi-word registers use little-endian word order (low word first,
// bytes big-endian within each word) — the same float32le/uint32le convention
// already implemented in sunspec-decode.ts for the 0xE1xx battery block.
//
// Requirements: 2.3, 2.4, 3.1-3.10, 4.1-4.5

export type StorEdgeControlKind = 'uint16' | 'float32' | 'uint32';
export type StorEdgeWordOrder = 'le'; // little-endian word order for multiword regs

/**
 * Conservative upper bound for Battery_Max_Power (W), used as the Documented_Range
 * maximum for Remote_Control_Charge_Limit (0xE00E) and Remote_Control_Discharge_Limit
 * (0xE010). See "On the two manufacturer-symbolic upper bounds" below for rationale.
 */
export const BATTERY_MAX_POWER_W = 10000;

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

export const STORAGE_CONTROL_MODE: StorEdgeControlRegisterDef = {
    name: 'storageControlMode', address: 0xe004, kind: 'uint16', length: 1,
    iobType: 'number', min: 0, max: 4, fc: 'FC06',
};
export const STORAGE_AC_CHARGE_POLICY: StorEdgeControlRegisterDef = {
    name: 'storageAcChargePolicy', address: 0xe005, kind: 'uint16', length: 1,
    iobType: 'number', min: 0, max: 3, fc: 'FC06',
};
export const STORAGE_AC_CHARGE_LIMIT: StorEdgeControlRegisterDef = {
    name: 'storageAcChargeLimit', address: 0xe006, kind: 'float32', length: 2, wordOrder: 'le',
    iobType: 'number', unit: 'kWh', min: 0, max: Number.MAX_VALUE, fc: 'FC16',
};
export const STORAGE_BACKUP_RESERVED_SETTING: StorEdgeControlRegisterDef = {
    name: 'storageBackupReservedSetting', address: 0xe008, kind: 'float32', length: 2, wordOrder: 'le',
    iobType: 'number', unit: '%', min: 0, max: 100, fc: 'FC16',
};
export const STORAGE_CHARGE_DISCHARGE_DEFAULT_MODE: StorEdgeControlRegisterDef = {
    name: 'storageChargeDischargeDefaultMode', address: 0xe00a, kind: 'uint16', length: 1,
    iobType: 'number', min: 0, max: 7, fc: 'FC06',
};
export const REMOTE_CONTROL_COMMAND_TIMEOUT: StorEdgeControlRegisterDef = {
    name: 'remoteControlCommandTimeout', address: 0xe00b, kind: 'uint32', length: 2, wordOrder: 'le',
    iobType: 'number', unit: 's', min: 0, max: 86400, fc: 'FC16',
};
export const REMOTE_CONTROL_COMMAND_MODE: StorEdgeControlRegisterDef = {
    name: 'remoteControlCommandMode', address: 0xe00d, kind: 'uint16', length: 1,
    iobType: 'number', min: 0, max: 7, fc: 'FC06',
};
export const REMOTE_CONTROL_CHARGE_LIMIT: StorEdgeControlRegisterDef = {
    name: 'remoteControlChargeLimit', address: 0xe00e, kind: 'float32', length: 2, wordOrder: 'le',
    iobType: 'number', unit: 'W', min: 0, max: BATTERY_MAX_POWER_W, fc: 'FC16',
};
export const REMOTE_CONTROL_DISCHARGE_LIMIT: StorEdgeControlRegisterDef = {
    name: 'remoteControlDischargeLimit', address: 0xe010, kind: 'float32', length: 2, wordOrder: 'le',
    iobType: 'number', unit: 'W', min: 0, max: BATTERY_MAX_POWER_W, fc: 'FC16',
};

export const STOREDGE_CONTROL_REGISTERS: readonly StorEdgeControlRegisterDef[] = [
    STORAGE_CONTROL_MODE, STORAGE_AC_CHARGE_POLICY, STORAGE_AC_CHARGE_LIMIT,
    STORAGE_BACKUP_RESERVED_SETTING, STORAGE_CHARGE_DISCHARGE_DEFAULT_MODE,
    REMOTE_CONTROL_COMMAND_TIMEOUT, REMOTE_CONTROL_COMMAND_MODE,
    REMOTE_CONTROL_CHARGE_LIMIT, REMOTE_CONTROL_DISCHARGE_LIMIT,
];

/** Resolve the register def for a StorEdgeControlBlock state-id leaf, or undefined. */
export function findStorEdgeControlDef(name: string): StorEdgeControlRegisterDef | undefined {
    return STOREDGE_CONTROL_REGISTERS.find(def => def.name === name);
}
```

**On the two "manufacturer-symbolic" upper bounds.** The manufacturer table specifies two registers' maximum as a named quantity rather than a fixed number:

- `Storage_AC_Charge_Limit` (`0xE006`) uses **Max_Float** as its upper bound. This is genuinely "the largest representable float32", so `max: Number.MAX_VALUE` is the correct, literal encoding — there is no narrower manufacturer-given number to substitute, and any finite value the user could plausibly write is far below it. Range validation against `Number.MAX_VALUE` still catches negative values (the documented minimum is 0) and non-finite input, which is the validation that actually matters for this register.
- `Remote_Control_Charge_Limit` (`0xE00E`) and `Remote_Control_Discharge_Limit` (`0xE010`) use **Battery_Max_Power** as their upper bound — an inverter-model-specific wattage the adapter has no reliable runtime source for (it is not itself a SunSpec register this adapter reads, and differs per battery model/count). Rather than silently falling back to `Number.MAX_VALUE` (which would make range validation on these two registers a no-op beyond rejecting negatives, defeating Requirement 6's intent), the design introduces one named constant, `BATTERY_MAX_POWER_W = 10000` (declared above, alongside the def table it feeds). SolarEdge StorEdge battery packs (LG/BYD/Panasonic modules supported by SolarEdge inverters) top out around 5000 W per battery; 10 kW is intentionally generous enough to accommodate multi-battery installations (`battery.1` + `battery.2`, matching the existing `BATTERY_REGISTER_OFFSETS` support for up to two slots) without under-rejecting a legitimate two-battery configuration, while still catching obviously invalid input (e.g. a stray six-figure watt value from a unit-conversion bug).

  This is a documented, named, adjustable constant rather than a magic number or an unbounded escape hatch — it keeps range validation meaningful for the two registers where it matters most operationally (charge/discharge power limits) while avoiding a false rejection of valid multi-battery installations. If a future installation exceeds this, the constant is the single place to widen it.

### 2. Reused encoding (`src/lib/sunspec-decode.ts`) — no changes

`decodeRegisters(words, 'float32le' | 'uint32le' | 'uint16')` and `encodeFloat32le`/`encodeUint32le` already exist and are exercised by the `0xE1xx` battery block today. This feature reuses them verbatim for both the poll-read decode path and the write-dispatch encode path — no new encode/decode logic is written. `uint16` registers need no multiword encoding at all: the raw integer is passed straight to `writeSingleRegister`.

### 3. State manager — `ensureStorEdgeControlBlock()` (`src/lib/state-manager.ts`)

The old `ensureControlStates`/`setControlAck` pair (built for the deleted consumption-based design's `control` channel) is **removed**. In its place, a simpler, register-map-driven-but-separate helper creates the `StorEdgeControlBlock` channel and its nine states, all `read=true, write=true`, idempotently, following the exact same `setObjectNotExistsAsync` + in-memory `Set` idempotency pattern already used for `ensureChannel`/`ensureState` (Req 8.2).

```ts
export interface IStateManager {
    // ... existing SunSpec methods unchanged: ensureChannel / ensureState / writeValue ...

    /** Create the StorEdgeControlBlock channel and its nine states (idempotent, unconditional). */
    ensureStorEdgeControlBlock(): Promise<void>;
    /** Write a live-read value to a StorEdgeControlBlock state with ack=true (poll-read path). */
    writeStorEdgeValue(def: StorEdgeControlRegisterDef, value: number): Promise<void>;
    /** Acknowledge a successful user-driven write with the written value (write-dispatch path). */
    ackStorEdgeWrite(def: StorEdgeControlRegisterDef, value: number): Promise<void>;
}
```

`ensureStorEdgeControlBlock()` creates a plain (non-expert) `StorEdgeControlBlock` channel — **not** flagged `common.expert = true` — because, per the requirements, this is now the primary, intended way to reach these registers (no other UI is provided; there is no consumption-based automation hidden behind it any more). This mirrors the existing plain `inverter`/`meter.<n>`/`battery.<n>` channel pattern rather than the old design's expert-gated `control` channel. For each of the nine defs it creates a state with:

- `common.type = 'number'`
- `common.role` — `'level.mode'` for the two mode-selector registers (`storageControlMode`, `storageChargeDischargeDefaultMode`), `'switch.mode'` is avoided (not a boolean); `'level.mode'` also used for `storageAcChargePolicy` and `remoteControlCommandMode`; power/energy/percent/time registers get `'value.power'`, `'value.energy'`, `'value.fill'`, `'value.interval'` respectively — the same `ROLE_MAP`-style convention already used for SunSpec states.
- `common.unit` set from `def.unit` when present, omitted otherwise (same convention as `ensureState`).
- `common.read = true`, `common.write = true` — **every one of the nine, no exceptions** (Req 9.1).
- `common.min`/`common.max` set from `def.min`/`def.max` so the admin object tree itself documents the accepted range (a natural extension of exposing `min`/`max` on the def; purely descriptive, the adapter still performs its own validation before writing).

Both `writeStorEdgeValue` (poll-read path) and `ackStorEdgeWrite` (write-dispatch success path) write `{ val: value, ack: true }` to `StorEdgeControlBlock.<def.name>`; they are two thin, identically-shaped helpers (or one shared private helper with two public names) kept distinct only so call sites at the two call sites read clearly — both are trivial wrappers around the existing `setStateAsync` pattern used by `writeValue`/the old `setControlAck`. Because these nine states are the only ones created with `write: true`, a test asserts no other state (SunSpec-derived or otherwise) is ever created with `write: true` (Req 9.2, 9.3).

### 4. main.ts — unconditional wiring

**`onReady` changes.** The `controlEnabled` gate is deleted entirely — there is no config check of any kind for this feature. Unconditionally, on every adapter start, immediately after the existing `ensureChannel('inverter')`:

```ts
await this.stateManager.ensureStorEdgeControlBlock();
this.subscribeStates('StorEdgeControlBlock.*');
```

The `stateChange` handler registration (`this.on('stateChange', this.onStateChange.bind(this))`) stays in the constructor as it already is — it is simply no longer a no-op, since `StorEdgeControlBlock.*` is now always subscribed. No other part of `onReady` changes: config validation, client/reader/state-manager construction, the first `pollOnce()`, and the repeating `setInterval` are all unchanged.

**`pollOnce` changes.** After the existing inverter/meter/battery read blocks, inside the same `try` (so a read failure here follows the *normal* cycle-failure path — `info.connection=false`, close socket, reconnect next cycle — with no special-casing, Req 5.4):

```ts
// --- StorEdgeControlBlock read (Req 5.1-5.4) --------------------------------
// Minimal round-trips: the nine registers span two contiguous windows —
// 0xE004..0xE00C (9 words: Storage_Control_Mode, Storage_AC_Charge_Policy,
// Storage_AC_Charge_Limit [2w], Storage_Backup_Reserved_Setting [2w],
// Storage_Charge_Discharge_Default_Mode, Remote_Control_Command_Timeout [2w])
// and 0xE00D..0xE011 (5 words: Remote_Control_Command_Mode,
// Remote_Control_Charge_Limit [2w], Remote_Control_Discharge_Limit [2w]) — with
// no gap between either span internally, but a register-map discontinuity is not
// assumed between the two windows, so they are read as two requests, mirroring
// the existing BATTERY_READ_SEGMENTS segmented-read pattern in sunspec-map.ts /
// sunspec-reader.ts rather than nine individual reads.
const blockWordsA = await client.readHoldingRegisters(0xe004, 9); // 0xE004..0xE00C
const blockWordsB = await client.readHoldingRegisters(0xe00d, 5); // 0xE00D..0xE011
for (const def of STOREDGE_CONTROL_REGISTERS) {
    const words = wordsForDef(def, blockWordsA, blockWordsB); // slices the right window by address
    const value = decodeRegisters(words, wireDatatype(def)); // 'uint16' | 'float32le' | 'uint32le'
    if (value !== null) {
        await stateManager.writeStorEdgeValue(def, value as number);
    }
}
```

`wireDatatype(def)` maps `kind:'uint16'` → `'uint16'`, `kind:'float32'` (always `wordOrder:'le'` here) → `'float32le'`, `kind:'uint32'` → `'uint32le'` — i.e. it selects the exact `SunSpecDatatype` string `decodeRegisters` expects, reusing that function rather than duplicating decode logic. This runs **every cycle, unconditionally** — there is no config check and no "only when enabled" branch, matching Requirement 8.3's "behaves identically regardless of any admin configuration setting."

**`onStateChange` — replacing the old control dispatch.** The old foreign-source-driven Route 1 (house/wallbox consumption) is deleted entirely along with `computeDischargeLimit`/`isSourceValid`/the sample cache. The old Route 2 (`WRITABLE_EXPERT` set, `findControlDef`, write-only-if-changed on `0xE010`) is replaced by a single, simpler path over the new nine-register table:

```ts
private onStateChange(id: string, state: ioBroker.State | null | undefined): void {
    if (!state) return;                 // deletion — ignore
    if (state.ack) return;              // adapter's own poll-read ack or write-ack — ignore
    void this.handleStorEdgeControlChange(id, state);
}

private async handleStorEdgeControlChange(id: string, state: ioBroker.State): Promise<void> {
    const prefix = `${this.namespace}.StorEdgeControlBlock.`;
    if (!id.startsWith(prefix)) return;                 // not this feature — ignore
    const leaf = id.slice(prefix.length);
    const def = findStorEdgeControlDef(leaf);
    if (!def) return;                                    // unknown leaf — ignore

    const value = Number(state.val);
    if (!Number.isFinite(value) || value < def.min || value > def.max) {
        this.log.error(
            `Rejected write to ${leaf} (0x${def.address.toString(16).toUpperCase()}): ` +
            `${state.val} is outside the documented range [${def.min}, ${def.max}]`,
        );
        return;                                          // out-of-range: no write, no ack, retain previous
    }

    try {
        if (def.kind === 'uint16') {
            await this.modbusClient!.writeSingleRegister(def.address, value);          // FC06
        } else if (def.kind === 'float32') {
            await this.modbusClient!.writeMultipleRegisters(def.address, encodeFloat32le(value)); // FC16
        } else {
            await this.modbusClient!.writeMultipleRegisters(def.address, encodeUint32le(value));  // FC16
        }
        await this.stateManager!.ackStorEdgeWrite(def, value);                          // ack on success
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        this.log.error(
            `Failed to write ${leaf} (0x${def.address.toString(16).toUpperCase()}) = ${value}: ${reason}. ` +
            `Retaining the previously acknowledged value.`,
        );
        // non-fatal: no ack on failure, previous acked value is retained as-is
    }
}
```

Dispatch is inlined directly against `this.modbusClient` — no separate `ControlWriter` class. The old `ControlWriter`'s value came from centralizing `applyEnable`/`heartbeat`/`applyRevert` lifecycle orchestration across many call sites; none of that lifecycle exists any more, so a dedicated dispatch class would only wrap a three-way `switch` that is already this short inline. Every validation-passing write is sent unconditionally — there is deliberately **no** "write-only-if-changed" suppression (Requirement 7.2), unlike the old design's `0xE010`-specific behavior.

**Removed from main.ts entirely:** `enableControl`, `disableControl`, `WRITABLE_EXPERT`, `controlActive`, `controlWriter` (the field and the `ModbusControlWriter` import), `lastWritten0xE010`, `lastHouseSample`, `lastWallboxSample`, the `computeDischargeLimit`/`SourceSample` import, the `findControlDef`/`REMOTE_CONTROL_DISCHARGE_LIMIT` import from the deleted `control-registers.ts`, and the heartbeat tail in `pollOnce`.

**`onUnload`** is unchanged: it still only clears the timer and closes the socket. There is no lifecycle to revert, so no new logic is needed (there never was any StorEdge-specific write-on-unload logic even in the old design; this simply stays exactly as-is).

### 5. Modbus client (`src/lib/modbus-client.ts`) — no functional changes

`writeSingleRegister` (FC06) and `writeMultipleRegisters` (FC16), the shared 10 s timeout race, and the reject-when-not-connected guard all stay exactly as implemented — they are now exercised **unconditionally** (every adapter run subscribes and may dispatch a write) rather than only when a config flag was set. The only change is doc wording: the module header and `IModbusClient`/`ModbusClient` comments describing the write surface as usable "only when control is enabled" are updated to describe it as always available, restricted only to the two function codes and, at the adapter level, only ever targeted at the nine `StorEdgeControlBlock` addresses. No test behavior changes: the existing read-only-invariant test's allowed/forbidden method split is unaffected (it was already updated to allow `writeSingleRegister`/`writeMultipleRegisters`/`writeRegister`/`writeRegisters` and forbid coil methods).

### 6. Config (`src/lib/adapter-config.d.ts`, `io-package.json`, `src/lib/config-validation.ts`)

All control-specific fields are removed. `AdapterConfig` goes back to exactly:

```ts
interface AdapterConfig {
    host: string;
    port: number;
    unitId: number;
    pollInterval: number;
}
```

`io-package.json` `native` drops `controlEnabled`, `defaultStorageControlMode`, `defaultFallbackMode`, `commandTimeout`, `houseConsumptionStateId`, `wallboxConsumptionStateId`, `maxDischargeLimit`, `sourceMaxAgeSeconds`, leaving only `host`, `port`, `unitId`, `pollInterval`. `config-validation.ts` drops `defaultStorageControlMode`/`defaultFallbackMode` from `CONFIG_BOUNDS`, drops the corresponding `ConfigField` union members and all the `commandTimeout`/`maxDischargeLimit`/`sourceMaxAgeSeconds`/`houseConsumptionStateId`/`wallboxConsumptionStateId`/`controlEnabled` validation blocks, leaving only the original `host`/`port`/`unitId`/`pollInterval` checks. `validateConfig`'s signature and return shape (`ConfigValidationResult`) are unchanged; it simply validates fewer fields.

### 7. React admin (`src-admin/src/components/Settings.tsx` + i18n)

The entire control settings section is removed: `renderControlSettings`, the `Checkbox`/`FormControlLabel` enable toggle, the `Alert` portal warning, the `Default Storage Control Mode` `Select` + `modeOptions`, the two `renderStateIdField` calls (house/wallbox) and the `renderSelectIdDialog`/`SELECT_ID_SOURCES`/`SelectIdSource` machinery backing them, and the two `renderNumberField` calls for `maxDischargeLimit`/`sourceMaxAgeSeconds`. `currentConfig()` drops the eight control fields, keeping only `host`/`port`/`unitId`/`pollInterval`. `render()` drops the `this.renderControlSettings(errors)` call, leaving the connection fields, the Test Connection button, and `this.renderValueTable()`.

Since `DialogSelectID` was imported from `@iobroker/adapter-react-v5` **solely** to back the house/wallbox object-id pickers, and nothing else in `Settings.tsx` uses it, the import is removed entirely (confirmed by inspection: `DialogSelectID` appears only in `renderSelectIdDialog`, which is deleted in full). Likewise `Checkbox`, `FormControlLabel`, `MenuItem`, `Alert`, `SearchIcon`, `IconButton`, and `Tooltip` were imported only for the control section; each is removed unless still used elsewhere in the file (`MenuItem` is not used by the value table, so it is removed too).

All 21 i18n keys introduced by the old design (`Enable battery control`, `StorEdge portal warning`, `Default Storage Control Mode`, `Default fallback mode`, `Command timeout (s)`, `House consumption state`, `Wallbox consumption state`, `Max discharge limit (W)`, `Source max age (s)`, the five `Mode N ...` keys, the six `Invalid ...`/`... required` error-message keys) are removed from all eleven `src-admin/src/i18n/*.json` files (`en`, `de`, `ru`, `pt`, `nl`, `fr`, `it`, `es`, `pl`, `uk`, `zh-cn`). The admin UI reverts to exactly: connection settings (host/port/unitId/pollInterval + Test Connection) plus the read-only SunSpec value tables (inverter/meter/battery accordions), unchanged from before either control feature existed.

## Data Models

### StorEdgeControlBlock register (wire model)

Verbatim from the manufacturer's Global StorEdge Control Block table (base `0xE004`, mirrored at `0xF704`):

| Register                              | Address  | Kind    | Words | Word order | FC   | Range              | Unit  |
| -------------------------------------- | -------- | ------- | ----- | ---------- | ---- | ------------------- | ----- |
| Storage_Control_Mode                   | `0xE004` | uint16  | 1     | —          | FC06 | 0 – 4                | —     |
| Storage_AC_Charge_Policy                | `0xE005` | uint16  | 1     | —          | FC06 | 0 – 3                | —     |
| Storage_AC_Charge_Limit                 | `0xE006` | float32 | 2     | le         | FC16 | 0 – Max_Float (`Number.MAX_VALUE`) | kWh or % |
| Storage_Backup_Reserved_Setting         | `0xE008` | float32 | 2     | le         | FC16 | 0 – 100              | %     |
| Storage_Charge_Discharge_Default_Mode   | `0xE00A` | uint16  | 1     | —          | FC06 | 0 – 7                | —     |
| Remote_Control_Command_Timeout          | `0xE00B` | uint32  | 2     | le         | FC16 | 0 – 86400            | s     |
| Remote_Control_Command_Mode             | `0xE00D` | uint16  | 1     | —          | FC06 | 0 – 7                | —     |
| Remote_Control_Charge_Limit             | `0xE00E` | float32 | 2     | le         | FC16 | 0 – Battery_Max_Power (`BATTERY_MAX_POWER_W` = 10000) | W |
| Remote_Control_Discharge_Limit          | `0xE010` | float32 | 2     | le         | FC16 | 0 – Battery_Max_Power (`BATTERY_MAX_POWER_W` = 10000) | W |

Word accounting: `Storage_Control_Mode` (`0xE004`, 1w) + `Storage_AC_Charge_Policy` (`0xE005`, 1w) + `Storage_AC_Charge_Limit` (`0xE006`–`0xE007`, 2w) + `Storage_Backup_Reserved_Setting` (`0xE008`–`0xE009`, 2w) + `Storage_Charge_Discharge_Default_Mode` (`0xE00A`, 1w) + `Remote_Control_Command_Timeout` (`0xE00B`–`0xE00C`, 2w) form one contiguous **9-word** span `0xE004..0xE00C`. `Remote_Control_Command_Mode` (`0xE00D`, 1w) + `Remote_Control_Charge_Limit` (`0xE00E`–`0xE00F`, 2w) + `Remote_Control_Discharge_Limit` (`0xE010`–`0xE011`, 2w) form a second contiguous **5-word** span `0xE00D..0xE011`. The poll read therefore issues exactly two requests — `readHoldingRegisters(0xE004, 9)` and `readHoldingRegisters(0xE00D, 5)` — one per contiguous span, minimizing Modbus round-trips in the same spirit as `BATTERY_READ_SEGMENTS` (`sunspec-map.ts`/`sunspec-reader.ts`), which splits a device block into its readable contiguous windows rather than issuing one read per value or one oversized read per block. (Unlike the battery block, nothing in the manufacturer table indicates `0xE00C`/`0xE0D` boundary is a gap the device rejects; splitting into exactly these two requests is simply the natural two-groups-of-contiguous-registers reading, not a workaround for a confirmed unreadable gap. If live testing shows the full `0xE004..0xE011` (14-word) span reads successfully in one request, that single-request form is an acceptable simplification — the two-span form here is the conservative default consistent with how the adapter already treats StorEdge register blocks.)

Encoding: uint16 written/read verbatim (no multiword encoding). float32 registers use `encodeFloat32le`/`decodeRegisters(..., 'float32le')` — little-endian word order, low word first, bytes big-endian within each word; `encodeFloat32le(5000) === [0x4000, 0x459c]`. The uint32 register (`0xE00B`) uses `encodeUint32le`/`decodeRegisters(..., 'uint32le')` — same word-order convention, low word first. Both `*le` codecs are unchanged, pre-existing functions already serving the `0xE1xx` battery block.

### StorEdgeControlBlock state (ioBroker model)

Under the plain (non-expert) `StorEdgeControlBlock` channel — all nine `read=true, write=true`:

- `StorEdgeControlBlock.storageControlMode` (number, raw `0xE004`)
- `StorEdgeControlBlock.storageAcChargePolicy` (number, raw `0xE005`)
- `StorEdgeControlBlock.storageAcChargeLimit` (number, kWh/%, raw `0xE006`)
- `StorEdgeControlBlock.storageBackupReservedSetting` (number, %, raw `0xE008`)
- `StorEdgeControlBlock.storageChargeDischargeDefaultMode` (number, raw `0xE00A`)
- `StorEdgeControlBlock.remoteControlCommandTimeout` (number, s, raw `0xE00B`)
- `StorEdgeControlBlock.remoteControlCommandMode` (number, raw `0xE00D`)
- `StorEdgeControlBlock.remoteControlChargeLimit` (number, W, raw `0xE00E`)
- `StorEdgeControlBlock.remoteControlDischargeLimit` (number, W, raw `0xE010`)

These are the **only** `write=true` states anywhere in the adapter; every SunSpec-derived state (`inverter.*`, `meter.<n>.*`, `battery.<n>.*`) remains `write=false`, unchanged.

### Runtime state (adapter instance)

None. Unlike the deleted design there is no `controlActive` flag, no sample cache, and no `lastWritten0xE010` — the adapter holds no control-related state between cycles; every poll re-reads the live device values and every write is dispatched independently.

## Error Handling

- **Write while disconnected** — `writeSingleRegister`/`writeMultipleRegisters` reject with `Modbus client is not connected` before any library call; `onStateChange` logs the failure and retains the previously acknowledged value (no ack on failure).
- **Write timeout** — bounded by the shared `DEFAULT_TIMEOUT_MS` (10 s) rejecting-timer race, identical mechanism to reads; treated as a write failure (log + retain, non-fatal).
- **Modbus exception on write** — logged and non-fatal; the state keeps its previously acknowledged value; the adapter continues running.
- **Out-of-range candidate value** — rejected *before* any Modbus call is attempted: `onStateChange` logs a validation error naming the register, the offending value, and the documented range, and returns without writing or acknowledging; the previously acknowledged value is retained untouched.
- **Poll-read failure (any of the two StorEdgeControlBlock read requests throws)** — follows the *existing* `pollOnce` cycle-failure path exactly like an inverter/meter/battery read failure: `info.connection` is set false, the socket is closed, and the next cycle reconnects. No special-casing for this block; it shares fate with the rest of the cycle it runs inside.
- **Acked / deletion change** — ignored up front in `onStateChange`, so the adapter's own poll-read acks and write-success acks never re-trigger a write, and object deletions are not treated as writes.
- **Unknown leaf under `StorEdgeControlBlock.`** — ignored (no matching def); a change under any other branch is ignored by the `startsWith(prefix)` guard before `findStorEdgeControlDef` is even consulted.

## Testing Strategy

Dual approach: **property tests** (≥100 iterations, tagged `Feature: storedge-battery-control, Property {n}: {text}`) for input-varying logic — encoding round-trips, function-code/encoding selection, range-validation boundaries, dispatch/ack/retain behavior, idempotent creation — and **example tests** for deterministic, fixed-shape wiring: the exact nine-row definition table, unconditional channel/subscription creation on `onReady`, the two-span poll read wiring, and the fixed `encodeFloat32le(5000)` vector.

### Unit / property tests

- **Register table matches the manufacturer spec exactly** — example: each of the nine defs has the documented address/kind/length/wordOrder/fc/min/max/unit; the table has exactly nine entries; none of the nine names collide with any `SUNSPEC_MAP`/`BATTERY_MAP` name.
- **FC06/FC16 selection is exact per register** — property over the nine defs: `kind:'uint16'` ⇒ dispatch calls `writeSingleRegister`, never `writeMultipleRegisters`; `kind:'float32'|'uint32'` ⇒ dispatch calls `writeMultipleRegisters` with the correctly-selected encoder (`encodeFloat32le` vs `encodeUint32le`), never `writeSingleRegister`.
- **Not-connected rejection** — property: for any def/value, when the client is not connected the write rejects and no underlying library call is issued.
- **float32le round-trip** — property over finite float32 values: `decodeRegisters(encodeFloat32le(v), 'float32le') === v` (bit-exact after float32 rounding); fixed vector `encodeFloat32le(5000) === [0x4000, 0x459c]`.
- **uint32le round-trip** — property over the uint32 domain: `decodeRegisters(encodeUint32le(v), 'uint32le') === v`, low word first.
- **Range validation accept/reject boundary** — property per register (or parameterized across all nine): values strictly inside `[min, max]` are forwarded to a write; `min` and `max` themselves are accepted (inclusive bounds); any value `< min` or `> max` is rejected with no write attempted and no ack.
- **Poll-read updates all nine states from live values with `ack=true`** — property over generated live register words: after a poll cycle, every one of the nine states equals the freshly decoded value with `ack=true`, regardless of what (if anything) was previously written or previously read.
- **Poll-read reflects the live value, not the last write** — property: for any previously-acked write value and any different live value returned by the next poll read, the state after that poll shows the live value, not the write.
- **Poll-read failure is non-fatal** — property: for any of the two read spans throwing, the adapter does not terminate and the failure follows the same path as an inverter/meter/battery read failure in the same cycle.
- **Write dispatch sends every validation-passing write, no suppression** — property: for any sequence of valid values (including repeats of the same value), each one is dispatched as its own write — there is no write-only-if-changed short-circuit.
- **Dispatch acks on success, retains on failure** — property: for any non-acked, in-range change, a successful write acks the state with the written value; a failing write (disconnected/timeout/exception) issues no ack and leaves the previously acknowledged value untouched, while the adapter keeps running.
- **Ignore-acked** — property: for any state change carrying `ack=true`, zero Modbus writes are issued.
- **Unconditional + idempotent channel/state creation** — property over N repeated `ensureStorEdgeControlBlock()` calls (any N ≥ 1): the channel and all nine states are created exactly once (no duplicate `setObjectNotExistsAsync` calls beyond the first), and this holds regardless of config content (including configs with none of host/port/unitId/pollInterval valid).
- **Write=true surface is exactly these nine states** — property: for any state created via the SunSpec register-map path (`ensureState`, over generated inverter/meter/battery-shaped defs), `common.write` is always `false`; the only states ever created with `common.write === true` are the nine `StorEdgeControlBlock` states.

### Integration

`src/lib/integration.test.ts` gains a StorEdgeControlBlock scenario against a mock client: start the adapter (no config flag needed) → verify the channel and all nine states exist with `write=true` immediately → run a poll cycle → verify all nine states show the mock's live values with `ack=true` → drive an in-range write on one state → verify exactly one correctly-encoded write is issued and the state acks with the written value → drive an out-of-range write → verify zero writes are issued, an error is logged, and the state's previous value is unchanged → drive a write while the mock client reports disconnected → verify the write rejects, is logged, and the previous value is retained.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Read surface is unchanged for FC03/FC04

*For any* sequence of read operations issued by the adapter, only FC03 (`readHoldingRegisters`) and FC04 (`readInputRegisters`) are used, with behavior identical to before this feature existed.

**Validates: Requirements 1.8**

### Property 2: FC06/FC16 forwarding and per-register function-code/encoding selection

*For any* of the nine StorEdgeControlBlock registers and any value within its representable range, dispatch selects `writeSingleRegister` (FC06) if and only if the register's kind is `uint16`, and selects `writeMultipleRegisters` (FC16) with `encodeFloat32le` for every `float32` register and with `encodeUint32le` for the one `uint32` register (`0xE00B`); no register is ever dispatched through the other function code.

**Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 2.3, 2.4**

### Property 3: Writes are rejected when not connected

*For any* register def and any candidate value, when the client is not connected the write operation rejects with a descriptive error and no underlying library write method is called.

**Validates: Requirements 1.6**

### Property 4: float32le encoding round-trips against the existing decoder

*For any* finite float32 value `v`, `decodeRegisters(encodeFloat32le(v), 'float32le')` reproduces `v` (bit-exact after float32 rounding), with the low word first and big-endian bytes within each word; in particular `encodeFloat32le(5000)` equals `[0x4000, 0x459c]`.

**Validates: Requirements 4.1, 4.2, 4.5**

### Property 5: uint32le encoding round-trips against the existing decoder

*For any* unsigned 32-bit integer `v`, `decodeRegisters(encodeUint32le(v), 'uint32le')` reproduces `v` exactly, with the low 16-bit word first (`words[0]`) and the high word second (`words[1]`).

**Validates: Requirements 4.3, 4.4**

### Property 6: Range validation accepts inside the documented range and rejects outside it

*For any* of the nine StorEdgeControlBlock registers and any candidate value, the adapter proceeds to write the value (via the function code and encoding defined in Property 2) if and only if the value lies within that register's inclusive documented `[min, max]` range; any value outside that range is rejected before any Modbus call is attempted, is logged as a validation error, and never reaches the Modbus client.

**Validates: Requirements 6.1, 6.2, 6.4, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9**

### Property 7: Rejected writes retain the previous state and issue no acknowledgement

*For any* out-of-range candidate value, after rejection the corresponding state's previously acknowledged value is unchanged and the state is not re-acknowledged with the invalid value.

**Validates: Requirements 6.3**

### Property 8: Poll-read updates all nine states from live device values with ack=true

*For any* set of live register words returned for the two StorEdgeControlBlock read spans, after a `pollOnce` cycle completes, every one of the nine StorEdgeControlBlock states equals the value decoded from those live words (using the register's defined kind and word order) with `ack=true`, regardless of any prior write or prior read.

**Validates: Requirements 5.1, 5.2, 5.3**

### Property 9: Poll-read failure is non-fatal and follows the existing cycle-failure path

*For any* failure raised while reading either of the two StorEdgeControlBlock register spans during a `pollOnce` cycle, the adapter does not terminate and the failure is handled identically to an inverter/meter/battery read failure in the same cycle (connection marked down, socket closed, reconnect attempted next cycle).

**Validates: Requirements 5.4**

### Property 10: Every validation-passing write is sent — no write-only-if-changed suppression

*For any* sequence of in-range candidate values presented to the same StorEdgeControlBlock state — including consecutive repeats of the same value — every one is dispatched as its own Modbus write; no write is skipped because its value equals a previously written or previously read value.

**Validates: Requirements 7.1, 7.2**

### Property 11: Successful writes acknowledge with the written value; failed writes retain the previous value

*For any* non-acknowledged, in-range change to a StorEdgeControlBlock state, a write that completes successfully results in the state being set to the written value with `ack=true`; a write that fails due to disconnection, timeout, or a Modbus exception is logged, treated as non-fatal, and leaves the state's previously acknowledged value unchanged.

**Validates: Requirements 7.3, 7.4**

### Property 12: Acknowledged changes issue no write

*For any* StorEdgeControlBlock state change carrying `ack=true`, the adapter issues zero Modbus writes, so the adapter's own poll-read updates and write-success acknowledgements never re-trigger a write.

**Validates: Requirements 7.5**

### Property 13: Unconditional and idempotent channel/state creation

*For any* number of repeated adapter starts or repeated `ensureStorEdgeControlBlock()` invocations, and *for any* configuration content, the StorEdgeControlBlock channel and its nine states are created, and repeated invocations create no duplicate objects; creation never depends on and is never altered by any configuration value.

**Validates: Requirements 8.1, 8.2, 8.3**

### Property 14: The write=true surface is exactly the nine StorEdgeControlBlock states

*For any* state created via the SunSpec register-map path (inverter, meter, or battery), the state's `write` property is `false`; the only states in the entire adapter ever created with `write: true` are the nine StorEdgeControlBlock states, each created with both `read: true` and `write: true`.

**Validates: Requirements 8.4, 9.1, 9.2, 9.3**
