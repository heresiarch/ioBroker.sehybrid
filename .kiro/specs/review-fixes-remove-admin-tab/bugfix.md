# Bugfix Requirements Document

## Introduction

The ioBroker.sehybrid adapter (version 1.0.16) received a manual repository review on
[ioBroker.repositories PR #6765](https://github.com/ioBroker/ioBroker.repositories/pull/6765)
(reviewer mcm1957, checklist V3.5). The maintainer requires a set of fixes before marking the
submission "READY FOR RE-REVIEW".

This bugfix groups the blocking review findings into one defect cluster. The defects are
packaging/metadata and localization problems rather than runtime crashes, so each "bug condition"
below is expressed over the project's static artifacts (io-package.json, the admin source, build
config, and the i18n files) rather than over function inputs.

The cluster has three fixable parts:

1. **Unfinished admin tab** — `src-admin/src/Tab.tsx` is a scaffold that renders the hardcoded
   placeholder `Add your components here.`. The tab is wired into `io-package.json` via the
   `adminUI.tab` entry and the `adminTab` block, built into `admin/tab.html`, and selected at
   runtime by `src-admin/src/index.tsx`. The reviewer flagged that the tab adds no value over the
   instance config dialog, the `singleton: true` setting is questionable for multiple instances,
   the tab name does not include the adapter name, and the body is placeholder scaffold. The chosen
   fix is to remove the admin tab entirely.
2. **Untranslated French news strings** in `io-package.json` (`news` entries for 1.0.15, 1.0.9,
   and 1.0.10) where the `fr` value equals the `en` value.
3. **Untranslated admin UI i18n keys** across the 10 non-English files in `src-admin/src/i18n/`
   whose values are byte-identical to English.

Three further review observations (reactive-power role, energy-role granularity, and a jsonConfig
migration) are explicitly out of scope for code change in this spec and will be addressed as PR
comments; they are recorded in Section 3 as behavior that must stay unchanged.

Verification expectation for the overall fix: the `src-admin` admin build must still compile after
the tab is removed, `io-package.json` must remain valid JSON and a valid io-package schema, and a
fresh object dump plus the "READY FOR RE-REVIEW" remark will be attached to the PR once complete.

### Grounding notes (from code inspection)

- `admin/tab.html` is produced by the build, not authored. It is emitted by the `--4-patch` step in
  `tasks.js` (`patchFiles`) and by the `patch-admin-html` plugin in `src-admin/vite.config.watch.ts`.
  Both must stop emitting `tab.html`, and the committed `admin/tab.html` artifact must be removed.
- `src-admin/src/index.tsx` imports `Tab` and selects it when the URL contains `tab`. This selection
  branch must be removed along with the import so the build does not reference a deleted module.
- The copies at `.dev-server/default/iobroker-data/files/sehybrid.admin/tab.html` and
  `.dev-server/.../node_modules/iobroker.sehybrid/admin/tab.html` are dev-server runtime artifacts,
  not source. They are regenerated/installed by the local dev-server and are not part of the
  published package. See clause 3.5.
- Localization scope correction: the admin i18n keys are consumed by `src-admin/src/components/Settings.tsx`
  (the instance **config** dialog), not by the tab. Removing the tab does **not** make these keys
  unused — they remain in use and must be translated, not deleted. The only key that appears in the
  i18n JSON files but is not referenced by any `.tsx` is `"sehybrid adapter settings"`, which is the
  one genuinely-unused key candidate from the review's "unused translation keys" observation.

## Bug Analysis

### Current Behavior (Defect)

**Admin tab (scaffold / no value):**

1.1 WHEN the adapter is packaged THEN `io-package.json` declares `adminUI.tab = "html"` and a full
`adminTab` block (`singleton: true`, 11-language `name` such as "Instance settings"/"实例设置",
`link: "tab.html"`), wiring an admin tab that duplicates the instance config dialog.

1.2 WHEN the admin tab is opened THEN `src-admin/src/Tab.tsx` renders the hardcoded, untranslated
placeholder string `Add your components here.` instead of any real content.

1.3 WHEN the admin UI is built THEN `tasks.js` (`--4-patch`) and `src-admin/vite.config.watch.ts`
emit `admin/tab.html`, and `src-admin/src/index.tsx` imports `Tab` and renders it when the URL
contains `tab`, keeping the dead tab path in the shipped bundle.

**Untranslated French news strings in `io-package.json`:**

1.4 WHEN `news["1.0.15"]` is read THEN the `fr` value is `"fix Lint errors"`, identical to the `en`
value (untranslated).

1.5 WHEN `news["1.0.9"]` is read THEN the first line of the `fr` value is `"fixed lint config"`,
identical to the first line of `en` (the second line is already translated).

1.6 WHEN `news["1.0.10"]` is read THEN the second line of the `fr` value is `"hotfix for port issue"`,
identical to the second line of `en` (the first line is already translated).

**Untranslated admin UI i18n keys:**

1.7 WHEN any of the 10 non-English files in `src-admin/src/i18n/` (de, fr, es, it, nl, pl, pt, ru,
uk, zh-cn) is read THEN roughly 21 keys hold values byte-identical to the English value, including:
`"sehybrid adapter settings"`, `"Polling interval (s)"`, `"Test Connection"`, `"Testing…"`,
`"Connection successful"`, `"Connection failed"`, `"SunSpec Values"`, `"Inverter values"`,
`"Meter values"`, `"Battery values"`, `"Name"`, `"Register"`, `"Datatype"`, `"Model"`,
`"Description"`, `"No SunSpec values available"`, `"StorEdge Control Block"`, `"Invalid host"`,
`"Invalid port"`, `"Invalid unit ID"`, `"Invalid polling interval"`.

