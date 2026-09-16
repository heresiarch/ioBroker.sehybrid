# Implementation Plan: StorEdge Battery Control

## Overview

Convert the consumption-based design into incremental TypeScript coding steps that layer control onto the existing read-only SunSpec adapter. Dependency order: Modbus FC06/FC16 write function codes and the revised read-only invariant → control-register definitions (`0xExxx`) and the little-endian float32 encoder → pure consumption compute helper → writable expert control states → the control-writer dispatch layer (enable/revert/heartbeat) → `main.ts` wiring (config gate, foreign-source subscriptions, `onStateChange` dispatch, poll-loop heartbeat tail, disable revert, no-unload-revert) → configuration type/native defaults/validation → React admin UI + all eleven i18n files → property/integration tests and a build+test verification.

Everything is wired into `main.ts` by the time control is enabled — no orphaned code. The master gate is the `controlEnabled` **config setting** (not a state); there is no `disableDischarge` switch. Float32 registers use `encodeFloat32le` (the exact inverse of `decodeRegisters('float32le')`), never an MSW-first encoder. Language: TypeScript.

## Tasks

- [x] 1. Add Modbus FC06/FC16 write function codes and revise the read-only invariant
  - [x] 1.1 Implement FC06/FC16 write methods in `src/lib/modbus-client.ts`
    - Add `ModbusWriteOptions` (`timeoutMs?`) and extend `IModbusClient` with `writeSingleRegister(address, value, opts?)` (FC06) and `writeMultipleRegisters(address, values, opts?)` (FC16)
    - Add a shared private `write(fn, address, payload, opts)` helper mirroring the existing `read()` helper: guard `!isConnected()` first (reject with `Modbus client is not connected`), then `this.client.setTimeout(timeoutMs)` and race the library call against `rejectAfter(timeoutMs, …)` using `timeoutMs ?? DEFAULT_TIMEOUT_MS` (10 s), cancelling the timer in `finally`
    - `writeSingleRegister` validates `value` is an integer in `[0, 0xFFFF]` and forwards to library `writeRegister(address, value)`
    - `writeMultipleRegisters` validates a non-empty word array (each word `0..0xFFFF`) and forwards to library `writeRegisters(address, values)`
    - Leave FC03/FC04 read behavior untouched
    - Update the module header comment / `IModbusClient` doc: the client is no longer strictly read-only; its write surface is restricted to exactly FC06 single-register and FC16 multiple-register operations, targeting only `0xE004`/`0xE00D`/`0xE010`/`0xE00E`; no coil write (FC05/FC15) or any other write function code is exposed
    - _Requirements: 2.1, 2.2, 2.5, 2.6, 2.7, 3.1, 3.2, 3.3_

  - [x]* 1.2 Revise the existing read-only property test in `src/lib/modbus-client.test.ts`
    - **Feature: storedge-battery-control, Property 1: Read-only when control is disabled** (revised read-only invariant arm)
    - Move `writeSingleRegister`/`writeMultipleRegisters`/`writeRegister`/`writeRegisters` out of `FORBIDDEN_WRITE_METHODS` into the allowed write surface; keep coil methods (`writeCoil`/`writeCoils`/FC05/FC15) forbidden
    - Keep the "reads never issue a write" arm: over any sequence of reader ops only FC03/FC04 are issued
    - Run ≥100 iterations
    - _Requirements: 3.1, 3.2, 2.7_

  - [x]* 1.3 Write property tests for write forwarding, selection, and not-connected rejection
    - **Feature: storedge-battery-control, Property 2: FC06/FC16 forwarding and function-code selection** — for any address and value, `writeSingleRegister(address, v)` forwards exactly `(address, uint16)` via FC06 and `writeMultipleRegisters(address, words)` forwards exactly `(address, words)` via FC16 to a recording client double, issuing no other write
    - **Feature: storedge-battery-control, Property 3: Writes are rejected when not connected** — for any write kind (FC06/FC16) and any args, `isConnected()===false` ⇒ rejects with a descriptive error and issues no library call
    - Example test: the 10 s timeout race path bounds a write
    - Run ≥100 iterations
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

