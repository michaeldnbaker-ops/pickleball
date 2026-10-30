import { describe, it, expect } from 'vitest';
import { rosterWrite, type REv } from './roster';

const p = (id: string, name = id) => ({ id, name });
const round = (ids: string[], score = false) => ({ n: 1, byes: [] as string[], matches: [{ court: 1, a: ids.slice(0, 2), b: ids.slice(2, 4), ...(score ? { sa: 11, sb: 7 } : {}) }] });
const ev = (extra: Partial<REv> = {}): REv => ({
  format: 'rotating',
  players: ['a', 'b', 'c', 'd'].map(id => p(id, id.toUpperCase())),
  active: ['a', 'b', 'c', 'd'],
  rounds: [round(['a', 'b', 'c', 'd'], true)],
  plan: [{ n: 2, byes: [], matches: [{ court: 1, a: ['a', 'c'], b: ['b', 'd'] }] }],
  ...extra,
});

describe('roster after the start', () => {
  it('allows a score edit that does not touch the roster', () => {
    const cur = ev(); const next = ev(); next.rounds![0].matches![0].sb = 4;
    expect(rosterWrite(cur, next, false)).toEqual({});
  });
  it('refuses a matchup rewrite that only pretends to be a score edit', () => {
    const cur = ev(); const next = ev();
    next.rounds = [round(['a', 'c', 'b', 'd'], true)];
    expect(rosterWrite(cur, next, true).error).toBe('round locked');
  });
  it('lets the next round be appended and refuses dropping a round already on court', () => {
    const cur = ev(); const next = ev();
    const added = { n: 2, byes: [], matches: [{ court: 1, a: ['a', 'c'], b: ['b', 'd'] }] };
    next.rounds = [...cur.rounds!, added]; next.plan = [];
    expect(rosterWrite(cur, next, false)).toEqual({});
    const short = ev();
    cur.rounds = [...cur.rounds!, { ...added, sa: undefined }];
    expect(rosterWrite(cur, short, true).error).toBe('round locked');
  });
  it('keeps a scored play-ahead round when the next round starts', () => {
    const cur = ev();
    cur.plan = [
      { n: 2, byes: [], matches: [{ court: 1, a: ['a', 'c'], b: ['b', 'd'] }] },
      { n: 3, byes: [], matches: [{ court: 1, a: ['a', 'b'], b: ['c', 'd'], sa: 11, sb: 5 }] },
    ];
    const next = ev();
    next.rounds = [...cur.rounds!, cur.plan[0]];
    next.plan = [cur.plan[1]];
    expect(rosterWrite(cur, next, false)).toEqual({});
    const rewritten = ev();
    rewritten.plan = [
      cur.plan[0],
      { n: 3, byes: [], matches: [{ court: 1, a: ['a', 'd'], b: ['b', 'c'], sa: 11, sb: 5 }] },
    ];
    expect(rosterWrite(cur, rewritten, true).error).toBe('round locked');
    const ended = ev(); delete ended.plan;
    expect(rosterWrite(cur, ended, true)).toEqual({});
  });
  it('lets anyone add one player when the current round stays', () => {
    const cur = ev(); const next = ev();
    next.players = [...cur.players!, p('late1', 'Late Pat')]; next.active = [...cur.active as string[], 'late1'];
    next.plan = [{ n: 2, byes: ['a'], matches: [{ court: 1, a: ['b', 'late1'], b: ['c', 'd'] }] }];
    expect(rosterWrite(cur, next, false)).toEqual({});
    expect(JSON.stringify(next.rounds)).toBe(JSON.stringify(cur.rounds));
  });
  it('refuses a join that rewrites the round in progress', () => {
    const cur = ev(); const next = ev();
    next.players = [...cur.players!, p('late1', 'Late')]; next.active = [...cur.active as string[], 'late1'];
    next.rounds = [round(['a', 'b', 'c', 'late1'], true)];
    expect(rosterWrite(cur, next, false).error).toBe('round locked');
  });
  it('refuses a second player, a removal, or a rename from anyone but the host', () => {
    const cur = ev();
    const two = ev(); two.players = [...cur.players!, p('late1', 'Late One'), p('late2', 'Late Two')]; two.active = [...cur.active as string[], 'late1', 'late2'];
    expect(rosterWrite(cur, two, false).error).toBe('host only');
    const drop = ev(); drop.active = ['b', 'c', 'd'];
    expect(rosterWrite(cur, drop, false).error).toBe('host only');
    const rename = ev(); rename.players = [p('a', 'Ann'), ...cur.players!.slice(1)];
    expect(rosterWrite(cur, rename, true).error).toBe('keep played');
  });
  it('host can drop someone from later rounds and their played games stay named', () => {
    const cur = ev(); const next = ev(); next.active = ['b', 'c', 'd'];
    next.plan = [{ n: 2, byes: ['a'], matches: [{ court: 1, a: ['b', 'c'], b: ['b', 'd'] }] }];
    expect(rosterWrite(cur, next, true).error).toBe('plan');
    next.plan = [{ n: 2, byes: ['b'], matches: [{ court: 1, a: ['c', 'd'], b: ['c', 'd'] }] }];
    expect(rosterWrite(cur, next, true)).toEqual({});
    expect(next.players!.some(x => x.id === 'a')).toBe(true);
    const gone = ev(); gone.players = cur.players!.filter(x => x.id !== 'a'); gone.active = ['b', 'c', 'd'];
    expect(rosterWrite(cur, gone, true).error).toBe('keep played');
  });
  it('keeps a scored play-ahead round and blocks club and playoff roster edits', () => {
    const cur = ev(); cur.plan![1] = { n: 3, byes: [], matches: [{ court: 1, a: ['a', 'b'], b: ['c', 'd'], sa: 11, sb: 5 }] };
    const next = ev(); next.players = [...cur.players!, p('late1', 'Late')]; next.active = [...(cur.active as string[]), 'late1'];
    next.plan = [cur.plan![0], { n: 3, byes: [], matches: [{ court: 1, a: ['a', 'b'], b: ['c', 'late1'] }] }];
    expect(rosterWrite(cur, next, false).error).toBe('round locked');
    next.plan = cur.plan!.map(r => JSON.parse(JSON.stringify(r)));
    next.plan.push({ n: 4, byes: ['late1'], matches: [{ court: 1, a: ['a', 'b'], b: ['c', 'd'] }] });
    expect(rosterWrite(cur, next, true)).toEqual({});
    expect(rosterWrite(ev({ format: 'club' }), { ...ev({ format: 'club' }), active: ['a'] }, true).error).toBe('club locked');
    const po = ev(); po.rounds = [...po.rounds!, { n: 2, playoff: true, byes: [], matches: [] }];
    const po2 = ev(); po2.rounds = po.rounds; po2.active = ['a'];
    expect(rosterWrite(po, po2, true).error).toBe('playoffs');
  });
  it('refuses a duplicate name', () => {
    const cur = ev(); const next = ev();
    next.players = [...cur.players!, p('late1', 'a')]; next.active = [...cur.active as string[], 'late1'];
    expect(rosterWrite(cur, next, true).error).toBe('duplicate name');
  });
});
