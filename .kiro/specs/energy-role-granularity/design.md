# Energy Role Granularity Bugfix Design

## Overview

Every energy-related ioBroker state the adapter creates is given the generic `common.role` of `value.energy`. That role is produced by a single mapping entry, `ROLE_MAP.energy = 'value.energy'` in `src/lib/state-manager.ts`, which every register definition tagged `role: 'energy'` in `src/lib/sunspec-map.ts` resolves to. Because the directional energy registers (inverter production, meter exported/imported, battery lifetime export/import) share the exact same `role: 'energy'` tag with the non-directional capacity registers (battery rated/maximum/available energy), the split cannot be expressed in `ROLE_MAP` alone — the one tag collapses three distinct semantics into one role.

The fix introduces two additional, direction-specific role tags on the `SunSpecRole` union — `energy.produced` and `energy.consumed` — and adds their mappings to `ROLE_MAP` (`value.energy.produced` and `value.energy.consumed`). It then retags each directional register definition: produced/exported energy → `energy.produced`, consumed/imported energy → `energy.consumed`. Capacity-type energy registers keep the existing `energy` tag and therefore the generic `value.energy` role. Because the fix changes only `role` tags and the role mapping, every other state attribute (type, unit, read/write, states, values) and every non-energy role is left untouched.

The bug is a role-granularity defect: it does not crash and does not change any decoded value. It only limits interoperability for dashboards and visualisation adapters that filter states by role, since produced and consumed energy are currently indistinguishable from the generic role.

## Glossary

- **Bug_Condition (C)**: The condition that triggers the bug — a directional energy register (inverter production, meter exported, meter imported, battery lifetime export, battery lifetime import) is created with the generic `value.energy` role instead of a direction-specific role.
- **Property (P)**: The desired behavior — a directional energy state receives the role matching its flow direction (`value.energy.produced` for produced/exported, `value.energy.consumed` for consumed/imported), while capacity-type energy states keep `value.energy`.
- **Preservation**: Existing behavior that must remain unchanged — the role of every non-directional and non-energy state, and the `type`, `unit`, `read`, `write`, `states`, `min`/`max` attributes and decoded values of every state.
- **SunSpecRole**: The TypeScript union in `src/lib/sunspec-map.ts` that enumerates every logical quantity a register can carry. Each register def's `role` field is one member of this union.
- **ROLE_MAP**: The total `Record<SunSpecRole, string>` in `src/lib/state-manager.ts` that maps each `SunSpecRole` to a concrete ioBroker `common.role` string. `StateManager.ensureState` reads `ROLE_MAP[def.role]` to set `common.role`.
- **Directional energy register**: An energy register whose semantics carry a flow direction — production/export (produced) or consumption/import (consumed).
- **Capacity-type energy register**: An energy register with no flow direction (battery `ratedEnergy`, `maximumEnergy`, `availableEnergy`); these describe stored/available capacity, not a flow.

## Bug Details

### Bug Condition

The bug manifests when `StateManager.ensureState` creates a state object for a directional energy register. The register definition carries `role: 'energy'`, so `ROLE_MAP[def.role]` resolves to the generic `value.energy`. The state manager is correctly applying `ROLE_MAP`, but the register map and role vocabulary cannot express the produced/consumed distinction, so the directional register is assigned the generic role rather than a direction-specific one.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type SunSpecRegisterDef
  OUTPUT: boolean

  RETURN input.name IN [
           // inverter production
           'acEnergyWh',
           // meter exported (produced)
           'mExportedWh', 'mExportedWhA', 'mExportedWhB', 'mExportedWhC',
           // meter imported (consumed)
           'mImportedWh', 'mImportedWhA', 'mImportedWhB', 'mImportedWhC',
           // battery lifetime export (produced) / import (consumed)
           'lifetimeExportEnergy', 'lifetimeImportEnergy'
         ]
         AND resolvedRole(input) == 'value.energy'   // generic, not directional
