# Implementation Plan: StorEdge Battery Control (migrate to SolarEdge documented procedure)

## Overview

The feature is already implemented against the *previous* design (per-poll re-assert of `0xE004`/`0xE00D`, `0xE00B`/`0xE00A` never written, `0xE000` absent, `applyEnable(limit)` / `heartbeat(limit, lastWritten)` with no timeout). The reworked design switches the write flow to SolarEdge's documented "Configuration of the Storage Control for Remote Control mode" procedure: a **one-time initial configuration** (`0xE000=0`, `0xE004=4`, `0xE00A=fallback`, `0xE00D=4`, `0xE00B=commandTimeout` uint32le, `0xE010=limit`) plus a **per-cycle heartbeat** that renews `0xE00B` and re-asserts `0xE00D=4` unconditionally, refreshes `0xE010` write-only-if-changed, and **never** re-writes `0xE000`/`0xE004`/`0xE00A`. This plan migrates the existing code and tests from the old flow to the new flow.

Dependency order (same-file writers separated into different waves): control-register defs (`0xE000` add; `0xE00A`/`0xE00B` become writable) → `encodeUint32le` in `sunspec-decode.ts` → control-writer dispatch/enable/heartbeat signature rework → `main.ts` wiring (new `applyEnable`/`heartbeat` signatures, writable-expert guard) → config type + native defaults → config validation (`defaultFallbackMode`, `commandTimeout > pollInterval`) → state-manager `0xE00B` read-only verification → React admin fields + softened portal warning → i18n keys across all eleven files → property/integration test migration → build/typecheck + full suite + final checkpoint.

Everything remains wired into `main.ts` — no orphaned code. The master gate stays the `controlEnabled` **config setting**. Multiword registers use `encodeFloat32le` (`0xE010`/`0xE00E`) and `encodeUint32le` (`0xE00B`), each the exact inverse of the matching `*le` decoder — never an MSW-first encoder. Language: TypeScript.

## Tasks

- [ ] 1. Migrate control-register definitions to the documented write flow (`src/lib/control-registers.ts`)
  - [ ] 1.1 Add `EXPORT_CONFIG` and make `0xE00A`/`0xE00B` writable
    - Add `EXPORT_CONFIG` (`0xE000`, `kind:'uint16'`, `length:1`, `min:0`, `max:0xffff`, `fc:'FC06'`) and include it as the first entry in `CONTROL_REGISTERS`
    - Change `STORAGE_DEFAULT_MODE` (`0xE00A`): add `fc:'FC06'`, drop the `readOnly` flag used for the register write (it is now written once on enable); the expert-state read-only semantics are handled separately in the state manager
    - Change `REMOTE_CONTROL_COMMAND_TIMEOUT` (`0xE00B`) to `kind:'uint32'`, `length:2`, `wordOrder:'le'`, `fc:'FC16'`, drop the register-write `readOnly` (it is written on enable and renewed each cycle); keep `unit:'s'`, `min:0`, `max:86400`
    - Ensure every def carries an `fc` (FC06 for `0xE000`/`0xE004`/`0xE00A`/`0xE00D`, FC16 for `0xE00B`/`0xE010`/`0xE00E`); keep `findControlDef` unchanged; keep the set fully separate from `SUNSPEC_MAP`/`BATTERY_MAP`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 3.3, 3.4_

