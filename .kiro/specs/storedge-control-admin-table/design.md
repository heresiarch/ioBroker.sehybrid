# StorEdge Control Admin Table Design

## Overview

This feature adds a read-only "StorEdge Control Block" reference table to the adapter's admin
Settings UI (`src-admin/src/components/Settings.tsx`). Today the Settings form ends with a
`renderValueTable()` block that presents three collapsible SunSpec groups (Inverter, Meter, Battery)
sourced from `src/lib/sunspec-map`. The nine Global StorEdge Control Block registers described by
`STOREDGE_CONTROL_REGISTERS` in `src/lib/storedge-control-map.ts` have no equivalent view.

The design mirrors the existing SunSpec table's look and behavior — a titled `Paper` containing MUI
`Accordion` sections, each wrapping a `Table size="small"` in the shared scroll-box — but adapts the
columns to the different shape of `StorEdgeControlRegisterDef`. Unlike `SunSpecRegisterDef`, this type
has no `datatype`/`model`/`description`; it carries `address`, `kind`, `unit`, `min`, `max`, and `fc`.

Because the two row shapes differ, the design introduces a dedicated `renderStorEdgeTable()` method
rather than overloading the existing `renderTableFor()`. The StorEdge section is rendered in its own
`Paper` placed directly after the existing SunSpec `Paper`, keeping the two sections visually distinct
and leaving all existing SunSpec rendering untouched. The table is a static documentation aid: it
reads only the exported static data and never polls, reads, writes, or issues `sendTo` against a
device, and exposes no editable inputs.

## Glossary

- **Bug_Condition (C)**: Not applicable — this is a feature spec, not a bugfix. The bug-condition
  methodology sections are omitted; this design follows the feature-design template shape (Overview,
  Components, Data, Correctness Properties, Testing).
- **Register def**: A single `StorEdgeControlRegisterDef` entry from `STOREDGE_CONTROL_REGISTERS`.
- **`renderStorEdgeTable()`**: New private method on the `Settings` class in `Settings.tsx` that
  renders the StorEdge Control Block `Paper` + `Accordion` + `Table`.
- **`renderValueTable()`**: Existing method rendering the SunSpec Values `Paper`; unchanged.
- **Unbounded max**: The `max` of `STORAGE_AC_CHARGE_LIMIT` is `Number.MAX_VALUE`, a sentinel meaning
  "no documented upper bound"; it must be rendered as a readable token, not the raw numeric literal.
- **`STOREDGE_CONTROL_REGISTERS`**: The exported `readonly StorEdgeControlRegisterDef[]` (nine entries)
  that is the sole data source for the table.

## Architecture

The feature is a self-contained, read-only addition to the existing admin Settings React component
(`src-admin/src/components/Settings.tsx`). It introduces no new modules, services, or device
interactions; it only consumes the already-exported static data array `STOREDGE_CONTROL_REGISTERS`
from `src/lib/storedge-control-map.ts`.

The rendering flow mirrors the existing SunSpec value table:

```
Settings.render()
  ├─ ...existing connection fields, Test Connection button, validation...
  ├─ renderValueTable()        // existing SunSpec Paper (Inverter/Meter/Battery) — unchanged
  └─ renderStorEdgeTable()     // NEW StorEdge Control Block Paper
        └─ <Paper style={styles.tableWrapper}>
             └─ <Typography variant="h6"> title
             └─ <Accordion> (collapsed by default)
                  └─ <AccordionSummary> "StorEdge Control Block (9)"
                  └─ <AccordionDetails style={styles.accordionDetails}>
                       └─ <div style={styles.scrollBox}>
                            └─ <Table size="small"> head + one row per register
```

`renderStorEdgeTable()` is a new private method placed alongside `renderValueTable()` and invoked as a
sibling in `render()`. It reuses the shared `styles` primitives (`tableWrapper`, `scrollBox`,
`accordionDetails`) so the new section is visually consistent with, and cleanly separated from, the
SunSpec section. Because the data source is static and the table exposes no inputs, the section has no
runtime dependency on the Modbus poll/read model and cannot affect existing device behavior.

## Components and Interfaces

### Data source