- [x] 2. Define StorEdge control registers and the little-endian float32 encoder
  - [x] 2.1 Create `src/lib/control-registers.ts` definition set + resolver
    - Add `ControlRegisterKind` (`'uint16' | 'float32' | 'uint32'`), `ControlWordOrder` (`'le'`), and `ControlRegisterDef` with fields `name`, `address`, `kind`, `length`, `wordOrder?`, `iobType`, `unit?`, `min`, `max`, `fc?` (`'FC06' | 'FC16'`), `readOnly?`
    - Export defs: `STORAGE_CONTROL_MODE` (`0xE004`, uint16, len 1, min 0 max 4, FC06); `STORAGE_DEFAULT_MODE` (`0xE00A`, uint16, len 1, min 0 max 7, `readOnly`, no `fc` — never written); `REMOTE_CONTROL_COMMAND_TIMEOUT` (`0xE00B`, uint32, len 2, `wordOrder:'le'`, unit s, min 0 max 86400, `readOnly`, no `fc` — never written); `REMOTE_CONTROL_COMMAND_MODE` (`0xE00D`, uint16, len 1, min 0 max 7, FC06); `REMOTE_CONTROL_CHARGE_LIMIT` (`0xE00E`, float32, len 2, `wordOrder:'le'`, unit W, FC16, expert-optional); `REMOTE_CONTROL_DISCHARGE_LIMIT` (`0xE010`, float32, len 2, `wordOrder:'le'`, unit W, FC16)
    - Export `CONTROL_REGISTERS` array and `findControlDef(name): ControlRegisterDef | undefined`
    - Keep this set fully separate from `SUNSPEC_MAP`/`BATTERY_MAP` (never polled, never in the SunSpec value table)
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7_

  - [x] 2.2 Add `encodeFloat32le` to `src/lib/sunspec-decode.ts`
    - `encodeFloat32le(value): [number, number]` — the exact inverse of `decodeRegisters(words, 'float32le')`: `writeFloatBE` into a 4-byte buffer, then return `[low, high]` (words[0]=low, words[1]=high; bytes big-endian within each word)
    - Colocate it next to the `float32le` decoder so the round-trip is provable; verified `encodeFloat32le(5000) === [0x4000, 0x459c]`
    - Do NOT add or keep an MSW-first `encodeFloat32` for these registers; no `uint32` encoder is needed (`0xE00B` is never written)
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [x]* 2.3 Write property test for the float32le round-trip
    - **Feature: storedge-battery-control, Property 4: float32le encoding round-trips against the existing decoder** — for any finite float32 `v`, `decodeRegisters(encodeFloat32le(v), 'float32le')` reproduces `v` (bit-exact after float32 rounding); plus the fixed vector `encodeFloat32le(5000) === [0x4000, 0x459c]`
    - Run ≥100 iterations
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

- [x] 3. Implement the pure consumption compute helper
  - [x] 3.1 Create `src/lib/consumption.ts`
    - Add `SourceSample { val: unknown; ts: number }`
    - `isSourceValid(sample, nowMs, maxAgeSeconds): boolean` — false when the sample is missing, when `Number(val)` is not finite, or when `nowMs - ts > maxAgeSeconds * 1000`
    - `computeDischargeLimit(house, wallbox, nowMs, maxAgeSeconds, maxDischargeLimit): number` — returns 0 if either source is invalid; otherwise `min(max(Number(house.val) - Number(wallbox.val), 0), maxDischargeLimit)`
    - Keep the module pure (no ioBroker imports) so it is unit/property testable in isolation
    - _Requirements: 6.2, 6.3, 6.4, 7.1, 7.2, 7.3, 7.4_

  - [x]* 3.2 Write property tests for validity and clamping
    - **Feature: storedge-battery-control, Property 5: Computed discharge limit clamps to `[0, maxDischargeLimit]`** — for any valid house/wallbox and any `maxDischargeLimit`, result equals `min(max(house - wallbox, 0), maxDischargeLimit)` and lies in `[0, maxDischargeLimit]`
    - **Feature: storedge-battery-control, Property 6: Invalid or stale source forces the limit to zero** — for any pair where at least one sample is missing, non-numeric, or older than `sourceMaxAgeSeconds`, the computed limit is 0
    - Run ≥100 iterations
    - _Requirements: 6.2, 6.3, 6.4, 7.1, 7.2, 7.3, 7.4_

