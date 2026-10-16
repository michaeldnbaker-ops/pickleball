// Original pairing engine (no third-party code).
export type Gender = 'M' | 'F' | undefined;
export interface Player { id: string; name: string; dupr?: number; gender?: Gender }
export type Format = 'rotating' | 'mixer' | 'mixed' | 'fixed' | 'kotc' | 'ladder' | 'team';
export interface Match { court: number; a: string[]; b: string[]; sa?: number; sb?: number; team?: [string, string] }
export interface Round { n: number; matches: Match[]; byes: string[]; playoff?: boolean }
export interface EventT {
  id: string; name: string; date: string; place: string; format: Format;
  courts: number; totalRounds: number; balanceDupr: boolean; seeding: 'random' | 'dupr';
  players: Player[]; active: string[];
  teams: string[][]; // fixed partners (pairs) or team format (4s)
  rounds: Round[]; createdAt: number; finished?: boolean;
}
export type Rng = () => number;
export function mulberry(seed: number): Rng {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function shuffle<T>(arr: T[], rng: Rng): T[] { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const key = (x: string, y: string) => (x < y ? x + '|' + y : y + '|' + x);
export const scored = (m: Match) => m.sa != null && m.sb != null && m.sa !== m.sb;

export interface History { partner: Map<string, number>; opp: Map<string, number>; byes: Map<string, number>; games: Map<string, number>; lastBye: Map<string, number> }
export function history(rounds: Round[]): History {
  const h: History = { partner: new Map(), opp: new Map(), byes: new Map(), games: new Map(), lastBye: new Map() };
  const inc = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) || 0) + 1);
  for (const r of rounds) {
    if (r.playoff) continue;
    for (const p of r.byes) { inc(h.byes, p); h.lastBye.set(p, r.n); }
    for (const m of r.matches) {
      for (const t of [m.a, m.b]) { for (const p of t) inc(h.games, p); for (let i = 0; i < t.length; i++) for (let j = i + 1; j < t.length; j++) inc(h.partner, key(t[i], t[j])); }
      for (const x of m.a) for (const y of m.b) inc(h.opp, key(x, y));
    }
  }
  return h;
}

/** Choose who sits out: fewest byes first, then most games, then longest since last bye, random tiebreak. */
export function pickByes(ids: string[], sitCount: number, h: History, rng: Rng): string[] {
  if (sitCount <= 0) return [];
  const scoredIds = shuffle(ids, rng).map(id => ({ id, b: h.byes.get(id) || 0, g: h.games.get(id) || 0, l: h.lastBye.get(id) ?? -1 }));
  scoredIds.sort((x, y) => x.b - y.b || y.g - x.g || x.l - y.l);
  return scoredIds.slice(0, sitCount).map(s => s.id);
}

function playingSlots(n: number, courts: number, unit: number) { return Math.min(courts, Math.floor(n / unit)) * unit; }

interface Ctx { h: History; dupr: Map<string, number>; gender: Map<string, Gender>; balance: boolean; mixedOnly: boolean; noise: number; rng: Rng }
function teamCost(t: string[], c: Ctx) {
  let s = 0;
  for (let i = 0; i < t.length; i++) for (let j = i + 1; j < t.length; j++) s += 100 * (c.h.partner.get(key(t[i], t[j])) || 0) ** 2;
  if (c.mixedOnly && t.length === 2 && c.gender.get(t[0]) && c.gender.get(t[0]) === c.gender.get(t[1])) s += 1000;
  return s;
}
function matchCost(a: string[], b: string[], c: Ctx) {
  let s = teamCost(a, c) + teamCost(b, c);
  for (const x of a) for (const y of b) s += 10 * (c.h.opp.get(key(x, y)) || 0) ** 2;
  if (c.balance) { const sum = (t: string[]) => t.reduce((q, p) => q + (c.dupr.get(p) ?? 3.5), 0); s += 20 * Math.abs(sum(a) - sum(b)); }
  return s + c.noise * c.rng();
}
const SPLITS = [[[0, 1], [2, 3]], [[0, 2], [1, 3]], [[0, 3], [1, 2]]];
function bestSplit(g: string[], c: Ctx) {
  let best: { a: string[]; b: string[]; cost: number } | null = null;
  for (const [x, y] of SPLITS) { const a = x.map(i => g[i]), b = y.map(i => g[i]); const cost = matchCost(a, b, c); if (!best || cost < best.cost) best = { a, b, cost }; }
  return best!;
}

