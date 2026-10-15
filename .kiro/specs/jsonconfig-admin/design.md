# Design: Migrate Admin UI to jsonConfig

## Overview

Replace the custom React/TypeScript instance-configuration UI (built from `src-admin/` with Vite + MUI + `@iobroker/gui-components`, served via `adminUI.config: "html"`) with a declarative ioBroker **jsonConfig** dialog (`admin/jsonConfig.json`, served via `adminUI.config: "json"`).

The adapter backend is unchanged: it still reads `native.host`, `native.port`, `native.unitId`, `native.pollInterval` and validates them on start via `validateConfig` in `src/lib/config-validation.ts`. Only the configuration *UI* and its build/test plumbing change.

The jsonConfig is structured as `type: "tabs"` with one panel so future fields/modes/tabs can be added without restructuring (Requirement 5). The `src-admin/` project and all its build/lint/test wiring are removed (Requirement 6).

### Goals

- Declarative config dialog for the four existing fields, with defaults, bounds, and 11-language labels preserved.
- Remove the React/Vite admin toolchain and artifacts.
- Keep `npm run build`, `lint`, `check`, and `test` green.

### Non-goals

- No new fields, modes, tabs, or `type: "custom"` components (Requirement 5.4 — extensibility is structural only).
- No change to adapter runtime behavior or `validateConfig`.

## Architecture

### Before

```
io-package.json: adminUI.config = "html"
          │
          ▼
admin/index.html + admin/assets/*  ◄── built by tasks.js ◄── src-admin/ (Vite+React+TS)
          │                                                        └── src/components/Settings.tsx → imports validateConfig
          ▼
ioBroker admin renders the React app
```

### After

```
io-package.json: adminUI.config = "json"
          │
          ▼
admin/jsonConfig.json  +  admin/i18n/<lang>.json
          │
          ▼
ioBroker admin renders the dialog declaratively (no build step for the UI)
```

The admin UI no longer has a build step. `admin/jsonConfig.json` and `admin/i18n/*.json` are hand-maintained, committed source files shipped directly in the package.

## Components and Interfaces

### 1. `admin/jsonConfig.json` (new)

Root is `type: "tabs"` with a single panel `_main` holding the four fields in order. Numeric bounds mirror `CONFIG_BOUNDS`:

```json
{
    "i18n": true,
    "type": "tabs",
    "items": {
        "_main": {
            "type": "panel",
            "label": "Main settings",
            "items": {
                "host": {
                    "type": "text",
                    "label": "Host",
                    "trim": true,
                    "maxLength": 253,
                    "validator": "!!data.host && data.host.length <= 253",
                    "validatorErrorText": "Invalid host",
                    "validatorNoSaveOnError": true,
                    "xs": 12, "sm": 12, "md": 6, "lg": 4
                },
                "port": {
                    "newLine": true,
                    "type": "number",
                    "label": "Port",
                    "min": 1,
                    "max": 65535,
                    "validator": "Number.isInteger(data.port) && data.port >= 1 && data.port <= 65535",
                    "validatorErrorText": "Invalid port",
                    "validatorNoSaveOnError": true,
                    "xs": 12, "sm": 6, "md": 3, "lg": 2
                },
                "unitId": {
                    "newLine": true,
                    "type": "number",
                    "label": "Unit ID",
                    "min": 0,
                    "max": 247,
                    "validator": "Number.isInteger(data.unitId) && data.unitId >= 0 && data.unitId <= 247",
                    "validatorErrorText": "Invalid unit ID",
                    "validatorNoSaveOnError": true,
                    "xs": 12, "sm": 6, "md": 3, "lg": 2
                },
                "pollInterval": {
                    "newLine": true,
                    "type": "number",
                    "label": "Polling interval (s)",
                    "min": 5,
                    "max": 3600,
                    "help": "s",
                    "validator": "Number.isInteger(data.pollInterval) && data.pollInterval >= 5 && data.pollInterval <= 3600",
                    "validatorErrorText": "Invalid polling interval",
                    "validatorNoSaveOnError": true,
                    "xs": 12, "sm": 6, "md": 3, "lg": 2
                }
            }
        }
    }
}
```

