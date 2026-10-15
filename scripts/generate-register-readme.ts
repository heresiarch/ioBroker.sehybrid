// Maps → README register-reference generator.
//
// Reads the SunSpec and StorEdge source maps through their UNCHANGED public API
// and emits the Modbus register reference as GitHub-Flavored-Markdown tables,
// injected only between clearly delimited markers in `README.md`. The source
// maps (`src/lib/sunspec-map.ts`, `src/lib/storedge-control-map.ts`) stay the
// single source of truth; this script never mutates them.
//
// Two modes:
//   - default:  regenerate the managed blocks and write `README.md`.
//   - --check:  regenerate in memory, compare against the on-disk `README.md`,
//               exit non-zero (with a diff summary of the drifted block) and
//               write nothing.
//
// Run via ts-node (see the `docs:readme` / `docs:readme:check` npm scripts). The
// table-building and marker-injection logic is exported so unit tests and the
// package-tier sync test can import it and exercise it against in-memory strings
// without touching the real README.
//
// Requirements: 2.5, 2.6, 2.7, 2.8

import * as fs from 'fs';
import * as path from 'path';

import {
    getInverterValueDefs,
    getMeterValueDefs,
    getBatteryValueDefs,
    getRegisterAddress,
    getBatteryBase,
    getDeviceRegisterAddress,
    type SunSpecRegisterDef,
} from '../src/lib/sunspec-map';
import { STOREDGE_CONTROL_REGISTERS, type StorEdgeControlRegisterDef } from '../src/lib/storedge-control-map';
import { formatAddress, formatRange } from '../src/lib/register-format';

/** Absolute path to the repository `README.md`. */
export const README_PATH = path.resolve(__dirname, '..', 'README.md');

/** Stable identifier of a managed, generated block inside the README. */
export type GeneratedBlockId = 'sunspec-inverter' | 'sunspec-meter' | 'sunspec-battery' | 'storedge-control';

/** The four managed block ids, in document order. */
export const GENERATED_BLOCK_IDS: readonly GeneratedBlockId[] = [
    'sunspec-inverter',
    'sunspec-meter',
    'sunspec-battery',
    'storedge-control',
];

/**
 * Begin marker for a managed block, e.g. `<!-- BEGIN:GENERATED:sunspec-inverter -->`.
 *
 * @param id Block identifier.
 */
export function beginMarker(id: GeneratedBlockId): string {
    return `<!-- BEGIN:GENERATED:${id} -->`;
}

/**
 * End marker for a managed block, e.g. `<!-- END:GENERATED:sunspec-inverter -->`.
 *
 * @param id Block identifier.
 */
export function endMarker(id: GeneratedBlockId): string {
    return `<!-- END:GENERATED:${id} -->`;
}

/**
 * Escape a cell value for safe inclusion in a GitHub-Flavored-Markdown table cell.
 * A raw `|` would prematurely close the cell and a newline would break the row, so
 * both are neutralised: `|` is backslash-escaped and CR/LF are collapsed to a space.
 *
 * @param value Raw cell text.
 */
export function escapeCell(value: string): string {
    return value.replace(/\r\n|\r|\n/g, ' ').replace(/\|/g, '\\|');
}

/**
 * Render a GitHub-Flavored-Markdown table from a header row and body rows.
 * Emits the header row, the `---` separator row, and one row per entry, with every
 * cell escaped. Returns the empty string for an empty table so a group with no defs
 * still produces deterministic (blank) output rather than a malformed table.
 *
 * @param headers Column headers (already human-readable).
 * @param rows One array of raw cell strings per body row.
 */
export function renderMarkdownTable(headers: string[], rows: string[][]): string {
    const headerLine = `| ${headers.map(escapeCell).join(' | ')} |`;
    const separatorLine = `| ${headers.map(() => '---').join(' | ')} |`;
    const bodyLines = rows.map(row => `| ${row.map(escapeCell).join(' | ')} |`);
    return [headerLine, separatorLine, ...bodyLines].join('\n');
}

/** Column headers for the SunSpec (Inverter / Meter / Battery) tables. */
export const SUNSPEC_HEADERS = ['Name', 'Register', 'Datatype', 'Model', 'Description'];

/** Column headers for the StorEdge Control Block table. */
export const STOREDGE_HEADERS = ['Name', 'Address', 'Encoding', 'Unit', 'Range', 'Function code'];