- [ ] 2. Add the uint32 little-endian encoder (`src/lib/sunspec-decode.ts`)
  - [ ] 2.1 Add `encodeUint32le`
    - `encodeUint32le(value): [number, number]` — the exact inverse of `decodeRegisters(words, 'uint32le')`: coerce to unsigned 32-bit, return `[low, high]` (words[0]=low 16 bits, words[1]=high 16 bits)
    - Colocate it next to the `uint32le` decoder so the round-trip is provable; keep the existing `encodeFloat32le` unchanged
    - Do NOT introduce or use an MSW-first encoder for `0xE00B`/`0xE010`/`0xE00E`
    - _Requirements: 4.4, 5.1_

  - [ ]* 2.2 Add the uint32le round-trip property test (`src/lib/sunspec-decode.test.ts`)
    - **Feature: storedge-battery-control, Property 5: uint32le encoding round-trips against the existing decoder** — for any unsigned 32-bit integer `v`, `decodeRegisters(encodeUint32le(v), 'uint32le')` reproduces `v` exactly with `words[0]` low and `words[1]` high
    - Keep the existing float32le round-trip (Property 4) test intact
    - Run ≥100 iterations
    - _Requirements: 4.4, 5.1_

- [ ] 3. Rework the control-writer dispatch layer (`src/lib/control-writer.ts`)
  - [ ] 3.1 Add the uint32le write branch and the new enable/heartbeat signatures
    - `write(def, value)`: add a `uint32` + `wordOrder:'le'` branch → `writeMultipleRegisters(address, encodeUint32le(value))` (FC16); keep `uint16` → `writeSingleRegister` (FC06) and `float32` + `le` → `writeMultipleRegisters(address, encodeFloat32le(value))` (FC16); still refuse any def with no `fc`
    - Add `EnableOptions { defaultFallbackMode: number; commandTimeout: number }` and change `applyEnable(computedLimit, opts)` to issue the six-write initial-config sequence **in order**: `0xE000=0` (FC06), `0xE004=4` (FC06), `0xE00A=opts.defaultFallbackMode` (FC06), `0xE00D=4` (FC06), `0xE00B=opts.commandTimeout` (FC16 uint32le), `0xE010=computedLimit` (FC16 float32le)
    - Change `heartbeat(computedLimit, lastWritten, commandTimeout)`: renew `0xE00B=commandTimeout` (FC16 uint32le) unconditionally, write `0xE00D=4` (FC06) unconditionally, write `0xE010` (FC16 float32le) only if `computedLimit !== lastWritten`; do NOT write `0xE000`, `0xE004`, or `0xE00A`; return the new `lastWritten` (unchanged when the `0xE010` write was skipped)
    - Keep `applyRevert(defaultStorageControlMode)` → `0xE004=defaultStorageControlMode` (FC06) unchanged
    - _Requirements: 2.3, 2.4, 2.5, 5.4, 8.1, 8.2, 8.3, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 10.1, 10.2, 11.1, 11.2, 11.3, 11.4, 12.1, 12.4, 12.5_

  - [ ]* 3.2 Migrate the control-writer property tests to the new flow (`src/lib/control-writer.test.ts`)
    - Replace the old "`0xE00A`/`0xE00B` never written" property with the new behavior below
    - **Feature: storedge-battery-control, Property 2: FC06/FC16 forwarding and function-code selection** — `write` selects FC06 for `0xE000`/`0xE004`/`0xE00A`/`0xE00D`, FC16 + `encodeFloat32le` for `0xE010`/`0xE00E`, and FC16 + `encodeUint32le` for `0xE00B`
    - **Feature: storedge-battery-control, Property 9: Initial configuration writes the full sequence in order** — for any `computedLimit`, `defaultFallbackMode`, `commandTimeout`, `applyEnable` issues exactly the six writes in order `0xE000=0`, `0xE004=4`, `0xE00A=defaultFallbackMode`, `0xE00D=4`, `0xE00B=commandTimeout` (uint32le, FC16), `0xE010=computedLimit` (float32le, FC16) and no other register
    - **Feature: storedge-battery-control, Property 8: Discharge limit is written only when it changes** — model-based over a sequence of limits: `0xE010` written exactly on steps differing from the last written value, and `lastWritten` tracks each actual write
    - **Feature: storedge-battery-control, Property 10: Heartbeat renews the timeout and command mode but never the initial-config registers** — over N active cycles, exactly N unconditional FC16 writes of `0xE00B=commandTimeout` (uint32le) and N FC06 writes of `0xE00D=4`, `0xE010` refreshed only on changed cycles, and zero writes to `0xE000`/`0xE004`/`0xE00A`
    - Run ≥100 iterations
    - _Requirements: 2.3, 2.4, 2.5, 8.1, 8.2, 8.3, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 10.1, 10.2, 11.1, 11.2, 11.3, 11.4, 12.4, 12.5_

  - [ ]* 3.3 Add the heartbeat non-fatal property test (`src/lib/control-writer.test.ts`)
    - **Feature: storedge-battery-control, Property 11: Heartbeat write failures are non-fatal** — for any heartbeat cycle where a control write (including the `0xE00B` uint32le renewal) throws a Modbus exception, the failure propagates as a rejected promise the caller routes through the existing poll-cycle failure path rather than terminating
    - Run ≥100 iterations
    - _Requirements: 11.6, 14.2_

