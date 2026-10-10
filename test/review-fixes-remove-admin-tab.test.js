'use strict';

// Bug condition exploration test for the "review-fixes-remove-admin-tab" bugfix spec.
//
// Property 1: Bug Condition - Review Findings Still Present
//
// Design bug condition (isBugCondition over static artifacts):
//   tabWiring OR frNews OR i18nUntranslated OR unusedKey
//
// The defects are over static artifacts and deterministic, so this test scopes
// the property to the concrete artifact slices named in the design
// (io-package.json tree, admin source tree, build config, i18n files) rather
// than randomized inputs.
//
// This test encodes the EXPECTED POST-FIX (corrected) state, so it is
// EXPECTED TO FAIL on unfixed code. Each failure confirms a review finding
// exists. After the coupled fix (tasks 3-5) it will PASS, validating the fix.
//
// DO NOT fix the test or the code when it fails here - the failure is the
// success case for a bugfix exploration test.
//
// Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8

const fs = require('fs');
const path = require('path');
const { expect } = require('chai');

const rootDir = path.join(__dirname, '..');

const ioPackage = require(path.join(rootDir, 'io-package.json'));

const I18N_DIR = path.join(rootDir, 'src-admin', 'src', 'i18n');
const NON_ENGLISH_LANGS = ['de', 'es', 'fr', 'it', 'nl', 'pl', 'pt', 'ru', 'uk', 'zh-cn'];
const ALL_LANGS = ['en', ...NON_ENGLISH_LANGS];

// In-use keys referenced by Settings.tsx that must be translated (not equal to
// English) in a correctly localized file. These are UI/status/error strings,
// not product/technical names from the documented intentional-non-translation
// set (clause 2.9).
const IN_USE_TRANSLATABLE_KEYS = ['Test Connection', 'Invalid host'];

const UNUSED_KEY = 'sehybrid adapter settings';

