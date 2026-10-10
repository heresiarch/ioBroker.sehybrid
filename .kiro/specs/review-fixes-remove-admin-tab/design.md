# Review Fixes — Remove Admin Tab Bugfix Design

## Overview

The ioBroker.sehybrid adapter (v1.0.16) failed a manual repository review on
[ioBroker.repositories PR #6765](https://github.com/ioBroker/ioBroker.repositories/pull/6765).
This design groups the blocking findings into a single, coordinated static-artifact fix with three
independent parts:

1. **Remove the unfinished admin tab.** The tab is a scaffold (`Tab.tsx` renders the literal
   `Add your components here.`) wired across four locations: `io-package.json` (`adminUI.tab` +
   `adminTab` block), `src-admin/src/Tab.tsx`, `src-admin/src/index.tsx` (import + `?tab` selection
   branch), and the two build steps that emit `admin/tab.html` (`tasks.js` `patchFiles`, and the
   `patch-admin-html` plugin in `src-admin/vite.config.watch.ts`), plus the committed
   `admin/tab.html` artifact.
2. **Translate three French news strings** in `io-package.json` whose `fr` value (or one line of it)
   equals the English value.
3. **Translate ~20 in-use admin i18n keys** across the 10 non-English files and **remove the one
   genuinely-unused key** (`"sehybrid adapter settings"`) from all language files.

Because these are packaging/metadata and localization defects over static files rather than runtime
crashes, each bug condition `C(X)` is expressed over the project's artifacts (the io-package JSON
tree, the admin source tree, the build config, and the i18n JSON files) rather than over function
inputs. The "fixed function" `F'` is the artifact after the fix; the "original function" `F` is the
artifact as committed today. Preservation is checked over every artifact slice the fix does not
target.

The strategy is deliberately minimal and targeted: touch only the artifacts named in the bug
condition, leave everything else byte-for-byte unchanged, and verify by (a) compiling the
`src-admin` build after `Tab` removal and (b) confirming `io-package.json` remains valid JSON and a
valid io-package schema.

## Glossary

- **Bug_Condition (C)**: The condition identifying a defective artifact slice — an admin-tab wiring
  that still exists, a French news string equal to its English counterpart, an in-use i18n value
  equal to English in a non-English file, or the presence of the unused `"sehybrid adapter settings"`
  key.
- **Property (P)**: The desired post-fix state of that slice — tab wiring absent and the build still
  compiling; the French string a real translation differing from English; the in-use i18n value a
  correct translation (or a documented intentional non-translation); the unused key absent from all
  files.
- **Preservation**: Every artifact slice outside the bug condition — the config dialog path
  (`adminUI.config = "html"`, `App`/`Settings`), all i18n keys still referenced by `Settings.tsx`,
  all already-correct translations, all tab-unrelated `io-package.json` fields, and dev-server
  runtime artifacts — must remain unchanged.
- **adminUI.tab / adminTab**: The two `io-package.json` entries that register an admin tab. The fix
  removes `adminUI.tab` (keeping `adminUI.config`) and the whole `adminTab` block.
- **Tab.tsx**: `src-admin/src/Tab.tsx` — the scaffold `GenericApp` subclass rendering the
  `Add your components here.` placeholder. Deleted by the fix.
- **index.tsx**: `src-admin/src/index.tsx` — the bootstrap that imports `Tab` and renders it when the
  URL contains `tab`, otherwise renders `App`. The fix removes the import and the branch so it
  renders only `App`.
- **patchFiles (tasks.js) / patch-admin-html (vite.config.watch.ts)**: The two build steps that each
  write `admin/tab.html` from `admin/index.html`. Both must stop emitting `tab.html`.
- **Settings.tsx**: `src-admin/src/components/Settings.tsx` — the instance **config** dialog. It is
  the real consumer of the admin i18n keys; removing the tab does not make these keys unused.
- **tab.html**: The committed build artifact `admin/tab.html`. Removed by the fix. Its dev-server
  copies are runtime state, not source (clause 3.5), and are left untouched.

## Bug Details

### Bug Condition

