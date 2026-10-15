# Bugfix Requirements Document

## Introduction

Every energy-related state in the adapter is created with the generic `common.role` of `value.energy`. This is driven by the single `energy` entry in the role map (`ROLE_MAP.energy = 'value.energy'` in `src/lib/state-manager.ts`), which every register definition tagged `role: 'energy'` in `src/lib/sunspec-map.ts` resolves to. The affected states are the inverter AC lifetime production (`acEnergyWh`), the meter exported totals (`mExportedWh`, `mExportedWhA`, `mExportedWhB`, `mExportedWhC`), the meter imported totals (`mImportedWh`, `mImportedWhA`, `mImportedWhB`, `mImportedWhC`), and the battery energy states (`lifetimeExportEnergy`, `lifetimeImportEnergy`, `ratedEnergy`, `maximumEnergy`, `availableEnergy`).

The ioBroker state-role reference lists more specific energy roles — `value.energy.produced`, `value.energy.consumed`, and `value.energy.active` — alongside the generic `value.energy`. While `value.energy` is valid, dashboards and visualisation adapters that filter by role cannot distinguish produced energy from consumed energy when every state shares the generic role. Adopting the more specific role where the direction of energy flow is semantically clear (produced/exported vs. consumed/imported) improves interoperability, while capacity-type energy states that have no flow direction keep the generic `value.energy` role.

This bug does not cause crashes or incorrect values; it is a role-granularity defect that reduces interoperability. The fix must change only the role strings for the directional energy states and must leave every other state's role, type, unit, read/write flags, and values unchanged.

## Bug Analysis

### Current Behavior (Defect)

All energy states are created with the generic `value.energy` role, so consumers that filter by role cannot distinguish produced from consumed energy.

1.1 WHEN the inverter AC lifetime production state `acEnergyWh` is created THEN the system assigns the generic role `value.energy` instead of the production-specific `value.energy.produced`
1.2 WHEN a meter exported-energy state (`mExportedWh`, `mExportedWhA`, `mExportedWhB`, or `mExportedWhC`) is created THEN the system assigns the generic role `value.energy` instead of the production-specific `value.energy.produced`
1.3 WHEN a meter imported-energy state (`mImportedWh`, `mImportedWhA`, `mImportedWhB`, or `mImportedWhC`) is created THEN the system assigns the generic role `value.energy` instead of the consumption-specific `value.energy.consumed`
1.4 WHEN the battery `lifetimeExportEnergy` state is created THEN the system assigns the generic role `value.energy` instead of the production-specific `value.energy.produced`
1.5 WHEN the battery `lifetimeImportEnergy` state is created THEN the system assigns the generic role `value.energy` instead of the consumption-specific `value.energy.consumed`

### Expected Behavior (Correct)

Directional energy states are created with the specific role that matches their flow direction; capacity-type energy states retain the generic role.

2.1 WHEN the inverter AC lifetime production state `acEnergyWh` is created THEN the system SHALL assign the role `value.energy.produced`
2.2 WHEN a meter exported-energy state (`mExportedWh`, `mExportedWhA`, `mExportedWhB`, or `mExportedWhC`) is created THEN the system SHALL assign the role `value.energy.produced`
2.3 WHEN a meter imported-energy state (`mImportedWh`, `mImportedWhA`, `mImportedWhB`, or `mImportedWhC`) is created THEN the system SHALL assign the role `value.energy.consumed`
2.4 WHEN the battery `lifetimeExportEnergy` state is created THEN the system SHALL assign the role `value.energy.produced`
2.5 WHEN the battery `lifetimeImportEnergy` state is created THEN the system SHALL assign the role `value.energy.consumed`

### Unchanged Behavior (Regression Prevention)

Capacity-type energy states keep the generic role, and all non-role attributes of every energy state, as well as all non-energy states, stay the same.

3.1 WHEN a battery capacity-type energy state with no flow direction (`ratedEnergy`, `maximumEnergy`, or `availableEnergy`) is created THEN the system SHALL CONTINUE TO assign the generic role `value.energy`
3.2 WHEN any energy state is created THEN the system SHALL CONTINUE TO set the same `common.type` (`number`), `common.unit` (`Wh`), `common.read`, and `common.write` values as before
3.3 WHEN any non-energy state is created (for example `acPower` with `value.power.active`, `acCurrent` with `value.current`, or any `StorEdgeControlBlock` setpoint) THEN the system SHALL CONTINUE TO assign its existing role unchanged
3.4 WHEN any energy state is read and decoded THEN the system SHALL CONTINUE TO produce the same numeric value as before, since only the role string changes
