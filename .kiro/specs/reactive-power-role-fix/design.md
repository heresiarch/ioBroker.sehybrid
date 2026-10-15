# Reactive Power Role Fix Bugfix Design

## Overview

The adapter derives each ioBroker state object's `common.role` from a logical SunSpec role via the total lookup table `ROLE_MAP` in `src/lib/state-manager.ts`. The entry for the logical role `power.reactive` currently resolves to the generic `value.power`, the same string used for apparent power. The ioBroker state-roles reference defines a dedicated role `value.power.reactive` for reactive-power quantities (unit `var` / `kVar`), so the current mapping is semantically imprecise: the five reactive-power states the adapter creates — `acVAR` on the inverter and `mVAR`, `mVARA`, `mVARB`, `mVARC` on the meter — advertise an active/apparent-power-style role rather than the role that matches their physical quantity.

The fix is a single, targeted change to one `ROLE_MAP` entry: `'power.reactive': 'value.power'` becomes `'power.reactive': 'value.power.reactive'`. No other mapping entry changes. In particular, `power.apparent` stays mapped to `value.power` because the ioBroker reference has no `value.power.apparent` role. The change flows automatically to every affected state because all reactive-power registers resolve their role through the same lookup at the single state-object build site (`role: ROLE_MAP[def.role]` in `ensureState`). The accompanying work updates the existing unit expectations that pin the old string and verifies that no other state's role shifts.

## Glossary

- **Bug_Condition (C)**: The condition that triggers the bug — a state object is being created for a register whose logical SunSpec role is `power.reactive`, so its `common.role` is sourced from the imprecise `ROLE_MAP['power.reactive']` entry.
- **Property (P)**: The desired behavior — a register with logical role `power.reactive` SHALL be given `common.role = 'value.power.reactive'`.
- **Preservation**: Every state whose logical role is NOT `power.reactive` keeps the exact `common.role` it had before the fix, and every reactive-power state keeps all its non-role properties (name, type, unit, read, write, scaling) unchanged.
- **`ROLE_MAP`**: The total `Record<SunSpecRole, string>` lookup in `src/lib/state-manager.ts` that maps each logical SunSpec role to a valid ioBroker `common.role` string.
- **`ensureState`**: The `StateManager` method in `src/lib/state-manager.ts` that creates a SunSpec state object once per run; it sets `role: ROLE_MAP[def.role]` — the single consumption site of `ROLE_MAP`.
- **`SunSpecRole`**: The logical-role union type in `src/lib/sunspec-map.ts`; `power.reactive` is one of its members, carried on each register def as `def.role`.
- **Reactive-power registers**: The five register defs in `SUNSPEC_MAP` tagged `role: 'power.reactive'` with unit `var` — `acVAR` (model 101, inverter) and `mVAR`, `mVARA`, `mVARB`, `mVARC` (model 201, meter).

## Bug Details

### Bug Condition

The bug manifests when a state object is created for a register whose logical role is `power.reactive`. The role string handed to ioBroker is sourced from `ROLE_MAP['power.reactive']`, which is defined as the imprecise `value.power` (the generic/apparent-power role) instead of the dedicated reactive-power role `value.power.reactive`. The defect is purely in the lookup-table entry; the consumption site (`role: ROLE_MAP[def.role]`) and the register defs themselves are correct.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type SunSpecRegisterDef (the def passed to ensureState)
  OUTPUT: boolean

  RETURN input.role == 'power.reactive'
         AND ROLE_MAP[input.role] != 'value.power.reactive'