END FUNCTION
```

Here `resolvedRole(def)` is `ROLE_MAP[def.role]` — the ioBroker `common.role` the state manager would assign.

### Examples

- `acEnergyWh` (inverter AC lifetime production): expected role `value.energy.produced`, actual role `value.energy`.
- `mExportedWh` (meter total exported real energy): expected `value.energy.produced`, actual `value.energy`.
- `mImportedWh` (meter total imported real energy): expected `value.energy.consumed`, actual `value.energy`.
- `lifetimeExportEnergy` (battery total exported energy): expected `value.energy.produced`, actual `value.energy`.
- `lifetimeImportEnergy` (battery total imported energy): expected `value.energy.consumed`, actual `value.energy`.
- `ratedEnergy` (battery rated capacity, no flow direction): expected `value.energy`, actual `value.energy` — edge case, correctly unchanged.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Capacity-type energy states (`ratedEnergy`, `maximumEnergy`, `availableEnergy`) must continue to be assigned the generic role `value.energy` (Req 3.1).
- Every energy state must keep the same `common.type` (`number`), `common.unit` (`Wh`), `common.read` (`true`), and `common.write` (`false`) values as before (Req 3.2).
- Every non-energy state must keep its existing role unchanged — e.g. `acPower` → `value.power.active`, `acCurrent` → `value.current`, and every `StorEdgeControlBlock` setpoint role (Req 3.3).
- Every energy state's decoded numeric value must stay identical, since only the role string changes (Req 3.4).

**Scope:**
All states that are NOT one of the ten directional energy registers listed in the bug condition must be completely unaffected by this fix. This includes:
- Capacity-type energy states (`ratedEnergy`, `maximumEnergy`, `availableEnergy`).
- All non-energy SunSpec states (current, voltage, power, power.reactive, power.apparent, powerFactor, frequency, temperature, percent, status, info).
- All `StorEdgeControlBlock` states, which are driven by a separate role map (`STOREDGE_CONTROL_ROLE_MAP`) and are not touched by this fix.
- The decoded value, type, unit, and read/write flags of every state, including the directional energy states themselves (only their role string changes).

The actual expected correct behavior for directional energy states is defined in the Correctness Properties section (Property 1).

## Hypothesized Root Cause

Based on the bug description, the cause is well understood and structural rather than a defect in logic:

1. **Single overloaded role tag**: `SunSpecRole` offers only one energy member, `'energy'`. Every energy register — produced, consumed, and capacity — is tagged with it, so the three semantics are indistinguishable at the type level.

2. **Role mapping cannot disambiguate**: `ROLE_MAP` maps `SunSpecRole` → `common.role` one-to-one. With a single `energy` key it can only ever yield one role string (`value.energy`); the produced/consumed/capacity split cannot be expressed in `ROLE_MAP` without new tags on the union.

3. **Correct application of an insufficient vocabulary**: `StateManager.ensureState` faithfully sets `common.role = ROLE_MAP[def.role]`. The state manager code is correct; the vocabulary it draws from (the role union + map) is too coarse. The fix therefore belongs in the role vocabulary (`sunspec-map.ts`) and its mapping (`state-manager.ts`), plus the per-register tags, not in `ensureState`.

## Correctness Properties

Property 1: Bug Condition - Directional energy states receive direction-specific roles

_For any_ register definition where the bug condition holds (isBugCondition returns true — i.e. one of the ten directional energy registers), the fixed code SHALL assign the direction-specific role: `value.energy.produced` for the produced/exported registers (`acEnergyWh`, `mExportedWh`, `mExportedWhA`, `mExportedWhB`, `mExportedWhC`, `lifetimeExportEnergy`) and `value.energy.consumed` for the consumed/imported registers (`mImportedWh`, `mImportedWhA`, `mImportedWhB`, `mImportedWhC`, `lifetimeImportEnergy`).

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5**

Property 2: Preservation - Non-directional and non-energy state attributes unchanged

_For any_ register definition where the bug condition does NOT hold (isBugCondition returns false — capacity-type energy registers and every non-energy register), the fixed code SHALL produce exactly the same `common.role` as the original code, and _for any_ register whatsoever the fixed code SHALL produce the same `common.type`, `common.unit`, `common.read`, `common.write`, and decoded value as the original code, preserving all behavior except the role string of the ten directional energy registers.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct, the fix is confined to two files.

**File**: `src/lib/sunspec-map.ts`

**Change 1 — Extend the role union**: Add two members to the `SunSpecRole` union so the directional semantics can be expressed:
```ts
export type SunSpecRole =
    | 'current'
    | 'voltage'
    | 'power'
    | 'power.reactive'
    | 'power.apparent'
    | 'powerFactor'
    | 'frequency'
    | 'energy'
    | 'energy.produced'
    | 'energy.consumed'
    | 'temperature'
    | 'percent'
    | 'status'
    | 'info';
