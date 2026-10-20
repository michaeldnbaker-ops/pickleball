import { describe, it, expect } from 'vitest';
vi.mock('pg', () => ({ Pool: class { on() {} query() { return Promise.resolve({ rows: [] }); } } }));
import { vi } from 'vitest';
import { trophyWinners, validPhoto } from './index';
const row = (id: string, an: string[], bn: string[], sa: number, sb: number, excl: string[] = []) => [id, 'C', '', '', false, [], [], an, bn, sa, sb, excl];
describe('trophyWinners', () => {
  it('most wins, then point diff', () => {
    const w = trophyWinners([row('C:r1:1', ['Ann', 'Bob'], ['Cat', 'Dan'], 11, 3), row('C:r2:1', ['Ann', 'Cat'], ['Bob', 'Dan'], 11, 9)]);
    expect(w.map(x => x.name)).toEqual(['Ann']);
  });
  it('still tied = co-winners; playoffs and guests ignored', () => {
    const w = trophyWinners([row('C:r1:1', ['Ann', 'Bob'], ['Guest', 'Dan'], 11, 5, ['guest']), row('C:p1:1', ['Dan', 'Cat'], ['Ann', 'Bob'], 11, 0)]);
    expect(w.map(x => x.name).sort()).toEqual(['Ann', 'Bob']);
  });
  it('no scored games = no trophy', () => expect(trophyWinners([])).toEqual([]));
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
    expect(w.map(x => x.club)).toEqual(['Elm', 'Elm']);
  });
});
