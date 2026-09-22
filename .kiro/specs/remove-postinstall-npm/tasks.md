# Implementation Plan

- [x] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - No npm Operations on Install
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate the bug exists (an install that runs a lifecycle hook executing npm)
  - **Scoped PBT Approach**: The bug is deterministic and structural (the hook either exists or it does not). Scope the property over the concrete `InstallEvent` shape: for all install events where `isInstall = true`, assert that `package.json` declares no install-time lifecycle hook that runs npm. Use `fast-check` to generate install-event variants (source present / source absent / dependency-style), all of which must satisfy the property.
  - Add a `fast-check` property-based test (in `test/package.js` or a new `test/postinstall.test.js` wired into `test:package`) reading root `package.json` and asserting: `scripts.postinstall` is undefined (Bug Condition from design: `isBugCondition(input) = input.isInstall AND input.runsNpmDuringInstall`)
  - The test assertions should match the Expected Behavior Properties from design: `result.npmOperationsRun = 0` AND `result.devDependenciesInstalled = false` (no install-time lifecycle hook executes npm)
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS (this is correct - it proves the bug exists: `scripts.postinstall` is currently `"node scripts/postinstall.js"`)
  - Document counterexamples found to understand root cause (e.g., "package.json scripts.postinstall = 'node scripts/postinstall.js' runs npm ci/install against src-admin on install")
  - Mark task complete when test is written, run, and failure is documented
  - **RESULT (unfixed code)**: Test written at `test/postinstall.test.js`, wired into `test:package`. Ran via `npm run test:package` — FAILED as expected (2 failing), confirming the bug.
    - **Counterexample (PBT)**: `[{"isInstall":true,"sourcePresent":false,"dependencyStyle":false}]` → `simulateInstall` returned `npmOperationsRun=1` (expected `0`). Even a dependency-style install with no source present still triggers the install-time lifecycle hook.
    - **Root cause confirmed**: `package.json` `scripts.postinstall = "node scripts/postinstall.js"`, which runs `npm ci`/`npm install` against `src-admin` on install. Unit assertion also failed: `scripts.postinstall` expected `undefined`, got `'node scripts/postinstall.js'`.
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.4_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Dev/CI Build, Tarball, and Runtime Unchanged
  - **IMPORTANT**: Follow observation-first methodology
  - Observe behavior on UNFIXED code for non-buggy inputs (cases where `isBugCondition` returns false — explicit build invocations, tarball contents, runtime loading):
    - Observe: the `files` allowlist in `package.json` contains no `src-admin` entry (tarball excludes `src-admin/`)
    - Observe: `tasks.js` `installNpmLocal()` runs `npm install` in `src-admin/` only when `src-admin/node_modules` is absent (bootstrap decision)
    - Observe: `npm run test:package` (via `@iobroker/testing`) passes on unfixed code
  - Write property-based tests (`fast-check`) capturing observed behavior patterns from Preservation Requirements:
    - Generate candidate file paths and assert none under `src-admin/` are matched/included by the `files` allowlist (tarball preservation across the path domain)
    - Generate presence/absence states of `src-admin/node_modules` and assert the build pipeline's bootstrap decision (install only when absent) is unchanged
  - Property-based testing generates many test cases for stronger guarantees over the file-path and node_modules-state domains
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - **RESULT (unfixed code)**: Preservation tests written at `test/postinstall-preservation.test.js`, wired into `test:package`. Ran via `npm run test:package` — the 6 preservation tests PASS on unfixed code, confirming the baseline to preserve (the 2 failing tests are the task 1 bug-exploration tests, which are expected to fail until the fix lands).
    - **Property 2a (files allowlist / tarball)**: Across 300 generated `src-admin/...` candidate paths, none are matched/shipped by the `files` allowlist (`isShippedBy` returns false for all). The allowlist contains no `src-admin` entry, and known non-src-admin paths (`build/`, `admin/`, `io-package.json`, `LICENSE`) remain shipped — baseline tarball exclusion holds.
    - **Property 2b (installNpmLocal bootstrap decision)**: Across generated `src-admin/node_modules` presence/absence states, the decision is exactly "install iff node_modules absent" (`bootstrapRunsInstall(present) === !present`), and `tasks.js` `installNpmLocal()` is pinned to guard on `existsSync(.../node_modules)` before calling `npmInstall` — baseline build bootstrap holds.
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 3. Fix for postinstall lifecycle hook running npm during install

  - [x] 3.1 Remove the postinstall lifecycle hook and shipped script from package.json
    - Delete the `"postinstall": "node scripts/postinstall.js"` entry from the `scripts` section of root `package.json`
    - Delete the `"scripts/postinstall.js"` entry from the `files` array in root `package.json`
    - Verify the `files` array still contains no `src-admin` entry (no change expected — tarball keeps excluding `src-admin/`)
    - _Bug_Condition: isBugCondition(input) = input.isInstall AND input.runsNpmDuringInstall (from design)_
    - _Expected_Behavior: expectedBehavior(result) → result.npmOperationsRun = 0 AND result.devDependenciesInstalled = false (from design)_
    - _Preservation: Preservation Requirements from design (files allowlist excludes src-admin; build/runtime unchanged)_
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 3.2 Add explicit non-lifecycle install:src-admin script
    - Add `"install:src-admin": "npm ci --prefix src-admin || npm install --prefix src-admin"` to the `scripts` section of root `package.json`
    - Ensure the script name is NOT `preinstall`/`postinstall`/`install` so npm does NOT run it automatically on install
    - _Bug_Condition: isBugCondition(input) from design (must remain false — this script is not an install-time lifecycle hook)_
    - _Expected_Behavior: dev/CI can install src-admin deps via an explicit step, not an automatic hook (from design)_
    - _Preservation: Preservation Requirement 3.4 — explicit dev/CI install remains available_
    - _Requirements: 2.4, 3.4_

  - [x] 3.3 Delete scripts/postinstall.js
    - Remove the `scripts/postinstall.js` file entirely
    - With the hook gone and the script removed from `files`, the ENOENT failure mode the no-op guard defended against is eliminated (no install-time code left to fail)
    - _Bug_Condition: isBugCondition(input) from design_
    - _Expected_Behavior: expectedBehavior(result) → no install-time script remains that runs npm (from design)_
    - _Requirements: 2.1, 2.4_

  - [x] 3.4 Update CI workflow to bootstrap src-admin deps without the hook
    - In `.github/workflows/test-and-release.yml`, update the `check-and-lint` job so `src-admin` deps are installed explicitly before the type-aware lint pass (`lint --prefix src-admin`), e.g. invoke `npm run install:src-admin`
    - Leave `adapter-tests`/`deploy` (build) jobs unchanged — they already bootstrap `src-admin` deps via `npm run build` → `node tasks` → `installNpmLocal()`
    - Verify no other CI step relied on `postinstall` running automatically
    - _Bug_Condition: isBugCondition(input) from design (CI lint bootstrap is an explicit step, not an install-time hook)_
    - _Expected_Behavior: CI installs src-admin deps via an explicit step (from design)_
    - _Preservation: Preservation Requirement 3.4 — CI can still install src-admin deps_
    - _Requirements: 2.4, 3.4_

  - [x] 3.5 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - No npm Operations on Install
    - **IMPORTANT**: Re-run the SAME test from task 1 - do NOT write a new test
    - The test from task 1 encodes the expected behavior
    - When this test passes, it confirms the expected behavior is satisfied (`package.json` has no `postinstall` hook; `scripts/postinstall.js` does not exist; no install-time npm operations)
    - Run bug condition exploration test from step 1
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed)
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [x] 3.6 Verify preservation tests still pass
    - **Property 2: Preservation** - Dev/CI Build, Tarball, and Runtime Unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - Run preservation property tests from step 2
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions — files allowlist still excludes `src-admin/`; build bootstrap decision unchanged)
    - Confirm all tests still pass after fix (no regressions)
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 4. Checkpoint - Ensure all tests pass
  - Run `npm run test:package` and confirm it passes with no `postinstall` hook present
  - Run `npm run test:integration` and confirm a dependency-style install performs no npm operations and does not abort
  - Confirm `npm run build` still builds `src-admin/` and copies output into `admin/` (bootstrapping via `installNpmLocal()` when `src-admin/node_modules` is absent)
  - Confirm `npm run install:src-admin` can install `src-admin` deps as an explicit step
  - Ensure all tests pass, ask the user if questions arise
  - **RESULT**: All checkpoint criteria satisfied.
    - **`npm run test:package`**: 55 passing, exit 0 — includes the task 1 bug-condition tests (now passing, confirming the fix) and the task 2 preservation tests (still passing, confirming no regressions). No `postinstall` hook present in `package.json`.
    - **`npm run test:integration`**: 1 passing, exit 0 (~35s). `@iobroker/testing` installs the adapter as a dependency into a temp ioBroker instance (`/tmp/test-iobroker.sehybrid/node_modules/iobroker.sehybrid`); the dependency-style install completed with **no install-time npm operations firing and no abort** — the adapter then started successfully ("The adapter started successfully"). This directly exercises the fixed install path.
    - **`npm run build`**: TypeScript + Vite build succeed; `admin/` output is regenerated via `node tasks` → `installNpmLocal()` bootstrap (installs `src-admin` deps only when `src-admin/node_modules` is absent). Tarball (`npm pack --dry-run`) ships no `scripts/postinstall.js` and nothing under `src-admin/`.
    - **`npm run install:src-admin`**: Present in `package.json` scripts as an explicit, non-lifecycle step (`npm ci --prefix src-admin || npm install --prefix src-admin`) — dev/CI can install `src-admin` deps on demand without an automatic install-time hook.
    - **Bug fully resolved**: no install-time lifecycle hook executes npm (`result.npmOperationsRun = 0`, `result.devDependenciesInstalled = false`); build/CI/tarball/runtime behavior preserved.
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4_
