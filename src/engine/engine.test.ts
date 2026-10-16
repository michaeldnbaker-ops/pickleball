import { describe, it, expect } from 'vitest';
import { EventT, Format, nextRound, mulberry, history, standings, nextPlayoffRound, Player } from './engine';

function mk(n: number, format: Format, courts = 99, extra: Partial<EventT> = {}): EventT {
  const players: Player[] = Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i, dupr: 3 + (i % 10) / 10, gender: i % 2 ? 'F' : 'M' }));
  let teams: string[][] = [];
  if (format === 'fixed') for (let i = 0; i + 1 < n; i += 2) teams.push(['p' + i, 'p' + (i + 1)]);
  if (format === 'team') for (let i = 0; i + 3 < n; i += 4) teams.push(['p' + i, 'p' + (i + 1), 'p' + (i + 2), 'p' + (i + 3)]);
  return { id: 'e', name: 'e', date: '', place: '', format, courts, totalRounds: 8, balanceDupr: false, seeding: 'random', players, active: players.map(p => p.id), teams, rounds: [], createdAt: 0, ...extra };
}
function play(ev: EventT, k: number, seed = 1) {
  const rng = mulberry(seed);
  for (let i = 0; i < k; i++) { const r = nextRound(ev, rng); r.matches.forEach(m => { m.sa = 11; m.sb = Math.floor(rng() * 10); }); ev.rounds.push(r); }
  return ev;
}
function validRound(ev: EventT, r: EventT['rounds'][0]) {
  const seen = new Set<string>();
  for (const m of r.matches) { expect(m.a.length).toBe(2); expect(m.b.length).toBe(2); for (const p of [...m.a, ...m.b]) { expect(seen.has(p)).toBe(false); seen.add(p); } }
  for (const b of r.byes) { expect(seen.has(b)).toBe(false); seen.add(b); }
  expect(seen.size).toBe(ev.active.length);
  expect(r.matches.length).toBeLessThanOrEqual(ev.courts);
  expect(new Set(r.matches.map(m => m.court)).size).toBe(r.matches.length);
}

describe('rotating round robin', () => {
  for (const n of [4, 5, 6, 7, 8, 9, 10, 12, 13, 16, 17, 24, 30]) {
    it(`valid rounds & fair byes for ${n} players`, () => {
      const ev = play(mk(n, 'rotating'), 8);
      ev.rounds.forEach(r => validRound(ev, r));
      const b = history(ev.rounds).byes; const counts = ev.active.map(p => b.get(p) || 0);
      expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    });
  }
  it('8 players: no repeat partners in 7 rounds', () => {
    const ev = play(mk(8, 'rotating'), 7, 3);
    const h = history(ev.rounds); expect(Math.max(...h.partner.values())).toBe(1);
  });
  it('12 players: no repeat partners in 6 rounds', () => {
    const ev = play(mk(12, 'rotating'), 6, 5); expect(Math.max(...history(ev.rounds).partner.values())).toBe(1);
  });
  it('respects court limit with byes', () => {
    const ev = play(mk(16, 'rotating', 3), 4); ev.rounds.forEach(r => { expect(r.matches.length).toBe(3); expect(r.byes.length).toBe(4); validRound(ev, r); });
  });
});

describe('mixed doubles', () => {
  it('each team is one M and one F', () => {
    const ev = play(mk(8, 'mixed'), 5);
    const g = new Map(ev.players.map(p => [p.id, p.gender]));
    ev.rounds.forEach(r => r.matches.forEach(m => [m.a, m.b].forEach(t => expect(g.get(t[0])).not.toBe(g.get(t[1])))));
  });
});

describe('fixed partners & team', () => {
  it('fixed partners stay together', () => {
    const ev = play(mk(10, 'fixed'), 5);
    ev.rounds.forEach(r => r.matches.forEach(m => [m.a, m.b].forEach(t => expect(ev.teams.some(T => T[0] === t[0] && T[1] === t[1])).toBe(true))));
    const b = history(ev.rounds).byes; const c = ev.active.map(p => b.get(p) || 0); expect(Math.max(...c) - Math.min(...c)).toBeLessThanOrEqual(1);
  });
  it('team format plays 2 courts per tie', () => {
    const ev = play(mk(16, 'team'), 3); ev.rounds.forEach(r => { expect(r.matches.length).toBe(4); validRound(ev, r); });
  });
});

describe('king of the court', () => {
  it('court-1 winners stay, court-2 winners move up', () => {
    const ev = mk(8, 'kotc'); const rng = mulberry(2);
    const r1 = nextRound(ev, rng); r1.matches.forEach(m => { m.sa = 11; m.sb = 5; }); ev.rounds.push(r1);
    const r2 = nextRound(ev, rng); validRound(ev, r2);
    const c1 = [...r2.matches[0].a, ...r2.matches[0].b].sort();
    expect(c1).toEqual([...r1.matches[0].a, ...r1.matches[1].a].sort());
    // winners split up
    expect(r2.matches[0].a.some(p => r1.matches[0].a.includes(p)) && r2.matches[0].a.some(p => r1.matches[1].a.includes(p))).toBe(true);
  });
  it('valid with byes', () => { const ev = play(mk(10, 'kotc'), 6); ev.rounds.forEach(r => validRound(ev, r)); });
});

describe('ladder', () => {
  it('top standings on court 1', () => {
    const ev = play(mk(12, 'ladder'), 3); const top = standings(ev).slice(0, 4).map(s => s.id).sort();
    const r = nextRound(ev, mulberry(9)); expect([...r.matches[0].a, ...r.matches[0].b].sort()).toEqual(top);
  });
});

describe('mid-event changes & playoffs', () => {
  it('late player joins, removed player excluded, data kept', () => {
    const ev = play(mk(8, 'rotating'), 2);
    ev.players.push({ id: 'late', name: 'Late' }); ev.active.push('late'); ev.active = ev.active.filter(p => p !== 'p0');
    const r = nextRound(ev, mulberry(4)); validRound(ev, r);
    expect([...r.matches.flatMap(m => [...m.a, ...m.b]), ...r.byes]).not.toContain('p0');
    expect(standings(ev).find(s => s.id === 'p0')!.gp).toBe(2);
  });
  it('playoff bracket to a champion', () => {
    const ev = play(mk(8, 'rotating'), 4);
    const semi = nextPlayoffRound(ev)!; expect(semi.matches.length).toBe(2); semi.matches.forEach(m => { m.sa = 11; m.sb = 3; }); ev.rounds.push(semi);
    const fin = nextPlayoffRound(ev)!; expect(fin.matches.length).toBe(1); fin.matches[0].sa = 11; fin.matches[0].sb = 9; ev.rounds.push(fin);
    expect(nextPlayoffRound(ev)).toBeNull();
  });
});
