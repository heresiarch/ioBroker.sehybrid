// Unit tests for the maps → README register-reference generator.
//
// Covers the table-building and marker-injection logic against in-memory fixture
// strings (no real README required): exact headers + one row per def, formatter-driven
// Register/Address/Range cells, pipe/newline escaping, inside-marker-only replacement,
// and loud failure on missing/malformed markers. Also asserts round-trip drift
// detection via checkReadme.
//
// Validates: Requirements 2.5, 2.6, 2.7, 2.8

import { expect } from 'chai';
import fc from 'fast-check';

import {
    SUNSPEC_HEADERS,
    STOREDGE_HEADERS,
    GENERATED_BLOCK_IDS,
    escapeCell,
    renderMarkdownTable,
    buildSunSpecTable,
    buildStorEdgeTable,
    buildGeneratedBlocks,
    beginMarker,
    endMarker,
    injectBlock,
    injectAllBlocks,
    checkReadme,
    MarkerError,
    type GeneratedBlockId,
} from './generate-register-readme';
import type { SunSpecRegisterDef } from '../src/lib/sunspec-map';
import { STOREDGE_CONTROL_REGISTERS, type StorEdgeControlRegisterDef } from '../src/lib/storedge-control-map';
import { formatAddress, formatRange } from '../src/lib/register-format';

// A tiny SunSpec fixture so header/row/formatting assertions do not depend on the
// full map. Addresses are the raw numbers the UI rendered (getRegisterAddress-equivalent).
const SUNSPEC_FIXTURE: SunSpecRegisterDef[] = [
    {
        name: 'acPower',
        model: 101,
        offset: 14,
        length: 1,
        datatype: 'int16',
        role: 'power',
        iobType: 'number',
        description: 'I_AC_Power — AC Power value',
    },
    {
        name: 'acCurrent',
        model: 102,
        offset: 2,
        length: 1,
        datatype: 'uint16',
        role: 'current',
        iobType: 'number',
        // No description -> should render as an empty cell.
    },
];

