# Implementation Plan

- [x] 1. Write bug condition exploration test — Test-Connection artifacts present
  - **Property 1: Bug Condition** - Test Connection Feature Fully Removed
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the test-connection surface still exists
  - **DO NOT attempt to fix the test or the code when it fails** — the failure is the evidence we want
  - **NOTE**: This test encodes the expected post-fix state (zero test-connection artifacts); it will validate the fix once it passes after implementation
  - **GOAL**: Surface concrete counterexamples proving each test-connection-only artifact exists (from Bug Condition in design)
  - **Scoped PBT Approach**: This is a deterministic "artifact presence" bug, so scope the property to the concrete inventory. Iterate over the fixed set of artifacts/files below and assert each is absent; on unfixed code one or more will be present.
  - Assert `isBugCondition(artifact)` is false for every artifact (design "Bug Condition" / Property 1):
    - `Settings.tsx`: no `Test Connection` `<Button>`/`onClick`/`disabled` wiring, no `onTestConnection`, no `renderTestStatus`, no `TestStatus`/`testStatus`, no `TestConnectionResponse`, no `status`/`statusText`/`success`/`failure` styles, no `socket`/`adapterName`/`instance` props, no `CircularProgress`/`AdminConnection` imports
    - `main.ts`: no `handleTestConnection`, no `testConnection` branch, no `onMessage`, no `this.on('message', ...)` binding, no `COMMON_BASE` import
    - `io-package.json`: no `"messagebox": true`
    - all 11 locale files: none of the keys `Test Connection`, `Testing…`, `Connection successful`, `Connection failed`
    - `README.md`: no Test-connection button paragraph
    - test files: no `testConnection` / `probeTestConnection` / Test-Connection-button cases
  - Implement as a scoped property test (fast-check is available) that enumerates the artifact/file set and asserts absence; use grep/file reads as the oracle
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS (this is correct - it proves the test-connection feature still exists)
  - Document counterexamples found (e.g., "`Settings.tsx` contains `onTestConnection`", "en.json still has `Test Connection`", "`io-package.json` has `messagebox: true`")
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 1.1, 1.2, 1.3_

