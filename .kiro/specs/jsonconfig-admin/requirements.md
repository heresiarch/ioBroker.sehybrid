# Requirements: Migrate Admin UI to jsonConfig

## Introduction

The `sehybrid` adapter currently ships a custom React/TypeScript admin configuration UI, built from `src-admin/` with Vite, MUI, and `@iobroker/gui-components`, and loaded via `adminUI.config: "html"`. The UI only collects four native properties (`host`, `port`, `unitId`, `pollInterval`). A full React build chain is disproportionate overhead for four fields.

This feature replaces the custom React admin UI with the ioBroker **jsonConfig** declarative configuration format (`admin/jsonConfig.json`, loaded via `adminUI.config: "json"`), the modern recommended approach for ioBroker adapter settings. jsonConfig is a declarative schema that the ioBroker admin renders directly — no React application is written or built. The migration must preserve the existing fields, their defaults, their validation bounds, and their translations, while removing the React build toolchain and its artifacts from the repository and the npm package.

jsonConfig is not limited to simple field lists: it supports multiple tabs/panels, a wide range of field types (text, number, checkbox, select, slider, table, ip/port pickers, encrypted password, `sendTo` actions, etc.), conditional `hidden`/`disabled` expressions for modes, and a `type: "custom"` escape hatch that embeds a bespoke React component when needed. The structure chosen here must therefore leave the door open for future fields, modes, and tabs without a rewrite.

