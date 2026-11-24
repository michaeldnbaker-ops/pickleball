/**
 * Player identity. Stats are still keyed by the player's name, so the job here is to make sure every
 * sign-up lands on the name that player already has:
 *  - a phone that joined before is linked to its player (device secret, stored hashed);
 *  - nicknames on file ("Totsy", "Baker") turn into that player's name on sign-up;
 *  - a merge or a rename keeps the old spelling as a nickname, so it never splits again.
 * Players live per club (lower-case club name). Nothing here deletes a game or a score.
 */
import { createHash, randomUUID } from 'node:crypto';
import { comparable, matchName, normPerson, type Cand, type MergeEv } from '../src/engine/names';
import { rewriteNames, type Db } from './merge';

export const PEOPLE_SQL = `create table if not exists people(id text primary key, club text not null, name text not null, aliases text[] not null default '{}',
    owner text, hidden boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
  create index if not exists people_club on people(club);
  create table if not exists person_devices(hash text not null, club text not null, pid text not null, hidden boolean not null default false,
    updated_at timestamptz not null default now(), primary key(hash, club));
  alter table people add column if not exists nick text;`;

export const ck = (s: string) => (s || '').trim().replace(/\s+/g, ' ').toLowerCase();
const clean = (s: unknown) => typeof s === 'string' ? s.trim().replace(/\s+/g, ' ').slice(0, 40) : '';
export const devHash = (d: unknown) => typeof d === 'string' && /^[a-f0-9]{32,64}$/.test(d) ? createHash('sha256').update('pbdev:' + d).digest('hex') : '';
export const okName = (n: string) => !!n && n.length <= 40 && !/^guest$/i.test(n) && comparable(n).length >= 2;

export interface Person { id: string; club: string; name: string; aliases: string[]; owner: string | null; hidden: boolean; nick?: string | null }
const asPerson = (r: Record<string, unknown>): Person => ({ id: String(r.id), club: String(r.club), name: String(r.name), aliases: (r.aliases as string[]) || [], owner: (r.owner as string) || null, hidden: !!r.hidden, nick: (r.nick as string) || null });

/** Everyone a sign-up in this club can be: names in its stats plus players on file. */
export async function clubCands(db: Db, club: string, test: boolean): Promise<(Cand & { id?: string })[]> {
  const c = ck(club);
  const { rows } = await db.query(`select n as name, count(*)::int games from stat_matches m cross join lateral (
      select x n, lower(coalesce(m.ca,'Stone Creek')) c from unnest(m.an) x union all select x, lower(coalesce(m.cb,m.ca,'Stone Creek')) from unnest(m.bn) x) s
    where (m.hidden = false or $1) and not (lower(s.n) = any(m.excl)) and s.c = $2 group by n`, [test, c]);
  const by = new Map<string, Cand & { id?: string }>();
  for (const r of rows) { const n = String(r.name || '').trim(); const k = normPerson(n); if (!okName(n)) continue;
    const prev = by.get(k); if (!prev) by.set(k, { name: n, games: Number(r.games) }); else { if (Number(r.games) > (prev.games || 0)) prev.name = n; prev.games = (prev.games || 0) + Number(r.games); } }
  for (const p of await peopleIn(db, c, test)) {
    const k = normPerson(p.name); const prev = by.get(k);
    if (prev) { prev.aliases = p.aliases; prev.id = p.id; } else by.set(k, { name: p.name, aliases: p.aliases, games: 0, id: p.id });
  }
  return [...by.values()];
}
export async function peopleIn(db: Db, club: string, test: boolean): Promise<Person[]> {
  const { rows } = await db.query('select * from people where club=$1 and (hidden=false or $2) order by lower(name)', [ck(club), test]);
  return rows.map(asPerson);
}
async function personNamed(db: Db, club: string, name: string, test: boolean): Promise<Person | null> {
  const { rows } = await db.query('select * from people where club=$1 and lower(name)=$2 and (hidden=false or $3) limit 1', [ck(club), normPerson(name), test]);
  return rows[0] ? asPerson(rows[0]) : null;
}
async function personOf(db: Db, hash: string, club: string, test: boolean): Promise<Person | null> {
  if (!hash) return null;
  const { rows } = await db.query('select p.* from person_devices d join people p on p.id=d.pid where d.hash=$1 and d.club=$2 and (p.hidden=false or $3)', [hash, ck(club), test]);
  return rows[0] ? asPerson(rows[0]) : null;
}
async function ensurePerson(db: Db, club: string, name: string, test: boolean, owner?: string): Promise<Person> {
  const have = await personNamed(db, club, name, test); if (have) return have;
  const id = randomUUID();
  await db.query('insert into people(id,club,name,owner,hidden) values($1,$2,$3,$4,$5)', [id, ck(club), name, owner || null, test]);
  return { id, club: ck(club), name, aliases: [], owner: owner || null, hidden: test };
}
const addAliases = (p: Person, more: string[]) => [...new Set([...p.aliases, ...more.map(normPerson)])].filter(a => a && a !== normPerson(p.name));

