import { Pool } from 'pg';
import { closeEvent } from './close';
import { capOf, overCap, validCourtSet, capChange } from './cap';
import { buildPast } from './past';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
pool.on('error', () => {});
const H = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,PUT,POST,DELETE,OPTIONS', 'access-control-allow-headers': 'content-type, x-admin', 'content-type': 'application/json' };
const j = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: H });

let ready: Promise<unknown> | null = null;
const ensureStats = () => ready ??= pool.query(`create table if not exists stat_matches(
  id text primary key, code text not null, ev_name text, date text, hidden boolean not null default false,
  ak text[] not null, bk text[] not null, an text[] not null, bn text[] not null, sa int not null, sb int not null, updated_at timestamptz not null default now());
  create index if not exists stat_matches_code on stat_matches(code);
  alter table stat_matches add column if not exists excl text[] not null default '{}';
  create table if not exists trophies(code text not null, k text not null, name text not null, ev_name text, date text, hidden boolean not null default false, w int not null, diff int not null, primary key(code, k));
  create table if not exists player_icons(k text primary key, icon text, photo text, owner text not null, v int not null default 1, hidden boolean not null default false, updated_at timestamptz not null default now());
  create table if not exists app_admin(hash text primary key);
  alter table stat_matches add column if not exists ca text; alter table stat_matches add column if not exists cb text;
  alter table trophies add column if not exists club text;
  create table if not exists clubs(k text primary key, name text not null, hidden boolean not null default false, created_at timestamptz not null default now());`).catch(e => { ready = null; throw e; });