1.8 WHEN the i18n files are audited THEN `"sehybrid adapter settings"` is present in every language
file but is not referenced by any `.tsx`, so it is an unused key carried in every language.

### Expected Behavior (Correct)

**Admin tab removed:**

2.1 WHEN the adapter is packaged THEN `io-package.json` SHALL omit the `adminUI.tab` entry (keeping
`adminUI.config = "html"`) and SHALL NOT contain an `adminTab` block.

2.2 WHEN the admin source is built THEN `src-admin/src/Tab.tsx` SHALL be removed and the hardcoded
`Add your components here.` placeholder SHALL no longer exist in the source tree.

2.3 WHEN the admin UI is built THEN `tasks.js` and `src-admin/vite.config.watch.ts` SHALL NOT emit
`admin/tab.html`, `src-admin/src/index.tsx` SHALL NOT import `Tab` or branch on a `tab` URL (it
SHALL render only `App`), and the committed `admin/tab.html` artifact SHALL be removed.

2.4 WHEN the `src-admin` project is built after the above changes THEN the build SHALL complete
successfully with no reference to the removed `Tab` module, and `io-package.json` SHALL remain valid
JSON conforming to the io-package schema.

**French news strings translated:**

2.5 WHEN `news["1.0.15"].fr` is read THEN the system SHALL hold a French translation of
"fix Lint errors" that is not equal to the `en` value.

2.6 WHEN `news["1.0.9"].fr` is read THEN its first line SHALL be a French translation of
"fixed lint config" that is not equal to the `en` first line (the already-translated second line
SHALL be preserved).

2.7 WHEN `news["1.0.10"].fr` is read THEN its second line SHALL be a French translation of
"hotfix for port issue" that is not equal to the `en` second line (the already-translated first line
SHALL be preserved).

**Admin UI i18n keys translated or audited:**

2.8 WHEN a non-English i18n file is read for a key that is still in use by `Settings.tsx` and
requires localization (UI labels, status strings, and error messages such as `"Test Connection"`,
`"Testing…"`, `"Connection successful"`, `"Connection failed"`, `"Inverter values"`, `"Meter values"`,
`"Battery values"`, `"No SunSpec values available"`, `"Invalid host"`, `"Invalid port"`,
`"Invalid unit ID"`, `"Invalid polling interval"`, `"Polling interval (s)"`, `"Datatype"`,
`"Description"`) THEN the value SHALL be a correct translation for that language, not equal to the
English value.

2.9 WHEN a key is a product/technical name that may legitimately remain unchanged in a given language
(e.g. `"StorEdge Control Block"`, and partially `"SunSpec Values"`, `"Register"`, `"Model"`, `"Name"`)
THEN the system MAY keep it equal to English, and this decision SHALL be documented explicitly so a
reviewer can distinguish an intentional non-translation from a missed one.

2.10 WHEN the i18n files are audited THEN the genuinely-unused key `"sehybrid adapter settings"`
SHALL be removed from all language files (including `en`), addressing the review's "unused translation
keys" observation, while every key still referenced by `Settings.tsx` SHALL be retained.

### Unchanged Behavior (Regression Prevention)

3.1 WHEN the adapter instance config dialog is opened THEN the system SHALL CONTINUE TO serve
`admin/index.html` driven by `adminUI.config = "html"` and render the `App`/`Settings` UI exactly as
before (the config path is independent of the removed tab).

3.2 WHEN `Settings.tsx` renders labels, the Test Connection flow, the SunSpec value tables, and the
StorEdge Control Block table THEN the system SHALL CONTINUE TO resolve all i18n keys it references,
so no key currently used by the config dialog is removed by the unused-key audit.

3.3 WHEN already-correct localizations are read (every non-French news line not listed in 1.4–1.6,
and every i18n value that already differs from English) THEN the system SHALL CONTINUE TO present
those existing translations unchanged.

3.4 WHEN `io-package.json` fields unrelated to the tab are read (`native`, `instanceObjects`,
`dependencies`, `globalDependencies`, `desc`, `titleLang`, version, etc.) THEN the system SHALL
CONTINUE TO expose them unchanged.

3.5 WHEN the dev-server runtime artifacts at
`.dev-server/default/iobroker-data/files/sehybrid.admin/tab.html` and
`.dev-server/.../node_modules/iobroker.sehybrid/admin/tab.html` are considered THEN the system SHALL
treat them as regenerated/installed dev-server state (not source), so they SHALL CONTINUE TO be left
to the dev-server to recreate and SHALL NOT be hand-edited as part of the source fix.

3.6 WHEN the three acknowledged-but-out-of-scope observations are considered — the reactive-power
role (`value.power` -> `value.power.reactive`), energy-role granularity, and the jsonConfig
migration from the HTML admin UI — THEN the system SHALL CONTINUE TO behave as it does today (no code
change in this spec); these SHALL be addressed as PR comments toward re-review rather than fixed here.

3.7 WHEN the overall change is complete THEN the deliverables toward re-review (a fresh object dump
and the "READY FOR RE-REVIEW" remark on PR #6765) SHALL be produced, with the adapter's runtime
monitoring/control behavior CONTINUING TO work unchanged.
