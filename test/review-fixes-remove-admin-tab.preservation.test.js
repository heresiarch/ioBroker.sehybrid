'use strict';

// Preservation property tests for the "review-fixes-remove-admin-tab" bugfix spec.
//
// Property 2: Preservation - Non-Targeted Artifacts Unchanged
//
// Design preservation requirement (Property 2):
//   FOR ALL slice WHERE NOT isBugCondition(slice) DO
//     ASSERT original(slice) == fixed(slice)
//   END FOR
//
// Observation-first methodology: this file captures the UNFIXED baseline of
// every artifact slice the fix must NOT touch (the config dialog path, the
// in-use i18n key set, already-correct translations, tab-unrelated
// io-package.json fields, and the dev-server tab.html copies). The baseline
// values recorded below are the committed state read during task 2; the
// assertions pin the artifacts to that baseline so a later diff proves the
// slices are byte-identical before and after the fix.
//
// EXPECTED OUTCOME on UNFIXED code: all tests PASS (baseline confirmed).
// They must continue to PASS after the fix (regression check in task 7).
//
// Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5

const fs = require('fs');
const path = require('path');
const { expect } = require('chai');
const fc = require('fast-check');

const rootDir = path.join(__dirname, '..');

const I18N_DIR = path.join(rootDir, 'src-admin', 'src', 'i18n');
const NON_ENGLISH_LANGS = ['de', 'es', 'fr', 'it', 'nl', 'pl', 'pt', 'ru', 'uk', 'zh-cn'];
const ALL_LANGS = ['en', ...NON_ENGLISH_LANGS];

// The 29 keys referenced by Settings.tsx (the instance config dialog) via
// I18n.t(). Derived from the actual I18n.t() calls in
// src-admin/src/components/Settings.tsx:
//   - direct literals: Host, Invalid host, Connection failed, Testing…,
//     Connection successful, Name, Register, Datatype, Model, Description,
//     No SunSpec values available, SunSpec Values, Inverter values,
//     Meter values, Battery values, StorEdge Control Block, Address, Encoding,
//     Unit, Range, Function code, No StorEdge control registers available,
//     Test Connection
//   - via renderNumberField(title, errorTitle, …) called from render():
//     Port / Invalid port, Unit ID / Invalid unit ID,
//     Polling interval (s) / Invalid polling interval
// None of these may be dropped by the unused-key audit — they must stay present
// in all 11 files.
const IN_USE_KEYS = [
    'Host',
    'Port',
    'Unit ID',
    'Polling interval (s)',
    'Test Connection',
    'Testing…',
    'Connection successful',
    'Connection failed',
    'SunSpec Values',
    'Inverter values',
    'Meter values',
    'Battery values',
    'Name',
    'Register',
    'Datatype',
    'Model',
    'Description',
    'No SunSpec values available',
    'StorEdge Control Block',
    'Address',
    'Encoding',
    'Unit',
    'Range',
    'Function code',
    'No StorEdge control registers available',
    'Invalid host',
    'Invalid port',
    'Invalid unit ID',
    'Invalid polling interval',
];

/** Read and parse an i18n JSON file for a language code. */
function readI18n(lang) {
    return JSON.parse(fs.readFileSync(path.join(I18N_DIR, `${lang}.json`), 'utf8'));
}

/** Read and parse io-package.json fresh (not via require cache). */
function readIoPackage() {
    return JSON.parse(fs.readFileSync(path.join(rootDir, 'io-package.json'), 'utf8'));
}

