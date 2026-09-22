'use strict';

// Bug condition exploration test for the "remove-postinstall-npm" bugfix spec.
//
// Property 1: Bug Condition - No npm Operations on Install
//
// Design bug condition:
//   isBugCondition(input) = input.isInstall AND input.runsNpmDuringInstall
//
// The bug is triggered whenever installing the adapter runs a package
// lifecycle hook that executes npm operations. The structural signal for that
// in this repo is the presence of a `postinstall` (or any other install-time)
// lifecycle hook in root package.json that shells out to a script running npm.
//
// This test encodes the EXPECTED (fixed) behavior:
//   result.npmOperationsRun = 0 AND result.devDependenciesInstalled = false
// i.e. root package.json declares NO install-time lifecycle hook that runs npm.
//
// It is EXPECTED TO FAIL on unfixed code, because scripts.postinstall is
// currently "node scripts/postinstall.js" (which runs `npm ci`/`npm install`
// against src-admin). The failure confirms the bug exists.
//
// Validates: Requirements 1.1, 1.2, 1.3, 2.1, 2.2, 2.4

const path = require('path');
const { expect } = require('chai');
const fc = require('fast-check');

const rootPackageJson = require(path.join(__dirname, '..', 'package.json'));

// npm lifecycle hooks that run automatically during an install.
// If any of these is defined and executes npm, an install runs npm operations.
const INSTALL_TIME_LIFECYCLE_HOOKS = ['preinstall', 'install', 'postinstall'];

/**
 * Model the fixed install behavior for a given install event.
 *
 * @param {object} pkg - the root package.json object
 * @param {object} installEvent - an InstallEvent variant
 * @returns {{ npmOperationsRun: number, devDependenciesInstalled: boolean }}
 */
function simulateInstall(pkg, installEvent) {
    const scripts = pkg.scripts || {};

    // Count install-time lifecycle hooks that would execute npm operations.
    // A hook "runs npm during install" if it invokes npm directly, or shells
    // out to a script whose purpose is to run npm (e.g. scripts/postinstall.js).
    let npmOperationsRun = 0;
    for (const hook of INSTALL_TIME_LIFECYCLE_HOOKS) {
        const cmd = scripts[hook];
        if (typeof cmd !== 'string') {
            continue;
        }
        const runsNpm = /\bnpm\b/.test(cmd) || /postinstall\.js/.test(cmd);
        if (runsNpm) {
            npmOperationsRun++;
        }
    }

    // Whether dev dependencies (src-admin Vite/React tooling) would be
    // installed depends on install-time npm operations running at all.
    // The exploration only needs to observe that no install-time npm runs.
    const devDependenciesInstalled = npmOperationsRun > 0 && installEvent.sourcePresent;

    return { npmOperationsRun, devDependenciesInstalled };
}

describe('Bug condition: no npm operations on install (remove-postinstall-npm)', () => {
    it('package.json declares no install-time lifecycle hook that runs npm (all install-event variants)', () => {
        // Generate install-event variants covering the design examples:
        // source present, source absent, and dependency-style installs.
        const installEventArb = fc.record({
            isInstall: fc.constant(true),
            // src-admin/package.json present in the installed tree
            sourcePresent: fc.boolean(),
            // installed as a dependency (published tarball) vs. direct checkout
            dependencyStyle: fc.boolean(),
        });

        fc.assert(
            fc.property(installEventArb, (installEvent) => {
                const result = simulateInstall(rootPackageJson, installEvent);

                // Property 1 (Expected Behavior):
                expect(result.npmOperationsRun).to.equal(0);
                expect(result.devDependenciesInstalled).to.equal(false);
            }),
            { numRuns: 100 },
        );
    });

    it('scripts.postinstall is undefined (no install-time hook)', () => {
        const scripts = rootPackageJson.scripts || {};
        expect(scripts.postinstall, 'package.json scripts.postinstall').to.equal(undefined);
    });
});
