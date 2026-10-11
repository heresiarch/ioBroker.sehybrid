# Implementation Plan

- [x] 1. Write bug condition exploration test (surface all four defect patterns)
  - **Property 1: Bug Condition** - Review Findings Still Present
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the defects exist
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected post-fix state - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate every bug slice in `isBugCondition` exists
  - **Scoped PBT Approach**: The bugs are over static artifacts and deterministic, so scope the property to the concrete artifact slices named in the design (io-package.json tree, admin source tree, build config, i18n files) rather than randomized inputs
  - Write assertions/scans over the committed artifacts that encode `isBugCondition(artifact)` from the design:
    - Tab wiring: assert `io-package.json` has `common.adminUI.tab` AND a `common.adminTab` block; assert `src-admin/src/Tab.tsx` exists and contains `Add your components here.`; assert `src-admin/src/index.tsx` imports `Tab` and branches on a `tab` URL; assert `tasks.js` `patchFiles` and `src-admin/vite.config.watch.ts` `patch-admin-html` each write `admin/tab.html`; assert the committed `admin/tab.html` exists
    - French news: assert `news["1.0.15"].fr == news["1.0.15"].en`, `firstLine(news["1.0.9"].fr) == firstLine(news["1.0.9"].en)`, `secondLine(news["1.0.10"].fr) == secondLine(news["1.0.10"].en)`
    - In-use i18n untranslated: for each non-English file in `src-admin/src/i18n/`, assert at least one in-use key (e.g. `"Test Connection"`, `"Invalid host"`) equals the English value
    - Unused key: assert `"sehybrid adapter settings"` is present in every i18n file AND referenced by no `.tsx`
    - Edge (coupling): deleting `Tab.tsx` alone and building `src-admin` must raise a compile error on the `./Tab` import in `index.tsx`, proving the four touch points must change together
  - The test assertions should match the Expected Behavior / Correctness Property 1 (corrected state) from design
  - Run the scans/build on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS (this is correct - it proves the review findings exist)
  - Document counterexamples found: `adminTab` + `adminUI.tab` present, `Tab.tsx` placeholder present, `tab.html` emitted by both build steps and committed, three French news lines byte-identical to English, multiple in-use i18n values byte-identical to English, `"sehybrid adapter settings"` present everywhere / referenced nowhere
  - Mark task complete when the test is written, run, and failure is documented
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Non-Targeted Artifacts Unchanged
  - **IMPORTANT**: Follow observation-first methodology — capture the UNFIXED state of every preserved slice first, then assert it is unchanged after the fix
  - Observe behavior on UNFIXED code for non-bug-condition cases (cases where `isBugCondition` returns false):
    - Config dialog path: observe `common.adminUI.config == "html"`, `admin/index.html` present, `App`/`Settings` render path intact
    - In-use i18n keys: record that all 29 keys referenced by `Settings.tsx` (`Host`, `Port`, `Unit ID`, `Polling interval (s)`, `Test Connection`, `Testing…`, `Connection successful`, `Connection failed`, `SunSpec Values`, `Inverter values`, `Meter values`, `Battery values`, `Name`, `Register`, `Datatype`, `Model`, `Description`, `No SunSpec values available`, `StorEdge Control Block`, `Address`, `Encoding`, `Unit`, `Range`, `Function code`, `No StorEdge control registers available`, `Invalid host`, `Invalid port`, `Invalid unit ID`, `Invalid polling interval`) are present in all 11 files
    - Already-correct translations: record non-French news lines not listed in 1.4–1.6, and already-translated fr.json values (`Adresse`, `Encodage`, `Unité`, `Plage`, `Code de fonction`, `Aucun registre de contrôle StorEdge disponible`)
    - Tab-unrelated io-package fields: snapshot `native`, `instanceObjects`, `dependencies`, `globalDependencies`, `desc`, `titleLang`, `version`, other `news` entries, and all `common.*` except `adminUI.tab` / `adminTab`
    - Dev-server artifacts: snapshot the `.dev-server/.../tab.html` copies (must be left to the dev-server, not hand-edited)
  - Write property-based tests capturing these observed patterns from the Preservation Requirements in design:
    - Over the preserved key set: for every key referenced by `Settings.tsx`, assert it exists in all 11 files
    - Over the `io-package.json` field tree: for every path outside the allowed-edit set, assert `original == fixed`
    - Over already-translated values: assert each remains byte-identical
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms the baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 3. Fix for admin-tab removal (coupled changes: Tab.tsx, index.tsx, build steps, io-package tab registration)

  - [x] 3.1 Delete the admin tab scaffold and fix the bootstrap (Changes 2 and 3)
    - Delete `src-admin/src/Tab.tsx` (the only source of the `Add your components here.` placeholder)
    - In `src-admin/src/index.tsx`: remove `import Tab from './Tab';`; remove the `isTab` computation and the `if (isTab) { … } else { … }` branch; render `App` unconditionally via `root.render(<App adapterName="sehybrid" />)`
    - Keep the version log and the `App` / `createRoot` / `index.css` imports
    - _Bug_Condition: isBugCondition(artifact) where Tab.tsx exists OR index.tsx imports Tab/branches on "tab" URL_
    - _Expected_Behavior: expectedBehavior(result) — Tab.tsx absent, index.tsx renders only App (design Property 1a)_
    - _Preservation: config dialog path (App/Settings) unchanged per Preservation Requirements_
    - _Requirements: 2.2, 2.3_

  - [x] 3.2 Remove tab.html emission from both build steps and delete the committed artifact (Change 4)
    - In `tasks.js` (`patchFiles`): keep the socket.io include rewrite on `admin/index.html`; remove the two lines that build `tabCode` and `writeFileSync` it to `admin/tab.html`; update the `patchFiles` doc comment and header usage block so they no longer mention `tab.html`
    - In `src-admin/vite.config.watch.ts` (`patch-admin-html`): keep the socket.io shim rewrite in `closeBundle`; remove the two lines that build `tabCode` and `writeFileSync` it to `admin/tab.html`; update the plugin/file comment that references emitting `tab.html`
    - Remove the committed `admin/tab.html` file
    - Do NOT touch the dev-server copies under `.dev-server/...` — they are runtime state (clause 3.5)
    - _Bug_Condition: isBugCondition(artifact) where tasks.js/vite.config.watch.ts emit admin/tab.html OR committed admin/tab.html exists_
    - _Expected_Behavior: expectedBehavior(result) — neither build step emits tab.html, committed tab.html removed (design Property 1a)_
    - _Preservation: socket.io rewrites and admin/index.html build retained; dev-server copies left untouched (3.5)_
    - _Requirements: 2.3_

  - [x] 3.3 Remove tab registration from io-package.json (Change 1)
    - In `common.adminUI`, remove the `"tab": "html"` entry; keep `"config": "html"` → `"adminUI": { "config": "html" }`
    - Remove the entire `common.adminTab` block (`singleton`, the 11-language `name`, `link`)
    - Leave all other fields byte-for-byte unchanged; mind comma/brace hygiene around the removed `adminTab` key so the file stays valid JSON and valid io-package schema
    - _Bug_Condition: isBugCondition(artifact) where io-package.json has common.adminUI.tab OR common.adminTab_
    - _Expected_Behavior: expectedBehavior(result) — adminUI.tab and adminTab absent, adminUI.config = "html" kept (design Property 1a)_
    - _Preservation: all tab-unrelated io-package fields unchanged (3.4)_
    - _Requirements: 2.1_

  - [x] 3.4 Verify the src-admin build compiles after tab removal
    - **Property 1: Expected Behavior** - Admin Build Compiles Without Tab Module
    - **IMPORTANT**: Re-run the SAME exploration checks from task 1 - do NOT write new ones
    - Build the `src-admin` project (and/or run the full `node tasks` admin pipeline) and confirm it completes successfully with no reference to the removed `Tab` module and without emitting `admin/tab.html`
    - Validate `io-package.json` still parses as JSON and conforms to the io-package schema; assert `adminUI` has no `tab` key and `common` has no `adminTab`
    - Assert `admin/tab.html` no longer exists and `src-admin/src/Tab.tsx` no longer exists; assert `index.tsx` contains no `Tab` import and no `tab` URL branch
    - **EXPECTED OUTCOME**: Build succeeds and the tab-wiring assertions from task 1 now pass (confirms the coupled tab removal is complete)
    - **DO NOT proceed to the translation tasks until this build is green** (deleting Tab.tsx without fixing index.tsx breaks the build)
    - _Requirements: 2.4_