- [x] 2. Write preservation property tests (BEFORE implementing fix) — Non-test-connection behavior
  - **Property 2: Preservation** - Non-Test-Connection Behavior Unchanged
  - **IMPORTANT**: Follow observation-first methodology — observe behavior on UNFIXED code, then encode it
  - Observe on UNFIXED code and capture the baseline:
    - `validateConfig` → per-field error flags (host/port/unitId/pollInterval) and `anyInvalid` for a range of valid/invalid configs
    - The SunSpec Inverter/Meter/Battery value-table backing data and the StorEdge Control Block table backing data
    - The existing integration behaviors: timeout/reconnect/retention, StorEdge read/write/ack, `info.connection` reporting
    - Every non-test-connection i18n key resolves to its current value in each of the 11 locale files
  - Write property-based tests (fast-check) capturing the observed patterns from the "Preservation Requirements" section:
    - For all generated configs, retained field-validation gate is unchanged (Req 3.1)
    - Value-table / StorEdge-table backing data is unchanged (Req 3.2)
    - For all non-test-connection i18n lookups, each resolves exactly as before (Req 3.5)
  - Reuse the existing deterministic suites in `admin-settings-logic.test.ts` and `integration.test.ts` as the oracle for save (Req 3.3) and start-time poll/connect/`info.connection` (Req 3.4)
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms the baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 3. Fix — remove the Test Connection feature and its orphaned surface

  - [x] 3.1 Re-run the message-consumer audit (gate for shared-machinery removal)
    - **CRITICAL GATE**: This must pass before any `onMessage` / `message` binding / `messagebox` removal in 3.4–3.6
    - Grep across `src/`, `src-admin/`, and `io-package.json` for message machinery: `onMessage`, `this.on('message'`, `sendTo`, `sendToAsync`, `getMessage`, `handleMessage`, and the string `testConnection`
    - Confirm `onMessage` in `src/main.ts` has exactly one command branch (`obj.command === 'testConnection'`) with no `default`/fallthrough
    - Confirm the only `sendTo` in `src/main.ts` is the reply inside `handleTestConnection`, and the only `socket.sendTo` in `src-admin` is the `testConnection` call in `onTestConnection`
    - **DECISION**: Only if the sole remaining hits are the artifacts being removed may `onMessage`, the `this.on('message', ...)` binding, and `"messagebox": true` be deleted. If any unrelated consumer is found, keep the shared machinery, remove ONLY the `testConnection` branch, and flag the design for revisit
    - _Bug_Condition: isBugCondition(artifact) for onMessage/message binding/messagebox from design (gated on this audit)_
    - _Requirements: 2.3_

  - [x] 3.2 Remove test-connection members from `src-admin/src/components/Settings.tsx`
    - Delete the `Test Connection` `<Button>` and the `<div>` wrapping only it and `renderTestStatus()`, including the `disabled={anyInvalid || testing || !socketAvailable}` and `onClick={() => void this.onTestConnection()}` wiring and the `{this.renderTestStatus()}` call; delete the now-unused `testing` and `socketAvailable` locals in `render()`
    - Delete methods `onTestConnection()` and `renderTestStatus()`
    - Delete the `TestStatus` type, the `TestConnectionResponse` type, the `SettingsState` `testStatus` field (if `SettingsState` has no other members, remove it and change the component to `React.Component<SettingsProps>`), and the constructor's `this.state = { testStatus: ... }` (remove the constructor if it becomes empty)
    - Delete `socket`, `adapterName`, and `instance` from `SettingsProps`; keep `native`, `onChange`, and `theme`/`IobTheme`
    - Delete the `status`, `statusText`, `success`, `failure`, and now-unused `button` style entries
    - Prune imports: remove `CircularProgress`, `AdminConnection`, and `Button` (if unused after the block is removed); keep `Typography` and `IobTheme`
    - _Bug_Condition: isBugCondition(artifact) for the Settings.tsx UI members from design_
    - _Expected_Behavior: Property 1 — no Test Connection button or status area renders_
    - _Preservation: fields+validation, SunSpec/StorEdge tables, shared Typography/theme stay (Preservation Requirements)_
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 3.3 Update `src-admin/src/components/App.tsx` to stop passing removed props
    - Stop passing `socket`/`adapterName`/`instance` to `<Settings>`; continue passing `native`, `onChange`, and `theme`
    - _Bug_Condition: isBugCondition(artifact) for the socket/adapterName/instance props from design_
    - _Preservation: Settings still receives native/onChange/theme unchanged (Req 3.5)_
    - _Requirements: 2.3_

  - [x] 3.4 Remove test-connection backend from `src/main.ts`
    - Delete `handleTestConnection()` entirely
    - Delete `onMessage()` entirely (its only branch was `testConnection`) — only if 3.1 audit passed
    - Remove the `this.on('message', this.onMessage.bind(this));` binding from the constructor — only if 3.1 audit passed
    - Prune the `COMMON_BASE` import (only `handleTestConnection` used it); keep `validateConfig`, `ModbusClient`, `DEFAULT_TIMEOUT_MS`, `decodeRegisters`, `encodeFloat32le`, `encodeUint32le`
    - _Bug_Condition: isBugCondition(artifact) for handleTestConnection/onMessage/binding/COMMON_BASE from design_
    - _Expected_Behavior: Property 1 — instance binds no `message` handler and defines no `onMessage`_
    - _Preservation: onReady/pollOnce/handleStorEdgeControlChange and info.connection untouched (Req 3.4)_
    - _Requirements: 2.3_

  - [x] 3.5 Remove `"messagebox": true` from `io-package.json`
    - Remove `"messagebox": true` from the `common` block — only if 3.1 audit confirmed no other message consumer
    - _Bug_Condition: isBugCondition(artifact) for the messagebox flag from design (gated on audit)_
    - _Requirements: 2.3_

  - [x] 3.6 Remove the four i18n keys from all locale files
    - Remove `Test Connection`, `Testing…`, `Connection successful`, `Connection failed` from each of the **11** locale files: `de, en, es, fr, it, nl, pl, pt, ru, uk, zh-cn`
    - **NOTE (10-vs-11 discrepancy)**: Requirements/bugfix.md say "all 10 locales," but the repo currently has 11 locale files and all 11 (including `uk.json`) contain the four keys — confirmed by grep. Remove from all 11 so no orphaned translation remains
    - Leave every other key in every file byte-for-byte unchanged
    - _Bug_Condition: isBugCondition(artifact) for the four i18n keys from design_
    - _Preservation: all non-test-connection keys resolve unchanged (Req 3.5)_
    - _Requirements: 2.3_

  - [x] 3.7 Remove the Test-connection paragraph from `README.md`
    - Remove the paragraph describing the Test connection button ("The settings page includes a **Test connection** button …")
    - Leave the surrounding configuration table and the StorEdge paragraph intact
    - _Bug_Condition: isBugCondition(artifact) for the README paragraph from design_
    - _Requirements: 2.3_

  - [x] 3.8 Clean up test files
    - In `src/lib/admin-settings-logic.test.ts`: remove the `describe('Test Connection button gating and request contract (Req 2.1)')` block and its three cases; remove the `testButtonDisabled` field from `formDecision`'s return type and body; prune header doc-comment references to the button / `onTestConnection` / `sendTo('testConnection', ...)`; keep validation and value-table cases unchanged
    - In `src/lib/integration.test.ts`: remove the `probeTestConnection` helper and the entire `describe('Feature: solaredge-sunspec-reader, integration: testConnection')` block (success/failure/validationError); prune now-unused imports (e.g. `COMMON_BASE`) that only the removed block used, verifying with the compiler/linter rather than assuming
    - _Bug_Condition: isBugCondition(artifact) for the test-connection test cases from design_
    - _Preservation: retained validation/value-table/integration cases stay green (Req 3.1–3.4)_
    - _Requirements: 2.3_

  - [x] 3.9 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Test Connection Feature Fully Removed
    - **IMPORTANT**: Re-run the SAME test from task 1 - do NOT write a new test
    - The test from task 1 encodes the expected behavior (zero test-connection artifacts)
    - Run the bug condition exploration test from step 1
    - **EXPECTED OUTCOME**: Test PASSES (confirms every test-connection artifact is gone and the bug is fixed)
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 3.10 Verify preservation tests still pass
    - **Property 2: Preservation** - Non-Test-Connection Behavior Unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - Run the preservation property tests from step 2 and the retained deterministic suites
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions in fields/validation, tables, save, start-time polling, or non-test-connection i18n)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 4. Checkpoint — Ensure all tests pass and no orphaned references remain
  - Build the backend and admin UI: `npm run build` (runs `build:ts` + `build:react`) and `npm run check` (type-checks `src/` and `src-admin/`)
  - Lint: `npm run lint` (runs ESLint on root and `src-admin`)
  - Run the test suite: `npm test` (runs `test:ts` + `test:package`)
  - Grep for orphaned references across `src/`, `src-admin/`, `io-package.json`, and `README.md` — confirm zero remaining hits for `testConnection`, `Test Connection`, `onMessage`, `messagebox`, `CircularProgress`, `COMMON_BASE`, and the four i18n keys, aside from any unrelated legitimate use the 3.1 audit identified
  - Ensure all tests pass and the admin page renders the four fields, the SunSpec tables, and the StorEdge table with no Test Connection button or status area; ask the user if questions arise
  - _Requirements: 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 3.4, 3.5_
