# Remove Test Connection Button Bugfix Design

## Overview

The admin settings UI (`src-admin/src/components/Settings.tsx`) renders a **Test Connection** button
that sends a `testConnection` message to the running instance. The instance handles it in `src/main.ts`
via `onMessage` → `handleTestConnection`, which opens a *second*, temporary Modbus connection, probes the
SunSpec identity (Common) block, and replies with the inverter's manufacturer and model.

This path is redundant: at start-up the adapter already connects over Modbus, validates the configuration,
polls the inverter, and reports reachability through `info.connection` with its own error handling. The
manual probe duplicates that logic and adds UI, backend, i18n, documentation, and test surface that must be
maintained for no additional user value.

The fix is a **pure removal**: delete the Test Connection button and every member, message handler,
translation, documentation paragraph, and test that exists *solely* to support it, while leaving the rest
of the settings page (field editing with validation, the SunSpec value tables, the StorEdge Control Block
table) and the adapter's own start-time connection handling byte-for-byte unchanged in behavior.

Because `testConnection` is the only command `onMessage` handles and the only message any client sends
(verified below in the Fix Implementation "message-consumer audit"), the removal also deletes `onMessage`,
its `this.on('message', ...)` binding, and the `"messagebox": true` flag in `io-package.json`.

## Glossary

- **Bug_Condition (C)**: The condition that triggers the defect — the UI/instance is in a state where the
  Test Connection feature (button, its status area, the `testConnection` message handler, and the
  translations/docs/tests that exist only for it) is present. Formally, an "input" here is a point in the
  rendered admin surface, the instance message router, the i18n key set, the README, or the test suite that
  belongs to the test-connection feature.
- **Property (P)**: The desired post-fix behavior — none of the test-connection-only artifacts exist, and
  the admin page relies solely on the adapter's start-time connection logic and `info.connection` for
  feedback.
- **Preservation**: Every non-test-connection behavior — the Host/Port/Unit ID/Polling-interval fields and
  their validation, the SunSpec value tables, the StorEdge Control Block table, config save, and the
  adapter's own poll/connect/`info.connection` handling — must remain exactly as before.
- **`onTestConnection`**: The async method in `Settings.tsx` that calls
  `socket.sendTo(..., 'testConnection', ...)` and stores the result in component state.
- **`renderTestStatus`**: The method in `Settings.tsx` that renders the idle/testing/success/failure status
  area beneath the button.
- **`handleTestConnection`**: The method in `src/main.ts` that validates the endpoint and probes the
  SunSpec Common block over a temporary `ModbusClient`.
- **`onMessage`**: The `message` event handler in `src/main.ts` whose only branch dispatches
  `testConnection`.
- **message consumer**: Any code that handles an incoming adapter message (`onMessage` branch) or sends one
  (`sendTo`/`socket.sendTo` with a command). Used in the audit that gates removing `onMessage` / the
  `message` binding / `"messagebox": true`.

## Bug Details

### Bug Condition

The defect manifests whenever the admin settings surface, the instance message router, the i18n key set,
the README, or the test suite still contains a test-connection-only artifact. Each such artifact is a
redundant maintenance surface duplicating the adapter's own start-time connection logic.

**Formal Specification:**
```
FUNCTION isBugCondition(artifact)
  INPUT: artifact — a UI member, message handler, i18n key, doc paragraph, or test
  OUTPUT: boolean

  RETURN artifact EXISTS
         AND artifact.purpose == "support the Test Connection feature"
         AND artifact is NOT shared with any preserved feature
         (fields, SunSpec tables, StorEdge table, save, start-time polling)
END FUNCTION
```

Concretely, `isBugCondition` holds for each of:
- `Settings.tsx`: the `Test Connection` `<Button>` and its `onClick`/`disabled` wiring; `onTestConnection()`;
  `renderTestStatus()`; the `TestStatus` state type and `testStatus` component state; the
  `TestConnectionResponse` type; the status-only styles `status`, `statusText`, `success`, `failure`; the
  `socket` / `adapterName` / `instance` props (used only to build the `sendTo('testConnection', ...)` call);
  and the now-unused imports `CircularProgress` and `AdminConnection`.
- `main.ts`: `handleTestConnection()`; the `testConnection` branch of `onMessage()`; the whole `onMessage`
  method; the `this.on('message', this.onMessage.bind(this))` binding; and the now-unused `COMMON_BASE`
  import.