```

**Change 2 — Retag produced/exported energy registers** to `role: 'energy.produced'` (type, unit `Wh`, datatype, scaleFactorRef, length, offset, description all unchanged):
- `acEnergyWh` (inverter AC lifetime production)
- `mExportedWh`, `mExportedWhA`, `mExportedWhB`, `mExportedWhC` (meter exported totals)
- `lifetimeExportEnergy` (battery lifetime export, in `BATTERY_MAP`)

**Change 3 — Retag consumed/imported energy registers** to `role: 'energy.consumed'` (all other attributes unchanged):
- `mImportedWh`, `mImportedWhA`, `mImportedWhB`, `mImportedWhC` (meter imported totals)
- `lifetimeImportEnergy` (battery lifetime import, in `BATTERY_MAP`)

**Change 4 — Leave capacity-type energy registers unchanged** at `role: 'energy'`:
- `ratedEnergy`, `maximumEnergy`, `availableEnergy` (all in `BATTERY_MAP`)

**File**: `src/lib/state-manager.ts`

**Change 5 — Extend ROLE_MAP** with the two new keys so the mapping stays total over `SunSpecRole` and resolves the new tags to the specific ioBroker roles:
```ts
const ROLE_MAP: Record<SunSpecRole, string> = {
    current: 'value.current',
    voltage: 'value.voltage',
    power: 'value.power.active',
    'power.apparent': 'value.power',
    'power.reactive': 'value.power.reactive',
    powerFactor: 'value',
    frequency: 'value.frequency',
    energy: 'value.energy',
    'energy.produced': 'value.energy.produced',
    'energy.consumed': 'value.energy.consumed',
    temperature: 'value.temperature',
    percent: 'value.fill',
    status: 'value',
    info: 'value',
};
```

No change is required in `StateManager.ensureState`: it already sets `common.role = ROLE_MAP[def.role]`, so once the tags and map entries exist the correct role is applied automatically. The `getValueDefs` / `getBatteryValueDefs` selectors filter on `role !== 'info'`, so the new roles continue to be selected as measurement states exactly as before.

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on the unfixed code (directional energy states resolving to `value.energy`), then verify the fix assigns the direction-specific roles while preserving every other attribute and every non-directional/non-energy role.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm the root-cause analysis that all directional energy states collapse to the generic `value.energy` role. If a directional state already carried a specific role, we would need to re-hypothesize.

**Test Plan**: Call `StateManager.ensureState` for each directional energy register def (resolved from `SUNSPEC_MAP` and `BATTERY_MAP` by name) against a mock adapter, then read back the created object's `common.role`. Run these assertions on the UNFIXED code to observe that every directional state resolves to `value.energy`.

**Test Cases**:
1. **Inverter production role**: `ensureState('inverter', acEnergyWh)` and assert role is `value.energy.produced` (will fail on unfixed code — resolves to `value.energy`).
2. **Meter exported role**: `ensureState('meter.1', mExportedWh)` (and A/B/C variants) and assert role is `value.energy.produced` (will fail on unfixed code).
3. **Meter imported role**: `ensureState('meter.1', mImportedWh)` (and A/B/C variants) and assert role is `value.energy.consumed` (will fail on unfixed code).
4. **Battery lifetime export/import role**: `ensureState('battery.1', lifetimeExportEnergy)` → `value.energy.produced` and `lifetimeImportEnergy` → `value.energy.consumed` (will fail on unfixed code).
5. **Edge case — capacity energy role**: `ensureState('battery.1', ratedEnergy)` and assert role is `value.energy` (passes on unfixed code; confirms the capacity states are NOT in the bug set).

**Expected Counterexamples**:
- Every directional energy state's `common.role` equals `value.energy` on the unfixed code.
- Possible causes: single `energy` member on `SunSpecRole`, single `energy` key in `ROLE_MAP`, directional registers tagged `role: 'energy'`.

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed code produces the expected direction-specific behavior.

**Pseudocode:**
```
FOR ALL def WHERE isBugCondition(def) DO
  common := ensureState_fixed(channelFor(def), def)
  IF def IS produced/exported THEN
    ASSERT common.role == 'value.energy.produced'
  ELSE  // imported/consumed
    ASSERT common.role == 'value.energy.consumed'
  END IF
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed code produces the same `common.role` as the original, and that for every register the fixed code produces the same `type`, `unit`, `read`, `write`, and decoded value as the original.

