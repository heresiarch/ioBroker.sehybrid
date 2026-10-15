# Modbus Register Reference to README Bugfix Design

## Overview

The Admin instance-config form (`src-admin/src/components/Settings.tsx`) currently renders
read-only Modbus register **reference** tables — the SunSpec Inverter/Meter/Battery
accordions (`renderValueTable()`) and the StorEdge Control Block table
(`renderStorEdgeTable()`). This reference material has no editable inputs; it clutters a
config form whose only job is to collect four connection settings.

The fix moves that reference material into `README.md` as auto-generated Markdown tables
and strips the tables (and their now-orphaned imports, helpers, styles, and i18n keys)
out of `Settings.tsx`. To keep the source maps (`src/lib/sunspec-map.ts`,
`src/lib/storedge-control-map.ts`) the single source of truth, the README tables are
emitted by a deterministic generator that reads those maps through their existing public
API, written only between clearly delimited markers so hand-written prose is never
touched. A `--check` mode re-runs the generator in memory and fails if `README.md` has
drifted from fresh output, wiring into the package tests and CI so stale docs are caught
rather than shipped.

The strategy keeps the fix minimal and surgical:

- **One formatter implementation.** The `formatAddress`/`formatRange` helpers currently
  living inside `Settings.tsx` move to a small shared module in `src/lib/` so both the
  (removed) UI semantics and the new generator share one implementation, satisfying the
  requirement to avoid a second copy.
- **No change to the maps or their public API.** The generator consumes exactly the
  selectors the UI used (`getInverterValueDefs` / `getMeterValueDefs` /
  `getBatteryValueDefs` and `STOREDGE_CONTROL_REGISTERS`) plus the address helpers
  (`getRegisterAddress` / `getBatteryBase` / `getDeviceRegisterAddress`).
- **TypeScript everywhere, run via `ts-node`.** The repo already registers
  `ts-node/register` for its Mocha suites, so a TS generator and a TS-based sync test
  need no new build step and can import the maps directly.

## Glossary

- **Bug_Condition (C)**: The condition that triggers the bug — a render surface that
  either (a) is the Admin config form AND renders a Modbus register reference table, or
  (b) is `README.md` AND lacks a register reference that stays in sync with the maps.
- **Property (P)**: The desired behavior — the Admin config form renders only the four
  connection fields, and `README.md` carries generated register tables that match fresh
  generator output (sync check passes).
- **Preservation**: Behavior that must remain unchanged — the four config fields and
  their validation, the adapter's Modbus runtime, the source maps and their public API,
  the build/type-check/test commands, and all hand-written README prose outside the
  generated markers.
- **Source maps**: `src/lib/sunspec-map.ts` (SunSpec Inverter/Meter/Battery defs +
  address helpers) and `src/lib/storedge-control-map.ts`
  (`STOREDGE_CONTROL_REGISTERS`) — the single source of truth for register data.
- **Generator**: The script that reads the source maps and emits the README register
  tables as Markdown.
- **Markers**: The HTML-comment delimiters (`<!-- BEGIN:... -->` / `<!-- END:... -->`)
  that fence generated content inside `README.md`.
- **Sync check (`--check` mode)**: A mode of the generator that re-renders the tables in
  memory and compares them against the current `README.md`, exiting non-zero on any
  difference.
- **`formatAddress` / `formatRange`**: The two display formatters (hex `0x`-prefixed,
  uppercase, 4-digit address; `min..max` range with `∞` for `Number.MAX_VALUE`)
  currently defined inside `Settings.tsx`, relocated to a shared `src/lib` module.

## Bug Details

### Bug Condition

The bug manifests on exactly two render/documentation surfaces: the **Admin config form**
whenever it renders a register reference table, and **`README.md`** whenever the register
reference is missing or free to drift from the source maps. `Settings.tsx` is the surface
that renders the tables (via `renderValueTable()` / `renderStorEdgeTable()`), pulling in
map selectors, address helpers, display formatters, MUI table components, and i18n keys
solely to do so; `README.md` is the surface that documents only four connection settings
and the nine-row StorEdge control table by hand, with no synced per-register reference.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type RenderSurface
  OUTPUT: boolean

  RETURN (input.surface = AdminConfigForm AND input.rendersRegisterReferenceTable)
      OR (input.surface = Readme        AND input.registerReferenceMissingOrUnsynced)