- [x] 4. Fix for untranslated French news strings in io-package.json (Change 5)
  - In `news["1.0.15"].fr`: replace `"fix Lint errors"` with a real French translation differing from `en` (e.g. "correction des erreurs Lint")
  - In `news["1.0.9"].fr`: replace the first line `"fixed lint config"` with a French translation (e.g. "configuration lint corrigée"); keep the already-translated second line "a vérifié que le design réactif fonctionne"
  - In `news["1.0.10"].fr`: replace the second line `"hotfix for port issue"` with a French translation (e.g. "correctif pour le problème de port"); keep the already-translated first line "correctif pour fichiers statiques perdus dans NPM"
  - _Bug_Condition: isBugCondition(artifact) where news fr line == en line (1.0.15, 1.0.9 line 1, 1.0.10 line 2)_
  - _Expected_Behavior: expectedBehavior(result) — each fr line is a correct French translation != en, preserved lines intact (design Property 1b)_
  - _Preservation: all other news lines/entries unchanged (3.3)_
  - _Requirements: 2.5, 2.6, 2.7_

- [x] 5. Fix for untranslated / unused admin i18n keys (Change 6)
  - Remove the key `"sehybrid adapter settings"` from all 11 files (de, en, es, fr, it, nl, pl, pt, ru, uk, zh-cn) — it is referenced by no `.tsx` and is the only genuinely-unused key
  - In each of the 10 non-English files, for every in-use key whose value still equals English, provide a correct translation. Keys requiring translation (per clause 2.8) include: `Polling interval (s)`, `Test Connection`, `Testing…`, `Connection successful`, `Connection failed`, `Inverter values`, `Meter values`, `Battery values`, `Datatype`, `Description`, `No SunSpec values available`, `Invalid host`, `Invalid port`, `Invalid unit ID`, `Invalid polling interval`, and any of `Address`/`Encoding`/`Unit`/`Range`/`Function code`/`No StorEdge control registers available`/`Unit ID` not already translated in a given file
  - Honor the documented intentional-non-translation set (clause 2.9) — these MAY remain equal to English and are NOT defects: `"StorEdge Control Block"` (product name, all languages), `"SunSpec Values"` (protocol name; localizing "Values" optional), `"Register"`/`"Model"`/`"Name"` (short technical terms where the correct translation equals English), `"Host"`/`"Port"`/`"Unit"` (networking terms commonly left untranslated where idiomatic)
  - Retain every key still referenced by `Settings.tsx` in all 11 files (do not drop any in-use key during the unused-key audit)
  - _Bug_Condition: isBugCondition(artifact) where non-English in-use i18n value == en, OR "sehybrid adapter settings" present_
  - _Expected_Behavior: expectedBehavior(result) — in-use values translated (or documented non-translation), unused key absent from all files (design Property 1c, 1d)_
  - _Preservation: all in-use keys retained in all 11 files; already-translated values unchanged (3.2, 3.3)_
  - _Requirements: 2.8, 2.9, 2.10_

