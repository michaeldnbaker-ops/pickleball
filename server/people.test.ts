import { describe, it, expect, beforeEach, vi } from 'vitest';
vi.mock('pg', () => ({ Pool: class { on() {} query() { return Promise.resolve({ rows: [] }); } } }));
import { PGlite } from '@electric-sql/pglite';
import { statRows } from './index';
import { PEOPLE_SQL, resolve, link, rename, setAlias, afterMerge, canonNewPlayers, peopleIn, setNick } from './people';
import { rewriteNames, type Db } from './merge';

const SCHEMA = `create table events(code text primary key, data jsonb not null, version int not null default 1, updated_at timestamptz default now());
create table stat_matches(id text primary key, code text not null, ev_name text, date text, hidden boolean not null default false, ak text[] not null, bk text[] not null, an text[] not null, bn text[] not null, sa int not null, sb int not null, updated_at timestamptz not null default now(), excl text[] not null default '{}', ca text, cb text);
create table trophies(code text not null, k text not null, name text not null, ev_name text, date text, hidden boolean not null default false, w int not null, diff int not null, club text, place text not null default 'gold', primary key(code, k));
create table player_icons(k text primary key, icon text, photo text, owner text not null, v int not null default 1, hidden boolean not null default false, updated_at timestamptz not null default now());
${PEOPLE_SQL}`;

let pg: PGlite; let db: Db;
const wrap = (p: PGlite): Db => ({
  async query(sql: string, params?: unknown[]) {
    if (params && params.length) { const r = await p.query(sql, params as never[]); return { rows: r.rows as Record<string, unknown>[], rowCount: r.affectedRows ?? r.rows.length }; }
    const rs = await p.exec(sql); const last = rs[rs.length - 1]; return { rows: (last?.rows || []) as Record<string, unknown>[], rowCount: last?.affectedRows ?? 0 };
  },
  async connect() { return { ...wrap(p), release() {} }; },
});
const sync = async (code: string, ev: unknown) => {
  await db.query('delete from stat_matches where code=$1', [code]);
  for (const r of statRows(code, ev as never)) await db.query('insert into stat_matches(id,code,ev_name,date,hidden,ak,bk,an,bn,sa,sb,excl,ca,cb) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)', r);
};
const game = async (code: string, names: string[], extra: Record<string, unknown> = {}) => {
  const players = names.map((name, i) => ({ id: 'p' + i, name, src: 'self' }));
  const ev = { id: code, name: code, date: '2026-11-01T09:00', format: 'rotating', players, active: players.map(p => p.id), finished: true,
    rounds: [{ n: 1, byes: [], matches: [{ court: 1, a: ['p0', 'p1'], b: ['p2', 'p3'], sa: 11, sb: 4 }] }], ...extra };
  await db.query('insert into events(code,data) values($1,$2)', [code, JSON.stringify(ev)]); await sync(code, ev); return ev;
};
const dev = (n: number) => String(n).repeat(32).slice(0, 32).replace(/[^a-f0-9]/g, 'a');
const statNames = async () => (await db.query('select distinct unnest(an || bn) n from stat_matches order by 1')).rows.map(r => r.n);

beforeEach(async () => {
  pg = new PGlite(); db = wrap(pg); await db.query(SCHEMA);
  await game('G1', ['Boston DRew', 'Michael Baker', 'Jeff Stempel', 'Craig Newman']);
  await game('G2', ['Michael Baker', 'Jeff Stempel', 'Boston DRew', 'Owen Stempel']);
});