The bug manifests as four distinct defective patterns over the static artifacts. A given artifact
slice satisfies the bug condition when it still carries removed tab wiring, an untranslated French
news string, an untranslated in-use i18n value, or the unused i18n key. The admin UI "works" at
runtime, but the shipped package carries dead scaffold code and incomplete localization that the
reviewer requires fixed.

**Formal Specification:**
```
FUNCTION isBugCondition(artifact)
  INPUT: artifact — one slice of the project's static artifacts
  OUTPUT: boolean

  // Part 1 — admin tab wiring still present
  tabWiring :=
       (io-package.json has common.adminUI.tab)
    OR (io-package.json has common.adminTab)
    OR (file src-admin/src/Tab.tsx exists)
    OR (src-admin/src/index.tsx imports Tab OR branches on a "tab" URL)
    OR (tasks.js patchFiles writes admin/tab.html)
    OR (src-admin/vite.config.watch.ts patch-admin-html writes admin/tab.html)
    OR (committed file admin/tab.html exists)

  // Part 2 — French news string equals English
  frNews :=
       (news["1.0.15"].fr == news["1.0.15"].en)
    OR (firstLine(news["1.0.9"].fr) == firstLine(news["1.0.9"].en))
    OR (secondLine(news["1.0.10"].fr) == secondLine(news["1.0.10"].en))

  // Part 3 — in-use i18n value equals English in a non-English file
  i18nUntranslated :=
       artifact is a non-English file in src-admin/src/i18n/
       AND EXISTS key IN keysUsedBy(Settings.tsx) WHERE
             requiresLocalization(key)
             AND artifact[key] == en[key]

  // Part 4 — genuinely-unused key present
  unusedKey :=
       EXISTS i18n file f WHERE f has key "sehybrid adapter settings"
       (and "sehybrid adapter settings" is referenced by no .tsx)

  RETURN tabWiring OR frNews OR i18nUntranslated OR unusedKey
END FUNCTION
```

### Examples

- **Tab wiring (io-package.json):** `common.adminUI = { "config": "html", "tab": "html" }` and a full
  `adminTab` block with `singleton: true`, an 11-language `name` ("Instance settings" … "实例设置"),
  and `link: "tab.html"`. Expected: `adminUI` keeps only `"config": "html"` and no `adminTab` block
  exists. Actual: both are present, registering a tab that duplicates the config dialog.
- **Tab scaffold (Tab.tsx):** `render()` returns a `div` containing the literal
  `Add your components here.`. Expected: the file does not exist. Actual: the placeholder ships.
- **index.tsx branch:** `import Tab from './Tab';` and `if (isTab) { root.render(<Tab …/>); }`.
  Expected: no `Tab` import and `root.render(<App …/>)` unconditionally. Actual: the dead branch and
  a now-dangling import to a deleted module.
- **Build emits tab.html:** `patchFiles` in `tasks.js` and `patch-admin-html` in
  `vite.config.watch.ts` each `writeFileSync(.../admin/tab.html, …)`. Expected: neither writes
  `tab.html`. Actual: both do, and `admin/tab.html` is committed.
- **French news (1.0.15):** `news["1.0.15"].fr == "fix Lint errors" == en`. Expected: a real French
  translation (e.g. "correction des erreurs Lint") that differs from `en`.
- **French news (1.0.9, line 1):** `fr` first line `"fixed lint config"` == `en` first line; the
  second line "a vérifié que le design réactif fonctionne" is already translated and must be kept.
- **French news (1.0.10, line 2):** `fr` second line `"hotfix for port issue"` == `en` second line;
  the first line "correctif pour fichiers statiques perdus dans NPM" is already translated and must
  be kept.
- **i18n in-use untranslated (fr.json):** `"Test Connection": "Test Connection"`,
  `"Invalid host": "Invalid host"` equal English while the key is used by `Settings.tsx`. Expected:
  correct French ("Tester la connexion", "Hôte invalide").
- **Unused key (all files):** `"sehybrid adapter settings"` present in every language file,
  referenced by no `.tsx`. Expected: absent from all files including `en.json`.
- **Edge — intentional non-translation:** `"StorEdge Control Block"` is a product name; it is used by
  `Settings.tsx` but may legitimately stay equal to English. This is NOT a bug condition when
  documented (clause 2.9).

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**

