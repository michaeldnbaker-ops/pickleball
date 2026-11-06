import { describe, it, expect } from 'vitest';
import { closeEvent, liveUntil } from './close';
const m = (sa?: number, sb?: number) => ({ court: 1, a: ['a', 'b'], b: ['c', 'd'], sa, sb });
describe('auto-close (server)', () => {
  it('keeps scored matches after a skipped round, drops blank courts, and does not mutate input', () => {
    const ev = { name: 'x', rounds: [{ n: 1, matches: [m(11, 2)], byes: [] }], plan: [{ n: 2, matches: [m(11, 9), m(8, 11)], byes: ['z'] }, { n: 3, matches: [m(11, 1), m()], byes: [] }, { n: 4, matches: [m(11, 3)], byes: [] }, { n: 5, matches: [m()], byes: [] }], planKey: 'k' };
    const c = closeEvent(ev);
    expect(c.finished).toBe(true); expect(c.rounds!.map(r => r.n)).toEqual([1, 2, 3, 4]);
    expect(c.rounds![1].byes).toEqual(['z']); expect(c.rounds![2].matches).toEqual([m(11, 1)]); expect(c.rounds![3].matches).toEqual([m(11, 3)]);
    expect(c.plan).toBeUndefined(); expect(c.planKey).toBeUndefined(); expect(c.name).toBe('x'); expect(ev.plan).toHaveLength(4);
  });
  it('a 4:30pm game is still live at 2am, and a game scheduled 30 hours ago is not', () => {
    const now = Date.parse('2026-11-06T08:02:00Z');
    const cut = liveUntil(now);
    expect('2026-11-05T16:30' >= cut).toBe(true);
    expect('2026-11-04T20:02' >= cut).toBe(false);
  });
});