- `io-package.json`: `"messagebox": true`.
- `src-admin/src/i18n/*.json`: the keys `Test Connection`, `Testing…`, `Connection successful`,
  `Connection failed`.
- `README.md`: the paragraph describing the Test connection button.
- `src/lib/admin-settings-logic.test.ts` and `src/lib/integration.test.ts`: the test-connection button /
  `probeTestConnection` / `testConnection` cases and their now-orphaned imports.

### Examples

- **UI present (bug):** Opening the instance settings page renders a "Test Connection" button and a status
  area. Expected after fix: no such button or status area is rendered.
- **Redundant probe (bug):** Clicking the button opens a *separate* temporary Modbus connection to probe the
  SunSpec identity block, duplicating what start-up polling already does. Expected after fix: no manual
  probe exists; `info.connection` is the single source of connection feedback.
- **Message box advertised (bug):** `io-package.json` declares `"messagebox": true` and the instance binds a
  `message` handler, yet the only command it ever served is being removed. Expected after fix: no message
  box is advertised and no `message` handler is bound (no other consumer remains — see audit).
- **Stray translations (bug):** Each locale file carries `Test Connection` / `Testing…` /
  `Connection successful` / `Connection failed` keys with no referencing code. Expected after fix: those four
  keys are gone from every locale that had them, and all other keys resolve unchanged.
- **Edge case — shared symbols (NOT bug):** `Typography`, `validateConfig`, `ModbusClient`,
  `DEFAULT_TIMEOUT_MS`, `decodeRegisters`, and the `theme`/`IobTheme` prop are referenced by preserved
  features. `isBugCondition` is false for them; they must stay.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- The Host, Port, Unit ID, and Polling interval fields render with their existing validation and inline
  error messages (Req 3.1).
- The SunSpec Values tables (Inverter, Meter, Battery) and the StorEdge Control Block table render exactly
  as before (Req 3.2).
- Saving the admin settings persists the configuration using the existing save behavior (Req 3.3).
- On start the adapter establishes its own Modbus connection, validates the config, polls the inverter, and
  reports connection status via `info.connection` with its existing error handling (Req 3.4).
- Every non-test-connection i18n string, style, and Settings member resolves exactly as before (Req 3.5).

**Scope:**
All inputs/artifacts that are NOT test-connection-only are completely unaffected by this fix. This includes:
- The four connection fields and their validation gates.
- The three SunSpec value tables and the StorEdge Control Block table (and the shared `Typography` import,
  `theme`/`IobTheme` prop, and the shared `validateConfig`/`sunspec`/`storedge` imports they rely on).
- Config save, and the adapter's start-time connect/poll/`info.connection` logic (which keeps using
  `ModbusClient`, `DEFAULT_TIMEOUT_MS`, `validateConfig`, and `decodeRegisters`).

> The expected *correct* behavior for the bug condition is defined below in Property 1 of
> **Correctness Properties**; this section lists only what must NOT change.

## Hypothesized Root Cause

This is not a logic bug but an accumulation of redundant surface. The "cause" is a feature that was built in
parallel to the adapter's own connection handling and is no longer justified. The analysis below identifies
*where* the redundant surface lives so removal is complete and targeted:

1. **Admin UI coupling (Settings.tsx)**: The button is wired to `onTestConnection`, which depends on the
   `socket` / `adapterName` / `instance` props and renders through `renderTestStatus` using the
   `TestStatus`/`TestConnectionResponse` types, four status styles, and the `CircularProgress` import. All of
   these exist only for the button.

2. **Backend message path (main.ts)**: `onMessage` has a single `testConnection` branch delegating to
   `handleTestConnection`, which is the only consumer of the `COMMON_BASE` import. With the branch gone, the
   method, its binding, and `COMMON_BASE` become dead.

3. **Message-box advertisement (io-package.json)**: `"messagebox": true` exists to enable the message path;
   with no remaining message consumer it is dead configuration.

4. **Satellite surface (i18n / README / tests)**: Four translation keys per locale, one README paragraph,
   and specific test cases assert or describe the feature. They are orphaned once the feature is removed.

## Correctness Properties

Property 1: Bug Condition - Test Connection Feature Fully Removed

