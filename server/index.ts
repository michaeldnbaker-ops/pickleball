import { Pool } from 'pg';
import { closeEvent } from './close';
import { capOf, overCap, validCourtSet, capChange } from './cap';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
pool.on('error', () => {});
const H = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,PUT,DELETE,OPTIONS', 'access-control-allow-headers': 'content-type', 'content-type': 'application/json' };
const j = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: H });

let ready: Promise<unknown> | null = null;
const ensureStats = () => ready ??= pool.query(`create table if not exists stat_matches(
  id text primary key, code text not null, ev_name text, date text, hidden boolean not null default false,
  ak text[] not null, bk text[] not null, an text[] not null, bn text[] not null, sa int not null, sb int not null, updated_at timestamptz not null default now());
  create index if not exists stat_matches_code on stat_matches(code);
  alter table stat_matches add column if not exists excl text[] not null default '{}';`).catch(e => { ready = null; throw e; });

interface M { court: number; a: string[]; b: string[]; sa?: number; sb?: number }
interface R { n: number; matches: M[]; playoff?: boolean }
interface X { slot: string; from: number; name: string | null }
interface Ev { finished?: boolean; totalRounds?: number; active?: string[]; startedAt?: number; startedBy?: string; host?: string; date?: unknown; courts?: unknown; format?: unknown; seeding?: unknown; balanceDupr?: unknown; teams?: string[][]; name?: string; date?: string; hidden?: boolean; maxPlayers?: number; courtSet?: unknown; players?: { id: string; name: string }[]; rounds?: R[]; plan?: R[]; subs?: X[] }
/** Idempotent: one row per (event, round, court); edits update, cleared/voided scores are removed. */
async function syncStats(code: string, ev: Ev) {
  await ensureStats();
  const name = new Map((ev.players || []).map(p => [p.id, (p.name || '').trim()]));
  const rows: unknown[][] = []; let po = 0;
  for (const r of [...(ev.rounds || []), ...(ev.plan || [])]) {
    const tag = r.playoff ? 'p' + (++po) : 'r' + r.n;
    for (const m of r.matches || []) {
      if (m.sa == null || m.sb == null || m.sa === m.sb) continue;
      // Subs: from their round on, a slot's results are credited to the sub; an unnamed Guest is kept out of Overall stats (excl).
      const rn = r.playoff ? 10000 + r.n : r.n; const who = (id: string) => subName(ev.subs, id, rn) ?? (name.get(id) || '?');
      const an = m.a.map(who), bn = m.b.map(who);
      const excl = [...an, ...bn].filter(x => /^guest$/i.test(x.trim())).map(x => x.toLowerCase());
      rows.push([`${code}:${tag}:${m.court}`, code, ev.name || '', ev.date || '', !!ev.hidden, an.map(x => x.toLowerCase()), bn.map(x => x.toLowerCase()), an, bn, m.sa, m.sb, excl]);
    }
  }
  const ids = rows.map(r => r[0] as string);
  await pool.query('delete from stat_matches where code=$1 and not (id = any($2::text[]))', [code, ids]);
  for (const r of rows) await pool.query(`insert into stat_matches(id,code,ev_name,date,hidden,ak,bk,an,bn,sa,sb,excl) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    on conflict(id) do update set ev_name=excluded.ev_name, date=excluded.date, hidden=excluded.hidden, ak=excluded.ak, bk=excluded.bk, an=excluded.an, bn=excluded.bn, sa=excluded.sa, sb=excluded.sb, excl=excluded.excl, updated_at=now()`, r);
}
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
  select lower(x) k, x n, m.sa pf, m.sb pa from unnest(m.an) x union all select lower(x), x, m.sb, m.sa from unnest(m.bn) x) s where (m.hidden = false or $1) and not (s.k = any(m.excl))`;

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
            case when data->>'maxPlayers' in ('4','8','12','16') then (data->>'maxPlayers')::int end as max
          from events where coalesce((data->>'finished')::boolean,false)=false and (coalesce((data->>'hidden')::boolean,false)=false or $2)
            and data->>'date' >= $1 order by data->>'date' asc limit $3`, [from, test, test ? 300 : 50]); // test mode sees more (hidden e2e games pile up)
        return j({ events: rows });
      }
      if (url.pathname === '/past' && req.method === 'GET') {
        // Completed matches, newest first: open one to see its final standings (read-only).
        const { rows } = await pool.query(`select code, data->>'name' as name, data->>'date' as date, data->>'place' as place, data->>'format' as format,
            coalesce(jsonb_array_length(data->'active'),0) as players, jsonb_array_length(coalesce(data->'rounds','[]'::jsonb)) as rounds
          from events where coalesce((data->>'finished')::boolean,false)=true and (coalesce((data->>'hidden')::boolean,false)=false or $1)
          order by data->>'date' desc limit 100`, [test]);
        return j({ events: rows });
      }
      if (url.pathname === '/stats' && req.method === 'GET') {
        await ensureStats();
        const { rows } = await pool.query(`with p as (${PER}) select k, (array_agg(n order by date desc))[1] as name, count(*)::int games, sum((pf>pa)::int)::int wins, sum((pf<pa)::int)::int losses,
          sum(pf)::int pf, sum(pa)::int pa, sum(pf-pa)::int diff, count(distinct code)::int events from p group by k order by wins desc, diff desc, games desc limit 500`, [test]);
        return j({ players: rows });
      }
      if (url.pathname === '/stats/player' && req.method === 'GET') {
        await ensureStats(); const k = (url.searchParams.get('name') || '').trim().toLowerCase();
        const { rows } = await pool.query(`select id, code, ev_name, date, an, bn, sa, sb from stat_matches where ($2 or hidden=false) and ($1 = any(ak) or $1 = any(bk)) and not ($1 = any(excl)) order by date desc, id desc limit 500`, [k, test]);
        return j({ matches: rows });
      }
      const m = url.pathname.match(/^\/e\/([A-Za-z0-9]{4,16})$/);
      if (!m) return j({ ok: true, service: 'pickleball' });
      const code = m[1].toUpperCase();
      if (req.method === 'GET') {
        await purgeStale();
        const { rows } = await pool.query('select data, version, updated_at from events where code=$1', [code]);
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
          for (const f of ['date', 'courts', 'courtSet', 'format', 'seeding', 'balanceDupr', 'teams'] as const)
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
          if (![4, 8, 12, 16].includes(n)) return j({ error: 'need 4, 8, 12 or 16 players', players: n, data: cur }, 409);
          if (overCap(cur, body.data)) return j({ error: 'full', max: capOf(cur ?? body.data), data: cur }, 409);
          // The starter must be someone in the game (a removed player's phone can't start as a ghost); otherwise the creator's phone ('organizer').
          const pids = new Set((body.data.players || []).map((p: { id: string }) => p.id));
          for (const f of ['startedBy', 'host'] as const) if (body.data[f] && body.data[f] !== 'organizer' && !pids.has(body.data[f])) body.data[f] = 'organizer';
        }
        const { rows } = await pool.query('insert into events(code,data) values($1,$2) on conflict(code) do update set data=excluded.data, version=events.version+1, updated_at=now() returning version, updated_at', [code, JSON.stringify(body.data)]);
        let stats = 'ok'; try { if (body.data?.finished) await syncStats(code, body.data); else { await ensureStats(); await pool.query('delete from stat_matches where code=$1', [code]); } } catch (e) { stats = String(e); }
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
