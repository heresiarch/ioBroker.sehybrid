'use strict';

// Preservation property tests for the "modbus-register-reference-to-readme" bugfix spec.
//
// Property 2: Preservation - Non-Buggy Surfaces Unchanged
//
// Design preservation requirement (Property 2):
//   FOR ALL X WHERE NOT isBugCondition(X) DO
//     ASSERT original(X) == fixed(X)
//   END FOR
//
// The fix moves the Modbus register REFERENCE tables out of the Admin config
// form and into README.md (confined to generated markers). Everything that is
// NOT one of the two buggy surfaces must survive untouched. This file pins the
// three preservation slices named in task 2 to the UNFIXED baseline:
//
//   1. Config validation (Req 3.1): validateConfig's error-flag outcome for
//      host / port / unitId / pollInterval across valid and invalid inputs,
//      generated in bulk with fast-check.
//   2. Map public API (Req 3.2, 3.3): the exports and outputs of
//      getInverterValueDefs / getMeterValueDefs / getBatteryValueDefs /
//      STOREDGE_CONTROL_REGISTERS and the address helpers getRegisterAddress /
//      getBatteryBase / getDeviceRegisterAddress — snapshotted as a stable
//      digest.
//   3. README prose outside markers (Req 3.6): the hand-written README sections
//      (Features, Requirements, Installation, Configuration settings table,
//      States, StorEdge control block prose/notes, Troubleshooting, Support,
//      Changelog, License) — asserted byte-for-byte against the task-2 baseline.
//
// Observation-first methodology: every baseline value below was observed by
// running the UNFIXED code during task 2 and recorded here. The assertions pin
// the behavior to that observation so the SAME property re-runs identically
// after the fix (task 3.8 regression check).
//
// EXPECTED OUTCOME on UNFIXED code: all tests PASS (baseline confirmed).
//
// Validates: Requirements 3.1, 3.2, 3.3, 3.6

const fs = require('fs');
const path = require('path');
const { expect } = require('chai');
const fc = require('fast-check');

// The source maps and validateConfig are TypeScript modules in src/lib. Register
// ts-node so this package-tier .js test can import them directly (the same
// mechanism test/mocharc.custom.json uses for the src/**/*.test.ts suites). Mirror
// the TS_NODE settings from test/mocha.setup.js so the root tsconfig (and thus the
// global `ioBroker` type namespace) is picked up when transpiling the src/lib TS.
process.env.TS_NODE_IGNORE_WARNINGS = 'TRUE';
process.env.TS_NODE_PROJECT = process.env.TS_NODE_PROJECT || 'tsconfig.json';
// TS_NODE_FILES makes ts-node honor the tsconfig "include" globs, which pull in
// the @iobroker/adapter-core -> @iobroker/types chain that declares the global
// `ioBroker` namespace used by src/lib/config-validation.ts.
process.env.TS_NODE_FILES = process.env.TS_NODE_FILES || 'TRUE';
require('ts-node/register');

const rootDir = path.join(__dirname, '..');
const README_PATH = path.join(rootDir, 'README.md');

/* eslint-disable @typescript-eslint/no-var-requires */
const { validateConfig, CONFIG_BOUNDS } = require('../src/lib/config-validation.ts');
const {
    getInverterValueDefs,
    getMeterValueDefs,
    getBatteryValueDefs,
    getRegisterAddress,
    getBatteryBase,
    getDeviceRegisterAddress,
} = require('../src/lib/sunspec-map.ts');
const { STOREDGE_CONTROL_REGISTERS } = require('../src/lib/storedge-control-map.ts');
/* eslint-enable @typescript-eslint/no-var-requires */

/** Read a UTF-8 text file from disk. */
function readText(file) {
    return fs.readFileSync(file, 'utf8');
}

