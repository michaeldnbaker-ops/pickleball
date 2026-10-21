import { describe, it, expect } from 'vitest';
import { newClub, setClubSlot, clubReady, startEvent, takeNextRound, clubStandings, standings, courtLabel, nextPlayoffRound, type EventT } from './engine';
const mk = (n: number, fillAway = true): EventT => {
  const e = { id: 'C', name: 'c', date: '', place: '', format: 'club', courts: n, courtSet: n === 3 ? [2, 3, 5] : undefined, totalRounds: n, balanceDupr: false, seeding: 'random', players: [], active: [], teams: [], rounds: [], createdAt: 0, club: newClub('Stone Creek', 'Oak Hill', n) } as unknown as EventT;
  for (let i = 0; i < n; i++) for (let k = 0; k < 2; k++) { setClubSlot(e, 'home', i, k, `H${i}${k}`); if (fillAway) setClubSlot(e, 'away', i, k, `V${i}${k}`); }
  return e;
};
const tk = (e: EventT, t: string[]) => t.map(id => e.players.find(p => p.id === id)!.name).join('+');
describe('Club vs Club', () => {
  it('home team i stays on its court; visitor team (i + round - 1) mod N; everyone plays everyone once in N rounds', () => {
    const e = mk(3); expect(clubReady(e.club)).toBe(true); startEvent(e); takeNextRound(e); takeNextRound(e);
    expect(e.rounds).toHaveLength(3); const seen = new Set<string>();
    e.rounds.forEach((r, ri) => { expect(r.byes).toEqual([]); r.matches.forEach((m, i) => { expect(m.court).toBe(i + 1); expect(tk(e, m.a)).toBe(`H${i}0+H${i}1`); const j = (i + ri) % 3; expect(tk(e, m.b)).toBe(`V${j}0+V${j}1`); seen.add(tk(e, m.a) + 'v' + tk(e, m.b)); }); });
    expect(seen.size).toBe(9);
    expect(e.rounds[0].matches.map(m => courtLabel(e, m.court))).toEqual(['B', 'C', 'E']);
    expect(nextPlayoffRound(e)).toBeNull();
  });
  it('rounds beyond N keep rotating', () => { const e = mk(2); e.totalRounds = 3; startEvent(e); takeNextRound(e); takeNextRound(e); expect(tk(e, e.rounds[2].matches[0].b)).toBe(tk(e, e.rounds[0].matches[0].b)); });
  it('empty visitor slots become named-less guests at the start; home must be complete', () => {
    const e = mk(2, false); expect(clubReady(e.club)).toBe(true); startEvent(e);
    const g = e.players.filter(p => p.guest); expect(g).toHaveLength(4); expect(g[0].name).toBe('Oak Hill 1A'); expect(e.active).toHaveLength(8);
    const h = mk(1); h.club!.homeTeams[0][1] = ''; expect(clubReady(h.club)).toBe(false);
  });
  it('slot names re-use a joined player; a name already on another team is refused; clearing empties the slot', () => {
    const e = mk(1, false); e.players.push({ id: 'j', name: 'Joe' }); e.active.push('j');
    expect(setClubSlot(e, 'away', 0, 0, ' joe ')).toBe(true); expect(e.club!.awayTeams[0][0]).toBe('j');
    expect(setClubSlot(e, 'away', 0, 1, 'H00')).toBe(false); expect(setClubSlot(e, 'away', 0, 0, '')).toBe(true); expect(e.club!.awayTeams[0][0]).toBe('');
  });
  it('team W/L/diff and club totals', () => {
    const e = mk(2); startEvent(e); e.rounds[0].matches[0].sa = 11; e.rounds[0].matches[0].sb = 7; e.rounds[0].matches[1].sa = 4; e.rounds[0].matches[1].sb = 11;
    const s = clubStandings(e); expect(s.totals).toEqual({ home: { won: 1, pf: 15 }, away: { won: 1, pf: 18 } });
    expect(s.home[0]).toMatchObject({ label: 'Stone Creek 1', w: 1, l: 0, diff: 4 }); expect(s.away.find(r => r.label === 'Oak Hill 2')).toMatchObject({ w: 1, diff: 7 });
    expect(standings(e).find(p => p.name === 'H00')).toMatchObject({ w: 1, gp: 1 });
  });
});
import { trophyWinners } from './engine';
describe('Trophy match', () => {
  it('awards 1st place when finished; ties on wins+diff are co-winners; non-trophy games award nothing', () => {
    const e = mk(1); startEvent(e); e.rounds[0].matches[0].sa = 11; e.rounds[0].matches[0].sb = 6;
    e.finished = true; expect(trophyWinners(e)).toEqual([]);
    e.trophy = true; expect(trophyWinners(e).map(s => s.name).sort()).toEqual(['H00', 'H01']);
    e.finished = false; expect(trophyWinners(e)).toEqual([]);
  });
});

import { rankBoard as rb } from './engine';
describe('rankBoard', () => {
  it('win% > diff > GP > name; no min games', () => {
    const r = rb([
      { name: 'A', wins: 5, games: 10, diff: 30 }, { name: 'B', wins: 3, games: 4, diff: 2 },
      { name: 'C', wins: 2, games: 2, diff: 20 }, { name: 'D', wins: 6, games: 8, diff: 2 }, { name: 'E', wins: 3, games: 4, diff: 9 },
    ]).map(x => x.name);
    expect(r).toEqual(['C', 'E', 'D', 'B', 'A']);
  });
});
