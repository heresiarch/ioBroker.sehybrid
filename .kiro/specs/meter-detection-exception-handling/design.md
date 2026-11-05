# Meter Detection Exception Handling Bugfix Design

## Overview

On an inverter that has no meter, the polling cycle fails every tick even though the inverter block is read successfully. The defect is in `detectMeters()` in `src/lib/sunspec-reader.ts`: it probes meter slots 1..3 by reading each slot's DID presence register with `client.readHoldingRegisters(addr, 1)` and has **no error handling** around that read. A meterless device rejects the read with a Modbus exception (exception 2, Illegal data address), and the Modbus client wraps that into a thrown `Error`. The error propagates out of `detectMeters()`, through `pollOnce()` in `src/main.ts`, into the cycle-level catch, which sets `info.connection` to false, logs `Polling cycle failed: ...` at error level, closes the socket, and increments `consecutiveFailures` — on every cycle (GitHub issue #43, adapter v1.1.2).

`detectBatteries()` in the same file already handles exactly this situation correctly: it wraps the per-slot presence read in a `try/catch`, and on a thrown read it logs a debug message and `continue`s, treating the slot as absent. The fix is minimal and targeted: make `detectMeters()` mirror that pattern. Once an absent-meter presence read is caught and treated as "slot absent" instead of propagating, the cycle no longer throws for a legitimately meterless inverter, so `info.connection` correctly reflects the inverter read, `consecutiveFailures` resets, and the socket stays open.

The fix changes only the error-handling path of a rejected presence read. Every other behavior — present meters, unrecognized-but-readable DID values, battery detection, and genuine connection/inverter-read failures — is preserved exactly.

## Glossary

- **Bug_Condition (C)**: The inverter block reads successfully in a cycle, but probing a meter slot's DID presence register throws (the device rejects it, e.g. Modbus exception 2). Today this fails the whole cycle.
- **Property (P)**: The desired behavior for the bug condition — a rejected meter presence read is treated as an absent slot, the loop continues, the cycle completes, and `info.connection` reflects the successful inverter read.
- **Preservation**: Existing behavior that must remain unchanged by the fix — present-meter detection/read, unrecognized-but-readable DID handling, battery detection, and the genuine-failure cycle path.
- **`detectMeters(client)`**: The method in `src/lib/sunspec-reader.ts` that probes meter slots 1..3 by reading each slot's DID register (`getMeterDidAddress(slot)`) and returns only the present slots (`{ index, model }`). This is the function being fixed (**F** before, **F'** after).
- **`detectBatteries(client)`**: The method in the same file that already wraps its per-slot presence read in `try/catch` and treats a thrown read as an absent slot. The reference pattern the fix mirrors.
- **`pollOnce()`**: The polling cycle in `src/main.ts` whose cycle-level `catch` sets `info.connection=false`, logs `Polling cycle failed`, closes the socket, and increments `consecutiveFailures`.
- **`METER_MODEL_IDS`**: The set of recognized meter model DIDs `{201, 202, 203, 204}`. A DID in this set means the slot is present; any other readable value means absent.
- **Presence read**: The single-register read `client.readHoldingRegisters(getMeterDidAddress(slot), 1)` that probes whether a meter occupies a slot.

## Bug Details

### Bug Condition

The bug manifests when a polling cycle reads the inverter block successfully but then probes a meter slot whose DID presence register the device **rejects** (a meterless inverter answers the presence read with a Modbus exception, e.g. exception 2 Illegal data address). The Modbus client turns that rejection into a thrown `Error`. `detectMeters()` has no `try/catch` around the presence read, so the error propagates out of the function and into the cycle-level catch in `pollOnce()`, failing the whole cycle.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input describing one polling cycle against an inverter
  OUTPUT: boolean

  // The inverter block reads successfully, but probing a meter slot's
  // presence register throws (device rejects it, e.g. Modbus exception 2).
  RETURN inverterReadSucceeds(input)
         AND existsMeterSlot(s) SUCH THAT meterPresenceReadThrows(input, s)
