import { describe, it, expect } from 'vitest';
import { startEvent, mulberry, history, EventT, Round } from './engine';
const key = (x: string, y: string) => (x < y ? x + '|' + y : y + '|' + x);
function run(n: number, R: number, courts: number, seed: number) {
  const players = Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i }));
  const ev: EventT = { id: 'x', name: '', date: '', place: '', format: 'rotating', courts, totalRounds: R, balanceDupr: false, seeding: 'random', players, active: players.map(p => p.id), teams: [], rounds: [], createdAt: 0 };
  startEvent(ev, mulberry(seed));
  const rounds: Round[] = [...ev.rounds, ...(ev.plan || [])]; const h = history(rounds); const ids = ev.active;
  const g = ids.map(i => h.games.get(i) || 0), b = ids.map(i => h.byes.get(i) || 0);
  let maxP = 0, maxO = 0, partnerOverBound = 0;
  for (const i of ids) for (const j of ids) if (i < j) {
    const p = h.partner.get(key(i, j)) || 0, o = h.opp.get(key(i, j)) || 0; maxP = Math.max(maxP, p); maxO = Math.max(maxO, o);
    // a pair may repeat only once one of them has played more games than there are other players to partner with
    const bound = Math.max(1, Math.ceil(Math.min(h.games.get(i) || 0, h.games.get(j) || 0) / (n - 1)));
    if (p > bound) partnerOverBound++;
  }
  const oBound = Math.max(1, Math.ceil(2 * Math.max(...g) / (n - 1)));
  return { rounds, maxP, maxO, oBound, partnerOverBound, byeSpread: Math.max(...b) - Math.min(...b), gameSpread: Math.max(...g) - Math.min(...g), r1: JSON.stringify(rounds[0].matches) };
}
const cases: [number, number, number][] = [];
for (let n = 4; n <= 16; n++) cases.push([n, n <= 8 ? 8 : 6, Math.floor(n / 4)]);
cases.push([12, 8, 2], [10, 8, 1], [16, 10, 3], [9, 10, 2], [6, 12, 1], [7, 12, 1]);
describe('rotating scheduler quality (4–16 players)', () => {
  for (const [n, R, courts] of cases) it(`${n} players, ${R} rounds, ${courts} court(s)`, () => {
    const a = run(n, R, courts, 11), b = run(n, R, courts, 9973);
    for (const x of [a, b]) {
      expect(x.rounds).toHaveLength(R);
      expect(x.rounds.every(r => r.matches.length === Math.min(courts, Math.floor(n / 4)))).toBe(true);
      expect(x.byeSpread).toBeLessThanOrEqual(1); // sit-outs spread evenly
      expect(x.gameSpread).toBeLessThanOrEqual(1); // games played even
      expect(x.partnerOverBound).toBe(0); // no repeat partner until unavoidable
      expect(x.maxO).toBeLessThanOrEqual(x.oBound + 2); // opponents spread (within 2 of the simple per-player bound)
    }
    expect(a.r1).not.toBe(b.r1); // randomized: different seeds → different schedules
  });
  it('round 1 is not signup order', () => {
    const firsts = new Set(Array.from({ length: 6 }, (_, s) => run(8, 4, 2, s + 1).r1)); expect(firsts.size).toBeGreaterThan(4);
    const r = run(8, 4, 2, 5).rounds[0].matches.flatMap(m => [...m.a, ...m.b]).join(); expect(r).not.toBe('p0,p1,p2,p3,p4,p5,p6,p7');
  });
});
