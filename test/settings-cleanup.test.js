'use strict';

// Settings.tsx cleanup unit test for the "modbus-register-reference-to-readme"
// bugfix spec (task 3.5).
//
// Design: Fix Implementation 3 (Admin UI cleanup) + Testing Strategy -> Unit Tests
// ("Settings.tsx cleanup unit test: assert the trimmed component renders only the
//  four fields and references none of the removed helpers/imports").
//
// After the fix, src-admin/src/components/Settings.tsx must:
//   - render only the four config fields (host, port, unit ID, polling interval),
//   - retain the field machinery (toNumber, currentConfig, errors,
//     renderNumberField, renderHostField) and validateConfig / TextField /
//     { I18n, type IobTheme },
//   - reference none of the removed table-only helpers, imports, or styles.
//
// This is a source-text assertion test (mirroring the explore test and
// review-fixes-remove-admin-tab.test.js) because the .tsx is a React component
// consumed only by the Vite admin bundle; the package test tier reads it as text.
//
// Validates: Requirements 2.1, 2.2, 2.3

const fs = require('fs');
const path = require('path');
const { expect } = require('chai');

const rootDir = path.join(__dirname, '..');
const SETTINGS_PATH = path.join(rootDir, 'src-admin', 'src', 'components', 'Settings.tsx');

/** Read a UTF-8 text file from disk.
 * @param {string} file Absolute path to the file to read.
 * @returns {string} The file contents.
 */
function readText(file) {
    return fs.readFileSync(file, 'utf8');
}

const src = readText(SETTINGS_PATH);

// ---- Removed table-only machinery (methods + local helpers) ----
const REMOVED_METHODS = ['renderValueTable', 'renderStorEdgeTable', 'renderTableFor'];
const REMOVED_LOCAL_HELPERS = ['formatAddress', 'formatRange'];

// ---- Removed imports: sunspec-map / storedge-control-map table-only symbols ----
const REMOVED_MAP_IMPORTS = [
    'getRegisterAddress',
    'getInverterValueDefs',
    'getMeterValueDefs',
    'getBatteryValueDefs',
    'getBatteryBase',
    'getDeviceRegisterAddress',
    'SunSpecRegisterDef',
    'STOREDGE_CONTROL_REGISTERS',
    'StorEdgeControlRegisterDef',
];

// ---- Removed MUI table/accordion imports ----
const REMOVED_MUI_IMPORTS = [
    '@mui/material/Table',
    '@mui/material/TableHead',
    '@mui/material/TableBody',
    '@mui/material/TableRow',
    '@mui/material/TableCell',
    '@mui/material/Paper',
    '@mui/material/Accordion',
    '@mui/material/AccordionSummary',
    '@mui/material/AccordionDetails',
    '@mui/icons-material/ExpandMore',
    '@mui/material/Typography',
];
const REMOVED_MUI_SYMBOLS = [
    'Typography',
    'TableHead',
    'TableBody',
    'TableRow',
    'TableCell',
    'AccordionSummary',
    'AccordionDetails',
    'ExpandMoreIcon',
];

// ---- Removed table-only style keys ----
const REMOVED_STYLE_KEYS = ['tableWrapper', 'scrollBox', 'accordionDetails'];

// ---- Retained field machinery ----
const RETAINED_MEMBERS = ['toNumber', 'currentConfig', 'errors', 'renderNumberField', 'renderHostField'];

// ---- The four config fields the trimmed form must emit ----
const FIELD_INVOCATIONS = [
    'this.renderHostField(',
    "this.renderNumberField('Port', 'Invalid port', 'port'",
    "this.renderNumberField('Unit ID', 'Invalid unit ID', 'unitId'",
    "'Polling interval (s)',",
];

describe('Settings.tsx cleanup (modbus-register-reference-to-readme task 3.5)', () => {
    describe('removed table-only methods and local helpers', () => {
        REMOVED_METHODS.forEach(name => {
            it(`does not reference the removed method ${name}`, () => {
                expect(src, `Settings.tsx should not reference ${name}`).to.not.include(name);
            });
        });

        REMOVED_LOCAL_HELPERS.forEach(name => {
            it(`does not reference the removed local helper ${name}`, () => {
                expect(src, `Settings.tsx should not reference ${name}`).to.not.include(name);
            });
        });
    });

    describe('removed table-only imports', () => {
        REMOVED_MAP_IMPORTS.forEach(symbol => {
            it(`does not import the map symbol ${symbol}`, () => {
                expect(src, `Settings.tsx should not reference ${symbol}`).to.not.include(symbol);
            });
        });

        REMOVED_MUI_IMPORTS.forEach(mod => {
            it(`does not import the MUI module ${mod}`, () => {
                expect(src, `Settings.tsx should not import ${mod}`).to.not.include(mod);
            });
        });

        REMOVED_MUI_SYMBOLS.forEach(symbol => {
            it(`does not reference the MUI symbol ${symbol}`, () => {
                expect(src, `Settings.tsx should not reference ${symbol}`).to.not.include(symbol);
            });
        });
    });

    describe('removed table-only style keys', () => {
        REMOVED_STYLE_KEYS.forEach(key => {
            it(`does not define the style key ${key}`, () => {
                expect(src, `Settings.tsx should not define the style key ${key}`).to.not.include(`${key}:`);
            });
        });
    });

    describe('retained field machinery and imports', () => {
        it('keeps the validateConfig import', () => {
            expect(src).to.include("import { validateConfig } from '../../../src/lib/config-validation'");
        });

        it('keeps the TextField import', () => {
            expect(src).to.include("import TextField from '@mui/material/TextField'");
        });

        it('keeps the { I18n, type IobTheme } import', () => {
            expect(src).to.include("import { I18n, type IobTheme } from '@iobroker/gui-components'");
        });

        RETAINED_MEMBERS.forEach(name => {
            it(`keeps the member ${name}`, () => {
                expect(src, `Settings.tsx should keep ${name}`).to.include(name);
            });
        });

        it('keeps the input and controlElement style keys', () => {
            expect(src).to.include('input:');
            expect(src).to.include('controlElement:');
        });
    });

    describe('render() emits only the four config fields', () => {
        FIELD_INVOCATIONS.forEach(invocation => {
            it(`renders field via ${invocation}`, () => {
                expect(src, `Settings.tsx render() should include ${invocation}`).to.include(invocation);
            });
        });

        it('render() invokes no register-table renderers', () => {
            expect(src).to.not.include('renderValueTable()');
            expect(src).to.not.include('renderStorEdgeTable()');
        });
    });
});