Reference examples verified to use jsonConfig: [ioBroker.ping](https://github.com/ioBroker/ioBroker.ping) (`adminUI.config: "json"` + `admin/jsonConfig.json`, `type: "tabs"`, number fields with `min`, `i18n: true`), [ioBroker.esphome](https://github.com/Drozmotix/ioBroker.esphome). Schema reference: [ioBroker jsonConfig](https://github.com/ioBroker/ioBroker.admin/tree/master/packages/jsonConfig).

### Current configuration (to preserve)

| Field          | Type   | Default | Bounds (inclusive)        |
| -------------- | ------ | ------- | ------------------------- |
| `host`         | string | `""`    | length 1–253 characters   |
| `port`         | number | `502`   | integer 1–65535           |
| `unitId`       | number | `1`     | integer 0–247             |
| `pollInterval` | number | `30`    | integer 5–3600 (seconds)  |

Validation bounds are defined in `src/lib/config-validation.ts` (`CONFIG_BOUNDS`) and are the source of truth. The adapter still validates config on start via `validateConfig`; that behavior is unchanged by this feature.

## Requirements

### Requirement 1: jsonConfig replaces the HTML/React admin UI

**User Story:** As an adapter maintainer, I want the instance configuration dialog defined declaratively in `admin/jsonConfig.json`, so that I no longer maintain a React application for four input fields.

#### Acceptance Criteria

1. WHEN the adapter is installed THEN the system SHALL load the instance configuration dialog from `admin/jsonConfig.json`.
2. WHEN `io-package.json` is read THEN `common.adminUI.config` SHALL be `"json"` (no longer `"html"`).
3. WHEN the instance settings dialog is opened in ioBroker admin THEN it SHALL present input fields for `host`, `port`, `unitId`, and `pollInterval`, and SHALL NOT present any other configurable field.
4. WHEN the dialog is rendered THEN the fields SHALL appear in the order: `host`, `port`, `unitId`, `pollInterval`.
5. WHERE the jsonConfig file declares a schema version or top-level type THE system SHALL use a structure supported by the admin version declared in `globalDependencies` (`admin >= 7.8.23`).

### Requirement 2: Field defaults and persisted values

**User Story:** As a user configuring the adapter, I want sensible default values pre-filled, so that I only need to change the host in the common case.

#### Acceptance Criteria

1. WHEN a new instance is created THEN `port` SHALL default to `502`, `unitId` SHALL default to `1`, and `pollInterval` SHALL default to `30`.
2. WHEN a new instance is created THEN `host` SHALL default to an empty string.
3. WHEN the user saves the dialog THEN the values SHALL be persisted into `native.host`, `native.port`, `native.unitId`, and `native.pollInterval` with the same names and value types the adapter already reads.
4. WHEN numeric fields (`port`, `unitId`, `pollInterval`) are saved THEN they SHALL be stored as numbers, not strings.
5. WHEN the `native` defaults in `io-package.json` are read THEN they SHALL remain consistent with the jsonConfig defaults.

### Requirement 3: Input validation in the dialog

**User Story:** As a user, I want the dialog to reject out-of-range values before I save, so that I don't start the adapter with an invalid configuration.

#### Acceptance Criteria

1. WHEN the user enters a `port` outside 1–65535 THEN the dialog SHALL indicate the value is invalid.
2. WHEN the user enters a `unitId` outside 0–247 THEN the dialog SHALL indicate the value is invalid.
3. WHEN the user enters a `pollInterval` outside 5–3600 THEN the dialog SHALL indicate the value is invalid.
4. WHEN the user leaves `host` empty THEN the dialog SHALL indicate `host` is required.
5. WHERE jsonConfig supports declarative numeric bounds (`min`/`max`) THE validation bounds SHALL match `CONFIG_BOUNDS` in `src/lib/config-validation.ts` exactly (port 1–65535, unitId 0–247, pollInterval 5–3600).
6. WHEN jsonConfig cannot express a bound declaratively THEN the adapter's start-time `validateConfig` SHALL remain the enforcement mechanism, and the dialog SHALL at minimum constrain the field type and the bounds it can express.

### Requirement 4: Translations preserved

**User Story:** As a non-English user, I want the configuration dialog labels in my language, so that the migration does not regress localization.

#### Acceptance Criteria

1. WHEN the dialog is displayed THEN each field label SHALL be localized for all languages currently supported by the admin: en, de, ru, pt, nl, fr, it, es, pl, uk, zh-cn.
2. WHEN labels are defined THEN they SHALL reuse the existing translation strings (e.g. `Host`, `Port`, `Unit ID` → `Geräte-ID`, `Polling interval (s)` → `Abfrageintervall (s)`) where equivalent fields exist.
3. WHEN translations are provided THEN they SHALL use the jsonConfig `i18n` mechanism with per-language files under `admin/i18n/<lang>.json` (top-level `"i18n": true` in `jsonConfig.json`), consistent with the ioBroker.ping reference and the admin version in use.
4. WHEN a translation is missing for a language THEN the system SHALL fall back to English rather than show an untranslated key.

### Requirement 5: Extensibility for future fields, modes, and tabs

**User Story:** As a maintainer, I want the jsonConfig structured so I can add new fields, modes, and tabs later, so that choosing jsonConfig now does not limit future configuration growth.

#### Acceptance Criteria

1. WHEN the jsonConfig root is defined THEN it SHALL use a `type: "tabs"` structure with the four current fields grouped in a single panel (e.g. "Main settings"), so additional panels/tabs can be added without restructuring.
2. WHEN a future field requires conditional visibility THEN the design SHALL document that jsonConfig `hidden`/`disabled` expressions (e.g. `"disabled": "!data.someFlag"`) are the mechanism for modes, without requiring any such field now.
3. WHEN a future configuration need cannot be expressed by built-in jsonConfig field types THEN the design SHALL document the `type: "custom"` React-component escape hatch as the extension path, without introducing a custom component now.
4. WHEN this feature is implemented THEN it SHALL NOT add tabs, fields, modes, or custom components beyond the four current fields; extensibility is a structural provision only.

### Requirement 6: Remove the React admin toolchain

**User Story:** As a maintainer, I want the obsolete React admin source, build output, and tooling removed, so that the repository and published package are smaller and simpler.

#### Acceptance Criteria

1. WHEN the migration is complete THEN the `src-admin/` directory SHALL be removed from the repository.
2. WHEN the migration is complete THEN generated React artifacts (`admin/assets/`, `admin/index.html`, and `admin/style.css` if only used by the React UI) SHALL be removed, retaining only files still required (e.g. `admin/sehybrid.png`, `admin/jsonConfig.json`, `admin/i18n/`).
3. WHEN `package.json` is read THEN React/Vite-specific scripts and dependencies that exist solely for the admin UI (`build:react`, `prebuild:react`, the `src-admin` portions of `build`, `prebuild`, `check`, and `lint`) SHALL be removed or updated so no script references `src-admin`.
4. WHEN `npm run build` is executed THEN it SHALL succeed without building or referencing `src-admin`.
5. WHEN `package.json`'s `files` array is read THEN it SHALL still include `admin/jsonConfig.json`, `admin/i18n/`, and any retained admin assets in the published package.
6. WHEN `tasks.js` or other build helpers reference the React admin THEN those references SHALL be removed or the files deleted if they serve no other purpose.
7. WHEN build-tooling or dev-tooling config files exist solely for `src-admin` THEN they SHALL be removed.

### Requirement 7: Build, lint, and tests pass

**User Story:** As a maintainer, I want the full project checks to pass after migration, so that I can release with confidence.

#### Acceptance Criteria

1. WHEN `npm run build` is executed THEN it SHALL complete successfully.
2. WHEN `npm run lint` is executed THEN it SHALL complete without errors and SHALL NOT attempt to lint a removed `src-admin`.
3. WHEN `npm run test` is executed THEN all tests SHALL pass.
4. WHEN the package validation test (`test:package`) runs THEN `io-package.json` SHALL be valid for `adminUI.config: "json"` and the referenced `admin/jsonConfig.json` SHALL exist.
5. WHEN the adapter is started with a valid configuration THEN it SHALL read `host`, `port`, `unitId`, and `pollInterval` exactly as before this change.

### Requirement 8: Documentation and changelog

**User Story:** As a maintainer, I want the change recorded, so that users and reviewers understand the admin UI migration.

#### Acceptance Criteria

1. WHEN the migration is complete THEN a new changelog entry (news block in `io-package.json` and/or `README.md`/`CHANGELOG`) SHALL describe the switch to jsonConfig.
2. IF `README_dev.md` or developer docs reference the React admin build THEN they SHALL be updated to describe the jsonConfig approach.
3. WHEN developer documentation describes how to edit the admin UI THEN it SHALL point to `admin/jsonConfig.json` and `admin/i18n/`.
