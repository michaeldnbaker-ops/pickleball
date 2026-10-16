import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
pool.on('error', () => {});
const H = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,PUT,OPTIONS', 'access-control-allow-headers': 'content-type', 'content-type': 'application/json' };
const j = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: H });

let ready: Promise<unknown> | null = null;
const ensureStats = () => ready ??= pool.query(`create table if not exists stat_matches(
  id text primary key, code text not null, ev_name text, date text, hidden boolean not null default false,
  ak text[] not null, bk text[] not null, an text[] not null, bn text[] not null, sa int not null, sb int not null, updated_at timestamptz not null default now());
  create index if not exists stat_matches_code on stat_matches(code);`).catch(e => { ready = null; throw e; });

interface M { court: number; a: string[]; b: string[]; sa?: number; sb?: number }
interface R { n: number; matches: M[]; playoff?: boolean }
interface Ev { name?: string; date?: string; hidden?: boolean; players?: { id: string; name: string }[]; rounds?: R[]; plan?: R[] }
/** Idempotent: one row per (event, round, court); edits update, cleared/voided scores are removed. */
async function syncStats(code: string, ev: Ev) {
  await ensureStats();
  const name = new Map((ev.players || []).map(p => [p.id, (p.name || '').trim()]));
  const rows: unknown[][] = []; let po = 0;
  for (const r of [...(ev.rounds || []), ...(ev.plan || [])]) {
    const tag = r.playoff ? 'p' + (++po) : 'r' + r.n;
    for (const m of r.matches || []) {
      if (m.sa == null || m.sb == null || m.sa === m.sb) continue;
      const an = m.a.map(id => name.get(id) || '?'), bn = m.b.map(id => name.get(id) || '?');
      rows.push([`${code}:${tag}:${m.court}`, code, ev.name || '', ev.date || '', !!ev.hidden, an.map(x => x.toLowerCase()), bn.map(x => x.toLowerCase()), an, bn, m.sa, m.sb]);
    }
  }
  const ids = rows.map(r => r[0] as string);
  await pool.query('delete from stat_matches where code=$1 and not (id = any($2::text[]))', [code, ids]);
  for (const r of rows) await pool.query(`insert into stat_matches(id,code,ev_name,date,hidden,ak,bk,an,bn,sa,sb) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    on conflict(id) do update set ev_name=excluded.ev_name, date=excluded.date, hidden=excluded.hidden, ak=excluded.ak, bk=excluded.bk, an=excluded.an, bn=excluded.bn, sa=excluded.sa, sb=excluded.sb, updated_at=now()`, r);
}
const PER = `select k, n, code, date, pf, pa, id from stat_matches m cross join lateral (
  select lower(x) k, x n, m.sa pf, m.sb pa from unnest(m.an) x union all select lower(x), x, m.sb, m.sa from unnest(m.bn) x) s where (m.hidden = false or $1)`;

export default {
  async fetch(req: Request) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: H });
    const url = new URL(req.url);
    const test = url.searchParams.get('test') === '1';
    try {
      if (url.pathname === '/events' && req.method === 'GET') {
        // Public list: unfinished, unhidden events dated from (client-local "from", default now - 1 day) forward, soonest first.
        const from = (url.searchParams.get('from') || '').match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)?.[0] || new Date(Date.now() - 864e5).toISOString().slice(0, 16);
        const { rows } = await pool.query(`select code, data->>'name' as name, data->>'date' as date, data->>'place' as place, data->>'format' as format,
            coalesce(jsonb_array_length(data->'active'),0) as players, jsonb_array_length(coalesce(data->'rounds','[]'::jsonb)) as rounds
          from events where coalesce((data->>'finished')::boolean,false)=false and (coalesce((data->>'hidden')::boolean,false)=false or $2)
            and data->>'date' >= $1 order by data->>'date' asc limit 50`, [from, test]);
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
        const { rows } = await pool.query(`select id, code, ev_name, date, an, bn, sa, sb from stat_matches where ($2 or hidden=false) and ($1 = any(ak) or $1 = any(bk)) order by date desc, id desc limit 500`, [k, test]);
        return j({ matches: rows });
      }
      const m = url.pathname.match(/^\/e\/([A-Za-z0-9]{4,16})$/);
      if (!m) return j({ ok: true, service: 'pickleball' });
      const code = m[1].toUpperCase();
      if (req.method === 'GET') {
        const { rows } = await pool.query('select data, version, updated_at from events where code=$1', [code]);
        return rows[0] ? j(rows[0]) : j({ error: 'not found' }, 404);
      }
      if (req.method === 'PUT') {
        const text = await req.text(); if (text.length > 1_000_000) return j({ error: 'too large' }, 413);
        const body = JSON.parse(text);
        const { rows } = await pool.query('insert into events(code,data) values($1,$2) on conflict(code) do update set data=excluded.data, version=events.version+1, updated_at=now() returning version, updated_at', [code, JSON.stringify(body.data)]);
        let stats = 'ok'; try { await syncStats(code, body.data || {}); } catch (e) { stats = String(e); }
        return j({ ...rows[0], stats });
      }
      return j({ error: 'method' }, 405);
    } catch (e) { return j({ error: String(e) }, 500); }
  },
};
