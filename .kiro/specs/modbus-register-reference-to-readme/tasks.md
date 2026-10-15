# Implementation Plan

- [x] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - Register Reference on the Buggy Surfaces
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate the bug exists on both surfaces from the Bug Condition (`isBugCondition`)
  - **Scoped PBT Approach**: The two surfaces are deterministic; scope the property to the concrete failing cases rather than randomizing surfaces
  - Add an exploration test (e.g. `test/readme-register-reference.explore.test.js`) covering both halves of `isBugCondition`:
    - **AdminConfigForm surface**: read `src-admin/src/components/Settings.tsx` source and assert it currently references the register-table machinery — `renderValueTable`, `renderStorEdgeTable`, the SunSpec selectors (`getInverterValueDefs` / `getMeterValueDefs` / `getBatteryValueDefs`), `STOREDGE_CONTROL_REGISTERS`, and the MUI `Accordion`/`Table` imports (design: Bug Details → Bug Condition, Hypothesized Root Cause 1-2). On fixed code these references are gone, so the assertion flips.
    - **Readme surface**: read `README.md` and assert it currently contains NO generated register-reference markers (`<!-- BEGIN:GENERATED:sunspec-inverter -->`, `sunspec-meter`, `sunspec-battery`, `storedge-control`) and no synced per-register SunSpec reference (design: Bug Details → Examples "README has no SunSpec reference").
  - The test assertions should match the Expected Behavior in Property 1 (form renders only four fields; README carries generated, synced tables)
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS (this is correct - it proves the tables live in `Settings.tsx` and the README has no synced reference)
  - Document counterexamples found: config form renders register reference tables; `README.md` has no `BEGIN:GENERATED` markers
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 1.1, 1.2, 1.3, 1.5, 1.6, 2.1, 2.2, 2.5, 2.8_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Non-Buggy Surfaces Unchanged
  - **IMPORTANT**: Follow observation-first methodology — observe behavior on UNFIXED code, record it, then assert it
  - Add a preservation test (e.g. `test/readme-register-reference.preservation.test.js`) that captures the behaviors Property 2 / Preservation Requirements must keep stable:
    - **Config validation** (Req 3.1): observe `validateConfig` results on unfixed code for host/port/unit ID/poll interval across valid and invalid inputs; use `fast-check` (already a devDependency) to generate many config inputs and assert the error-flag outcome. Record the observed outputs so the same property re-runs identically after the fix.
    - **Map public API** (Req 3.2, 3.3): observe and snapshot the outputs of `getInverterValueDefs()` / `getMeterValueDefs()` / `getBatteryValueDefs()` / `STOREDGE_CONTROL_REGISTERS` and the address helpers (`getRegisterAddress`, `getBatteryBase`, `getDeviceRegisterAddress`) from `src/lib/sunspec-map.ts` and `src/lib/storedge-control-map.ts`; assert the exports/outputs are unchanged.
    - **README prose outside markers** (Req 3.6): capture the hand-written README sections (Features, Requirements, Installation, Configuration settings table, States, StorEdge control block prose/notes, Troubleshooting, Support, Changelog, License) and assert they are byte-for-byte unchanged (design: Preservation Requirements → hand-written prose).
  - Property-based testing generates many config inputs for stronger guarantees that `validateConfig` behavior is unchanged
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms the baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.6_

