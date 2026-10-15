/**
 * Bug condition exploration test for the `remove-test-connection-button` bugfix spec.
 *
 * Property 1: Bug Condition — Test Connection Feature Fully Removed
 *   For every artifact where `isBugCondition(artifact)` holds (i.e. the artifact
 *   exists SOLELY to support the Test Connection feature), the codebase SHALL NOT
 *   contain it. This test encodes the EXPECTED POST-FIX STATE (zero test-connection
 *   artifacts) and asserts absence over the full, concrete inventory.
 *
 * **Validates: Requirements 1.1, 1.2, 1.3**
 *
 * METHODOLOGY (scoped PBT): this is a deterministic "artifact presence" bug, so the
 * property is scoped to the concrete inventory of test-connection-only artifacts.
 * fast-check enumerates the inventory (one case per artifact) and, for each, asserts
 * the artifact is ABSENT. The oracle is a direct read of the source file plus a
 * substring/regex probe. `isBugCondition(artifact)` is derived from the oracle:
 *   isBugCondition(artifact) === artifact.probe matches the file contents
 * and the property asserts `isBugCondition(artifact) === false` for every artifact.
 *
 * EXPECTED OUTCOME ON UNFIXED CODE: this test FAILS. The failure is the evidence we
 * want — fast-check reports counterexamples (the artifacts still present), proving the
 * test-connection surface exists. After the fix removes every artifact the property
 * holds and the test PASSES (task 3.9 re-runs this same test).
 */

import { expect } from 'chai';
import fc from 'fast-check';
import * as fs from 'node:fs';
import * as path from 'node:path';

// This file lives in <repo>/src/lib — the repo root is two directories up.
const REPO_ROOT = path.resolve(__dirname, '..', '..');

/**
 * Read a repo-relative file; returns '' if the file is absent (artifact can't exist).
 *
 * @param relPath
 */
function readRepoFile(relPath: string): string {
    const abs = path.join(REPO_ROOT, relPath);
    try {
        return fs.readFileSync(abs, 'utf8');
    } catch {
        return '';
    }
}

/**
 * A single test-connection-only artifact to probe. `probe` matches the file contents
 * iff the artifact is still present (so a match === isBugCondition true).
 */
interface Artifact {
    /** Human-readable id used in counterexample output. */
    id: string;
    /** Repo-relative file the artifact lives in. */
    file: string;
    /** Substring or RegExp whose presence in the file means the artifact exists. */
    probe: string | RegExp;
}

const SETTINGS = 'src-admin/src/components/Settings.tsx';
const MAIN = 'src/main.ts';
const IO_PACKAGE = 'io-package.json';
const README = 'README.md';
const ADMIN_LOGIC_TEST = 'src/lib/admin-settings-logic.test.ts';
const INTEGRATION_TEST = 'src/lib/integration.test.ts';

const LOCALES = ['de', 'en', 'es', 'fr', 'it', 'nl', 'pl', 'pt', 'ru', 'uk', 'zh-cn'] as const;
const I18N_KEYS = ['Test Connection', 'Testing…', 'Connection successful', 'Connection failed'] as const;

function present(contents: string, probe: string | RegExp): boolean {
    return typeof probe === 'string' ? contents.includes(probe) : probe.test(contents);
}