END FUNCTION
```

### Examples

- `acVAR` (inverter, unit `var`): expected `common.role = 'value.power.reactive'`, actual `common.role = 'value.power'`.
- `mVAR` (meter total reactive power, unit `var`): expected `value.power.reactive`, actual `value.power`.
- `mVARA` / `mVARB` / `mVARC` (meter per-phase reactive power, unit `var`): expected `value.power.reactive`, actual `value.power`.
- `acVA` (inverter apparent power, unit `VA`, role `power.apparent`): expected and actual `common.role = 'value.power'` — correct, outside the bug condition, must stay unchanged.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- `power.apparent` registers (`acVA`, `mVA`, `mVAA`, `mVAB`, `mVAC`) must continue to map to `value.power` (there is no `value.power.apparent` role in the ioBroker reference) — Req 3.1.
- `power` registers (active power, e.g. `acPower`) must continue to map to `value.power.active` — Req 3.2.
- Every other logical role — `current`, `voltage`, `powerFactor`, `frequency`, `energy`, `temperature`, `percent`, `status`, `info` — must continue to map to exactly the role it mapped to before the fix — Req 3.3.
- Every reactive-power state must preserve all non-role properties: `name`, `type` (`number`), `unit` (`var`), `read = true`, `write = false`, and the upstream scale-factor / scaling behavior — Req 3.4.
- The nine `StorEdgeControlBlock` writable controls (sourced from the separate `STOREDGE_CONTROL_ROLE_MAP`, not `ROLE_MAP`) are entirely unaffected.

**Scope:**
All inputs where the logical role is NOT `power.reactive` must be completely unaffected by this fix. This includes:
- All other measurement roles (active power, apparent power, current, voltage, frequency, energy, temperature, percent, power factor).
- All numeric status/info states.
- All `StorEdgeControlBlock` states (separate role map).
- All non-role metadata of the reactive-power states themselves.

**Note:** The actual expected correct behavior (the new role value) is defined in the Correctness Properties section (Property 1). This section focuses on what must NOT change.

## Hypothesized Root Cause

Based on the bug description and the code, the cause is unambiguous and localized:

1. **Imprecise lookup-table entry**: The single `ROLE_MAP` entry `'power.reactive': 'value.power'` was authored with the generic power role rather than the dedicated `value.power.reactive` role defined in the ioBroker state-roles reference. This is the sole root cause.
   - `ROLE_MAP` is a total `Record<SunSpecRole, string>`; the `power.reactive` key exists and resolves at compile time, so there is no missing-key or fallback path involved.
   - The consumption site `role: ROLE_MAP[def.role]` in `ensureState` is correct and needs no change — it simply propagates whatever string the table holds.

2. **Not an index/selection error**: Role resolution is a direct keyed lookup on `def.role`; there is no index arithmetic or selector logic that could be at fault.

3. **Not a register-definition error**: The five affected register defs correctly carry `role: 'power.reactive'` and `unit: 'var'`; they are the correct inputs and must not be touched.

4. **Not a timing/ordering error**: Role is set synchronously during object creation from a static table; no asynchronous or ordering concern applies.

## Correctness Properties

Property 1: Bug Condition - Reactive Power Uses the Dedicated Role

_For any_ register def whose logical role is `power.reactive` (the inputs where `isBugCondition` returns true before the fix — `acVAR`, `mVAR`, `mVARA`, `mVARB`, `mVARC`), the fixed `ensureState` SHALL create the state object with `common.role = 'value.power.reactive'`.

**Validates: Requirements 2.1, 2.2**

Property 2: Preservation - All Non-Reactive Roles and Non-Role Metadata Unchanged

_For any_ register def whose logical role is NOT `power.reactive` (`isBugCondition` returns false), the fixed `ensureState` SHALL assign exactly the same `common.role` as the original code — in particular `power.apparent` stays `value.power` and `power` stays `value.power.active`. _For any_ reactive-power register, the fixed code SHALL preserve all non-role properties (`name`, `type`, `unit`, `read`, `write`, scaling) exactly as before.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:

**File**: `src/lib/state-manager.ts`

**Function / construct**: the `ROLE_MAP` constant (consumed by `StateManager.ensureState`)

**Specific Changes**:
1. **Single entry edit**: Change the `power.reactive` entry from `'power.reactive': 'value.power'` to `'power.reactive': 'value.power.reactive'`.
   - This is a one-line change inside the `ROLE_MAP` object literal.
   - No change to the consumption site `role: ROLE_MAP[def.role]`; the new value propagates automatically to all five reactive-power states.

2. **Leave `power.apparent` untouched**: The entry `'power.apparent': 'value.power'` must remain exactly as-is (no `value.power.apparent` role exists). Verify it is not altered.

3. **No register-map changes**: `SUNSPEC_MAP` / `SunSpecRole` and the five reactive-power defs are correct and must not be edited.

4. **Update pinned test expectations**: The existing test file `src/lib/state-manager.test.ts` contains an `EXPECTED_MEASUREMENT_ROLE` map that pins `'power.reactive': 'value.power'`. Update that expected value to `'value.power.reactive'` so the preservation/measurement tests reflect the corrected mapping rather than the old defect. Any other test literal pinning the old reactive-power role must be updated the same way.

5. **No change to the separate StorEdge role map**: `STOREDGE_CONTROL_ROLE_MAP` is unrelated and must not be touched.

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on the unfixed code, then verify the fix produces the dedicated reactive-power role and preserves every other state's role and all non-role metadata.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm or refute the root-cause hypothesis (imprecise `ROLE_MAP` entry). If refuted, re-hypothesize.

**Test Plan**: Call `ensureState` for each reactive-power register against a mock adapter and read back the `common.role` of the created object. Run on the UNFIXED code to observe the imprecise `value.power` value and confirm the single-entry root cause.

**Test Cases**:
1. **Inverter reactive power (`acVAR`)**: ensureState for `acVAR`, assert `common.role === 'value.power.reactive'` (will fail on unfixed code — observes `value.power`).
2. **Meter total reactive power (`mVAR`)**: ensureState for `mVAR`, assert role `value.power.reactive` (will fail on unfixed code).
3. **Meter per-phase reactive power (`mVARA`, `mVARB`, `mVARC`)**: ensureState for each, assert role `value.power.reactive` (will fail on unfixed code).
4. **Edge case — all `power.reactive` defs**: iterate every `SUNSPEC_MAP` def with `role === 'power.reactive'` and assert the role (confirms the set is exactly the five expected registers and all are affected).

**Expected Counterexamples**:
- Each reactive-power state's `common.role` is `value.power` on unfixed code instead of `value.power.reactive`.
- Cause: the single `ROLE_MAP['power.reactive']` entry; no index, register-def, or timing fault involved.

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behavior.

**Pseudocode:**
```
FOR ALL def WHERE def.role == 'power.reactive' DO
  ensureState(channel, def)
  obj := created object for `${channel}.${def.name}`
  ASSERT obj.common.role == 'value.power.reactive'
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**
```
FOR ALL def WHERE def.role != 'power.reactive' DO
  ASSERT role_after_fix(def) == role_before_fix(def)
END FOR

// non-role metadata of reactive-power states is also preserved
FOR ALL def WHERE def.role == 'power.reactive' DO
  ASSERT (name, type, unit, read, write) after fix == before fix
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the full set of register defs and roles.
- It catches edge cases a hand-written list might miss (e.g. an accidentally shifted sibling role).
- It gives strong assurance that behavior is unchanged for every non-reactive-power input.

**Test Plan**: Pin the expected role for each non-reactive logical role (the known pre-fix values) and assert the fixed `ensureState` still produces them; separately assert the non-role metadata of each reactive-power state is unchanged.

**Test Cases**:
1. **Apparent power preserved**: assert `power.apparent` states (`acVA`, `mVA`, `mVAA`, `mVAB`, `mVAC`) still map to `value.power` (Req 3.1).
2. **Active power preserved**: assert `power` states still map to `value.power.active` (Req 3.2).
3. **All other roles preserved**: iterate `current`, `voltage`, `powerFactor`, `frequency`, `energy`, `temperature`, `percent`, `status`, `info` and assert each produces its known pre-fix role (Req 3.3).
4. **Reactive-power non-role metadata preserved**: for each reactive-power state assert `type === 'number'`, `unit === 'var'`, `read === true`, `write === false` unchanged (Req 3.4).
5. **StorEdge roles untouched**: assert the nine `StorEdgeControlBlock` states keep their `STOREDGE_CONTROL_ROLE_MAP` roles.

### Unit Tests

- Assert `common.role === 'value.power.reactive'` for each of `acVAR`, `mVAR`, `mVARA`, `mVARB`, `mVARC` after fix.
- Assert `power.apparent` → `value.power` and `power` → `value.power.active` remain unchanged.
- Update the existing `EXPECTED_MEASUREMENT_ROLE` expectation in `state-manager.test.ts` to `value.power.reactive` for the `power.reactive` key, and keep all other expectations identical.
- Assert reactive-power states keep `type`/`unit`/`read`/`write` unchanged.

### Property-Based Tests

- Over all `SUNSPEC_MAP` value defs: for every def, assert `created role === EXPECTED_ROLE_BY_LOGICAL_ROLE[def.role]`, where the expectation table maps `power.reactive → value.power.reactive` and every other role to its pre-fix value — this simultaneously proves Property 1 (fix) and Property 2 (preservation of all other roles) across the whole register domain.
- Over all reactive-power defs: assert the full non-role common metadata is invariant.

### Integration Tests

- Run the full build (`tsc`) to confirm the one-line change compiles against the total `Record<SunSpecRole, string>` typing.
- Run the complete adapter test suite to confirm no other state's role expectation regresses and the role-validation suite (E1008/E1009/E1011 catalogue checks) still passes with `value.power.reactive`, a catalogue-valid read-only role.
- Confirm object creation end-to-end for one inverter and one meter reactive-power state reports the new role.
