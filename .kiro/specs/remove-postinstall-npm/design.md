# Remove postinstall npm Bugfix Design

## Overview

The adapter declares a `postinstall` lifecycle hook in `package.json` (`"postinstall": "node scripts/postinstall.js"`). On every install of the package, npm runs this hook. The script bootstraps the `src-admin/` Vite/React development project by running `npm ci`/`npm install` against `src-admin/` whenever `src-admin/package.json` is present. It guards against ENOENT on dependency-style installs by exiting early (no-op) when `src-admin/package.json` is absent (which is the case in the published tarball, since `src-admin/` is not in the `files` allowlist).

ioBroker reviewers report that running arbitrary npm operations during a package lifecycle hook on end-user machines is untypical for an ioBroker adapter, is unnecessary for runtime, and risks pulling the full Vite/React development environment onto user systems. The no-op guard reduces but does not eliminate the concern: the hook still exists and still runs npm in scenarios where `src-admin/package.json` is present.

The fix removes the npm-running install hook entirely so that installing the published adapter performs no npm operations. The dev/CI need for `src-admin` dependency installation is preserved without a lifecycle hook:

- **Local/dev builds** already bootstrap `src-admin` dependencies through the `tasks.js` pipeline. Running `npm run build` (→ `build:react` → `node tasks`) calls `installNpmLocal()`, which runs `npm install` in `src-admin/` only when `src-admin/node_modules` is absent. The `postinstall` hook is therefore redundant for local/dev builds.
- **CI** gets an explicit, non-lifecycle mechanism: a dedicated npm script (`install:src-admin`) that CI (or a developer) invokes deliberately. The lint job needs `src-admin` deps for the type-aware ESLint pass (`lint --prefix src-admin`); the adapter-tests/build jobs already bootstrap deps through the `tasks.js` build path.

Because the hook is removed entirely, the ENOENT failure mode the no-op guard was defending against also disappears: there is no install-time code left to fail.

## Glossary

- **Bug_Condition (C)**: The condition that triggers the bug — an install of the adapter that runs a package lifecycle hook executing npm operations.
- **Property (P)**: The desired behavior — installing the adapter runs zero npm operations and installs no development dependencies.
- **Preservation**: Existing dev/CI build behavior, published tarball contents, and adapter runtime that must remain unchanged by the fix.
- **postinstall hook**: The `"postinstall": "node scripts/postinstall.js"` entry in root `package.json` `scripts`, run automatically by npm after install.
- **scripts/postinstall.js**: The script that runs `npm ci`/`npm install` against `src-admin/` when `src-admin/package.json` exists, and no-ops otherwise.
- **installNpmLocal()**: The function in `tasks.js` that runs `npm install` in `src-admin/` only when `src-admin/node_modules` is absent. Invoked by the default `node tasks` build pipeline.
- **files allowlist**: The `files` array in `package.json` controlling what ships in the published npm tarball. `src-admin/` is not listed, so it is excluded from the tarball.

## Bug Details

### Bug Condition

The bug manifests when the adapter is installed (as a published package or as a dependency) and npm executes the `postinstall` lifecycle hook, which in turn runs npm operations. The `postinstall` hook exists at all and runs `node scripts/postinstall.js`, which may spawn `npm ci`/`npm install` against `src-admin/`, installing development dependencies on the installing machine.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type InstallEvent
  OUTPUT: boolean

  RETURN input.isInstall = true
         AND input.runsNpmDuringInstall = true
