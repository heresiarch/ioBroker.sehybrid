# Bugfix Requirements Document

## Introduction

The adapter declares a `postinstall` lifecycle hook (`node scripts/postinstall.js`) in `package.json`. This hook runs npm operations (`npm ci --prefix src-admin`, falling back to `npm install --prefix src-admin`) whenever `src-admin/package.json` is present. The script is intended to be a no-op on published installs because `src-admin/` is not part of the `files` allowlist, so the source project should not be shipped in the npm tarball.

ioBroker adapter reviewers report that installing the adapter can nonetheless pull the complete Vite development environment (the `src-admin/` source project and its dev dependencies such as React and Vite tooling) onto the end user's system. Running arbitrary npm operations as part of a package lifecycle hook on end-user machines is untypical for an ioBroker adapter, unnecessary for normal operation, and risks polluting or breaking the user's install. Only the prebuilt admin UI (`admin/`) and adapter build output (`build/`) should be shipped and used at runtime.

This bugfix removes the npm-running install hook so that installing the published adapter performs no npm operations and installs no development dependencies, while preserving the ability to install `src-admin` dependencies during the dev/CI workflow.

## Bug Analysis

### Current Behavior (Defect)

The adapter runs npm operations during installation via a package lifecycle hook, which can install the Vite/React development environment on end-user systems.

1.1 WHEN the published adapter is installed on an end-user ioBroker system THEN the system runs the `postinstall` lifecycle hook that executes npm operations
1.2 WHEN the `postinstall` hook runs and `src-admin/package.json` is present in the installed package THEN the system executes `npm ci`/`npm install` against `src-admin`, installing development dependencies (Vite, React tooling, etc.) on the end user's machine
1.3 WHEN the adapter is installed as a dependency (published tarball) THEN the system still relies on a lifecycle hook running arbitrary npm operations rather than performing no install-time work

### Expected Behavior (Correct)

Installing the published adapter must not trigger any npm operations or install any development dependencies.

2.1 WHEN the published adapter is installed on an end-user ioBroker system THEN the system SHALL NOT run any npm operations as part of installation
2.2 WHEN the adapter is installed on any end-user system THEN the system SHALL NOT install `src-admin` development dependencies (Vite, React tooling, etc.)
2.3 WHEN the adapter is installed THEN the system SHALL ship and use only the prebuilt admin UI (`admin/`) and adapter build output (`build/`)
2.4 WHEN `src-admin` development dependencies are needed THEN the system SHALL install them only through the dev/CI workflow and not through a package lifecycle hook that runs on end-user installs

### Unchanged Behavior (Regression Prevention)

Existing build, development, and runtime behavior must continue to work.

3.1 WHEN a developer runs the build workflow (`npm run build`) THEN the system SHALL CONTINUE TO build the admin UI from `src-admin/` (Vite build) and copy the output into `admin/`
3.2 WHEN the adapter is loaded by ioBroker after installation THEN the system SHALL CONTINUE TO serve the prebuilt admin UI from `admin/` and run from `build/`
3.3 WHEN the published tarball is produced THEN the system SHALL CONTINUE TO exclude the `src-admin/` source project (it remains absent from the `files` allowlist)
3.4 WHEN a developer or CI needs `src-admin` dependencies for linting or building THEN the system SHALL CONTINUE TO be able to install them via an explicit dev/CI step

## Bug Condition and Property Specification

### Bug Condition

The bug condition identifies installs that would trigger unwanted npm operations.

```pascal
FUNCTION isBugCondition(X)
  INPUT: X of type InstallEvent
  OUTPUT: boolean

  // The bug is triggered whenever installing the adapter runs a
  // package lifecycle hook that executes npm operations.
  RETURN X.isInstall = true AND X.runsNpmDuringInstall = true
END FUNCTION
```

### Property: Fix Checking

```pascal
// Property: Fix Checking - No npm operations on install
FOR ALL X WHERE isBugCondition(X) DO
  result ← install'(X)
  ASSERT result.npmOperationsRun = 0
      AND result.devDependenciesInstalled = false
END FOR
```

### Property: Preservation Checking

```pascal
// Property: Preservation Checking - Dev/CI build and runtime unchanged
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT install(X) = install'(X)
END FOR
```

- **F**: The adapter's install/build behavior before the fix (with the npm-running `postinstall` hook).
- **F'**: The adapter's install/build behavior after the fix (no npm operations on install; dev deps installed only via explicit dev/CI step).