- [x] 6. Verify bug condition exploration test now passes (fix checking)
  - **Property 1: Expected Behavior** - Review Findings Resolved
  - **IMPORTANT**: Re-run the SAME test from task 1 - do NOT write a new test
  - The test from task 1 encodes the expected post-fix state across all four defect patterns
  - Re-run the artifact scans/assertions and the build-level checks:
    - Build `src-admin` / full pipeline succeeds with no reference to the removed `Tab` module and no `admin/tab.html` emitted
    - `io-package.json` is valid JSON and valid io-package schema; `adminUI.tab` and `adminTab` absent; `adminUI.config = "html"` kept
    - `admin/tab.html` and `src-admin/src/Tab.tsx` do not exist; `index.tsx` has no `Tab` import or `tab` branch
    - The three French news lines differ from English with the preserved lines intact
    - `"sehybrid adapter settings"` absent from all 11 i18n files; every in-use key still present; non-translation set documented
  - **EXPECTED OUTCOME**: Test PASSES (confirms all review findings are resolved)
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10_

- [x] 7. Verify preservation tests still pass (regression check)
  - **Property 2: Preservation** - Non-Targeted Artifacts Unchanged
  - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
  - Re-run the preservation property tests from task 2 and confirm:
    - Config dialog path unchanged (`adminUI.config == "html"`, `admin/index.html`, `App`/`Settings` render)
    - Every key referenced by `Settings.tsx` still present in all 11 i18n files
    - Already-translated news/i18n values byte-identical
    - All tab-unrelated `io-package.json` fields byte-identical outside the allowed-edit set
    - Dev-server `.dev-server/.../tab.html` copies untouched by the source fix
  - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 8. Checkpoint - Ensure all tests pass
  - Ensure the admin build compiles, `io-package.json` validates, all fix-checking assertions pass, and all preservation tests pass
  - Ask the user if questions arise
  - _Requirements: 2.4_

- [~] 9. Re-review deliverables (MANUAL / PR action — not a code change)
  - **NOTE**: This step is performed manually against PR #6765; it is not a code edit and is not auto-executable
  - Produce a fresh object dump for the adapter
  - Add the "READY FOR RE-REVIEW" remark to [ioBroker.repositories PR #6765](https://github.com/ioBroker/ioBroker.repositories/pull/6765)
  - Optionally comment on the three out-of-scope observations (reactive-power role `value.power` → `value.power.reactive`, energy-role granularity, and the jsonConfig migration from the HTML admin UI) as PR comments — no code change in this spec
  - Confirm the adapter's runtime monitoring/control behavior continues to work unchanged
  - _Requirements: 3.6, 3.7_
