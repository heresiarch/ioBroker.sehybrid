'use strict';

// Bug condition exploration test for the "modbus-register-reference-to-readme" bugfix spec.
//
// Property 1: Bug Condition - Register Reference on the Buggy Surfaces
//
// Design bug condition (isBugCondition over render/documentation surfaces):
//
//   RETURN (surface = AdminConfigForm AND rendersRegisterReferenceTable)
//       OR (surface = Readme        AND registerReferenceMissingOrUnsynced)
//
// The two surfaces are static, deterministic artifacts (the Settings.tsx source
// and README.md), so this test scopes the property to the two concrete failing
// cases named in the design rather than randomizing surfaces.
//
// This test encodes the EXPECTED POST-FIX (corrected) state, so it is
// EXPECTED TO FAIL on unfixed code. Each failure confirms the bug exists on a
// surface:
//   - AdminConfigForm: Settings.tsx still references the register-table machinery
//     (renderValueTable / renderStorEdgeTable, the SunSpec selectors,
//     STOREDGE_CONTROL_REGISTERS, and the MUI Accordion/Table imports).
//   - Readme: README.md carries no generated register-reference markers and no
//     synced per-register SunSpec reference.
//
// After the fix (task 3) the register tables are gone from Settings.tsx and the
// README carries generated, synced tables, so these assertions flip to PASS,
// validating the fix.
//
// DO NOT fix the test or the code when it fails here - the failure is the
// success case for a bugfix exploration test.
//
// Validates: Requirements 1.1, 1.2, 1.3, 1.5, 1.6, 2.1, 2.2, 2.5, 2.8

const fs = require('fs');
const path = require('path');
const { expect } = require('chai');

const rootDir = path.join(__dirname, '..');

const SETTINGS_PATH = path.join(rootDir, 'src-admin', 'src', 'components', 'Settings.tsx');
const README_PATH = path.join(rootDir, 'README.md');

/** Read a UTF-8 text file from disk. */
function readText(file) {
    return fs.readFileSync(file, 'utf8');
}

// The register-table machinery that only exists to render the reference tables
// in the Admin config form. On fixed code, none of these appear in Settings.tsx.
const REGISTER_TABLE_RENDERERS = ['renderValueTable', 'renderStorEdgeTable'];
const SUNSPEC_SELECTORS = ['getInverterValueDefs', 'getMeterValueDefs', 'getBatteryValueDefs'];
const STOREDGE_SYMBOL = 'STOREDGE_CONTROL_REGISTERS';
const MUI_TABLE_IMPORTS = [
    "@mui/material/Table",
    "@mui/material/Accordion",
];

// The generated-reference markers the README must carry after the fix. Each
// block is fenced by a BEGIN/END pair so prose outside the markers is untouched.
const GENERATED_BLOCKS = ['sunspec-inverter', 'sunspec-meter', 'sunspec-battery', 'storedge-control'];

describe('Bug condition: register reference on the buggy surfaces (modbus-register-reference-to-readme)', () => {
    // ---- Surface 1: AdminConfigForm must NOT render register reference tables (post-fix) ----
    describe('Surface AdminConfigForm - Settings.tsx renders only the four config fields', () => {
        const src = readText(SETTINGS_PATH);

        REGISTER_TABLE_RENDERERS.forEach((renderer) => {
            it(`Settings.tsx does not define/invoke ${renderer}()`, () => {
                expect(src, `Settings.tsx should not reference ${renderer}`).to.not.include(renderer);
            });
        });

        SUNSPEC_SELECTORS.forEach((selector) => {
            it(`Settings.tsx does not import the SunSpec value selector ${selector}`, () => {
                expect(src, `Settings.tsx should not reference ${selector}`).to.not.include(selector);
            });
        });

        it(`Settings.tsx does not reference ${STOREDGE_SYMBOL}`, () => {
            expect(src, `Settings.tsx should not reference ${STOREDGE_SYMBOL}`).to.not.include(STOREDGE_SYMBOL);
        });

        MUI_TABLE_IMPORTS.forEach((imp) => {
            it(`Settings.tsx does not import the MUI table/accordion component ${imp}`, () => {
                expect(src, `Settings.tsx should not import ${imp}`).to.not.include(imp);
            });
        });
    });

    // ---- Surface 2: README must carry generated, synced register reference (post-fix) ----
    describe('Surface Readme - README.md carries generated register-reference markers', () => {
        const readme = readText(README_PATH);

        GENERATED_BLOCKS.forEach((block) => {
            it(`README.md contains the BEGIN marker for the ${block} block`, () => {
                expect(readme, `README.md should contain the ${block} BEGIN marker`).to.include(
                    `<!-- BEGIN:GENERATED:${block} -->`,
                );
            });

            it(`README.md contains the END marker for the ${block} block`, () => {
                expect(readme, `README.md should contain the ${block} END marker`).to.include(
                    `<!-- END:GENERATED:${block} -->`,
                );
            });
        });
    });
});
