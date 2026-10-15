# Bugfix Requirements Document

## Introduction

The React Admin UI (`src-admin/src/components/Settings.tsx`) renders several read-only
Modbus register reference tables inside the instance configuration form: the SunSpec
values accordions (Inverter / Meter / Battery, via `renderValueTable()`) and the
StorEdge Control Block table (via `renderStorEdgeTable()`). These tables are reference
documentation, not configuration — they carry no editable inputs and clutter the config
form, which should only ask for the four connection settings (host, port, unit ID,
polling interval).

This fix removes the register reference tables from the Admin UI and relocates that
reference material into `README.md` as well-formatted Markdown tables. To keep the source
maps (`src/lib/sunspec-map.ts`, `src/lib/storedge-control-map.ts`) the single source of
truth and prevent the README tables from drifting from the code, the README tables are
**auto-generated** from those maps by a script, and a sync check guards against stale
output.

The behavior being fixed is purely the presentation surface (what the Admin config form
renders and what the README documents). The underlying register maps, the config fields
and their validation, and the adapter's Modbus runtime behavior are unchanged.

## Bug Analysis

### Current Behavior (Defect)

When the instance configuration page is opened and when the README is read as the
register reference, the surfaces behave as follows:

1.1 WHEN the Admin instance configuration form is rendered THEN the system also renders the SunSpec values reference section (`renderValueTable()`: Inverter / Meter / Battery accordions with Name, Register, Datatype, Model, Description columns) inside the config form

1.2 WHEN the Admin instance configuration form is rendered THEN the system also renders the StorEdge Control Block reference table (`renderStorEdgeTable()`: Name, Address, Encoding, Unit, Range, Function code columns) inside the config form

1.3 WHEN `Settings.tsx` is loaded THEN the system imports and retains the register-table-only machinery (`getRegisterAddress`, `getInverterValueDefs`, `getMeterValueDefs`, `getBatteryValueDefs`, `getBatteryBase`, `getDeviceRegisterAddress`, `SunSpecRegisterDef`, `STOREDGE_CONTROL_REGISTERS`, `StorEdgeControlRegisterDef`, the `formatAddress()` / `formatRange()` helpers, and the MUI Table/Accordion imports) solely to render those tables

1.4 WHEN the admin i18n catalogs are loaded THEN the system retains translation keys used only by the removed tables (e.g. `SunSpec Values`, `Inverter values`, `Meter values`, `Battery values`, `Register`, `Datatype`, `Model`, `Description`, `No SunSpec values available`, `Address`, `Encoding`, `Range`, `Function code`, `No StorEdge control registers available`, and `StorEdge Control Block` / `Name` / `Unit` where no longer referenced)

1.5 WHEN a maintainer reads `README.md` for the full Modbus register reference THEN the system provides no complete per-register SunSpec reference (only the four connection settings and the nine-row StorEdge control table are hand-maintained), so the inverter / meter / battery register details are not documented

1.6 WHEN the source maps change (a register is added, removed, or edited in `src/lib/sunspec-map.ts` or `src/lib/storedge-control-map.ts`) THEN the system has no mechanism that keeps a README register reference in sync, so any register documentation that does exist can silently drift from the code

### Expected Behavior (Correct)

For the same surfaces, after the fix:

2.1 WHEN the Admin instance configuration form is rendered THEN the system SHALL NOT render the SunSpec values reference section, and the config form SHALL contain only the four configuration fields (host, port, unit ID, polling interval)

2.2 WHEN the Admin instance configuration form is rendered THEN the system SHALL NOT render the StorEdge Control Block reference table

2.3 WHEN `Settings.tsx` is loaded THEN the system SHALL retain only the imports and helpers needed by the remaining config fields (`validateConfig` and the field-rendering code), with no unused imports, helpers, or styles left behind from the removed tables

2.4 WHEN the admin i18n catalogs are loaded THEN the system SHALL retain only the translation keys still referenced by the trimmed `Settings.tsx` (the four field labels and their validation messages), with the table-only keys removed consistently across every locale file

2.5 WHEN a maintainer reads `README.md` THEN the system SHALL provide well-formatted Markdown reference tables for the SunSpec Inverter, Meter, and Battery values and for the StorEdge Control Block, carrying the same reference columns the Admin UI used to show