- The instance **config** dialog path: `adminUI.config = "html"`, served from `admin/index.html`,
  rendering `App`/`Settings` exactly as before. The config path is independent of the removed tab.
- Every i18n key still referenced by `Settings.tsx` remains present in every language file. The
  keys in use are: `Host`, `Port`, `Unit ID`, `Polling interval (s)`, `Test Connection`, `Testing…`,
  `Connection successful`, `Connection failed`, `SunSpec Values`, `Inverter values`, `Meter values`,
  `Battery values`, `Name`, `Register`, `Datatype`, `Model`, `Description`,
  `No SunSpec values available`, `StorEdge Control Block`, `Address`, `Encoding`, `Unit`, `Range`,
  `Function code`, `No StorEdge control registers available`, `Invalid host`, `Invalid port`,
  `Invalid unit ID`, `Invalid polling interval`. None of these may be removed by the unused-key audit.
- Already-correct localizations: every non-French news line not listed in 1.4–1.6, and every i18n
  value that already differs from English (e.g. fr.json `Address → Adresse`, `Encoding → Encodage`,
  `Unit → Unité`, `Range → Plage`, `Function code → Code de fonction`,
  `No StorEdge control registers available → Aucun registre de contrôle StorEdge disponible`).
- Tab-unrelated `io-package.json` fields: `native`, `instanceObjects`, `dependencies`,
  `globalDependencies`, `desc`, `titleLang`, `version`, `news` entries other than the three fixed
  lines, and all `common.*` fields other than `adminUI.tab` and `adminTab`.
- Dev-server runtime artifacts (`.dev-server/.../sehybrid.admin/tab.html` and
  `.dev-server/.../node_modules/iobroker.sehybrid/admin/tab.html`) are regenerated/installed state,
  not source; they are left to the dev-server and NOT hand-edited.

**Scope:**

All artifact slices that do NOT satisfy `isBugCondition` must be completely unaffected by this fix.
This includes:

- The config dialog, its HTML entry, and its runtime rendering.
- Every in-use i18n key and every already-translated i18n/news value.
- All `io-package.json` fields unrelated to the admin tab.
- Dev-server generated copies of `tab.html`.
- The three acknowledged out-of-scope observations (reactive-power role, energy-role granularity,
  jsonConfig migration) — no code change here; PR comments only.

**Note:** The expected correct post-fix state for each bug slice is defined in the Correctness
Properties section (Property 1). This section focuses on what must NOT change.

## Hypothesized Root Cause

Based on inspection of the real source, the defects are not caused by a single mechanism; they are
four co-located review findings:

1. **Scaffold shipped unfinished.** The adapter was generated with `@iobroker/create-adapter` which
   scaffolds both a config dialog (`App`/`Settings`) and an admin tab (`Tab`). The tab was never
   given real content, so `Tab.tsx` still renders the generator's `Add your components here.`
   placeholder, and all four wiring points (io-package, index.tsx, tasks.js, vite.config.watch.ts)
   still carry the scaffold's tab plumbing.

2. **Tab wiring spread across four locations.** The `tab.html` artifact is emitted by two
   independent build steps (production `tasks.js` `patchFiles` and watch-mode `patch-admin-html`),
   selected at runtime by the `?tab` branch in `index.tsx`, and registered in `io-package.json`.
   Removing only one location would leave a dangling reference (e.g. deleting `Tab.tsx` without
   editing `index.tsx` breaks the build; dropping the io-package entries without touching the build
   leaves an orphan `tab.html`).

3. **Partial French localization.** The French news/i18n entries were translated incrementally; a
   few strings (and single lines within multi-line news) were left equal to English and never
   back-filled.

4. **Unused key left behind.** `"sehybrid adapter settings"` was a generator default title that is
   not referenced by any component; it was carried into every language file but never consumed.

## Correctness Properties

Property 1: Bug Condition — Review Findings Resolved

