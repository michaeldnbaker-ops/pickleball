import { describe, it, expect } from 'vitest';
import { EventT, Format, nextRound, mulberry, history, standings, nextPlayoffRound, Player, startOk } from './engine';

function mk(n: number, format: Format, courts = 99, extra: Partial<EventT> = {}): EventT {
  const players: Player[] = Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i, dupr: 3 + (i % 10) / 10 }));
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

describe('DUPR optional', () => {
  it('balance by DUPR works with missing, partial and legacy-gender data', () => {
    const ev = mk(10, 'rotating'); ev.balanceDupr = true;
    ev.players.forEach((p, i) => { if (i % 3) delete p.dupr; (p as unknown as Record<string, string>).gender = 'M'; });
    const done = play(ev, 4); expect(done.rounds.length).toBe(4);
    done.rounds.forEach(r => r.matches.forEach(m => expect(m.a.length + m.b.length).toBe(4)));
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

import { unscoredCourts as uc, unscoredCourts } from './engine';
import type { Match, Round } from './engine';
describe('unscoredCourts (advance warning)', () => {
  const R = (ms: Partial<Match>[]) => ({ n: 1, byes: [], matches: ms.map((m, i) => ({ court: i + 1, a: [], b: [], ...m })) }) as unknown as Round;
  it('lists courts without scores', () => { expect(uc(R([{ sa: 11, sb: 5 }, {}, { sa: 3 }]))).toEqual([2, 3]); });
  it('treats ties as unscored', () => { expect(uc(R([{ sa: 7, sb: 7 }]))).toEqual([1]); });
  it('empty when all scored', () => { expect(uc(R([{ sa: 11, sb: 9 }, { sa: 2, sb: 11 }]))).toEqual([]); });
  it('handles missing round', () => { expect(uc(undefined)).toEqual([]); });
});

import { ensurePlan, takeNextRound } from './engine';
describe('pre-drawn plan', () => {
  const mk = (format: Format): EventT => { const players = Array.from({ length: 10 }, (_, i) => ({ id: 'p' + i, name: 'P' + i })); return { id: 'X', name: 'x', date: '', place: '', format, courts: 2, totalRounds: 5, balanceDupr: false, seeding: 'random', players, active: players.map(p => p.id), teams: [], rounds: [], createdAt: 0 }; };
  it('previewed rounds are exactly the rounds that get played', () => {
    const ev = mk('rotating'); const rng = mulberry(3); takeNextRound(ev, rng);
    expect(ev.plan!.length).toBe(4);
    const preview = JSON.stringify(ev.plan!.map(r => r.matches.map(m => [m.a, m.b])));
    ev.rounds[0].matches.forEach(m => { m.sa = 11; m.sb = 4; });
    while (ev.rounds.length < 5) takeNextRound(ev, rng);
    expect(JSON.stringify(ev.rounds.slice(1).map(r => r.matches.map(m => [m.a, m.b])))).toBe(preview);
    expect(ev.plan).toEqual([]);
  });
  it('redraws plan when roster changes', () => {
    const ev = mk('rotating'); takeNextRound(ev, mulberry(1)); ev.active = ev.active.filter(p => p !== 'p0');
    expect(ensurePlan(ev, mulberry(2))).toBe(true); expect(ev.plan!.flatMap(r => r.matches.flatMap(m => [...m.a, ...m.b]))).not.toContain('p0');
  });
  it('no plan for result-dependent formats', () => { const ev = mk('kotc'); takeNextRound(ev, mulberry(1)); expect(ev.plan).toBeUndefined(); });
});

import { dropPlayer, dropImpact, readdPlayer, isLocked } from './engine';
describe('drop player & play-ahead lock', () => {
  const mk = (n: number, format: Format = 'rotating', courts = 2, totalRounds = 8): EventT => { const players = Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i })); return { id: 'X', name: 'x', date: '', place: '', format, courts, totalRounds, balanceDupr: false, seeding: 'random', players, active: players.map(p => p.id), teams: [], rounds: [], createdAt: 0 }; };
  const ids = (r: Round) => [...r.matches.flatMap(m => [...m.a, ...m.b]), ...r.byes];
  const fairByes = (ev: EventT, from: number) => { // sitter's prior bye count never exceeds min of active players
    const all = [...ev.rounds, ...(ev.plan || [])]; const cnt = new Map<string, number>();
    all.forEach((r, i) => { if (i >= from) { const mx = Math.max(-1, ...r.byes.filter(b => ev.active.includes(b)).map(b => cnt.get(b) || 0)); for (const p of ev.active) if ((cnt.get(p) || 0) < mx) expect(r.byes).toContain(p); } r.byes.forEach(b => cnt.set(b, (cnt.get(b) || 0) + 1)); });
  };
  it('drop at 9 → 8: future rounds have no sit-outs and exclude the player; results kept', () => {
    const ev = mk(9); const rng = mulberry(5); takeNextRound(ev, rng);
    ev.rounds[0].matches.forEach(m => { m.sa = 11; m.sb = 6; });
    const victim = ev.rounds[0].matches[0].a[0];
    dropPlayer(ev, victim, { when: 'next' }, rng);
    expect(ev.plan!.length).toBe(7); ev.plan!.forEach(r => { expect(ids(r)).not.toContain(victim); expect(r.byes).toEqual([]); expect(r.matches.length).toBe(2); });
    expect(standings(ev).find(s => s.id === victim)!.w).toBe(1);
  });
  it('drop at 8 now with no sit-outs voids the short match; 7 left rotate byes fairly', () => {
    const ev = mk(8); const rng = mulberry(7); takeNextRound(ev, rng);
    const m = ev.rounds[0].matches[1]; const victim = m.b[1];
    expect(dropImpact(ev, victim)).toEqual({ match: m, subs: [] });
    dropPlayer(ev, victim, { when: 'now', fix: 'void' }, rng);
    expect(ev.rounds[0].matches.length).toBe(1); expect(ev.rounds[0].byes.sort()).toEqual([...m.a, m.b[0]].sort());
    ev.plan!.forEach(r => { expect(r.matches.length).toBe(1); expect(r.byes.length).toBe(3); expect(ids(r)).not.toContain(victim); });
    fairByes(ev, 1);
  });
  it('drop at 5 now: replace with the sit-out; 4 left play every round', () => {
    const ev = mk(5, 'rotating', 1); const rng = mulberry(9); takeNextRound(ev, rng);
    const sub = ev.rounds[0].byes[0]; const victim = ev.rounds[0].matches[0].a[0];
    expect(dropImpact(ev, victim).subs).toEqual([sub]);
    dropPlayer(ev, victim, { when: 'now', fix: 'replace', sub }, rng);
    expect(ev.rounds[0].matches[0].a).toContain(sub); expect(ev.rounds[0].byes).toEqual([]);
    ev.plan!.forEach(r => { expect(r.byes).toEqual([]); expect(ids(r).sort()).toEqual(ev.active.slice().sort()); });
  });
  it('9 players: odd count byes spread evenly over the event', () => {
    const ev = mk(10, 'rotating', 2, 9); const rng = mulberry(11); takeNextRound(ev, rng);
    dropPlayer(ev, 'p3', { when: 'now', fix: 'void' }, rng); fairByes(ev, 1);
  });
  it('played-ahead rounds are locked: drop redraws only unscored future rounds', () => {
    const ev = mk(10); const rng = mulberry(13); takeNextRound(ev, rng);
    const ahead = ev.plan![2]; ahead.matches[0].sa = 11; ahead.matches[0].sb = 7; expect(isLocked(ahead)).toBe(true);
    const locked = JSON.stringify(ahead.matches.map(m => [m.a, m.b]));
    const victim = ev.active.find(p => !ids(ahead).slice(0, 4).includes(p) && ev.rounds[0].byes.includes(p)) || ev.rounds[0].byes[0];
    dropPlayer(ev, victim, { when: 'next' }, rng);
    expect(JSON.stringify(ev.plan![2].matches.map(m => [m.a, m.b]))).toBe(locked); expect(ev.plan![2].matches[0].sa).toBe(11);
    [0, 1, 3, 4].forEach(k => expect(ids(ev.plan![k])).not.toContain(victim));
    while (ev.rounds.length < 4) takeNextRound(ev, rng);
    expect(JSON.stringify(ev.rounds[3].matches.map(m => [m.a, m.b]))).toBe(locked); expect(ev.rounds[3].matches[0].sa).toBe(11);
  });
  it('King of the Court / Ladder: drop now replaces, next rounds exclude; re-add returns', () => {
    for (const f of ['kotc', 'ladder'] as Format[]) {
      const ev = mk(9, f); const rng = mulberry(17); takeNextRound(ev, rng); expect(ev.plan).toBeUndefined();
      const victim = ev.rounds[0].matches[0].b[0]; const sub = ev.rounds[0].byes[0];
      dropPlayer(ev, victim, { when: 'now', fix: 'replace', sub }, rng);
      ev.rounds[0].matches.forEach(m => { m.sa = 11; m.sb = 2; });
      const r2 = takeNextRound(ev, rng); expect(ids(r2)).not.toContain(victim); expect(r2.byes).toEqual([]);
      readdPlayer(ev, victim, rng); r2.matches.forEach(m => { m.sa = 11; m.sb = 5; });
      expect(ids(takeNextRound(ev, rng))).toContain(victim);
    }
  });
});

import { startEvent, addRounds, endEvent } from './engine';
describe('lobby start, any player count, extend/end', () => {
  const mk = (n: number, format: Format = 'rotating', courts = 3, totalRounds = 6): EventT => { const players = Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i })); return { id: 'X', name: 'x', date: '', place: '', format, courts, totalRounds, balanceDupr: false, seeding: 'random', players, active: players.map(p => p.id), teams: [], rounds: [], createdAt: 0 }; };
  it('lobby has no rounds or plan until started', () => { const ev = mk(10); expect(ensurePlan(ev)).toBe(false); expect(ev.plan).toBeUndefined(); });
  it.each([1, 3, 4, 5, 7, 10, 13, 17])('%i players: starts, fills courts 4 at a time, byes rotate evenly', n => {
    const ev = mk(n); startEvent(ev, mulberry(n));
    const all = [ev.rounds[0], ...ev.plan!]; expect(all.length).toBe(6);
    const playing = Math.min(3, Math.floor(n / 4)) * 4;
    const cnt = new Map<string, number>();
    for (const r of all) { expect(r.matches.length).toBe(playing / 4); expect(r.byes.length).toBe(n - playing); r.byes.forEach(b => cnt.set(b, (cnt.get(b) || 0) + 1)); }
    if (playing > 0 && n - playing > 0) { const v = ev.active.map(p => cnt.get(p) || 0); expect(Math.max(...v) - Math.min(...v)).toBeLessThanOrEqual(1); }
  });
  it('set partners with an odd count forms pairs and rotates the leftover', () => { const ev = mk(9, 'fixed', 2); startEvent(ev, mulberry(2)); expect(ev.teams.length).toBe(4); expect(ev.rounds[0].matches.length).toBe(2); expect(ev.rounds[0].byes.length).toBe(1); });
  it('late joiner after start is slotted into upcoming rounds', () => {
    const ev = mk(8, 'rotating', 2); startEvent(ev, mulberry(4)); ev.players.push({ id: 'late', name: 'Late' }); ev.active.push('late'); ensurePlan(ev, mulberry(5));
    expect(ev.plan!.some(r => r.matches.some(m => [...m.a, ...m.b].includes('late')))).toBe(true);
  });
  it('add rounds at the last round, end early', () => {
    const ev = mk(8, 'rotating', 2, 1); startEvent(ev, mulberry(6)); expect(ev.plan).toEqual([]);
    addRounds(ev, 3, mulberry(7)); expect(ev.totalRounds).toBe(4); expect(ev.plan!.length).toBe(3);
    endEvent(ev); expect(ev.finished).toBe(true); expect(ev.plan).toBeUndefined();
  });
});

