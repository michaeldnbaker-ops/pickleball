import { describe, it, expect } from 'vitest';
import { aliasReason, applyNameMerge, chooseKeptName, clubOf, duplicatePairs, sourceOf, suggestName } from './names';

const names = ['Michael Ledet', 'Mike Ledet', 'Michael Baker', 'Andrew Joyce', 'Andrew Cutliff', 'Jeff Stempel', 'Jeffrey Boyne', 'Owen Stempel', 'Ryan', 'Ryan (FC)', 'Tony', 'Tony (FC)', 'Scott', 'Scotty (CG)', 'Ian Krentel', 'Craig Newman'];

describe('name aliases', () => {
  it('offers the existing spelling for a nickname, and not for a different person', () => {
    expect(suggestName('Michael Ledet', ['Mike Ledet', 'Michael Baker'])).toBe('Mike Ledet');
    expect(suggestName('Mike Ledet', ['Michael Ledet'])).toBe('Michael Ledet');
    expect(suggestName('Michael Ledet', ['Michael Ledet'])).toBeNull();
    expect(suggestName('Jeff Stempel', ['Jeffrey Stempel'])).toBe('Jeffrey Stempel');
    expect(suggestName('Owen Stempel', ['Jeff Stempel'])).toBeNull();
    expect(suggestName('Andrew Joyce', ['Andrew Cutliff'])).toBeNull();
    expect(suggestName('Mike', ['Mike Ledet'])).toBeNull();
    expect(suggestName('Ryan', ['Ryan (FC)'])).toBeNull();
    expect(suggestName('Michael (FC)', ['Mike (FC)'])).toBe('Mike (FC)');
    expect(aliasReason('Craig Newman', 'Craig Neumann')).toBe('typo');
    expect(aliasReason('M Ledet', 'Mike Ledet')).toBe('initial');
  });
  it('lists likely pairs and skips people who only share a first name', () => {
    const pairs = duplicatePairs(names);
    const key = (a: string, b: string) => pairs.find(p => p.a === a && p.b === b)?.why;
    expect(key('Michael Ledet', 'Mike Ledet')).toBe('nickname');
    expect(key('Ryan', 'Ryan (FC)')).toBeUndefined();
    expect(key('Tony', 'Tony (FC)')).toBeUndefined();
    expect(key('Scott', 'Scotty (CG)')).toBeUndefined();
    expect(aliasReason('Mike (FC)', 'Michael (FC)')).toBe('nickname');
    expect(clubOf('Ryan')).toBe('stone creek');
    expect(clubOf('Ryan (FC)')).toBe('francos');
    expect(clubOf('Scotty (CG)')).toBe('crossgates');
    expect(key('Andrew Cutliff', 'Andrew Joyce')).toBeUndefined();
    expect(key('Jeff Stempel', 'Jeffrey Boyne')).toBeUndefined();
    expect(key('Jeff Stempel', 'Owen Stempel')).toBeUndefined();
    expect(key('Ian Krentel', 'Michael Ledet')).toBeUndefined();
    expect(aliasReason('Bill (CG)', 'Will (BC)')).toBeNull();
    expect(aliasReason('Bryan (FC)', 'Ryan')).toBeNull();
    expect(aliasReason('James (FC)', 'Jared')).toBeNull();
  });
  it('keeps the name from Join, and otherwise the name that was not imported', () => {
    expect(chooseKeptName([
      { name: 'Mike Ledet', src: 'host', games: 4 },
      { name: 'Michael Ledet', src: '', games: 5 },
    ]).name).toBe('Michael Ledet');
    expect(chooseKeptName([
      { name: 'Mike Ledet', src: 'host', games: 9 },
      { name: 'Michael Ledet', src: 'self', games: 1 },
    ]).name).toBe('Michael Ledet');
    expect(chooseKeptName([
      { name: 'Mike Ledet', src: 'self', games: 1 },
      { name: 'Michael Ledet', src: 'host', games: 9 },
    ]).name).toBe('Mike Ledet');
    expect(chooseKeptName([
      { name: 'Mike (FC)', src: 'host', games: 2 },
      { name: 'Michael (FC)', src: 'self', games: 1 },
    ]).name).toBe('Michael (FC)');
    expect(chooseKeptName([
      { name: 'Mike (FC)', src: 'host', games: 2 },
      { name: 'Michael (FC)', src: 'host', games: 5 },
    ]).name).toBe('Michael (FC)');
    expect(sourceOf({ addedLater: true }, { id: 'h10' })).toBe('host');
    expect(sourceOf({}, { id: 'bhuotjyv' })).toBe('');
    expect(sourceOf({ addedLater: true }, { id: 'h10', src: 'self' })).toBe('self');
  });
  it('rewrites a game onto one spelling and refuses two people who played together', () => {
    const ev = { players: [{ id: 'a', name: 'Mike Ledet' }, { id: 'b', name: 'Pat' }], active: ['a', 'b'], rounds: [{ matches: [{ a: ['a'], b: ['b'] }], byes: [] }], subs: [{ slot: 'a', name: 'Mike Ledet', from: 1 }] };
    expect(applyNameMerge(ev, ['Mike Ledet', 'Michael Ledet'], 'Michael Ledet').error).toBeUndefined();
    expect(ev.players[0].name).toBe('Michael Ledet');
    expect(ev.subs?.[0].name).toBe('Michael Ledet');
    const both = { players: [{ id: 'm', name: 'Mike Ledet' }, { id: 'n', name: 'Michael Ledet' }], active: ['m', 'n'], rounds: [{ matches: [{ a: ['m', 'x'], b: ['n', 'y'] }] }] };
    expect(applyNameMerge(both, ['Mike Ledet', 'Michael Ledet'], 'Michael Ledet').error).toBe('played together');
    expect(both.players).toHaveLength(2);
    const split = { players: [{ id: 'm', name: 'Mike Ledet' }, { id: 'n', name: 'Michael Ledet' }, { id: 'p', name: 'Pat' }], active: ['m', 'n', 'p'], rounds: [{ matches: [{ a: ['m', 'p'], b: ['x', 'y'] }], byes: ['n'] }], startedBy: 'n' };
    expect(applyNameMerge(split, ['mike ledet', 'Michael Ledet'], 'Michael Ledet').error).toBeUndefined();
    expect(split.players.map(p => p.name)).toEqual(['Michael Ledet', 'Pat']);
    expect(split.active).toEqual(['n', 'p']);
    expect(split.rounds[0].matches[0].a).toEqual(['n', 'p']);
    expect(split.rounds[0].byes).toEqual(['n']);
    expect(split.startedBy).toBe('n');
  });
});