/** Rotating-partner doubles: random restarts + pairwise swap improvement. */
export function rotatingRound(players: string[], courts: number, c: Ctx, iters = 300): Match[] {
  const n = players.length; if (n < 4) return [];
  const evalGroups = (order: string[]) => { let cost = 0; const ms: Match[] = []; for (let i = 0; i + 4 <= order.length; i += 4) { const s = bestSplit(order.slice(i, i + 4), c); cost += s.cost; ms.push({ court: i / 4 + 1, a: s.a, b: s.b }); } return { cost, ms }; };
  let best = evalGroups(shuffle(players, c.rng));
  for (let it = 0; it < iters; it++) {
    let order = shuffle(players, c.rng); let cur = evalGroups(order);
    for (let pass = 0; pass < 2; pass++) for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      if (Math.floor(i / 4) === Math.floor(j / 4)) continue;
      const o2 = order.slice(); [o2[i], o2[j]] = [o2[j], o2[i]]; const e = evalGroups(o2); if (e.cost < cur.cost) { order = o2; cur = e; }
    }
    if (cur.cost < best.cost) best = cur;
    if (best.cost < 1) break;
    if (n > 24 && it > 20) break;
  }
  return best.ms.slice(0, courts);
}

/** Set partners / teams: pair units, minimizing repeat opponents. */
function unitRound(units: string[][], c: Ctx): [string[], string[]][] {
  const k = (u: string[]) => u.join('+');
  const oppCount = (x: string[], y: string[]) => x.reduce((s, p) => s + y.reduce((q, r) => q + (c.h.opp.get(key(p, r)) || 0), 0), 0);
  let best: { pairs: [string[], string[]][]; cost: number } | null = null;
  for (let it = 0; it < 200; it++) {
    const o = shuffle(units, c.rng); const pairs: [string[], string[]][] = []; let cost = 0;
    for (let i = 0; i + 1 < o.length; i += 2) { pairs.push([o[i], o[i + 1]]); cost += oppCount(o[i], o[i + 1]) ** 2; if (c.balance) cost += Math.abs(o[i].reduce((s, p) => s + (c.dupr.get(p) ?? 3.5), 0) - o[i + 1].reduce((s, p) => s + (c.dupr.get(p) ?? 3.5), 0)); }
    if (!best || cost < best.cost) best = { pairs, cost };
    if (cost === 0) break;
  }
  void k; return best!.pairs;
}

export interface Standing { id: string; name: string; w: number; l: number; gp: number; pf: number; pa: number; diff: number; byes: number }
export function standings(ev: EventT, includePlayoff = false): Standing[] {
  const map = new Map<string, Standing>();
  for (const p of ev.players) map.set(p.id, { id: p.id, name: p.name, w: 0, l: 0, gp: 0, pf: 0, pa: 0, diff: 0, byes: 0 });
  for (const r of ev.rounds) {
    if (r.playoff && !includePlayoff) continue;
    for (const b of r.byes) { const s = map.get(b); if (s) s.byes++; }
    for (const m of r.matches) {
      if (!scored(m)) continue;
      const add = (t: string[], f: number, a: number) => t.forEach(p => { const s = map.get(p); if (!s) return; s.gp++; s.pf += f; s.pa += a; s.diff += f - a; if (f > a) s.w++; else s.l++; });
      add(m.a, m.sa!, m.sb!); add(m.b, m.sb!, m.sa!);
    }
  }
  return [...map.values()].filter(s => s.gp > 0 || ev.active.includes(s.id)).sort((x, y) => y.w - x.w || y.diff - x.diff || y.pf - x.pf || x.name.localeCompare(y.name));
}
export function teamStandings(ev: EventT) {
  const ind = new Map(standings(ev).map(s => [s.id, s]));
  return ev.teams.map((t, i) => {
    const r = { id: 'T' + (i + 1), name: t.map(id => ev.players.find(p => p.id === id)?.name || '?').join(' / '), w: 0, l: 0, pf: 0, pa: 0, diff: 0 };
    for (const rd of ev.rounds) for (const m of rd.matches) if (scored(m) && (m.a.every(p => t.includes(p)) || m.b.every(p => t.includes(p)))) {
      const mine = m.a.every(p => t.includes(p)); const f = mine ? m.sa! : m.sb!, a = mine ? m.sb! : m.sa!; r.pf += f; r.pa += a; r.diff += f - a; if (f > a) r.w++; else r.l++;
    }
    void ind; return r;
  }).sort((x, y) => y.w - x.w || y.diff - x.diff);
}