import { unitSize } from './engine';
describe('Mixed Doubles = organizer-set pairs, no gender', () => {
  const mkL = (n: number): EventT => { const players = Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i })); return { id: 'X', name: 'x', date: '', place: '', format: 'mixed', courts: 3, totalRounds: 5, balanceDupr: false, seeding: 'random', players, active: players.map(p => p.id), teams: [], rounds: [], createdAt: 0 }; };
  it('keeps the organizer pairs, auto-pairs the rest, pairs never split, opponents rotate', () => {
    const ev = mkL(9); ev.teams = [['p0', 'p5'], ['p1', 'p6']]; expect(unitSize('mixed')).toBe(2);
    startEvent(ev, mulberry(3));
    expect(ev.teams.slice(0, 2)).toEqual([['p0', 'p5'], ['p1', 'p6']]); expect(ev.teams.length).toBe(4);
    const all = [ev.rounds[0], ...ev.plan!]; const opp = new Set<string>();
    for (const r of all) for (const m of r.matches) { for (const t of [m.a, m.b]) expect(ev.teams.some(T => T.join() === t.join())).toBe(true); opp.add([m.a.join(), m.b.join()].sort().join('|')); }
    expect(opp.size).toBeGreaterThan(2);
  });
  it('drops a preset pair that has a withdrawn player', () => { const ev = mkL(8); ev.teams = [['p0', 'p1']]; ev.active = ev.active.filter(p => p !== 'p1'); startEvent(ev, mulberry(1)); expect(ev.teams.some(t => t.includes('p1'))).toBe(false); });
});