END FUNCTION
```

Where `runsNpmDuringInstall` is true whenever the package's `postinstall` (or any other install-time lifecycle) hook exists and executes npm operations during the install.

### Examples

- **End-user install with source present**: A user installs the adapter from a source that includes `src-admin/package.json`. Expected: no npm work. Actual: `postinstall` runs `npm ci --prefix src-admin`, installing Vite/React dev tooling on the user's machine.
- **Dependency-style install (published tarball)**: `@iobroker/testing` installs the adapter as a dependency; `src-admin/` is not shipped. Expected: no npm work. Actual: `postinstall` still runs `node scripts/postinstall.js`; the script no-ops because `src-admin/package.json` is missing, but a lifecycle hook running arbitrary npm logic still executes.
- **Reviewer observation**: Installing the adapter can pull the complete Vite development environment onto the end user's system because a lifecycle hook runs npm against the source project.
- **Edge case (missing script after partial ship)**: If `scripts/postinstall.js` were absent while the hook remained declared, the install would abort with ENOENT — the exact failure mode the no-op guard was written to avoid.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- `npm run build` (and `npm run build:react` → `node tasks`) SHALL continue to build the admin UI from `src-admin/` (Vite build) and copy the output into `admin/`, bootstrapping `src-admin` dependencies via `installNpmLocal()` when `src-admin/node_modules` is absent.
- After installation, ioBroker SHALL continue to serve the prebuilt admin UI from `admin/` and run the adapter from `build/`.
- The published tarball SHALL continue to exclude the `src-admin/` source project (it remains absent from the `files` allowlist).
- A developer or CI SHALL continue to be able to install `src-admin` dependencies via an explicit dev/CI step.
- `npm run test:package` (via `@iobroker/testing`) and `npm run test:integration` SHALL continue to pass.

**Scope:**
All inputs that do NOT involve a lifecycle hook running npm during install should be completely unaffected by this fix. This includes:
- Explicit developer/CI invocations of the build (`npm run build`) and of the new `install:src-admin` script.
- The Vite build, copy, and patch steps in `tasks.js`.
- Adapter runtime loading of `admin/` and `build/`.
- The contents of the published npm tarball (governed by the `files` allowlist).

**Note:** The actual expected correct behavior for the buggy inputs is defined in the Correctness Properties section (Property 1). This section focuses on what must NOT change.

## Hypothesized Root Cause

Based on the bug description, the cause is unambiguous and structural rather than a logic error:

1. **Presence of an install-time lifecycle hook**: `package.json` declares `"postinstall": "node scripts/postinstall.js"`. npm runs `postinstall` on every install, so any install of the package triggers install-time code execution.
   - The hook was added to bootstrap `src-admin` dev dependencies for CI and local dev.
   - It runs regardless of whether the install is a developer/CI checkout or an end-user/dependency install.

2. **The hook executes npm operations**: `scripts/postinstall.js` spawns `npm ci`/`npm install` against `src-admin/` when `src-admin/package.json` exists, which is exactly the untypical/unwanted behavior for an ioBroker adapter install.

3. **The no-op guard is insufficient**: The guard (`exit 0` when `src-admin/package.json` is absent) only handles the published-tarball case. It does not prevent npm operations when the source is present, and it still leaves a lifecycle hook running arbitrary logic on every install.

4. **Redundancy with the build pipeline**: `tasks.js` already bootstraps `src-admin` deps via `installNpmLocal()` during `npm run build`, so the hook is not required for local/dev builds. CI's build/adapter-tests job runs the build (which bootstraps deps); only the lint job separately needs `src-admin` deps.

## Correctness Properties

Property 1: Bug Condition - No npm operations on install

_For any_ install of the adapter where the bug condition holds (isBugCondition returns true — an install that would run a lifecycle hook executing npm), the fixed package SHALL run zero npm operations during install and SHALL install no `src-admin` development dependencies (Vite, React tooling, etc.). Concretely, after the fix there is no `postinstall` (or other install-time) lifecycle hook in `package.json` that executes npm, so `result.npmOperationsRun = 0` and `result.devDependenciesInstalled = false`.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4**

Property 2: Preservation - Dev/CI build and runtime unchanged

_For any_ input where the bug condition does NOT hold (isBugCondition returns false — explicit developer/CI build invocations, the Vite build/copy/patch pipeline, adapter runtime loading, and published-tarball contents), the fixed code SHALL produce the same result as the original code, preserving: the `npm run build` behavior that builds `src-admin/` and copies output into `admin/` (including `installNpmLocal()` bootstrapping when `src-admin/node_modules` is absent); the runtime serving of `admin/` and `build/`; the exclusion of `src-admin/` from the tarball via the `files` allowlist; and the ability to install `src-admin` deps through an explicit dev/CI step.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:

**File**: `package.json`

**Function/Section**: `scripts` and `files`

**Specific Changes**:
1. **Remove the lifecycle hook**: Delete the `"postinstall": "node scripts/postinstall.js"` entry from `scripts`. This removes all install-time npm execution and is the core of the fix (Requirements 2.1, 2.2).

2. **Remove the shipped script from the allowlist**: Delete `"scripts/postinstall.js"` from the `files` array. Once the hook is gone, there is no reason to ship the script, and this keeps the published tarball minimal. (Requirement 2.3.)

3. **Add an explicit, non-lifecycle install script**: Add a script such as
   `"install:src-admin": "npm ci --prefix src-admin || npm install --prefix src-admin"`
   (or, on platforms/CI where shell `||` is undesirable, a small deliberate `node` invocation). This preserves the ability to install `src-admin` deps as an explicit step rather than an automatic hook (Requirements 2.4, 3.4). Naming it `install:src-admin` (not `preinstall`/`postinstall`) ensures npm does NOT run it automatically on install.

**File**: `scripts/postinstall.js`

**Specific Changes**:
4. **Delete the file**: Remove `scripts/postinstall.js` entirely. With the hook gone and the script removed from `files`, the ENOENT failure mode the no-op guard defended against is eliminated (there is no install-time code left to fail). (Requirements 2.1, 2.4.)

**File**: `.github/workflows/test-and-release.yml`

**Specific Changes**:
5. **Preserve CI dependency bootstrap without a hook**:
   - The `check-and-lint` job (`ioBroker/testing-action-check@v2`, `lint: true`) runs `npm run lint`, which includes `lint --prefix src-admin` and needs `src-admin` node_modules. Add an explicit step invoking `npm run install:src-admin` before lint (or rely on the action's install/build phase). This replaces the implicit bootstrap the `postinstall` hook previously provided.
   - The `adapter-tests` and `deploy` jobs use `build: true`, which runs `npm run build` → `node tasks` → `installNpmLocal()`, so they already bootstrap `src-admin` deps and need no additional step.
   - Verify no other CI step depended on `postinstall` running automatically.

**File**: `tasks.js`

**Specific Changes**:
6. **No change required**: `installNpmLocal()` already installs `src-admin` deps during the default build pipeline when `src-admin/node_modules` is absent. This continues to cover local/dev builds and the CI build/adapter-tests jobs. (Preservation, Requirement 3.1.)

**Verification (no change expected)**:
7. **`files` allowlist still excludes `src-admin/`**: Confirm that after removing `scripts/postinstall.js`, the `files` array still contains no `src-admin` entry, so the source project remains excluded from the published tarball. (Requirement 3.3.)

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code (an install that runs npm operations), then verify the fix removes all install-time npm work while preserving the dev/CI build, tarball contents, and runtime behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm or refute the root cause analysis (that the `postinstall` hook is what runs npm during install). If we refute, we will need to re-hypothesize.

**Test Plan**: Inspect the packaged/installed adapter and observe install-time behavior. Pack the adapter (`npm pack`) and/or perform a dependency-style install into a scratch directory, observing whether any npm operations run and whether `src-admin` dev deps appear. Run these checks on the UNFIXED code to observe the hook firing.

**Test Cases**:
1. **Lifecycle hook present**: Assert `package.json` `scripts.postinstall` is defined and runs `node scripts/postinstall.js` (will be true on unfixed code — demonstrates the hook exists).
2. **Install runs npm with source present**: In a checkout where `src-admin/package.json` exists, run the install lifecycle and observe `npm ci`/`npm install` executing against `src-admin/` (will fail the "no npm on install" expectation on unfixed code).
3. **Dependency-style install executes hook logic**: Install the packed tarball as a dependency and observe that `postinstall` still executes `node scripts/postinstall.js` (no-ops via guard, but confirms install-time code runs) (demonstrates install-time code on unfixed code).
4. **Edge case — ENOENT if script missing**: With the hook declared but `scripts/postinstall.js` absent, observe the install aborting with ENOENT (illustrates the failure mode the guard defended against).

**Expected Counterexamples**:
- `scripts.postinstall` is present and npm executes it on install.
- With `src-admin/package.json` present, `npm ci`/`npm install` runs against `src-admin/` during install.
- Possible causes: presence of the `postinstall` lifecycle hook, the hook spawning npm, reliance on the no-op guard rather than removing the hook.

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed package produces the expected behavior (no npm operations, no dev deps installed).

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := install_fixed(input)
  ASSERT result.npmOperationsRun = 0
      AND result.devDependenciesInstalled = false
END FOR
```