_For any_ artifact slice where the bug condition holds (`isBugCondition` returns true), the fixed
artifact SHALL satisfy the corresponding corrected state: (a) for tab wiring, the slice SHALL be
absent — `io-package.json` has no `adminUI.tab` and no `adminTab` block, `src-admin/src/Tab.tsx`
does not exist, `index.tsx` has no `Tab` import and no `tab` URL branch (renders only `App`),
neither `tasks.js` nor `vite.config.watch.ts` emits `admin/tab.html`, and the committed
`admin/tab.html` is removed — and the `src-admin` build SHALL compile successfully with
`io-package.json` remaining valid JSON and a valid io-package schema; (b) for a French news string,
the `fr` value (or the specified line) SHALL be a correct French translation not equal to the `en`
counterpart, with the already-translated lines preserved; (c) for an in-use i18n value in a
non-English file, the value SHALL be a correct translation for that language and not equal to
English, unless the key is a documented product/technical name (Property, clause 2.9); (d) the key
`"sehybrid adapter settings"` SHALL be absent from all language files including `en`.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10**

Property 2: Preservation — Non-Targeted Artifacts Unchanged

_For any_ artifact slice where the bug condition does NOT hold (`isBugCondition` returns false), the
fixed project SHALL produce exactly the same artifact as the original, preserving: the config dialog
path (`adminUI.config = "html"`, `App`/`Settings`, `admin/index.html`); every i18n key still
referenced by `Settings.tsx` in every language file; every already-correct news/i18n translation;
every tab-unrelated `io-package.json` field (`native`, `instanceObjects`, `dependencies`,
`globalDependencies`, `desc`, `titleLang`, version, and all other `common.*` fields); the dev-server
runtime copies of `tab.html`; and the three out-of-scope observations' current behavior.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7**

## Fix Implementation

Assuming the root-cause analysis is correct, the fix is a set of targeted edits with no shared code
path, verified against the real source read during design.

### Change 1 — `io-package.json` (tab registration)

**File**: `io-package.json`

1. In `common.adminUI`, remove the `"tab": "html"` entry; keep `"config": "html"`. Result:
   `"adminUI": { "config": "html" }`.
2. Remove the entire `common.adminTab` block (`singleton`, the 11-language `name`, `link`).
3. Leave all other fields byte-for-byte unchanged. Confirm the file remains valid JSON and valid
   io-package schema after edit (comma/brace hygiene around the removed `adminTab` key).

### Change 2 — `src-admin/src/Tab.tsx` (scaffold)

**File**: `src-admin/src/Tab.tsx`

1. Delete the file. It is the only source of the `Add your components here.` placeholder and the only
   importer-target of the `index.tsx` `Tab` import.

### Change 3 — `src-admin/src/index.tsx` (runtime selection)

**File**: `src-admin/src/index.tsx`

1. Remove `import Tab from './Tab';`.
2. Remove the `isTab` computation and the `if (isTab) { … } else { … }` branch; render `App`
   unconditionally:
   ```tsx
   const container = document.getElementById('root');
   const root = createRoot(container!);
   root.render(<App adapterName="sehybrid" />);
   ```
3. Keep the version log and the `App` / `createRoot` / `index.css` imports.

### Change 4 — Build steps that emit `tab.html`

**File**: `tasks.js` (function `patchFiles`, used by `--4-patch` and the full pipeline)

1. Keep the socket.io include rewrite on `admin/index.html`.
2. Remove the two lines that build `tabCode` from the title replace and `writeFileSync` it to
   `admin/tab.html`. Update the `patchFiles` doc comment and the header usage block so they no longer
   mention `tab.html`.

**File**: `src-admin/vite.config.watch.ts` (plugin `patch-admin-html`)

1. Keep the socket.io shim rewrite in `closeBundle`.
2. Remove the two lines that build `tabCode` and `writeFileSync` it to `admin/tab.html`. Update the
   plugin/file comment that references emitting `tab.html`.

**Artifact**: `admin/tab.html`

1. Remove the committed `admin/tab.html` file.
2. Do NOT touch the dev-server copies (`.dev-server/...`) — they are runtime state (clause 3.5).

### Change 5 — French news strings in `io-package.json`

**File**: `io-package.json` (`common.news`)

1. `news["1.0.15"].fr`: replace `"fix Lint errors"` with a real French translation differing from
   `en` (e.g. "correction des erreurs Lint").
2. `news["1.0.9"].fr`: replace the first line `"fixed lint config"` with a French translation (e.g.
   "configuration lint corrigée"); keep the already-translated second line
   "a vérifié que le design réactif fonctionne".
