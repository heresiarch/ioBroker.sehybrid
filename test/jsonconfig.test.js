'use strict';

// jsonConfig admin contract test for the "jsonconfig-admin" spec.
//
// Pins the new declarative admin configuration contract after migrating the
// admin UI from the custom React/TS app to `admin/jsonConfig.json`:
//   - io-package.json `common.adminUI.config === "json"`,
//   - admin/jsonConfig.json exists, parses, and is `type: "tabs"` with a single
//     `_main` panel holding exactly host, port, unitId, pollInterval in order,
//   - numeric min/max mirror CONFIG_BOUNDS (src/lib/config-validation.ts),
//   - every field has a non-empty validator and the expected validatorErrorText,
//   - admin/i18n/en.json exists with all referenced keys,
//   - io-package.json native defaults are unchanged.
//
// Validates: Requirements 1.2, 1.3, 1.4, 2.1, 2.2, 2.5, 3.5, 7.4

const fs = require('fs');
const path = require('path');
const { expect } = require('chai');

const rootDir = path.join(__dirname, '..');

/** Read and parse a UTF-8 JSON file from disk.
 * @param {string} file Absolute path to the JSON file.
 * @returns {any} The parsed JSON value.
 */
function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// CONFIG_BOUNDS from src/lib/config-validation.ts (source of truth, mirrored here).
const CONFIG_BOUNDS = {
    port: { min: 1, max: 65535 },
    unitId: { min: 0, max: 247 },
    pollInterval: { min: 5, max: 3600 },
};

const EXPECTED_FIELDS = ['host', 'port', 'unitId', 'pollInterval'];

/** @type {Record<string, string>} */
const EXPECTED_ERROR_TEXT = {
    host: 'Invalid host',
    port: 'Invalid port',
    unitId: 'Invalid unit ID',
    pollInterval: 'Invalid polling interval',
};

const EXPECTED_I18N_KEYS = [
    'Main settings',
    'Host',
    'Port',
    'Unit ID',
    'Polling interval (s)',
    'Invalid host',
    'Invalid port',
    'Invalid unit ID',
    'Invalid polling interval',
];

describe('jsonConfig admin contract (jsonconfig-admin)', () => {
    const ioPackage = readJson(path.join(rootDir, 'io-package.json'));
    const jsonConfigPath = path.join(rootDir, 'admin', 'jsonConfig.json');

    describe('io-package.json', () => {
        it('declares the json admin UI', () => {
            expect(ioPackage.common.adminUI.config).to.equal('json');
        });

        it('keeps the native defaults', () => {
            expect(ioPackage.native.host).to.equal('');
            expect(ioPackage.native.port).to.equal(502);
            expect(ioPackage.native.unitId).to.equal(1);
            expect(ioPackage.native.pollInterval).to.equal(30);
        });
    });

    describe('admin/jsonConfig.json', () => {
        it('exists and parses as JSON', () => {
            expect(fs.existsSync(jsonConfigPath), 'admin/jsonConfig.json should exist').to.equal(true);
            expect(() => readJson(jsonConfigPath)).to.not.throw();
        });

        const jsonConfig = readJson(jsonConfigPath);

        it('is type "tabs" with a _main panel', () => {
            expect(jsonConfig.type).to.equal('tabs');
            expect(jsonConfig.items).to.be.an('object');
            expect(jsonConfig.items).to.have.property('_main');
            expect(jsonConfig.items._main.type).to.equal('panel');
        });

        it('holds exactly the four fields in order', () => {
            const keys = Object.keys(jsonConfig.items._main.items);
            expect(keys).to.deep.equal(EXPECTED_FIELDS);
        });

        it('matches CONFIG_BOUNDS for the numeric fields', () => {
            const items = jsonConfig.items._main.items;
            expect(items.port.min).to.equal(CONFIG_BOUNDS.port.min);
            expect(items.port.max).to.equal(CONFIG_BOUNDS.port.max);
            expect(items.unitId.min).to.equal(CONFIG_BOUNDS.unitId.min);
            expect(items.unitId.max).to.equal(CONFIG_BOUNDS.unitId.max);
            expect(items.pollInterval.min).to.equal(CONFIG_BOUNDS.pollInterval.min);
            expect(items.pollInterval.max).to.equal(CONFIG_BOUNDS.pollInterval.max);
        });

        EXPECTED_FIELDS.forEach(field => {
            it(`field "${field}" has a non-empty validator and the expected validatorErrorText`, () => {
                const item = jsonConfig.items._main.items[field];
                expect(item.validator, `${field} should have a validator`).to.be.a('string').that.is.not.empty;
                expect(item.validatorErrorText).to.equal(EXPECTED_ERROR_TEXT[field]);
            });
        });
    });

    describe('admin/i18n/en.json', () => {
        const enPath = path.join(rootDir, 'admin', 'i18n', 'en.json');

        it('exists and contains all referenced keys', () => {
            expect(fs.existsSync(enPath), 'admin/i18n/en.json should exist').to.equal(true);
            const en = readJson(enPath);
            EXPECTED_I18N_KEYS.forEach(key => {
                expect(en, `en.json should contain key "${key}"`).to.have.property(key);
            });
        });
    });
});
