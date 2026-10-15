# jsonConfig admin migration — gating review (pass 4)

Migrates the `sehybrid` adapter admin UI from the custom React/TS app (`src-admin/`, Vite + MUI, `adminUI.config: "html"`) to a declarative ioBroker jsonConfig dialog (`admin/jsonConfig.json` + `admin/i18n/`, `adminUI.config: "json"`). The adapter backend and `validateConfig`/`CONFIG_BOUNDS` are untouched; only the config UI and its build/test plumbing change. Every statically inspectable artifact matches the APPROVED spec with byte-level precision — jsonConfig schema, all 11 translation files, config edits, deletions, test rewiring, and docs.

Watch for: the single blocking item is process, not code (confirmed) — the coder's required verification-pipeline evidence (`npm run build/check/lint/test:ts/test:package/test:integration`) is not present in this review's inputs and no report artifact exists on disk under the task/spec directory (no `.agents/tasks/` directory, no report `.md`). The gate rule treats missing evidence as a blocking finding and forbids the reviewer from re-running the full suites to manufacture it. This is the same gap that blocked passes 2 and 3; the code remains clean and unchanged.

**Verdict**: NEEDS_CHANGES

## High-level view

The jsonConfig dialog is a byte-for-byte match to the design: `i18n: true`, `type: "tabs"`, a single `_main` panel labelled "Main settings" holding `host`, `port`, `unitId`, `pollInterval` in that exact order, each carrying the design's validator expression, `validatorErrorText`, `validatorNoSaveOnError: true`, min/max, and responsive grid widths. The numeric validators enforce `Number.isInteger` plus the `CONFIG_BOUNDS` ranges, mirroring `validateConfig` exactly.

Localization is complete: all 11 language files exist and every label and `Invalid *` value matches the design's translation table verbatim. `Main settings` is translated in every language rather than relying on the permitted English fallback.

The config surface is correctly flipped: `adminUI.config` is `"json"`, native defaults are unchanged (`host ""`, `port 502`, `unitId 1`, `pollInterval 30`), a new `1.0.22` news entry describes the switch across all 11 languages, `package.json` scripts and `files` array drop every `src-admin`/React reference, and the eslint ignore entries for removed paths are gone.

The React toolchain is fully removed (`src-admin/`, `admin/index.html`, `admin/assets/`, `admin/style.css`, `tasks.js`) while `admin/sehybrid.png` is kept. The test suite is rewired per the Test Impact contract: the four obsolete React-admin tests are deleted, the `installNpmLocal()`/`tasks.js` block is removed from `postinstall-preservation` while the files-allowlist block is kept and its sample paths updated, and the new `test/jsonconfig.test.js` pins the contract and passes 11/11 on the narrow spot-check run this pass.

The one gap is the verification evidence. The gate requires proof that the full pipeline passes (or that integration is explicitly un-runnable here with everything else green). That evidence is absent from the material available to this reviewer, which under the gate's own rule is a blocking finding regardless of how clean the code is.

<details>
<summary>Issues (1)</summary>

1. **Missing verification-pipeline evidence (HIGH, confirmed)** — The coder's final message with the results of `npm run build`, `check`, `lint`, `test:ts`, `test:package`, and `test:integration` is not present in the review inputs or on disk under the task/spec directory (no `.agents/tasks/` directory, no report `.md`). The gate rule treats missing evidence as CHANGES_REQUESTED and forbids the reviewer from running the full suites to fill the gap. Re-run the pipeline and report each command's pass/fail in the final message (or report `test:integration` as explicitly un-runnable in this environment with everything else green) so the next pass can approve.

</details>

<details>
<summary>Details</summary>

## jsonConfig schema matches design field-for-field

`admin/jsonConfig.json` reproduces the design block exactly (confirmed). Root is `{"i18n": true, "type": "tabs"}` with one `_main` panel (`"label": "Main settings"`). `Object.keys` on the panel items yields `["host","port","unitId","pollInterval"]` in order (Req 1.3/1.4). Each field carries the design's exact attributes:

