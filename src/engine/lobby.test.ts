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