3. `news["1.0.10"].fr`: replace the second line `"hotfix for port issue"` with a French translation
   (e.g. "correctif pour le problème de port"); keep the already-translated first line
   "correctif pour fichiers statiques perdus dans NPM".

### Change 6 — Admin i18n keys (10 non-English files + unused-key removal)

**Files**: `src-admin/src/i18n/{de,fr,es,it,nl,pl,pt,ru,uk,zh-cn}.json` and
`src-admin/src/i18n/en.json`

1. Remove the key `"sehybrid adapter settings"` from all 11 files (including `en.json`). It is
   referenced by no `.tsx` (confirmed) and is the only genuinely-unused key.
2. In each of the 10 non-English files, for every in-use key whose value is still equal to English,
   provide a correct translation. Keys requiring translation (per clause 2.8) include: `Host`,
   `Port` (where locale differs), `Unit ID`, `Polling interval (s)`, `Test Connection`, `Testing…`,
   `Connection successful`, `Connection failed`, `Inverter values`, `Meter values`, `Battery values`,
   `Datatype`, `Description`, `No SunSpec values available`, `Invalid host`, `Invalid port`,
   `Invalid unit ID`, `Invalid polling interval`, and any of `Address`/`Encoding`/`Unit`/`Range`/
   `Function code`/`No StorEdge control registers available` not already translated in a given file.
3. **Documented intentional non-translations (clause 2.9).** The following MAY remain equal to
   English and are intentional, not missed:
   - `"StorEdge Control Block"` — SolarEdge product/feature name; keep as-is in all languages.
   - `"SunSpec Values"` — "SunSpec" is a protocol/standard name; the "Values" portion may be
     localized where idiomatic, but keeping it equal to English is acceptable.
   - `"Register"`, `"Model"`, `"Name"` — short technical terms that are identical or near-identical
     in several target languages (e.g. German "Name"/"Modell"/"Register"); where the correct
     translation equals English, this is intentional, not a defect.
   - `"Host"`, `"Port"`, `"Unit"` — networking/technical terms commonly left untranslated in several
     locales; keeping equal to English is acceptable where idiomatic.
   This table of decisions is the record a reviewer uses to distinguish an intentional
   non-translation from a missed one.

## Testing Strategy

### Validation Approach

Two phases: first surface counterexamples that demonstrate each bug condition on the unfixed
artifacts, then verify the fix resolves them and preserves everything else. Because the bugs are over
static artifacts, "tests" are a mix of build compilation, JSON/schema validation, and
assertions/scans over the artifact trees.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the defects BEFORE implementing the fix, and
confirm or refute the root-cause analysis. If refuted (e.g. a key assumed unused turns out to be
referenced), re-hypothesize before editing.

**Test Plan**: Scan the committed artifacts and run the build to observe the current state. Confirm
each bug slice exists exactly where the design claims.

**Test Cases**:
1. **Tab wiring present** — grep `io-package.json` for `adminTab` and `adminUI.tab`; confirm
   `src-admin/src/Tab.tsx` exists with the placeholder; confirm `index.tsx` imports `Tab` and
   branches on `tab`; confirm `tasks.js` and `vite.config.watch.ts` write `tab.html`; confirm
   `admin/tab.html` is committed. (All true on unfixed code.)
2. **French news equal to English** — assert `news["1.0.15"].fr == en`, `firstLine(1.0.9.fr) == en`,
   `secondLine(1.0.10.fr) == en`. (True on unfixed code.)
3. **In-use i18n equal to English** — for each non-English file, assert at least one in-use key
   (e.g. `"Test Connection"`, `"Invalid host"`) equals the English value. (True on unfixed code.)
4. **Unused key present** — assert `"sehybrid adapter settings"` is in every file AND grep finds no
   `.tsx` reference. (True on unfixed code — confirmed during design.)
5. **Edge — dangling import after naive delete** — delete `Tab.tsx` only, then build `src-admin`;
   expect a compile error on the `./Tab` import in `index.tsx`, proving the four touch points are
   coupled and must change together.

**Expected Counterexamples**:
- `adminTab` block and `adminUI.tab` found; `Tab.tsx` placeholder present; `tab.html` emitted by
  both build steps and committed.