/** Who is this phone, and who is this typed name? Nothing is written. */
export async function resolve(db: Db, b: { club?: unknown; name?: unknown; device?: unknown }, test: boolean) {
  const club = clean(b.club) || 'Stone Creek'; const hash = devHash(b.device);
  const me = await personOf(db, hash, club, test);
  const name = clean(b.name);
  const out: { me?: { name: string; owner: boolean; nick?: string }; exact?: string; suggestions: { name: string; why: string }[]; players?: string[] } = { suggestions: [] };
  if (me) out.me = { name: me.name, owner: !me.owner || me.owner === hash, ...(me.nick ? { nick: me.nick } : {}) };
  if (name) {
    const cands = await clubCands(db, club, test); Object.assign(out, matchName(name, cands));
    // A new name: everyone in the club, so a nickname that looks nothing like the real name ("Totsy" for Craig Newman) can still be picked.
    if (!out.exact) out.players = cands.map(c => c.name).sort((a, b) => a.localeCompare(b));
  }
  return out;
}

/** After a sign-up: this phone is that player. The name is turned into the player's name first. */
export async function link(db: Db, b: { club?: unknown; name?: unknown; device?: unknown }, test: boolean) {
  const club = clean(b.club) || 'Stone Creek'; const hash = devHash(b.device); const typed = clean(b.name);
  if (!hash) return { status: 400, body: { error: 'bad device' } };
  if (!okName(typed)) return { status: 400, body: { error: 'bad name' } };
  const m = matchName(typed, await clubCands(db, club, test));
  const p = await ensurePerson(db, club, m.exact || typed, test, hash);
  if (!p.owner) await db.query('update people set owner=$2 where id=$1 and owner is null', [p.id, hash]);
  await db.query(`insert into person_devices(hash,club,pid,hidden) values($1,$2,$3,$4) on conflict(hash,club) do update set pid=excluded.pid, updated_at=now()`, [hash, ck(club), p.id, test]);
  return { status: 200, body: { ok: true, name: p.name, owner: !p.owner || p.owner === hash } };
}

/** Is someone with this name in a game that is being played right now? Renames wait until it ends. */
async function inLiveGame(db: Db, name: string) {
  const { rows } = await db.query(`select 1 from events e where jsonb_array_length(coalesce(e.data->'rounds','[]'::jsonb)) > 0 and coalesce((e.data->>'finished')::boolean,false) = false
    and exists (select 1 from jsonb_array_elements(coalesce(e.data->'players','[]'::jsonb)) p where lower(trim(regexp_replace(coalesce(p->>'name',''), '\\s+', ' ', 'g'))) = $1) limit 1`, [normPerson(name)]);
  return rows.length > 0;
}
/** Is this name already someone else (their name or a nickname on file)? */
function takenBy(cands: (Cand & { id?: string })[], name: string, self: Person): string | null {
  const k = normPerson(name);
  for (const c of cands) {
    if (normPerson(c.name) === normPerson(self.name) || (c.id && c.id === self.id)) continue;
    if (normPerson(c.name) === k || (c.aliases || []).includes(k)) return c.name;
  }
  return null;
}

