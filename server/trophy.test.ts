import { describe, it, expect } from 'vitest';
vi.mock('pg', () => ({ Pool: class { on() {} query() { return Promise.resolve({ rows: [] }); } } }));
import { vi } from 'vitest';
import { trophyWinners, trophyAwards, mergeAwards, validPhoto } from './index';
const row = (id: string, an: string[], bn: string[], sa: number, sb: number, excl: string[] = []) => [id, 'C', '', '', false, [], [], an, bn, sa, sb, excl];
const gold = (w: { name: string; place: string }[]) => w.filter(x => x.place === 'gold').map(x => x.name);
const silver = (w: { name: string; place: string }[]) => w.filter(x => x.place === 'silver').map(x => x.name);
describe('trophyWinners', () => {
  it('most wins, then point diff; next place is silver', () => {
    const w = trophyWinners([row('C:r1:1', ['Ann', 'Bob'], ['Cat', 'Dan'], 11, 3), row('C:r2:1', ['Ann', 'Cat'], ['Bob', 'Dan'], 11, 9)]);
    expect(gold(w)).toEqual(['Ann']);
    expect(silver(w)).toEqual(['Bob']);
  });
  it('still tied = co-winners; playoffs and guests ignored; next real place is silver', () => {
    const w = trophyWinners([row('C:r1:1', ['Ann', 'Bob'], ['Guest', 'Dan'], 11, 5, ['guest']), row('C:p1:1', ['Dan', 'Cat'], ['Ann', 'Bob'], 11, 0)]);
    expect(gold(w).sort()).toEqual(['Ann', 'Bob']);
    expect(silver(w)).toEqual(['Dan']);
  });
  it('everyone tied for 1st gets gold and no silver', () => {
    const w = trophyWinners([row('C:r1:1', ['Ann', 'Bob'], ['Cat', 'Dan'], 11, 9), row('C:r2:1', ['Cat', 'Dan'], ['Ann', 'Bob'], 11, 9)]);
    expect(gold(w).sort()).toEqual(['Ann', 'Bob', 'Cat', 'Dan']);
    expect(silver(w)).toEqual([]);
  });
  it('no scored games = no trophy', () => expect(trophyWinners([])).toEqual([]));
  it('an untracked or unfinished game awards nothing, and existing gold is not replaced', () => {
    const rows = [row('C:r1:1', ['Ann', 'Bob'], ['Cat', 'Dan'], 11, 0)];
    expect(trophyAwards({ noStats: true, trophy: true, finished: true }, rows)).toEqual([]);
    expect(trophyAwards({ trophy: true, finished: false }, rows)).toEqual([]);
    const awards = trophyAwards({ trophy: true, finished: true }, rows);
    expect(mergeAwards(['ann', 'bob'], awards).map(a => a.place)).toEqual(['silver', 'silver']);
    expect(mergeAwards(['ann', 'bob'], awards).some(a => a.k === 'ann' || a.k === 'bob')).toBe(false);
    expect(mergeAwards([], awards).filter(a => a.place === 'gold')).toHaveLength(2);
  });
  it('photo validation', () => { expect(validPhoto('data:image/jpeg;base64,AAAA')).toBe(true); expect(validPhoto('data:image/png;base64,AAAA')).toBe(false); expect(validPhoto('data:image/jpeg;base64,' + 'A'.repeat(130000))).toBe(false); });
});
import { clubOf } from './index';
describe('clubOf', () => {
  it('missing = Stone Creek; Club vs Club = home club', () => {
    expect(clubOf({})).toBe('Stone Creek'); expect(clubOf({ clubName: ' Maple ' })).toBe('Maple');
    expect(clubOf({ format: 'club', clubName: 'X', club: { home: 'Oak', away: 'Elm' } })).toBe('Oak');
  });
  it('trophy winner keeps the club of the side they played on', () => {
    const w = trophyWinners([['C:r1:1', 'C', '', '', false, [], [], ['A1', 'A2'], ['B1', 'B2'], 3, 11, [], 'Oak', 'Elm']]);
    expect(w.filter(x => x.place === 'gold').map(x => x.club)).toEqual(['Elm', 'Elm']);
    expect(w.filter(x => x.place === 'silver').map(x => x.name).sort()).toEqual(['A1', 'A2']);
  });
});