Notes:
- `"i18n": true` tells admin to load translations from `admin/i18n/<lang>.json` and translate `label`/`help` keys (Requirement 4.3), matching the ioBroker.ping reference.
- Each numeric field (`port`, `unitId`, `pollInterval`) uses `type: "number"` with `min`/`max` for the slider/stepper bounds **and** an explicit `validator` + `validatorErrorText` + `validatorNoSaveOnError: true`. The validators mirror `CONFIG_BOUNDS` and additionally enforce integer-ness via `Number.isInteger(...)` (which `min`/`max` alone do not), matching `validateConfig`'s `Number.isInteger` checks (Requirements 2.4, 3.1–3.3, 3.5). `unitId` is the Modbus unit/client identifier (0..247). Values are stored as numbers.
- `host` uses `type: "text"` with `maxLength: 253` plus a declarative `validator` (`!!data.host && data.host.length <= 253`), `validatorErrorText: "Invalid host"`, and `validatorNoSaveOnError: true`. Per the jsonConfig docs, `validator` is a JS function (`true` = no error, `false` = error) evaluated against `data.<attr>`; `validatorErrorText` is the (translatable) message; `validatorNoSaveOnError` disables Save while invalid. This gives the user an in-dialog required/length indicator (Requirement 3.4). Adapter-start `validateConfig` remains the guaranteed enforcement regardless of admin version (Requirement 3.6; see Design Decisions D3).
- Field keys (`host`, `port`, `unitId`, `pollInterval`) map 1:1 to `native.*`, so persistence is unchanged (Requirement 2.3).

### 2. `admin/i18n/<lang>.json` (new, 11 files)

One file per language: `en, de, ru, pt, nl, fr, it, es, pl, uk, zh-cn`. Keys are the English label strings used in `jsonConfig.json`. The current `src-admin/src/i18n/*.json` files already contain these exact values; they are copied/transformed into `admin/i18n/`. Every field has a `validator` with a translatable `validatorErrorText`, so all of the existing i18n keys are referenced and retained: `Main settings` (new), `Host`, `Port`, `Unit ID`, `Polling interval (s)` (labels), and `Invalid host`, `Invalid port`, `Invalid unit ID`, `Invalid polling interval` (validator error texts). These `Invalid *` strings already exist verbatim in the current `src-admin/src/i18n/*.json` files and carry over unchanged.

`en.json`:
```json
{
    "Main settings": "Main settings",
    "Host": "Host",
    "Port": "Port",
    "Unit ID": "Unit ID",
    "Polling interval (s)": "Polling interval (s)",
    "Invalid host": "Invalid host",
    "Invalid port": "Invalid port",
    "Invalid unit ID": "Invalid unit ID",
    "Invalid polling interval": "Invalid polling interval"
}
```

Label translations to carry over (from the existing i18n files; `Main settings` is new and needs translating via `npm run translate` or manual values):

| key                   | de                   | ru                    | pt                        | nl                 | fr                              | it                        | es                       | pl                        | uk                      | zh-cn            |
| --------------------- | -------------------- | --------------------- | ------------------------- | ------------------ | ------------------------------- | ------------------------- | ------------------------ | ------------------------- | ----------------------- | ---------------- |
| Host                  | Host                 | Хост                  | Host                      | Host               | Host                            | Host                      | Host                     | Host                      | Хост                    | 主机             |
| Port                  | Port                 | Порт                  | Porta                     | Poort              | Port                            | Porta                     | Puerto                   | Port                      | Порт                    | 端口             |
| Unit ID               | Geräte-ID            | ID устройства         | ID da unidade             | Unit-ID            | ID d'unité                      | ID unità                  | ID de unidad             | ID jednostki              | ID пристрою             | 单元 ID          |
| Polling interval (s)  | Abfrageintervall (s) | Интервал опроса (с)   | Intervalo de sondagem (s) | Pollinginterval (s)| Intervalle d'interrogation (s)  | Intervallo di polling (s) | Intervalo de sondeo (s)  | Interwał odpytywania (s)  | Інтервал опитування (с) | 轮询间隔（秒）   |
| Invalid host          | Ungültiger Host      | Недопустимый хост     | Host inválido             | Ongeldige host     | Hôte invalide                   | Host non valido           | Host no válido           | Nieprawidłowy host        | Недійсний хост          | 无效的主机       |
| Invalid port          | Ungültiger Port      | Недопустимый порт     | Porta inválida            | Ongeldige poort    | Port invalide                   | Porta non valida          | Puerto no válido         | Nieprawidłowy port        | Недійсний порт          | 无效的端口       |
| Invalid unit ID       | Ungültige Geräte-ID  | Недопустимый ID устройства | ID da unidade inválido | Ongeldige unit-ID  | ID d'unité invalide             | ID unità non valido       | ID de unidad no válido   | Nieprawidłowy ID jednostki| Недійсний ID пристрою   | 无效的单元 ID    |
| Invalid polling interval | Ungültiges Abfrageintervall | Недопустимый интервал опроса | Intervalo de sondagem inválido | Ongeldig pollinginterval | Intervalle d'interrogation invalide | Intervallo di polling non valido | Intervalo de sondeo no válido | Nieprawidłowy interwał odpytywania | Недійсний інтервал опитування | 无效的轮询间隔 |