describe('generate-register-readme', () => {
    describe('escapeCell', () => {
        it('escapes pipe characters so a cell cannot break the table', () => {
            expect(escapeCell('a|b')).to.equal('a\\|b');
            expect(escapeCell('x | y | z')).to.equal('x \\| y \\| z');
        });

        it('collapses CR/LF to a single space so a cell cannot break the row', () => {
            expect(escapeCell('line1\nline2')).to.equal('line1 line2');
            expect(escapeCell('a\r\nb')).to.equal('a b');
            expect(escapeCell('a\rb')).to.equal('a b');
        });

        it('leaves ordinary text unchanged', () => {
            expect(escapeCell('I_AC_Power — AC Power value')).to.equal('I_AC_Power — AC Power value');
        });
    });

    describe('renderMarkdownTable', () => {
        it('emits a header row, a --- separator row, and one row per entry', () => {
            const table = renderMarkdownTable(
                ['A', 'B'],
                [
                    ['1', '2'],
                    ['3', '4'],
                ],
            );
            const lines = table.split('\n');
            expect(lines).to.have.lengthOf(4);
            expect(lines[0]).to.equal('| A | B |');
            expect(lines[1]).to.equal('| --- | --- |');
            expect(lines[2]).to.equal('| 1 | 2 |');
            expect(lines[3]).to.equal('| 3 | 4 |');
        });

        it('escapes pipe and newline content inside cells', () => {
            const table = renderMarkdownTable(['A'], [['x|y'], ['p\nq']]);
            const lines = table.split('\n');
            expect(lines[2]).to.equal('| x\\|y |');
            expect(lines[3]).to.equal('| p q |');
        });
    });

    describe('buildSunSpecTable', () => {
        it('uses the exact SunSpec column headers', () => {
            const table = buildSunSpecTable(SUNSPEC_FIXTURE);
            const headerLine = table.split('\n')[0];
            expect(headerLine).to.equal(`| ${SUNSPEC_HEADERS.join(' | ')} |`);
            expect(SUNSPEC_HEADERS).to.deep.equal(['Name', 'Register', 'Datatype', 'Model', 'Description']);
        });

        it('emits exactly one body row per def', () => {
            const table = buildSunSpecTable(SUNSPEC_FIXTURE);
            const bodyLines = table.split('\n').slice(2);
            expect(bodyLines).to.have.lengthOf(SUNSPEC_FIXTURE.length);
        });

        it('fills Name/Register/Datatype/Model/Description from the def', () => {
            const table = buildSunSpecTable(SUNSPEC_FIXTURE, def => 1000 + def.offset);
            const bodyLines = table.split('\n').slice(2);
            expect(bodyLines[0]).to.equal('| acPower | 1014 | int16 | 101 | I_AC_Power — AC Power value |');
            // Missing description renders as an empty cell.
            expect(bodyLines[1]).to.equal('| acCurrent | 1002 | uint16 | 102 |  |');
        });

        it('uses the provided addressOf mapper for the Register column', () => {
            const table = buildSunSpecTable(SUNSPEC_FIXTURE, () => 0xbeef);
            const bodyLines = table.split('\n').slice(2);
            expect(bodyLines[0]).to.contain('| 48879 |'); // String(0xBEEF)
        });
    });

    describe('buildStorEdgeTable', () => {
        it('uses the exact StorEdge column headers', () => {
            const table = buildStorEdgeTable(STOREDGE_CONTROL_REGISTERS);
            const headerLine = table.split('\n')[0];
            expect(headerLine).to.equal(`| ${STOREDGE_HEADERS.join(' | ')} |`);
            expect(STOREDGE_HEADERS).to.deep.equal(['Name', 'Address', 'Encoding', 'Unit', 'Range', 'Function code']);
        });

        it('emits exactly one body row per control register', () => {
            const table = buildStorEdgeTable(STOREDGE_CONTROL_REGISTERS);
            const bodyLines = table.split('\n').slice(2);
            expect(bodyLines).to.have.lengthOf(STOREDGE_CONTROL_REGISTERS.length);
        });

        it('formats Address and Range cells via the shared formatters', () => {
            const table = buildStorEdgeTable(STOREDGE_CONTROL_REGISTERS);
            const bodyLines = table.split('\n').slice(2);
            STOREDGE_CONTROL_REGISTERS.forEach((def: StorEdgeControlRegisterDef, i) => {
                const cells = bodyLines[i].split(' | ');
                expect(cells[0]).to.equal(`| ${def.name}`);
                expect(cells[1]).to.equal(formatAddress(def.address));
                expect(cells[2]).to.equal(def.kind);
                expect(cells[3]).to.equal(def.unit ?? '');
                expect(cells[4]).to.equal(formatRange(def.min, def.max));
                expect(cells[5]).to.equal(`${def.fc} |`);
            });
        });

        it('renders an unbounded max as ∞ (formatRange)', () => {
            // storageAcChargeLimit (0xE006) has max = Number.MAX_VALUE.
            const table = buildStorEdgeTable(STOREDGE_CONTROL_REGISTERS);
            expect(table).to.contain('0..∞');
        });
    });

    describe('injectBlock', () => {
        const id: GeneratedBlockId = 'sunspec-inverter';
        const begin = beginMarker(id);
        const end = endMarker(id);

        it('replaces only the content between the markers and leaves prose outside untouched', () => {
            const readme = `# Title\n\nIntro prose.\n\n${begin}\nOLD CONTENT\n${end}\n\nTrailing prose.\n`;
            const result = injectBlock(readme, id, 'NEW CONTENT');
            expect(result).to.contain('# Title');
            expect(result).to.contain('Intro prose.');
            expect(result).to.contain('Trailing prose.');
            expect(result).to.contain('NEW CONTENT');
            expect(result).to.not.contain('OLD CONTENT');
            // Markers themselves are preserved.
            expect(result).to.contain(begin);
            expect(result).to.contain(end);
            // Bytes before the begin marker and after the end marker are unchanged.
            const beforeOriginal = readme.slice(0, readme.indexOf(begin));
            const beforeResult = result.slice(0, result.indexOf(begin));
            expect(beforeResult).to.equal(beforeOriginal);
            const afterOriginal = readme.slice(readme.indexOf(end) + end.length);
            const afterResult = result.slice(result.indexOf(end) + end.length);
            expect(afterResult).to.equal(afterOriginal);
        });

        it('throws a loud MarkerError when the begin marker is missing', () => {
            const readme = `prose\n${end}\nprose`;
            expect(() => injectBlock(readme, id, 'X')).to.throw(MarkerError, /Missing begin marker/);
        });

        it('throws a loud MarkerError when the end marker is missing', () => {
            const readme = `prose\n${begin}\nprose`;
            expect(() => injectBlock(readme, id, 'X')).to.throw(MarkerError, /Missing end marker/);
        });

        it('throws when a marker appears more than once (malformed)', () => {
            const readme = `${begin}\na\n${end}\n${begin}\nb\n${end}`;
            expect(() => injectBlock(readme, id, 'X')).to.throw(MarkerError, /begin markers/);
        });

        it('throws when the end marker precedes the begin marker (malformed)', () => {
            const readme = `${end}\nstuff\n${begin}`;
            expect(() => injectBlock(readme, id, 'X')).to.throw(MarkerError, /end marker precedes begin marker/);
        });
    });

    describe('injectAllBlocks', () => {
        function readmeWithAllMarkers(): string {
            const sections = GENERATED_BLOCK_IDS.map(
                id => `## ${id}\n\n${beginMarker(id)}\nplaceholder\n${endMarker(id)}`,
            ).join('\n\n');
            return `# README\n\nPreamble prose.\n\n${sections}\n\nPostamble prose.\n`;
        }

        it('injects every managed block without disturbing surrounding prose', () => {
            const readme = readmeWithAllMarkers();
            const blocks: Record<GeneratedBlockId, string> = {
                'sunspec-inverter': 'INV',
                'sunspec-meter': 'MET',
                'sunspec-battery': 'BAT',
                'storedge-control': 'CTRL',
            };
            const result = injectAllBlocks(readme, blocks);
            expect(result).to.contain('Preamble prose.');
            expect(result).to.contain('Postamble prose.');
            for (const id of GENERATED_BLOCK_IDS) {
                expect(result).to.contain(beginMarker(id));
                expect(result).to.contain(endMarker(id));
                expect(result).to.contain(blocks[id]);
            }
            expect(result).to.not.contain('placeholder');
        });

        it('is idempotent: re-injecting the same blocks produces identical output', () => {
            const readme = readmeWithAllMarkers();
            const first = injectAllBlocks(readme);
            const second = injectAllBlocks(first);
            expect(second).to.equal(first);
        });
    });

    describe('checkReadme', () => {
        function freshReadme(): string {
            const sections = GENERATED_BLOCK_IDS.map(id => `${beginMarker(id)}\nplaceholder\n${endMarker(id)}`).join(
                '\n\n',
            );
            return injectAllBlocks(`# README\n\n${sections}\n`);
        }

        it('reports in sync for freshly generated output', () => {
            const result = checkReadme(freshReadme());
            expect(result.inSync).to.equal(true);
            expect(result.driftedBlocks).to.be.empty;
        });

        it('reports drift when a block content is mutated', () => {
            const readme = freshReadme().replace('| acPower |', '| acPowerMUTATED |');
            const result = checkReadme(readme);
            expect(result.inSync).to.equal(false);
            expect(result.driftedBlocks).to.include('sunspec-inverter');
            expect(result.summary).to.contain('sunspec-inverter');
        });

        it('reports drift when a block marker pair is missing', () => {
            const readme = freshReadme()
                .replace(beginMarker('storedge-control'), '')
                .replace(endMarker('storedge-control'), '');
            const result = checkReadme(readme);
            expect(result.inSync).to.equal(false);
            expect(result.driftedBlocks).to.include('storedge-control');
        });
    });

    describe('property: injection preserves out-of-marker bytes', () => {
        it('never alters prose outside a block, for arbitrary surrounding text', () => {
            const id: GeneratedBlockId = 'sunspec-meter';
            fc.assert(
                fc.property(fc.string(), fc.string(), fc.string(), (before, inside, content) => {
                    // Keep markers out of the random prose so there is exactly one pair.
                    const safeBefore = before.replace(/<!--|-->/g, '');
                    const safeContent = content.replace(/<!--|-->/g, '');
                    const readme = `${safeBefore}${beginMarker(id)}${inside}${endMarker(id)}AFTER`;
                    const result = injectBlock(readme, id, safeContent);
                    const beginIdx = result.indexOf(beginMarker(id));
                    const endIdx = result.indexOf(endMarker(id));
                    expect(result.slice(0, beginIdx)).to.equal(safeBefore);
                    expect(result.slice(endIdx + endMarker(id).length)).to.equal('AFTER');
                }),
            );
        });
    });

    describe('property: buildGeneratedBlocks never emits a structurally broken row', () => {
        it('every generated row has the same column count as its header', () => {
            const blocks = buildGeneratedBlocks();
            for (const id of GENERATED_BLOCK_IDS) {
                const lines = blocks[id].split('\n');
                const headerPipes = (lines[0].match(/(?<!\\)\|/g) ?? []).length;
                for (const line of lines) {
                    const pipes = (line.match(/(?<!\\)\|/g) ?? []).length;
                    expect(pipes).to.equal(headerPipes);
                }
            }
        });
    });
});