END FUNCTION
```

### Examples

- **Meterless SolarEdge inverter (issue #43):** Inverter block reads fine (acPower, acEnergyWh update), but the slot-1 meter DID read at 40188 is rejected. Expected: slot 1 treated as absent, cycle succeeds, `info.connection=true`. Actual: `detectMeters()` throws, `Polling cycle failed` logged every 30s, `info.connection` stays false.
- **Partially populated device:** Slot 1 holds a recognized meter DID (203), slot 2 is rejected. Expected: slot 1 detected and read, slot 2 treated as absent, cycle succeeds. Actual: slot-2 rejection throws before/after slot 1 and fails the cycle.
- **Meterless inverter, repeated cycles:** Expected: a single debug log per occurrence noting the slot is absent, no error. Actual: `Polling cycle failed: ...` at error level every poll interval, `consecutiveFailures` climbing toward `MAX_CONSECUTIVE_FAILURES`.
- **Edge case — all three meter slots rejected:** Expected: `detectMeters()` returns `[]`, cycle completes on the inverter read. Actual: first rejection throws and fails the cycle.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- A meter slot whose presence read **succeeds** and returns a recognized meter model DID (201..204) is still detected, its channel created, and its values read and written exactly as before.
- A meter slot whose presence read **succeeds** but returns a value that is not a recognized DID (e.g. the uint16 sentinel, 0, or any other number) is still treated as absent and logged at debug level exactly as today.
- Battery detection (`detectBatteries()`) is unchanged — its per-slot `try/catch` and absent-slot logging already behave correctly and are not touched.
- A genuine connection or inverter-read failure (inverter block read fails, a timeout, a connection error) still sets `info.connection=false`, logs `Polling cycle failed: ...`, closes the socket, increments `consecutiveFailures`, and escalates after `MAX_CONSECUTIVE_FAILURES`.
- The overlap guard, poll-interval scheduling, and restored-connection logging in `pollOnce()` are unchanged.

**Scope:**
All inputs that do NOT involve a **thrown** meter presence read are completely unaffected by this fix. This includes:
- Meter presence reads that return any readable value (recognized DID or not).
- Battery presence reads (present, absent sentinel, or rejected).
- Inverter block reads and the StorEdgeControlBlock read.
- Genuine connection failures and timeouts, which must still fail the cycle.

The actual expected correct behavior for the bug condition is defined in the Correctness Properties section (Property 1).

## Hypothesized Root Cause

The root cause is confirmed (not merely hypothesized) from the code: the failure is the absence of per-slot error handling in `detectMeters()`.

1. **Unhandled rejected presence read in `detectMeters()`**: The loop calls `const [raw] = await client.readHoldingRegisters(addr, 1);` with no `try/catch`. A meterless device rejects this read (Modbus exception 2), and the client throws. There is no code path that treats a *thrown* presence read as "slot absent" — only a *readable-but-unrecognized* value reaches the `else` branch that logs the slot as absent.
2. **Propagation to the cycle-level catch**: The thrown error escapes `detectMeters()`, escapes the `await reader.detectMeters(client)` call in `pollOnce()`, and is caught by the generic cycle `catch`, which cannot distinguish "no meter present" from "the inverter is unreachable" and therefore fails the whole cycle.
3. **Divergence from `detectBatteries()`**: The battery path already wraps the presence read in `try/catch` and `continue`s on a thrown read. Meter detection simply never received the same treatment, so the two detectors handle a rejected presence read differently.

## Correctness Properties

Property 1: Bug Condition - Rejected meter presence read is treated as an absent slot

_For any_ input where the bug condition holds (`isBugCondition` returns true — the inverter read succeeds and at least one meter slot's presence read throws), the fixed `detectMeters` SHALL catch the thrown read, treat that slot as absent (continue probing the remaining slots without re-throwing), and return only the genuinely present slots; and the enclosing cycle SHALL complete with `info.connection` set to true, `consecutiveFailures` reset to 0, no `Polling cycle failed` error logged, and the absent slot logged once per occurrence at debug level.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5**

Property 2: Preservation - Non-throwing inputs behave identically

_For any_ input where the bug condition does NOT hold (`isBugCondition` returns false — no meter presence read throws), the fixed code SHALL produce the same result as the original function, preserving present-meter detection and reading, unrecognized-but-readable DID handling (treated absent with a debug log), battery detection, and the genuine connection/inverter-read failure path (cycle fails, `info.connection=false`, `Polling cycle failed` logged, socket closed, `consecutiveFailures` incremented).

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**

## Fix Implementation

### Changes Required

The fix mirrors the existing `detectBatteries()` error handling in `detectMeters()`.

**File**: `src/lib/sunspec-reader.ts`

**Function**: `detectMeters(client: IModbusClient): Promise<DetectedMeter[]>`

**Specific Changes**:

1. **Wrap the per-slot presence read in `try/catch`**: Replace the unguarded `const [raw] = await client.readHoldingRegisters(addr, 1);` with a declared `let raw: number;` followed by a `try { [raw] = await client.readHoldingRegisters(addr, 1); } catch (e) { ... }` block, exactly as `detectBatteries()` does.

2. **Treat a thrown read as an absent slot**: In the `catch`, log a debug message that the slot's presence read failed and `continue` to the next slot — do not re-throw. Use the existing `describeError(e)` helper (already defined at the bottom of the file) to render the message, matching the battery log.

3. **Keep the recognized/unrecognized classification unchanged**: After a successful read, the existing `if (METER_MODEL_IDS.has(raw)) { ...present... } else { ...absent debug log... }` logic stays exactly as is.

4. **Log consistency**: The new catch log is at **debug** level and phrased consistently with the existing absent-slot logs (e.g. `No meter in slot ${slot}: presence read at ${addr} failed (${describeError(e)})`), so a meterless inverter produces a single debug line per slot per occurrence and never an error.

Resulting shape of the loop body (for reference, mirroring `detectBatteries()`):

```
for (const slot of METER_SLOTS) {
  const addr = getMeterDidAddress(slot);
  let raw: number;
  try {
    [raw] = await client.readHoldingRegisters(addr, 1);
  } catch (e) {
    // A meterless device may reject the presence read outright; treat as absent.
    this.log.debug(`No meter in slot ${slot}: presence read at ${addr} failed (${describeError(e)})`);
    continue;
  }
  if (METER_MODEL_IDS.has(raw)) {
    this.log.debug(`Detected meter.${slot} model ${raw} (DID register ${addr})`);
    detected.push({ index: slot, model: raw as MeterModelId });
  } else {
    this.log.debug(`No meter in slot ${slot}: DID register ${addr} = ${raw} (expected 201..204)`);
  }
}
```

No change is required in `src/main.ts`: once `detectMeters()` stops throwing for an absent meter, the existing `pollOnce()` flow already reaches `setStateAsync('info.connection', true, true)` and resets `consecutiveFailures` on a successful cycle. The genuine-failure catch path is untouched and still handles real connection/inverter-read failures.

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code, then verify the fix works correctly and preserves existing behavior. Tests live in `src/lib/sunspec-reader.test.ts` and follow the existing conventions there: a `MockClient implements IModbusClient` backed by a sparse register store and a `RecordingLogger implements Logger` that captures `debug`/`warn` messages for assertions (both already defined in that file). The existing `detectMeters` block ("returns only present meter slots", "treats a zero DID as an absent meter slot") is the template for the new cases.

The current `MockClient.readHoldingRegisters` never throws, so the bug-condition tests need a small throwing variant — a subclass (mirroring `SegmentedBatteryClient` in the same file) whose `readHoldingRegisters` rejects for a configured meter DID address and otherwise delegates to `super`. This lets a test make exactly one slot's presence read throw while the others read normally.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm the root cause (unhandled rejected presence read) and that it propagates out of `detectMeters()`.

**Test Plan**: Using a throwing `MockClient` subclass, make the slot-1 meter DID read reject with an `Error` and call `detectMeters(client)`. On the UNFIXED code, assert the promise rejects (the error propagates). Observe that no "absent" debug line is produced for the rejected slot.

**Test Cases**:
1. **Slot-1 rejected, others readable**: slot-1 DID read throws; slots 2 & 3 read recognized DIDs. On unfixed code `detectMeters` rejects (will fail on unfixed code).
2. **All slots rejected (meterless inverter)**: every meter DID read throws. On unfixed code `detectMeters` rejects on the first slot (will fail on unfixed code).
3. **First slot present, later slot rejected**: slot 1 returns 203, slot 2 read throws. On unfixed code `detectMeters` rejects despite a present slot 1 (will fail on unfixed code).

**Expected Counterexamples**:
- `detectMeters()` rejects instead of returning the present slots when any slot's presence read throws.
- Possible causes: missing `try/catch` around the presence read; no absent-on-throw branch; the thrown error reaching the cycle-level catch in `pollOnce()`.

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behavior (slot treated as absent, no throw, present slots returned, absent slot logged at debug).

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := detectMeters_fixed(input)
  ASSERT NOT threw(result)
     AND result = presentSlotsOnly(input)
     AND slotLoggedAbsentAtDebug(input)
END FOR
```

