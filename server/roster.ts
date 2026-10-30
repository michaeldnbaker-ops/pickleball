/** After the start: who may change the roster, and what must stay put. */
export interface RP { id?: unknown; name?: unknown }
export interface RM { a?: unknown; b?: unknown; sa?: unknown; sb?: unknown; court?: unknown }
export interface RR { n?: unknown; matches?: RM[]; byes?: unknown; playoff?: unknown }
export interface REv { format?: unknown; players?: RP[]; active?: unknown; rounds?: RR[]; plan?: RR[] }

const norm = (s: unknown) => (typeof s === 'string' ? s : '').trim().replace(/\s+/g, ' ').toLowerCase();
const idOf = (x: unknown) => typeof x === 'string' ? x : (x && typeof x === 'object' && typeof (x as RP).id === 'string' ? (x as RP).id as string : '');
const idList = (xs: unknown) => Array.isArray(xs) ? xs.map(idOf).filter(Boolean) : [];
const locked = (r: RR) => (r.matches || []).some(m => m.sa != null || m.sb != null);
/** Who plays, and where. Scores are left out so a save can change points without moving people. */
const shell = (rs?: RR[]) => JSON.stringify((rs || []).map(r => ({
  n: r.n, playoff: !!r.playoff, byes: r.byes || [],
  matches: (r.matches || []).map(m => ({ court: m.court, a: m.a, b: m.b })),
})));
const playedIds = (ev: REv) => {
  const s = new Set<string>();
  for (const r of ev.rounds || []) {
    for (const id of idList(r.byes)) s.add(id);
    for (const m of r.matches || []) for (const id of [...idList(m.a), ...idList(m.b)]) s.add(id);
  }
  return s;
};

/**
 * A started game may gain or lose players. Rounds already begun — including the one in progress —
 * stay as saved. Only the host may remove someone. Anyone may add exactly one new player (the join
 * link). Club vs Club and playoffs stay fixed. A player who already played stays on the roster so
 * their score keeps a name.
 */
export function rosterWrite(cur: REv, next: REv, host: boolean): { error?: string } {
  const curP = new Map((cur.players || []).flatMap(p => { const id = idOf(p); return id ? [[id, p] as const] : []; }));
  const nextP = new Map((next.players || []).flatMap(p => { const id = idOf(p); return id ? [[id, p] as const] : []; }));
  const curA = new Set(idList(cur.active));
  const nextA = idList(next.active);
  const nextAS = new Set(nextA);
  const added = [...nextP.keys()].filter(id => !curP.has(id));
  const removedP = [...curP.keys()].filter(id => !nextP.has(id));
  const removedA = [...curA].filter(id => !nextAS.has(id));
  const addedA = nextA.filter(id => !curA.has(id));
  let edited = false;
  for (const [id, p] of curP) { const n = nextP.get(id); if (n && norm(p.name) !== norm(n.name)) edited = true; }
  if (!added.length && !removedP.length && !removedA.length && !addedA.length && !edited) {
    // Scores on a round already on court may change, and the next round may be appended.
    // Who is already on court may not move. A scored play-ahead round keeps its matchups
    // unless the plan is cleared (the game is ending).
    const curR = cur.rounds || [], nextR = next.rounds || [];
    if (nextR.length < curR.length) return { error: 'round locked' };
    for (let i = 0; i < curR.length; i++) if (shell([curR[i]]) !== shell([nextR[i]])) return { error: 'round locked' };
    if (next.plan) {
      const kept = [...next.plan, ...nextR.slice(curR.length)];
      for (const r of (cur.plan || []).filter(locked)) {
        if (!kept.some(n => shell([r]) === shell([n]))) return { error: 'round locked' };
      }
    }
    return {};
  }
  if (cur.format === 'club' || next.format === 'club') return { error: 'club locked' };
  if ((cur.rounds || []).some(r => r.playoff) || (next.rounds || []).some(r => r.playoff)) return { error: 'playoffs' };
  if (JSON.stringify(cur.rounds || []) !== JSON.stringify(next.rounds || [])) return { error: 'round locked' };
  for (const i of (cur.plan || []).map((r, n) => locked(r) ? n : -1).filter(n => n >= 0)) {
    if (JSON.stringify((cur.plan || [])[i]) !== JSON.stringify((next.plan || [])[i])) return { error: 'round locked' };
  }
  if (edited || removedP.some(id => playedIds(cur).has(id))) return { error: 'keep played' };
  const names = nextA.map(id => norm(nextP.get(id)?.name)).filter(Boolean);
  if (names.length !== new Set(names).size) return { error: 'duplicate name' };
  for (const id of added) {
    const name = typeof nextP.get(id)?.name === 'string' ? (nextP.get(id)!.name as string).trim().replace(/\s+/g, ' ') : '';
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(id) || !name || name.length > 40) return { error: 'bad player' };
  }
  if (nextA.some(id => !nextP.has(id))) return { error: 'bad player' };
  const pureJoin = added.length === 1 && addedA.length === 1 && addedA[0] === added[0] && !removedA.length && !removedP.length && !edited;
  if (!host && !pureJoin) return { error: 'host only' };
  for (const r of next.plan || []) {
    if (locked(r)) continue;
    const ids = [...idList(r.byes), ...(r.matches || []).flatMap(m => [...idList(m.a), ...idList(m.b)])];
    if (ids.some(id => !nextAS.has(id))) return { error: 'plan' };
  }
  return {};
}