_For any_ artifact where the bug condition holds (`isBugCondition` returns true) — the Test Connection
button and its wiring, `onTestConnection`, `renderTestStatus`, the `TestStatus`/`testStatus`/
`TestConnectionResponse`/status-style/`socket`-`adapterName`-`instance`-prop/`CircularProgress`/
`AdminConnection` members in `Settings.tsx`; `handleTestConnection`, the `testConnection` branch,
`onMessage`, the `message` binding, and the `COMMON_BASE` import in `main.ts`; `"messagebox": true` in
`io-package.json`; the four i18n keys in every locale; the README paragraph; and the test-connection test
cases — the fixed codebase SHALL NOT contain that artifact, the admin page SHALL render no Test Connection
button or status area, the instance SHALL advertise no message box and bind no `message` handler, and
connection feedback SHALL come solely from the adapter's start-time logic and `info.connection`. The project
SHALL still type-check, build, lint, and pass its test suite.

**Validates: Requirements 2.1, 2.2, 2.3**

Property 2: Preservation - Non-Test-Connection Behavior Unchanged

_For any_ artifact where the bug condition does NOT hold (`isBugCondition` returns false) — the four
connection fields and their validation/inline errors, the three SunSpec value tables, the StorEdge Control
Block table, config save, the adapter's start-time connect/poll/`info.connection` handling, every
non-test-connection i18n key, and every shared symbol (`Typography`, `theme`/`IobTheme`, `validateConfig`,
`ModbusClient`, `DEFAULT_TIMEOUT_MS`, `decodeRegisters`) — the fixed codebase SHALL behave and resolve
exactly as the original, preserving all existing settings-page and adapter functionality.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

## Fix Implementation

### Message-consumer audit (gates the `onMessage` / `message` binding / `messagebox` removal)

Before removing the shared message machinery, confirm `testConnection` is the only message consumer. The
following was verified against the current tree and MUST be re-confirmed at implementation time:

- `onMessage` in `src/main.ts` has exactly one command branch: `if (obj.command === 'testConnection')`.
  There is no `default`/fallthrough handling any other command.
- The only `sendTo` in `src/main.ts` is the reply *inside* `handleTestConnection` (`this.sendTo(obj.from,
  obj.command, response, obj.callback)`) — it answers the test-connection message and is not an independent
  consumer.
- The only `socket.sendTo(...)` in `src-admin` is the `testConnection` call in `Settings.tsx`
  `onTestConnection`.
- A repository-wide search for message machinery (`onMessage`, `this.on('message'`, `sendTo`, `sendToAsync`,
  `getMessage`, `handleMessage`) finds no other producer or consumer of adapter messages.

Implementation step: re-run those searches (`grep` for `onMessage`, `sendTo`, `sendToAsync`,
`"message"`/`'message'` event binding, and the string `testConnection`) across `src/`, `src-admin/`, and
`io-package.json`. Only if the sole remaining hits are the artifacts being removed may `onMessage`, the
`this.on('message', ...)` binding, and `"messagebox": true` be deleted. If any unrelated consumer is found,
keep the shared machinery and remove only the `testConnection` branch — then revisit this design.

### Changes Required

Assuming the audit confirms no other message consumer:

**File**: `src-admin/src/components/Settings.tsx`

**Specific Changes**:
1. **Remove the button block**: delete the `<Button>` (and the `<div>` that wraps only it and
   `renderTestStatus()`), including its `disabled={anyInvalid || testing || !socketAvailable}` and
   `onClick={() => void this.onTestConnection()}` wiring and the `{this.renderTestStatus()}` call. The
   `testing` and `socketAvailable` locals in `render()` become unused and are deleted.
2. **Remove methods**: delete `onTestConnection()` and `renderTestStatus()`.
3. **Remove types/state**: delete the `TestStatus` type, the `TestConnectionResponse` type, the
   `SettingsState` `testStatus` field (if `SettingsState` has no other members, remove it and change the
   component to `React.Component<SettingsProps>`), and the constructor's `this.state = { testStatus: ... }`
   (remove the constructor if it becomes empty).
4. **Remove props**: delete `socket`, `adapterName`, and `instance` from `SettingsProps`. Keep `native`,
   `onChange`, and `theme`/`IobTheme` (preserved — not test-connection-only). Update `App.tsx` to stop
   passing `socket`/`adapterName`/`instance` to `<Settings>` while continuing to pass `native`, `onChange`,
   and `theme`.
5. **Remove styles**: delete the `status`, `statusText`, `success`, and `failure` entries from `styles`.
   Keep `button` only if still referenced after the button block is removed; since the button is removed,
   delete `button` too.
