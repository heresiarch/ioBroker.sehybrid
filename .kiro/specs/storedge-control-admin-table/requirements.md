# Requirements Document

## Introduction

The adapter's admin Settings UI (`src-admin/src/components/Settings.tsx`) already presents a
read-only "SunSpec Values" reference table with three collapsible groups — Inverter, Meter and
Battery — each rendered from the static SunSpec register definitions. The Global StorEdge Control
Block registers (nine manufacturer-documented registers at base `0xE004`) are described by their own
static data in `src/lib/storedge-control-map.ts` (`STOREDGE_CONTROL_REGISTERS`), but there is no
corresponding reference view in the admin UI.

This feature adds a read-only "StorEdge Control Block" table to the admin Settings UI, mirroring the
look and behavior of the existing SunSpec tables (a titled `Paper` / `Accordion` with a MUI `Table`),
but adapted to the different shape of `StorEdgeControlRegisterDef`. The `StorEdgeControlRegisterDef`
type has no `datatype` / `model` / `description` fields; instead it carries `kind`, `length`,
`wordOrder`, `unit`, `min`, `max`, and `fc`. The table is a static documentation aid: it displays the
register definitions only and does not poll, read, or write any live values. All user-visible strings
are localized across the eleven existing admin locale files.

## Requirements

### Requirement 1: StorEdge Control Block reference table is shown in Settings

**User Story:** As an adapter user configuring the admin instance, I want to see the StorEdge control
block registers in a table, so that I have the same at-a-glance register reference I already have for
the SunSpec inverter, meter and battery values.

#### Acceptance Criteria

1.1 WHEN the Settings component renders THEN the system SHALL display a StorEdge Control Block section
    in addition to the existing SunSpec Values section.

1.2 WHEN the StorEdge Control Block section renders THEN the system SHALL present it in a collapsible
    container (a MUI `Accordion`) consistent with the existing SunSpec value groups.

1.3 WHEN the StorEdge Control Block section header renders THEN the system SHALL show a localized title
    followed by the number of registers in parentheses, matching the existing group-header pattern
    (e.g. `StorEdge Control Block (9)`).

1.4 WHEN the StorEdge Control Block table renders THEN the system SHALL source its rows exclusively
    from the exported `STOREDGE_CONTROL_REGISTERS` data in `src/lib/storedge-control-map.ts`.

1.5 WHEN the StorEdge Control Block table renders THEN the system SHALL produce exactly one row per
    entry in `STOREDGE_CONTROL_REGISTERS`, in the same order as that array.

### Requirement 2: Table columns reflect the StorEdge register shape

**User Story:** As an adapter user, I want the StorEdge table columns to describe each register's
address, encoding, unit, valid range and write function code, so that the fields relevant to a control
register are visible rather than the SunSpec-specific fields.

#### Acceptance Criteria

2.1 WHEN the StorEdge table header renders THEN the system SHALL display a column for the register
    `name`.

2.2 WHEN the StorEdge table header renders THEN the system SHALL display a column for the register
    `address` (the absolute base-0 Modbus register address).

2.3 WHEN a register `address` is displayed THEN the system SHALL render it in a form consistent with
    how the register is documented (hexadecimal in the `0xExxx` range, e.g. `0xE004`).

2.4 WHEN the StorEdge table header renders THEN the system SHALL display a column for the register
    `kind` (the on-the-wire value encoding: `uint16`, `float32` or `uint32`).

2.5 WHEN the StorEdge table header renders THEN the system SHALL display a column for the register
    `unit`.

2.6 WHEN a register has no `unit` (the field is absent) THEN the system SHALL render the unit cell as
    empty without error.

2.7 WHEN the StorEdge table header renders THEN the system SHALL display a column that conveys the
    register's documented inclusive range (`min`..`max`).

2.8 WHEN the StorEdge table header renders THEN the system SHALL display a column for the write
    function code `fc` (`FC06` or `FC16`).