/**
 * Build the Markdown table for a group of SunSpec defs, matching the removed UI's
 * five columns: Name · Register · Datatype · Model · Description.
 *
 * @param defs SunSpec register definitions for this group, in map/selector order.
 * @param addressOf Maps a def to the Register-column absolute address. Inverter/meter
 *   groups use `getRegisterAddress`; the battery group passes a device-specific mapper
 *   (battery.1 absolute address) since `getRegisterAddress` does not handle model
 *   `'battery'`.
 */
export function buildSunSpecTable(
    defs: readonly SunSpecRegisterDef[],
    addressOf: (def: SunSpecRegisterDef) => number = getRegisterAddress,
): string {
    const rows = defs.map(def => [
        def.name,
        String(addressOf(def)),
        def.datatype,
        String(def.model),
        def.description ?? '',
    ]);
    return renderMarkdownTable(SUNSPEC_HEADERS, rows);
}

/**
 * Build the Markdown table for the StorEdge Control Block, matching the removed UI's
 * six columns: Name · Address · Encoding · Unit · Range · Function code.
 *
 * @param defs StorEdge control register definitions, in map order.
 */
export function buildStorEdgeTable(defs: readonly StorEdgeControlRegisterDef[]): string {
    const rows = defs.map(def => [
        def.name,
        formatAddress(def.address),
        def.kind,
        def.unit ?? '',
        formatRange(def.min, def.max),
        def.fc,
    ]);
    return renderMarkdownTable(STOREDGE_HEADERS, rows);
}

/**
 * Build the generated Markdown content for every managed block, keyed by block id.
 * Reads the maps through their public API only; the maps are never mutated.
 */
export function buildGeneratedBlocks(): Record<GeneratedBlockId, string> {
    return {
        'sunspec-inverter': buildSunSpecTable(getInverterValueDefs()),
        'sunspec-meter': buildSunSpecTable(getMeterValueDefs()),
        'sunspec-battery': buildSunSpecTable(getBatteryValueDefs(), def =>
            getDeviceRegisterAddress(getBatteryBase(1), def),
        ),
        'storedge-control': buildStorEdgeTable(STOREDGE_CONTROL_REGISTERS),
    };
}

/** Thrown when a managed block's marker pair is missing or malformed in the README. */
export class MarkerError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'MarkerError';
    }
}

/**
 * Replace the content between one block's marker pair with `content`, leaving the
 * markers themselves and everything outside them byte-for-byte untouched. The
 * generated content is fenced by blank lines so the table renders as its own block
 * regardless of the surrounding prose.
 *
 * Fails loudly (throws {@link MarkerError}) if the begin marker is missing, the end
 * marker is missing, there is more than one of either marker, or the end marker
 * precedes the begin marker — rather than guessing where to write.
 *
 * @param readme Full README text.
 * @param id Block identifier whose marker pair to locate.
 * @param content Generated Markdown to place between the markers.
 */
export function injectBlock(readme: string, id: GeneratedBlockId, content: string): string {
    const begin = beginMarker(id);
    const end = endMarker(id);

    const beginMatches = countOccurrences(readme, begin);
    const endMatches = countOccurrences(readme, end);

    if (beginMatches === 0) {
        throw new MarkerError(`Missing begin marker for block "${id}": expected ${begin}`);
    }
    if (endMatches === 0) {
        throw new MarkerError(`Missing end marker for block "${id}": expected ${end}`);
    }
    if (beginMatches > 1) {
        throw new MarkerError(`Malformed markers for block "${id}": found ${beginMatches} begin markers, expected 1`);
    }
    if (endMatches > 1) {
        throw new MarkerError(`Malformed markers for block "${id}": found ${endMatches} end markers, expected 1`);
    }

    const beginIndex = readme.indexOf(begin);
    const endIndex = readme.indexOf(end);
    if (endIndex < beginIndex) {
        throw new MarkerError(`Malformed markers for block "${id}": end marker precedes begin marker`);
    }

    const before = readme.slice(0, beginIndex + begin.length);
    const after = readme.slice(endIndex);
    return `${before}\n\n${content}\n\n${after}`;
}

/**
 * Inject every managed block's freshly generated content into `readme`, in document
 * order. Each block's markers must be present and well-formed or injection throws.
 *
 * @param readme Full README text.
 * @param blocks Generated content keyed by block id (defaults to {@link buildGeneratedBlocks}).
 */