describe('player identity', () => {
  it('a phone that joined before is that player, whatever is typed next', async () => {
    expect((await resolve(db, { club: 'Stone Creek', device: dev(1) }, false)).me).toBeUndefined();
    expect((await link(db, { club: 'Stone Creek', name: '  boston   drew ', device: dev(1) }, false)).body).toMatchObject({ name: 'Boston DRew', owner: true });
    expect((await resolve(db, { club: 'Stone Creek', device: dev(1), name: 'Totsy' }, false)).me).toEqual({ name: 'Boston DRew', owner: true });
    // Other clubs are separate players.
    expect((await resolve(db, { club: "Franco's", device: dev(1) }, false)).me).toBeUndefined();
    // A second phone can join as him but cannot rename him.
    await link(db, { club: 'Stone Creek', name: 'Boston DRew', device: dev(2) }, false);
    expect((await rename(db, { club: 'Stone Creek', device: dev(2), to: 'Drew Landry' }, false, false, sync)).status).toBe(403);
    // Not you: the phone becomes the other player.
    await link(db, { club: 'Stone Creek', name: 'Craig Newman', device: dev(2) }, false);
    expect((await resolve(db, { club: 'Stone Creek', device: dev(2) }, false)).me?.name).toBe('Craig Newman');
  });
  it('typed names: exact and nicknames on file resolve, close ones are asked about', async () => {
    const r = await resolve(db, { club: 'Stone Creek', name: 'Baker' }, false);
    expect(r.exact).toBeUndefined(); expect(r.suggestions).toEqual([{ name: 'Michael Baker', why: 'last name' }]);
    expect((await setAlias(db, { club: 'Stone Creek', name: 'Craig Newman', alias: 'Totsy' }, false)).status).toBe(200);
    expect((await resolve(db, { club: 'Stone Creek', name: 'totsy' }, false)).exact).toBe('Craig Newman');
    // A nickname that looks nothing like the name is never guessed; a new name gets the full pick list instead.
    const fresh = await resolve(db, { club: 'Stone Creek', name: 'Big Craig' }, false);
    expect(fresh.exact).toBeUndefined(); expect(fresh.players).toContain('Craig Newman');
    // A nickname can't be someone else's name, or someone else's nickname.
    expect((await setAlias(db, { club: 'Stone Creek', name: 'Boston DRew', alias: 'Michael Baker' }, false)).body.error).toBe('is a player');
    expect((await setAlias(db, { club: 'Stone Creek', name: 'Michael Baker', alias: 'totsy' }, false)).body.error).toBe('used by');
    expect((await setAlias(db, { club: 'Stone Creek', name: 'Nobody Here', alias: 'x y' }, false)).status).toBe(404);
    await setAlias(db, { club: 'Stone Creek', name: 'Craig Newman', alias: 'Totsy', remove: true }, false);
    expect((await resolve(db, { club: 'Stone Creek', name: 'totsy' }, false)).exact).toBeUndefined();
  });
  it('a sign-up typed as a nickname joins as the player; people already in the game are never renamed', async () => {
    await setAlias(db, { club: 'Stone Creek', name: 'Michael Baker', alias: 'Baker' }, false);
    const cur = { players: [{ id: 'a', name: 'Baker' }] };
    const next = { players: [{ id: 'a', name: 'Baker' }, { id: 'b', name: ' baker ' }, { id: 'c', name: 'New Person' }] };
    expect(await canonNewPlayers(db, cur, next, () => 'Stone Creek', false)).toBe(1);
    expect(next.players.map(p => p.name)).toEqual(['Baker', 'Michael Baker', 'New Person']);
    expect((next.players[1] as { nick?: string }).nick).toBe('baker'); // shown as typed for this game; stats go to Michael Baker
    const other = { players: [{ id: 'z', name: 'Baker' }] };
    expect(await canonNewPlayers(db, undefined, other, () => "Franco's", false)).toBe(0);
  });
  it('rename: same player, every game and stat follows, old name stays a nickname', async () => {
    await link(db, { club: 'Stone Creek', name: 'Boston DRew', device: dev(1) }, false);
    expect((await rename(db, { club: 'Stone Creek', device: dev(1), to: 'Michael Baker' }, false, false, sync)).body).toEqual({ error: 'taken', name: 'Michael Baker' });
    const r = await rename(db, { club: 'Stone Creek', device: dev(1), to: 'Drew Landry' }, false, false, sync);
    expect(r.body).toMatchObject({ ok: true, name: 'Drew Landry', events: ['G1', 'G2'] });
    expect(await statNames()).toEqual(['Craig Newman', 'Drew Landry', 'Jeff Stempel', 'Michael Baker', 'Owen Stempel']);
    expect((await resolve(db, { club: 'Stone Creek', name: 'Boston Drew', device: dev(1) }, false))).toMatchObject({ me: { name: 'Drew Landry' }, exact: 'Drew Landry' });
    expect((await db.query('select count(*)::int n from name_merge_backup')).rows[0].n).toBe(1);
  });
  it('rename waits while that player is in a game being played', async () => {
    await link(db, { club: 'Stone Creek', name: 'Jeff Stempel', device: dev(3) }, false);
    await game('LIVE', ['Jeff Stempel', 'A B', 'C D', 'E F'], { finished: false });
    expect((await rename(db, { club: 'Stone Creek', device: dev(3), to: 'Jeffrey Stempel' }, false, false, sync)).body.error).toBe('live game');
    expect(await statNames()).toContain('Jeff Stempel');
  });
  it('admin rename and merge keep every spelling as a nickname and move linked phones', async () => {
    await game('G3', ['Totsy', 'Jeff Stempel', 'Owen Stempel', 'Michael Baker']);
    await link(db, { club: 'Stone Creek', name: 'Totsy', device: dev(4) }, false); // Craig signed up as "Totsy" (the dupe)
    await rewriteNames(db, ['Totsy'], 'Craig Newman', 'merge', sync); // what /stats/merge does to games
    const m = await afterMerge(db, 'Stone Creek', 'Craig Newman', ['Craig Newman', 'Totsy'], false);
    expect(m.aliases).toEqual(['totsy']);
    expect(await statNames()).not.toContain('Totsy');
    expect((await resolve(db, { club: 'Stone Creek', device: dev(4) }, false)).me?.name).toBe('Craig Newman');
    expect((await resolve(db, { club: 'Stone Creek', name: 'TOTSY' }, false)).exact).toBe('Craig Newman');
    expect((await peopleIn(db, 'Stone Creek', false)).map(p => p.name)).toEqual(['Craig Newman']);
    const a = await rename(db, { club: 'Stone Creek', from: 'Craig Newman', to: 'Craig A Newman' }, true, false, sync);
    expect(a.status).toBe(200);
    expect((await peopleIn(db, 'Stone Creek', false))[0]).toMatchObject({ name: 'Craig A Newman', aliases: ['totsy', 'craig newman'] });
    // Boston DRew stays his own player.
    expect((await resolve(db, { club: 'Stone Creek', name: 'Boston Drew' }, false)).exact).toBe('Boston DRew');
  });
  it('nickname: shown on the board, stats stay under the real name, and signing up with it finds them', async () => {
    expect((await setNick(db, { club: 'Stone Creek', device: dev(7), nick: 'Totsy' }, false, false)).status).toBe(403); // phone not linked
    await link(db, { club: 'Stone Creek', name: 'Craig Newman', device: dev(7) }, false);
    expect((await setNick(db, { club: 'Stone Creek', device: dev(7), nick: '  Totsy ' }, false, false)).body).toEqual({ ok: true, name: 'Craig Newman', nick: 'Totsy' });
    expect((await resolve(db, { club: 'Stone Creek', device: dev(7), name: 'totsy' }, false))).toMatchObject({ me: { name: 'Craig Newman', nick: 'Totsy' }, exact: 'Craig Newman' });
    const next = { players: [{ id: 'n', name: 'Totsy' }] as { id: string; name: string; nick?: string }[] };
    await canonNewPlayers(db, undefined, next, () => 'Stone Creek', false);
    expect(next.players[0]).toEqual({ id: 'n', name: 'Craig Newman', nick: 'Totsy' });
    expect((await setNick(db, { club: 'Stone Creek', device: dev(7), nick: 'Michael Baker' }, false, false)).body.error).toBe('taken');
    expect((await setNick(db, { club: 'Stone Creek', name: 'Boston DRew', nick: 'Boston Drew' }, true, false)).status).toBe(200);
    expect((await setNick(db, { club: 'Stone Creek', device: dev(7), nick: '' }, false, false)).body.nick).toBeNull();
    expect(await statNames()).toEqual(['Boston DRew', 'Craig Newman', 'Jeff Stempel', 'Michael Baker', 'Owen Stempel']);
  });
  it('hidden test players never show in real mode', async () => {
    await link(db, { club: 'Stone Creek', name: 'Test Person', device: dev(5) }, true);
    expect((await resolve(db, { club: 'Stone Creek', device: dev(5) }, false)).me).toBeUndefined();
    expect((await resolve(db, { club: 'Stone Creek', device: dev(5) }, true)).me?.name).toBe('Test Person');
    expect((await link(db, { club: 'Stone Creek', name: 'Guest', device: dev(5) }, false)).status).toBe(400);
    expect((await link(db, { club: 'Stone Creek', name: 'Ok Name', device: 'nope' }, false)).status).toBe(400);
  });
});
