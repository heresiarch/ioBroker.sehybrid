'use strict';

// README register-reference sync gate for the "modbus-register-reference-to-readme"
// bugfix spec. This is the CI/package-tier gate described in the design
// (Fix Implementation 2 — Integration points; Testing Strategy → Integration Tests
// "Drift gate"): it invokes the generator's `--check` logic in-process so that
// `npm run test` (and thus the adapter-tests CI job) fails whenever README.md has
// drifted from the source maps.
//
// Three guarantees are asserted:
//   1. CI gate (Req 2.7): checkReadmeFile() reports the real on-disk README.md as
//      in-sync. If someone edits a map (src/lib/sunspec-map.ts or
//      storedge-control-map.ts) without regenerating, this fails.
//   2. Round-trip idempotence: injectAllBlocks on the current README then
//      checkReadme reports in-sync — regenerating produces no change.
//   3. Drift detection: a fixture README whose block body was mutated makes
//      checkReadme report that block in driftedBlocks with inSync === false.
//
// The generator lives in scripts/generate-register-readme.ts. Register ts-node so
// this package-tier .js test can import that TypeScript module directly, mirroring
// the mechanism test/readme-register-reference.preservation.test.js uses (same
// TS_NODE settings as test/mocha.setup.js so the root tsconfig and the global
// `ioBroker` type namespace are picked up when transpiling the src/lib TS the
// generator depends on).
//
// Validates: Requirements 2.7

const fs = require('fs');
const path = require('path');
const { expect } = require('chai');

process.env.TS_NODE_IGNORE_WARNINGS = 'TRUE';
process.env.TS_NODE_PROJECT = process.env.TS_NODE_PROJECT || 'tsconfig.json';
process.env.TS_NODE_FILES = process.env.TS_NODE_FILES || 'TRUE';
// @ts-ignore -- ts-node/register ships no type declarations; this is a runtime hook.
require('ts-node/register');

const rootDir = path.join(__dirname, '..');
const README_PATH = path.join(rootDir, 'README.md');

/* eslint-disable @typescript-eslint/no-var-requires */
// @ts-ignore -- the generator is a .ts module imported through the ts-node hook above.
const generator = require('../scripts/generate-register-readme.ts');
/* eslint-enable @typescript-eslint/no-var-requires */

const {
    buildGeneratedBlocks,
    injectAllBlocks,
    checkReadme,
    checkReadmeFile,
    GENERATED_BLOCK_IDS,
    beginMarker,
    endMarker,
} = generator;

/**
 * Read a UTF-8 text file from disk.
 *
 * @param {string} file Path to the file.
 * @returns {string}
 */
function readText(file) {
    return fs.readFileSync(file, 'utf8');
}

describe('README register-reference sync gate (modbus-register-reference-to-readme)', () => {
    // ---- 1: CI gate — the real on-disk README must be in sync (Req 2.7) ----
    describe('CI gate: on-disk README.md is in sync with the source maps', () => {
        it('checkReadmeFile() reports the real README.md as in-sync', () => {
            const result = checkReadmeFile(README_PATH);
            expect(
                result.inSync,
                `README.md is out of sync with the source maps. Run \`npm run docs:readme\` to regenerate.\n${result.summary}`,
            ).to.equal(true);
            expect(result.driftedBlocks, 'no block should have drifted').to.deep.equal([]);
        });

        it('all four managed blocks are present and individually in-sync', () => {
            const readme = readText(README_PATH);
            const blocks = buildGeneratedBlocks();
            GENERATED_BLOCK_IDS.forEach(id => {
                expect(readme, `README.md must contain the begin marker for "${id}"`).to.include(beginMarker(id));
                expect(readme, `README.md must contain the end marker for "${id}"`).to.include(endMarker(id));
                const single = checkReadme(readme, blocks);
                expect(single.driftedBlocks, `block "${id}" must not be reported as drifted`).to.not.include(id);
            });
        });
    });

    // ---- 2: round-trip idempotence (regenerate right after docs:readme passes) ----
    describe('round-trip idempotence', () => {
        it('injectAllBlocks on the current README then checkReadme reports in-sync', () => {
            const readme = readText(README_PATH);
            // Simulate `npm run docs:readme` in memory (no file written).
            const regenerated = injectAllBlocks(readme);
            const result = checkReadme(regenerated);
            expect(result.inSync, `regenerated README must be in sync:\n${result.summary}`).to.equal(true);
            expect(result.driftedBlocks).to.deep.equal([]);
        });

        it('regenerating is idempotent (a second injectAllBlocks changes nothing)', () => {
            const readme = readText(README_PATH);
            const once = injectAllBlocks(readme);
            const twice = injectAllBlocks(once);
            expect(twice, 'regeneration must be a fixed point').to.equal(once);
        });
    });

    // ---- 3: drift detection — mutating a block body is caught ----
    describe('drift detection', () => {
        it('a mutated block body makes checkReadme report that block as drifted', () => {
            const blocks = buildGeneratedBlocks();
            // Start from a correctly-generated fixture README so only the mutation
            // we introduce can cause drift.
            const fixture = injectAllBlocks(readText(README_PATH));

            // Pick a block and corrupt a single row inside its markers, leaving the
            // markers and all other blocks untouched.
            const targetId = 'sunspec-inverter';
            const begin = beginMarker(targetId);
            const beginIndex = fixture.indexOf(begin);
            const bodyStart = beginIndex + begin.length;
            const endIndex = fixture.indexOf(endMarker(targetId));
            const originalBody = fixture.slice(bodyStart, endIndex);
            const mutatedBody = `${originalBody.replace(/\n/, '\n| DRIFT | 0 | DRIFT | 0 | injected |\n')}`;
            const mutated = fixture.slice(0, bodyStart) + mutatedBody + fixture.slice(endIndex);

            expect(mutated, 'the fixture must actually change').to.not.equal(fixture);

            const result = checkReadme(mutated, blocks);
            expect(result.inSync, 'mutated README must be reported out of sync').to.equal(false);
            expect(result.driftedBlocks, 'the mutated block must be flagged').to.include(targetId);
            expect(result.summary, 'summary should mention the drifted block').to.include(targetId);
        });

        it('a missing marker pair is reported as drift (not silently ignored)', () => {
            const fixture = injectAllBlocks(readText(README_PATH));
            const targetId = 'storedge-control';
            // Remove the begin marker so the pair is malformed.
            const broken = fixture.replace(beginMarker(targetId), '<!-- removed marker -->');

            const result = checkReadme(broken);
            expect(result.inSync, 'README with a missing marker must be out of sync').to.equal(false);
            expect(result.driftedBlocks, 'the block with the missing marker must be flagged').to.include(targetId);
        });

        it('an unmutated fixture stays in-sync (no false positives)', () => {
            const fixture = injectAllBlocks(readText(README_PATH));
            const result = checkReadme(fixture);
            expect(result.inSync, 'an untouched regenerated fixture must be in sync').to.equal(true);
            expect(result.driftedBlocks).to.deep.equal([]);
        });
    });
});