/**
 * Change a player's name everywhere (games, stats, trophies, icon). Only the phone that first joined as that player,
 * or the club admin. The old name stays as a nickname so a sign-up with it still finds them.
 */
export async function rename(db: Db, b: { club?: unknown; device?: unknown; from?: unknown; to?: unknown }, admin: boolean, test: boolean, sync: (code: string, ev: MergeEv) => Promise<void>) {
  const club = clean(b.club) || 'Stone Creek'; const hash = devHash(b.device); const to = clean(b.to);
  if (!okName(to)) return { status: 400, body: { error: 'bad name' } };
  const cands = await clubCands(db, club, test);
  let p: Person | null = null;
  if (admin && clean(b.from)) {
    const from = clean(b.from); const hit = cands.find(c => normPerson(c.name) === normPerson(from));
    if (!hit) return { status: 404, body: { error: 'no such player' } };
    p = await ensurePerson(db, club, hit.name, test);
  } else {
    p = await personOf(db, hash, club, test);
    if (!p) return { status: 403, body: { error: 'not linked' } };
    if (p.owner && p.owner !== hash && !admin) return { status: 403, body: { error: 'not owner' } };
  }
  if (to === p.name) return { status: 200, body: { ok: true, name: p.name } };
  const other = takenBy(cands, to, p); if (other) return { status: 409, body: { error: 'taken', name: other } };
  if (await inLiveGame(db, p.name)) return { status: 409, body: { error: 'live game' } };
  const r = await rewriteNames(db, [p.name], to, `Renamed ${p.name} to ${to}`, sync, club);
  if (r.error) return { status: 409, body: { error: r.error } };
  await db.query('update people set name=$2, aliases=$3, updated_at=now() where id=$1', [p.id, to, addAliases({ ...p, name: to }, [p.name])]);
  return { status: 200, body: { ok: true, name: to, events: r.events } };
}

/** Admin: add or remove a nickname. A nickname can't be another player's name; merge them instead. */
export async function setAlias(db: Db, b: { club?: unknown; name?: unknown; alias?: unknown; remove?: unknown }, test: boolean) {
  const club = clean(b.club) || 'Stone Creek'; const name = clean(b.name); const alias = clean(b.alias);
  if (!okName(name) || !okName(alias)) return { status: 400, body: { error: 'bad name' } };
  const cands = await clubCands(db, club, test);
  const hit = cands.find(c => normPerson(c.name) === normPerson(name)); if (!hit) return { status: 404, body: { error: 'no such player' } };
  const p = await ensurePerson(db, club, hit.name, test);
  if (b.remove) { await db.query('update people set aliases=array_remove(aliases,$2), updated_at=now() where id=$1', [p.id, normPerson(alias)]); return { status: 200, body: { ok: true, name: p.name, aliases: p.aliases.filter(a => a !== normPerson(alias)) } }; }
  if (normPerson(alias) === normPerson(p.name)) return { status: 200, body: { ok: true, name: p.name, aliases: p.aliases } };
  const other = takenBy(cands, alias, p);
  if (other) return { status: 409, body: { error: normPerson(other) === normPerson(alias) ? 'is a player' : 'used by', name: other } };
  const aliases = addAliases(p, [alias]);
  await db.query('update people set aliases=$2, updated_at=now() where id=$1', [p.id, aliases]);
  return { status: 200, body: { ok: true, name: p.name, aliases } };
}