- [x] 4. Create the writable expert control states in the state manager
  - [x] 4.1 Add `ensureControlStates()` + `setControlAck()` to `src/lib/state-manager.ts`
    - Extend `IStateManager` with `ensureControlStates(): Promise<void>` and `setControlAck(name, value): Promise<void>`
    - `ensureControlStates()` creates the expert `control` channel (`common.expert = true`) and states, created **outside** the register-map-driven read model: `control.storageControlMode` (number, `level.mode`, read+write, raw `0xE004`), `control.remoteControlCommandMode` (number, `level.mode`, read+write, raw `0xE00D`), `control.remoteControlDischargeLimit` (number W, `value.power`, read+write, raw `0xE010`), `control.remoteControlCommandTimeout` (number s, `value.interval`, read-only `read=true write=false`, raw `0xE00B`), `control.computedDischargeLimit` (number W, `value.power`, read-only reflection), `control.controlActive` (boolean, `indicator`, read-only status)
    - No `disableDischarge` switch — the master enable is the `controlEnabled` config setting
    - `setControlAck(name, value)` writes `{ val, ack: true }` to `control.<name>`
    - Leave existing SunSpec `ensureChannel`/`ensureState`/`writeValue` (`write=false`) untouched
    - _Requirements: 13.1, 13.2, 13.3, 13.6_

  - [x]* 4.2 Write example tests for control-state metadata
    - Each expert writable state has `read=true, write=true`; `control.remoteControlCommandTimeout` is `read=true, write=false`; `control.controlActive` is a read-only boolean
    - No control state derives from `SUNSPEC_MAP`/`BATTERY_MAP` (supports Property 12/Req 13.6)
    - _Requirements: 13.1, 13.2, 13.3, 13.6_

- [x] 5. Implement the control-writer dispatch layer
  - [x] 5.1 Create `src/lib/control-writer.ts`
    - `write(def, value)` refuses any def that is `readOnly` or targets `0xE00A`/`0xE00B` (those defs carry no `fc`); selects encoding by `def.kind`: `uint16` → `writeSingleRegister(address, value)` (FC06); `float32` with `wordOrder:'le'` → `writeMultipleRegisters(address, encodeFloat32le(value))` (FC16)
    - `applyEnable(computedLimit)` → `0xE004=4` (FC06), `0xE00D=4` (FC06), `0xE010=computedLimit` (FC16)
    - `applyRevert(defaultStorageControlMode)` → `0xE004=defaultStorageControlMode` (FC06)
    - `heartbeat(computedLimit, lastWritten)` → `0xE004=4` (FC06) and `0xE00D=4` (FC06) unconditionally, then `0xE010=computedLimit` (FC16) only if `computedLimit !== lastWritten`; returns the new `lastWritten` (unchanged when skipped)
    - _Requirements: 2.3, 2.4, 5.4, 8.1, 8.2, 8.3, 9.1, 9.2, 9.3, 10.1, 11.1, 11.2, 11.3, 12.1, 12.4_

  - [x]* 5.2 Write property tests for dispatch, write-only-if-changed, heartbeat, and never-written registers
    - **Feature: storedge-battery-control, Property 7: Discharge limit is written only when it changes** — model-based over a sequence of computed limits: `0xE010` is written exactly on steps differing from the last written value, skipped when unchanged, and `lastWritten` tracks each actual write
    - **Feature: storedge-battery-control, Property 8: Command modes are re-asserted every active cycle** — over N active cycles, exactly N unconditional FC06 writes of `0xE004=4` and N of `0xE00D=4`, with `0xE010` refreshed only on changed cycles
    - **Feature: storedge-battery-control, Property 9: The timeout and default-mode registers are never written** — over any op sequence, zero writes target `0xE00B` or `0xE00A`
    - Run ≥100 iterations
    - _Requirements: 8.1, 8.2, 8.3, 10.1, 10.2, 11.1, 11.2, 11.3, 12.4_