6. **Prune imports**: remove `CircularProgress` and the `AdminConnection` type import. Keep `Typography`
   (used by the tables), `Button` only if still used elsewhere (it is not after step 1 — remove it), and
   `IobTheme` (kept for the preserved `theme` prop).

**File**: `src/main.ts`

**Specific Changes**:
1. **Remove `handleTestConnection()`** entirely.
2. **Remove `onMessage()`** entirely (its only branch was `testConnection`).
3. **Remove the binding** `this.on('message', this.onMessage.bind(this));` from the constructor.
4. **Prune imports**: remove `COMMON_BASE` (only `handleTestConnection` used it). Keep `validateConfig`,
   `ModbusClient`, `DEFAULT_TIMEOUT_MS`, `decodeRegisters`, `encodeFloat32le`, `encodeUint32le` — all still
   used by `onReady`/`pollOnce`/`handleStorEdgeControlChange`.

**File**: `io-package.json`

**Specific Changes**:
1. **Remove `"messagebox": true`** from the `common` block (only once the audit confirms no other consumer).

**Files**: `src-admin/src/i18n/*.json` (every locale file containing the keys)

**Specific Changes**:
1. **Remove the four keys** `Test Connection`, `Testing…`, `Connection successful`, `Connection failed` from
   each locale file. Note the requirements say "all 10 locales," but the repository currently has **11**
   locale files (`de, en, es, fr, it, nl, pl, pt, ru, uk, zh-cn`), and `uk.json` also contains the four
   keys. The removal MUST cover every file that actually contains the keys — all 11 — so no orphaned
   translation remains. (This 10-vs-11 discrepancy is noted for the parent agent to confirm.)

**File**: `README.md`

**Specific Changes**:
1. **Remove the paragraph** describing the Test connection button ("The settings page includes a **Test
   connection** button that verifies the adapter can reach the inverter and reads its manufacturer and model
   before you save."). Leave the surrounding configuration table and the StorEdge paragraph intact.

**File**: `src/lib/admin-settings-logic.test.ts`

**Specific Changes**:
1. **Remove the `describe('Test Connection button gating and request contract (Req 2.1)')` block** and its
   three cases.
2. **Remove the `testButtonDisabled` field** from `formDecision`'s return type and body (it exists only for
   those cases).
3. **Prune the header doc comment** references to the Test Connection button / `onTestConnection` /
   `sendTo('testConnection', ...)` so the file comment no longer describes removed behavior.
4. Keep the connection-form validation and value-table cases unchanged.

**File**: `src/lib/integration.test.ts`

**Specific Changes**:
1. **Remove the `probeTestConnection` helper** and the entire
   `describe('Feature: solaredge-sunspec-reader, integration: testConnection')` block (success/failure/
   validationError cases).
2. **Prune now-unused imports** that only the removed block used (e.g. `COMMON_BASE`), keeping any still
   referenced by the remaining StorEdge/timeout/reconnect tests. Verify via the compiler/linter after
   removal rather than assuming.

## Testing Strategy

### Validation Approach

This is a removal, so the two-phase pattern is adapted: first establish, on the UNFIXED code, that the
test-connection artifacts exist and that the preserved behaviors work; then verify, on the FIXED code, that
every artifact is gone (fix checking) and every preserved behavior is byte-for-byte unchanged (preservation
checking). The compiler, linter, and existing non-test-connection suites are the primary oracles.

### Exploratory Bug Condition Checking

**Goal**: Surface, on the UNFIXED code, concrete evidence of each artifact so the removal list is complete
and nothing is missed. Confirm or refute the root-cause inventory (which files/members hold the surface). If
an unexpected additional consumer of the message box is found, refute and re-hypothesize before deleting the
shared machinery.

**Test Plan**: Grep/inspect the tree for every artifact and for message machinery, and run the current build
and test suite to capture the green baseline that must stay green.

**Test Cases**:
1. **UI inventory**: Confirm `Settings.tsx` contains the button, `onTestConnection`, `renderTestStatus`,
   `TestStatus`, `TestConnectionResponse`, the four status styles, and the `socket`/`adapterName`/`instance`
   props (expected present on unfixed code).
2. **Backend inventory**: Confirm `onMessage`, the `testConnection` branch, `handleTestConnection`, the
   `message` binding, and the `COMMON_BASE` usage exist (expected present on unfixed code).
