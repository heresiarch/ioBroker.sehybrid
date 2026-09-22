# Implementation Plan: StorEdge Battery Control (Global StorEdge Control Block)

## Overview

This is a **migration** plan. The codebase currently implements the *old*, deleted design: a consumption-driven `controlEnabled` gate, `consumption.ts` (house/wallbox discharge-limit computation), `control-registers.ts` (7 registers incl. `0xE000` initial-config-only), `control-writer.ts` (`applyEnable`/`heartbeat`/`applyRevert` lifecycle), an expert `control` channel with mixed read/write states, admin config fields (`defaultStorageControlMode`, `defaultFallbackMode`, `commandTimeout`, `houseConsumptionStateId`, `wallboxConsumptionStateId`, `maxDischargeLimit`, `sourceMaxAgeSeconds`), a React admin control section with an object-browser picker, and 21 i18n keys across 11 locale files.

The reworked `requirements.md`/`design.md` replace all of that with a **much simpler, unconditional** design: all **nine** registers of the manufacturer's Global StorEdge Control Block (`0xE004`, `0xE005`, `0xE006`, `0xE008`, `0xE00A`, `0xE00B`, `0xE00D`, `0xE00E`, `0xE010`) are exposed as one flat, always-present `StorEdgeControlBlock` channel with `read=true, write=true` on every state. There is **no** enable switch, **no** admin configuration, **no** heartbeat/lifecycle, **no** computed value, and **no** write-only-if-changed suppression — every validation-passing write is dispatched every time. The nine registers are read every `pollOnce` cycle with `ack=true`; a non-acked state change is range-validated against the register's documented `[min, max]` and, if valid, written via FC06 (uint16) or FC16 (float32le/uint32le), acked on success, and non-fatally logged/retained on failure.

This plan removes the old mechanism entirely (module deletions, config field removals, admin/i18n removals, old test removals) and adds the new mechanism (new register-map module, new state-manager helpers, new `main.ts` wiring), rewriting the tests that cover the new behavior.

**Dependency ordering principles applied below:**
- The new register-map module (`storedge-control-map.ts`) has no dependencies on anything being removed, so it is created in wave 0, in parallel with independent deletions.
- Deletions of now-dead files (`control-registers.ts`, `control-writer.ts`, `consumption.ts` + their tests) have no consumers once `main.ts` and `state-manager.ts` are migrated, so they are sequenced to happen in the same waves as (not after) the `main.ts`/`state-manager.ts` rewrite — a file can only be deleted once nothing else in its wave still imports it, so the deletion tasks are placed in the wave immediately after the last task that still references them conceptually, but since deletion and creation of unrelated files don't conflict, deletions of `consumption.ts`/`control-writer.ts`/their tests are scheduled in wave 0 alongside the new map module (nothing new depends on them), while `control-registers.ts` deletion is deferred to the wave after `main.ts`/`state-manager.ts` no longer import it.
- `state-manager.ts` (new helpers + old removal) must land before `main.ts` wiring, since `main.ts` calls `ensureStorEdgeControlBlock`/`writeStorEdgeValue`/`ackStorEdgeWrite`.
- `main.ts` substeps (onReady wiring, pollOnce read tail, onStateChange replacement) all touch the same file and are therefore split into sequential waves even though conceptually independent.
- Config type/native/validation removals are independent of `main.ts`/`state-manager.ts` and can proceed in parallel from wave 0.
- React admin + i18n removals are independent of the backend and can proceed in parallel from wave 0.
- Test rewrites for a given file are sequenced into the wave right after that file's implementation change lands.
- The build/typecheck/full-suite task is last, after every other task.

Language: TypeScript (existing project convention).

## Tasks