interface M { court: number; a: string[]; b: string[]; sa?: number; sb?: number }
interface R { n: number; matches: M[]; playoff?: boolean }
interface X { slot: string; from: number; name: string | null }
interface Ev { clubName?: string; club?: { home?: string; away?: string }; trophy?: boolean; finished?: boolean; totalRounds?: number; active?: string[]; startedAt?: number; startedBy?: string; host?: string; date?: unknown; courts?: unknown; format?: unknown; seeding?: unknown; balanceDupr?: unknown; teams?: string[][]; name?: string; date?: string; hidden?: boolean; maxPlayers?: number; courtSet?: unknown; players?: { id: string; name: string }[]; rounds?: R[]; plan?: R[]; subs?: X[] }
/** Idempotent: one row per (event, round, court); edits update, cleared/voided scores are removed. */
async function syncStats(code: string, ev: Ev) {
  await ensureStats();
  const name = new Map((ev.players || []).map(p => [p.id, (p.name || '').trim()]));
  // Club vs Club: unnamed visitor spots play as guest players; they are kept out of Overall stats (excl).
  const guestNames = new Set((ev.players || []).filter((p: { guest?: boolean }) => p.guest).map(p => (p.name || "").trim().toLowerCase()));
  const rows: unknown[][] = []; let po = 0;
  // Clubs: stats go to the game's club (missing = Stone Creek). Club vs Club: side A is the home club, side B the visiting club.
  const ca = clubOf(ev), cb = ev.format === 'club' && ev.club?.away?.trim() ? ev.club.away.trim() : ca;
  for (const r of [...(ev.rounds || []), ...(ev.plan || [])]) {
    const tag = r.playoff ? 'p' + (++po) : 'r' + r.n;
    for (const m of r.matches || []) {
      if (m.sa == null || m.sb == null || m.sa === m.sb) continue;
      // Subs: from their round on, a slot's results are credited to the sub; an unnamed Guest is kept out of Overall stats (excl).
      const rn = r.playoff ? 10000 + r.n : r.n; const who = (id: string) => subName(ev.subs, id, rn) ?? (name.get(id) || '?');
      const an = m.a.map(who), bn = m.b.map(who);
      const excl = [...an, ...bn].filter(x => /^guest$/i.test(x.trim()) || guestNames.has(x.trim().toLowerCase())).map(x => x.toLowerCase());
      rows.push([`${code}:${tag}:${m.court}`, code, ev.name || '', ev.date || '', !!ev.hidden, an.map(x => x.toLowerCase()), bn.map(x => x.toLowerCase()), an, bn, m.sa, m.sb, excl, ca, cb]);
    }
  }
  const ids = rows.map(r => r[0] as string);
  await syncTrophies(code, ev, rows);
  await pool.query('delete from stat_matches where code=$1 and not (id = any($2::text[]))', [code, ids]);
  for (const r of rows) await pool.query(`insert into stat_matches(id,code,ev_name,date,hidden,ak,bk,an,bn,sa,sb,excl,ca,cb) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
    on conflict(id) do update set ev_name=excluded.ev_name, date=excluded.date, hidden=excluded.hidden, ak=excluded.ak, bk=excluded.bk, an=excluded.an, bn=excluded.bn, sa=excluded.sa, sb=excluded.sb, excl=excluded.excl, ca=excluded.ca, cb=excluded.cb, updated_at=now()`, r);
}
/** Trophy match: when the game is completed, 1st place (regular rounds: most wins, then point diff; still tied = co-winners) gets a trophy. Guests excluded. */
export function trophyWinners(rows: unknown[][]) {
  const t = new Map<string, { name: string; w: number; diff: number; club?: string }>();
  for (const r of rows) { if (String(r[0]).split(':')[1].startsWith('p')) continue; const [an, bn, sa, sb, excl] = [r[7] as string[], r[8] as string[], r[9] as number, r[10] as number, r[11] as string[]];
    for (const [ns, d] of [[an, sa - sb], [bn, sb - sa]] as [string[], number][]) for (const n of ns) { const k = n.trim().toLowerCase(); if (excl.includes(k) || k === '?') continue;
      const e = t.get(k) || { name: n.trim(), w: 0, diff: 0, club: (ns === an ? r[12] : r[13]) as string | undefined }; e.w += d > 0 ? 1 : 0; e.diff += d; t.set(k, e); } }
  const all = [...t.entries()]; if (!all.length) return [];
  const best = all.reduce((b, [, e]) => e.w > b.w || (e.w === b.w && e.diff > b.diff) ? e : b, all[0][1]);
  return all.filter(([, e]) => e.w === best.w && e.diff === best.diff).map(([k, e]) => ({ k, ...e }));
}
async function syncTrophies(code: string, ev: Ev, rows: unknown[][]) {
  await pool.query('delete from trophies where code=$1', [code]);
  if (!ev.trophy || !ev.finished) return;
  for (const w of trophyWinners(rows)) await pool.query('insert into trophies(code,k,name,ev_name,date,hidden,w,diff,club) values($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict do nothing', [code, w.k, w.name, ev.name || '', ev.date || '', !!ev.hidden, w.w, w.diff, w.club || clubOf(ev)]);
}
const sha = async (x: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(x)))).map(b => b.toString(16).padStart(2, '0')).join('');
async function isAdmin(req: Request) { const k = req.headers.get('x-admin'); if (!k || k.length < 16) return false; const { rows } = await pool.query('select 1 from app_admin where hash=$1', [await sha(k)]); return rows.length > 0; }
export const ICONS = ['paddle', 'ball', 'star', 'fire', 'bolt', 'eagle', 'tiger', 'fox', 'bear', 'turtle', 'cactus', 'wave', 'clover', 'crown', 'rocket', 'target'];
/** Photo: a client-resized JPEG data URL, at most ~90 KB. */
export const validPhoto = (p: unknown) => typeof p === 'string' && p.length <= 120000 && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(p);
export const SC = 'Stone Creek';
export const clubOf = (ev: Ev) => (ev.format === 'club' && ev.club?.home?.trim()) || ev.clubName?.trim() || SC;
const ck = (n: string) => (n || '').trim().replace(/\s+/g, ' ').toLowerCase();
async function addClub(name: string | undefined, hidden: boolean) { const n = (name || '').trim().replace(/\s+/g, ' '); if (!n || n.length > 40 || ck(n) === ck(SC)) return;
  await pool.query('insert into clubs(k,name,hidden) values($1,$2,$3) on conflict(k) do update set hidden = clubs.hidden and excluded.hidden', [ck(n), n, hidden]); }