export function injectAllBlocks(
    readme: string,
    blocks: Record<GeneratedBlockId, string> = buildGeneratedBlocks(),
): string {
    let result = readme;
    for (const id of GENERATED_BLOCK_IDS) {
        result = injectBlock(result, id, blocks[id]);
    }
    return result;
}

/**
 * Count non-overlapping occurrences of `needle` in `haystack`.
 *
 * @param haystack Text to scan.
 * @param needle Substring to count.
 */
function countOccurrences(haystack: string, needle: string): number {
    if (needle.length === 0) {
        return 0;
    }
    let count = 0;
    let index = haystack.indexOf(needle);
    while (index !== -1) {
        count += 1;
        index = haystack.indexOf(needle, index + needle.length);
    }
    return count;
}

/** Result of a sync check: whether the README is in sync and which blocks drifted. */
export interface CheckResult {
    inSync: boolean;
    /** Human-readable summary of the drift, empty when in sync. */
    summary: string;
    /** Ids of the blocks whose content differs from freshly generated output. */
    driftedBlocks: GeneratedBlockId[];
}

/**
 * Extract the current content between a block's marker pair (trimmed of the blank-line
 * padding injection adds), or `null` if the markers are missing/malformed.
 *
 * @param readme Full README text.
 * @param id Block identifier.
 */
function extractBlockContent(readme: string, id: GeneratedBlockId): string | null {
    const begin = beginMarker(id);
    const end = endMarker(id);
    const beginIndex = readme.indexOf(begin);
    const endIndex = readme.indexOf(end);
    if (beginIndex === -1 || endIndex === -1 || endIndex < beginIndex) {
        return null;
    }
    return readme.slice(beginIndex + begin.length, endIndex).trim();
}

/**
 * Compare the on-disk README against freshly generated output, per managed block.
 * Pure: compares the given strings and never writes.
 *
 * @param readme Current README text.
 * @param blocks Freshly generated content keyed by block id (defaults to {@link buildGeneratedBlocks}).
 */
export function checkReadme(
    readme: string,
    blocks: Record<GeneratedBlockId, string> = buildGeneratedBlocks(),
): CheckResult {
    const driftedBlocks: GeneratedBlockId[] = [];
    const summaryLines: string[] = [];

    for (const id of GENERATED_BLOCK_IDS) {
        const current = extractBlockContent(readme, id);
        const expected = blocks[id].trim();
        if (current === null) {
            driftedBlocks.push(id);
            summaryLines.push(`- ${id}: marker pair missing or malformed in README.md`);
            continue;
        }
        if (current !== expected) {
            driftedBlocks.push(id);
            summaryLines.push(`- ${id}: README.md is out of sync with the source maps`);
        }
    }

    return {
        inSync: driftedBlocks.length === 0,
        summary: summaryLines.join('\n'),
        driftedBlocks,
    };
}

/**
 * Regenerate the managed blocks and write `README.md`. Reads the current README,
 * injects every block, and writes the result back.
 *
 * @param readmePath Path to the README (defaults to {@link README_PATH}).
 */
export function writeReadme(readmePath: string = README_PATH): void {
    const readme = fs.readFileSync(readmePath, 'utf8');
    const updated = injectAllBlocks(readme);
    fs.writeFileSync(readmePath, updated, 'utf8');
}

/**
 * Run the sync check against the on-disk `README.md`.
 *
 * @param readmePath Path to the README (defaults to {@link README_PATH}).
 */
export function checkReadmeFile(readmePath: string = README_PATH): CheckResult {
    const readme = fs.readFileSync(readmePath, 'utf8');
    return checkReadme(readme);
}

/**
 * CLI entry point. With `--check` it runs the sync check and exits non-zero on drift;
 * otherwise it regenerates and writes `README.md`.
 *
 * @param argv Process arguments (defaults to the real `process.argv`).
 */
export function main(argv: string[] = process.argv.slice(2)): void {
    const checkMode = argv.includes('--check');

    if (checkMode) {
        const result = checkReadmeFile();
        if (result.inSync) {
            console.log('README.md register tables are in sync with the source maps.');
            return;
        }

        console.error('README.md register tables are OUT OF SYNC with the source maps:');

        console.error(result.summary);

        console.error('Run `npm run docs:readme` to regenerate.');
        process.exit(1);
    }

    writeReadme();

    console.log('README.md register tables regenerated from the source maps.');
}

// Only run the CLI when executed directly (ts-node scripts/generate-register-readme.ts),
// not when imported by the unit/sync tests.
if (require.main === module) {
    main();
}