`Main settings` has no existing translation; it will be generated with `npm run translate` (which uses `admin/i18n/en.json` as the source) or filled in manually. Missing translations fall back to English automatically (Requirement 4.4).

### 3. `io-package.json` (modified)

- `common.adminUI.config`: `"html"` → `"json"` (Requirement 1.2).
- `native` defaults unchanged: `host: ""`, `port: 502`, `unitId: 1`, `pollInterval: 30` (Requirement 2.1, 2.2, 2.5). These already match and need no edit, but are verified by tests.
- Add a `news` entry for the new version describing the jsonConfig switch (Requirement 8.1).

### 4. `package.json` (modified)

Remove all admin-UI build wiring (Requirement 6.3, 6.4):

| Current script     | Action                                                                    |
| ------------------ | ------------------------------------------------------------------------- |
| `prebuild:react`   | remove                                                                    |
| `build:react`      | remove                                                                    |
| `prebuild`         | change to `rimraf build` (drop `admin/assets admin/index.html src-admin/build`) |
| `build`            | change to `npm run build:ts` (drop `&& npm run build:react`)              |
| `check`            | change to `tsc --noEmit` (drop `&& tsc --noEmit -p src-admin/tsconfig.json`) |
| `lint`             | change to `eslint -c eslint.config.mjs .` (drop `&& npm run lint --prefix src-admin`) |

- `files` array: already uses patterns that include `admin/**` json/html/css/png and `admin/assets/`. After migration it must ship `admin/jsonConfig.json` and `admin/i18n/*.json`. The existing patterns `admin{,/!(src)/**}/!(tsconfig|tsconfig.*|.eslintrc).{json,json5}` cover `admin/jsonConfig.json` and `admin/i18n/*.json`. The `admin/assets/` line and `admin/*.{html,...}` patterns become dead (no such files) but are harmless; `admin/assets/` line can be removed for cleanliness. The `files` array already lists no `src-admin` entry, so Requirement 6.5 and the `postinstall-preservation` test remain satisfied. (Requirement 6.5)

### 5. Deletions (Requirement 6.1, 6.2, 6.6, 6.7)

- `src-admin/` — entire directory (React/TS sources, its `package.json`, `tsconfig.json`, `vite.config.ts`, `eslint.config.mjs`, `node_modules`, `build`, `README.md`).
- `admin/index.html` — generated React entry (replaced by jsonConfig; no `index.html` needed).
- `admin/assets/` — generated React bundle.
- `admin/style.css` — generic materialize-era leftover, not referenced by jsonConfig.
- `tasks.js` — exists solely to build/copy the React admin; remove it.
- Retain: `admin/sehybrid.png` (icon), and add `admin/jsonConfig.json` + `admin/i18n/`.

### 6. `eslint.config.mjs` (modified)

Remove now-obsolete ignore entries that reference removed paths: `src-admin/**`, `tasks.js`, `admin/assets/**`, `admin/index.html`, `admin/words.js`, `admin/admin.d.ts`, `admin/blockly.js` (the latter three never existed here). Keep ignores for `.dev-server/`, `build`, `docs/`, test globs, etc. This satisfies Requirement 7.2 (lint no longer targets a removed `src-admin`).

### 7. `README_dev.md` (modified) (Requirement 8.2, 8.3)

Rewrite the "Admin UI" sections: the admin UI is now a declarative `admin/jsonConfig.json` + `admin/i18n/` (no Vite/React/TS build, no `tasks.js`, no `build:react`, no `src-admin`). Update the npm-scripts table (remove `build:react`), the "Compilation config" section, and the dev-server notes (the admin UI needs only an `iob upload sehybrid` / `dev-server:upload` to push `jsonConfig.json`, no rebuild).

## Test Impact

This is the sharp edge of the migration. Several existing tests assert the *current* React/HTML state and will fail after the change. They must be updated or removed as part of this feature. Tests are grouped by the npm script that runs them.

### Tests run by `test:package` (must stay green)

`test:package` = `mocha test/package test/postinstall.test.js test/postinstall-preservation.test.js test/readme-register-reference.preservation.test.js test/readme-sync.test.js test/settings-cleanup.test.js --exit`

