import { describe, it, expect } from 'vitest';
import { trophyPodium, trophyWinners, pickleCounts, roundsAllScored, type EventT, type Player } from './engine';

const P = (id: string, name: string, guest = false): Player => ({ id, name, ...(guest ? { guest: true } : {}) });
const base = (over: Partial<EventT> = {}): EventT => ({
  id: 'E', name: 'n', date: '', place: '', format: 'rotating', courts: 1, totalRounds: 1, balanceDupr: false, seeding: 'random',
  players: [P('a', 'Ann'), P('b', 'Bob'), P('c', 'Cat'), P('d', 'Dan')], active: ['a', 'b', 'c', 'd'], teams: [],
  rounds: [{ n: 1, byes: [], matches: [{ court: 1, a: ['a', 'b'], b: ['c', 'd'], sa: 11, sb: 0 }] }],
  createdAt: 0, finished: true, trophy: true, ...over,
});

describe('silver trophies and pickles', () => {
  it('gold is most wins then point diff; silver is the next place; a full tie awards no silver', () => {
    const e = base();
    expect(trophyWinners(e).map(s => s.name).sort()).toEqual(['Ann', 'Bob']);
    expect(trophyPodium(e).silver.map(s => s.name).sort()).toEqual(['Cat', 'Dan']);
    e.rounds.push({ n: 2, byes: [], matches: [{ court: 1, a: ['c', 'd'], b: ['a', 'b'], sa: 11, sb: 0 }] });
    expect(trophyPodium(e).gold.map(s => s.name).sort()).toEqual(['Ann', 'Bob', 'Cat', 'Dan']);
    expect(trophyPodium(e).silver).toEqual([]);
  });
  it('guests, playoffs, unfinished games, and untracked games award no trophy', () => {
    const e = base(); e.players[2].guest = true; e.players[3].guest = true;
    expect(trophyPodium(e).silver).toEqual([]);
    const p = base(); p.rounds = [{ n: 1, playoff: true, byes: [], matches: [{ court: 1, a: ['a', 'b'], b: ['c', 'd'], sa: 11, sb: 0 }] }];
    expect(trophyWinners(p)).toEqual([]);
    expect(trophyWinners(base({ finished: false }))).toEqual([]);
    expect(trophyWinners(base({ noStats: true }))).toEqual([]);
    expect(trophyWinners(base({ trophy: false })).map(s => s.name).sort()).toEqual(['Ann', 'Bob']);
  });
  it('a pickle is any X–0 loss, in any format, for each player on the scoreless team', () => {
    const e = base({ trophy: false });
    expect(pickleCounts(e).map(p => p.name).sort()).toEqual(['Cat', 'Dan']);
    e.rounds[0].matches[0].sb = 15; e.rounds[0].matches[0].sa = 0;
    expect(pickleCounts(e).map(p => p.name).sort()).toEqual(['Ann', 'Bob']);
    e.rounds[0].matches[0].sa = 11; e.rounds[0].matches[0].sb = 1;
    expect(pickleCounts(e)).toEqual([]);
    e.rounds[0].matches[0].sb = 0; e.noStats = true;
    expect(pickleCounts(e)).toEqual([]);
    const g = base(); g.players[2].guest = true;
    expect(pickleCounts(g).map(p => p.name)).toEqual(['Dan']);
  });
  it('all rounds are scored only after the schedule (and a playoff final) is in', () => {
    const e = base({ finished: false, totalRounds: 2 });
    expect(roundsAllScored(e)).toBe(false);
    e.rounds.push({ n: 2, byes: [], matches: [{ court: 1, a: ['a', 'b'], b: ['c', 'd'], sa: 11, sb: 5 }] });
    expect(roundsAllScored(e)).toBe(true);
    e.rounds.push({ n: 3, playoff: true, byes: [], matches: [{ court: 1, a: ['a', 'b'], b: ['c', 'd'], sa: 11, sb: 7 }, { court: 2, a: ['a', 'c'], b: ['b', 'd'], sa: 11, sb: 3 }] });
    expect(roundsAllScored(e)).toBe(false);
    e.rounds.push({ n: 4, playoff: true, byes: [], matches: [{ court: 1, a: ['a', 'b'], b: ['c', 'd'] }] });
    expect(roundsAllScored(e)).toBe(false);
    e.rounds[3].matches[0].sa = 11; e.rounds[3].matches[0].sb = 8;
    expect(roundsAllScored(e)).toBe(true);
  });
});