- [ ] 4. Checkpoint - encoder and writer migrated
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Update main.ts wiring to the new enable/heartbeat signatures (`src/main.ts`)
  - [ ] 5.1 Update `enableControl`/`onReady` to run the initial-config sequence
    - Change the enable path to call `applyEnable(computedLimit, { defaultFallbackMode: config.defaultFallbackMode, commandTimeout: config.commandTimeout })` (the six-write initial-config sequence), still gated entirely on `config.controlEnabled`
    - Keep seeding the value cache via `getForeignStateAsync` for both source ids, `ensureControlStates()`, `subscribeStates('control.*')`, `subscribeForeignStates(...)` for both ids, `controlActive=true`, and reflect `control.controlActive`
    - Leave the `controlEnabled=false` path unchanged (no writes, no subscriptions, reads unchanged)
    - _Requirements: 1.6, 6.1, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 10.1_

  - [ ] 5.2 Update the `pollOnce` heartbeat tail to the new signature (`src/main.ts`)
    - In the heartbeat tail (inside the existing `try`, only while `controlActive`), recompute the limit and call `heartbeat(limit, this.lastWritten0xE010, config.commandTimeout)`, storing the returned `lastWritten0xE010`
    - Confirm the tail no longer re-asserts `0xE000`/`0xE004`/`0xE00A` (delegated to `heartbeat`); reflect `control.computedDischargeLimit`; a throw still follows the existing cycle-failure path
    - _Requirements: 10.2, 11.1, 11.2, 11.3, 11.4, 11.5, 11.6_

  - [ ] 5.3 Guard `onStateChange` to the writable expert set (`src/main.ts`)
    - Keep the deletion/`ack` early returns and the foreign-source recompute branch
    - For expert control ids, restrict dispatch to the writable set `{0xE004, 0xE00D, 0xE010}` via a `WRITABLE_EXPERT` guard so a user change never resolves to `0xE000`/`0xE00A`/`0xE00B` (ignore unknown / non-writable ids); keep write-only-if-changed for `0xE010`; keep ack-on-success and log-and-retain-on-failure
    - Leave the disable-revert path (`applyRevert(config.defaultStorageControlMode)` + unsubscribe + `controlActive=false`) and `onUnload` (no control write) unchanged
    - _Requirements: 12.2, 12.3, 12.6, 13.4, 13.5, 14.1, 14.2, 14.3_

  - [ ]* 5.4 Migrate the main.ts property tests to the new signatures (`src/main.test.ts`)
    - Update the harness/mocks to the new `applyEnable(limit, { defaultFallbackMode, commandTimeout })` and `heartbeat(limit, lastWritten, commandTimeout)` signatures
    - **Feature: storedge-battery-control, Property 10: Heartbeat renews the timeout and command mode but never the initial-config registers** — over N cycles, `0xE00B` + `0xE00D` re-asserted each cycle, `0xE010` write-only-if-changed, no `0xE000`/`0xE004`/`0xE00A` rewrite; none after disable
    - **Feature: storedge-battery-control, Property 12: User changes dispatch the correct write and acknowledge on success** — a non-acked change on `0xE004`/`0xE00D`/`0xE010` routes one write with the same value (write-only-if-changed for `0xE010`), acks once on success, retains prior value on failure
    - **Feature: storedge-battery-control, Property 14: Revert happens on disable only, never on unload** — the OFF transition writes `0xE004=default` and stops heartbeat/subscriptions; `onUnload` issues no control write
    - Run ≥100 iterations
    - _Requirements: 10.2, 11.1, 11.2, 11.3, 11.4, 12.1, 12.2, 12.6, 13.4, 13.5, 14.1, 14.3_

  - [ ]* 5.5 Confirm the allowed write surface in `src/main.test.ts`/`modbus-client.test.ts` is unchanged
    - Verify the allowed write surface remains exactly `{writeSingleRegister, writeMultipleRegisters}` and coil methods stay forbidden; adjust only if the migration surfaced a drift (likely unchanged)
    - Keep the "reads issue only FC03/FC04" arm intact
    - Run ≥100 iterations
    - _Requirements: 3.1, 3.2_