2.9 WHEN the `max` value is `Number.MAX_VALUE` (an unbounded documented maximum) THEN the system SHALL
    render the range in a readable form rather than printing the raw `Number.MAX_VALUE` numeric literal.

### Requirement 3: Read-only, no live device interaction

**User Story:** As an adapter user, I want the StorEdge table to be purely informational, so that
viewing the admin page never triggers a Modbus read or write against my inverter.

#### Acceptance Criteria

3.1 WHEN the StorEdge Control Block table renders THEN the system SHALL display only the static register
    definitions and SHALL NOT display live register values.

3.2 WHEN the StorEdge Control Block table renders or is expanded THEN the system SHALL NOT initiate any
    Modbus read, write, or `sendTo` device interaction.

3.3 WHEN the StorEdge Control Block table renders THEN the system SHALL NOT provide any editable input
    controls for the register values (the table is display-only).

### Requirement 4: Empty-state handling

**User Story:** As a developer maintaining the register definitions, I want the table to degrade
gracefully if the register list is ever empty, so that the admin UI never breaks on missing data.

#### Acceptance Criteria

4.1 WHEN `STOREDGE_CONTROL_REGISTERS` contains no entries THEN the system SHALL render a single row
    containing a localized empty-state message spanning the table's columns.

4.2 WHEN the empty-state row renders THEN the system SHALL NOT throw or render a broken table.

### Requirement 5: Localization of all user-visible strings

**User Story:** As a non-English-speaking adapter user, I want the StorEdge table's title, column
headers and empty-state message to appear in my language, so that the new section is consistent with
the rest of the localized admin UI.

#### Acceptance Criteria

5.1 WHEN any StorEdge table string is displayed (section title, column headers, empty-state message)
    THEN the system SHALL render it through the admin i18n translation mechanism (`I18n.t`).

5.2 WHEN new translation keys are introduced for this feature THEN the system SHALL add each key to all
    eleven existing admin locale files (`en`, `de`, `ru`, `pt`, `nl`, `fr`, `it`, `es`, `pl`, `uk`,
    `zh-cn`).

5.3 WHERE an existing localized key already covers a needed string (e.g. `Name`) THEN the system SHALL
    reuse that existing key rather than introduce a duplicate.

### Requirement 6: Consistency with the existing SunSpec table presentation

**User Story:** As an adapter user, I want the StorEdge table to look and behave like the SunSpec
tables I already know, so that the admin page feels cohesive.

#### Acceptance Criteria

6.1 WHEN the StorEdge Control Block section renders THEN the system SHALL use the same MUI table
    primitives and styling conventions (`Table` `size="small"`, the shared scroll-box wrapper, the
    accordion detail styling) already used by the SunSpec value groups.

6.2 WHEN both the SunSpec Values section and the StorEdge Control Block section are present THEN the
    system SHALL lay them out so both are reachable and visually distinct within the Settings form.

6.3 WHEN the StorEdge Control Block section is first shown THEN the system SHALL default it to a
    collapsed/expanded state consistent with the sibling non-default SunSpec accordions (collapsed by
    default, matching the Meter and Battery groups).

### Requirement 7: No impact on existing behavior

**User Story:** As an adapter user, I want the existing Settings functionality to keep working exactly
as before, so that adding the StorEdge table introduces no regressions.

#### Acceptance Criteria

7.1 WHEN the Settings component renders after this change THEN the system SHALL CONTINUE TO render the
    existing SunSpec Values section (Inverter, Meter, Battery groups) unchanged.

7.2 WHEN the Settings component renders after this change THEN the system SHALL CONTINUE TO render the
    connection fields, Test Connection button and validation behavior unchanged.

7.3 WHEN this feature is added THEN the system SHALL NOT modify the `STOREDGE_CONTROL_REGISTERS` data or
    the SunSpec read/poll model.
