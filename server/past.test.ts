import { describe, it, expect } from 'vitest';
import { buildPast } from './past';
const m = (a: string[], b: string[], sa: number, sb: number, court?: number) => ({ a, b, sa, sb, court });
const ok = { date: '2026-09-01', matches: [m(['Ann', 'Bob'], ['Cy', 'Di'], 11, 7, 2), m(['ann', 'Cy'], ['Bob', 'Ed'], 9, 11)] };
describe('add past game (server)', () => {
  it('builds a closed, added-later game; same name any case = one player', () => {
    const { ev } = buildPast(ok, '2026-10-21', 'ABC', 'h', 1);
    expect(ev).toMatchObject({ finished: true, addedLater: true, date: '2026-09-01T12:00', clubName: 'Stone Creek', name: 'Past game', trophy: false, totalRounds: 2 });
    expect((ev!.players as unknown[]).length).toBe(5);
    expect((ev!.rounds as { matches: { court: number }[] }[]).map(r => r.matches[0].court)).toEqual([2, 1]);
  });
  it('rejects today/future, bad scores, ties, repeats, guests and oversize', () => {
    const e = (x: object) => buildPast({ ...ok, ...x }, '2026-10-21', 'A', 'h', 1).error;
    expect(e({ date: '2026-10-21' })).toMatch(/past/); expect(e({ date: '2027-01-01' })).toMatch(/past/); expect(e({ date: '1999-01-01' })).toMatch(/old/);
    expect(e({ matches: [m(['A', 'B'], ['C', 'D'], 11, 11)] })).toMatch(/ties/);
    expect(e({ matches: [m(['A', 'B'], ['C', 'D'], 100, 1)] })).toMatch(/0–99/);
    expect(e({ matches: [m(['A', 'B'], ['a', 'D'], 11, 1)] })).toMatch(/different/);
    expect(e({ matches: [m(['A', 'Guest'], ['C', 'D'], 11, 1)] })).toMatch(/real name/);
    expect(e({ matches: [] })).toBeTruthy();
    expect(e({ matches: Array(41).fill(ok.matches[0]) })).toMatch(/40/);
  });
});