Concretely: after the fix, assert `package.json` has no `postinstall` (or other install-time) lifecycle hook, `scripts/postinstall.js` does not exist, and a dependency-style install of the packed tarball performs no npm operations and pulls no `src-admin` dev dependencies.

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed code produces the same result as the original code.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT install_original(input) = install_fixed(input)
END FOR
```

**Testing Approach**: Property-based testing is recommended for the tarball-contents and build-output preservation because:
- It can generate many `files`-allowlist and directory-shape scenarios automatically across the input domain.
- It catches edge cases (e.g. paths that should/should not be shipped) that manual unit tests might miss.
- It provides strong guarantees that the shipped fileset and build output are unchanged for all non-buggy inputs.

**Test Plan**: Observe behavior on UNFIXED code first for the dev/CI build and tarball contents, then write tests capturing that behavior and re-run after the fix.

**Test Cases**:
1. **Build pipeline preservation**: Observe that `npm run build` builds `src-admin/` and copies output into `admin/` (with `installNpmLocal()` bootstrapping when `src-admin/node_modules` is absent) on unfixed code, then verify this continues after the fix.
2. **Tarball contents preservation**: Observe the packed tarball fileset on unfixed code (excluding `src-admin/`), then verify after the fix the tarball still excludes `src-admin/` and differs only by the removal of `scripts/postinstall.js`.
3. **Runtime preservation**: Observe that the adapter loads and serves `admin/` and runs from `build/` on unfixed code, then verify this continues after the fix.
4. **Explicit dev/CI install preservation**: Verify that `npm run install:src-admin` (and the CI lint job) can still install `src-admin` dependencies after the fix.

### Unit Tests

- Assert `package.json` has no `postinstall` (and no other install-time lifecycle) hook after the fix.
- Assert `scripts/postinstall.js` no longer exists.
- Assert `package.json` `files` array does not contain `scripts/postinstall.js` and contains no `src-admin` entry.
- Assert `package.json` defines a non-lifecycle `install:src-admin` script.

### Property-Based Tests

- Generate candidate file paths and assert none under `src-admin/` are included by the `files` allowlist (tarball preservation across the path domain).
- Generate presence/absence states of `src-admin/node_modules` and assert the build pipeline's bootstrap decision (install only when absent) is unchanged.
- Across generated install scenarios, assert zero install-time npm operations occur (fix property holds for all buggy inputs).

### Integration Tests

- `npm run test:package` (via `@iobroker/testing`) passes with no `postinstall` hook present.
- `npm run test:integration` passes (dependency-style install performs no npm operations and does not abort).
- Full CI dry run: `check-and-lint` installs `src-admin` deps via the explicit step and lints successfully; `adapter-tests` builds (bootstrapping `src-admin` deps via `tasks.js`) and runs adapter tests successfully.
