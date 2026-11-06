import { describe, it, expect } from 'vitest';
import { normName, nameTaken, dupCount, removePlayer, canonicalName, bestNames, joinNames } from './lobby';
import type { EventT } from './engine';
const ev = (): EventT => ({ id: 'X', name: 'g', date: '', place: '', courts: 1, format: 'rotating', seeding: 'random', balanceDupr: false, totalRounds: 3, teams: [['a', 'b']], rounds: [],
  players: [{ id: 'a', name: 'Jeff Stempel' }, { id: 'b', name: 'Ian' }, { id: 'c', name: 'jeff  stempel ' }], active: ['a', 'b', 'c'] } as unknown as EventT);
describe('lobby', () => {
  it('normalizes names', () => { expect(normName('  Jeff   STEMPEL ')).toBe('jeff stempel'); });
  it('reuses the canonical spelling and never invents a different player', () => {
    const known = ['Jeff Stempel', 'Ann Lee'];
    expect(canonicalName('  jeff   STEMPEL ', known)).toBe('Jeff Stempel');
    expect(canonicalName('ANN  lee', known)).toBe('Ann Lee');
    expect(canonicalName('  Sam   Lee ', known)).toBe('Sam Lee');
    expect(canonicalName('Jeff', known)).toBe('Jeff');
    expect(canonicalName('Jeff S', known)).toBe('Jeff S');
    expect(canonicalName('   ', known)).toBe('');
  });
  it('keeps the existing stats spelling, including the higher-game one when two variants exist', () => {
    expect(canonicalName('jeff stempel', bestNames([{ name: 'Jeff  Stempel', games: 2 }, { name: 'Jeff Stempel', games: 9 }]))).toBe('Jeff Stempel');
    expect(canonicalName('JEFF stempel', bestNames([{ name: 'Jeff  Stempel', games: 4 }]))).toBe('Jeff  Stempel');
    expect(joinNames(['Jeff Stempel'], ['jeff stempel'], ['JEFF STEMPEL'])).toEqual(['Jeff Stempel']);
    expect(joinNames([], ['Pat Court'], ['Pat Court'])).toEqual(['Pat Court']);
  });
  it('detects taken names case-insensitively and trimmed', () => { const e = ev(); expect(nameTaken(e, ' JEFF stempel')).toBe(true); expect(nameTaken(e, 'Sam')).toBe(false); expect(nameTaken(e, '  ')).toBe(false); });
  it('counts duplicates', () => { const e = ev(); expect(dupCount(e)).toBe(1); removePlayer(e, 'c'); expect(dupCount(e)).toBe(0); });
  it('removes a player from players, active and pairs before start', () => { const e = ev(); expect(removePlayer(e, 'a')).toBe(true); expect(e.players.map(p => p.id)).toEqual(['b', 'c']); expect(e.active).toEqual(['b', 'c']); expect(e.teams).toEqual([]); });
  it('refuses removal after start', () => { const e = ev(); e.rounds = [{ n: 1, matches: [], byes: [] }] as unknown as EventT['rounds']; expect(removePlayer(e, 'a')).toBe(false); expect(e.players).toHaveLength(3); });
});
import { courtName } from './engine';
describe('court letters (display only)', () => {
  it('maps 1..n to A..Z, then AA', () => { expect([1, 2, 3, 4, 26, 27, 28].map(courtName)).toEqual(['A', 'B', 'C', 'D', 'Z', 'AA', 'AB']); });
});
import { endEvent } from './engine';
describe('End early', () => {
  it('keeps played + fully scored play-ahead rounds, drops unplayed, marks finished', () => {
    const m = (sa?: number, sb?: number) => ({ court: 1, a: ['a', 'b'], b: ['c', 'd'], sa, sb });
    const ev = { rounds: [{ n: 1, matches: [m(11, 2)], byes: [] }], plan: [{ n: 2, matches: [m(11, 9)], byes: [] }, { n: 3, matches: [m()], byes: [] }], planKey: 'k', finished: false } as never as import('./engine').EventT;
    endEvent(ev); expect(ev.finished).toBe(true); expect(ev.rounds.map(r => r.n)).toEqual([1, 2]); expect(ev.plan).toBeUndefined();
  });
});
import { standings, pickleCounts } from './engine';
describe('skipped rounds', () => {
  const players = ['a', 'b', 'c', 'd', 'e', 'f'].map(id => ({ id, name: id.toUpperCase() }));
  const match = (court: number, a: string[], b: string[], sa?: number, sb?: number) => ({ court, a, b, ...(sa != null ? { sa, sb } : {}) });
  const game = (): EventT => ({
    id: 'G', name: 'g', date: '', place: '', format: 'rotating', courts: 2, totalRounds: 8, balanceDupr: false, seeding: 'random',
    players, active: players.map(p => p.id), teams: [], createdAt: 0, finished: false, trophy: true,
    rounds: [
      { n: 1, byes: [], matches: [match(1, ['a', 'b'], ['c', 'd'], 11, 7)] },
      { n: 4, byes: [], matches: [match(1, ['b', 'c'], ['a', 'd'], 7, 11)] },
    ],
    plan: [
      { n: 5, byes: [], matches: [match(1, ['a', 'b'], ['c', 'd']), match(2, ['e', 'f'], ['a', 'c'])] },
      { n: 6, byes: [], matches: [match(1, ['a', 'e'], ['b', 'f'])] },
      { n: 7, byes: ['f'], matches: [match(1, ['a', 'b'], ['e', 'c'], 11, 4), match(2, ['d', 'f'], ['a', 'e'])] },
      { n: 8, byes: [], matches: [match(1, ['a', 'c'], ['e', 'd'], 11, 0)] },
    ],
  });
  const row = (ev: EventT, id: string) => standings(ev).find(s => s.id === id)!;
  it('counts a later scored round and a real 11–0 while the game is still open, and ignores blank courts', () => {
    const ev = game();
    expect(row(ev, 'a').w).toBe(4); expect(row(ev, 'e').l).toBe(2); expect(row(ev, 'e').gp).toBe(2);
    expect(row(ev, 'f').gp).toBe(0);
    expect(pickleCounts(ev).map(p => p.id).sort()).toEqual(['d', 'e']);
    expect(ev.plan!.some(r => r.matches.some(m => m.sa === 0 && m.sb === 0))).toBe(false);
  });
  it('keeps rounds 7 and 8 when 5 and 6 were skipped, then survives reopen and an edit', () => {
    const ev = game();
    const before = standings(ev).map(s => [s.id, s.w, s.l, s.diff]);
    endEvent(ev);
    expect(ev.finished).toBe(true); expect(ev.plan).toBeUndefined();
    expect(ev.rounds.map(r => r.n)).toEqual([1, 4, 7, 8]);
    expect(ev.rounds[2].matches).toHaveLength(1); expect(ev.rounds[3].matches[0]).toMatchObject({ sa: 11, sb: 0 });
    expect(standings(ev).map(s => [s.id, s.w, s.l, s.diff])).toEqual(before);
    expect(pickleCounts(ev).map(p => p.id).sort()).toEqual(['d', 'e']);
    ev.finished = false;
    ev.rounds[3].matches[0].sb = 9;
    expect(pickleCounts(ev)).toEqual([]);
    expect(row(ev, 'a').diff).toBe(row(game(), 'a').diff - 9);
    endEvent(ev);
    expect(ev.rounds.map(r => r.n)).toEqual([1, 4, 7, 8]);
  });
});
import { capOf, isFull, fitCap } from './lobby';
describe('player cap', () => {
  const g = (n: number, max?: number) => ({ active: Array.from({ length: n }, (_, i) => 'p' + i), maxPlayers: max }) as Pick<EventT, 'active' | 'maxPlayers'>;
  it('only 4/8/12/16 count as a cap; older games have none', () => { expect(capOf(g(0, 8))).toBe(8); expect(capOf(g(0))).toBe(0); expect(capOf(g(0, 7))).toBe(0); });
  it('full at the cap, open below it, never full without a cap', () => { expect(isFull(g(8, 8))).toBe(true); expect(isFull(g(7, 8))).toBe(false); expect(isFull(g(30))).toBe(false); });
  it('a drop out reopens a spot', () => { const e = ev(); (e as EventT).maxPlayers = 4; e.players.push({ id: 'd', name: 'Dee' }); e.active.push('d'); expect(isFull(e)).toBe(true); removePlayer(e, 'd'); expect(isFull(e)).toBe(false); });
  it('default cap 8 grows to fit pre-selected players', () => { expect(fitCap(0)).toBe(8); expect(fitCap(8)).toBe(8); expect(fitCap(9)).toBe(12); expect(fitCap(13)).toBe(16); expect(fitCap(17)).toBe(0); });
});