3. **Message-consumer audit**: Confirm `testConnection` is the *only* command and no other `sendTo`/
   `onMessage` consumer exists (expected: audit passes, so the shared machinery is safe to remove).
4. **Satellite inventory**: Confirm the four i18n keys exist in all locale files, the README paragraph
   exists, and the named test cases exist (expected present on unfixed code).

**Expected Counterexamples (evidence of the bug)**:
- The button and status area render in the admin UI; `"messagebox": true` is advertised with a bound
  `message` handler whose sole command is being removed.
- Possible surprise: a second message consumer could exist — the audit guards against wrongly deleting
  `onMessage`/the binding/`messagebox` if so.

### Fix Checking

**Goal**: Verify that for every artifact where the bug condition holds, the fixed codebase no longer
contains it and the dependent behavior is absent.

**Pseudocode:**
```
FOR ALL artifact WHERE isBugCondition(artifact) DO
  ASSERT NOT exists(artifact)            // grep finds no reference
END FOR
ASSERT adminPage renders no "Test Connection" button or status area
ASSERT io-package.json has no "messagebox": true
ASSERT instance binds no 'message' handler and defines no onMessage
ASSERT project type-checks, builds, lints, and tests pass
```

**Test Plan**: After removal, run the TypeScript build for both `src/` and `src-admin/`, run ESLint, and run
the mocha/ts-node suite. Grep for `testConnection`, `Test Connection`, `onMessage`, `messagebox`,
`CircularProgress`, `COMMON_BASE`, and the four i18n keys and confirm only intentional absences remain
(zero hits in `src/`, `src-admin/`, `io-package.json`, `README.md`, and the two test files, aside from any
unrelated legitimate use the audit identified).

### Preservation Checking

**Goal**: Verify that for all artifacts where the bug condition does NOT hold, the fixed codebase behaves
and resolves identically to the original.

**Pseudocode:**
```
FOR ALL artifact WHERE NOT isBugCondition(artifact) DO
  ASSERT behavior_fixed(artifact) == behavior_original(artifact)
END FOR
```

**Testing Approach**: Property-based testing fits the field-validation surface well because it exercises many
generated configs across the input domain and catches edge cases a few examples would miss. The remaining
preserved behaviors (table rendering from static maps, config save, start-time polling) are covered by the
existing deterministic unit/integration suites, which must stay green with no edits beyond deleting the
test-connection cases.

**Test Plan**: Observe, on UNFIXED code, that field validation, the value/StorEdge tables, config save, and
start-time polling behave a certain way; then confirm the FIXED code's retained tests (and a diff of the
non-removed i18n keys) produce identical results.

**Test Cases**:
1. **Field validation preservation**: The retained validation-gating cases in
   `admin-settings-logic.test.ts` pass unchanged (host/port/unitId/pollInterval error flags and `anyInvalid`).
2. **Value-table preservation**: The retained SunSpec/battery value-table backing-data cases pass unchanged.
3. **Start-time polling preservation**: The retained integration tests (timeout/reconnect/retention,
   StorEdge read/write, info.connection) pass unchanged.
4. **i18n preservation**: Every non-test-connection key in all locale files is byte-for-byte unchanged; only
   the four target keys are removed (verify with a per-file diff).

### Unit Tests

- Retained `admin-settings-logic.test.ts` field-validation and value-table cases (test-connection button
  cases and the `testButtonDisabled` helper member removed).
- A grep-based/compiler check that the removed symbols (`onTestConnection`, `renderTestStatus`,
  `handleTestConnection`, `onMessage`, `TestConnectionResponse`, the four styles, the four i18n keys) have no
  remaining references.

### Property-Based Tests

- Generate random valid/invalid configs and assert the retained field-validation gate (`validateConfig` →
  per-field error flags) is unchanged by the removal — exercising preservation of the field behavior across
  the input domain.
- Generate random non-test-connection i18n lookups and assert each resolves exactly as before.

### Integration Tests

- Retained `integration.test.ts` suites: timeout/reconnect/retention, StorEdge control block
  read/write/ack, and `info.connection` behavior — all pass unchanged after the `probeTestConnection` block
  is removed, demonstrating the adapter's own start-time connection handling is untouched.
- Full admin build (`src-admin`) compiles and the settings page renders the four fields, the SunSpec tables,
  and the StorEdge table with no Test Connection button or status area.