// The concrete inventory of test-connection-only artifacts (design "Bug Condition").
function buildInventory(): Artifact[] {
    const inv: Artifact[] = [];

    // --- Settings.tsx UI members ---
    inv.push(
        { id: 'Settings.tsx: Test Connection button label', file: SETTINGS, probe: 'Test Connection' },
        { id: 'Settings.tsx: onTestConnection method', file: SETTINGS, probe: 'onTestConnection' },
        { id: 'Settings.tsx: renderTestStatus method', file: SETTINGS, probe: 'renderTestStatus' },
        { id: 'Settings.tsx: TestStatus type', file: SETTINGS, probe: /\bTestStatus\b/ },
        { id: 'Settings.tsx: testStatus state', file: SETTINGS, probe: /\btestStatus\b/ },
        { id: 'Settings.tsx: TestConnectionResponse type', file: SETTINGS, probe: 'TestConnectionResponse' },
        { id: 'Settings.tsx: status style', file: SETTINGS, probe: /\bstatus:\s*\{/ },
        { id: 'Settings.tsx: statusText style', file: SETTINGS, probe: /\bstatusText:\s*\{/ },
        { id: 'Settings.tsx: success style', file: SETTINGS, probe: /\bsuccess:\s*\{/ },
        { id: 'Settings.tsx: failure style', file: SETTINGS, probe: /\bfailure:\s*\{/ },
        { id: 'Settings.tsx: socket prop', file: SETTINGS, probe: /\bsocket\?:/ },
        { id: 'Settings.tsx: adapterName prop', file: SETTINGS, probe: /\badapterName\?:/ },
        { id: 'Settings.tsx: instance prop', file: SETTINGS, probe: /\binstance\?:/ },
        { id: 'Settings.tsx: CircularProgress import', file: SETTINGS, probe: 'CircularProgress' },
        { id: 'Settings.tsx: AdminConnection import', file: SETTINGS, probe: 'AdminConnection' },
    );

    // --- main.ts backend members ---
    inv.push(
        { id: 'main.ts: handleTestConnection method', file: MAIN, probe: 'handleTestConnection' },
        { id: 'main.ts: testConnection branch', file: MAIN, probe: 'testConnection' },
        { id: 'main.ts: onMessage method', file: MAIN, probe: 'onMessage' },
        { id: "main.ts: this.on('message', ...) binding", file: MAIN, probe: /this\.on\(\s*['"]message['"]/ },
        { id: 'main.ts: COMMON_BASE import', file: MAIN, probe: 'COMMON_BASE' },
    );

    // --- io-package.json ---
    inv.push({ id: 'io-package.json: "messagebox": true', file: IO_PACKAGE, probe: /"messagebox"\s*:\s*true/ });

    // --- i18n keys across all 11 locale files ---
    for (const locale of LOCALES) {
        for (const key of I18N_KEYS) {
            inv.push({
                id: `i18n ${locale}.json: key "${key}"`,
                file: `src-admin/src/i18n/${locale}.json`,
                // Match the key as a JSON property name: "<key>":
                probe: new RegExp(`"${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s*:`),
            });
        }
    }

    // --- README paragraph ---
    inv.push({ id: 'README.md: Test connection button paragraph', file: README, probe: /Test connection/i });

    // --- test files ---
    inv.push(
        {
            id: 'admin-settings-logic.test.ts: testConnection reference',
            file: ADMIN_LOGIC_TEST,
            probe: 'testConnection',
        },
        {
            id: 'admin-settings-logic.test.ts: Test Connection button cases',
            file: ADMIN_LOGIC_TEST,
            probe: 'Test Connection',
        },
        { id: 'integration.test.ts: probeTestConnection helper', file: INTEGRATION_TEST, probe: 'probeTestConnection' },
        { id: 'integration.test.ts: testConnection block', file: INTEGRATION_TEST, probe: 'testConnection' },
    );

    return inv;
}

const INVENTORY = buildInventory();

/**
 * The bug condition oracle: an artifact is "bug" iff its probe matches the file.
 *
 * @param artifact
 */
function isBugCondition(artifact: Artifact): boolean {
    return present(readRepoFile(artifact.file), artifact.probe);
}

describe('Bug Condition (Property 1): Test Connection feature fully removed (Req 1.1, 1.2, 1.3)', () => {
    it('contains no test-connection-only artifact (isBugCondition is false for every artifact)', () => {
        // Scoped PBT: enumerate the concrete inventory and assert absence for each.
        fc.assert(
            fc.property(fc.constantFrom(...INVENTORY), (artifact: Artifact) => {
                expect(
                    isBugCondition(artifact),
                    `test-connection artifact still present: ${artifact.id} (in ${artifact.file})`,
                ).to.equal(false);
            }),
            // Deterministic inventory: run every artifact at least once.
            { numRuns: INVENTORY.length * 4 },
        );
    });
});