describe('scores are taken exactly as typed (no target / win-by-2)', () => {
  it('15–13, 12–10, 7–5, 21–19 count; ties are unscored', () => {
    const players = ['a', 'b', 'c', 'd'].map(id => ({ id, name: id }));
    const ev: EventT = { id: 'X', name: 'x', date: '', place: '', format: 'rotating', courts: 1, totalRounds: 5, balanceDupr: false, seeding: 'random', players, active: ['a', 'b', 'c', 'd'], teams: [], rounds: [], createdAt: 0 };
    const sc: [number, number][] = [[15, 13], [12, 10], [7, 5], [21, 19], [9, 9]];
    sc.forEach(([x, y], i) => ev.rounds.push({ n: i + 1, byes: [], matches: [{ court: 1, a: ['a', 'b'], b: ['c', 'd'], sa: x, sb: y }] }));
    const A = standings(ev).find(s => s.id === 'a')!;
    expect([A.w, A.l, A.gp, A.pf, A.pa, A.diff]).toEqual([4, 0, 4, 55, 47, 8]);
    expect(unscoredCourts(ev.rounds[4])).toEqual([1]);
  });
});

describe('start rule', () => { it('needs a multiple of 4 players', () => { for (const n of [4, 8, 12, 16, 20]) expect(startOk(n)).toBe(true); for (const n of [0, 1, 2, 3, 5, 6, 7, 9, 10, 11, 13]) expect(startOk(n)).toBe(false); }); });