**Test Cases (on fixed code)**:
1. **Slot-1 rejected, slots 2 & 3 present**: assert `detectMeters` resolves (does not throw) and returns exactly the present slots 2 & 3; assert a debug message was recorded for the rejected slot 1 and no `warn` was logged.
2. **All three slots rejected**: assert `detectMeters` resolves to `[]` and does not throw; three debug lines recorded.
3. **Present slot followed by rejected slot**: slot 1 = 203 (present), slot 2 rejects, slot 3 = 201 (present); assert the result is `[{index:1,model:203},{index:3,model:201}]` and no throw.

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT detectMeters_original(input) = detectMeters_fixed(input)
END FOR
```

**Testing Approach**: Property-based testing (`fast-check`, already a dependency used in `sunspec-reader.test.ts`) is recommended for preservation because it generates many register-value combinations across the input domain and catches edge cases manual tests miss. The property: for any assignment of readable DID values to the three meter slots (recognized IDs, the uint16 sentinel, 0, or arbitrary unrecognized numbers) served by a non-throwing `MockClient`, the fixed `detectMeters` returns exactly the slots whose DID is in `METER_MODEL_IDS`, in ascending slot order — identical to the pre-fix behavior.

**Test Plan**: Observe behavior on UNFIXED code first for non-throwing reads (present meters, unrecognized DIDs), then write tests capturing that behavior and confirm the fixed code matches.

**Test Cases**:
1. **Present-meter preservation**: slots holding recognized DIDs (e.g. 203, 201) are still detected with the correct `{ index, model }`; verify against unfixed behavior (the existing "returns only present meter slots" test already encodes this).
2. **Unrecognized-but-readable DID preservation**: slots holding 0, `0xffff`, or an arbitrary non-DID number are treated as absent with a debug log, exactly as before.
3. **Battery-detection preservation**: `detectBatteries` is untouched; its existing tests (present slot, sentinel 255, 0, rejected read) continue to pass.
4. **Genuine-failure preservation**: a thrown inverter/StorEdge read still fails the cycle — covered by the main-module polling tests in `src/main.test.ts`; confirm those remain green after the fix.

### Unit Tests

- `detectMeters` treats a thrown meter presence read as an absent slot and returns the remaining present slots without throwing (new throwing-`MockClient` cases).
- `detectMeters` returns `[]` when all three presence reads throw.
- `detectMeters` still returns present slots and skips unrecognized-but-readable DIDs (existing cases retained).
- A debug log is recorded for each rejected slot; no `warn`/error is produced for a meterless inverter.

### Property-Based Tests

- Generate arbitrary readable DID assignments across the three meter slots and assert the fixed `detectMeters` returns exactly the slots whose DID is in `METER_MODEL_IDS`, in slot order (preservation for all non-throwing inputs).
- Generate which subset of slots throw (via the throwing `MockClient`) and assert `detectMeters` never throws and returns exactly the present, successfully-read slots (fix checking across the bug-condition domain).

### Integration Tests

- In `src/main.test.ts`, a full `pollOnce()` cycle on a client that reads the inverter block successfully but rejects the meter DID read ends with `info.connection=true`, `consecutiveFailures=0`, no `Polling cycle failed` error, and the socket left open (verifies the end-to-end fix for issue #43).
- A cycle where the inverter block read itself fails still ends with `info.connection=false`, a `Polling cycle failed` error, a closed socket, and an incremented `consecutiveFailures` (verifies the genuine-failure path is preserved).
