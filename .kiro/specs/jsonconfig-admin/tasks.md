# Implementation Plan: Migrate Admin UI to jsonConfig

All work on the `feature/jsonConfig` branch. Tasks are ordered so the project stays buildable; the jsonConfig and defaults land before the React toolchain is removed, and tests are fixed in the same pass that breaks them.

- [ ] 1. Create the jsonConfig dialog
  - Create `admin/jsonConfig.json` with `"i18n": true`, `type: "tabs"`, and a single `_main` panel (`label: "Main settings"`) containing the four fields in order: `host`, `port`, `unitId`, `pollInterval`.
  - `host`: `type: "text"`, `maxLength: 253`, `trim: true`, `validator: "!!data.host && data.host.length <= 253"`, `validatorErrorText: "Invalid host"`, `validatorNoSaveOnError: true`.
  - `port`: `type: "number"`, `min: 1`, `max: 65535`, `validator: "Number.isInteger(data.port) && data.port >= 1 && data.port <= 65535"`, `validatorErrorText: "Invalid port"`, `validatorNoSaveOnError: true`.
  - `unitId`: `type: "number"`, `min: 0`, `max: 247`, `validator: "Number.isInteger(data.unitId) && data.unitId >= 0 && data.unitId <= 247"`, `validatorErrorText: "Invalid unit ID"`, `validatorNoSaveOnError: true`.
  - `pollInterval`: `type: "number"`, `min: 5`, `max: 3600`, `help: "s"`, `validator: "Number.isInteger(data.pollInterval) && data.pollInterval >= 5 && data.pollInterval <= 3600"`, `validatorErrorText: "Invalid polling interval"`, `validatorNoSaveOnError: true`.
  - Add responsive grid widths (`xs/sm/md/lg`) per the design.
  - _Requirements: 1.1, 1.3, 1.4, 1.5, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4, 3.5, 5.1_

- [ ] 2. Create the admin i18n files
  - Create `admin/i18n/<lang>.json` for all 11 languages (`en, de, ru, pt, nl, fr, it, es, pl, uk, zh-cn`), each containing the keys: `Main settings`, `Host`, `Port`, `Unit ID`, `Polling interval (s)`, `Invalid host`, `Invalid port`, `Invalid unit ID`, `Invalid polling interval`.
  - Carry over the label and `Invalid *` values verbatim from the existing `src-admin/src/i18n/*.json` (see the translation table in design.md). Translate the new `Main settings` key (run `npm run translate`, or fill from the table; English fallback is acceptable for any gap).
  - _Requirements: 4.1, 4.2, 4.3, 4.4_

- [ ] 3. Flip the admin config in io-package.json
  - Set `common.adminUI.config` from `"html"` to `"json"`.
  - Verify `native` defaults remain `host: ""`, `port: 502`, `unitId: 1`, `pollInterval: 30` (no change expected).
  - _Requirements: 1.2, 2.1, 2.2, 2.5_

- [ ] 4. Update package.json build/lint/check scripts
  - Remove `prebuild:react` and `build:react`.
  - Change `prebuild` to `rimraf build`; change `build` to `npm run build:ts`.
  - Change `check` to `tsc --noEmit` (drop the `src-admin` project).
  - Change `lint` to `eslint -c eslint.config.mjs .` (drop `npm run lint --prefix src-admin`).
  - Update the `files` array: ensure `admin/jsonConfig.json` and `admin/i18n/*.json` ship (existing `admin{,/!(src)/**}/...json` pattern covers them); remove the now-dead `admin/assets/` entry. Confirm no `src-admin` entry is present.
  - _Requirements: 6.3, 6.4, 6.5, 7.2_

- [ ] 5. Update eslint.config.mjs
  - Remove ignore entries for removed paths: `src-admin/**`, `tasks.js`, `admin/assets/**`, `admin/index.html`, and the never-present `admin/words.js`, `admin/admin.d.ts`, `admin/blockly.js`.
  - Keep ignores for `.dev-server/`, `build`, `docs/`, test globs, `*.config.mjs`.
  - _Requirements: 7.2_

