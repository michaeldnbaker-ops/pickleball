import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
pool.on('error', () => {});
const H = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,PUT,OPTIONS', 'access-control-allow-headers': 'content-type', 'content-type': 'application/json' };
const j = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: H });
export default {
  async fetch(req: Request) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: H });
    const m = new URL(req.url).pathname.match(/^\/e\/([A-Za-z0-9]{4,16})$/);
    if (!m) return j({ ok: true, service: 'pickleball' });
    const code = m[1].toUpperCase();
    try {
      if (req.method === 'GET') {
        const { rows } = await pool.query('select data, version, updated_at from events where code=$1', [code]);
        return rows[0] ? j(rows[0]) : j({ error: 'not found' }, 404);
      }
      if (req.method === 'PUT') {
        const text = await req.text(); if (text.length > 1_000_000) return j({ error: 'too large' }, 413);
        const body = JSON.parse(text);
        const { rows } = await pool.query('insert into events(code,data) values($1,$2) on conflict(code) do update set data=excluded.data, version=events.version+1, updated_at=now() returning version, updated_at', [code, JSON.stringify(body.data)]);
        return j(rows[0]);
      }
      return j({ error: 'method' }, 405);
    } catch (e) { return j({ error: String(e) }, 500); }
  },
};