- [ ] 1. Create the new StorEdgeControlBlock register-map module (`src/lib/storedge-control-map.ts`)
  - [ ] 1.1 Define the nine `StorEdgeControlRegisterDef` entries, `BATTERY_MAX_POWER_W`, and `findStorEdgeControlDef`
    - Create `StorEdgeControlKind` (`'uint16'|'float32'|'uint32'`), `StorEdgeWordOrder` (`'le'`), and the `StorEdgeControlRegisterDef` interface (`name`, `address`, `kind`, `length`, `wordOrder?`, `iobType:'number'`, `unit?`, `min`, `max`, `fc:'FC06'|'FC16'`)
    - Define all nine defs exactly per the design's table: `STORAGE_CONTROL_MODE` (`0xE004`, uint16, 1w, 0-4, FC06), `STORAGE_AC_CHARGE_POLICY` (`0xE005`, uint16, 1w, 0-3, FC06), `STORAGE_AC_CHARGE_LIMIT` (`0xE006`, float32, 2w, le, unit `kWh`, 0 to `Number.MAX_VALUE`, FC16), `STORAGE_BACKUP_RESERVED_SETTING` (`0xE008`, float32, 2w, le, unit `%`, 0-100, FC16), `STORAGE_CHARGE_DISCHARGE_DEFAULT_MODE` (`0xE00A`, uint16, 1w, 0-7, FC06), `REMOTE_CONTROL_COMMAND_TIMEOUT` (`0xE00B`, uint32, 2w, le, unit `s`, 0-86400, FC16), `REMOTE_CONTROL_COMMAND_MODE` (`0xE00D`, uint16, 1w, 0-7, FC06), `REMOTE_CONTROL_CHARGE_LIMIT` (`0xE00E`, float32, 2w, le, unit `W`, 0 to `BATTERY_MAX_POWER_W`, FC16), `REMOTE_CONTROL_DISCHARGE_LIMIT` (`0xE010`, float32, 2w, le, unit `W`, 0 to `BATTERY_MAX_POWER_W`, FC16)
    - Export `BATTERY_MAX_POWER_W = 10000`, `STOREDGE_CONTROL_REGISTERS` (the ordered array of all nine defs), and `findStorEdgeControlDef(name): StorEdgeControlRegisterDef | undefined`
    - Keep this module a standalone sibling of `sunspec-map.ts` — never imported by `sunspec-map.ts`/`sunspec-reader.ts`, never added to `SUNSPEC_MAP`/`BATTERY_MAP`
    - _Requirements: 2.3, 2.4, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 4.1, 4.2, 4.3, 4.4, 4.5, 8.4_

  - [ ]* 1.2 Write example tests for the register table (`src/lib/storedge-control-map.test.ts`)
    - Assert the table has exactly nine entries with the documented address/kind/length/wordOrder/fc/min/max/unit for each (example test, fixed-shape data)
    - Assert none of the nine `name`s collide with any `SUNSPEC_MAP`/`BATTERY_MAP` register name (import both maps to compare)
    - Assert `findStorEdgeControlDef` returns the correct def for each of the nine names and `undefined` for an unknown name
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 8.4_