- French news lines byte-identical to English for the three listed entries.
- Multiple in-use i18n values byte-identical to English across the 10 non-English files.
- `"sehybrid adapter settings"` present everywhere, referenced nowhere.

### Fix Checking

**Goal**: Verify that for all artifact slices where the bug condition holds, the fixed artifacts
produce the expected corrected state (Property 1).

**Pseudocode:**
```
FOR ALL slice WHERE isBugCondition(slice) DO
  applyFix(slice)
  ASSERT expectedBehavior(slice)      // tab wiring absent / fr translated / i18n translated / key removed
END FOR

// Build-level checks after the fix:
ASSERT buildSrcAdmin() succeeds               // no reference to removed Tab module
ASSERT isValidJson("io-package.json")
ASSERT isValidIoPackageSchema("io-package.json")
ASSERT NOT emits("admin/tab.html") BY tasks.js AND NOT BY vite.config.watch.ts
ASSERT NOT exists("admin/tab.html")
```

### Preservation Checking

**Goal**: Verify that for all artifact slices where the bug condition does NOT hold, the fixed
project produces the same artifact as the original (Property 2).

**Pseudocode:**
```
FOR ALL slice WHERE NOT isBugCondition(slice) DO
  ASSERT original(slice) == fixed(slice)
END FOR
```

**Testing Approach**: A diff/scan-based preservation check is appropriate here because the artifacts
are static: compute the set of slices the fix is allowed to touch, then assert every other slice is
byte-identical before and after. Property-style enumeration over the i18n key space and the
`io-package.json` field tree catches accidental edits (e.g. a stray comma change, an unintended key
drop) that a spot check would miss.

**Test Plan**: Capture the unfixed state of the preserved slices first (config dialog path, in-use
i18n keys, already-translated values, tab-unrelated io-package fields), then assert they are
unchanged after the fix.

**Test Cases**:
1. **Config dialog preserved** — assert `adminUI.config == "html"` still present; `App`/`Settings`
   render path unchanged; `admin/index.html` still built and served.
2. **In-use i18n keys retained** — assert every key referenced by `Settings.tsx` (the 29-key set
   listed in Preservation Requirements) is still present in all 11 files.
3. **Already-translated values preserved** — assert previously non-English values (news non-French
   lines; fr.json `Adresse`/`Encodage`/`Unité`/`Plage`/`Code de fonction`/`Aucun registre…`) are
   unchanged.
4. **Tab-unrelated io-package fields preserved** — diff `native`, `instanceObjects`, `dependencies`,
   `globalDependencies`, `desc`, `titleLang`, version, and all `common.*` except `adminUI.tab` /
   `adminTab`; expect no change.
5. **Dev-server artifacts untouched** — assert `.dev-server/.../tab.html` copies are not modified by
   the source fix.

### Unit Tests

- Validate `io-package.json` parses as JSON and conforms to the io-package schema after edit.
- Assert `adminUI` has no `tab` key and `common` has no `adminTab`.
- Assert `admin/tab.html` does not exist and that `src-admin/src/Tab.tsx` does not exist.
- Assert `index.tsx` contains no `Tab` import and no `tab` URL branch.
- Assert the three French news lines differ from their English counterparts and the preserved lines
  are intact.
- Assert `"sehybrid adapter settings"` is absent from all i18n files.

### Property-Based Tests

- Over the i18n key space × 10 non-English files: for every in-use key not in the documented
  intentional-non-translation set, assert the value differs from English.
- Over the preserved key set: for every key referenced by `Settings.tsx`, assert it exists in all 11
  files (no accidental removal).
- Over the `io-package.json` field tree: for every path outside the allowed-edit set, assert
  `original == fixed`.

### Integration Tests

- Build the full admin pipeline (`node tasks`) and assert it completes without emitting `tab.html`
  and without referencing the removed `Tab` module.
- Launch/serve the config dialog and confirm `App`/`Settings` render and resolve all referenced i18n
  keys in each language (no missing-key fallbacks).
- Confirm no admin tab is registered (the tab no longer appears in the admin UI) while the instance
  config dialog continues to open and function unchanged.
- Produce a fresh object dump and attach the "READY FOR RE-REVIEW" remark to PR #6765 once the above
  pass.
