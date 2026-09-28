# Bugfix Requirements Document

## Introduction

The ioBroker.repochecker validation ([ioBroker.repositories PR #6765](https://github.com/ioBroker/ioBroker.repositories/pull/6765)) flagged 13 object-structure errors in the sehybrid adapter's generated state objects (95 objects checked, 13 errors). Every error stems from an invalid or mismatched `common.role` assigned to a state, relative to the state's `common.write` flag and `common.type`. The offending roles are produced from the adapter source in `src/lib/` — specifically the `STOREDGE_CONTROL_ROLE_MAP` in `state-manager.ts`, the register definitions in `storedge-control-map.ts`, and the `ROLE_MAP` / `status` role handling in `sunspec-map.ts` and `state-manager.ts`.

The errors fall into three groups defined by the official [ioBroker state role catalogue](https://github.com/ioBroker/ioBroker.docs/blob/master/docs/en/dev/stateroles.md):

- **E1011** — the assigned `value.*` role requires `common.write = false`, but the state is a writable StorEdge control (`common.write = true`). Writable numeric setpoints must use a role from the read-write **Levels** family (`level` / `level.*`), not a read-only `value.*` role.
- **E1008** — the role `level.mode` does not exist in the catalogue. The four affected states are enumerated mode selectors and must use a role that exists in the catalogue.
- **E1009** — the role `indicator` only supports `common.type = boolean`, but the four affected status states are `common.type = number`. Numeric operating-state codes must use a `value`-family role.

Impact: the adapter cannot pass repochecker object-structure validation and is blocked from acceptance into the ioBroker repository. This bugfix corrects all 13 role/type/write mismatches using only roles present in the official catalogue, without changing any values, units, ranges, read/write flags, or other behavior of the affected states.

## Bug Analysis

### Current Behavior (Defect)

The states listed below are created with roles that repochecker rejects. Each triggers exactly one of the three object-structure errors.

E1011 — writable `StorEdgeControlBlock` states carry read-only `value.*` roles:

1.1 WHEN the `StorEdgeControlBlock.remoteControlChargeLimit` state is created THEN the system assigns role `value.power` while `common.write = true`, which repochecker rejects because `value.power` requires `common.write = false`
1.2 WHEN the `StorEdgeControlBlock.remoteControlDischargeLimit` state is created THEN the system assigns role `value.power` while `common.write = true`, which repochecker rejects because `value.power` requires `common.write = false`
1.3 WHEN the `StorEdgeControlBlock.remoteControlCommandTimeout` state is created THEN the system assigns role `value.interval` while `common.write = true`, which repochecker rejects because `value.interval` requires `common.write = false`
1.4 WHEN the `StorEdgeControlBlock.storageAcChargeLimit` state is created THEN the system assigns role `value.energy` while `common.write = true`, which repochecker rejects because `value.energy` requires `common.write = false`
1.5 WHEN the `StorEdgeControlBlock.storageBackupReservedSetting` state is created THEN the system assigns role `value.fill` while `common.write = true`, which repochecker rejects because `value.fill` requires `common.write = false`

E1008 — enumerated mode selectors carry a role that is not in the catalogue:

1.6 WHEN the `StorEdgeControlBlock.remoteControlCommandMode` state is created THEN the system assigns role `level.mode`, which repochecker rejects as an unknown role
1.7 WHEN the `StorEdgeControlBlock.storageAcChargePolicy` state is created THEN the system assigns role `level.mode`, which repochecker rejects as an unknown role
1.8 WHEN the `StorEdgeControlBlock.storageChargeDischargeDefaultMode` state is created THEN the system assigns role `level.mode`, which repochecker rejects as an unknown role
1.9 WHEN the `StorEdgeControlBlock.storageControlMode` state is created THEN the system assigns role `level.mode`, which repochecker rejects as an unknown role

E1009 — numeric status states carry the boolean-only `indicator` role:

1.10 WHEN the `battery.1.status` state is created with `common.type = number` THEN the system assigns role `indicator`, which repochecker rejects because `indicator` does not support `common.type = number`
1.11 WHEN the `battery.1.statusInternal` state is created with `common.type = number` THEN the system assigns role `indicator`, which repochecker rejects because `indicator` does not support `common.type = number`
1.12 WHEN the `inverter.status` state is created with `common.type = number` THEN the system assigns role `indicator`, which repochecker rejects because `indicator` does not support `common.type = number`
1.13 WHEN the `inverter.statusVendor` state is created with `common.type = number` THEN the system assigns role `indicator`, which repochecker rejects because `indicator` does not support `common.type = number`

### Expected Behavior (Correct)

Each defective state is assigned a role that exists in the official catalogue and is compatible with the state's `common.write` flag and `common.type`. The `value.*` writable-power/energy setpoints have no dedicated catalogue entry (there is no `level.power` or `level.energy`), so they use the generic writable `level` role; the timeout uses `level.timer`; the % fill setpoint uses `level.fill`. Enumerated mode selectors use the generic writable `level` role. Numeric status codes use the read-only `value` role.

E1011 — writable setpoints use catalogue Levels-family roles:

2.1 WHEN the `StorEdgeControlBlock.remoteControlChargeLimit` state is created THEN the system SHALL assign a writable-compatible catalogue role (`level`, the generic writable role, since no `level.power` role exists in the catalogue)
2.2 WHEN the `StorEdgeControlBlock.remoteControlDischargeLimit` state is created THEN the system SHALL assign a writable-compatible catalogue role (`level`, the generic writable role, since no `level.power` role exists in the catalogue)
2.3 WHEN the `StorEdgeControlBlock.remoteControlCommandTimeout` state is created THEN the system SHALL assign role `level.timer`, the writable timer/duration role (catalogue-valid for a writable duration in seconds)
2.4 WHEN the `StorEdgeControlBlock.storageAcChargeLimit` state is created THEN the system SHALL assign a writable-compatible catalogue role (`level`, the generic writable role, since no `level.energy` role exists in the catalogue)
2.5 WHEN the `StorEdgeControlBlock.storageBackupReservedSetting` state is created THEN the system SHALL assign role `level.fill`, the writable fill-level setpoint role (catalogue-valid for a writable % setpoint)

E1008 — enumerated mode selectors use a catalogue-valid writable role:

2.6 WHEN the `StorEdgeControlBlock.remoteControlCommandMode` state is created THEN the system SHALL assign a catalogue-valid writable role (`level`, the generic writable role)
2.7 WHEN the `StorEdgeControlBlock.storageAcChargePolicy` state is created THEN the system SHALL assign a catalogue-valid writable role (`level`, the generic writable role)
2.8 WHEN the `StorEdgeControlBlock.storageChargeDischargeDefaultMode` state is created THEN the system SHALL assign a catalogue-valid writable role (`level`, the generic writable role)
2.9 WHEN the `StorEdgeControlBlock.storageControlMode` state is created THEN the system SHALL assign a catalogue-valid writable role (`level`, the generic writable role)

E1009 — numeric status states use a value-family read-only role:

2.10 WHEN the `battery.1.status` state is created with `common.type = number` THEN the system SHALL assign role `value`, a catalogue role that supports `common.type = number` with `common.write = false`
2.11 WHEN the `battery.1.statusInternal` state is created with `common.type = number` THEN the system SHALL assign role `value`, a catalogue role that supports `common.type = number` with `common.write = false`
2.12 WHEN the `inverter.status` state is created with `common.type = number` THEN the system SHALL assign role `value`, a catalogue role that supports `common.type = number` with `common.write = false`
2.13 WHEN the `inverter.statusVendor` state is created with `common.type = number` THEN the system SHALL assign role `value`, a catalogue role that supports `common.type = number` with `common.write = false`

### Unchanged Behavior (Regression Prevention)

3.1 WHEN any state whose current role already exists in the catalogue and matches its `common.type`/`common.write` is created (for example `value.current`, `value.voltage`, `value.power.active`, `value.energy`, `value.frequency`, `value.temperature`, `value.fill`, `value` for `info`/`powerFactor`) THEN the system SHALL CONTINUE TO assign that same role unchanged
3.2 WHEN any of the corrected `StorEdgeControlBlock` states is created THEN the system SHALL CONTINUE TO set `common.write = true`, `common.read = true`, and the same `common.min`, `common.max`, and `common.unit` values as before
3.3 WHEN any of the corrected status states (`battery.1.status`, `battery.1.statusInternal`, `inverter.status`, `inverter.statusVendor`) is created THEN the system SHALL CONTINUE TO set `common.type = number`, `common.read = true`, and `common.write = false` as before
3.4 WHEN the adapter polls or writes any state value THEN the system SHALL CONTINUE TO write the same values with the same acknowledgement behavior, unaffected by the role changes
3.5 WHEN object/channel creation runs repeatedly within a run THEN the system SHALL CONTINUE TO be idempotent, creating each channel and state only once
3.6 WHEN repochecker validates the full object dump THEN the system SHALL CONTINUE TO produce the same 95 objects, with only the 13 previously failing roles corrected and no new errors introduced

---

## Bug Condition and Property Derivation

### Bug Condition

```pascal
FUNCTION isBugCondition(S)
  INPUT: S of type StateObject (id, role, type, write)
  OUTPUT: boolean

  // E1011: read-only value.* role assigned to a writable state
  IF S.write = true AND roleRequiresReadOnly(S.role) THEN
    RETURN true
  END IF

  // E1008: role is not present in the official catalogue
  IF NOT roleExistsInCatalogue(S.role) THEN
    RETURN true
  END IF

  // E1009: role incompatible with the state's common.type
  IF NOT roleSupportsType(S.role, S.type) THEN
    RETURN true
  END IF

  RETURN false
END FUNCTION
```

Concretely, the bug is triggered by exactly these 13 states:
`StorEdgeControlBlock.{remoteControlChargeLimit, remoteControlDischargeLimit, remoteControlCommandTimeout, storageAcChargeLimit, storageBackupReservedSetting, remoteControlCommandMode, storageAcChargePolicy, storageChargeDischargeDefaultMode, storageControlMode}`, and `{battery.1.status, battery.1.statusInternal, inverter.status, inverter.statusVendor}`.

### Property: Fix Checking

```pascal
// For every state that triggers the bug, the fixed adapter must assign a
// catalogue-valid role compatible with the state's write flag and type.
FOR ALL S WHERE isBugCondition(S) DO
  result ← createState'(S)
  ASSERT roleExistsInCatalogue(result.role)
  ASSERT NOT (result.write = true AND roleRequiresReadOnly(result.role))
  ASSERT roleSupportsType(result.role, result.type)
END FOR
```

### Property: Preservation Checking

```pascal
// Every non-buggy state is created identically by the fixed adapter.
FOR ALL S WHERE NOT isBugCondition(S) DO
  ASSERT createState(S) = createState'(S)
END FOR
```

Where **F** = `createState` (adapter before the fix) and **F'** = `createState'` (adapter after the fix). A concrete counterexample demonstrating the bug: creating `inverter.status` with `role = 'indicator'` and `common.type = 'number'` is rejected by repochecker with error E1009.