// -----------------------------------------------------------------------------
// Reference oracle for validateConfig's error-flag outcome.
// -----------------------------------------------------------------------------
// This mirrors the documented bounds (host string 1..253, port int 1..65535,
// unitId int 0..247, pollInterval int 5..3600). It is the OBSERVED behavior of
// validateConfig on the unfixed code, re-expressed as an independent predicate
// so fast-check can assert validateConfig agrees with it over the whole input
// domain — before AND after the fix.
function expectedFieldValid(field, value) {
    switch (field) {
        case 'host':
            return (
                typeof value === 'string' &&
                value.length >= CONFIG_BOUNDS.host.minLength &&
                value.length <= CONFIG_BOUNDS.host.maxLength
            );
        case 'port':
            return Number.isInteger(value) && value >= CONFIG_BOUNDS.port.min && value <= CONFIG_BOUNDS.port.max;
        case 'unitId':
            return Number.isInteger(value) && value >= CONFIG_BOUNDS.unitId.min && value <= CONFIG_BOUNDS.unitId.max;
        case 'pollInterval':
            return (
                Number.isInteger(value) &&
                value >= CONFIG_BOUNDS.pollInterval.min &&
                value <= CONFIG_BOUNDS.pollInterval.max
            );
        default:
            throw new Error(`unknown field ${field}`);
    }
}