- [ ] 6. Remove the React admin toolchain and artifacts
  - Delete the `src-admin/` directory entirely.
  - Delete `admin/index.html`, `admin/assets/`, and `admin/style.css`.
  - Delete `tasks.js`.
  - Keep `admin/sehybrid.png`.
  - _Requirements: 6.1, 6.2, 6.6, 6.7_

- [ ] 7. Fix the test suite for the new state
- [ ] 7.1 Remove obsolete React-admin tests
  - Delete `test/settings-cleanup.test.js` (asserts on deleted `src-admin/.../Settings.tsx`).
  - Delete `test/readme-register-reference.explore.test.js` (reads deleted `Settings.tsx`).
  - Delete `test/review-fixes-remove-admin-tab.test.js` and `test/review-fixes-remove-admin-tab.preservation.test.js` (assert `adminUI.config == "html"`, `admin/index.html`, `App.tsx`/`Settings.tsx`, `src-admin/src/i18n`).
  - In `test/postinstall-preservation.test.js`, remove the `installNpmLocal()` / `tasks.js` source-modeling describe block (tasks.js is deleted); keep the `files`-allowlist-excludes-src-admin block.
  - _Requirements: 7.3_
- [ ] 7.2 Add the jsonConfig contract test
  - Create `test/jsonconfig.test.js` asserting: `io-package.json` `adminUI.config === "json"`; `admin/jsonConfig.json` exists and parses; root `type === "tabs"` with a `_main` panel whose items are exactly `host, port, unitId, pollInterval` in order; numeric `min`/`max` match `CONFIG_BOUNDS` (port 1/65535, unitId 0/247, pollInterval 5/3600); every field has a non-empty `validator` and the expected `validatorErrorText`; `admin/i18n/en.json` exists with all referenced keys; `native` defaults `host===""`, `port===502`, `unitId===1`, `pollInterval===30`.
  - _Requirements: 1.2, 1.3, 1.4, 2.1, 2.2, 2.5, 3.5, 7.4_
- [ ] 7.3 Update the test:package glob
  - In `package.json`, update the `test:package` script to add `test/jsonconfig.test.js` and drop `test/settings-cleanup.test.js`.
  - _Requirements: 7.3, 7.4_

- [ ] 8. Update developer docs and changelog
  - Rewrite the admin-UI sections of `README_dev.md`: admin UI is now `admin/jsonConfig.json` + `admin/i18n/` (declarative, no Vite/React/TS, no `tasks.js`, no `build:react`, no `src-admin`). Update the npm-scripts table, "Compilation config", "Project layout", and dev-server notes (push changes with `dev-server:upload`; no admin rebuild).
  - Add a new `news` entry in `io-package.json` (bump the patch/minor version via the normal flow) describing the switch to jsonConfig.
  - _Requirements: 8.1, 8.2, 8.3_

- [ ] 9. Verify the full build/lint/test pipeline
  - Run `npm run build` — succeeds, references no `src-admin`.
  - Run `npm run check` — backend type-check passes.
  - Run `npm run lint` — passes, no `src-admin` prefix lint.
  - Run `npm run test:ts` — backend unit tests pass.
  - Run `npm run test:package` — new `jsonconfig.test.js` passes, removed tests gone, `@iobroker/testing` validates the `json` admin config.
  - Run `npm run test:integration` — adapter starts and reads the four native values.
  - Fix any failures before proceeding.
  - _Requirements: 6.4, 7.1, 7.2, 7.3, 7.4, 7.5_

- [ ] 10. Manual verification in dev-server
  - Run `npm run dev-server:upload` then `npm run dev-server`; open the instance settings at http://localhost:8081.
  - Confirm: the four fields render in order; a new instance shows defaults (`port 502`, `unitId 1`, `pollInterval 30`, empty host); switching admin language localizes the labels and error texts; each field's `validator` disables Save and shows its translated `Invalid *` text on bad input (empty/overlong host, non-integer/out-of-range numbers); saving persists numbers (not strings) into `native`.
  - Confirm the adapter starts cleanly with a valid config and reads `host`/`port`/`unitId`/`pollInterval` as before.
  - _Requirements: 1.3, 1.4, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4, 4.1, 7.5_
