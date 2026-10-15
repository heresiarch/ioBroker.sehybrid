// Shared display formatters for Modbus register addresses and value ranges.
//
// These pure helpers were originally defined inside the Admin config component
// (`src-admin/src/components/Settings.tsx`). They are relocated here so both the
// (removed) UI semantics and the maps→README generator share a single
// implementation, keeping one source of truth for the display formatting.

/**
 * Format a Modbus register address as an uppercase, 4-digit, `0x`-prefixed hex string.
 * e.g. `0xe004 → "0xE004"`, `0xe010 → "0xE010"`.
 *
 * @param address Register address as a number.
 */
export function formatAddress(address: number): string {
    return `0x${address.toString(16).toUpperCase().padStart(4, '0')}`;
}

/**
 * Format a min/max range as `"min..max"`, rendering an unbounded max
 * (`Number.MAX_VALUE`) as the language-neutral infinity token `∞`.
 * e.g. `(0, 4) → "0..4"`, `(0, Number.MAX_VALUE) → "0..∞"`, `(0, 86400) → "0..86400"`.
 *
 * @param min Range lower bound.
 * @param max Range upper bound; `Number.MAX_VALUE` is treated as unbounded.
 */
export function formatRange(min: number, max: number): string {
    const maxLabel = max === Number.MAX_VALUE ? '∞' : String(max);
    return `${min}..${maxLabel}`;
}