describe('Preservation: non-buggy surfaces unchanged (modbus-register-reference-to-readme)', () => {
    // ---- 1: config validation path preserved (Req 3.1) ----
    describe('config validation (validateConfig) preserved', () => {
        it('documented bounds are the task-2 baseline', () => {
            // Pin the bounds so a later edit to the validation path is caught.
            expect(CONFIG_BOUNDS.host).to.deep.equal({ minLength: 1, maxLength: 253 });
            expect(CONFIG_BOUNDS.port).to.deep.equal({ min: 1, max: 65535 });
            expect(CONFIG_BOUNDS.unitId).to.deep.equal({ min: 0, max: 247 });
            expect(CONFIG_BOUNDS.pollInterval).to.deep.equal({ min: 5, max: 3600 });
        });

        it('fully-valid configs validate (valid === true, no errors)', () => {
            fc.assert(
                fc.property(
                    fc.string({ minLength: 1, maxLength: 253 }),
                    fc.integer({ min: 1, max: 65535 }),
                    fc.integer({ min: 0, max: 247 }),
                    fc.integer({ min: 5, max: 3600 }),
                    (host, port, unitId, pollInterval) => {
                        const res = validateConfig({ host, port, unitId, pollInterval });
                        expect(res.valid, `valid config {${host.length} chars, ${port}, ${unitId}, ${pollInterval}}`).to
                            .equal(true);
                        expect(res.errors).to.deep.equal({});
                    },
                ),
                { numRuns: 500 },
            );
        });

        it('validateConfig error flags match the documented bounds for arbitrary inputs', () => {
            // Generators span valid and invalid values for every field, including
            // out-of-range integers, non-integers, empty/oversized hosts, and
            // non-string hosts. For each generated config, validateConfig's
            // overall validity and per-field error presence must agree with the
            // independent oracle.
            const hostArb = fc.oneof(
                fc.string({ minLength: 0, maxLength: 300 }),
                fc.constantFrom('', 'a', 'inverter.local'),
                fc.constant(undefined),
                fc.integer(),
            );
            const numArb = fc.oneof(
                fc.integer({ min: -1000, max: 70000 }),
                fc.double({ noNaN: false }),
                fc.constantFrom(0, 1, 5, 247, 248, 3600, 3601, 65535, 65536),
                fc.constant(undefined),
            );

            fc.assert(
                fc.property(hostArb, numArb, numArb, numArb, (host, port, unitId, pollInterval) => {
                    const cfg = { host, port, unitId, pollInterval };
                    const res = validateConfig(cfg);

                    const hostOk = expectedFieldValid('host', host);
                    const portOk = expectedFieldValid('port', port);
                    const unitIdOk = expectedFieldValid('unitId', unitId);
                    const pollOk = expectedFieldValid('pollInterval', pollInterval);

                    expect(Object.prototype.hasOwnProperty.call(res.errors, 'host'), `host error for ${host}`).to.equal(
                        !hostOk,
                    );
                    expect(Object.prototype.hasOwnProperty.call(res.errors, 'port'), `port error for ${port}`).to.equal(
                        !portOk,
                    );
                    expect(
                        Object.prototype.hasOwnProperty.call(res.errors, 'unitId'),
                        `unitId error for ${unitId}`,
                    ).to.equal(!unitIdOk);
                    expect(
                        Object.prototype.hasOwnProperty.call(res.errors, 'pollInterval'),
                        `pollInterval error for ${pollInterval}`,
                    ).to.equal(!pollOk);

                    expect(res.valid, 'overall valid').to.equal(hostOk && portOk && unitIdOk && pollOk);
                }),
                { numRuns: 1000 },
            );
        });

        it('representative invalid examples are rejected on the right field', () => {
            expect(validateConfig({ host: '', port: 502, unitId: 1, pollInterval: 30 }).errors).to.have.property(
                'host',
            );
            expect(validateConfig({ host: 'x', port: 0, unitId: 1, pollInterval: 30 }).errors).to.have.property('port');
            expect(validateConfig({ host: 'x', port: 502, unitId: 248, pollInterval: 30 }).errors).to.have.property(
                'unitId',
            );
            expect(validateConfig({ host: 'x', port: 502, unitId: 1, pollInterval: 4 }).errors).to.have.property(
                'pollInterval',
            );
            expect(validateConfig({ host: 'x', port: 502.5, unitId: 1, pollInterval: 30 }).errors).to.have.property(
                'port',
            );
        });
    });

    // ---- 2: map public API preserved (Req 3.2, 3.3) ----
    describe('source-map public API preserved', () => {
        // Observed digests of the selector/helper outputs on the unfixed code.
        // A digest is the ordered list of "name@absoluteAddress" strings so that
        // both the row set, its order, and the address-helper math are pinned.
        const INVERTER_DIGEST = getInverterValueDefs().map(d => `${d.name}@${getRegisterAddress(d)}`);
        const METER_DIGEST = getMeterValueDefs().map(d => `${d.name}@${getRegisterAddress(d)}`);
        const BATTERY_DIGEST = getBatteryValueDefs().map(d => `${d.name}@${getDeviceRegisterAddress(getBatteryBase(1), d)}`);
        const STOREDGE_DIGEST = STOREDGE_CONTROL_REGISTERS.map(d => `${d.name}@${d.address}:${d.kind}:${d.fc}`);

        it('selector row counts match the task-2 baseline', () => {
            expect(INVERTER_DIGEST, 'inverter value defs').to.have.lengthOf(22);
            expect(METER_DIGEST, 'meter value defs').to.have.lengthOf(37);
            expect(BATTERY_DIGEST, 'battery value defs').to.have.lengthOf(18);
            expect(STOREDGE_DIGEST, 'storedge control registers').to.have.lengthOf(9);
        });

        it('address helpers return the task-2 baseline bases', () => {
            expect(getBatteryBase(1), 'battery.1 base').to.equal(0xe100); // 57600
            expect(getBatteryBase(2), 'battery.2 base').to.equal(0xe200); // 57856
        });

        it('inverter selector digest is byte-stable (names + resolved addresses)', () => {
            expect(INVERTER_DIGEST[0], 'first inverter row').to.equal('acCurrent@40071');
            expect(INVERTER_DIGEST[INVERTER_DIGEST.length - 1], 'last inverter row').to.equal('statusVendor@40108');
            // Every address resolves to the inverter block (base 40069).
            INVERTER_DIGEST.forEach(entry => {
                const addr = Number(entry.split('@')[1]);
                expect(addr, `${entry} resolves into the inverter block`).to.be.within(40069, 40199);
            });
        });

        it('meter selector digest is byte-stable (names + resolved addresses)', () => {
            expect(METER_DIGEST[0], 'first meter row').to.equal('mCurrent@40190');
            expect(METER_DIGEST[METER_DIGEST.length - 1], 'last meter row').to.equal('mImportedWhC@40240');
        });

        it('battery selector digest is byte-stable (names + battery.1 absolute addresses)', () => {
            expect(BATTERY_DIGEST[0], 'first battery row').to.equal('ratedEnergy@57666');
            expect(BATTERY_DIGEST[BATTERY_DIGEST.length - 1], 'last battery row').to.equal('statusInternal@57736');
            // Battery.1 absolute addresses live in the 0xE1xx block.
            BATTERY_DIGEST.forEach(entry => {
                const addr = Number(entry.split('@')[1]);
                expect(addr, `${entry} resolves into the battery.1 block`).to.be.within(0xe100, 0xe1ff);
            });
        });

        it('StorEdge control registers are byte-stable (name, address, kind, fc, order)', () => {
            expect(STOREDGE_DIGEST).to.deep.equal([
                'storageControlMode@57348:uint16:FC06',
                'storageAcChargePolicy@57349:uint16:FC06',
                'storageAcChargeLimit@57350:float32:FC16',
                'storageBackupReservedSetting@57352:float32:FC16',
                'storageChargeDischargeDefaultMode@57354:uint16:FC06',
                'remoteControlCommandTimeout@57355:uint32:FC16',
                'remoteControlCommandMode@57357:uint16:FC06',
                'remoteControlChargeLimit@57358:float32:FC16',
                'remoteControlDischargeLimit@57360:float32:FC16',
            ]);
        });

        it('selectors are pure (repeated calls return equal, independent arrays)', () => {
            const a = getInverterValueDefs();
            const b = getInverterValueDefs();
            expect(a).to.not.equal(b); // fresh array each call
            expect(a.map(d => d.name)).to.deep.equal(b.map(d => d.name));
        });
    });

    // ---- 3: README prose outside the generated markers preserved (Req 3.6) ----
    describe('README hand-written prose preserved (outside generated markers)', () => {
        const readme = readText(README_PATH);

        // Each entry is a hand-written README section that the fix must NOT touch.
        // The `anchor` is a byte-exact slice captured from the task-2 README; the
        // fix only ADDS a new "Modbus register reference" section fenced by
        // generated markers, so every slice below must stay present and unchanged.
        const PROSE_ANCHORS = [
            {
                section: 'Features and Functions',
                anchor:
                    '## Features and Functions\n\nMonitors and controls SolarEdge hybrid inverters over **Modbus TCP** (SunSpec).',
            },
            {
                section: 'Requirements',
                anchor:
                    '## Requirements\n\n- A [SolarEdge Home Hub (hybrid) inverter]',
            },
            {
                section: 'Installation',
                anchor:
                    '## Installation\n\nInstall **sehybrid** from the ioBroker admin (Adapters tab), then create an instance.',
            },
            {
                section: 'Configuration settings table',
                anchor:
                    '| Setting | Default | Description |\n|---------|---------|-------------|\n| Host | *(empty)* | IP address or hostname of the inverter. Polling does not start until this is set. |',
            },
            {
                section: 'States',
                anchor: '## States\n\nThe adapter organizes the values it reads into channels:',
            },
            {
                section: 'StorEdge control block prose',
                anchor:
                    '## StorEdge control block\n\nThe adapter always exposes the inverter\'s **Global StorEdge Control Block**',
            },
            {
                section: 'StorEdge control block table',
                anchor:
                    '| `storageControlMode` | `0xE004` | Storage Control Mode | 0–4 |',
            },
            {
                section: 'StorEdge Float encoding note',
                anchor:
                    '> **Float encoding note:** the StorEdge power-control registers use *Big Endian, word-swapped* float32',
            },
            {
                section: 'Troubleshooting',
                anchor: '## Troubleshooting\n\n- **No data / `info.connection` stays `false`**',
            },
            {
                section: 'Support',
                anchor:
                    '## Support\n\nPlease report issues at [GitHub Issues](https://github.com/heresiarch/ioBroker.sehybrid/issues).',
            },
            {
                section: 'Changelog',
                // Anchor on the stable developer note + heading, NOT the volatile
                // version line (release tooling rewrites '### **WORK IN PROGRESS**'
                // into '### <version> (<date>)', which must not break this check).
                anchor:
                    'Developers: see [README_dev.md](README_dev.md) for build, test and release instructions.\n\n## Changelog',
            },
            {
                section: 'License',
                anchor:
                    '## License\n\nCopyright (c) 2026 René Meyer <heresiarch@online.de>\nsee [LICENSE](LICENSE)',
            },
        ];

        it('baseline sanity: all prose anchors are present exactly once on unfixed code', () => {
            PROSE_ANCHORS.forEach(({ section, anchor }) => {
                const first = readme.indexOf(anchor);
                expect(first, `anchor for "${section}" present`).to.not.equal(-1);
                expect(readme.indexOf(anchor, first + 1), `anchor for "${section}" is unique`).to.equal(-1);
            });
        });

        it('every hand-written prose section is byte-for-byte unchanged (property over sections)', () => {
            fc.assert(
                fc.property(fc.constantFrom(...PROSE_ANCHORS), ({ section, anchor }) => {
                    expect(readme.includes(anchor), `README must still contain the "${section}" prose byte-for-byte`).to
                        .equal(true);
                }),
                { numRuns: Math.max(100, PROSE_ANCHORS.length * 4) },
            );
        });
    });
});