- [ ] 2. Delete the dead consumption/control-writer modules and their tests
  - [ ] 2.1 Delete `src/lib/consumption.ts` and `src/lib/consumption.test.ts`
    - No longer referenced by the new design; `main.ts` will stop importing `computeDischargeLimit`/`SourceSample` in task 6
    - _Requirements: (removal per design's explicit deletion list — supports Req 6, 7 by eliminating the old computed-limit path)_

  - [ ] 2.2 Delete `src/lib/control-writer.ts` and `src/lib/control-writer.test.ts`
    - The `ModbusControlWriter` lifecycle (`applyEnable`/`heartbeat`/`applyRevert`) is replaced by the inline dispatch in `main.ts` (task 6); no successor class exists
    - _Requirements: (removal per design's explicit deletion list — supports Req 7 by eliminating the old lifecycle-based dispatch)_

- [ ] 3. Checkpoint - new map module in place, dead consumption/writer modules removed
  - Ensure all tests pass (aside from files still pending migration in later tasks), ask the user if questions arise.

- [ ] 4. Rework the state manager for the new control block (`src/lib/state-manager.ts`)
  - [ ] 4.1 Remove the old control-state machinery and add `ensureStorEdgeControlBlock`/`writeStorEdgeValue`/`ackStorEdgeWrite`
    - Remove `ensureControlStates`, `setControlAck`, the `CONTROL_STATE_DEFS` table, the `ControlStateDef` interface, and the `CONTROL_CHANNEL` constant from `IStateManager` and `StateManager`
    - Add `ensureStorEdgeControlBlock(): Promise<void>` to `IStateManager`/`StateManager`: creates a **plain** (non-expert) `StorEdgeControlBlock` channel, then for each of the nine `STOREDGE_CONTROL_REGISTERS` defs creates a state `StorEdgeControlBlock.<def.name>` with `common.type='number'`, `common.role` per the design's mapping (`'level.mode'` for `storageControlMode`/`storageAcChargePolicy`/`storageChargeDischargeDefaultMode`/`remoteControlCommandMode`; `'value.energy'` for `storageAcChargeLimit`; `'value.fill'` for `storageBackupReservedSetting`; `'value.interval'` for `remoteControlCommandTimeout`; `'value.power'` for `remoteControlChargeLimit`/`remoteControlDischargeLimit`), `common.unit` from `def.unit` when present, `common.min`/`common.max` from `def.min`/`def.max`, and `common.read=true, common.write=true`
    - Reuse the existing `createdChannels`/`ensuredStates` `Set`-based idempotency pattern and `setObjectNotExistsAsync`
    - Add `writeStorEdgeValue(def, value): Promise<void>` and `ackStorEdgeWrite(def, value): Promise<void>` — both write `{ val: value, ack: true }` to `StorEdgeControlBlock.<def.name>` (may share one private helper)
    - Update the module header comment to describe the new unconditional block instead of the old expert control channel
    - _Requirements: 8.1, 8.2, 8.4, 9.1, 9.2, 9.3_

  - [ ]* 4.2 Rewrite `src/lib/state-manager.test.ts` for the new control block
    - Remove the old `ensureControlStates`/`setControlAck`/`CONTROL_STATE_DEFS` tests
    - Add: `ensureStorEdgeControlBlock` creates the channel and all nine states with `read=true, write=true` and the correct `common.min`/`common.max` from each def
    - **Feature: storedge-battery-control, Property 13: Unconditional and idempotent channel/state creation** — for any N ≥ 1 repeated `ensureStorEdgeControlBlock()` calls, the channel and nine states are created exactly once (no duplicate `setObjectNotExistsAsync` calls beyond the first)
    - **Feature: storedge-battery-control, Property 14: The write=true surface is exactly the nine StorEdgeControlBlock states** — for any state created via `ensureState` over generated inverter/meter/battery-shaped defs, `common.write` is always `false`; only the nine `StorEdgeControlBlock` states are ever created with `common.write === true`
    - Assert no state derived from the SunSpec map influences or appears in `ensureStorEdgeControlBlock`'s output (the two paths are independent)
    - Run property tests ≥100 iterations
    - _Requirements: 8.1, 8.2, 8.4, 9.1, 9.2, 9.3_

- [ ] 5. Checkpoint - state manager migrated
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Rewrite `main.ts` wiring for the unconditional control block
  - [ ] 6.1 Remove the old control gate, fields, and imports; wire unconditional creation in `onReady`
    - Remove imports: `computeDischargeLimit`/`SourceSample` from `./lib/consumption`, `findControlDef`/`REMOTE_CONTROL_DISCHARGE_LIMIT` from `./lib/control-registers`, `ModbusControlWriter` from `./lib/control-writer`
    - Remove fields: `controlWriter`, `controlActive`, `lastHouseSample`, `lastWallboxSample`, `lastWritten0xE010`, and the `WRITABLE_EXPERT` module-level constant
    - Remove methods: `enableControl`, `disableControl`
    - Remove the `if (this.config.controlEnabled === true) { ... } else if (this.controlActive) { ... }` gate block in `onReady`
    - Add, immediately after the existing `await this.stateManager.ensureChannel('inverter');` in `onReady`, unconditionally on every start: `await this.stateManager.ensureStorEdgeControlBlock();` followed by `this.subscribeStates('StorEdgeControlBlock.*');`
    - Add imports: `STOREDGE_CONTROL_REGISTERS`, `findStorEdgeControlDef`, `type StorEdgeControlRegisterDef` from `./lib/storedge-control-map`; `encodeFloat32le`, `encodeUint32le` from `./lib/sunspec-decode` (alongside the already-imported `decodeRegisters`)
    - _Requirements: 8.1, 8.2, 8.3_

  - [ ] 6.2 Add the two-span StorEdgeControlBlock read tail to `pollOnce`
    - Inside the existing `try`, after the existing battery-block read loop and before the (now-removed) control heartbeat tail: `const blockWordsA = await client.readHoldingRegisters(0xe004, 9);` and `const blockWordsB = await client.readHoldingRegisters(0xe00d, 5);`
    - For each def in `STOREDGE_CONTROL_REGISTERS`, slice the correct words from `blockWordsA`/`blockWordsB` by address, map `def.kind` to the `decodeRegisters` datatype string (`'uint16'` → `'uint16'`, `'float32'` → `'float32le'`, `'uint32'` → `'uint32le'`), decode, and call `await stateManager.writeStorEdgeValue(def, value)` when the decoded value is not null
    - A thrown error from either read propagates out of the `try` and is handled by the existing catch block (no special-casing), matching the existing inverter/meter/battery read failure path
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [ ] 6.3 Replace `onStateChange`/`handleStateChange` with `handleStorEdgeControlChange`
    - Simplify `onStateChange` to: return on `!state` (deletion) or `state.ack` (adapter-originated), else `void this.handleStorEdgeControlChange(id, state)`
    - Add `handleStorEdgeControlChange(id, state)`: match `` `${this.namespace}.StorEdgeControlBlock.` `` prefix (return if it doesn't match), extract the leaf, resolve via `findStorEdgeControlDef` (return if unresolved), coerce `state.val` to `Number`, range-validate against `def.min`/`def.max` (reject non-finite or out-of-range values: `this.log.error(...)` naming the leaf, address, value, and range, then `return` — no write, no ack, previous value retained)
    - On a range-valid value, dispatch by `def.kind`: `'uint16'` → `this.modbusClient!.writeSingleRegister(def.address, value)` (FC06); `'float32'` → `this.modbusClient!.writeMultipleRegisters(def.address, encodeFloat32le(value))` (FC16); `'uint32'` → `this.modbusClient!.writeMultipleRegisters(def.address, encodeUint32le(value))` (FC16)
    - On write success: `await this.stateManager!.ackStorEdgeWrite(def, value)`. On write failure (disconnected/timeout/exception): `this.log.error(...)` with the reason, non-fatal, no ack, previous acked value retained
    - Every range-valid change is dispatched as its own write, every time — no write-only-if-changed suppression
    - Leave `onUnload` unchanged (no control write on unload)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 5.4, 6.1, 6.2, 6.3, 6.4, 7.1, 7.2, 7.3, 7.4, 7.5_

- [ ] 7. Checkpoint - main.ts migrated to the unconditional control block
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 8. Delete the now-unreferenced `control-registers.ts` module
  - [ ] 8.1 Delete `src/lib/control-registers.ts`
    - Confirm no remaining imports (main.ts was migrated off it in task 6); superseded entirely by `storedge-control-map.ts`
    - _Requirements: (removal per design's explicit deletion list — supports Req 3.10, 8.4 by eliminating the old parallel register table)_

- [ ] 9. Remove control config fields (`src/lib/adapter-config.d.ts`, `io-package.json`)
  - [ ] 9.1 Trim `AdapterConfig` back to host/port/unitId/pollInterval
    - Remove `controlEnabled`, `defaultStorageControlMode`, `houseConsumptionStateId`, `wallboxConsumptionStateId`, `maxDischargeLimit`, `sourceMaxAgeSeconds`, `defaultFallbackMode`, `commandTimeout` from the `AdapterConfig` interface in `src/lib/adapter-config.d.ts`
    - Remove the same eight keys from `native` in `io-package.json`, leaving only `host`, `port`, `unitId`, `pollInterval`
    - _Requirements: 8.3 (no configuration setting enables, disables, or alters StorEdgeControlBlock behavior)_

- [ ] 10. Remove control validation rules (`src/lib/config-validation.ts`)
  - [ ] 10.1 Trim `validateConfig`/`ConfigField`/`CONFIG_BOUNDS` back to the original four fields
    - Remove the `defaultStorageControlMode`, `defaultFallbackMode`, `commandTimeout`, `houseConsumptionStateId`, `wallboxConsumptionStateId`, `maxDischargeLimit`, `sourceMaxAgeSeconds` validation blocks from `validateConfig`, their `ConfigField` union members, and their `CONFIG_BOUNDS` entries
    - Remove the `controlEnabled`-gated required-source-id block
    - Keep `host`/`port`/`unitId`/`pollInterval` validation and the `ConfigValidationResult` shape unchanged
    - _Requirements: 8.3_

  - [ ]* 10.2 Trim `src/lib/config-validation.test.ts` to the original four fields
    - Remove the old control-property tests (default storage control mode / default fallback mode / command timeout / max discharge limit / source max age / required source ids)
    - Keep only the original host/port/unitId/pollInterval validation tests intact
    - _Requirements: 8.3_

- [ ] 11. Remove the React admin control settings section (`src-admin/src/components/Settings.tsx`)
  - [ ] 11.1 Delete `renderControlSettings` and its call site, and prune now-unused imports
    - Remove `renderControlSettings` in full: the enable `Checkbox`/`FormControlLabel`, the portal-warning `Alert`, the `Default Storage Control Mode` `Select` + `modeOptions`, `renderStateIdField`, `renderSelectIdDialog`, `SELECT_ID_SOURCES`, `SelectIdSource`, and the two numeric fields for `maxDischargeLimit`/`sourceMaxAgeSeconds`
    - Remove the `this.renderControlSettings(errors)` call from `render()`
    - Remove the `DialogSelectID` import (confirmed used only by `renderSelectIdDialog`) and any of `Checkbox`, `FormControlLabel`, `MenuItem`, `Alert`, `SearchIcon`, `IconButton`, `Tooltip` that become unused after this removal (verify each against the remaining file content — the value-table accordions may still use some Material icons/components, so only remove imports confirmed unused)
    - Trim `currentConfig()` back to `host`/`port`/`unitId`/`pollInterval` only
    - _Requirements: 8.3_

- [ ] 12. Remove control i18n keys from all eleven locale files (`src-admin/src/i18n/*.json`)
  - [ ] 12.1 Remove the 15 control-related keys from en, de, ru, pt, nl, fr, it, es, pl, uk, zh-cn
    - Remove: `Battery control`, `Enable battery control`, `StorEdge portal warning`, `Default Storage Control Mode`, `House consumption state`, `Wallbox consumption state`, `Max discharge limit (W)`, `Source max age (s)`, `Mode 0 Disabled`, `Mode 1 Maximize Self Consumption`, `Mode 2 Time of Use`, `Mode 3 Backup Only`, `Mode 4 Remote Control`, `Invalid default control mode`, `Invalid max discharge limit`, `Invalid source max age`, `Source id required`, `Select consumption state`, `Browse` from every one of the eleven files (some files may not contain every key if only `en.json` was fully populated — remove whatever subset exists per file)
    - Leave every other (non-control) key in each file untouched
    - _Requirements: 8.3_

- [ ] 13. Checkpoint - config, admin, and i18n control surface fully removed
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 14. Verify the Modbus client write surface and update doc wording only (`src/lib/modbus-client.ts`)
  - [ ] 14.1 Update header/interface comments describing the write surface as unconditional
    - No functional change: `writeSingleRegister` (FC06), `writeMultipleRegisters` (FC16), the shared 10s timeout, and the not-connected rejection guard stay exactly as implemented
    - Update the module header comment and the `IModbusClient`/`ModbusClient` doc comments that describe the write surface as usable "only when control is enabled" (or reference the old `0xE004`/`0xE00D`/`0xE010`/`0xE00E` address list) to instead state the write surface is always available, restricted to FC06/FC16, and at the adapter level targeted only at the nine `StorEdgeControlBlock` addresses (`0xE004`, `0xE005`, `0xE006`, `0xE008`, `0xE00A`, `0xE00B`, `0xE00D`, `0xE00E`, `0xE010`)
    - _Requirements: 1.1, 1.2, 1.6, 1.7, 1.8, 2.1, 2.2_

  - [ ]* 14.2 Verify `src/lib/modbus-client.test.ts` still covers the unchanged behavior
    - Confirm the existing read-only-invariant test's allowed/forbidden method split (`writeSingleRegister`/`writeMultipleRegisters` allowed; coil methods forbidden) still passes unchanged
    - **Feature: storedge-battery-control, Property 1: Read surface is unchanged for FC03/FC04** — confirm/keep the existing property asserting only FC03/FC04 are used for reads
    - **Feature: storedge-battery-control, Property 3: Writes are rejected when not connected** — confirm/keep the existing not-connected rejection property for both write methods
    - Run property tests ≥100 iterations
    - _Requirements: 1.6, 1.8, 2.1, 2.2_

- [ ] 15. Verify the float32le/uint32le round-trip tests still apply unchanged (`src/lib/sunspec-decode.test.ts`)
  - [ ]* 15.1 Confirm Property 4 and Property 5 round-trip tests are present and unchanged
    - **Feature: storedge-battery-control, Property 4: float32le encoding round-trips against the existing decoder** — for any finite float32 `v`, `decodeRegisters(encodeFloat32le(v), 'float32le')` reproduces `v`; fixed vector `encodeFloat32le(5000) === [0x4000, 0x459c]`
    - **Feature: storedge-battery-control, Property 5: uint32le encoding round-trips against the existing decoder** — for any uint32 `v`, `decodeRegisters(encodeUint32le(v), 'uint32le')` reproduces `v` with `words[0]` low, `words[1]` high
    - No implementation change is expected in `sunspec-decode.ts`; this task only confirms/re-tags existing coverage against the new property numbering
    - Run ≥100 iterations
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

- [ ] 16. Add dispatch-level property and unit tests for `main.ts` (`src/main.test.ts`)
  - [ ] 16.1 Rewrite the test harness for the unconditional control block
    - Replace the old `ControlHarness` (enable/heartbeat/disable lifecycle) with a thin recording-client harness that constructs a `Sehybrid` instance with a mock `ModbusClient` (recording `writeSingleRegister`/`writeMultipleRegisters` calls), mock `StateManager` (recording `ensureStorEdgeControlBlock`/`writeStorEdgeValue`/`ackStorEdgeWrite` calls), and drives `onReady`/`pollOnce`/`onStateChange` directly, exercising the real `findStorEdgeControlDef`, `encodeFloat32le`, `encodeUint32le` collaborators (per the design's stated testing approach)
    - Remove the old control-wiring property tests tied to the deleted enable/heartbeat/disable lifecycle
    - _Requirements: 8.1, 8.2, 8.3_

  - [ ]* 16.2 Add unconditional creation + subscription example test
    - Assert `onReady` calls `ensureStorEdgeControlBlock()` and `subscribeStates('StorEdgeControlBlock.*')` unconditionally, regardless of config content (no `controlEnabled` field exists any more)
    - _Requirements: 8.1, 8.3_

  - [ ]* 16.3 Add the poll-read dispatch property test
    - **Feature: storedge-battery-control, Property 8: Poll-read updates all nine states from live device values with ack=true** — for any generated set of live register words for the two read spans, after `pollOnce` every one of the nine states is written via `writeStorEdgeValue` with the value decoded using the register's kind/word order and `ack=true`, regardless of prior writes or reads
    - Run ≥100 iterations
    - _Requirements: 5.1, 5.2, 5.3_

  - [ ]* 16.4 Add the poll-read failure non-fatal property test
    - **Feature: storedge-battery-control, Property 9: Poll-read failure is non-fatal and follows the existing cycle-failure path** — for either of the two read spans throwing, the adapter does not terminate, `info.connection` is set false, the socket is closed, and the next cycle reconnects, identically to an inverter/meter/battery read failure
    - Run ≥100 iterations
    - _Requirements: 5.4_

  - [ ]* 16.5 Add the FC06/FC16 selection and range-validation dispatch property tests
    - **Feature: storedge-battery-control, Property 2: FC06/FC16 forwarding and per-register function-code/encoding selection** — for any of the nine defs and any value within its representable range, dispatch calls `writeSingleRegister` iff `kind==='uint16'`, else `writeMultipleRegisters` with `encodeFloat32le` for `float32` defs and `encodeUint32le` for the one `uint32` def
    - **Feature: storedge-battery-control, Property 6: Range validation accepts inside the documented range and rejects outside it** — for any of the nine defs and any candidate value, a write is dispatched iff the value lies within `[def.min, def.max]` inclusive; out-of-range values never reach the Modbus client and are logged as a validation error
    - **Feature: storedge-battery-control, Property 7: Rejected writes retain the previous state and issue no acknowledgement** — for any out-of-range candidate, no `ackStorEdgeWrite` call is made and the previous value is unchanged
    - Run ≥100 iterations
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 6.1, 6.2, 6.3, 6.4_

  - [ ]* 16.6 Add the ack/retain/ignore-acked/no-suppression dispatch property tests
    - **Feature: storedge-battery-control, Property 10: Every validation-passing write is sent — no write-only-if-changed suppression** — for any sequence of in-range values presented to the same state, including consecutive repeats, each is dispatched as its own write
    - **Feature: storedge-battery-control, Property 11: Successful writes acknowledge with the written value; failed writes retain the previous value** — a successful write results in `ackStorEdgeWrite(def, value)`; a failing write (disconnected/timeout/exception) is logged, non-fatal, and issues no ack
    - **Feature: storedge-battery-control, Property 12: Acknowledged changes issue no write** — for any state change carrying `ack=true`, zero Modbus writes are issued
    - Run ≥100 iterations
    - _Requirements: 6.4, 7.1, 7.2, 7.3, 7.4, 7.5_

- [ ] 17. Checkpoint - main.ts dispatch fully covered
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 18. Replace the integration test's control-lifecycle scenario (`src/lib/integration.test.ts`)
  - [ ]* 18.1 Rewrite the scenario for the unconditional StorEdgeControlBlock
    - Remove the old "control lifecycle" scenario (enable / initial-config / heartbeat / disable) entirely
    - Add, against a mock client: start the adapter (no config flag) → verify the `StorEdgeControlBlock` channel and all nine states exist with `write=true` immediately after start → run a poll cycle → verify all nine states show the mock's live values with `ack=true` → drive an in-range write on one state → verify exactly one correctly-encoded write is issued (right FC + encoding for that def's kind) and the state acks with the written value → drive an out-of-range write → verify zero writes are issued, an error is logged, and the state's previous value is unchanged → drive a write while the mock client reports disconnected → verify the write rejects, is logged, and the previous value is retained
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 6.1, 6.2, 6.3, 6.4, 7.1, 7.2, 7.3, 7.4, 7.5, 8.1, 8.2, 8.3_

- [ ] 19. Final build, typecheck, and full test suite
  - [ ] 19.1 Run `npm run check && npm run build && npm test && npm run lint`
    - Run the TypeScript typecheck, the build, the full test suite, and the linter; fix any failures (including any residual references to deleted modules/config fields/i18n keys) until everything is green
    - _Requirements: (verification of all requirements above)_

- [ ] 20. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test tasks and can be skipped for a faster MVP; core removal/addition tasks (module creation, deletion, `main.ts`/`state-manager.ts` rewrite, config/admin/i18n removal) are never optional.
- This is a migration plan: nothing from the old consumption-based/heartbeat design survives. `consumption.ts`, `control-writer.ts`, and `control-registers.ts` are deleted outright; `state-manager.ts` and `main.ts` are edited to remove the old control machinery and add the new unconditional dispatch.
- Property tests run ≥100 iterations and are tagged `Feature: storedge-battery-control, Property {n}: {text}` matching the design's numbering (1-14).
- Same-file writers are placed in separate waves so parallel execution never conflicts on a single file; `src/main.ts` in particular has three sequential substeps (6.1 → 6.2 → 6.3) since all three touch the same file.
- Deletions of files with no remaining consumers after a given wave are scheduled as early as that wave allows, without conflicting with unrelated same-wave additions.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "2.2", "9.1", "10.1", "11.1", "12.1"] },
    { "id": 1, "tasks": ["1.2", "4.1", "10.2", "14.1", "15.1"] },
    { "id": 2, "tasks": ["4.2", "14.2"] },
    { "id": 3, "tasks": ["6.1"] },
    { "id": 4, "tasks": ["6.2"] },
    { "id": 5, "tasks": ["6.3"] },
    { "id": 6, "tasks": ["8.1", "16.1"] },
    { "id": 7, "tasks": ["16.2", "16.3", "16.4", "16.5", "16.6"] },
    { "id": 8, "tasks": ["18.1"] },
    { "id": 9, "tasks": ["19.1"] }
  ]
}
```