- `host`: `type: text`, `trim: true`, `maxLength: 253`, `validator: "!!data.host && data.host.length <= 253"`, `validatorErrorText: "Invalid host"`, `validatorNoSaveOnError: true`, grid `12/12/6/4`.
- `port`: `newLine: true`, `type: number`, `min: 1`, `max: 65535`, `validator: "Number.isInteger(data.port) && data.port >= 1 && data.port <= 65535"`, `validatorErrorText: "Invalid port"`, `validatorNoSaveOnError: true`, grid `12/6/3/2`.
- `unitId`: `newLine: true`, `type: number`, `min: 0`, `max: 247`, `validator: "Number.isInteger(data.unitId) && data.unitId >= 0 && data.unitId <= 247"`, `validatorErrorText: "Invalid unit ID"`, `validatorNoSaveOnError: true`, grid `12/6/3/2`.
- `pollInterval`: `newLine: true`, `type: number`, `min: 5`, `max: 3600`, `help: "s"`, `validator: "Number.isInteger(data.pollInterval) && data.pollInterval >= 5 && data.pollInterval <= 3600"`, `validatorErrorText: "Invalid polling interval"`, `validatorNoSaveOnError: true`, grid `12/6/3/2`.

The three numeric min/max pairs and the integer guards match `CONFIG_BOUNDS` (port 1..65535, unitId 0..247, pollInterval 5..3600) and `validateConfig`'s `Number.isInteger` checks exactly, so the in-dialog validators and the authoritative start-time validation agree. `validatorNoSaveOnError: true` is set on all four fields, blocking Save on any invalid field.

## Translations complete and verbatim

All 11 files (`en, de, ru, pt, nl, fr, it, es, pl, uk, zh-cn`) exist under `admin/i18n/` (confirmed). Each contains the nine required keys (`Main settings`, the four labels, the four `Invalid *` error texts). The four label values and four `Invalid *` values match the design's translation table character-for-character in every language. `Main settings` — the one key with no prior translation — is filled in for every language (e.g. de `Haupteinstellungen`, zh-cn `主要设置`) rather than left as English, exceeding the spec's "English fallback acceptable" allowance.

## Config surface and changelog

`io-package.json` flips `common.adminUI.config` from `"html"` to `"json"` and leaves `native` defaults untouched (`host ""`, `port 502`, `unitId 1`, `pollInterval 30`), satisfying Req 2.1/2.2/2.5. A new `1.0.22` news entry describes the jsonConfig switch in all 11 languages, and both `io-package.json` and `package.json` versions bump to `1.0.22` consistently (Req 8.1).

`package.json` drops `prebuild:react` and `build:react`, reduces `prebuild` to `rimraf build`, `build` to `npm run build:ts`, `check` to `tsc --noEmit`, and `lint` to `eslint -c eslint.config.mjs .` — no script references `src-admin`. The `files` array removes the now-dead `admin/assets/` line; the retained `admin{,/!(src)/**}/...` patterns still ship `admin/jsonConfig.json` and `admin/i18n/*.json`, and no `src-admin` entry is present (Req 6.3/6.4/6.5). The `test:package` glob drops `test/settings-cleanup.test.js` and adds `test/jsonconfig.test.js`.

`eslint.config.mjs` removes the ignore entries for `src-admin/**`, `tasks.js`, `admin/assets/**`, `admin/index.html`, and the never-present `admin/words.js`/`admin/admin.d.ts`/`admin/blockly.js`, keeping `.dev-server/`, `build`, `docs/`, and the config/test globs (Req 7.2).

## React toolchain removed, icon kept