- [ ] 6. Checkpoint - main.ts migrated to the documented procedure
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 7. Add the new config fields and native defaults (`src/lib/adapter-config.d.ts`, `io-package.json`)
  - [ ] 7.1 Add `defaultFallbackMode` and `commandTimeout`
    - Add to `AdapterConfig`: `defaultFallbackMode: number` and `commandTimeout: number`; keep all existing control fields
    - Add `io-package.json` native defaults: `defaultFallbackMode: 1`, `commandTimeout: 120`; keep the rest
    - _Requirements: 16.1, 16.2_

- [ ] 8. Extend config validation (`src/lib/config-validation.ts`)
  - [ ] 8.1 Add `defaultFallbackMode` and `commandTimeout` rules
    - Add `'defaultFallbackMode' | 'commandTimeout'` to `ConfigField`
    - `defaultFallbackMode`: integer in `[0, 7]` else field-keyed error
    - `commandTimeout`: positive integer (`Number.isInteger && > 0`) **and** strictly greater than `pollInterval` else field-keyed error
    - Keep the existing rules (`defaultStorageControlMode` int [0,4], `maxDischargeLimit` > 0, `sourceMaxAgeSeconds` positive int, required source ids when `controlEnabled`); keep `testConnection` callers unaffected (control fields validated only when present)
    - _Requirements: 17.2, 17.3, 17.7_

  - [ ]* 8.2 Add validation property tests (`src/lib/config-validation.test.ts`)
    - **Feature: storedge-battery-control, Property 16: Default fallback mode bound** — accepted iff integer in `[0, 7]`, else error keyed by `defaultFallbackMode`
    - **Feature: storedge-battery-control, Property 17: Command timeout is a positive integer greater than the poll interval** — for any number and any poll interval, accepted iff a positive integer strictly greater than `pollInterval`, else error keyed by `commandTimeout`
    - Keep the existing validation properties intact
    - Run ≥100 iterations
    - _Requirements: 10.3, 17.2, 17.3, 17.7_

- [ ] 9. Verify the `0xE00B` expert state stays read-only (`src/lib/state-manager.ts`)
  - [ ] 9.1 Confirm/adjust the timeout expert state
    - Verify `control.remoteControlCommandTimeout` remains `read=true, write=false` (reflects the renewed `commandTimeout` value even though the register is now written by the adapter); no new states are added
    - Adjust only if the migration changed the state metadata; leave the other control states and the SunSpec read model untouched
    - _Requirements: 13.2_