END FUNCTION
```

### Examples

- **Admin form shows SunSpec tables (defect):** opening the instance config renders the
  Inverter/Meter/Battery accordions with Name/Register/Datatype/Model/Description columns.
  Expected: only the Host/Port/Unit ID/Poll interval fields.
- **Admin form shows StorEdge table (defect):** the same form renders the StorEdge Control
  Block table (Name/Address/Encoding/Unit/Range/Function code). Expected: not rendered.
- **README has no SunSpec reference (defect):** a maintainer reading `README.md` finds no
  complete Inverter/Meter/Battery register listing. Expected: generated Markdown tables
  for all four groups.
- **Edge case — map edited, README untouched:** a register is added to `sunspec-map.ts`
  but `README.md` is not regenerated. Expected: the sync check fails, flagging the drift
  before it ships.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Editing Host/Port/Unit ID/Poll interval must continue to validate via `validateConfig`,
  show the field-level error text on invalid input, and persist through `onChange`.
- The adapter's Modbus runtime must continue to read/decode/expose the SunSpec
  Inverter/Meter/Battery states and the nine StorEdge control states from the unchanged
  maps.
- Every consumer of `src/lib/sunspec-map.ts` and `src/lib/storedge-control-map.ts` outside
  `Settings.tsx` (reader, state manager, modbus client, their tests) must resolve the same
  exports — the maps' public API is not modified.
- `npm run build`, `npm run check`, and `npm run test` must continue to succeed.
- All hand-written `README.md` prose outside the generated markers (Features,
  Requirements, Installation, Configuration settings table, States, StorEdge control block
  prose and notes, Troubleshooting, Support, Changelog, License) must stay byte-for-byte
  unchanged.

**Scope:**
All inputs that do NOT satisfy the bug condition must be completely unaffected by this fix.
This includes:
- The four config fields and their validation path.
- The adapter's Modbus read/write/decode runtime.
- The source maps' data and exported API.
- Hand-written README content outside the markers.

**Note:** The actual expected correct behavior is defined in the Correctness Properties
section (Property 1). This section focuses on what must NOT change.

## Hypothesized Root Cause

The defect is not a logic error but a **placement** decision: reference documentation was
built into the Admin config component instead of into the docs, and no mechanism ties the
documentation to the maps. The contributing causes are:

1. **Reference material embedded in the config component.** `renderValueTable()` and
   `renderStorEdgeTable()` live in `Settings.tsx`, so opening the config form renders
   non-configuration tables. Removing these two methods (and their helper
   `renderTableFor()`) removes the Admin-side defect.

2. **UI-only dependencies retained for the tables.** `Settings.tsx` imports map selectors
   (`getInverterValueDefs` / `getMeterValueDefs` / `getBatteryValueDefs`), address helpers
   (`getRegisterAddress` / `getBatteryBase` / `getDeviceRegisterAddress`), types
   (`SunSpecRegisterDef`, `StorEdgeControlRegisterDef`), `STOREDGE_CONTROL_REGISTERS`, the
   `formatAddress` / `formatRange` helpers, the MUI Table/Accordion/Paper/Typography stack
   with `ExpandMoreIcon`, and the `tableWrapper` / `scrollBox` / `accordionDetails` style
   keys — all orphaned once the tables are gone.

3. **No single-source-of-truth bridge to the docs.** There is no generator from maps to
   README, so any README register reference is hand-maintained and free to drift.

4. **i18n keys scoped only to the tables.** The admin locale catalogs carry table-only
   keys (`SunSpec Values`, `Inverter values`, `Meter values`, `Battery values`,
   `Register`, `Datatype`, `Model`, `Description`, `No SunSpec values available`,
   `StorEdge Control Block`, `Name`, `Address`, `Encoding`, `Unit`, `Range`,
   `Function code`, `No StorEdge control registers available`) that become dead once the
   tables are removed.

## Correctness Properties

Property 1: Bug Condition - Register Reference Moved to a Synced README

_For any_ render surface where the bug condition holds (`isBugCondition` returns true), the
fixed project SHALL present the corrected surface: if the surface is the Admin config form,
it SHALL render only the four configuration fields (host, port, unit ID, polling interval)
and SHALL NOT render any register reference table; if the surface is `README.md`, its
register tables (SunSpec Inverter, Meter, Battery and StorEdge Control Block) SHALL equal
the output of the generator run against the current source maps, and the sync check SHALL
pass.

**Validates: Requirements 2.1, 2.2, 2.3, 2.5, 2.6, 2.7, 2.8**

Property 2: Preservation - Non-Buggy Surfaces Unchanged

_For any_ surface where the bug condition does NOT hold (`isBugCondition` returns false),
the fixed project SHALL produce the same result as the original project, preserving the
four config fields and their `validateConfig`/`onChange` behavior, the adapter's Modbus
runtime, the source maps and their public API, the build/type-check/test outcomes, and all
hand-written README prose outside the generated markers.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**

## Fix Implementation

The fix has four coordinated parts: a shared formatter module, the generator + sync check,
the `Settings.tsx` cleanup, and the i18n cleanup.

### 1. Shared formatters

**File (new):** `src/lib/register-format.ts`

**Change:** Move `formatAddress(address: number): string` and
`formatRange(min: number, max: number): string` out of `Settings.tsx` into this module
with identical semantics:

- `formatAddress` — `0x`-prefixed, uppercase, 4-digit, zero-padded hex
  (`0xe004 → "0xE004"`).
- `formatRange` — `"min..max"`, rendering `Number.MAX_VALUE` as the token `∞`
  (`(0, Number.MAX_VALUE) → "0..∞"`).

Both are pure functions with no runtime dependencies, so they import cleanly into the
generator (Node/ts-node) and would import cleanly into the admin bundle too. Keeping them
in `src/lib` matches the existing pattern where `Settings.tsx` already imports
`validateConfig` and the sunspec helpers directly from `../../../src/lib`.

### 2. The generator + sync check

**File (new):** `scripts/generate-register-readme.ts` (run via `ts-node`).

**Inputs (unchanged public API only):**
- SunSpec: `getInverterValueDefs()`, `getMeterValueDefs()`, `getBatteryValueDefs()` and
  the address helpers `getRegisterAddress`, `getBatteryBase`, `getDeviceRegisterAddress`
  from `sunspec-map.ts`.
- StorEdge: `STOREDGE_CONTROL_REGISTERS` from `storedge-control-map.ts`.
- Formatters: `formatAddress`, `formatRange` from `register-format.ts`.

**Column sets (identical to the removed UI):**
- SunSpec (Inverter / Meter / Battery): **Name · Register · Datatype · Model · Description**.
  - Inverter/Meter rows use `getRegisterAddress(def)` for the Register column.
  - Battery rows use `getDeviceRegisterAddress(getBatteryBase(1), def)` — the battery.1
    absolute address — mirroring the UI's representative-address choice (the UI rendered
    the raw numeric address; the generator renders the same number).
  - `Model` renders `String(def.model)`; `Description` renders `def.description ?? ''`.
- StorEdge Control Block: **Name · Address · Encoding · Unit · Range · Function code**.
  - `Address` = `formatAddress(def.address)`; `Encoding` = `def.kind`;
    `Unit` = `def.unit ?? ''`; `Range` = `formatRange(def.min, def.max)`;
    `Function code` = `def.fc`.

**Markdown emission:** each group is rendered as a GitHub-Flavored-Markdown table (header
row, `---` separator row, one row per def). Cell text is escaped for the `|` and newline
characters so a stray pipe in a description cannot break a table. A deterministic ordering
(map/selector order, which is stable) guarantees byte-stable output across runs.

**Marker injection:** the generator reads `README.md`, locates each managed block by its
marker pair, and replaces only the content between the markers — leaving the markers
themselves and everything outside them untouched. Marker names are specific per table so
blocks are independently addressable, e.g.:

```
<!-- BEGIN:GENERATED:sunspec-inverter -->
...generated table...
<!-- END:GENERATED:sunspec-inverter -->
```

with analogous `sunspec-meter`, `sunspec-battery`, and `storedge-control` blocks. A new
documentation section (heading + markers) is added to `README.md` once, by hand, in an
appropriate place (a "Modbus register reference" section). If a marker pair is missing or
malformed, the generator fails loudly rather than guessing where to write.

**Modes:**
- **Write (default):** regenerate the blocks and write `README.md` back.
- **`--check`:** regenerate the blocks in memory, compare against the on-disk
  `README.md`; exit `0` if identical, non-zero (with a diff summary of which block drifted)
  if not. No file is written in this mode.

**npm scripts (package.json):**
- `"docs:readme": "ts-node scripts/generate-register-readme.ts"` — regenerate and write.
- `"docs:readme:check": "ts-node scripts/generate-register-readme.ts --check"` — sync
  check.

**Integration points (grounded in package.json / tasks.js / CI):**
- **Build:** `tasks.js` orchestrates the React admin build; the README generator is doc
  generation, not part of the admin bundle, so it is NOT added to `node tasks`. It is kept
  as its own `docs:readme` script to avoid coupling doc output to the Vite pipeline.
- **CI / local verification:** the sync check runs as part of the package test tier. A new
  test file `test/readme-sync.test.js` invokes the generator's `--check` logic (importing
  the generator module via `ts-node`, already registered in `test/mocharc.custom.json`) and
  fails the suite on drift. Because `test:package` runs in `npm run test`, and `npm run
  test` runs in the `adapter-tests` CI job, the check is enforced both locally and in CI
  without touching the workflow YAML. Alternatively/additionally it can be surfaced as the
  standalone `docs:readme:check` script for a pre-commit hook.
- **Pre-commit (optional):** teams that want it can call `npm run docs:readme:check` from a
  hook; the design does not add a hook by default to keep the change minimal and avoid
  surprising contributors.

### 3. Admin UI cleanup (`src-admin/src/components/Settings.tsx`)

Remove everything that existed only to render the tables, leaving the four config fields
and `validateConfig`:

- **Methods:** delete `renderValueTable()`, `renderStorEdgeTable()`, and the shared
  `renderTableFor()` helper; remove their two invocations from `render()`.
- **Local helpers:** delete the in-file `formatAddress` and `formatRange` (now in
  `register-format.ts`; no re-import is needed because the remaining code does not use
  them).
- **Imports — remove:** `getRegisterAddress`, `getInverterValueDefs`, `getMeterValueDefs`,
  `getBatteryValueDefs`, `getBatteryBase`, `getDeviceRegisterAddress`,
  `type SunSpecRegisterDef` (from `sunspec-map`); `STOREDGE_CONTROL_REGISTERS`,
  `type StorEdgeControlRegisterDef` (from `storedge-control-map`); and the MUI table-only
  imports `Table`, `TableHead`, `TableBody`, `TableRow`, `TableCell`, `Paper`,
  `Accordion`, `AccordionSummary`, `AccordionDetails`, `ExpandMoreIcon`, and `Typography`
  (verified unused once the tables are gone — the remaining fields use only `TextField`).
- **Imports — keep:** `TextField`, `{ I18n, type IobTheme }`, and `validateConfig`.
- **Styles:** remove the `tableWrapper`, `scrollBox`, and `accordionDetails` keys from the
  `styles` object; keep `input` and `controlElement` (used by the field renderers).
- **Result:** `Settings.tsx` retains `toNumber`, `currentConfig`, `errors`,
  `renderNumberField`, `renderHostField`, and a `render()` that emits only the four fields.
  Type-check (`tsc -p src-admin/tsconfig.json`) and `npm run lint --prefix src-admin` must
  pass with no unused-import or unused-variable errors.

### 4. i18n cleanup (`src-admin/src/i18n/*.json`, all 11 locales)

Across every locale file (`de`, `en`, `es`, `fr`, `it`, `nl`, `pl`, `pt`, `ru`, `zh-cn`,
and any others present), remove exactly the table-only keys and keep the field + validation
keys. Based on `en.json`:

- **Remove:** `SunSpec Values`, `Inverter values`, `Meter values`, `Battery values`,
  `Name`, `Register`, `Datatype`, `Model`, `Description`, `No SunSpec values available`,
  `StorEdge Control Block`, `Address`, `Encoding`, `Unit`, `Range`, `Function code`,
  `No StorEdge control registers available`.
- **Keep:** `Host`, `Port`, `Unit ID`, `Polling interval (s)`, `Invalid host`,
  `Invalid port`, `Invalid unit ID`, `Invalid polling interval`.

The removal must be applied **consistently** to all locale files so no catalog retains a
dead key and no referenced key is dropped. The actual key list to remove is derived from
scanning the trimmed `Settings.tsx` for `I18n.t('...')` usages and deleting every catalog
key not referenced there.

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that
demonstrate the bug on unfixed code (the Admin form rendering reference tables, and the
absence of a synced README reference), then verify the fix works correctly (form shows only
fields; README tables match generated output) and preserves existing behavior (config
validation, Modbus runtime, map API, build/tests, hand-written prose).

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix.
Confirm or refute the root-cause analysis (reference tables embedded in the config form;
no maps→README bridge). If refuted, re-hypothesize.

**Test Plan**: Write tests that inspect the current `Settings.tsx` render output / source
for the register-table machinery, and that assert the current `README.md` has no generated
register-reference markers. Run on the UNFIXED code to observe the tables being present and
the README reference being absent.

**Test Cases**:
1. **SunSpec tables present in config form**: assert `renderValueTable` / the
   Inverter/Meter/Battery accordions are rendered by the current `Settings.tsx` (will fail
   on fixed code — i.e. demonstrates the defect on unfixed code).
2. **StorEdge table present in config form**: assert `renderStorEdgeTable` renders on
   unfixed code (demonstrates the defect).
3. **README missing generated reference**: assert the current `README.md` contains no
   `BEGIN:GENERATED` markers / no generated SunSpec Inverter/Meter/Battery tables
   (demonstrates the defect).
4. **Drift detection (edge case)**: with a generator in place, mutate a map def in a
   fixture and assert `--check` reports drift (confirms the sync mechanism catches staleness).

**Expected Counterexamples**:
- The config form renders register reference tables (should render only four fields).
- `README.md` has no synced per-register reference (should have generated tables).
- Possible contributing causes: tables coded into `Settings.tsx`; no maps→README generator;
  table-only imports/i18n keys retained.

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function
produces the expected behavior.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := fixedProject(input)
  ASSERT expectedBehavior(result)
  // AdminConfigForm -> renders == {host, port, unitId, pollInterval} AND no reference table
  // Readme          -> readmeRegisterTables == generateFromMaps(sunspec, storedge) AND syncCheckPasses
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed
function produces the same result as the original function.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT originalProject(input) = fixedProject(input)
  // config fields + validation, Modbus runtime, map public API,
  // build/type-check/tests, README prose outside markers
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking
because:
- It generates many config inputs automatically across the input domain to confirm
  `validateConfig` behavior is unchanged.
- It catches edge cases that hand-written unit tests might miss.
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs.

**Test Plan**: Observe behavior on UNFIXED code first (config validation outcomes, map
exports, README prose), then write property/example tests capturing that behavior and
re-run after the fix.

**Test Cases**:
1. **Config validation preservation**: observe `validateConfig` results for host/port/unit
   ID/poll interval on unfixed code, then assert identical results after the fix.
2. **Map public API preservation**: observe the exports and outputs of
   `getInverterValueDefs` / `getMeterValueDefs` / `getBatteryValueDefs` /
   `STOREDGE_CONTROL_REGISTERS` and the address helpers on unfixed code, then assert they
   are unchanged after the fix.
3. **README prose preservation**: capture the hand-written README sections outside the
   generated markers and assert they are byte-for-byte unchanged after the fix.

### Unit Tests

- Formatter unit tests for `register-format.ts`: `formatAddress` padding/case/prefix for a
  range of addresses; `formatRange` including the `Number.MAX_VALUE → ∞` case and ordinary
  bounds — mirroring the semantics the UI relied on.
- Generator unit tests: given fixture defs, assert the emitted Markdown has the exact
  column headers and one row per def, with `Register`/`Address`/`Range` cells formatted by
  the shared formatters, and that pipe/newline cell content is escaped.
- Marker-injection unit tests: given a README with the four marker pairs, assert only the
  inside-marker content changes and prose outside is untouched; assert a missing/malformed
  marker pair causes a loud failure.
- `Settings.tsx` cleanup unit test: assert the trimmed component renders only the four
  fields and references none of the removed helpers/imports.

### Property-Based Tests

- Generate random valid/invalid config inputs and assert `validateConfig`-driven error
  flags are identical before and after the fix (config-field preservation).
- Generate random register-def arrays and assert the generator produces one table row per
  def and never emits a row that breaks Markdown table structure (table well-formedness).
- Generate README documents with arbitrary prose around fixed markers and assert
  marker injection preserves all out-of-marker bytes (prose preservation).

### Integration Tests

- Full generator run: execute `docs:readme` against the real maps and assert the four
  blocks are populated and well-formed; then run `docs:readme:check` and assert it passes
  (round-trip idempotence).
- Drift gate: mutate a map def, run `--check`, and assert a non-zero exit with a diff
  pointing at the affected block (the CI/package-test gate).
- Build/type-check/test preservation: run `npm run build`, `npm run check`, and
  `npm run test` and assert they still succeed with the tables removed and the generator
  added.
