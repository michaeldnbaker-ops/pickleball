import { describe, it, expect } from 'vitest';
import { normName, nameTaken, dupCount, removePlayer } from './lobby';
import type { EventT } from './engine';
const ev = (): EventT => ({ id: 'X', name: 'g', date: '', place: '', courts: 1, format: 'rotating', seeding: 'random', balanceDupr: false, totalRounds: 3, teams: [['a', 'b']], rounds: [],
  players: [{ id: 'a', name: 'Jeff Stempel' }, { id: 'b', name: 'Ian' }, { id: 'c', name: 'jeff  stempel ' }], active: ['a', 'b', 'c'] } as unknown as EventT);
describe('lobby', () => {
  it('normalizes names', () => { expect(normName('  Jeff   STEMPEL ')).toBe('jeff stempel'); });
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
import { capOf, isFull, fitCap } from './lobby';
describe('player cap', () => {
  const g = (n: number, max?: number) => ({ active: Array.from({ length: n }, (_, i) => 'p' + i), maxPlayers: max }) as Pick<EventT, 'active' | 'maxPlayers'>;
  it('only 4/8/12/16 count as a cap; older games have none', () => { expect(capOf(g(0, 8))).toBe(8); expect(capOf(g(0))).toBe(0); expect(capOf(g(0, 7))).toBe(0); });
  it('full at the cap, open below it, never full without a cap', () => { expect(isFull(g(8, 8))).toBe(true); expect(isFull(g(7, 8))).toBe(false); expect(isFull(g(30))).toBe(false); });
  it('a drop out reopens a spot', () => { const e = ev(); (e as EventT).maxPlayers = 4; e.players.push({ id: 'd', name: 'Dee' }); e.active.push('d'); expect(isFull(e)).toBe(true); removePlayer(e, 'd'); expect(isFull(e)).toBe(false); });
  it('default cap 8 grows to fit pre-selected players', () => { expect(fitCap(0)).toBe(8); expect(fitCap(8)).toBe(8); expect(fitCap(9)).toBe(12); expect(fitCap(13)).toBe(16); expect(fitCap(17)).toBe(0); });
});