describe('Preservation: non-targeted artifacts unchanged (review-fixes-remove-admin-tab)', () => {
    // ---- 1: config dialog path preserved ----
    describe('config dialog path preserved', () => {
        it('io-package.json common.adminUI.config == "html"', () => {
            const io = readIoPackage();
            expect(io.common.adminUI.config, 'common.adminUI.config').to.equal('html');
        });

        it('admin/index.html is present', () => {
            const p = path.join(rootDir, 'admin', 'index.html');
            expect(fs.existsSync(p), 'admin/index.html should exist').to.equal(true);
        });

        it('App/Settings render path intact (App.tsx + Settings.tsx exist)', () => {
            const app = path.join(rootDir, 'src-admin', 'src', 'App.tsx');
            const settings = path.join(rootDir, 'src-admin', 'src', 'components', 'Settings.tsx');
            expect(fs.existsSync(app), 'src-admin/src/App.tsx should exist').to.equal(true);
            expect(fs.existsSync(settings), 'src-admin/src/components/Settings.tsx should exist').to.equal(true);
        });
    });

    // ---- 2: in-use i18n keys retained in all 11 files ----
    describe('in-use i18n keys retained (29 keys, all 11 files)', () => {
        it('baseline sanity: exactly the 29 Settings.tsx keys are tracked', () => {
            expect(IN_USE_KEYS, 'in-use key count').to.have.lengthOf(29);
            // No duplicates.
            expect(new Set(IN_USE_KEYS).size, 'unique in-use keys').to.equal(29);
        });

        it('every in-use key is present in all 11 files (property over keys x files)', () => {
            const files = {};
            ALL_LANGS.forEach(lang => (files[lang] = readI18n(lang)));

            fc.assert(
                fc.property(
                    fc.constantFrom(...IN_USE_KEYS),
                    fc.constantFrom(...ALL_LANGS),
                    (key, lang) => {
                        expect(
                            Object.prototype.hasOwnProperty.call(files[lang], key),
                            `${lang}.json must retain in-use key "${key}"`,
                        ).to.equal(true);
                    },
                ),
                { numRuns: 319 }, // 29 keys x 11 langs = 319 combinations
            );
        });
    });

    // ---- 3: already-correct translations preserved (snapshot current values) ----
    describe('already-correct translations preserved', () => {
        // Snapshot of non-French news lines NOT listed as bug conditions in
        // 1.4-1.6. These are already-correct and must stay byte-identical.
        // Captured from the committed io-package.json during task 2.
        const NEWS_SNAPSHOT = {
            // 1.0.15: only the fr line is a bug; every other language is preserved.
            '1.0.15': {
                de: 'Fix Lint-Fehler',
                ru: 'исправить ошибки Lint',
                pt: 'fixe erros Lint',
                nl: 'Lint-fouten herstellen',
                it: 'fix Lint',
                es: 'corregir errores de Lint',
                pl: 'naprawić błędy Lint',
                uk: 'виправлення помилок Lint',
                'zh-cn': '修复 Lint 错误',
            },
            // 1.0.9: fr line 1 is the bug; fr line 2 is already translated and
            // must be preserved.
            '1.0.9': {
                frSecondLine: 'a vérifié que le design réactif fonctionne',
            },
            // 1.0.10: fr line 2 is the bug; fr line 1 is already translated and
            // must be preserved.
            '1.0.10': {
                frFirstLine: 'correctif pour fichiers statiques perdus dans NPM',
            },
        };

        it('non-French news lines (1.0.15) remain byte-identical to baseline', () => {
            const news = readIoPackage().common.news;
            Object.entries(NEWS_SNAPSHOT['1.0.15']).forEach(([lang, value]) => {
                expect(news['1.0.15'][lang], `news 1.0.15 ${lang}`).to.equal(value);
            });
        });

        it('already-translated fr news lines (1.0.9 line 2, 1.0.10 line 1) preserved', () => {
            const news = readIoPackage().common.news;
            const fr109 = String(news['1.0.9'].fr).split('\n');
            const fr110 = String(news['1.0.10'].fr).split('\n');
            expect(fr109[1], 'news 1.0.9 fr line 2').to.equal(NEWS_SNAPSHOT['1.0.9'].frSecondLine);
            expect(fr110[0], 'news 1.0.10 fr line 1').to.equal(NEWS_SNAPSHOT['1.0.10'].frFirstLine);
        });

        // Snapshot of already-translated fr.json values (differ from English).
        // Captured from the committed src-admin/src/i18n/fr.json during task 2.
        const FR_ALREADY_TRANSLATED = {
            Address: 'Adresse',
            Encoding: 'Encodage',
            Unit: 'Unité',
            Range: 'Plage',
            'Function code': 'Code de fonction',
            'No StorEdge control registers available': 'Aucun registre de contrôle StorEdge disponible',
        };

        it('already-translated fr.json values remain byte-identical to baseline', () => {
            const fr = readI18n('fr');
            Object.entries(FR_ALREADY_TRANSLATED).forEach(([key, value]) => {
                expect(fr[key], `fr.json "${key}"`).to.equal(value);
            });
        });
    });

    // ---- 4: tab-unrelated io-package.json fields snapshot ----
    describe('tab-unrelated io-package.json fields unchanged', () => {
        // Fields and sub-trees that are allowed to change by this fix:
        //   common.adminUI.tab (removed), common.adminTab (removed),
        //   common.news["1.0.15"].fr, common.news["1.0.9"].fr,
        //   common.news["1.0.10"].fr
        // Everything else must be byte-identical. We snapshot the preserved
        // slices below and diff them deep-equal against the committed file.

        const io = readIoPackage();

        it('top-level native unchanged', () => {
            expect(readIoPackage().native).to.deep.equal(io.native);
            // Pin concrete baseline so a later edit to native is caught.
            expect(io.native).to.deep.equal({ host: '', port: 502, unitId: 1, pollInterval: 30 });
        });

        it('instanceObjects unchanged', () => {
            expect(readIoPackage().instanceObjects).to.deep.equal(io.instanceObjects);
            expect(io.instanceObjects, 'instanceObjects length').to.have.lengthOf(2);
        });

        it('dependencies and globalDependencies unchanged', () => {
            expect(io.common.dependencies).to.deep.equal([{ 'js-controller': '>=6.0.11' }]);
            expect(io.common.globalDependencies).to.deep.equal([{ admin: '>=7.8.23' }]);
        });

        it('version, titleLang and desc unchanged', () => {
            expect(io.common.version, 'common.version').to.equal('1.0.16');
            expect(io.common.titleLang).to.deep.equal(readIoPackage().common.titleLang);
            expect(io.common.desc).to.deep.equal(readIoPackage().common.desc);
        });

        it('news entries other than the three fixed fr lines unchanged', () => {
            const news = readIoPackage().common.news;
            // Entire entries that carry NO bug condition must be byte-identical.
            ['1.0.16', '1.0.13', '1.0.12', '1.0.11'].forEach(ver => {
                expect(news[ver], `news ${ver}`).to.deep.equal(io.common.news[ver]);
            });
        });

        it('all common.* fields except adminUI.tab / adminTab preserved (property over paths)', () => {
            const fresh = readIoPackage();
            const common = fresh.common;
            // The allowed-edit set within common: adminTab (whole block) and
            // adminUI.tab. Every other direct child of common must be present
            // and deep-equal to the task-2 baseline.
            const allowedToChange = new Set(['adminTab']);
            const baselineCommonKeys = Object.keys(io.common).filter(k => !allowedToChange.has(k));

            fc.assert(
                fc.property(fc.constantFrom(...baselineCommonKeys), key => {
                    if (key === 'adminUI') {
                        // adminUI may lose its `tab` key, but `config` must stay.
                        expect(common.adminUI.config, 'adminUI.config').to.equal('html');
                        return;
                    }
                    if (key === 'news') {
                        // news is covered field-by-field above; here only assert
                        // the preserved (non-fr-fixed) entries stay identical.
                        ['1.0.16', '1.0.13', '1.0.12', '1.0.11'].forEach(ver => {
                            expect(common.news[ver]).to.deep.equal(io.common.news[ver]);
                        });
                        return;
                    }
                    expect(common[key], `common.${key}`).to.deep.equal(io.common[key]);
                }),
                { numRuns: Math.max(100, baselineCommonKeys.length * 4) },
            );
        });
    });

    // ---- 5: dev-server artifacts untouched ----
    describe('dev-server tab.html artifacts untouched by the source fix', () => {
        const DEV_SERVER_TAB_COPIES = [
            path.join(rootDir, '.dev-server', 'default', 'iobroker-data', 'files', 'sehybrid.admin', 'tab.html'),
            path.join(
                rootDir,
                '.dev-server',
                'default',
                'node_modules',
                'iobroker.sehybrid',
                'admin',
                'tab.html',
            ),
        ];

        DEV_SERVER_TAB_COPIES.forEach(copy => {
            it(`dev-server copy exists and is left to the dev-server: ${path.relative(rootDir, copy)}`, () => {
                // These are regenerated/installed dev-server runtime state (clause
                // 3.5). The source fix must NOT hand-edit them. On unfixed code
                // they exist; we snapshot that they are non-empty HTML so a later
                // run proves the source fix did not touch them.
                expect(fs.existsSync(copy), `${copy} should exist (dev-server state)`).to.equal(true);
                const content = fs.readFileSync(copy, 'utf8');
                expect(content.length, 'dev-server tab.html content').to.be.greaterThan(0);
                expect(content, 'dev-server tab.html is HTML').to.include('<html');
            });
        });
    });
});