- [ ] 10. Update the React admin control settings (`src-admin/src/components/Settings.tsx`)
  - [ ] 10.1 Add the fallback-mode and command-timeout fields and soften the portal warning
    - Add a numeric **Default fallback mode** field bound to `native.defaultFallbackMode` (0..7, default 1) and a numeric **Command timeout (s)** field bound to `native.commandTimeout` (default 120), with per-field `error`/`helperText` ("Invalid default fallback mode" / "Invalid command timeout") driven by `validateConfig`
    - Extend `currentConfig()` to include `defaultFallbackMode` and `commandTimeout`
    - Soften the StorEdge portal warning copy to "recommended" (renewed command timeout is the primary keep-alive), matching the reworked "StorEdge portal warning" i18n value
    - Route all labels through `I18n.t(...)`; keep the existing fields intact
    - _Requirements: 15.2, 16.5, 17.7_

- [ ] 11. Add the new i18n keys to all eleven files (`src-admin/src/i18n/*.json`)
  - [ ] 11.1 Add keys and update the softened warning value
    - In en.json first, then de, ru, pt, nl, fr, it, es, pl, uk, zh-cn: add `Default fallback mode`, `Command timeout (s)`, `Invalid default fallback mode`, `Invalid command timeout`
    - Update the existing `StorEdge portal warning` value in every file to the softened "recommended" copy from the design
    - Provide translations per language (English source values from the design)
    - _Requirements: 15.2, 16.6_

- [ ] 12. Migrate the integration control-lifecycle scenario (`src/lib/integration.test.ts`)
  - [ ]* 12.1 Update the control scenario to the documented procedure
    - Against a mock client: enable → assert the ordered initial-config six-write sequence `0xE000=0`, `0xE004=4`, `0xE00A=fallback`, `0xE00D=4`, `0xE00B=commandTimeout` (uint32le), `0xE010=limit` → drive two source changes and two poll cycles → assert per-cycle `0xE00B` renewal + `0xE00D=4` re-assert + `0xE010` write-only-if-changed and **no** `0xE000`/`0xE004`/`0xE00A` rewrite → disable → assert `0xE004=default` and heartbeat stops
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 10.2, 11.1, 11.2, 11.3, 11.4, 12.1, 12.3, 12.4, 12.5_

- [ ] 13. Build/typecheck and run the full suite
  - [ ] 13.1 Run `npm run check && npm run build && npm test`
    - Run the TypeScript typecheck, the build, and the full test suite; fix any failures until the suite is green
    - _Requirements: 2.7, 3.1_

- [ ] 14. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional (test migration/extension) and can be skipped for a faster MVP; core migration tasks are never optional.
- This is a migration plan: the feature already exists against the previous per-poll re-assert flow; each task moves the code (or its tests) to SolarEdge's documented initial-config + heartbeat procedure.
- Each task references the specific requirement and/or property numbers it implements for traceability.
- Property tests run ≥100 iterations and are tagged `Feature: storedge-battery-control, Property {n}: {text}`.
- Multiword registers use `encodeFloat32le` (`0xE010`/`0xE00E`) and `encodeUint32le` (`0xE00B`), each the exact inverse of the matching `*le` decoder; MSW-first encoders are never used.
- The master gate is the `controlEnabled` config setting; `0xE000`/`0xE004`/`0xE00A` are written only during initial config (`0xE004` also on disable-revert) and never during the heartbeat; there is no unload revert.
- Same-file writers are placed in separate waves so parallel execution never conflicts on a single file.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "7.1", "9.1"] },
    { "id": 1, "tasks": ["2.2", "3.1", "8.1"] },
    { "id": 2, "tasks": ["3.2", "8.2", "10.1"] },
    { "id": 3, "tasks": ["3.3", "11.1", "12.1"] },
    { "id": 4, "tasks": ["5.1"] },
    { "id": 5, "tasks": ["5.2"] },
    { "id": 6, "tasks": ["5.3"] },
    { "id": 7, "tasks": ["5.4"] },
    { "id": 8, "tasks": ["5.5"] },
    { "id": 9, "tasks": ["13.1"] }
  ]
}
```