The deletions match the design (confirmed): the entire `src-admin/` tree (sources, its `package.json`/lockfile, `tsconfig`, `vite.config.ts`, eslint/prettier configs, i18n), `admin/index.html`, all of `admin/assets/*`, `admin/style.css`, and `tasks.js` are gone. `admin/sehybrid.png` is retained and still tracked (still referenced by `common.icon`/`extIcon`). Residual `src-admin` strings remain only in files this spec does not govern and that are unchanged by this diff: `CHANGELOG_OLD.md` (historical), `.gitignore` and `.github/{dependabot.yml,workflows/test-and-release.yml}` (CI/ignore config, mostly commented-out, out of this spec's scope), `test/postinstall.test.js` (comments plus a test that reads only `package.json` and intentionally models the no-`src-admin` install tree — it does not read any deleted path), `test/postinstall-preservation.test.js` (the retained allowlist-excludes-`src-admin` block), `src/lib/register-format.ts` (a provenance comment), and `src/lib/remove-test-connection.explore.test.ts` (artifact-absence probes that resolve to empty strings for the now-deleted files via a try/catch `readRepoFile`, so the test still passes). These are pre-existing or correct-by-design and out of scope for this review.

## Test suite rewiring

The four obsolete React-admin tests (`settings-cleanup`, `readme-register-reference.explore`, `review-fixes-remove-admin-tab`, `review-fixes-remove-admin-tab.preservation`) are deleted. In `test/postinstall-preservation.test.js` the `installNpmLocal()`/`tasks.js` source-modeling block is removed (it read the now-deleted `tasks.js`), while the files-allowlist-excludes-`src-admin` block is kept; its sanity sample paths were updated from `admin/index.html`/`admin/assets/index.js` to `admin/jsonConfig.json`/`admin/i18n/en.json`/`admin/sehybrid.png`, keeping the test meaningful.

`test/jsonconfig.test.js` is new and pins the Test Impact contract: `adminUI.config === "json"`, jsonConfig parses as `type: tabs` with a `_main` panel holding exactly the four fields in order, numeric min/max equal `CONFIG_BOUNDS`, every field has a non-empty validator and the expected `validatorErrorText`, `admin/i18n/en.json` has all nine keys, and native defaults are unchanged. Narrow spot-check this pass: `npx mocha test/jsonconfig.test.js --exit` passes 11/11.

One follow-on change beyond the literal task list: `src/lib/remove-test-connection.preservation.test.ts` repoints `loadLocale` from `src-admin/src/i18n/<locale>.json` to `admin/i18n/<locale>.json`. This is correct and necessary — that test (run by `test:ts`) would otherwise read a deleted path and throw. It asserts the eight non-test-connection keys (the four labels + four `Invalid *`) exist and are non-empty across all 11 locales, which the new i18n files satisfy. A clean, well-commented adaptation that stays inside the migration's intent.

## README_dev.md rewritten

The developer docs are rewritten throughout: Project layout now describes the declarative jsonConfig + i18n with no build step; the Getting started, dev-server, Compilation config, and npm-scripts sections drop `build:react`, `tasks.js`, Vite, and `src-admin`; `dev-server:upload` is documented as the way to push `jsonConfig.json`/`i18n` changes with no rebuild (Req 8.2/8.3).

## Verification evidence — the blocking gap

The gate requires the coder's reported results for `npm run build`, `npm run check`, `npm run lint`, `npm run test:ts`, `npm run test:package`, and `npm run test:integration`, and APPROVED is permitted only when that evidence shows every command passing (integration may be reported un-runnable in this environment with all else green). That evidence is not present in this review's inputs and no report artifact exists on disk under the task/spec directory (no `.agents/tasks/` directory, no report `.md`). The gate rule explicitly states that missing evidence is itself a blocking finding and that the reviewer must not run the full suites to fill the gap — so this cannot be resolved by the reviewer and must bounce back for the coder to supply the pipeline results in its final message.

The permitted narrow spot-check (running `test/jsonconfig.test.js` alone) passed 11/11, and all static artifact checks pass, so this is the only outstanding item. Once the pipeline evidence is attached and green, the change is otherwise ready to approve.

## File map

<details>
<summary>Files changed</summary>

- `admin/jsonConfig.json` (new) — declarative dialog, exact match to design.
- `admin/i18n/{en,de,ru,pt,nl,fr,it,es,pl,uk,zh-cn}.json` (new) — 11 translation files, verbatim.
- `io-package.json` — `adminUI.config` → `json`, `1.0.22` news entry, version bump; native defaults unchanged.
- `package.json` — scripts and `files` array de-React-ified; `test:package` glob updated; version bump.
- `eslint.config.mjs` — removed ignore entries for deleted paths.
- `README_dev.md` — admin-UI/dev docs rewritten for jsonConfig.
- `test/jsonconfig.test.js` (new) — contract test (passes 11/11).
- `test/postinstall-preservation.test.js` — removed tasks.js block, kept files-allowlist block.
- `src/lib/remove-test-connection.preservation.test.ts` — i18n path repointed to `admin/i18n/`.
- Deleted: `src-admin/**`, `admin/index.html`, `admin/assets/**`, `admin/style.css`, `tasks.js`, `test/settings-cleanup.test.js`, `test/readme-register-reference.explore.test.js`, `test/review-fixes-remove-admin-tab{,.preservation}.test.js`.
- Kept: `admin/sehybrid.png`.

Full diff: `git diff main` on branch `feature/jsonConfig`.

</details>

</details>
