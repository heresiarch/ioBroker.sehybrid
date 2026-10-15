# Bugfix Requirements Document

## Introduction

The `ROLE_MAP` in `src/lib/state-manager.ts` maps the logical SunSpec role `power.reactive` to the ioBroker `common.role` string `value.power`. This is semantically imprecise: the ioBroker state roles reference explicitly lists `value.power.reactive` for reactive power quantities (unit `var` / `kVar`). As a result, the reactive-power states created by the adapter — `acVAR` (inverter) and `mVAR`, `mVARA`, `mVARB`, `mVARC` (meter) — advertise a generic active-power-style role instead of the dedicated reactive-power role, reducing the semantic precision of the exposed state objects for consuming UIs and integrations.

The fix changes the single mapping entry `'power.reactive': 'value.power'` to `'power.reactive': 'value.power.reactive'`. The mapping of `power.apparent` to `value.power` is correct (there is no `value.power.apparent` in the ioBroker reference) and must remain unchanged.

## Bug Analysis

### Current Behavior (Defect)

When the adapter creates state objects for reactive-power registers, it derives the ioBroker role from `ROLE_MAP['power.reactive']`, which currently resolves to the imprecise `value.power`.

1.1 WHEN a state object is created for a register whose logical role is `power.reactive` (acVAR, mVAR, mVARA, mVARB, mVARC) THEN the system assigns the ioBroker `common.role` as `value.power`
1.2 WHEN `ROLE_MAP` is inspected THEN the system defines the entry for `power.reactive` as `value.power`

### Expected Behavior (Correct)

The reactive-power role must map to the dedicated reactive-power ioBroker role listed in the state roles reference.

2.1 WHEN a state object is created for a register whose logical role is `power.reactive` (acVAR, mVAR, mVARA, mVARB, mVARC) THEN the system SHALL assign the ioBroker `common.role` as `value.power.reactive`
2.2 WHEN `ROLE_MAP` is inspected THEN the system SHALL define the entry for `power.reactive` as `value.power.reactive`

### Unchanged Behavior (Regression Prevention)

All other role mappings — in particular the `power.apparent` entry, which is correct as-is — must remain unchanged.

3.1 WHEN a state object is created for a register whose logical role is `power.apparent` THEN the system SHALL CONTINUE TO assign the ioBroker `common.role` as `value.power`
3.2 WHEN a state object is created for a register whose logical role is `power` THEN the system SHALL CONTINUE TO assign the ioBroker `common.role` as `value.power.active`
3.3 WHEN a state object is created for a register whose logical role is any role other than `power.reactive` (current, voltage, power, power.apparent, powerFactor, frequency, energy, temperature, percent, status, info) THEN the system SHALL CONTINUE TO assign the same ioBroker `common.role` it assigned before the fix
3.4 WHEN a reactive-power state object is created THEN the system SHALL CONTINUE TO preserve all non-role properties (name, type, unit, read, write, and scaling behavior) unchanged
