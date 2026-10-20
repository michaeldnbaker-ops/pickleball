import { describe, it, expect } from 'vitest';
import { courtList, courtLabel, courtsText, startEvent, toCSV, takeNextRound, type EventT } from './engine';
const mk = (n: number, courts: number, courtSet?: number[]): EventT => ({ id: 'X', name: 'g', date: '', place: '', format: 'rotating', courts, ...(courtSet ? { courtSet } : {}), totalRounds: 4, balanceDupr: false, seeding: 'random',
  players: Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i })), active: Array.from({ length: n }, (_, i) => 'p' + i), teams: [], rounds: [], createdAt: 0 } as EventT);
describe('picked courts by letter', () => {
  it('older games (no courtSet) keep A, B, C…', () => { const e = mk(8, 3); expect(courtList(e)).toEqual([1, 2, 3]); expect([1, 2, 3].map(n => courtLabel(e, n))).toEqual(['A', 'B', 'C']); expect(courtsText(e)).toBe('A–C'); expect(courtsText(mk(4, 1))).toBe('A'); });
  it('picked A, B, D label slots 1, 2, 3 as A, B, D', () => { const e = mk(12, 3, [1, 2, 4]); expect([1, 2, 3].map(n => courtLabel(e, n))).toEqual(['A', 'B', 'D']); expect(courtsText(e)).toBe('A, B, D'); });
  it('a contiguous pick from A shows as a range; other contiguous picks list letters', () => { expect(courtsText(mk(8, 2, [1, 2]))).toBe('A–B'); expect(courtsText(mk(8, 2, [3, 4]))).toBe('C, D'); });
  it('invalid courtSet falls back to A, B, C…', () => { expect(courtList(mk(8, 2, [1, 2, 4]))).toEqual([1, 2]); expect(courtList(mk(8, 2, [4, 1]))).toEqual([1, 2]); });
  it('round robin uses only the picked courts; 16 players on A, B, D → 3 courts, 4 sit out', () => {
    const e = mk(16, 3, [1, 2, 4]); startEvent(e);
    const labels = (r: EventT['rounds'][number]) => r.matches.map(m => courtLabel(e, m.court)).sort();
    expect(labels(e.rounds[0])).toEqual(['A', 'B', 'D']); expect(e.rounds[0].byes).toHaveLength(4);
    takeNextRound(e); expect(labels(e.rounds[1])).toEqual(['A', 'B', 'D']);
    expect(toCSV(e)).toContain('"D"'); expect(toCSV(e)).not.toContain('"C"');
  });
  it('8 players on picked B, D → both courts, no sit outs', () => { const e = mk(8, 2, [2, 4]); startEvent(e); expect(e.rounds[0].matches.map(m => courtLabel(e, m.court)).sort()).toEqual(['B', 'D']); expect(e.rounds[0].byes).toHaveLength(0); });
});
import { standings, subAt, slotName } from './engine';
describe('subs', () => {
  const played = () => { const e = mk(8, 2); startEvent(e); e.rounds[0].matches.forEach((m, k) => { m.sa = 11; m.sb = 5 + k; }); takeNextRound(e); e.rounds[1].matches.forEach((m, k) => { m.sa = 11; m.sb = 3 + k; }); return e; };
  it('subAt: latest entry at or before the round; null name = original back', () => {
    const e = mk(8, 2); e.subs = [{ slot: 'p1', from: 2, name: 'Guest' }, { slot: 'p1', from: 4, name: null }, { slot: 'p2', from: 3, name: 'Zed' }];
    expect([1, 2, 3, 4, 5].map(n => subAt(e, 'p1', n))).toEqual([null, 'Guest', 'Guest', null, null]); expect(subAt(e, 'p2', 3)).toBe('Zed'); expect(slotName(e, 'p1', 2)).toBe('Guest (for P1)'); expect(slotName(e, 'p1', 1)).toBe('P1');
  });
  it("credits the sub from that round on; partner/opponents unchanged; pairings unchanged", () => {
    const e = played(); const before = new Map(standings(e).map(s => [s.id, s])); const pairs = JSON.stringify(e.rounds);
    const m = e.rounds[1].matches[0]; const who = m.a[0]; e.subs = [{ slot: who, from: 2, name: 'Guest' }];
    const after = new Map(standings(e).map(s => [s.id, s])); expect(JSON.stringify(e.rounds)).toBe(pairs);
    const g = after.get('sub:' + who + ':guest')!; expect(g).toMatchObject({ gp: 1, w: 1, pf: 11, name: 'Guest (for ' + e.players.find(p => p.id === who)!.name + ')' });
    expect(after.get(who)!.gp).toBe(before.get(who)!.gp - 1); expect(after.get(who)!.w).toBe(before.get(who)!.w - 1);
    for (const p of [m.a[1], ...m.b]) expect(after.get(p)).toEqual(before.get(p));
  });
  it('undo (remove the sub) restores the original standings', () => { const e = played(); const b = JSON.stringify(standings(e)); e.subs = [{ slot: 'p0', from: 1, name: 'X' }]; e.subs = []; expect(JSON.stringify(standings(e))).toBe(b); });
});
