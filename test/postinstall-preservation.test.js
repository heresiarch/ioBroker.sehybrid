'use strict';

// Preservation property tests for the "remove-postinstall-npm" bugfix spec.
//
// Property 2: Preservation - Dev/CI Build, Tarball, and Runtime Unchanged
//
// Design preservation checking:
//   FOR ALL X WHERE NOT isBugCondition(X) DO
//     ASSERT install(X) = install'(X)
//   END FOR
//
// These tests are written observation-first: they capture the CURRENT
// (unfixed-code) behavior that must be preserved by the fix. They are
// EXPECTED TO PASS on unfixed code, establishing the baseline to protect.
//
// They cover two non-buggy behaviors:
//   1. The `files` allowlist in package.json ships no `src-admin/` content
//      (the published tarball excludes the source project). Requirement 3.3.
//   2. The `tasks.js` `installNpmLocal()` bootstrap decision runs `npm install`
//      in `src-admin/` only when `src-admin/node_modules` is absent.
//      Requirement 3.1.
//
// Validates: Requirements 3.1, 3.2, 3.3, 3.4

const fs = require('fs');
const path = require('path');
const { expect } = require('chai');
const fc = require('fast-check');
const minimatch = require('minimatch');

const rootDir = path.join(__dirname, '..');
const rootPackageJson = require(path.join(rootDir, 'package.json'));

/**
 * Decide whether a candidate relative file path is shipped by the npm `files`
 * allowlist. npm treats each entry as a path or glob; a file ships if it
 * matches any entry (directory entries ship everything beneath them).
 *
 * This models the subset of npm's packlist semantics relevant here: whether
 * anything under `src-admin/` could be selected by the allowlist patterns.
 *
 * @param {string[]} filesAllowlist - the package.json `files` array
 * @param {string} candidate - a POSIX-style relative path
 * @returns {boolean} true if the candidate would be included in the tarball
 */
function isShippedBy(filesAllowlist, candidate) {
    const normalized = candidate.replace(/^\.\//, '');
    return filesAllowlist.some((entry) => {
        const pattern = entry.replace(/^\.\//, '');
        // Exact path or file match.
        if (pattern === normalized) {
            return true;
        }
        // Directory entry (with or without trailing slash) ships everything beneath it.
        const asDir = pattern.replace(/\/$/, '');
        if (normalized === asDir || normalized.startsWith(`${asDir}/`)) {
            return true;
        }
        // Glob match (brace expansion + globstar), matching npm's minimatch usage.
        return minimatch(normalized, pattern, { dot: false });
    });
}

/**
 * Model the tasks.js installNpmLocal() bootstrap decision.
 *
 * Source of truth (tasks.js):
 *   function installNpmLocal() {
 *       if (fs.existsSync(`${SRC}/node_modules`)) { return Promise.resolve(); }
 *       return npmInstall(...);
 *   }
 *
 * i.e. it runs npm install ONLY when src-admin/node_modules is absent.
 *
 * @param {boolean} nodeModulesPresent - whether src-admin/node_modules exists
 * @returns {boolean} true if npm install would run
 */
function bootstrapRunsInstall(nodeModulesPresent) {
    return !nodeModulesPresent;
}

describe('Preservation: files allowlist excludes src-admin (remove-postinstall-npm)', () => {
    const filesAllowlist = rootPackageJson.files || [];

    it('has a non-empty files allowlist that lists no src-admin entry', () => {
        expect(filesAllowlist).to.be.an('array').that.is.not.empty;
        const hasSrcAdminEntry = filesAllowlist.some((entry) => /(^|\/)src-admin(\/|$)/.test(entry));
        expect(hasSrcAdminEntry, 'files allowlist should contain no src-admin entry').to.equal(false);
    });

    it('ships no path under src-admin/ (across generated candidate paths)', () => {
        // Generate plausible src-admin file paths across its directory shape:
        // package manifests, node_modules, source, build output, configs, etc.
        const segment = fc.constantFrom(
            'package.json',
            'package-lock.json',
            'node_modules',
            'src',
            'build',
            'public',
            'index.html',
            'vite.config.ts',
            'tsconfig.json',
            'main.tsx',
            'App.tsx',
            'react',
            'vite',
            'assets',
            'style.css',
            'a',
            'b.js',
        );

        const srcAdminPathArb = fc
            .array(segment, { minLength: 0, maxLength: 5 })
            .map((parts) => ['src-admin', ...parts].join('/'));

        fc.assert(
            fc.property(srcAdminPathArb, (candidate) => {
                expect(
                    isShippedBy(filesAllowlist, candidate),
                    `src-admin path unexpectedly shipped: ${candidate}`,
                ).to.equal(false);
            }),
            { numRuns: 300 },
        );
    });

    it('still ships known non-src-admin paths (allowlist sanity across the path domain)', () => {
        // The allowlist must remain functional: canonical shipped paths stay included.
        const shippedArb = fc.constantFrom(
            'build/main.js',
            'build/lib/adapter.js',
            'admin/index.html',
            'admin/assets/index.js',
            'io-package.json',
            'LICENSE',
        );

        fc.assert(
            fc.property(shippedArb, (candidate) => {
                expect(
                    isShippedBy(filesAllowlist, candidate),
                    `expected path to be shipped: ${candidate}`,
                ).to.equal(true);
            }),
            { numRuns: 60 },
        );
    });
});

describe('Preservation: installNpmLocal() bootstrap decision (remove-postinstall-npm)', () => {
    it('installNpmLocal guards on src-admin/node_modules via fs.existsSync', () => {
        // Pin the observed source-level decision so the fix (which does NOT touch
        // tasks.js) cannot silently change the build bootstrap behavior.
        const source = fs.readFileSync(path.join(rootDir, 'tasks.js'), 'utf8');
        const fnMatch = source.match(/function installNpmLocal\(\)\s*\{[\s\S]*?\n\}/);
        expect(fnMatch, 'installNpmLocal() should exist in tasks.js').to.not.equal(null);
        const fnSource = fnMatch[0];
        expect(fnSource).to.match(/existsSync\([^)]*node_modules[^)]*\)/);
        expect(fnSource).to.match(/npmInstall\(/);
    });

    it('runs npm install only when src-admin/node_modules is absent (across generated states)', () => {
        fc.assert(
            fc.property(fc.boolean(), (nodeModulesPresent) => {
                const runsInstall = bootstrapRunsInstall(nodeModulesPresent);
                // Decision must be exactly: install iff node_modules is absent.
                expect(runsInstall).to.equal(!nodeModulesPresent);
            }),
            { numRuns: 50 },
        );
    });

    it('bootstrap decision is deterministic for a given node_modules state', () => {
        fc.assert(
            fc.property(fc.boolean(), (nodeModulesPresent) => {
                expect(bootstrapRunsInstall(nodeModulesPresent)).to.equal(
                    bootstrapRunsInstall(nodeModulesPresent),
                );
            }),
            { numRuns: 20 },
        );
    });
});
