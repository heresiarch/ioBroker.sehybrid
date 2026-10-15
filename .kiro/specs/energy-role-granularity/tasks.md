# Implementation Plan

- [x] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - Directional energy states collapse to the generic `value.energy` role
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate every directional energy register resolves to the generic `value.energy` instead of a direction-specific role
  - **Scoped PBT Approach**: The bug is deterministic (fixed set of ten register names), so scope the property to those concrete failing cases resolved by name from `SUNSPEC_MAP` / `BATTERY_MAP`
  - In `src/lib/state-manager.test.ts`, for each produced/exported register (`acEnergyWh`, `mExportedWh`, `mExportedWhA`, `mExportedWhB`, `mExportedWhC`, `lifetimeExportEnergy`) call `ensureState` on the appropriate channel (`inverter`, `meter.1`, `battery.1`) and assert the created `common.role` equals `value.energy.produced` (from Bug Condition / Property 1 in design)
  - For each consumed/imported register (`mImportedWh`, `mImportedWhA`, `mImportedWhB`, `mImportedWhC`, `lifetimeImportEnergy`) assert the created `common.role` equals `value.energy.consumed`
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS (this is correct - every directional state resolves to `value.energy`, proving the bug exists)
  - Document counterexamples found (e.g. `ensureState('inverter', acEnergyWh)` yields role `value.energy` instead of `value.energy.produced`; `ensureState('meter.1', mImportedWh)` yields `value.energy` instead of `value.energy.consumed`)
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Non-directional and non-energy state attributes unchanged
  - **IMPORTANT**: Follow observation-first methodology - run the UNFIXED code first and record actual outputs, then assert them
  - Observe on UNFIXED code: capacity-type energy registers `ratedEnergy`, `maximumEnergy`, `availableEnergy` resolve to `value.energy` (channel `battery.1`)
  - Observe on UNFIXED code: non-energy roles are unchanged — e.g. `acPower` → `value.power.active`, `acCurrent` → `value.current`, and every `StorEdgeControlBlock` setpoint role (driven by `STOREDGE_CONTROL_ROLE_MAP`)
  - Observe on UNFIXED code: every energy state keeps `common.type` = `number`, `common.unit` = `Wh`, `common.read` = `true`, `common.write` = `false`
  - Write a property-based test that iterates every def in `SUNSPEC_MAP` and `BATTERY_MAP`: for all defs where the bug condition does NOT hold, assert the resolved `common.role` is unchanged from the original mapping; for all defs, assert `type`, `unit`, `read`, `write` match the pre-fix values (from Preservation Requirements / Property 2 in design)
  - Write a property-based test over a generated range of raw register words asserting the decoded numeric value is identical before and after the fix (role change does not touch decoding)
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms the baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 3. Fix directional energy role granularity

  - [x] 3.1 Extend the role vocabulary and retag directional energy registers in `src/lib/sunspec-map.ts`
    - Add `'energy.produced'` and `'energy.consumed'` members to the `SunSpecRole` union
    - Retag produced/exported energy registers to `role: 'energy.produced'`: `acEnergyWh`, `mExportedWh`, `mExportedWhA`, `mExportedWhB`, `mExportedWhC` (in `SUNSPEC_MAP`) and `lifetimeExportEnergy` (in `BATTERY_MAP`)
    - Retag consumed/imported energy registers to `role: 'energy.consumed'`: `mImportedWh`, `mImportedWhA`, `mImportedWhB`, `mImportedWhC` (in `SUNSPEC_MAP`) and `lifetimeImportEnergy` (in `BATTERY_MAP`)
    - Leave capacity-type energy registers at `role: 'energy'`: `ratedEnergy`, `maximumEnergy`, `availableEnergy` (in `BATTERY_MAP`)
    - Leave all other attributes (type, unit `Wh`, datatype, scaleFactorRef, length, offset, description) of every register unchanged
    - _Bug_Condition: isBugCondition(input) — input.name in the ten directional energy registers AND resolvedRole(input) == 'value.energy'_
    - _Expected_Behavior: produced/exported → `value.energy.produced`, consumed/imported → `value.energy.consumed` (expectedBehavior from design)_
    - _Preservation: capacity energy stays `energy`; type/unit/datatype/length/offset unchanged (Preservation Requirements from design)_
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 3.1_

  - [x] 3.2 Extend ROLE_MAP in `src/lib/state-manager.ts`
    - Add `'energy.produced': 'value.energy.produced'` and `'energy.consumed': 'value.energy.consumed'` to the `ROLE_MAP` record so it stays total over `SunSpecRole`
    - Make no change to `StateManager.ensureState` — it already sets `common.role = ROLE_MAP[def.role]`
    - _Bug_Condition: isBugCondition(input) from design_
    - _Expected_Behavior: expectedBehavior(result) — ROLE_MAP resolves the new tags to the direction-specific ioBroker roles_
    - _Preservation: existing ROLE_MAP entries and `ensureState` behavior unchanged (Preservation Requirements from design)_
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x] 3.3 Update existing tests in `src/lib/state-manager.test.ts` for the new roles
    - Update the `acEnergyWh` role assertion near line 252 (currently expects `value.energy`) to expect `value.energy.produced`
    - Update the `acEnergyWh` representative-mapping assertion near line 915 (currently expects `value.energy`) to expect `value.energy.produced`
    - Update the `EXPECTED_MEASUREMENT_ROLE` / ROLE_MAP snapshots (around lines 851 and 1285) to include `'energy.produced': 'value.energy.produced'` and `'energy.consumed': 'value.energy.consumed'`, and ensure defs tagged with the new roles are resolved against the updated snapshot
    - Leave `acPower` → `value.power.active`, `acCurrent` → `value.current`, and capacity-energy → `value.energy` assertions unchanged
    - _Bug_Condition: isBugCondition(input) from design_
    - _Preservation: non-directional and non-energy assertions remain unchanged (Preservation Requirements from design)_
    - _Requirements: 2.1, 3.1, 3.3_

  - [x] 3.4 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Directional energy states receive direction-specific roles
    - **IMPORTANT**: Re-run the SAME test from task 1 - do NOT write a new test
    - The test from task 1 encodes the expected behavior; when it passes it confirms the expected behavior is satisfied
    - Run the bug condition exploration test from task 1
    - **EXPECTED OUTCOME**: Test PASSES (produced/exported registers resolve to `value.energy.produced`, consumed/imported to `value.energy.consumed`)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x] 3.5 Verify preservation tests still pass
    - **Property 2: Preservation** - Non-directional and non-energy state attributes unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - Run the preservation property tests from task 2
    - **EXPECTED OUTCOME**: Tests PASS (capacity energy still `value.energy`; non-energy roles unchanged; type/unit/read/write and decoded values identical)
    - Confirm all tests still pass after the fix (no regressions)
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 4. Checkpoint - Ensure all tests pass
  - Run the full test suite and the TypeScript build (`common.role` type must stay total over `SunSpecRole`)
  - Ensure all tests pass, ask the user if questions arise
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 3.4_
