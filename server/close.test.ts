import { describe, it, expect } from 'vitest';
import { closeEvent } from './close';
const m = (sa?: number, sb?: number) => ({ court: 1, a: ['a', 'b'], b: ['c', 'd'], sa, sb });
describe('auto-close (server)', () => {
  it('keeps scored matches after a skipped round, drops blank courts, and does not mutate input', () => {
    const ev = { name: 'x', rounds: [{ n: 1, matches: [m(11, 2)], byes: [] }], plan: [{ n: 2, matches: [m(11, 9), m(8, 11)], byes: ['z'] }, { n: 3, matches: [m(11, 1), m()], byes: [] }, { n: 4, matches: [m(11, 3)], byes: [] }, { n: 5, matches: [m()], byes: [] }], planKey: 'k' };
    const c = closeEvent(ev);
    expect(c.finished).toBe(true); expect(c.rounds!.map(r => r.n)).toEqual([1, 2, 3, 4]);
    expect(c.rounds![1].byes).toEqual(['z']); expect(c.rounds![2].matches).toEqual([m(11, 1)]); expect(c.rounds![3].matches).toEqual([m(11, 3)]);
    expect(c.plan).toBeUndefined(); expect(c.planKey).toBeUndefined(); expect(c.name).toBe('x'); expect(ev.plan).toHaveLength(4);
  });
});