`renderStorEdgeTable()` reads `STOREDGE_CONTROL_REGISTERS` directly. A new import is added to
`Settings.tsx`:

```ts
import { STOREDGE_CONTROL_REGISTERS } from '../../../src/lib/storedge-control-map';
import type { StorEdgeControlRegisterDef } from '../../../src/lib/storedge-control-map';
```

This matches the existing pattern of importing SunSpec helpers from `../../../src/lib/sunspec-map`
(Vite transpiles the adapter TS sources on the fly, so no build step is needed). No new device
interaction is introduced, satisfying Requirement 3.

### Placement and container

`render()` currently ends with `{this.renderValueTable()}`. The change adds a sibling call:

```tsx
{this.renderValueTable()}
{this.renderStorEdgeTable()}
```

`renderStorEdgeTable()` returns its own `<Paper style={styles.tableWrapper}>` (reusing the existing
`styles.tableWrapper`, which already applies `marginTop: 24`, giving natural separation from the
SunSpec paper). This keeps both sections reachable and visually distinct (Req 6.2) without disturbing
`renderValueTable()` (Req 7.1).

The `Paper` contains:
- A `Typography variant="h6"` title `I18n.t('StorEdge Control Block')` (Req 1.1, 1.3, 5.1).
- A single `<Accordion>` (NOT `defaultExpanded`), so it renders collapsed by default, matching the
  Meter/Battery sibling accordions (Req 1.2, 6.3). Its `AccordionSummary` shows
  `` `${I18n.t('StorEdge Control Block')} (${STOREDGE_CONTROL_REGISTERS.length})` `` → e.g.
  `StorEdge Control Block (9)` (Req 1.3).
- An `<AccordionDetails style={styles.accordionDetails}>` wrapping the table body.

### Table structure

Inside the accordion detail, mirror the SunSpec scroll-box + table primitives (Req 6.1):

```tsx
<div style={styles.scrollBox}>
    <Table size="small">
        <TableHead>
            <TableRow>
                <TableCell>{I18n.t('Name')}</TableCell>
                <TableCell>{I18n.t('Address')}</TableCell>
                <TableCell>{I18n.t('Encoding')}</TableCell>
                <TableCell>{I18n.t('Unit')}</TableCell>
                <TableCell>{I18n.t('Range')}</TableCell>
                <TableCell>{I18n.t('Function code')}</TableCell>
            </TableRow>
        </TableHead>
        <TableBody>
            {STOREDGE_CONTROL_REGISTERS.length === 0 ? (
                <TableRow>
                    <TableCell colSpan={6}>{I18n.t('No StorEdge control registers available')}</TableCell>
                </TableRow>
            ) : (
                STOREDGE_CONTROL_REGISTERS.map(def => (
                    <TableRow key={def.name}>
                        <TableCell>{def.name}</TableCell>
                        <TableCell>{formatAddress(def.address)}</TableCell>
                        <TableCell>{def.kind}</TableCell>
                        <TableCell>{def.unit ?? ''}</TableCell>
                        <TableCell>{formatRange(def.min, def.max)}</TableCell>
                        <TableCell>{def.fc}</TableCell>
                    </TableRow>
                ))
            )}
        </TableBody>
    </Table>
</div>
```

One row per entry, in array order (Req 1.4, 1.5). The `colSpan` matches the 6-column head (Req 4.1,
4.2). The empty-state row is localized (Req 5.1). The table exposes no input controls (Req 3.3).

### Columns

| # | Header (i18n key) | Source field | Notes |
|---|---|---|---|
| 1 | `Name` (reused) | `def.name` | Reuses existing key per Req 5.3 (2.1) |
| 2 | `Address` | `def.address` | Hex-formatted, `0xExxx` (2.2, 2.3) |
| 3 | `Encoding` | `def.kind` | `uint16` / `float32` / `uint32` (2.4) |
| 4 | `Unit` | `def.unit` | `def.unit ?? ''` — empty when absent (2.5, 2.6) |
| 5 | `Range` | `def.min`, `def.max` | `min..max`, unbounded max as token (2.7, 2.9) |
| 6 | `Function code` | `def.fc` | `FC06` / `FC16` (2.8) |