/** Generate the next round for any format. */
export function nextRound(ev: EventT, rng: Rng = Math.random): Round {
  const n = ev.rounds.filter(r => !r.playoff).length + 1;
  const h = history(ev.rounds);
  const dupr = new Map(ev.players.map(p => [p.id, p.dupr ?? 3.5]));
  const gender = new Map(ev.players.map(p => [p.id, p.gender]));
  const c: Ctx = { h, dupr, gender, balance: ev.balanceDupr, mixedOnly: ev.format === 'mixed', noise: ev.format === 'mixer' ? 60 : 0.5, rng };
  const active = ev.active.filter(id => ev.players.some(p => p.id === id));

  if (ev.format === 'fixed' || ev.format === 'team') {
    const size = ev.format === 'fixed' ? 2 : 4;
    const units = ev.teams.filter(t => t.length === size && t.every(p => active.includes(p)));
    const perMatchCourts = ev.format === 'team' ? 2 : 1;
    const maxMatches = Math.min(Math.floor(ev.courts / perMatchCourts), Math.floor(units.length / 2));
    const unitIds = units.map(u => u.join('+'));
    const unitH: History = { ...h, byes: new Map(units.map(u => [u.join('+'), Math.min(...u.map(p => h.byes.get(p) || 0))])), games: new Map(units.map(u => [u.join('+'), Math.max(...u.map(p => h.games.get(p) || 0))])), lastBye: new Map() };
    const sitU = new Set(pickByes(unitIds, units.length - maxMatches * 2, unitH, rng));
    const playing = units.filter(u => !sitU.has(u.join('+')));
    const pairs = unitRound(playing, c);
    const matches: Match[] = []; let court = 1;
    for (const [x, y] of pairs) {
      if (size === 2) matches.push({ court: court++, a: x, b: y });
      else { matches.push({ court: court++, a: [x[0], x[1]], b: [y[0], y[1]], team: [x.join('+'), y.join('+')] }); matches.push({ court: court++, a: [x[2], x[3]], b: [y[2], y[3]], team: [x.join('+'), y.join('+')] }); }
    }
    const playingSet = new Set(matches.flatMap(m => [...m.a, ...m.b]));
    return { n, matches, byes: active.filter(p => !playingSet.has(p)) };
  }

  const slots = playingSlots(active.length, ev.courts, 4);
  const byes = pickByes(active, active.length - slots, h, rng);
  const playing = active.filter(p => !byes.includes(p));

  if (ev.format === 'kotc' || ev.format === 'ladder') {
    let order: string[];
    const prev = [...ev.rounds].reverse().find(r => !r.playoff);
    if (!prev) order = ev.seeding === 'dupr' ? [...playing].sort((a, b) => (dupr.get(b)! - dupr.get(a)!)) : shuffle(playing, rng);
    else if (ev.format === 'ladder') {
      const rank = standings(ev).map(s => s.id); order = [...playing].sort((a, b) => { const ia = rank.indexOf(a), ib = rank.indexOf(b); return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib) || dupr.get(b)! - dupr.get(a)!; });
    } else {
      // Up and down the river: winners move up one court, losers down one.
      const pos = new Map<string, number>(); const C = prev.matches.length;
      for (const m of prev.matches) {
        const top = m.court - 1; let win = m.a, lose = m.b; if (scored(m) && m.sb! > m.sa!) { win = m.b; lose = m.a; }
        const up = Math.max(0, top - 1), down = Math.min(C - 1, top + 1);
        win.forEach((p, i) => pos.set(p, up * 10 + (top === 0 ? 0 : 2) + i));
        lose.forEach((p, i) => pos.set(p, down * 10 + (top === C - 1 ? 2 : 0) + 4 + i));
      }
      order = [...playing].sort((a, b) => (pos.get(a) ?? 1e6) - (pos.get(b) ?? 1e6));
      // returning bye players fill in where vacated (bottom) — fine and fair
    }
    const matches: Match[] = [];
    for (let i = 0; i + 4 <= order.length; i += 4) { const s = bestSplit(order.slice(i, i + 4), { ...c, balance: true, noise: 0.1 }); matches.push({ court: i / 4 + 1, a: s.a, b: s.b }); }
    return { n, matches, byes };
  }
  return { n, matches: rotatingRound(playing, ev.courts, c), byes };
}

