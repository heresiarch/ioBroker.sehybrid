# Implementation Plan

- [x] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - Reactive Power Uses the Dedicated Role
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate the bug exists
  - **Scoped PBT Approach**: The bug is deterministic; scope the property to the concrete failing set — every `SUNSPEC_MAP` def with `role === 'power.reactive'` (`acVAR`, `mVAR`, `mVARA`, `mVARB`, `mVARC`)
  - In `src/lib/state-manager.test.ts`, call `ensureState` against a mock adapter for each reactive-power register, then read back the created object's `common.role`
  - Assert `common.role === 'value.power.reactive'` for each — this matches the Expected Behavior (Property 1 in design)
  - Add an edge-case iteration asserting the set of `power.reactive` defs is exactly the five expected registers and all are affected
  - Run the test on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS (this is correct - it proves the bug exists; observes `value.power` instead of `value.power.reactive`)
  - Document counterexamples found (e.g. "ensureState for acVAR produces common.role = 'value.power' instead of 'value.power.reactive'")
  - Mark task complete when test is written, run, and failure is documented
  - _Bug_Condition: isBugCondition(def) where def.role == 'power.reactive' AND ROLE_MAP[def.role] != 'value.power.reactive'_
  - _Requirements: 1.1, 1.2, 2.1, 2.2_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - All Non-Reactive Roles and Non-Role Metadata Unchanged
  - **IMPORTANT**: Follow observation-first methodology — observe behavior on UNFIXED code first, then encode it
  - Observe on UNFIXED code: `power.apparent` states (`acVA`, `mVA`, `mVAA`, `mVAB`, `mVAC`) → `value.power`; `power` (active, e.g. `acPower`) → `value.power.active`; and the pre-fix role for every other logical role (`current`, `voltage`, `powerFactor`, `frequency`, `energy`, `temperature`, `percent`, `status`, `info`)
  - Observe reactive-power non-role metadata on UNFIXED code: `type === 'number'`, `unit === 'var'`, `read === true`, `write === false`
  - Write a property-based test over all `SUNSPEC_MAP` value defs: for every def with `role !== 'power.reactive'`, assert the created `common.role` equals its pinned pre-fix value (Req 3.1, 3.2, 3.3)
  - Write a property-based test over all reactive-power defs: assert full non-role common metadata (`name`, `type`, `unit`, `read`, `write`) is invariant (Req 3.4)
  - Assert the nine `StorEdgeControlBlock` states keep their `STOREDGE_CONTROL_ROLE_MAP` roles (unaffected by `ROLE_MAP`)
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Preservation: Every def where def.role != 'power.reactive' keeps its exact common.role; reactive-power states keep all non-role metadata_
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 3. Fix for reactive-power role mapping (power.reactive → value.power.reactive)

  - [x] 3.1 Implement the fix
    - In `src/lib/state-manager.ts`, change the single `ROLE_MAP` entry `'power.reactive': 'value.power'` to `'power.reactive': 'value.power.reactive'`
    - Leave the `'power.apparent': 'value.power'` entry exactly as-is (there is no `value.power.apparent` role)
    - Do NOT change the consumption site `role: ROLE_MAP[def.role]` in `ensureState`; the new value propagates automatically to all five reactive-power states
    - Do NOT edit `SUNSPEC_MAP`, `SunSpecRole`, the five reactive-power defs, or `STOREDGE_CONTROL_ROLE_MAP`
    - Update the pinned `EXPECTED_MEASUREMENT_ROLE` map in `src/lib/state-manager.test.ts`: set the `'power.reactive'` expectation to `'value.power.reactive'`; keep all other expectations identical. Update any other test literal that pins the old reactive-power role the same way
    - _Bug_Condition: isBugCondition(def) where def.role == 'power.reactive' from design_
    - _Expected_Behavior: expectedBehavior(result) → common.role == 'value.power.reactive' from design (Property 1)_
    - _Preservation: Preservation Requirements from design (power.apparent stays value.power, power stays value.power.active, all other roles and reactive-power non-role metadata unchanged)_
    - _Requirements: 2.1, 2.2, 3.1, 3.2, 3.3, 3.4_

  - [x] 3.2 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Reactive Power Uses the Dedicated Role
    - **IMPORTANT**: Re-run the SAME test from task 1 - do NOT write a new test
    - The test from task 1 encodes the expected behavior; when it passes it confirms the expected behavior is satisfied
    - Run the bug condition exploration test from step 1
    - **EXPECTED OUTCOME**: Test PASSES (confirms the bug is fixed — all five reactive-power states now report `value.power.reactive`)
    - _Requirements: 2.1, 2.2_

  - [x] 3.3 Verify preservation tests still pass
    - **Property 2: Preservation** - All Non-Reactive Roles and Non-Role Metadata Unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - Run the preservation property tests from step 2
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions — `power.apparent` still `value.power`, `power` still `value.power.active`, all other roles and reactive-power non-role metadata unchanged)
    - Confirm all tests still pass after the fix
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 4. Checkpoint - Ensure all tests pass
  - Run the full build (`tsc`) to confirm the one-line change compiles against the total `Record<SunSpecRole, string>` typing
  - Run the complete adapter test suite; confirm no other state's role expectation regresses and the role-validation suite (E1008/E1009/E1011 catalogue checks) still passes with the catalogue-valid read-only role `value.power.reactive`
  - Ensure all tests pass; ask the user if questions arise
  - _Requirements: 2.1, 2.2, 3.1, 3.2, 3.3, 3.4_
