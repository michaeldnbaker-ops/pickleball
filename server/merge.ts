import { applyNameMerge, chooseKeptName, duplicatePairs, normPerson, sourceOf, type AliasWhy, type MergeEv, type NameUse } from '../src/engine/names';

type Row = Record<string, unknown>;
export interface Db {
  query(sql: string, params?: unknown[]): Promise<{ rows: Row[]; rowCount?: number | null }>;
  connect(): Promise<Db & { release(): void }>;
}

const normSql = `lower(trim(regexp_replace(coalesce(p->>'name',''), '\\s+', ' ', 'g')))`;

async function namesIn(db: Db, test: boolean): Promise<string[]> {
  const { rows } = await db.query(`select distinct trim(p->>'name') as name from events e, lateral jsonb_array_elements(coalesce(e.data->'players','[]'::jsonb)) p
    where coalesce((e.data->>'hidden')::boolean, false) = $1 or $1
    union select distinct trim(s->>'name') from events e, lateral jsonb_array_elements(coalesce(e.data->'subs','[]'::jsonb)) s
    where s->>'name' is not null and (coalesce((e.data->>'hidden')::boolean, false) = $1 or $1)`, [test]);
  return rows.map(r => String(r.name || '')).filter(n => n && !/^guest$/i.test(n));
}

async function gamesOf(db: Db, keys: string[]): Promise<Map<string, number>> {
  const { rows } = await db.query(`select lower(trim(x)) k, count(*)::int n from stat_matches m, unnest(m.an || m.bn) x
    where lower(trim(x)) = any($1::text[]) group by 1`, [keys]);
  return new Map(rows.map(r => [String(r.k), Number(r.n)]));
}

async function eventsOf(db: Db, keys: string[]) {
  const { rows } = await db.query(`select code, data from events e where exists (
      select 1 from jsonb_array_elements(coalesce(e.data->'players','[]'::jsonb)) p where ${normSql} = any($1::text[])
    ) or exists (
      select 1 from jsonb_array_elements(coalesce(e.data->'subs','[]'::jsonb)) s
      where lower(trim(regexp_replace(coalesce(s->>'name',''), '\\s+', ' ', 'g'))) = any($1::text[])
    )`, [keys]);
  return rows as { code: string; data: MergeEv & { hidden?: boolean } }[];
}

function usesFrom(rows: { data: MergeEv }[], games: Map<string, number>, keys: string[]): NameUse[] {
  const by = new Map<string, NameUse>();
  for (const row of rows) for (const p of row.data.players || []) {
    const k = normPerson(p.name || ''); if (!keys.includes(k)) continue;
    const src = sourceOf(row.data, p);
    const cur = by.get(k) || { name: (p.name || '').trim(), src, games: games.get(k) || 0 };
    if (src === 'self' || (src === '' && cur.src === 'host')) cur.src = src;
    by.set(k, cur);
  }
  for (const k of keys) if (!by.has(k)) by.set(k, { name: k, src: '', games: games.get(k) || 0 });
  return [...by.values()];
}

export async function previewMerge(db: Db, names: string[]) {
  const keys = [...new Set(names.map(normPerson).filter(Boolean))];
  if (keys.length < 2) return { error: 'need two names' as const };
  if (keys.length > 6 || names.some(n => n.length > 40)) return { error: 'bad name' as const };
  const rows = await eventsOf(db, keys);
  const kept = chooseKeptName(usesFrom(rows, await gamesOf(db, keys), keys));
  if (!kept.name) return { error: 'need two names' as const };
  return { kept: kept.name, why: kept.why, events: rows.map(r => r.code), keys };
}

export async function listDupes(db: Db, test: boolean) {
  const pairs = duplicatePairs(await namesIn(db, test));
  const out: { a: string; b: string; why: AliasWhy; kept: string; reason: string }[] = [];
  for (const p of pairs) {
    const plan = await previewMerge(db, [p.a, p.b]);
    if (plan.error || !plan.kept) continue;
    out.push({ a: p.a, b: p.b, why: p.why, kept: plan.kept, reason: plan.why });
  }
  return out;
}

/** Back up the rows, then rewrite stored games onto one spelling and rebuild their stats. */
export async function mergePlayers(pool: Db, names: string[], confirm: boolean, sync: (code: string, ev: MergeEv) => Promise<void>) {
  const plan = await previewMerge(pool, names);
  if (plan.error) return { status: 400, body: { error: plan.error } };
  if (!confirm) return { status: 200, body: { preview: true, kept: plan.kept, why: plan.why, events: plan.events } };
  const rows = await eventsOf(pool, plan.keys!);
  for (const row of rows) {
    const copy = JSON.parse(JSON.stringify(row.data)) as MergeEv;
    const applied = applyNameMerge(copy, names, plan.kept!);
    if (applied.error) return { status: 409, body: { error: applied.error, code: row.code } };
  }
  const codes = rows.map(r => r.code);
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query(`create table if not exists name_merge_backup (
      id bigserial primary key, at timestamptz not null default now(), kept text not null, names text[] not null,
      reason text not null, hidden boolean not null default false, events jsonb not null, stats jsonb not null, trophies jsonb not null, icons jsonb not null)`);
    const stats = codes.length ? await c.query('select * from stat_matches where code = any($1::text[])', [codes]) : { rows: [] };
    const trophies = await c.query('select * from trophies where code = any($1::text[]) or k = any($2::text[])', [codes, plan.keys]);
    const icons = await c.query('select * from player_icons where k = any($1::text[])', [plan.keys]);
    const hidden = rows.length > 0 && rows.every(r => !!r.data.hidden);
    await c.query('insert into name_merge_backup(kept, names, reason, hidden, events, stats, trophies, icons) values($1,$2,$3,$4,$5,$6,$7,$8)',
      [plan.kept, names, plan.why, hidden, JSON.stringify(rows.map(r => ({ code: r.code, data: r.data }))), JSON.stringify(stats.rows), JSON.stringify(trophies.rows), JSON.stringify(icons.rows)]);
    for (const row of rows) {
      const data = JSON.parse(JSON.stringify(row.data)) as MergeEv;
      applyNameMerge(data, names, plan.kept!);
      await c.query('update events set data=$2, version=version+1, updated_at=now() where code=$1', [row.code, JSON.stringify(data)]);
      row.data = data as typeof row.data;
    }
    const keptKey = normPerson(plan.kept!);
    for (const k of plan.keys!.filter(key => key !== keptKey)) {
      await c.query('update player_icons set k=$2, updated_at=now() where k=$1 and not exists (select 1 from player_icons x where x.k=$2)', [k, keptKey]);
      await c.query('delete from player_icons where k=$1 and k <> $2', [k, keptKey]);
    }
    await c.query('commit');
  } catch (e) { await c.query('rollback'); throw e; } finally { c.release(); }
  for (const row of rows) await sync(row.code, row.data);
  return { status: 200, body: { ok: true, kept: plan.kept, why: plan.why, events: codes } };
}