/** Playoffs: single elimination. Individual formats form seeded pairs (1+8, 2+7, ...). */
export function nextPlayoffRound(ev: EventT): Round | null {
  const po = ev.rounds.filter(r => r.playoff);
  const n = ev.rounds.length + 1;
  if (po.length === 0) {
    let seeds: string[][];
    if (ev.format === 'fixed' || ev.format === 'team') {
      const ts = teamStandings(ev); seeds = ts.slice(0, ts.length >= 4 ? 4 : 2).map(t => ev.teams[Number(t.id.slice(1)) - 1].slice(0, 2));
    } else {
      const st = standings(ev).filter(s => ev.active.includes(s.id)).map(s => s.id);
      const k = st.length >= 8 ? 8 : 4; if (st.length < 4) return null; const top = st.slice(0, k);
      seeds = []; for (let i = 0; i < k / 2; i++) seeds.push([top[i], top[k - 1 - i]]);
    }
    const matches: Match[] = [];
    for (let i = 0; i < seeds.length / 2; i++) matches.push({ court: i + 1, a: seeds[i], b: seeds[seeds.length - 1 - i] });
    return { n, matches, byes: [], playoff: true };
  }
  const last = po[po.length - 1];
  if (last.matches.length <= 1 || !last.matches.every(scored)) return null;
  const winners = last.matches.map(m => (m.sa! > m.sb! ? m.a : m.b));
  const matches: Match[] = []; for (let i = 0; i + 1 < winners.length; i += 2) matches.push({ court: i / 2 + 1, a: winners[i], b: winners[i + 1] });
  return { n, matches, byes: [], playoff: true };
}

/** Regenerate the latest round if no scores have been entered (after roster/court change). */
/** Courts in a round that have no valid (non-tied) score yet. */
export function unscoredCourts(r: Round | undefined): number[] { return r ? r.matches.filter(m => !scored(m)).map(m => m.court) : []; }
export function canRegenerate(ev: EventT) { const r = ev.rounds[ev.rounds.length - 1]; return !!r && !r.playoff && !r.matches.some(m => m.sa != null || m.sb != null); }

export function toCSV(ev: EventT) {
  const nm = (id: string) => ev.players.find(p => p.id === id)?.name || id;
  const rows = [['Round', 'Court', 'Team A', 'Team B', 'Score A', 'Score B']];
  for (const r of ev.rounds) for (const m of r.matches) rows.push([String(r.playoff ? 'Playoff ' + r.n : r.n), String(m.court), m.a.map(nm).join(' & '), m.b.map(nm).join(' & '), String(m.sa ?? ''), String(m.sb ?? '')]);
  return rows.map(r => r.map(x => '"' + x.replace(/"/g, '""') + '"').join(',')).join('\n');
}
