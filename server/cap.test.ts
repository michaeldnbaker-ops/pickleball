import { describe, it, expect } from 'vitest';
import { capOf, overCap, validCourtSet } from './cap';
const ev = (n: number, max?: number) => ({ active: Array.from({ length: n }, (_, i) => 'p' + i), ...(max !== undefined ? { maxPlayers: max } : {}) });
describe('player cap (server)', () => {
  it('reads only 4/8/12/16; anything else is no cap', () => { expect([4, 8, 12, 16, 0, 5, 20].map(m => capOf(ev(0, m)))).toEqual([4, 8, 12, 16, 0, 0, 0]); expect(capOf(ev(3))).toBe(0); expect(capOf(null)).toBe(0); });
  it('refuses a join past the cap, allows up to it', () => { expect(overCap(ev(7, 8), ev(8, 8))).toBe(false); expect(overCap(ev(8, 8), ev(9, 8))).toBe(true); expect(overCap(ev(4, 4), ev(5))).toBe(true); });
  it('existing games without a cap are never full', () => { expect(overCap(ev(16), ev(17))).toBe(false); });
  it('drop outs / removals and same-size edits are allowed even when over (legacy data)', () => { expect(overCap(ev(9, 8), ev(8, 8))).toBe(false); expect(overCap(ev(9, 8), ev(9, 8))).toBe(false); });
  it('a new game cannot be created with more players than its cap', () => { expect(overCap(undefined, ev(9, 8))).toBe(true); expect(overCap(undefined, ev(8, 8))).toBe(false); });
});
describe('picked courts (server)', () => {
  it('accepts sorted unique courts matching the count; rejects anything else', () => {
    expect(validCourtSet([1, 2, 4], 3)).toBe(true); expect(validCourtSet([3], 1)).toBe(true);
    expect(validCourtSet([1, 2, 4], 2)).toBe(false); expect(validCourtSet([2, 1], 2)).toBe(false); expect(validCourtSet([1, 1], 2)).toBe(false);
    expect(validCourtSet([0, 2], 2)).toBe(false); expect(validCourtSet([1.5], 1)).toBe(false); expect(validCourtSet('A,B', 2)).toBe(false); expect(validCourtSet([], 0)).toBe(false);
  });
});