**Pseudocode:**
```
FOR ALL def WHERE NOT isBugCondition(def) DO
  ASSERT ensureState_original(ch, def).role == ensureState_fixed(ch, def).role
END FOR

FOR ALL def DO
  original := ensureState_original(ch, def)
  fixed    := ensureState_fixed(ch, def)
  ASSERT original.type  == fixed.type
  ASSERT original.unit  == fixed.unit
  ASSERT original.read  == fixed.read
  ASSERT original.write == fixed.write
  ASSERT decode_original(def, words) == decode_fixed(def, words)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many register defs across the full map so no state is missed.
- It catches edge cases (e.g. a non-energy role accidentally changed) that hand-picked unit tests might miss.
- It gives strong assurance that behavior is unchanged for all non-directional and all non-energy states.

**Test Plan**: Observe behavior on UNFIXED code for the capacity energy states, every non-energy state, and the type/unit/read/write of every state, then write property-based tests that assert those attributes are preserved after the fix.

**Test Cases**:
1. **Capacity energy preservation**: Observe `ratedEnergy`, `maximumEnergy`, `availableEnergy` resolve to `value.energy` on unfixed code; assert this still holds after the fix.
2. **Non-energy role preservation**: Observe `acPower` → `value.power.active`, `acCurrent` → `value.current`, and the `StorEdgeControlBlock` setpoint roles on unfixed code; assert all unchanged after the fix.
3. **Attribute preservation**: Observe `type`/`unit`/`read`/`write` for the directional energy states (number / `Wh` / read=true / write=false) on unfixed code; assert they are identical after the fix (only `role` differs).

### Unit Tests

- Assert the resolved role for each of the ten directional energy registers (`value.energy.produced` for the six produced/exported, `value.energy.consumed` for the four imported/consumed).
- Assert the three capacity energy registers still resolve to `value.energy`.
- Assert `ROLE_MAP` is total over `SunSpecRole` (every union member has a mapping) and that the two new keys map to `value.energy.produced` / `value.energy.consumed`.
- Assert directional energy states keep `type: 'number'`, `unit: 'Wh'`, `read: true`, `write: false`.

### Property-Based Tests

- For every def in `SUNSPEC_MAP` and `BATTERY_MAP`, generate the created state and assert: if the def is a produced/exported energy register its role is `value.energy.produced`; if imported/consumed, `value.energy.consumed`; otherwise its role is unchanged from the original mapping.
- For every def, assert `type`, `unit`, `read`, and `write` match the pre-fix values.
- For a generated range of raw register words, assert the decoded numeric value is identical before and after the fix (role change does not touch decoding).

### Integration Tests

- Full state-creation flow: run `ensureState` across the inverter, meter, and battery channels and verify the directional energy states carry the direction-specific roles while all other states are unchanged.
- Idempotency flow: verify re-running `ensureState` for the retagged energy states remains a no-op (no object churn) and the role stays correct.
- Verify the value table / `getValueDefs` selection still includes all energy states (the `role !== 'info'` filter is unaffected by the new roles).