- [x] 6. Checkpoint - core control building blocks complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Wire control into main.ts
  - [x] 7.1 Add the config gate, subscriptions, and enable sequence in `onReady` (`src/main.ts`)
    - Add adapter-instance runtime state: `controlActive: boolean`, `lastHouseSample`, `lastWallboxSample`, `lastWritten0xE010`
    - Register the handler in the constructor: `this.on('stateChange', this.onStateChange.bind(this))`
    - In `onReady`, gate ALL control wiring on `config.controlEnabled`: `await stateManager.ensureControlStates()`, `subscribeStates('control.*')`, `subscribeForeignStates(houseConsumptionStateId)` and the wallbox id
    - Seed the value cache via `getForeignStateAsync` for both ids, then run `controlWriter.applyEnable(computedLimit)` (`0xE004=4`, `0xE00D=4`, `0xE010=computed`) and set `controlActive=true` (also reflect `control.controlActive`)
    - When `controlEnabled` is false: none of the above runs (no `ensureControlStates`, no subscriptions, no enable sequence, no heartbeat); reads proceed unchanged
    - _Requirements: 1.1, 1.2, 1.3, 1.5, 1.6, 6.1, 9.1, 9.2, 9.3_

  - [x] 7.2 Implement `onStateChange` dispatch in `src/main.ts`
    - Return on deletion (`!state`); return if `state.ack === true` (adapter-originated ack — prevents write loops)
    - Foreign source change (id === house or wallbox id): update the value cache (`val + ts`), recompute `computeDischargeLimit(...)`, and write `0xE010` only if it differs from `lastWritten0xE010` (then update `lastWritten0xE010`)
    - Expert control id: resolve leaf → `findControlDef(leaf)`; ignore when unknown or `!def.fc`; for `0xE010` honor write-only-if-changed (ack without writing when unchanged); otherwise `controlWriter.write(def, Number(state.val))`; on success `stateManager.setControlAck(leaf, …)`
    - On any write failure: `log.error(...)` and retain the prior acked value; Modbus exceptions are non-fatal (do not throw out of the handler)
    - _Requirements: 6.1, 8.1, 8.2, 8.3, 13.4, 13.5, 14.1, 14.2, 14.3_

  - [x] 7.3 Add the heartbeat tail to `pollOnce` and the disable-revert transition in `src/main.ts`
    - Append after the existing reads, **inside the same `try`**, only while `controlActive`: recompute the limit from the cache, call `controlWriter.heartbeat(limit, this.lastWritten0xE010)` (`0xE004`/`0xE00D` unconditional, `0xE010` write-only-if-changed), store the returned `lastWritten0xE010`, and reflect `control.computedDischargeLimit` — a throw here follows the existing cycle-failure path (`info.connection=false`, close, reconnect next cycle)
    - Disable transition (`controlEnabled` observed false): `controlWriter.applyRevert(config.defaultStorageControlMode)` (`0xE004=default`), unsubscribe both foreign sources and `control.*`, set `controlActive=false` (heartbeat then skipped)
    - `onUnload` performs NO control write (clear timer + close socket only)
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 12.1, 12.2, 12.3, 12.5_

  - [x]* 7.4 Write property tests for read-only-when-disabled, ack handling, dispatch/retain, and revert scope
    - **Feature: storedge-battery-control, Property 1: Read-only when control is disabled** — with `controlEnabled=false`, across `onReady` + N poll cycles + injected state changes, zero write function codes are issued and no subscription is registered, while FC03/FC04 polling continues unchanged
    - **Feature: storedge-battery-control, Property 10: User changes dispatch the correct write and acknowledge on success** — any non-acked change on a writable control id routes one write to the correct register+FC with the same value (honoring write-only-if-changed for `0xE010`), acks once on success, and on failure acks nothing and retains the prior value while continuing to run
    - **Feature: storedge-battery-control, Property 11: Acknowledged changes issue no write** — any `ack=true` change issues zero Modbus writes
    - **Feature: storedge-battery-control, Property 12: Revert happens on disable only, never on unload** — the OFF transition writes `0xE004=default` and stops the heartbeat and subscriptions; `onUnload` issues no control write
    - Run ≥100 iterations
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 12.1, 12.2, 12.5, 13.4, 13.5, 14.1, 14.2, 14.3_

- [x] 8. Checkpoint - control fully wired into main.ts
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Add configuration type, native defaults, and validation
  - [x] 9.1 Extend `src/lib/adapter-config.d.ts` and `io-package.json` native
    - Add to `AdapterConfig`: `controlEnabled: boolean`, `defaultStorageControlMode: number`, `houseConsumptionStateId: string`, `wallboxConsumptionStateId: string`, `maxDischargeLimit: number`, `sourceMaxAgeSeconds: number`
    - Add `io-package.json` native defaults: `controlEnabled=false`, `defaultStorageControlMode=1`, `houseConsumptionStateId=""`, `wallboxConsumptionStateId=""`, `maxDischargeLimit=5000`, `sourceMaxAgeSeconds=120`
    - _Requirements: 16.1, 16.2_

  - [x] 9.2 Extend `src/lib/config-validation.ts` with control rules
    - Add `'defaultStorageControlMode' | 'houseConsumptionStateId' | 'wallboxConsumptionStateId' | 'maxDischargeLimit' | 'sourceMaxAgeSeconds'` to `ConfigField`; validate control fields only when present (existing host/port/unitId/`testConnection` callers unaffected)
    - `defaultStorageControlMode`: integer in `[0, 4]` else field-keyed error
    - `maxDischargeLimit`: strictly positive (`> 0`) else field-keyed error
    - `sourceMaxAgeSeconds`: positive integer (`Number.isInteger && > 0`) else field-keyed error
    - When `controlEnabled` is true: `houseConsumptionStateId` and `wallboxConsumptionStateId` must be non-empty strings else the respective field-keyed error (not required when false)
    - REMOVE any `commandTimeout > pollInterval` rule (there is no command-timeout setting)
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5_

  - [x]* 9.3 Write property tests for control config validation
    - **Feature: storedge-battery-control, Property 13: Default control mode bound** — accepted iff integer in `[0, 4]`, else error keyed by `defaultStorageControlMode`
    - **Feature: storedge-battery-control, Property 14: Max discharge limit positivity** — accepted iff strictly positive, else error keyed by `maxDischargeLimit`
    - **Feature: storedge-battery-control, Property 15: Source max age is a positive integer** — accepted iff a positive integer, else error keyed by `sourceMaxAgeSeconds`
    - **Feature: storedge-battery-control, Property 16: Source ids required when control is enabled** — with `controlEnabled` true, accepted only when both source ids are non-empty strings, else error keyed by the offending source-id field
    - Run ≥100 iterations
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5_

