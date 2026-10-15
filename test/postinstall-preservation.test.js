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
// It covers one non-buggy behavior that still holds after the jsonConfig migration:
//   1. The `files` allowlist in package.json ships no `src-admin/` content
//      (the published tarball excludes the source project). Requirement 3.3.
//
// Validates: Requirements 3.3

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
            'admin/jsonConfig.json',
            'admin/i18n/en.json',
            'admin/sehybrid.png',
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
