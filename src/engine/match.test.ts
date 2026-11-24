import { describe, it, expect } from 'vitest';
import { matchName, type Cand } from './names';

const club: Cand[] = [
  { name: 'Michael Baker', games: 130 }, { name: 'Michael Ledet', aliases: ['mike ledet'], games: 9 },
  { name: 'Boston DRew', aliases: ['andrew cutliff'], games: 31 }, { name: 'Craig Newman', aliases: ['craig e.', 'totsy'], games: 36 },
  { name: 'Jeff Stempel', games: 156 }, { name: 'Owen Stempel', games: 20 }, { name: 'Jeffrey Boyne', games: 61 },
  { name: 'Andrew Joyce', games: 108 }, { name: 'Ryan (FC)', games: 3 },
];
const sug = (t: string, c = club) => matchName(t, c).suggestions.map(s => s.name);

describe('sign-up matching', () => {
  it('a name or a nickname on file is that player, with no question', () => {
    expect(matchName('  michael   BAKER ', club).exact).toBe('Michael Baker');
    expect(matchName('Totsy', club).exact).toBe('Craig Newman'); // nickname on file, nothing like the name
    expect(matchName('Totsy', club.map(c => ({ ...c, aliases: [] }))).suggestions).toEqual([]); // never guessed without it
    expect(matchName('andrew cutliff', club).exact).toBe('Boston DRew');
    expect(matchName('Mike Ledet', club).exact).toBe('Michael Ledet');
    expect(matchName('Craig E', club).exact).toBe('Craig Newman');
  });
  it('a last name alone asks about that player', () => {
    expect(matchName('Baker', club)).toEqual({ suggestions: [{ name: 'Michael Baker', why: 'last name' }] });
    expect(sug('Newman')).toEqual(['Craig Newman']);
    expect(sug('Stempel')).toEqual(['Jeff Stempel', 'Owen Stempel']);
    expect(sug('Bakr')).toEqual([]); // too short to call a typo
    expect(sug('Stempl')).toEqual(['Jeff Stempel', 'Owen Stempel']);
  });
  it('nicknames, typos, and first names ask before a new player is made', () => {
    expect(sug('Mike Baker')).toEqual(['Michael Baker']);
    expect(sug('Micheal Baker')).toEqual(['Michael Baker']);
    expect(sug('Jeff')).toContain('Jeff Stempel');
    expect(sug('Craig Totsy')).toEqual(['Craig Newman']); // first name, plus a nickname on file
    expect(sug('Drew Smith', [{ name: 'Boston DRew' }])).toEqual(['Boston DRew']);
    expect(sug('Craig Neuman')).toEqual(['Craig Newman']);
  });
  it('a different person is not suggested', () => {
    expect(sug('Owen Baker').includes('Michael Baker')).toBe(false);
    expect(sug('Sarah Jones')).toEqual([]);
    expect(sug('Ryan')).toEqual([]); // Franco's player is another club
    expect(sug('Bo')).toEqual([]);
    expect(matchName('Andrew Joyce', club).exact).toBe('Andrew Joyce');
  });
  it('best match first, at most four', () => {
    const many: Cand[] = ['Sam A', 'Sam B', 'Sam C', 'Sam D', 'Sam E'].map(n => ({ name: n.replace(/ (\w)$/, ' $1ox') }));
    expect(sug('Sam', many)).toHaveLength(4);
    expect(matchName('Mike Baker', [{ name: 'Michael Baker' }, { name: 'Mike Bakers' }]).suggestions[0].name).toBe('Michael Baker');
  });
});
import { shown, standings } from './engine';
describe('nicknames on the board', () => {
  it('shows the nickname for the game, keeps the name for stats', () => {
    expect(shown({ name: 'Craig Newman', nick: ' Totsy ' })).toBe('Totsy');
    expect(shown({ name: 'Craig Newman', nick: '' })).toBe('Craig Newman');
    const ev = { players: [{ id: 'a', name: 'Craig Newman', nick: 'Totsy' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }, { id: 'd', name: 'D' }], active: ['a', 'b', 'c', 'd'], rounds: [{ n: 1, byes: [], matches: [{ court: 1, a: ['a', 'b'], b: ['c', 'd'], sa: 11, sb: 3 }] }], teams: [], format: 'rotating' } as never;
    expect(standings(ev).find(s => s.id === 'a')!.name).toBe('Totsy');
  });
});