- [x] 10. Add the React admin control settings + i18n
  - [x] 10.1 Extend `src-admin/src/components/Settings.tsx`
    - Add below the connection fields: a `controlEnabled` `Checkbox` with a **prominent warning** rendered next to it describing the StorEdge portal-profile prerequisite (Req 15.2); a Default Storage Control Mode `Select` with **exactly five** options (0 Disabled, 1 Maximize Self Consumption, 2 Time of Use / Profile programming, 3 Backup Only, 4 Remote Control); two foreign-state-id text inputs (`houseConsumptionStateId`, `wallboxConsumptionStateId`); a numeric `maxDischargeLimit` field (default 5000); a numeric `sourceMaxAgeSeconds` field (default 120)
    - Extend `currentConfig()` to include the six control fields; drive per-field `error`/`helperText` via `validateConfig`
    - Route all labels through `I18n.t(...)`
    - _Requirements: 15.2, 16.1, 16.3, 16.4, 16.5, 17.5_

  - [x] 10.2 Add the new i18n keys to all eleven `src-admin/src/i18n/*.json` files
    - Add keys to en.json first, then de, ru, pt, nl, fr, it, es, pl, uk, zh-cn: `Enable battery control`, `StorEdge portal warning`, `Default Storage Control Mode`, `House consumption state`, `Wallbox consumption state`, `Max discharge limit (W)`, `Source max age (s)`, `Mode 0 Disabled`, `Mode 1 Maximize Self Consumption`, `Mode 2 Time of Use`, `Mode 3 Backup Only`, `Mode 4 Remote Control`, `Invalid default control mode`, `Invalid max discharge limit`, `Invalid source max age`, `Source id required`
    - Provide translations per language (English source values from the design)
    - _Requirements: 15.2, 16.3, 16.5_

- [x] 11. Integration scenario and verification
  - [x]* 11.1 Add the control scenario to `src/lib/integration.test.ts`
    - Against a mock client: enable → verify the enable sequence (`0xE004=4`, `0xE00D=4`, `0xE010=limit`) → drive two source changes and two poll cycles → verify per-cycle unconditional re-assert of `0xE004`/`0xE00D` and write-only-if-changed on `0xE010` → disable → verify `0xE004=default` and that the heartbeat stops
    - _Requirements: 8.2, 9.1, 9.2, 9.3, 11.1, 11.2, 11.3, 12.1, 12.3_

  - [x] 11.2 Run build/typecheck and the full test suite
    - Run `npm run check` (TypeScript typecheck) and `npm test`; fix any failures until the suite is green
    - _Requirements: 2.7, 3.1_

- [x] 12. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional (test-focused or nice-to-have) and can be skipped for a faster MVP; core implementation tasks are never optional.
- Each task references the specific requirement and/or property numbers it implements for traceability.
- Property tests run ≥100 iterations and are tagged `Feature: storedge-battery-control, Property {n}: {text}`.
- The master gate is the `controlEnabled` config setting, not a state; there is no `disableDischarge` switch and no unload revert.
- Float32 registers use `encodeFloat32le` (the exact inverse of `decodeRegisters('float32le')`); `0xE00B`/`0xE00A` are never written.
- Control code is kept separate from the read model throughout; all control wiring in `main.ts` is gated on `config.controlEnabled`.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "3.1", "9.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "2.2", "3.2", "9.2"] },
    { "id": 2, "tasks": ["2.3", "4.1", "5.1", "9.3", "10.1"] },
    { "id": 3, "tasks": ["4.2", "5.2", "7.1", "10.2"] },
    { "id": 4, "tasks": ["7.2"] },
    { "id": 5, "tasks": ["7.3"] },
    { "id": 6, "tasks": ["7.4", "11.1"] },
    { "id": 7, "tasks": ["11.2"] }
  ]
}
```
