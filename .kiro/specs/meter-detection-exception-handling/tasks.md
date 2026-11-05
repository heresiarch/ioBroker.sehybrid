# Implementation Plan

- [x] 1. Write bug condition exploration tests
  - **Property 1: Bug Condition** - Rejected meter presence read fails the cycle
  - **CRITICAL**: These tests MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: These tests encode the expected behavior - they will validate the fix when they pass after implementation
  - **GOAL**: Surface counterexamples that demonstrate the bug exists
  - **Scoped PBT Approach**: For this deterministic bug, scope the tests to concrete failing cases (specific slots throwing) for reproducibility
  - In `src/lib/sunspec-reader.test.ts`, add a throwing `MockClient` subclass (mirror the existing `SegmentedBatteryClient` pattern) whose `readHoldingRegisters` rejects with an `Error` for a configured meter DID address and otherwise delegates to `super`
  - Write test cases using this client, calling `reader.detectMeters(client)`:
    - Slot-1 DID read throws while slots 2 & 3 read recognized DIDs (203, 201)
    - All three meter DID reads throw (meterless inverter)
    - Slot 1 returns 203 (present), slot 2 DID read throws, slot 3 returns 201
  - The assertions encode Expected Behavior: `detectMeters` resolves without throwing and returns only the genuinely present slots, with a debug log per rejected slot
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests FAIL - `detectMeters` rejects/propagates the thrown read (this is correct - it proves the bug exists)
  - Document counterexamples found (e.g. "detectMeters rejects instead of returning present slots when a slot presence read throws")
  - Mark task complete when tests are written, run, and failure is documented
  - _Bug_Condition: isBugCondition(input) = inverterReadSucceeds(input) AND existsMeterSlot(s) SUCH THAT meterPresenceReadThrows(input, s)_
  - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Non-throwing inputs behave identically
  - **IMPORTANT**: Follow observation-first methodology - observe behavior on UNFIXED code for non-bug-condition inputs, then capture it
  - Observe on UNFIXED code: slots holding recognized DIDs (e.g. 203, 201) are detected as `{ index, model }`; slots holding 0, `0xffff`, or arbitrary non-DID numbers are treated as absent with a debug log
  - Confirm the existing `detectMeters` tests ("returns only present meter slots (1 & 3)", "treats a zero DID as an absent meter slot") already encode present/absent behavior and remain green
  - Confirm existing `detectBatteries` tests (present slot, sentinel `0xffff`/255, 0, rejected read) remain green - battery detection is untouched
  - Add a `fast-check` property test (fast-check is already a dependency used in this file): for any assignment of readable DID values to the three meter slots served by a non-throwing `MockClient`, `detectMeters` returns exactly the slots whose DID is in `METER_MODEL_IDS`, in ascending slot order
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms the baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Preservation: For all X WHERE NOT isBugCondition(X): F(X) = F'(X)_
  - _Requirements: 3.1, 3.2, 3.3, 3.5, 3.6_

- [x] 3. Fix for unhandled rejected meter presence read in detectMeters()

  - [x] 3.1 Implement the fix in detectMeters()
    - In `src/lib/sunspec-reader.ts`, in the `detectMeters()` slot loop, replace the unguarded `const [raw] = await client.readHoldingRegisters(addr, 1);` with a declared `let raw: number;` followed by a `try { [raw] = await client.readHoldingRegisters(addr, 1); } catch (e) { ... }` block, mirroring `detectBatteries()`
    - In the `catch`, log at debug level and `continue` to the next slot (do not re-throw): `this.log.debug(\`No meter in slot ${slot}: presence read at ${addr} failed (${describeError(e)})\`);` using the existing `describeError` helper
    - Keep the recognized/unrecognized classification (`if (METER_MODEL_IDS.has(raw)) { ...present... } else { ...absent debug log... }`) exactly as is
    - No change in `src/main.ts` - once `detectMeters()` stops throwing, the existing `pollOnce()` flow reaches `info.connection=true` and resets `consecutiveFailures`
    - _Bug_Condition: isBugCondition(input) = inverterReadSucceeds(input) AND existsMeterSlot(s) SUCH THAT meterPresenceReadThrows(input, s)_
    - _Expected_Behavior: catch the thrown read, treat slot as absent, continue probing, return only present slots; cycle completes with info.connection=true, consecutiveFailures=0, no "Polling cycle failed" error, absent slot logged at debug_
    - _Preservation: present-meter detection, unrecognized-but-readable DID handling, battery detection, and the genuine-failure cycle path remain unchanged_
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x] 3.2 Verify bug condition exploration tests now pass
    - **Property 1: Expected Behavior** - Rejected meter presence read is treated as an absent slot
    - **IMPORTANT**: Re-run the SAME tests from task 1 - do NOT write new tests
    - The tests from task 1 encode the expected behavior; when they pass, they confirm the bug is fixed
    - Run the bug condition exploration tests from task 1
    - **EXPECTED OUTCOME**: Tests PASS - `detectMeters` resolves and returns only the present slots (slot-1 rejected returns slots 2 & 3; all rejected returns `[]`; present-then-rejected returns `[{index:1,model:203},{index:3,model:201}]`), with a debug log per rejected slot and no warn/error
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x] 3.3 Verify preservation tests still pass
    - **Property 2: Preservation** - Non-throwing inputs behave identically
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - Run the preservation tests from task 2 plus the existing `detectMeters`, `detectBatteries`, and `fast-check` tests
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - Confirm all existing `sunspec-reader.test.ts` tests still pass after the fix
    - _Requirements: 3.1, 3.2, 3.3, 3.5, 3.6_

- [x] 4. Add integration tests in src/main.test.ts
  - **Property 1 / Property 2: End-to-end fix and genuine-failure preservation**
  - Add a `pollOnce()` cycle test on a client that reads the inverter block successfully but rejects the meter DID read: assert the cycle ends with `info.connection=true`, `consecutiveFailures=0`, no `Polling cycle failed` error logged, and the socket left open (verifies the end-to-end fix for issue #43)
  - Add a cycle test where the inverter block read itself fails: assert the cycle still ends with `info.connection=false`, a `Polling cycle failed` error, a closed socket, and an incremented `consecutiveFailures` (verifies the genuine-failure path is preserved)
  - Run the tests and confirm both pass
  - _Requirements: 2.2, 2.3, 2.5, 3.4_

- [x] 5. Checkpoint - Run full build and test suite
  - Run `npm run test` and confirm the build and the entire test suite pass
  - Ensure all tests pass, ask the user if questions arise
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_