`kind` maps to the `Encoding` header. "Encoding" is chosen over "Type"/"Datatype" to avoid colliding
semantically with the SunSpec `Datatype` column while accurately describing the on-the-wire encoding.

### Formatting helpers

Two small pure helpers are added as private methods (or module-local functions) in `Settings.tsx`.

**Address (hex):** render the absolute base-0 Modbus address as a `0xExxx` hex string (Req 2.3):

```ts
function formatAddress(address: number): string {
    return `0x${address.toString(16).toUpperCase().padStart(4, '0')}`;
}
// 0xe004 -> "0xE004", 0xe010 -> "0xE010"
```

**Range:** render `min..max`, substituting a readable token when `max === Number.MAX_VALUE`
(Req 2.7, 2.9):

```ts
function formatRange(min: number, max: number): string {
    const maxLabel = max === Number.MAX_VALUE ? '∞' : String(max);
    return `${min}..${maxLabel}`;
}
// (0, 4)              -> "0..4"
// (0, Number.MAX_VALUE) -> "0..∞"
// (0, 86400)          -> "0..86400"
```

The `∞` token is a stable, language-neutral symbol and needs no additional translation key. The range
string itself is composed of numeric/symbol tokens, so it is not run through `I18n.t`; only the column
headers and empty-state message are translated.

## Data Models

No component state, props, or external data structures change. `SettingsState`, `SettingsProps`, and
the `styles` object are reused as-is (`tableWrapper`, `scrollBox`, `accordionDetails`). No changes are
made to `STOREDGE_CONTROL_REGISTERS` or the SunSpec read/poll model (Req 7.3).

The single data model consumed is the existing `StorEdgeControlRegisterDef` shape from
`src/lib/storedge-control-map.ts`, read verbatim:

| Field | Type | Rendered as |
|---|---|---|
| `name` | `string` | Name cell (verbatim) |
| `address` | `number` | Address cell (`formatAddress` → `0xExxx`) |
| `kind` | `'uint16' \| 'uint32' \| 'float32'` | Encoding cell (verbatim) |
| `unit` | `string \| undefined` | Unit cell (`unit ?? ''`) |
| `min` / `max` | `number` | Range cell (`formatRange` → `min..max`) |
| `fc` | `'FC06' \| 'FC16'` | Function code cell (verbatim) |

## Error Handling

The table is a static, read-only view with no I/O and no user inputs, so there are no runtime errors,
promises, or exceptions to catch. Error handling is limited to gracefully rendering degenerate or
boundary data without throwing:

- **Empty register set**: when `STOREDGE_CONTROL_REGISTERS.length === 0`, the table body renders a
  single localized empty-state row spanning all six columns (`No StorEdge control registers
  available`) instead of an empty/broken table (Req 4.1, 4.2).
- **Missing unit**: when a register's `unit` is `undefined`, the Unit cell renders `def.unit ?? ''`,
  producing an empty cell rather than the literal text `undefined` (Req 2.5, 2.6).
- **Unbounded max**: when `max === Number.MAX_VALUE`, `formatRange` substitutes the readable `∞`
  token so the Range cell never displays the raw `Number.MAX_VALUE` numeric literal (Req 2.7, 2.9).

All three cases are pure, synchronous rendering paths; none can throw, and none affect the SunSpec
section or device communication.

## Correctness Properties

Property 1: Row generation — one row per register in order

_For any_ non-empty `STOREDGE_CONTROL_REGISTERS`, `renderStorEdgeTable` SHALL render exactly one table
body row per entry, in the same order as the array, and no empty-state row.

**Validates: Requirements 1.4, 1.5, 4.1**

Property 2: Address formatting — hex `0xExxx`

_For any_ register `address` in the `0xE004..0xE010` documented range, the Address cell SHALL render
`0x` followed by the uppercase hexadecimal address zero-padded to at least four digits (e.g. `0xE004`).

**Validates: Requirements 2.2, 2.3**

Property 3: Unit cell — empty when absent

_For any_ register where `unit` is absent, the Unit cell SHALL render as empty (no `undefined` text) and
SHALL NOT throw; where `unit` is present it SHALL render the unit string verbatim.

**Validates: Requirements 2.5, 2.6**

Property 4: Range rendering — readable unbounded max