function subName(subs: X[] | undefined, slot: string, n: number): string | null {
  let cur: X | undefined; for (const x of subs || []) if (x.slot === slot && x.from <= n && (!cur || x.from >= cur.from)) cur = x;
  return cur ? (cur.name?.trim() || null) : null;
}
/** Subs: up to 200 entries, each a player in the game, a round ≥ 1, and a name (≤ 40 chars) or null (original back in). */
function validSubs(xs: unknown, ids: Set<string>) {
  return xs === undefined || (Array.isArray(xs) && xs.length <= 200 && xs.every(x => x && typeof x === 'object' && ids.has((x as X).slot) && Number.isInteger((x as X).from) && (x as X).from >= 1
    && ((x as X).name === null || (typeof (x as X).name === 'string' && ((x as X).name as string).length <= 40))));
}
const nn = (s: string) => (s || '').trim().replace(/\s+/g, ' ').toLowerCase();
function dupCount(ev: Ev) { const act = new Set(ev.active || []); const ps = (ev.players || []).filter(p => act.has(p.id)); return ps.length - new Set(ps.map(p => nn(p.name))).size; }
const PER = `select k, n, code, date, pf, pa, id from stat_matches m cross join lateral (
  select lower(x) k, x n, m.sa pf, m.sb pa, lower(coalesce(m.ca,'Stone Creek')) c from unnest(m.an) x union all select lower(x), x, m.sb, m.sa, lower(coalesce(m.cb,m.ca,'Stone Creek')) from unnest(m.bn) x) s
  where (m.hidden = false or $1) and not (s.k = any(m.excl)) and s.c = $2`;