/** After a merge: one player, every old spelling kept as a nickname, and every linked phone points at them. */
export async function afterMerge(db: Db, club: string, kept: string, names: string[], test: boolean) {
  const keep = await ensurePerson(db, club, kept, test);
  const others = (await peopleIn(db, club, test)).filter(p => p.id !== keep.id && names.some(n => normPerson(n) === normPerson(p.name)));
  const aliases = addAliases(keep, [...names, ...others.flatMap(o => [o.name, ...o.aliases])]);
  const owner = keep.owner || others.find(o => o.owner)?.owner || null;
  await db.query('update people set aliases=$2, owner=$3, updated_at=now() where id=$1', [keep.id, aliases, owner]);
  for (const o of others) {
    await db.query('update person_devices set pid=$2, updated_at=now() where pid=$1', [o.id, keep.id]);
    await db.query('delete from people where id=$1', [o.id]);
  }
  return { name: keep.name, aliases };
}

/** Sign-ups: a new player whose name is a nickname on file gets the player's real name. Never renames someone already in the game. */
export async function canonNewPlayers(db: Db, cur: { players?: { id: string }[] } | undefined, next: { players?: { id: string; name?: string; side?: string }[] }, clubFor: (side?: string) => string, test: boolean) {
  const have = new Set((cur?.players || []).map(p => p.id));
  const added = (next.players || []).filter(p => !have.has(p.id) && typeof p.name === 'string');
  if (!added.length) return 0;
  const maps = new Map<string, Map<string, string>>(); let n = 0;
  for (const p of added) {
    const club = ck(clubFor(p.side));
    if (!maps.has(club)) { const m = new Map<string, string>(); for (const x of await peopleIn(db, club, test)) for (const a of x.aliases) m.set(a, x.name); maps.set(club, m); }
    const to = maps.get(club)!.get(normPerson(p.name!));
    // "Totsy" signs up: stats go to Craig Newman, and the board shows Totsy for this game.
    if (to && to !== p.name) { if (!(p as { nick?: string }).nick) (p as { nick?: string }).nick = p.name!.trim().replace(/\s+/g, ' ').slice(0, 24); p.name = to; n++; }
  }
  return n;
}

export const cleanNick = (s: unknown) => typeof s === 'string' ? s.trim().replace(/\s+/g, ' ').slice(0, 24) : '';
/**
 * Default nickname: what the board and overall stats show for this player. Stats stay under their name.
 * The phone that first joined as the player sets it, or the admin by name. Blank clears it.
 */
export async function setNick(db: Db, b: { club?: unknown; device?: unknown; name?: unknown; nick?: unknown }, admin: boolean, test: boolean) {
  const club = clean(b.club) || 'Stone Creek'; const nick = cleanNick(b.nick);
  if (nick && (/^guest$/i.test(nick) || comparable(nick).length < 2)) return { status: 400, body: { error: 'bad nickname' } };
  let p: Person | null = null;
  if (admin && clean(b.name)) { const hit = (await clubCands(db, club, test)).find(c => normPerson(c.name) === normPerson(clean(b.name))); if (!hit) return { status: 404, body: { error: 'no such player' } }; p = await ensurePerson(db, club, hit.name, test); }
  else { const h = devHash(b.device); p = await personOf(db, h, club, test); if (!p) return { status: 403, body: { error: 'not linked' } }; if (p.owner && p.owner !== h) return { status: 403, body: { error: 'not owner' } }; }
  if (nick) {
    // A nickname can't be another player's real name.
    const other = takenBy(await clubCands(db, club, test), nick, p);
    if (other) return { status: 409, body: { error: 'taken', name: other } };
  }
  await db.query('update people set nick=$2, aliases=$3, updated_at=now() where id=$1', [p.id, nick || null, nick ? addAliases(p, [nick]) : p.aliases]);
  return { status: 200, body: { ok: true, name: p.name, nick: nick || null } };
}