- [x] 3. Fix: move the register reference out of the Admin form and into a synced README

  - [x] 3.1 Extract the shared formatters into `src/lib/register-format.ts`
    - Create `src/lib/register-format.ts` exporting pure functions `formatAddress(address: number): string` and `formatRange(min: number, max: number): string`, moved verbatim from `Settings.tsx` with identical semantics (design: Fix Implementation 1 — Shared formatters)
    - `formatAddress`: `0x`-prefixed, uppercase, 4-digit zero-padded hex (`0xe004 → "0xE004"`)
    - `formatRange`: `"min..max"`, rendering `Number.MAX_VALUE` as the token `∞` (`(0, Number.MAX_VALUE) → "0..∞"`)
    - Add formatter unit tests (`src/lib/register-format.test.ts`) covering padding/case/prefix across several addresses and the `Number.MAX_VALUE → ∞` and ordinary-bounds cases for `formatRange` (design: Testing Strategy → Unit Tests)
    - _Bug_Condition: isBugCondition where surface = Readme and the generator needs one formatter implementation (design Fix Implementation 1)_
    - _Expected_Behavior: single shared formatter consumed by the generator; no second copy (design Fix Implementation 1, 2)_
    - _Preservation: formatter semantics identical to the removed in-file helpers (design Preservation Requirements)_
    - _Requirements: 2.3, 2.6_

  - [x] 3.2 Create the generator `scripts/generate-register-readme.ts` with `--check` mode
    - Create `scripts/generate-register-readme.ts` (run via `ts-node`) that reads the maps through their unchanged public API only: SunSpec `getInverterValueDefs()` / `getMeterValueDefs()` / `getBatteryValueDefs()` + `getRegisterAddress` / `getBatteryBase` / `getDeviceRegisterAddress`, StorEdge `STOREDGE_CONTROL_REGISTERS`, formatters from `register-format.ts` (design: Fix Implementation 2 — Inputs)
    - Emit the exact UI column sets as GitHub-Flavored-Markdown tables (design: Fix Implementation 2 — Column sets):
      - SunSpec Inverter / Meter / Battery: **Name · Register · Datatype · Model · Description**. Inverter/Meter Register = `getRegisterAddress(def)`; Battery Register = `getDeviceRegisterAddress(getBatteryBase(1), def)`; `Model` = `String(def.model)`; `Description` = `def.description ?? ''`
      - StorEdge Control Block: **Name · Address · Encoding · Unit · Range · Function code**, with `Address` = `formatAddress(def.address)`, `Encoding` = `def.kind`, `Unit` = `def.unit ?? ''`, `Range` = `formatRange(def.min, def.max)`, `Function code` = `def.fc`
    - Escape `|` and newline characters in cell text; render one row per def in stable map/selector order for byte-stable output
    - Implement marker injection: locate each block by its marker pair and replace only the content between the markers; fail loudly if a marker pair is missing/malformed (design: Fix Implementation 2 — Marker injection)
    - Implement two modes: default (regenerate and write `README.md`) and `--check` (regenerate in memory, compare against on-disk `README.md`, exit non-zero with a diff summary of the drifted block, write nothing)
    - Add generator + marker-injection unit tests (design: Testing Strategy → Unit Tests / Property-Based Tests): exact headers + one row per def, formatter-driven `Register`/`Address`/`Range` cells, pipe/newline escaping, inside-marker-only replacement, and loud failure on missing/malformed markers
    - _Bug_Condition: isBugCondition where surface = Readme AND registerReferenceMissingOrUnsynced (design Bug Condition)_
    - _Expected_Behavior: readmeRegisterTables == generateFromMaps(sunspec, storedge) AND syncCheckPasses (design Property 1, Fix Checking)_
    - _Preservation: maps and their public API consumed read-only, not modified (design Preservation Requirements)_
    - _Requirements: 2.5, 2.6, 2.7, 2.8_

  - [x] 3.3 Add the generated-marker section to `README.md` and wire the npm scripts
    - Add a "Modbus register reference" section to `README.md` by hand (once) with the four marker pairs `sunspec-inverter` / `sunspec-meter` / `sunspec-battery` / `storedge-control`, placed in an appropriate location without disturbing existing prose (design: Fix Implementation 2 — Marker injection)
    - Run `docs:readme` to populate the blocks from the real maps
    - Add npm scripts to `package.json`: `"docs:readme": "ts-node scripts/generate-register-readme.ts"` and `"docs:readme:check": "ts-node scripts/generate-register-readme.ts --check"` (design: Fix Implementation 2 — npm scripts)
    - _Bug_Condition: isBugCondition where surface = Readme (design Bug Condition)_
    - _Expected_Behavior: README carries generated tables confined to markers; prose outside markers untouched (design Property 1, Fix Implementation 2)_
    - _Preservation: hand-written README prose outside markers stays byte-for-byte unchanged (design Preservation Requirements, Req 3.6)_
    - _Requirements: 2.5, 2.7, 2.8_

  - [x] 3.4 Wire the sync check into the package test tier (CI gate)
    - Add `test/readme-sync.test.js` that invokes the generator's `--check` logic by importing the generator module via `ts-node` (already registered in `test/mocharc.custom.json`) and fails the suite on drift (design: Fix Implementation 2 — Integration points; Testing Strategy → Integration Tests "Drift gate")
    - Register the new test file in the `test:package` script in `package.json` so it runs in `npm run test` and thus in the `adapter-tests` CI job (design: Fix Implementation 2 — CI / local verification)
    - Include a round-trip idempotence assertion (running `--check` right after `docs:readme` passes) and a drift assertion (mutating a map def in a fixture makes `--check` report the affected block)
    - _Bug_Condition: isBugCondition where surface = Readme AND registerReferenceMissingOrUnsynced (design Bug Condition, Examples edge case)_
    - _Expected_Behavior: syncCheckPasses on fresh output; non-zero exit with diff on drift (design Property 1, Fix Checking)_
    - _Preservation: build/type-check/test commands continue to succeed (design Preservation Requirements, Req 3.4, 3.5)_
    - _Requirements: 2.7_

  - [x] 3.5 Remove the register tables and table-only machinery from `Settings.tsx`
    - Delete `renderValueTable()`, `renderStorEdgeTable()`, and the shared `renderTableFor()` helper, and remove their two invocations from `render()` (design: Fix Implementation 3 — Methods)
    - Delete the in-file `formatAddress` / `formatRange` (now in `register-format.ts`; the remaining code does not use them, so no re-import)
    - Remove the table-only imports: `getRegisterAddress`, `getInverterValueDefs`, `getMeterValueDefs`, `getBatteryValueDefs`, `getBatteryBase`, `getDeviceRegisterAddress`, `type SunSpecRegisterDef`, `STOREDGE_CONTROL_REGISTERS`, `type StorEdgeControlRegisterDef`, and the MUI table-only imports (`Table`, `TableHead`, `TableBody`, `TableRow`, `TableCell`, `Paper`, `Accordion`, `AccordionSummary`, `AccordionDetails`, `ExpandMoreIcon`, `Typography`); keep `TextField`, `{ I18n, type IobTheme }`, and `validateConfig` (design: Fix Implementation 3 — Imports)
    - Remove the `tableWrapper`, `scrollBox`, and `accordionDetails` style keys; keep `input` and `controlElement` (design: Fix Implementation 3 — Styles)
    - Result: `Settings.tsx` retains `toNumber`, `currentConfig`, `errors`, `renderNumberField`, `renderHostField`, and a `render()` that emits only the four fields, with no unused-import/variable errors
    - Add/keep the `Settings.tsx` cleanup unit test asserting the trimmed component renders only the four fields and references none of the removed helpers/imports (design: Testing Strategy → Unit Tests)
    - _Bug_Condition: isBugCondition where surface = AdminConfigForm AND rendersRegisterReferenceTable (design Bug Condition)_
    - _Expected_Behavior: renders == {host, port, unitId, pollInterval} AND NOT rendersRegisterReferenceTable (design Property 1, Fix Checking)_
    - _Preservation: four config fields + validateConfig/onChange behavior unchanged (design Preservation Requirements, Req 3.1)_
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 3.6 Remove the table-only i18n keys across all 11 locale files
    - From every locale catalog in `src-admin/src/i18n/` (`de`, `en`, `es`, `fr`, `it`, `nl`, `pl`, `pt`, `ru`, `uk`, `zh-cn`), remove exactly the table-only keys: `SunSpec Values`, `Inverter values`, `Meter values`, `Battery values`, `Name`, `Register`, `Datatype`, `Model`, `Description`, `No SunSpec values available`, `StorEdge Control Block`, `Address`, `Encoding`, `Unit`, `Range`, `Function code`, `No StorEdge control registers available` (design: Fix Implementation 4)
    - Keep the field + validation keys: `Host`, `Port`, `Unit ID`, `Polling interval (s)`, `Invalid host`, `Invalid port`, `Invalid unit ID`, `Invalid polling interval`
    - Derive the final remove-list by scanning the trimmed `Settings.tsx` for `I18n.t('...')` usages and deleting every catalog key not referenced there; apply the removal consistently so no catalog retains a dead key and no referenced key is dropped
    - _Bug_Condition: isBugCondition where surface = AdminConfigForm (design Bug Condition, Hypothesized Root Cause 4)_
    - _Expected_Behavior: only keys referenced by the trimmed Settings.tsx remain (design Property 1)_
    - _Preservation: the four field labels and their validation messages remain in every locale (design Preservation Requirements, Req 3.1)_
    - _Requirements: 2.4_

  - [x] 3.7 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Register Reference Moved to a Synced README
    - **IMPORTANT**: Re-run the SAME test from task 1 - do NOT write a new test
    - The test from task 1 encodes the expected behavior; when it passes it confirms the form renders only four fields and `README.md` carries generated, synced tables
    - Run the bug condition exploration test from task 1
    - **EXPECTED OUTCOME**: Test PASSES (confirms the bug is fixed on both surfaces)
    - _Requirements: 2.1, 2.2, 2.5, 2.8 (Expected Behavior / Property 1 from design)_

  - [x] 3.8 Verify preservation tests still pass
    - **Property 2: Preservation** - Non-Buggy Surfaces Unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - Run the preservation property tests from task 2
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions in config validation, map public API, or README prose outside markers)
    - Confirm all tests still pass after the fix (no regressions)
    - _Requirements: 3.1, 3.2, 3.3, 3.6_

- [x] 4. Checkpoint - Ensure the build, type-check, and all test suites pass
  - Run `npm run build` (root `build:ts` + React `build:react`) and confirm it succeeds (design: Testing Strategy → Integration Tests "Build/type-check/test preservation"; Req 3.4)
  - Run `npm run check` (root `tsc --noEmit` + `tsc --noEmit -p src-admin/tsconfig.json`) and confirm both type-checks pass with no unused-import/variable errors from the trimmed `Settings.tsx` (Req 3.4)
  - Run `npm run test` (`test:ts` + `test:package`, including the new `test/readme-sync.test.js` sync gate) and confirm all suites pass (Req 3.5)
  - Run `npm run docs:readme:check` and confirm the README is in sync with freshly generated output
  - Ensure all tests pass; ask the user if questions arise
  - _Requirements: 3.4, 3.5_
