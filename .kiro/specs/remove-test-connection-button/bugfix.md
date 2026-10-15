# Bugfix Requirements Document

## Introduction

The adapter admin configuration page (the React settings UI in `src-admin/src/components/Settings.tsx`)
renders a **Test Connection** button. When clicked, it sends a `testConnection` message to the running
instance, which is handled in `src/main.ts` by `onMessage` → `handleTestConnection`. The handler opens a
temporary Modbus connection, probes the SunSpec identity block, and replies with the inverter's
manufacturer and model.

This test-connection path is redundant. When the adapter starts it already establishes its own Modbus
connection, performs validation, reports reachability through `info.connection`, and logs connection
errors with its own error handling. The separate manual probe duplicates that logic and adds UI,
backend, i18n, and documentation surface that must be maintained.

This change removes the Test Connection button and all code, translations, and documentation that exist
only to support it, while leaving the rest of the settings page (field editing, validation, the SunSpec
value tables, and the StorEdge control block table) and the adapter's own start-time connection handling
untouched.

The removal scope (all parts that exist solely to serve the test-connection feature):

- **Admin UI** — `src-admin/src/components/Settings.tsx`: the `Test Connection` `<Button>`, its
  `onClick`/`disabled` wiring, `onTestConnection()`, `renderTestStatus()`, the `TestStatus` state type and
  `testStatus` component state, the `TestConnectionResponse` type, the status-only styles
  (`status`, `statusText`, `success`, `failure`), and the `socket` / `adapterName` / `instance` props that
  are used only for the `sendTo('testConnection', ...)` call.
- **Backend** — `src/main.ts`: `handleTestConnection()`, the `testConnection` branch in `onMessage()`,
  and — since `testConnection` is the only command handled — the `onMessage` method itself and its
  `this.on('message', ...)` binding; and `io-package.json` `"messagebox": true` if no other message
  consumer remains.
- **i18n** — `src-admin/src/i18n/*.json` (all 10 locales): the `Test Connection`, `Testing…`,
  `Connection successful`, and `Connection failed` keys.
- **Documentation** — `README.md`: the paragraph describing the Test connection button.
- **Tests** — references to the test-connection button and `testConnection` probe in
  `src/lib/admin-settings-logic.test.ts` and `src/lib/integration.test.ts`.

## Bug Analysis

### Current Behavior (Defect)

The admin settings page exposes a redundant Test Connection feature backed by a dedicated message handler.

1.1 WHEN the admin instance settings page is opened THEN the system renders a "Test Connection" button and its supporting status area.

1.2 WHEN the user clicks the "Test Connection" button THEN the system sends a `testConnection` message to the instance, which opens a separate temporary Modbus connection and probes the SunSpec identity block — duplicating the connection logic the adapter already runs at start-up.

1.3 WHEN the admin UI loads THEN the system includes code, i18n strings, documentation, and tests that exist solely to support the Test Connection feature (`onTestConnection`, `renderTestStatus`, the `testConnection` message handler, the `Test Connection` / `Testing…` / `Connection successful` / `Connection failed` translations, the README paragraph, and the related test cases).

### Expected Behavior (Correct)

2.1 WHEN the admin instance settings page is opened THEN the system SHALL NOT render a "Test Connection" button or any connection-test status area.

2.2 WHEN the admin settings page is in use THEN the system SHALL rely on the adapter's own start-time connection logic and `info.connection` state for connection feedback, with no separate manual probe available.

2.3 WHEN the Test Connection feature is removed THEN the system SHALL also remove all code, i18n strings, documentation, and tests that exist solely to support it, including the `testConnection` message handler in `src/main.ts`, the test-connection UI members in `Settings.tsx`, the four test-connection i18n keys across all locale files, the README paragraph, and the related test cases — and SHALL remove `onMessage` / the `message` event binding / `"messagebox": true` only if no other message consumer remains.

### Unchanged Behavior (Regression Prevention)

3.1 WHEN the admin settings page is opened THEN the system SHALL CONTINUE TO render the Host, Port, Unit ID, and Polling interval fields with their existing validation and inline error messages.

3.2 WHEN the admin settings page is opened THEN the system SHALL CONTINUE TO render the SunSpec Values tables (Inverter, Meter, Battery) and the StorEdge Control Block table unchanged.

3.3 WHEN the admin settings are saved THEN the system SHALL CONTINUE TO persist the configuration using the existing save behavior, unaffected by the removal.

3.4 WHEN the adapter starts THEN the system SHALL CONTINUE TO establish its own Modbus connection, perform configuration validation, poll the inverter, and report connection status via `info.connection` with its existing error handling.

3.5 WHEN any non-test-connection i18n string, style, or Settings member is referenced THEN the system SHALL CONTINUE TO resolve it exactly as before, since only test-connection-specific entries are removed.