_For any_ register, the Range cell SHALL render `min..max`; and where `max === Number.MAX_VALUE`, it
SHALL render a readable unbounded token (`∞`) instead of the raw `Number.MAX_VALUE` numeric literal.

**Validates: Requirements 2.7, 2.9**

Property 5: Empty-state — graceful single spanning row

_For any_ empty `STOREDGE_CONTROL_REGISTERS`, the table SHALL render exactly one row containing a
localized empty-state message spanning all six columns, and SHALL NOT throw.

**Validates: Requirements 4.1, 4.2**

Property 6: Localization — all fixed strings via `I18n.t`

_For any_ render, the section title, all six column headers, and the empty-state message SHALL be
produced through `I18n.t`, and the `Name` column SHALL reuse the existing `Name` key.

**Validates: Requirements 5.1, 5.3**

Property 7: Read-only — no device interaction, no inputs

_For any_ render or expansion of the StorEdge section, the component SHALL NOT initiate a Modbus read,
write, or `sendTo`, and SHALL NOT render any editable input control for register values.

**Validates: Requirements 3.1, 3.2, 3.3**

Property 8: Preservation — existing Settings behavior unchanged

_For any_ render, the existing SunSpec Values section (Inverter/Meter/Battery), the connection fields,
the Test Connection button, and validation behavior SHALL render exactly as before, and
`STOREDGE_CONTROL_REGISTERS` and the SunSpec poll model SHALL be unchanged.

**Validates: Requirements 7.1, 7.2, 7.3**

## i18n Keys

Six new keys are introduced. `Name` is reused (Req 5.3) and is NOT re-added. Each new key MUST be added
to all eleven locale files: `en`, `de`, `ru`, `pt`, `nl`, `fr`, `it`, `es`, `pl`, `uk`, `zh-cn`
(Req 5.2).

| Key | en | de |
|---|---|---|
| `StorEdge Control Block` | StorEdge Control Block | StorEdge Control Block |
| `Address` | Address | Adresse |
| `Encoding` | Encoding | Kodierung |
| `Unit` | Unit | Einheit |
| `Range` | Range | Bereich |
| `Function code` | Function code | Funktionscode |
| `No StorEdge control registers available` | No StorEdge control registers available | Keine StorEdge-Steuerregister verfügbar |

`StorEdge Control Block` is a product/brand term; it is kept identical across locales (translated
descriptive keys still get localized values in the other nine files). The remaining keys are
translated per locale following the conventions already present in each file.

## Testing Strategy

There are no existing admin-UI component tests in the repository (the admin app has no test harness /
jsdom setup wired up), and adding one is out of scope for this focused UI addition. Verification
therefore relies on:

1. **TypeScript typecheck / build of `src-admin`** — the primary gate. Running the admin build/typecheck
   confirms the new import resolves, `StorEdgeControlRegisterDef` field access (`address`, `kind`,
   `unit`, `min`, `max`, `fc`) is type-correct, the new render method compiles, and no existing code
   regressed. Command follows the project's existing admin build script (e.g. the `src-admin` Vite/tsc
   build defined in `package.json`).
2. **Existing storedge-control-map coverage** — the underlying data (`STOREDGE_CONTROL_REGISTERS`,
   including the `Number.MAX_VALUE` max on `STORAGE_AC_CHARGE_LIMIT`) is already exercised by the
   adapter-side unit tests for `src/lib/storedge-control-map.ts`; this feature consumes that data
   read-only and does not modify it, so those tests continue to guard the shape the table depends on.
3. **i18n completeness check** — confirm every new key exists in all eleven locale files (a simple
   grep/JSON-key comparison across `src-admin/src/i18n/*.json`).
4. **Manual smoke check** (documented, not automated) — load the admin Settings page, confirm the new
   collapsed "StorEdge Control Block (9)" accordion appears below the SunSpec Values paper, expand it,
   and verify: nine rows in order, `0xE004`-style addresses, the `∞` range for the AC charge limit,
   empty unit cells where applicable, and that the SunSpec section and connection form are unchanged.

If a lightweight React test harness is later added, Properties 1–8 above are the direct test targets
(render with the real nine-entry array; render with a mocked empty array for Property 5).