2.6 WHEN the register-reference generator script is run against the current source maps THEN the system SHALL produce the README register tables deterministically from `src/lib/sunspec-map.ts` and `src/lib/storedge-control-map.ts` (same selection the UI used: `getInverterValueDefs` / `getMeterValueDefs` / `getBatteryValueDefs` and `STOREDGE_CONTROL_REGISTERS`), so the maps remain the single source of truth

2.7 WHEN the source maps change and the generator is re-run THEN the system SHALL update the README register tables to match, and a sync check SHALL be available (invokable locally and in CI) that fails when `README.md` does not match freshly generated output, so stale documentation is caught rather than shipped

2.8 WHEN the generated register tables are written into `README.md` THEN the system SHALL confine generated content to clearly delimited markers and SHALL leave all hand-written README prose outside those markers unchanged

### Unchanged Behavior (Regression Prevention)

The following must continue to work exactly as before:

3.1 WHEN a user edits the host, port, unit ID, or polling interval field in the Admin config form THEN the system SHALL CONTINUE TO validate the value via `validateConfig`, show the field-level error text on invalid input, and persist the value through `onChange` exactly as today

3.2 WHEN the adapter polls the inverter at runtime THEN the system SHALL CONTINUE TO read, decode, and expose the SunSpec Inverter / Meter / Battery states and the nine StorEdge Control Block states using the unchanged `src/lib/sunspec-map.ts` and `src/lib/storedge-control-map.ts` data and helpers

3.3 WHEN any code outside `Settings.tsx` imports from `src/lib/sunspec-map.ts` or `src/lib/storedge-control-map.ts` (the reader, state manager, modbus client, and their tests) THEN the system SHALL CONTINUE TO resolve those exports unchanged — the source maps and their public API are not modified by this fix

3.4 WHEN the adapter build and type-check run (`npm run build`, `npm run check`, `tsc` for both root and `src-admin`) THEN the system SHALL CONTINUE TO succeed with no errors introduced by the removed tables or the new generator

3.5 WHEN the existing test suites run (`npm run test`, including the `src/lib` unit tests) THEN the system SHALL CONTINUE TO pass, since the register maps and config validation are unchanged

3.6 WHEN `README.md` is read outside the generated register-table markers (Features, Requirements, Installation, Configuration settings table, States, StorEdge control block prose and notes, Troubleshooting, Support, Changelog, License) THEN the system SHALL CONTINUE TO present that hand-written content unchanged

## Deriving the Bug Condition

**Bug Condition Function** — identifies the surfaces that currently carry the defect:

```pascal
FUNCTION isBugCondition(X)
  INPUT:  X of type RenderSurface  // a thing the project renders/documents
  OUTPUT: boolean

  // The defect is present wherever Modbus register REFERENCE tables are shown
  // in the Admin config form, or wherever the README register reference is
  // missing/able-to-drift from the source maps.
  RETURN (X.surface = AdminConfigForm AND X.rendersRegisterReferenceTable)
      OR (X.surface = Readme        AND X.registerReferenceMissingOrUnsynced)
END FUNCTION
```

**Property Specification** — defines correct behavior for the buggy surfaces:

```pascal
// Property: Fix Checking - register reference moved to a synced README
FOR ALL X WHERE isBugCondition(X) DO
  IF X.surface = AdminConfigForm THEN
    ASSERT renders(X) = { hostField, portField, unitIdField, pollIntervalField }
       AND NOT rendersRegisterReferenceTable(X)
  ELSE IF X.surface = Readme THEN
    ASSERT readmeRegisterTables(X) = generateFromMaps(sunspecMap, storedgeControlMap)
       AND syncCheckPasses(X)
  END IF
END FOR
```

Where `F` is the project before the fix (Admin UI shows the tables; README has no
synced register reference) and `F'` is the project after the fix (Admin UI shows only
the four config fields; README register tables are generated from the maps and
guarded by a sync check).

**Preservation Goal** — non-buggy surfaces behave identically:

```pascal
// Property: Preservation Checking
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT F(X) = F'(X)
END FOR

// i.e. the four config fields + their validation, the adapter's Modbus runtime,
// the unchanged source maps and their consumers, the build/type-check/tests, and
// all hand-written README prose outside the generated markers are unaffected.
```