/** 'YYYY-MM-DDTHH:MM' wall-clock time in America/Chicago (games store their date that way). */
function ctLocal(ms: number) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
/** Auto-cleanup: a game that never started is deleted the day after its scheduled date (Central time). Runs on list/read requests. */
async function purgeStale() {
  const today = ctLocal(Date.now()).slice(0, 10);
  await pool.query(`delete from events where jsonb_array_length(coalesce(data->'rounds','[]'::jsonb))=0 and coalesce(data->>'date','') ~ '^\\d{4}-\\d{2}-\\d{2}' and substr(data->>'date',1,10) < $1`, [today]).catch(() => {});
  // Auto-close: a game that started but was never ended is completed the day after its date, exactly like End early. Small batches keep requests fast.
  try {
    const { rows } = await pool.query(`select code, data, version from events where jsonb_array_length(coalesce(data->'rounds','[]'::jsonb))>0 and coalesce((data->>'finished')::boolean,false)=false
      and coalesce(data->>'date','') ~ '^\\d{4}-\\d{2}-\\d{2}' and substr(data->>'date',1,10) < $1 order by data->>'date' limit 25`, [today]);
    for (const r of rows) {
      const ev = closeEvent(r.data as Ev);
      const u = await pool.query("update events set data=$2, version=version+1, updated_at=now() where code=$1 and version=$3 and coalesce((data->>'finished')::boolean,false)=false", [r.code, JSON.stringify(ev), r.version]);
      if (u.rowCount) await syncStats(r.code, ev).catch(() => {});
    }
  } catch { /* retried on the next request */ }
}
export default {
  async fetch(req: Request) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: H });
    const url = new URL(req.url);
    const test = url.searchParams.get('test') === '1';
    try {
      if (url.pathname === '/events' && req.method === 'GET') {
        // Public list: not-yet-started (lobby/upcoming), unfinished, unhidden events dated from (client-local "from", default now - 1 day) forward, soonest first.
        await purgeStale();
        // Join shows only games whose start time is less than 3 hours ago (Central time) or later.
        const from = ctLocal(Date.now() - 3 * 3600e3);
        const { rows } = await pool.query(`select code, data->>'name' as name, data->>'date' as date, data->>'place' as place, data->>'format' as format,
            coalesce(jsonb_array_length(data->'active'),0) as players, jsonb_array_length(coalesce(data->'rounds','[]'::jsonb)) as rounds,
            case when data->>'maxPlayers' in ('4','8','12','16') then (data->>'maxPlayers')::int end as max,
            coalesce(case when data->>'format'='club' then data->'club'->>'home' end, data->>'clubName', 'Stone Creek') as club
          from events where coalesce((data->>'finished')::boolean,false)=false and (coalesce((data->>'hidden')::boolean,false)=false or $2)
            and data->>'date' >= $1 order by data->>'date' asc limit $3`, [from, test, test ? 300 : 50]); // test mode sees more (hidden e2e games pile up)
        return j({ events: rows });
      }
      if (url.pathname === '/past' && req.method === 'GET') {
        // Completed matches, newest first: open one to see its final standings (read-only).
        const { rows } = await pool.query(`select code, data->>'name' as name, data->>'date' as date, data->>'place' as place, data->>'format' as format,
            coalesce(jsonb_array_length(data->'active'),0) as players, jsonb_array_length(coalesce(data->'rounds','[]'::jsonb)) as rounds
            , coalesce(case when data->>'format'='club' then data->'club'->>'home' end, data->>'clubName', 'Stone Creek') as club, case when data->>'format'='club' then data->'club'->>'away' end as away, coalesce((data->>'addedLater')::boolean,false) as added_later
          from events where coalesce((data->>'finished')::boolean,false)=true and (coalesce((data->>'hidden')::boolean,false)=false or $1)
            and (lower(coalesce(case when data->>'format'='club' then data->'club'->>'home' end, data->>'clubName', 'Stone Creek')) = $2 or (data->>'format'='club' and lower(data->'club'->>'away') = $2))
          order by data->>'date' desc limit ${test ? 300 : 100}`, [test, ck(url.searchParams.get('club') || SC)]);
        return j({ events: rows });
      }
      if (url.pathname === '/stats' && req.method === 'GET') {
        await ensureStats(); const club = ck(url.searchParams.get('club') || SC);
        const { rows } = await pool.query(`with p as (${PER}) select k, (array_agg(n order by date desc))[1] as name, count(*)::int games, sum((pf>pa)::int)::int wins, sum((pf<pa)::int)::int losses,
          sum(pf)::int pf, sum(pa)::int pa, sum(pf-pa)::int diff, count(distinct code)::int events,
          (select count(*)::int from trophies t where t.k = p.k and (t.hidden = false or $1) and lower(coalesce(t.club,'Stone Creek')) = $2) trophies from p group by k order by wins desc, diff desc, games desc limit ${test ? 3000 : 500}`, [test, club]); // test mode: hidden e2e players pile up
        return j({ players: rows });
      }
      if (url.pathname === '/stats/player' && req.method === 'GET') {
        await ensureStats(); const k = (url.searchParams.get('name') || '').trim().toLowerCase(); const club = ck(url.searchParams.get('club') || SC);
        const { rows } = await pool.query(`select id, code, ev_name, date, an, bn, sa, sb from stat_matches where ($2 or hidden=false) and not ($1 = any(excl))
          and (($1 = any(ak) and lower(coalesce(ca,'Stone Creek')) = $3) or ($1 = any(bk) and lower(coalesce(cb,ca,'Stone Creek')) = $3)) order by date desc, id desc limit 500`, [k, test, club]);
        const tr = await pool.query(`select code, ev_name, date, w, diff from trophies where k=$1 and (hidden=false or $2) and lower(coalesce(club,'Stone Creek')) = $3 order by date desc`, [k, test, club]);
        return j({ matches: rows, trophies: tr.rows });
      }
      if (url.pathname === '/clubs' && req.method === 'GET') {
        await ensureStats(); const { rows } = await pool.query('select name from clubs where hidden=false or $1 order by lower(name)', [test]);
        return j({ clubs: [SC, ...rows.map(r => r.name)] });
      }
      if (url.pathname === '/clubs' && req.method === 'PUT') {
        await ensureStats(); const b = await req.json().catch(() => ({})) as { name?: string };
        const n = (b.name || '').trim().replace(/\s+/g, ' '); if (!n || n.length > 40) return j({ error: 'bad name' }, 400);
        await addClub(n, test); const { rows } = await pool.query('select name from clubs where k=$1', [ck(n)]);
        return j({ ok: true, name: ck(n) === ck(SC) ? SC : rows[0]?.name || n });
      }
      if (url.pathname === '/icons' && req.method === 'GET') {
        await ensureStats();
        const { rows } = await pool.query('select k, icon, (photo is not null) photo, v from player_icons where hidden=false or $1', [test]);
        return j({ icons: Object.fromEntries(rows.map(r => [r.k, { icon: r.icon, photo: r.photo, v: r.v }])) });
      }
      if (url.pathname === '/icon' && req.method === 'GET') {
        await ensureStats(); const { rows } = await pool.query('select photo from player_icons where k=$1', [nn(url.searchParams.get('k') || '')]);
        if (!rows[0]?.photo) return j({ error: 'not found' }, 404);
        const b = Uint8Array.from(atob(rows[0].photo.split(',')[1]), c => c.charCodeAt(0));
        return new Response(b, { headers: { 'access-control-allow-origin': '*', 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=31536000, immutable' } });
      }
      if (url.pathname === '/icon' && req.method === 'PUT') {
        // Player icons: the first phone to set a name's icon gets a secret owner token; only that token (or the admin key) can change it; the admin can reset it.
        await ensureStats(); const b = await req.json().catch(() => ({})) as { name?: string; icon?: string; photo?: string; token?: string; reset?: boolean };
        const k = nn(b.name || ''); if (!k || k.length > 40 || /^guest$/.test(k)) return j({ error: 'bad name' }, 400);
        const admin = await isAdmin(req);
        const { rows } = await pool.query('select owner from player_icons where k=$1', [k]);
        if (b.reset) { if (!admin) return j({ error: 'admin only' }, 403); await pool.query('delete from player_icons where k=$1', [k]); return j({ ok: true }); }
        const icon = b.photo ? null : b.icon; if (b.photo ? !validPhoto(b.photo) : !ICONS.includes(icon || '')) return j({ error: 'bad icon' }, 400);
        if (rows[0]) {
          if (!admin && !(b.token && await sha(b.token) === rows[0].owner)) return j({ error: 'not owner' }, 403);
          await pool.query('update player_icons set icon=$2, photo=$3, v=v+1, updated_at=now() where k=$1', [k, icon, b.photo || null]); return j({ ok: true });
        }
        const token = Array.from(crypto.getRandomValues(new Uint8Array(24))).map(x => x.toString(16).padStart(2, '0')).join('');
        const ins = await pool.query('insert into player_icons(k,icon,photo,owner,hidden) values($1,$2,$3,$4,$5) on conflict do nothing', [k, icon, b.photo || null, await sha(token), test]);
        if (!ins.rowCount) return j({ error: 'not owner' }, 403);
        return j({ ok: true, token });
      }
      if (url.pathname === '/test/cleanup' && req.method === 'POST') {
        // Test cleanup (admin key only): deletes ONLY rows flagged hidden (test mode / e2e). Real (unhidden) games, stats, trophies, icons and clubs are never touched.
        await ensureStats(); if (!test || !(await isAdmin(req))) return j({ error: 'admin only' }, 403);
        const c = await pool.connect(); const n: Record<string, number> = {};
        try {
          await c.query('begin');
          const ev = await c.query("select code from events where coalesce((data->>'hidden')::boolean,false) = true");
          const codes = ev.rows.map(r => r.code as string);
          n.stats = (await c.query('delete from stat_matches where hidden = true')).rowCount || 0;
          n.trophies = (await c.query('delete from trophies where hidden = true')).rowCount || 0;
          n.icons = (await c.query('delete from player_icons where hidden = true')).rowCount || 0;
          n.clubs = (await c.query('delete from clubs where hidden = true')).rowCount || 0;
          n.games = (await c.query("delete from events where code = any($1::text[]) and coalesce((data->>'hidden')::boolean,false) = true", [codes])).rowCount || 0;
          await c.query('commit');
        } catch (e) { await c.query('rollback'); throw e; } finally { c.release(); }
        return j({ ok: true, deleted: n });
      }
      if (url.pathname === '/past-game' && req.method === 'POST') {
        // Add past game: anyone; saved closed (counts in stats/trophies like a normal game). The adding phone gets a secret token to edit/delete it.
        await ensureStats(); const text = await req.text(); if (text.length > 100_000) return j({ error: 'too large' }, 413);
        const b = JSON.parse(text || '{}'); if (test) b.hidden = true; else delete b.hidden;
        // Abuse cap: at most 20 real past games added per hour across the club (test mode has its own bucket).
        const recent = await pool.query("select count(*)::int n from events where coalesce((data->>'addedLater')::boolean,false) and (data->>'createdAt')::bigint > $2 and coalesce((data->>'hidden')::boolean,false) = $1", [!!b.hidden, Date.now() - 3600e3]);
        if (recent.rows[0].n >= (b.hidden ? 300 : 20)) return j({ error: 'too many past games added this hour; try later' }, 429);
        const token = Array.from(crypto.getRandomValues(new Uint8Array(24))).map(x => x.toString(16).padStart(2, '0')).join('');
        const code = Array.from(crypto.getRandomValues(new Uint8Array(6))).map(x => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[x % 32]).join('');
        const r = buildPast(b, ctLocal(Date.now()).slice(0, 10), code, await sha(token), Date.now()); if (r.error) return j({ error: r.error }, 400);
        const ins = await pool.query('insert into events(code,data) values($1,$2) on conflict do nothing', [code, JSON.stringify(r.ev)]); if (!ins.rowCount) return j({ error: 'retry' }, 409);
        await addClub(r.ev!.clubName as string, !!r.ev!.hidden).catch(() => {}); await syncStats(code, r.ev as Ev);
        return j({ ok: true, code, token });
      }
      const pg = url.pathname.match(/^\/past-game\/([A-Za-z0-9]{4,16})$/);
      if (pg && (req.method === 'PUT' || req.method === 'DELETE')) {
        // Edit/delete an added-later game: only the phone that added it (token) or the admin key. Normal games can never be touched here.
        await ensureStats(); const code = pg[1].toUpperCase(); const text = await req.text(); if (text.length > 100_000) return j({ error: 'too large' }, 413);
        const b = JSON.parse(text || '{}'); const cur = (await pool.query('select data from events where code=$1', [code])).rows[0]?.data as (Ev & { addedLater?: boolean; ownerHash?: string; createdAt?: number }) | undefined;
        if (!cur || !cur.addedLater) return j({ error: 'not found' }, 404);
        const owner = typeof b.token === 'string' && b.token.length >= 32 && !!cur.ownerHash && (await sha(b.token)) === cur.ownerHash;
        if (!owner && !(await isAdmin(req))) return j({ error: 'not owner' }, 403);
        if (req.method === 'DELETE') {
          await pool.query('delete from stat_matches where code=$1', [code]); await pool.query('delete from trophies where code=$1', [code]);
          await pool.query("delete from events where code=$1 and coalesce((data->>'addedLater')::boolean,false)", [code]); return j({ ok: true, deleted: code });
        }
        b.hidden = !!cur.hidden; const r = buildPast(b, ctLocal(Date.now()).slice(0, 10), code, cur.ownerHash || '', cur.createdAt || Date.now()); if (r.error) return j({ error: r.error }, 400);
        await pool.query("update events set data=$2, version=version+1, updated_at=now() where code=$1 and coalesce((data->>'addedLater')::boolean,false)", [code, JSON.stringify(r.ev)]);
        await addClub(r.ev!.clubName as string, !!r.ev!.hidden).catch(() => {}); await syncStats(code, r.ev as Ev); return j({ ok: true, code });
      }
      if (url.pathname === '/admin' && req.method === 'GET') { await ensureStats(); return j({ admin: await isAdmin(req) }); }
      const m = url.pathname.match(/^\/e\/([A-Za-z0-9]{4,16})$/);
      if (!m) return j({ ok: true, service: 'pickleball' });
      const code = m[1].toUpperCase();
      if (req.method === 'GET') {
        await purgeStale();
        const { rows } = await pool.query('select data, version, updated_at from events where code=$1', [code]);
        if (rows[0]?.data?.ownerHash) delete rows[0].data.ownerHash; // edit/delete secret stays server-side
        return rows[0] ? j(rows[0]) : j({ error: 'not found' }, 404);
      }
      if (req.method === 'PUT') {
        const text = await req.text(); if (text.length > 1_000_000) return j({ error: 'too large' }, 413);
        const body = JSON.parse(text);
        const cur = (await pool.query('select data from events where code=$1', [code])).rows[0]?.data as Ev | undefined;
        const by = url.searchParams.get('by') || '';
        // A completed match is read-only for everyone.
        if (cur?.finished && body.data) return j({ error: 'finished', data: cur }, 409);
        const ids = (xs: unknown) => JSON.stringify([...new Set(((xs || []) as unknown[]).map(x => typeof x === 'string' ? x : (x as { id: string }).id))].sort());
        const started = !!cur && (cur.rounds || []).length > 0;
                // Picked courts (by letter) must match the court count; anything malformed is dropped so the game falls back to A, B, C….
        if (body.data && 'courtSet' in body.data && !validCourtSet(body.data.courtSet, body.data.courts)) delete body.data.courtSet;
        // The player cap: the creator's phone can change it before the start (4/8/12/16, never below the sign-ups); locked after the start.
        if (cur && body.data) { const c = capChange(cur, body.data, { started, org: url.searchParams.get('org') === '1' }); if (c.error) return j({ error: c.error, data: cur }, 409); if (c.max) body.data.maxPlayers = c.max; else delete body.data.maxPlayers; }
        if (started && body.data) {
          // Start is one-time. A second start (different startedAt) or a re-draw of Round 1 is refused; caller gets the existing game.
          if (body.data.startedAt && cur.startedAt && body.data.startedAt !== cur.startedAt) return j({ error: 'already started', data: cur }, 409);
          if (!(body.data.rounds || []).length) return j({ error: 'already started', data: cur }, 409);
          // Setup is locked after the start: day/time, courts, format, seeding, DUPR balance, pairs/teams.
          for (const f of ['date', 'courts', 'courtSet', 'format', 'seeding', 'balanceDupr', 'teams', 'club', 'trophy', 'clubName'] as const)
            if (f in body.data && JSON.stringify(body.data[f]) !== JSON.stringify(cur[f])) return j({ error: 'locked', field: f, data: cur }, 409);
          // Roster is locked after the start: nobody added, dropped or re-added.
          if (ids(body.data.players) !== ids(cur.players)) return j({ error: 'started', field: 'players', data: cur }, 409);
          if (ids(body.data.active) !== ids(cur.active)) return j({ error: 'started', field: 'active', data: cur }, 409);
          // Only the host (who tapped Start) can end/reopen the game or change the number of rounds. Older games with no starter are unchanged.
          // The creator's phone (org=1) counts as the starter when the game was started as 'organizer' (it may also have joined as a player).
          const isStarter = by === cur.startedBy || (cur.startedBy === 'organizer' && url.searchParams.get('org') === '1');
          // Subs (approved exception to the locked roster): only the starter can add/undo them; entries must name players in the game.
          if (JSON.stringify(body.data.subs || []) !== JSON.stringify(cur.subs || [])) {
            if (cur.startedBy && !isStarter) return j({ error: 'host only', field: 'subs', data: cur }, 409);
            if (!validSubs(body.data.subs, new Set((cur.players || []).map(p => p.id)))) return j({ error: 'bad subs', data: cur }, 409);
          }
          if (cur.startedBy && !isStarter) {
            if (!!body.data.finished !== !!cur.finished) return j({ error: 'host only', field: 'finished', data: cur }, 409);
            if (body.data.totalRounds !== cur.totalRounds) return j({ error: 'host only', field: 'totalRounds', data: cur }, 409);
          }
          for (const f of ['startedAt', 'startedBy', 'host'] as const) if (cur[f] !== undefined) body.data[f] = cur[f];
        } else if (body.data && !(body.data.rounds || []).length && overCap(cur, body.data)) {
          // Before the start: no joining once the signed-up count reaches the cap. Drop outs / removals reopen spots.
          return j({ error: 'full', max: capOf(cur ?? body.data), data: cur }, 409);
        } else if (body.data && !(body.data.rounds || []).length && dupCount(body.data) > (cur ? dupCount(cur) : 0)) {
          // Before the start: no two players with the same name (trimmed, case-insensitive). Existing duplicates are left alone so they can be removed.
          return j({ error: 'duplicate name', data: cur }, 409);
        } else if (body.data && (body.data.rounds || []).length > 0) {
          // Starting: exactly 4, 8, 12 or 16 players.
          const n = new Set(body.data.active || []).size;
          if (body.data.format === 'club') {
            // Club vs Club: exactly N home + N visiting teams of 2 (empty visitor spots become guests at the start).
            const c = body.data.club; const N = c?.n;
            if (!Number.isInteger(N) || N < 1 || N > 8 || n !== 4 * N || body.data.courts !== N || (c.homeTeams || []).length !== N || (c.awayTeams || []).length !== N) return j({ error: 'club teams incomplete', players: n, data: cur }, 409);
          } else if (![4, 8, 12, 16].includes(n)) return j({ error: 'need 4, 8, 12 or 16 players', players: n, data: cur }, 409);
          if (overCap(cur, body.data)) return j({ error: 'full', max: capOf(cur ?? body.data), data: cur }, 409);
          // The starter must be someone in the game (a removed player's phone can't start as a ghost); otherwise the creator's phone ('organizer').
          const pids = new Set((body.data.players || []).map((p: { id: string }) => p.id));
          for (const f of ['startedBy', 'host'] as const) if (body.data[f] && body.data[f] !== 'organizer' && !pids.has(body.data[f])) body.data[f] = 'organizer';
        }
        const { rows } = await pool.query('insert into events(code,data) values($1,$2) on conflict(code) do update set data=excluded.data, version=events.version+1, updated_at=now() returning version, updated_at', [code, JSON.stringify(body.data)]);
        if (body.data) { await ensureStats(); await addClub(body.data.clubName, !!body.data.hidden).catch(() => {}); if (body.data.format === 'club') { await addClub(body.data.club?.home, !!body.data.hidden).catch(() => {}); await addClub(body.data.club?.away, !!body.data.hidden).catch(() => {}); } }
        let stats = 'ok'; try { if (body.data?.finished) await syncStats(code, body.data); else { await ensureStats(); await pool.query('delete from stat_matches where code=$1', [code]); await pool.query('delete from trophies where code=$1', [code]); } } catch (e) { stats = String(e); }
        return j({ ...rows[0], stats });
      }
      if (req.method === 'DELETE') {
        // Creator cancels a game that has not started. A started game can never be deleted this way.
        const cur = (await pool.query('select data from events where code=$1', [code])).rows[0]?.data as Ev | undefined;
        if (!cur) return j({ error: 'not found' }, 404);
        if ((cur.rounds || []).length > 0) return j({ error: 'started' }, 409);
        await pool.query("delete from events where code=$1 and jsonb_array_length(coalesce(data->'rounds','[]'::jsonb))=0", [code]);
        return j({ ok: true, deleted: code });
      }
      return j({ error: 'method' }, 405);
    } catch (e) { return j({ error: String(e) }, 500); }
  },
};