/** Read and parse an i18n JSON file for a language code. */
function readI18n(lang) {
    const file = path.join(I18N_DIR, `${lang}.json`);
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** First line of a (possibly multi-line) news string. */
function firstLine(value) {
    return String(value).split('\n')[0];
}

/** Second line of a (possibly multi-line) news string. */
function secondLine(value) {
    return String(value).split('\n')[1];
}

describe('Bug condition: review findings still present (review-fixes-remove-admin-tab)', () => {
    // ---- Part 1: admin tab wiring must be absent (post-fix state) ----
    describe('Part 1 - admin tab wiring removed', () => {
        it('io-package.json has no common.adminUI.tab', () => {
            const adminUI = ioPackage.common && ioPackage.common.adminUI;
            expect(adminUI, 'common.adminUI').to.be.an('object');
            expect(adminUI).to.not.have.property('tab');
        });

        it('io-package.json has no common.adminTab block', () => {
            expect(ioPackage.common).to.not.have.property('adminTab');
        });

        it('src-admin/src/Tab.tsx does not exist', () => {
            const tabPath = path.join(rootDir, 'src-admin', 'src', 'Tab.tsx');
            expect(fs.existsSync(tabPath), 'src-admin/src/Tab.tsx should not exist').to.equal(false);
        });

        it('no Tab.tsx contains the scaffold placeholder "Add your components here."', () => {
            const tabPath = path.join(rootDir, 'src-admin', 'src', 'Tab.tsx');
            if (fs.existsSync(tabPath)) {
                const src = fs.readFileSync(tabPath, 'utf8');
                expect(src, 'Tab.tsx scaffold placeholder').to.not.include('Add your components here.');
            }
        });

        it('src-admin/src/index.tsx does not import Tab and does not branch on a "tab" URL', () => {
            const indexPath = path.join(rootDir, 'src-admin', 'src', 'index.tsx');
            const src = fs.readFileSync(indexPath, 'utf8');
            expect(src, 'index.tsx Tab import').to.not.match(/import\s+Tab\s+from\s+['"]\.\/Tab['"]/);
            expect(src, 'index.tsx tab URL branch').to.not.match(/\.(search|hash)\.includes\(['"]tab['"]\)/);
        });

        it('tasks.js patchFiles does not write admin/tab.html', () => {
            const src = fs.readFileSync(path.join(rootDir, 'tasks.js'), 'utf8');
            expect(src, 'tasks.js tab.html emission').to.not.match(/writeFileSync\([^)]*admin\/tab\.html/);
            expect(src, 'tasks.js tab.html reference').to.not.include('tab.html');
        });

        it('src-admin/vite.config.watch.ts patch-admin-html does not write admin/tab.html', () => {
            const src = fs.readFileSync(path.join(rootDir, 'src-admin', 'vite.config.watch.ts'), 'utf8');
            expect(src, 'vite.config.watch.ts tab.html emission').to.not.match(/writeFileSync\([^)]*tab\.html/);
            expect(src, 'vite.config.watch.ts tab.html reference').to.not.include('tab.html');
        });

        it('committed admin/tab.html does not exist', () => {
            const tabHtml = path.join(rootDir, 'admin', 'tab.html');
            expect(fs.existsSync(tabHtml), 'admin/tab.html should not exist').to.equal(false);
        });
    });

    // ---- Part 2: French news strings must differ from English (post-fix) ----
    describe('Part 2 - French news strings translated', () => {
        const news = (ioPackage.common && ioPackage.common.news) || {};

        it('news["1.0.15"].fr != news["1.0.15"].en', () => {
            const entry = news['1.0.15'];
            expect(entry, 'news 1.0.15').to.be.an('object');
            expect(entry.fr, 'news 1.0.15 fr').to.not.equal(entry.en);
        });

        it('firstLine(news["1.0.9"].fr) != firstLine(news["1.0.9"].en)', () => {
            const entry = news['1.0.9'];
            expect(entry, 'news 1.0.9').to.be.an('object');
            expect(firstLine(entry.fr), 'news 1.0.9 fr line 1').to.not.equal(firstLine(entry.en));
        });

        it('secondLine(news["1.0.10"].fr) != secondLine(news["1.0.10"].en)', () => {
            const entry = news['1.0.10'];
            expect(entry, 'news 1.0.10').to.be.an('object');
            expect(secondLine(entry.fr), 'news 1.0.10 fr line 2').to.not.equal(secondLine(entry.en));
        });
    });

    // ---- Part 3: in-use i18n values must be translated in non-English files ----
    describe('Part 3 - in-use i18n keys translated (non-English files)', () => {
        const en = readI18n('en');

        NON_ENGLISH_LANGS.forEach((lang) => {
            it(`${lang}.json translates in-use keys (none equal to English)`, () => {
                const translations = readI18n(lang);
                const untranslated = IN_USE_TRANSLATABLE_KEYS.filter(
                    (key) => translations[key] === en[key],
                );
                expect(
                    untranslated,
                    `${lang}.json in-use keys still equal to English: ${untranslated.join(', ')}`,
                ).to.deep.equal([]);
            });
        });
    });

    // ---- Part 4: unused key must be absent everywhere ----
    describe('Part 4 - unused key removed', () => {
        ALL_LANGS.forEach((lang) => {
            it(`${lang}.json does not contain the unused key "${UNUSED_KEY}"`, () => {
                const translations = readI18n(lang);
                expect(translations, `${lang}.json`).to.not.have.property(UNUSED_KEY);
            });
        });

        it('"sehybrid adapter settings" is referenced by no .tsx (confirms it is genuinely unused)', () => {
            const srcDir = path.join(rootDir, 'src-admin', 'src');
            const tsxFiles = [];
            const walk = (dir) => {
                for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                    const full = path.join(dir, entry.name);
                    if (entry.isDirectory()) {
                        walk(full);
                    } else if (entry.name.endsWith('.tsx')) {
                        tsxFiles.push(full);
                    }
                }
            };
            walk(srcDir);

            const referencing = tsxFiles.filter((f) =>
                fs.readFileSync(f, 'utf8').includes(UNUSED_KEY),
            );
            expect(
                referencing.map((f) => path.relative(rootDir, f)),
                'files referencing the unused key',
            ).to.deep.equal([]);
        });
    });
});
