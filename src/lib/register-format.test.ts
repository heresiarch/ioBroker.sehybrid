// Unit and property tests for the shared register display formatters.
//
// Covers the semantics the Admin UI relied on and that the maps→README
// generator depends on:
// - `formatAddress`: `0x`-prefixed, uppercase, 4-digit, zero-padded hex.
// - `formatRange`: `"min..max"`, with `Number.MAX_VALUE` rendered as `∞`.
//
// Validates: Requirements 2.3, 2.6

import { expect } from 'chai';
import fc from 'fast-check';

import { formatAddress, formatRange } from './register-format';

describe('register-format', () => {
    describe('formatAddress', () => {
        it('formats a mid-range address as uppercase 4-digit 0x hex', () => {
            expect(formatAddress(0xe004)).to.equal('0xE004');
        });

        it('formats another mid-range address consistently', () => {
            expect(formatAddress(0xe010)).to.equal('0xE010');
        });

        it('zero-pads small addresses to 4 digits', () => {
            expect(formatAddress(0)).to.equal('0x0000');
            expect(formatAddress(0x5)).to.equal('0x0005');
            expect(formatAddress(0x2a)).to.equal('0x002A');
            expect(formatAddress(0x1ff)).to.equal('0x01FF');
        });

        it('uppercases hex letter digits', () => {
            expect(formatAddress(0xabcd)).to.equal('0xABCD');
            expect(formatAddress(0xbeef)).to.equal('0xBEEF');
        });

        it('does not truncate addresses that exceed 4 hex digits', () => {
            expect(formatAddress(0x12345)).to.equal('0x12345');
        });

        it('always produces a 0x prefix, uppercase hex, and at least 4 digits', () => {
            fc.assert(
                fc.property(fc.nat({ max: 0xffff }), address => {
                    const result = formatAddress(address);
                    expect(result.startsWith('0x')).to.equal(true);
                    const body = result.slice(2);
                    expect(body.length).to.be.at.least(4);
                    expect(body).to.equal(body.toUpperCase());
                    expect(/^[0-9A-F]+$/.test(body)).to.equal(true);
                    expect(parseInt(body, 16)).to.equal(address);
                }),
            );
        });
    });

    describe('formatRange', () => {
        it('renders ordinary bounds as "min..max"', () => {
            expect(formatRange(0, 4)).to.equal('0..4');
            expect(formatRange(0, 86400)).to.equal('0..86400');
            expect(formatRange(1, 65535)).to.equal('1..65535');
        });

        it('renders Number.MAX_VALUE as the infinity token ∞', () => {
            expect(formatRange(0, Number.MAX_VALUE)).to.equal('0..∞');
            expect(formatRange(10, Number.MAX_VALUE)).to.equal('10..∞');
        });

        it('handles negative lower bounds', () => {
            expect(formatRange(-32768, 32767)).to.equal('-32768..32767');
        });

        it('always renders "min..max" with ∞ exactly when max is Number.MAX_VALUE', () => {
            fc.assert(
                fc.property(fc.integer(), fc.oneof(fc.integer(), fc.constant(Number.MAX_VALUE)), (min, max) => {
                    const result = formatRange(min, max);
                    const expectedMax = max === Number.MAX_VALUE ? '∞' : String(max);
                    expect(result).to.equal(`${min}..${expectedMax}`);
                }),
            );
        });
    });
});