| Test file | Current assertion | Impact | Action |
| --- | --- | --- | --- |
| `test/package.js` | `@iobroker/testing` package validation | `adminUI.config: "json"` requires `admin/jsonConfig.json` to exist | Keep; passes once `admin/jsonConfig.json` exists (Requirement 7.4) |
| `test/postinstall.test.js` | No install-time npm against `src-admin` | Still true (nothing installs src-admin) | Keep; passes |
| `test/postinstall-preservation.test.js` | `files` ships no `src-admin`; models `tasks.js installNpmLocal` | `files` still excludes src-admin ✓, but the `installNpmLocal()` source-pin test reads `tasks.js` which is deleted | Remove the `installNpmLocal()` describe block (or the whole file if it only covers src-admin build plumbing). Keep the `files`-allowlist block. |
| `test/readme-register-reference.preservation.test.js` | README register tables synced | README unaffected by this change | Keep; passes |
| `test/readme-sync.test.js` | README sync | unaffected | Keep; passes |
| `test/settings-cleanup.test.js` | Reads `src-admin/src/components/Settings.tsx` as text, asserts it renders only 4 fields | File is deleted | **Remove** this file — it asserts the internals of a component that no longer exists. The four-field guarantee moves to `jsonConfig.json` (a new assertion, below). |

### Tests NOT run by any configured script (dead tests)

These are not referenced by `test:ts`, `test:package`, or `test:integration` globs, so they do not run in CI as configured. They still reference `src-admin` paths and would fail if run. To avoid leaving broken references:

| Test file | Action |
| --- | --- |
| `test/readme-register-reference.explore.test.js` | Reads `src-admin/.../Settings.tsx`. **Remove** (bug-exploration test for a prior spec; obsolete). |
| `test/review-fixes-remove-admin-tab.test.js` | Asserts `src-admin/src/i18n`, `Tab.tsx` absence, etc. **Remove** (prior-spec admin-tab cleanup; obsolete). |
| `test/review-fixes-remove-admin-tab.preservation.test.js` | Asserts `adminUI.config == "html"`, `admin/index.html` present, `App.tsx`/`Settings.tsx` exist. **Remove** (directly contradicts the new state). |

Rationale for removal rather than rewrite: these three files and `settings-cleanup.test.js` encode the behavior of the old React admin (prior bugfix specs: "modbus-register-reference-to-readme", "remove-admin-tab"). Once the React admin is gone, they test nothing meaningful. Removing them is the correct migration, not a shortcut.

### New assertion to add

Add a small package-tier test (e.g. `test/jsonconfig.test.js`, included in the `test:package` mocha glob) that pins the new contract (Requirements 1, 2, 3.5):

- `io-package.json` `common.adminUI.config === "json"`.
- `admin/jsonConfig.json` exists and parses as JSON.
- It is `type: "tabs"` with a `_main` panel containing exactly the four field keys `host`, `port`, `unitId`, `pollInterval` in that order.
- `port.min===1/max===65535`, `unitId.min===0/max===247`, `pollInterval.min===5/max===3600` (matching `CONFIG_BOUNDS`).
- Every field has a non-empty `validator` and the expected `validatorErrorText`: `host → "Invalid host"`, `port → "Invalid port"`, `unitId → "Invalid unit ID"`, `pollInterval → "Invalid polling interval"`.
- `admin/i18n/en.json` exists and contains all referenced keys (the four labels, `Main settings`, and the four `Invalid *` error texts).
- `io-package.json` `native` defaults: `port===502`, `unitId===1`, `pollInterval===30`, `host===""`.

`test:package`'s glob must be updated to add `test/jsonconfig.test.js` and drop `test/settings-cleanup.test.js`.

## Data Models

No data model changes. The persisted `native` shape is identical:

```ts
interface AdapterConfig {
    host: string;        // default ""
    port: number;        // default 502,  bounds 1..65535
    unitId: number;      // default 1,    bounds 0..247
    pollInterval: number;// default 30,   bounds 5..3600 (seconds)
}
```

`validateConfig` and `CONFIG_BOUNDS` in `src/lib/config-validation.ts` are unchanged and remain the authoritative start-time validation (Requirement 3.6, 7.5).

## Design Decisions

### D1. jsonConfig `type: "tabs"` + single panel vs. flat `type: "panel"`

Chosen: `type: "tabs"` with one `_main` panel. A flat panel would be marginally simpler for four fields, but tabs make adding a second tab (e.g. "Battery", "Advanced", "Storage Control modes") a pure addition with no restructuring (Requirement 5.1). Cost is negligible. This matches the ioBroker.ping reference.

### D2. i18n via `admin/i18n/` folder (`"i18n": true`) vs. inline label objects

