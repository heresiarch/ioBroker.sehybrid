# State Role Validation Fixes Bugfix Design

## Overview

repochecker's object-structure validation rejects 13 of the sehybrid adapter's 95 generated
state objects. Every rejected object carries a `common.role` that is invalid or incompatible
with the state's `common.write` flag or `common.type`, per the official
[ioBroker state role catalogue](https://github.com/ioBroker/ioBroker.docs/blob/master/docs/en/dev/stateroles.md).
The errors split into three groups (E1011, E1008, E1009) that all trace back to role strings
produced from two small lookup tables in `src/lib/`.

The fix is deliberately minimal and targeted: it changes only the role strings emitted for the
13 offending states, using roles that already exist in the catalogue and are compatible with each
state's existing `write`/`type`. Bundled with the fix is one user-requested enhancement: the four
E1008 mode selectors also receive `common.states` enumerations so their numeric codes render as
human-readable labels. It touches three source constructs:

- `STOREDGE_CONTROL_ROLE_MAP` in `src/lib/state-manager.ts` — corrects the nine writable
  `StorEdgeControlBlock` roles (E1011 setpoints + E1008 mode selectors).
- `ROLE_MAP` in `src/lib/state-manager.ts` — corrects the `status` mapping from `indicator`
  to `value`, which fixes all four E1009 numeric status states (`battery.1.status`,
  `battery.1.statusInternal`, `inverter.status`, `inverter.statusVendor`) in one edit, since
  every state with `role: 'status'` in `src/lib/sunspec-map.ts` is numeric.
- `StorEdgeControlRegisterDef` / the four mode-selector register defs in
  `src/lib/storedge-control-map.ts` — gain an optional `states?: Record<number, string>` field,
  populated for the four mode selectors, which `ensureStorEdgeControlBlock` copies into
  `common.states` when present (the enhancement).

No values, units (`common.unit`), ranges (`common.min`/`common.max`), read/write flags, object
counts, or acknowledgement behavior change. `src/lib/sunspec-map.ts` (register map) is unchanged:
its register data is already correct; only the derived role strings are wrong.
`src/lib/storedge-control-map.ts` was previously untouched, but is now edited for the enhancement:
it gains the optional `states` field and the four enumeration maps, co-locating the enumeration
data with the register definitions. The register type/unit/range data itself is unchanged. The
compiled `build/` output is generated from `src/`, so only `src/` is edited and the project is then
rebuilt.

## Glossary

- **Bug_Condition (C)**: A created state whose `common.role` is invalid or incompatible with its
  `common.write` flag (E1011) or `common.type` (E1009), or is absent from the catalogue (E1008).
- **Property (P)**: For a bug-triggering state, the fixed adapter assigns a catalogue-valid role
  compatible with that state's `write` flag and `type`, keeping every other attribute unchanged.
- **Preservation**: Every state whose current role is already catalogue-valid and type/write
  compatible keeps its exact current role; and all other object attributes (values, units, ranges,
  flags, counts, ack behavior) stay unchanged for all states.
- **Catalogue**: The official ioBroker state role catalogue (`stateroles.md`) that repochecker
  validates against.
- **E1011**: repochecker error — a read-only `value.*` role assigned to a writable (`write=true`)
  state. Writable numeric setpoints must use a read-write **Levels**-family role (`level`/`level.*`).
- **E1008**: repochecker error — the role string is not present in the catalogue (`level.mode`).
- **E1009**: repochecker error — the `indicator` role is boolean-only but the state is `type=number`.
- **ROLE_MAP**: The total map in `state-manager.ts` from a logical `SunSpecRole` to a `common.role`
  string, used by `ensureState` for every SunSpec read state. `status` currently maps to
  `indicator`.
- **STOREDGE_CONTROL_ROLE_MAP**: The total map in `state-manager.ts` from a `StorEdgeControlBlock`
  register `name` to its `common.role` string, used by `ensureStorEdgeControlBlock` for the nine
  writable control states.

## Bug Details

### Bug Condition

The bug manifests whenever the adapter creates one of the 13 states listed below. Each such state
receives a `common.role` that repochecker rejects because the role is read-only while the state is
writable (E1011), the role does not exist in the catalogue (E1008), or the role is boolean-only
while the state is numeric (E1009). The defective role strings originate from
`STOREDGE_CONTROL_ROLE_MAP` (the nine writable controls) and from the `status -> 'indicator'`
entry of `ROLE_MAP` (the four numeric status states).

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type StateObject { id, role, type, write }
  OUTPUT: boolean

  // E1011: a read-only value.* role on a writable state
  IF input.write = true AND roleRequiresReadOnly(input.role) THEN
    RETURN true
  END IF

  // E1008: role string absent from the official catalogue
  IF NOT roleExistsInCatalogue(input.role) THEN
    RETURN true
  END IF

  // E1009: role incompatible with the state's common.type
  IF NOT roleSupportsType(input.role, input.type) THEN
    RETURN true
  END IF

  RETURN false
END FUNCTION
```

Exactly these 13 states satisfy `isBugCondition`:

- `StorEdgeControlBlock.remoteControlChargeLimit`, `.remoteControlDischargeLimit`,
  `.remoteControlCommandTimeout`, `.storageAcChargeLimit`, `.storageBackupReservedSetting`
  (E1011)
- `StorEdgeControlBlock.remoteControlCommandMode`, `.storageAcChargePolicy`,
  `.storageChargeDischargeDefaultMode`, `.storageControlMode` (E1008)
- `battery.1.status`, `battery.1.statusInternal`, `inverter.status`, `inverter.statusVendor`
  (E1009)

### Examples

- `inverter.status` is created with `role = 'indicator'` and `common.type = 'number'`; repochecker
  rejects it with **E1009** because `indicator` supports only `common.type = boolean`. Expected: a
  numeric read-only role (`value`).
- `StorEdgeControlBlock.remoteControlChargeLimit` is created with `role = 'value.power'` and
  `common.write = true`; repochecker rejects it with **E1011** because `value.power` requires
  `common.write = false`. Expected: a writable Levels-family role (`level`).
- `StorEdgeControlBlock.storageControlMode` is created with `role = 'level.mode'`; repochecker
  rejects it with **E1008** because `level.mode` is not a catalogue role. Expected: a catalogue
  writable role (`level`).
- `StorEdgeControlBlock.remoteControlCommandTimeout` is created with `role = 'value.interval'` and
  `common.write = true`; **E1011**. Expected: `level.timer` (writable duration in seconds).
- Edge case — `inverter.acPower` is created with `role = 'value.power.active'`, `type = 'number'`,
  `write = false`: this is catalogue-valid and type/write compatible, so `isBugCondition` is false
  and it must be left unchanged.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Every SunSpec read state whose role is already catalogue-valid and type/write compatible keeps
  its exact role: `value.current`, `value.voltage`, `value.power.active`, `value.power`,
  `value.frequency`, `value.energy`, `value.temperature`, `value.fill`, and plain `value` for
  `info`/`powerFactor` (Req 3.1).
- Each corrected `StorEdgeControlBlock` state keeps `common.write = true`, `common.read = true`,
  and the same `common.min`, `common.max`, and `common.unit` as before (Req 3.2).
- The `common.states` enhancement is additive on exactly four states (the mode selectors) and
  changes nothing else: it does not alter `common.type`/`read`/`write`/`min`/`max`/`unit`, the
  total object count (still 95), or ack behavior. The other five StorEdge controls and every status
  state receive no `common.states`. repochecker accepts `common.states` on a `level` role — it is a
  standard attribute and does not invalidate the role (Req 3.2, 3.6).
- Each corrected status state (`battery.1.status`, `battery.1.statusInternal`, `inverter.status`,
  `inverter.statusVendor`) keeps `common.type = number`, `common.read = true`,
  `common.write = false` as before (Req 3.3).
- Polling and writing continue to write the same values with the same `ack` behavior, unaffected
  by the role changes (Req 3.4).
- Channel/state creation stays idempotent — each channel and state created only once (Req 3.5).
- repochecker sees the same 95 objects, with only the 13 previously failing roles corrected and no
  new errors introduced (Req 3.6).

**Scope:**
All inputs that do NOT trigger `isBugCondition` are completely unaffected by this fix. This
includes:
- Every SunSpec measurement state (currents, voltages, powers, energies, frequencies,
  temperatures, fill/percent) already carrying a valid `value.*` role.
- Every `info`/scale-factor/identity state carrying the plain `value` role.
- All object attributes other than `common.role` for every state, including the 13 corrected ones
  (their `type`, `read`, `write`, `unit`, `min`, `max`, `native` are untouched). The only other
  attribute added anywhere is `common.states`, on exactly the four mode selectors; no other state
  gains it, and no state loses or changes any existing attribute.

The concrete corrected role for each triggering state is defined in the Correctness Properties
section below (Property 1) and the Fix Implementation section.

## Hypothesized Root Cause

Based on the bug description and the source, the role strings are wrong at two lookup tables that
were written before validating against the current catalogue:

1. **Writable setpoints given read-only `value.*` roles (E1011)**: `STOREDGE_CONTROL_ROLE_MAP`
   maps five writable registers to `value.power`/`value.interval`/`value.energy`/`value.fill`.
   Those `value.*` roles require `common.write = false`, but these states are the adapter's only
   `write = true` states. The catalogue has no `level.power` or `level.energy`, so the generic
   writable `level` is the correct minimal choice for the power/energy setpoints, with `level.timer`
   for the duration and `level.fill` for the % setpoint.

2. **Enumerated selectors given a non-existent role (E1008)**: `STOREDGE_CONTROL_ROLE_MAP` maps
   four mode registers to `level.mode`, which reads plausibly but is not in the catalogue. They are
   writable numeric selectors, so the generic writable `level` is the minimal catalogue-valid role.

3. **Numeric status codes given a boolean-only role (E1009)**: `ROLE_MAP.status = 'indicator'`, and
   every def with `role: 'status'` in `sunspec-map.ts` has `iobType: 'number'`. `indicator` supports
   only booleans, so numeric operating-state codes must use a numeric read-only role. The single
   correct fix is `ROLE_MAP.status = 'value'`, which repairs all four status states at once.

4. **Register data is not the cause of the bugs**: `storedge-control-map.ts` and `sunspec-map.ts`
   hold correct type/unit/range/logical-role data. Only the derived `common.role` strings are wrong,
   so the E1011/E1008/E1009 fixes themselves are confined to the two maps in `state-manager.ts`.
   The separate, user-requested `common.states` enhancement additionally edits
   `storedge-control-map.ts` to carry enumeration labels for the four mode selectors (see Fix
   Implementation); this is additive visualization metadata, not a bug fix, and does not alter the
   register type/unit/range data.

## Correctness Properties

Property 1: Bug Condition - Corrected states use catalogue-valid, compatible roles

_For any_ input where the bug condition holds (`isBugCondition` returns true), the fixed adapter
SHALL assign a `common.role` that exists in the official catalogue and is compatible with the
state's `common.write` flag and `common.type`, specifically:
- `remoteControlChargeLimit`, `remoteControlDischargeLimit`, `storageAcChargeLimit` → `level`
  (generic writable; no `level.power`/`level.energy` exists)
- `remoteControlCommandTimeout` → `level.timer`
- `storageBackupReservedSetting` → `level.fill`
- `remoteControlCommandMode`, `storageAcChargePolicy`, `storageChargeDischargeDefaultMode`,
  `storageControlMode` → `level`
- `battery.1.status`, `battery.1.statusInternal`, `inverter.status`, `inverter.statusVendor` →
  `value`

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 2.12, 2.13**

Property 2: Preservation - Non-buggy states unchanged

_For any_ input where the bug condition does NOT hold (`isBugCondition` returns false), the fixed
adapter SHALL produce the same result as the original adapter, preserving the exact `common.role`
of every already-valid state and preserving all other object attributes (`type`, `read`, `write`,
`unit`, `min`, `max`, `native`) for every state — including the 13 corrected ones, where only
`common.role` changes — as well as the total object count (95) and acknowledged-write behavior.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**

## Fix Implementation

### Changes Required

Assuming the root cause analysis is correct, the bug-fix edits are in `src/lib/state-manager.ts`;
the `common.states` enhancement additionally edits `src/lib/storedge-control-map.ts`. No changes to
`sunspec-map.ts`.

**File**: `src/lib/state-manager.ts`

**Change 1 — `STOREDGE_CONTROL_ROLE_MAP` (E1011 + E1008)**: replace the nine role values so each
writable control uses a catalogue Levels-family role:

```
storageControlMode:               'level'        // was 'level.mode'   (2.9)
storageAcChargePolicy:            'level'        // was 'level.mode'   (2.7)
storageAcChargeLimit:             'level'        // was 'value.energy'  (2.4)
storageBackupReservedSetting:     'level.fill'   // was 'value.fill'    (2.5)
storageChargeDischargeDefaultMode:'level'        // was 'level.mode'   (2.8)
remoteControlCommandTimeout:      'level.timer'  // was 'value.interval'(2.3)
remoteControlCommandMode:         'level'        // was 'level.mode'   (2.6)
remoteControlChargeLimit:         'level'        // was 'value.power'   (2.1)
remoteControlDischargeLimit:      'level'        // was 'value.power'   (2.2)
```

The map stays total over the nine register names; `min`/`max`/`unit`/`write`/`read` set by
`ensureStorEdgeControlBlock` are untouched (Req 3.2).

**Change 2 — `ROLE_MAP.status` (E1009)**: change the single `status` entry:

```
status: 'value'   // was 'indicator'
```

Because every `sunspec-map.ts` def with `role: 'status'` (`inverter.status`,
`inverter.statusVendor`, `battery.1.status`, `battery.1.statusInternal`) has `iobType: 'number'`,
this one edit corrects all four E1009 states (Req 2.10–2.13). No other `ROLE_MAP` entry changes, so
all measurement/info roles are preserved (Req 3.1). `type`/`read`/`write` set by `ensureState`
remain `number`/`true`/`false` (Req 3.3).

**No other behavioral edits**: `ensureState`, `ensureChannel`, `writeValue`, `writeStorEdgeValue`,
and `ackStorEdgeWrite` are unchanged. `ensureStorEdgeControlBlock` gains only the additive
conditional `common.states` assignment above; idempotency (Req 3.5), object count (Req 3.6), and
acknowledged writes (Req 3.4) are all preserved.

**Enhancement — `common.states` on the four E1008 mode selectors**: attaching enumeration lists
(`common.states`) is NOT required for repochecker validation with the generic `level` role, but the
user has requested it because it renders the raw numeric mode codes as human-readable labels. The
four mode selectors (in addition to the role change to `level`) therefore also receive a
`common.states` map. `level` remains the catalogue-valid role; `common.states` is a standard,
accepted attribute that only improves visualization and does not change the role's validity.

The four selectors are all `uint16` with documented ranges in `src/lib/storedge-control-map.ts`.
Their enumeration maps use the SolarEdge StorEdge documented values:

```
storageControlMode (0xE004, range 0..4):
  { 0: 'Disabled', 1: 'Maximize Self Consumption', 2: 'Time of Use',
    3: 'Backup Only', 4: 'Remote Control' }

storageAcChargePolicy (0xE005, range 0..3):
  { 0: 'Disable', 1: 'Always Allowed', 2: 'Fixed Energy Limit',
    3: 'Percent of Production' }

storageChargeDischargeDefaultMode (0xE00A, range 0..7):
  { 0: 'Off', 1: 'Charge Excess PV Power Only', 2: 'Charge from PV First',
    3: 'Charge from PV + AC', 4: 'Maximize Export',
    5: 'Discharge to Meet Consumption', 7: 'Maximize Self Consumption' }
  // NOTE: value 6 is intentionally absent — the protocol does not define it.

remoteControlCommandMode (0xE00D, range 0..7):
  { 0: 'Off', 1: 'Charge Excess PV Power Only', 2: 'Charge from PV First',
    3: 'Charge from PV + AC', 4: 'Maximize Export',
    5: 'Discharge to Meet Consumption', 7: 'Maximize Self Consumption' }
  // NOTE: same enumeration as storageChargeDischargeDefaultMode; value 6 absent.
```

**Source and sparse-map note**: (a) these labels are taken verbatim from the official SolarEdge
_Power Control Open Protocol for SolarEdge Inverters_ document (Version 1.3, Oct 2017), Global
StorEdge Control Block, base register `0xE004`; (b) the value `6` is intentionally absent from the
`storageChargeDischargeDefaultMode` and `remoteControlCommandMode` maps because the protocol does
not define a mode 6 — `common.states` may legitimately be a sparse map, so keys jump from `5` to
`7`; (c) the register `min`/`max` ranges in `storedge-control-map.ts` are unchanged —
`storageChargeDischargeDefaultMode` and `remoteControlCommandMode` remain `0..7` even though `6`
has no label.

**Change 3 — enumeration storage decision (`src/lib/storedge-control-map.ts`)**: to keep the
enumeration data co-located with the register definitions (single source of truth alongside
address/kind/range/unit), add an optional field to `StorEdgeControlRegisterDef`:

```
export interface StorEdgeControlRegisterDef {
    // ...existing fields...
    /** Optional common.states enumeration for mode-selector registers, keyed by numeric value. */
    states?: Record<number, string>;
}
```

Populate `states` on exactly the four mode-selector register defs (`STORAGE_CONTROL_MODE`,
`STORAGE_AC_CHARGE_POLICY`, `STORAGE_CHARGE_DISCHARGE_DEFAULT_MODE`, `REMOTE_CONTROL_COMMAND_MODE`)
with the maps above. The other five register defs leave `states` undefined.

**File**: `src/lib/state-manager.ts` — `ensureStorEdgeControlBlock`

Have `ensureStorEdgeControlBlock` set `common.states` from `def.states` when present (mirroring the
existing conditional `common.unit` assignment), so only the four selectors gain the attribute:

```
if (def.states !== undefined) {
    common.states = def.states;
}
```

This is the only behavioral edit to `ensureStorEdgeControlBlock`; idempotency, object count, the
`level` role, and the `write=true`/`read=true`/`min`/`max`/`unit` attributes are all unchanged.

**Rebuild**: after editing `src/`, run the project's build so `build/` reflects the corrected roles
and the new `common.states` before repochecker is re-run against the generated objects.

## Testing Strategy

### Validation Approach

Two phases: first surface counterexamples that demonstrate the bug on the unfixed code (the current
tests already encode the buggy roles as "expected" — those assertions are the counterexamples), then
update/add tests that lock in the corrected roles and prove preservation of every other attribute.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix, and confirm
the root cause is purely the emitted role strings.

**Test Plan**: Inspect the roles produced by `ensureState` and `ensureStorEdgeControlBlock` for the
13 triggering states on the UNFIXED code, and cross-check each against the catalogue rule it
violates. The existing tests make this direct: `state-manager.test.ts` asserts
`inverter.status` role equals `'indicator'`, and its `EXPECTED_ROLE` table asserts the nine buggy
StorEdge roles — these are the codified counterexamples.

**Test Cases**:
1. **Numeric status (E1009)**: assert `ensureState('inverter', status).common.role` on unfixed code
   is `'indicator'` while `type` is `'number'` — a catalogue violation (will fail after fix; updated
   to `'value'`).
2. **Writable power setpoint (E1011)**: assert `remoteControlChargeLimit` role on unfixed code is
   `'value.power'` while `write = true` — a catalogue violation (will change to `'level'`).
3. **Writable duration (E1011)**: assert `remoteControlCommandTimeout` role is `'value.interval'`
   while `write = true` (will change to `'level.timer'`).
4. **Mode selector (E1008)**: assert `storageControlMode` role is `'level.mode'`, a role absent
   from the catalogue (will change to `'level'`).

**Expected Counterexamples**:
- `inverter.status`/`statusVendor`/`battery.1.status`/`statusInternal`: role `indicator` on a
  numeric state (E1009).
- Five writable StorEdge setpoints: read-only `value.*` roles on `write = true` states (E1011).
- Four writable StorEdge mode selectors: non-catalogue `level.mode` role (E1008).

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the
expected catalogue-valid role.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := createState'(input)
  ASSERT roleExistsInCatalogue(result.role)
  ASSERT NOT (result.write = true AND roleRequiresReadOnly(result.role))
  ASSERT roleSupportsType(result.role, result.type)
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function
produces the same result as the original function.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT createState(input) = createState'(input)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many cases automatically across the SunSpec/StorEdge def domain.
- It catches any accidental role change to a state that should be untouched.
- It gives strong assurance that only `common.role` changed for the 13 targeted states and nothing
  changed elsewhere.

**Test Plan**: Observe behavior on the UNFIXED code for the non-buggy states (all measurement/info
roles, plus the non-role attributes of the corrected states), then encode those observations as
assertions that must still hold after the fix.

**Test Cases**:
1. **Measurement roles preserved**: for every non-status, non-info SunSpec def, `ensureState` still
   emits the same `value.*` role (e.g. `acPower -> value.power.active`) (Req 3.1).
2. **Info roles preserved**: every `info`/scale-factor/identity def still emits plain `value`
   (Req 3.1).
3. **StorEdge non-role attributes preserved**: each corrected control still has `write = true`,
   `read = true`, and identical `min`/`max`/`unit` (Req 3.2).
4. **Status non-role attributes preserved**: each corrected status state still has `type = number`,
   `read = true`, `write = false` (Req 3.3).
5. **No stray `common.states`**: every StorEdge control that is not one of the four mode selectors,
   and every status/measurement/info state, has `common.states === undefined` — the enhancement adds
   the attribute to exactly four states and nowhere else (Req 3.2, 3.6).
6. **Idempotency preserved**: repeated `ensureState`/`ensureChannel`/`ensureStorEdgeControlBlock`
   calls issue no duplicate object creations (Req 3.5).

### Unit Tests

- `state-manager.test.ts`: update the `inverter.status` assertion from `'indicator'` to `'value'`,
  and add assertions for `statusVendor`/`battery.1.status`/`battery.1.statusInternal` mapping to
  `'value'`. Update the `EXPECTED_ROLE` table for the nine StorEdge controls to the corrected roles
  (`level`, `level.timer`, `level.fill`). Keep the existing assertions that each control retains
  `write=true`/`read=true`/`min`/`max`/`unit`.
- `state-manager.test.ts` (enhancement): assert that the four mode selectors
  (`storageControlMode`, `storageAcChargePolicy`, `storageChargeDischargeDefaultMode`,
  `remoteControlCommandMode`) carry the exact expected `common.states` maps documented in the Fix
  Implementation section (correct keys `0..range` and label strings). Assert that the other five
  StorEdge controls and every status state have `common.states === undefined` (no enumeration
  added).
- `sunspec-map.test.ts`: no role-string change is needed here (defs still use logical
  `role: 'status'`). Optionally add/keep a check that all `status` defs are `iobType: 'number'` to
  document why `status` must not map to `indicator`.
- Add a focused unit test asserting no writable state maps to a read-only `value.*` role and no
  emitted role is `indicator` for a numeric state.

### Property-Based Tests

- Over all `SUNSPEC_MAP` value defs: `ensureState` emits a role that is not `indicator` and (for
  numeric defs) is type-compatible; measurement defs keep their existing `value.*` mapping.
- Over all nine `STOREDGE_CONTROL_REGISTERS`: `ensureStorEdgeControlBlock` emits a `level`-family
  role (never a `value.*` role) while keeping `write=true`/`read=true`/`min`/`max`/`unit`, and sets
  `common.states` iff the def defines `states` (true for the four mode selectors, false for the
  other five).
- Preservation: for every non-triggering def, the full derived `common` object is byte-for-byte
  identical to the pre-fix output except where the role was one of the 13 corrected states, and
  except for the additive `common.states` on the four mode selectors; no other state gains
  `common.states`.

### Integration Tests

- Run a full object dump for a representative configuration and assert exactly 95 objects with the
  13 corrected roles and no others changed (Req 3.6).
- Re-run repochecker object-structure validation against the generated objects and assert zero
  E1011/E1008/E1009 errors and no newly introduced errors.
- Exercise a poll + user-write cycle on a corrected StorEdge control and assert the same
  acknowledged value write behavior as before (Req 3.4).