Chosen: external `admin/i18n/<lang>.json` with `"i18n": true`. Inline per-language objects in `jsonConfig.json` would keep everything in one file, but the adapter already has translations as 11 separate JSON files that map directly to this layout, `npm run translate` is wired to manage i18n folders, and it matches the official ping example (Requirement 4.3). Keeps `jsonConfig.json` readable.

### D3. Host required/empty validation — declarative validator + start-time guarantee

The jsonConfig schema documents a `validator` mechanism ([jsonConfig README](https://github.com/ioBroker/ioBroker.admin/tree/master/packages/jsonConfig)):
- `validator` — JS function, `true` = no error, `false` = error, evaluated with `data` (the instance `native`) in scope.
- `validatorErrorText` — message shown when the validator returns `false` (translated via i18n).
- `validatorNoSaveOnError` — disables the Save button while the error is present.

Chosen: use **both** mechanisms for **every** field, with a clear division of responsibility:
- **In-dialog (declarative):** all four fields carry a `validator`, a translatable `validatorErrorText`, and `validatorNoSaveOnError: true`, so the Save button is blocked on any invalid field and the per-field error text appears:
  - `host`: `!!data.host && data.host.length <= 253` → `Invalid host`
  - `port`: `Number.isInteger(data.port) && data.port >= 1 && data.port <= 65535` → `Invalid port`
  - `unitId` (Modbus unit/client id): `Number.isInteger(data.unitId) && data.unitId >= 0 && data.unitId <= 247` → `Invalid unit ID`
  - `pollInterval`: `Number.isInteger(data.pollInterval) && data.pollInterval >= 5 && data.pollInterval <= 3600` → `Invalid polling interval`

  The numeric fields keep `min`/`max` as well (for the stepper UI), but the `validator` is what enforces integer-ness and blocks Save — mirroring `validateConfig`'s `Number.isInteger` + range checks exactly (Requirement 3.1–3.5).
- **Start-time (guaranteed):** `validateConfig` in `src/lib/config-validation.ts` remains the authoritative enforcement (Requirement 3.6). It is unchanged and independent of admin version, so even on an older admin that ignores `validator`, an invalid config is still rejected when the adapter starts.

The validator expressions deliberately mirror `CONFIG_BOUNDS` field-for-field. During implementation this is verified against the running admin (dev-server) to confirm Save disables on each invalid field and the translated error appears. If a specific admin build mishandles `validator`, the start-time check still guarantees correctness, so this is not a correctness risk — only a UX one.

### D4. Remove obsolete tests vs. rewrite them

Chosen: remove the four tests tied to the old React admin (`settings-cleanup`, `readme-register-reference.explore`, `review-fixes-remove-admin-tab`, `review-fixes-remove-admin-tab.preservation`) and the `tasks.js`-modeling block in `postinstall-preservation`, and add one new `jsonconfig.test.js`. Rewriting source-text assertions about deleted `.tsx` files would be meaningless. The new test pins the new contract instead.

### D5. Keep `admin/sehybrid.png`

The icon is referenced by `common.icon` and `extIcon` in `io-package.json` and is independent of the UI technology. Retained.

## Verification Strategy

1. **Build**: `npm run build` runs only `build:ts`; completes without referencing `src-admin` (Requirement 7.1, 6.4).
2. **Lint**: `npm run lint` runs root eslint only; no `src-admin` prefix lint (Requirement 7.2).
3. **Check**: `npm run check` runs `tsc --noEmit` for the backend only.
4. **Unit tests**: `npm run test:ts` — unaffected (backend logic), must stay green.
5. **Package tests**: `npm run test:package` with the updated glob — new `jsonconfig.test.js` green, removed tests gone, `test/package.js` validates the `json` admin config (Requirement 7.3, 7.4).
6. **Integration**: `npm run test:integration` — adapter starts and reads the four native values (Requirement 7.5).
7. **Manual/dev-server**: `npm run dev-server:upload` then open the instance settings in admin at http://localhost:8081; confirm the four fields render, labels are localized (switch admin language), defaults are pre-filled for a new instance, numeric bounds reject out-of-range input, each field's `validator` disables Save and shows its translated error on invalid input (empty/overlong host → `Invalid host`; non-integer or out-of-range `port`/`unitId`/`pollInterval` → the matching `Invalid *` text), and saving persists numbers into `native` (Requirements 1.3, 1.4, 2.*, 3.*, 4.*). Verify the `type: "custom"`/`hidden` extensibility notes only in docs — no such component is added (Requirement 5.4).

## Rollout / Branch

All work on the `feature/jsonConfig` branch. Single logical change set: add jsonConfig + i18n, flip `adminUI.config`, remove React toolchain, fix build/lint/test wiring, update docs and changelog.
