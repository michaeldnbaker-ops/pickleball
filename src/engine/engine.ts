// Original pairing engine (no third-party code).
export interface Player { id: string; name: string; dupr?: number; guest?: boolean; side?: 'home' | 'away' } // guest: unnamed visitor (kept out of Overall stats) // any legacy 'gender' field in saved data is ignored
export type Format = 'rotating' | 'mixer' | 'mixed' | 'fixed' | 'kotc' | 'ladder' | 'team' | 'club';
/** Club vs Club: N fixed 2-player teams per club ('' = empty slot before the start). Home team i stays on court slot i; visitors move one court each round. */
export interface Club { home: string; away: string; n: number; homeTeams: string[][]; awayTeams: string[][] }
export interface Match { court: number; a: string[]; b: string[]; sa?: number; sb?: number; team?: [string, string] }
export interface Round { n: number; matches: Match[]; byes: string[]; playoff?: boolean }
export interface EventT {
  /** Entered after the fact with Add past game (closed on save; edit/delete via /past-game). */
  addedLater?: boolean;
  id: string; name: string; date: string; place: string; format: Format;
  courts: number; totalRounds: number; balanceDupr: boolean; seeding: 'random' | 'dupr';
  players: Player[]; active: string[];
  teams: string[][]; // fixed partners (pairs) or team format (4s)
  rounds: Round[]; createdAt: number; finished?: boolean; hidden?: boolean;
  club?: Club;
  subs?: Sub[]; // after the start: someone plays a player's slot from a round on (null name = original back in). Pairings unchanged; results credited to the sub.
  courtSet?: number[]; // courts picked on Create by letter (1=A, 2=B, 4=D…), sorted; length = courts. Missing = A, B, C… (older games)
  maxPlayers?: number; // cap chosen on Create (4/8/12/16); missing = no cap (older games)
  clubName?: string; // stats club (missing = Stone Creek; Club vs Club = home club)
  trophy?: boolean; // Trophy match: 1st place gets a trophy when the game is completed
  startedAt?: number; startedBy?: string; host?: string; // set once by whoever taps Start; setup is locked after this
  plan?: Round[]; planKey?: string; // pre-drawn upcoming rounds (score-independent formats)
}
export type Rng = () => number;
/** A sub plays `slot` (a player id) from regular round `from` on; name null = the original player is back. 'Guest' (or blank) = unnamed guest, kept out of Overall stats. */
export interface Sub { slot: string; from: number; name: string | null; at?: number }
/** Round number for sub purposes: regular rounds by n; playoffs come after every regular round. */
export const subRound = (r: Pick<Round, 'n' | 'playoff'>) => r.playoff ? 10000 + r.n : r.n;
/** Who is in a slot in a round: null = the original player, else the sub's name. */
export function subAt(ev: Pick<EventT, 'subs'>, slot: string, n: number): string | null {
  let cur: Sub | undefined; for (const x of ev.subs || []) if (x.slot === slot && x.from <= n && (!cur || x.from >= cur.from)) cur = x;
  return cur ? (cur.name?.trim() || null) : null;
}
export const isGuest = (name: string) => /^guest$/i.test(name.trim());
/** Display name for a slot in a round, e.g. "Guest (for Steve)". */
export function slotName(ev: Pick<EventT, 'subs' | 'players'>, id: string, n: number) {
  const orig = ev.players.find(p => p.id === id)?.name || '?'; const s = subAt(ev, id, n); return s ? `${s} (for ${orig})` : orig;
}
/** Players per fixed unit: Mixed Doubles and Set Partners use organizer-set pairs, Team Battle uses 4s. */
export const unitSize = (f: Format) => f === 'team' ? 4 : f === 'fixed' || f === 'mixed' ? 2 : 1;
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

interface Ctx { h: History; dupr: Map<string, number>; balance: boolean; noise: number; rng: Rng; iters?: number }
function teamCost(t: string[], c: Ctx) {
  let s = 0;
  for (let i = 0; i < t.length; i++) for (let j = i + 1; j < t.length; j++) s += 100 * (c.h.partner.get(key(t[i], t[j])) || 0) ** 2;
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

function isLockedR(r: Round) { return r.matches.some(m => m.sa != null || m.sb != null); }
export interface Standing { id: string; name: string; w: number; l: number; gp: number; pf: number; pa: number; diff: number; byes: number }
export function standings(ev: EventT, includePlayoff = false): Standing[] {
  const map = new Map<string, Standing>();
  for (const p of ev.players) map.set(p.id, { id: p.id, name: p.name, w: 0, l: 0, gp: 0, pf: 0, pa: 0, diff: 0, byes: 0 });
  for (const r of [...ev.rounds, ...(ev.plan || []).filter(isLockedR)]) { // played-ahead rounds count too
    if (r.playoff && !includePlayoff) continue;
    if (ev.rounds.includes(r)) for (const b of r.byes) { const s = map.get(b); if (s) s.byes++; }
    for (const m of r.matches) {
      if (!scored(m)) continue;
      const rn = subRound(r);
      const add = (t: string[], f: number, a: number) => t.forEach(p0 => { const sn = subAt(ev, p0, rn); const p = sn ? 'sub:' + p0 + ':' + sn.toLowerCase() : p0;
        if (sn && !map.has(p)) map.set(p, { id: p, name: slotName(ev, p0, rn), w: 0, l: 0, gp: 0, pf: 0, pa: 0, diff: 0, byes: 0 });
        const s = map.get(p); if (!s) return; s.gp++; s.pf += f; s.pa += a; s.diff += f - a; if (f > a) s.w++; else s.l++; });
      add(m.a, m.sa!, m.sb!); add(m.b, m.sb!, m.sa!);
    }
  }
  const seen = new Set(ev.rounds.flatMap(r => [...r.byes, ...r.matches.flatMap(m => [...m.a, ...m.b])]));
  return [...map.values()].filter(s => s.gp > 0 || ev.active.includes(s.id) || seen.has(s.id) || ev.rounds.length > 0).sort((x, y) => pct(y.w, y.gp) - pct(x.w, x.gp) || y.diff - x.diff || y.gp - x.gp || x.name.localeCompare(y.name));
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
export function nextRound(ev: EventT, rng: Rng = Math.random, iters?: number): Round {
  const n = ev.rounds.filter(r => !r.playoff).length + 1;
  if (ev.format === 'club' && ev.club) return clubRound(ev.club, n);
  const h = history(ev.rounds);
  const dupr = new Map(ev.players.map(p => [p.id, typeof p.dupr === 'number' && Number.isFinite(p.dupr) ? p.dupr : 3.5]));
  const c: Ctx = { h, dupr, balance: ev.balanceDupr, noise: ev.format === 'mixer' ? 60 : 0.5, rng, iters };
  const active = ev.active.filter(id => ev.players.some(p => p.id === id));

  if (unitSize(ev.format) > 1) {
    const size = unitSize(ev.format);
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
  return { n, matches: rotatingRound(playing, ev.courts, c, c.iters ?? 300), byes };
}

/** Playoffs: single elimination. Individual formats form seeded pairs (1+8, 2+7, ...). */
export function nextPlayoffRound(ev: EventT): Round | null {
  if (ev.format === 'club') return null; // Club vs Club has no playoffs
  const po = ev.rounds.filter(r => r.playoff);
  const n = ev.rounds.length + 1;
  if (po.length === 0) {
    let seeds: string[][];
    if (unitSize(ev.format) > 1) {
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
/** Display-only court label: 1→A, 2→B … 26→Z, 27→AA. Stored court numbers are unchanged. */
export function courtName(n: number): string { let s = ''; for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + (x - 1) % 26) + s; return s || String(n); }
/** The picked courts, or A, B, C… (1..courts) for older games / invalid data. */
export function courtList(ev: Pick<EventT, 'courts' | 'courtSet'>): number[] {
  const cs = ev.courtSet; const ok = Array.isArray(cs) && cs.length === ev.courts && cs.every((x, i) => Number.isInteger(x) && x > 0 && (i === 0 || x > cs[i - 1]));
  return ok ? cs!.slice() : Array.from({ length: ev.courts }, (_, i) => i + 1);
}
/** Label for a match's court slot (1..courts): the picked letter, e.g. slots 1,2,3 → A, B, D. Pairing logic still uses slots (slot 1 = top court). */
export function courtLabel(ev: Pick<EventT, 'courts' | 'courtSet'>, slot: number): string { return courtName(courtList(ev)[slot - 1] ?? slot); }
/** "A–C" for a run from A, else "A, B, D". */
export function courtsText(ev: Pick<EventT, 'courts' | 'courtSet'>): string {
  const l = courtList(ev); if (l.every((x, i) => x === i + 1)) return l.length > 1 ? 'A–' + courtName(l.length) : 'A';
  return l.map(courtName).join(', ');
}
export function unscoredCourts(r: Round | undefined): number[] { return r ? r.matches.filter(m => !scored(m)).map(m => m.court) : []; }
export function canRegenerate(ev: EventT) { const r = ev.rounds[ev.rounds.length - 1]; return !!r && !r.playoff && !r.matches.some(m => m.sa != null || m.sb != null); }

export function toCSV(ev: EventT) {
  const nm = (id: string) => ev.players.find(p => p.id === id)?.name || id;
  const rows = [['Round', 'Court', 'Team A', 'Team B', 'Score A', 'Score B']];
  for (const r of ev.rounds) for (const m of r.matches) rows.push([String(r.playoff ? 'Playoff ' + r.n : r.n), courtLabel(ev, m.court), m.a.map(nm).join(' & '), m.b.map(nm).join(' & '), String(m.sa ?? ''), String(m.sb ?? '')]);
  return rows.map(r => r.map(x => '"' + x.replace(/"/g, '""') + '"').join(',')).join('\n');
}

/** Formats whose pairings depend on results can't be drawn ahead. */
export const resultDependent = (f: Format) => f === 'kotc' || f === 'ladder';
const planKeyOf = (ev: EventT) => [ev.format, ev.courts, ev.totalRounds, ev.balanceDupr, [...ev.active].sort().join(','), ev.teams.map(t => t.join('+')).join('|'), ev.rounds.filter(r => !r.playoff).length].join(';');
/** A previewed round with any score entered is locked (played ahead) and never redrawn. */
export const isLocked = (r: Round) => r.matches.some(m => m.sa != null || m.sb != null);
/** Ensure ev.plan holds the remaining regular rounds (drawn now, so players can see and play them ahead). Locked rounds are kept. Idempotent. */
export function ensurePlan(ev: EventT, rng: Rng = Math.random): boolean {
  if (!ev.rounds.length) return false; // lobby: nothing drawn until the game starts
  if (resultDependent(ev.format) || ev.finished || ev.rounds.some(r => r.playoff)) { const had = !!ev.plan; delete ev.plan; delete ev.planKey; return had; }
  const key = planKeyOf(ev); if (ev.plan && ev.planKey === key) return false;
  const old = ev.plan || [];
  const sim: EventT = JSON.parse(JSON.stringify({ ...ev, plan: undefined })); const plan: Round[] = [];
  const reg = () => sim.rounds.filter(r => !r.playoff).length;
  let k = 0;
  for (; old[k] && isLocked(old[k]); k++) { const r: Round = { ...JSON.parse(JSON.stringify(old[k])), n: reg() + 1 }; sim.rounds.push(r); plan.push(r); }
  // the rest (no scores yet) is drawn as a whole with a multi-start search; a later locked round is kept in place
  while (reg() < sim.totalRounds || old.slice(k).some(isLocked)) {
    const nextLocked = old.findIndex((r, i) => i >= k && isLocked(r));
    const count = nextLocked < 0 ? sim.totalRounds - reg() : nextLocked - k;
    for (const r of searchSchedule(sim, Math.max(0, count), rng)) { const rr = { ...r, n: reg() + 1 }; sim.rounds.push(rr); plan.push(JSON.parse(JSON.stringify(rr))); }
    k += Math.max(0, count);
    if (nextLocked >= 0) { const r: Round = { ...JSON.parse(JSON.stringify(old[nextLocked])), n: reg() + 1 }; sim.rounds.push(r); plan.push(r); k = nextLocked + 1; }
    else break;
  }
  ev.plan = plan; ev.planKey = key; return true;
}
/** Whole-schedule quality: repeat partners weigh most, then repeat opponents, then uneven sit-outs / games (lower is better). */
export function scheduleCost(rounds: Round[], ids: string[]): number {
  const h = history(rounds); let s = 0;
  for (const v of h.partner.values()) s += 1000 * (v - 1) * v / 2;
  for (const v of h.opp.values()) s += 10 * (v - 1) * v / 2;
  const g = ids.map(i => h.games.get(i) || 0); s += 1e5 * Math.max(0, Math.max(...g) - Math.min(...g) - 1);
  return s;
}
/** Polish a schedule by local search: swap players inside a round, or trade a sit-out between two rounds (keeps everyone's game count). Only rounds from `from` on change. */
export function improveSchedule(rounds: Round[], from: number, rng: Rng, iters = 20000): Round[] {
  const ids = [...new Set(rounds.flatMap(r => [...r.byes, ...r.matches.flatMap(m => [...m.a, ...m.b])]))]; const N = ids.length; const ix = new Map(ids.map((x, i) => [x, i]));
  // seat arrays: per round, 4 per court (A0 A1 B0 B1), then byes
  const R = rounds.map(r => ({ seats: r.matches.flatMap(m => [...m.a, ...m.b].map(p => ix.get(p)!)), byes: r.byes.map(p => ix.get(p)!), n: r.n, courts: r.matches.map(m => m.court) }));
  if (R.slice(from).every(r => r.seats.length === 0)) return rounds;
  const P = new Int32Array(N * N), O = new Int32Array(N * N);
  const add = (r: { seats: number[] }, d: number) => { const s = r.seats; for (let c = 0; c < s.length; c += 4) { const [a, b, x, y] = [s[c], s[c + 1], s[c + 2], s[c + 3]]; P[a * N + b] += d; P[b * N + a] += d; P[x * N + y] += d; P[y * N + x] += d; for (const u of [a, b]) for (const v of [x, y]) { O[u * N + v] += d; O[v * N + u] += d; } } };
  R.forEach(r => add(r, 1));
  const tri = (v: number) => (v > 1 ? (v - 1) * v / 2 : 0);
  const byeAdj = () => { let s = 0; for (let i = 1; i < R.length; i++) for (const p of R[i].byes) if (R[i - 1].byes.includes(p)) s++; return s; };
  // sit-outs rotate in order: nobody sits again while someone playing that round has sat out fewer times so far
  const unfair = () => { const cnt = new Int32Array(N); let v = 0; for (let k = 0; k < R.length; k++) { const r = R[k]; if (k >= from && r.byes.length) { let mx = -1, mn = 1e9; for (const p of r.byes) mx = Math.max(mx, cnt[p]); for (const p of r.seats) mn = Math.min(mn, cnt[p]); if (mx > mn) v += mx - mn; } for (const p of r.byes) cnt[p]++; } return v; };
  const cost = () => { let s = 0; for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) s += 1000 * tri(P[i * N + j]) + 10 * tri(O[i * N + j]); return s + byeAdj() + 1e6 * unfair(); };
  let cur = cost(); const span = R.length - from; if (span <= 0) return rounds;
  const pick = () => from + Math.floor(rng() * span);
  for (let it = 0; it < iters && cur > 0; it++) {
    const T = 2 * (1 - it / iters);
    if (rng() < 0.6 || R[from].byes.length === 0) {
      const r = R[pick()]; const L = r.seats.length; if (L < 4) continue;
      const i = Math.floor(rng() * L), j = Math.floor(rng() * L); if (i === j || (i >> 1) === (j >> 1)) continue;
      add(r, -1); [r.seats[i], r.seats[j]] = [r.seats[j], r.seats[i]]; add(r, 1);
      const c = cost(); if (c <= cur || rng() < Math.exp((cur - c) / Math.max(T, 1e-9))) cur = c; else { add(r, -1); [r.seats[i], r.seats[j]] = [r.seats[j], r.seats[i]]; add(r, 1); }
    } else {
      const r1 = R[pick()], r2 = R[pick()]; if (r1 === r2 || !r1.byes.length || !r2.byes.length) continue;
      const x = r1.byes[Math.floor(rng() * r1.byes.length)], y = r2.byes[Math.floor(rng() * r2.byes.length)]; if (x === y) continue;
      const sx = r2.seats.indexOf(x), sy = r1.seats.indexOf(y); if (sx < 0 || sy < 0) continue; // x plays in r2, y plays in r1
      const swap = () => { add(r1, -1); add(r2, -1); r1.seats[sy] = x; r1.byes[r1.byes.indexOf(x)] = y; r2.seats[sx] = y; r2.byes[r2.byes.indexOf(y)] = x; add(r1, 1); add(r2, 1); };
      const unswap = () => { add(r1, -1); add(r2, -1); r1.seats[sy] = y; r1.byes[r1.byes.indexOf(y)] = x; r2.seats[sx] = x; r2.byes[r2.byes.indexOf(x)] = y; add(r1, 1); add(r2, 1); };
      swap(); const c = cost(); if (c <= cur || rng() < Math.exp((cur - c) / Math.max(T, 1e-9))) cur = c; else unswap();
    }
  }
  return R.map((r, k) => k < from ? rounds[k] : { ...rounds[k], byes: r.byes.map(i => ids[i]), matches: r.courts.map((court, c) => ({ court, a: [ids[r.seats[c * 4]], ids[r.seats[c * 4 + 1]]], b: [ids[r.seats[c * 4 + 2]], ids[r.seats[c * 4 + 3]]] })) });
}
/** Draw `count` more regular rounds for sim (rotating format): a few greedy random restarts, then polish the best whole schedule by local search. */
export function searchSchedule(sim: EventT, count: number, rng: Rng, restarts = sim.active.length > 12 ? 2 : 6): Round[] {
  const ids = sim.active; let best: Round[] = []; let bestCost = Infinity;
  const smart = sim.format === 'rotating' && !sim.balanceDupr;
  const tries = smart ? restarts : 1;
  for (let t = 0; t < tries; t++) {
    const e: EventT = { ...sim, rounds: sim.rounds.slice() }; const out: Round[] = [];
    for (let k = 0; k < count; k++) { const r = nextRound(e, rng, smart ? 30 : undefined); e.rounds.push(r); out.push(r); }
    const cost = scheduleCost(e.rounds.filter(r => !r.playoff), ids);
    if (cost < bestCost) { bestCost = cost; best = out; }
    if (cost === 0) break;
  }
  if (!smart || !best.length) return best;
  const prior = sim.rounds.filter(r => !r.playoff);
  return improveSchedule([...prior, ...best], prior.length, rng).slice(prior.length);
}
/** Advance to the next regular round, using the pre-drawn plan when still valid. */
export function takeNextRound(ev: EventT, rng: Rng = Math.random): Round {
  ensurePlan(ev, rng);
  const fromPlan = ev.plan?.[0];
  const r = fromPlan ?? nextRound(ev, rng);
  ev.rounds.push(r);
  if (fromPlan) { ev.plan = ev.plan!.slice(1); ev.planKey = planKeyOf(ev); } else { delete ev.plan; delete ev.planKey; ensurePlan(ev, rng); }
  return r;
}

/** The unscored current-round match a player is in (what a "drop now" leaves short). */
export function dropImpact(ev: EventT, pid: string): { match: Match | null; subs: string[] } {
  const r = ev.rounds[ev.rounds.length - 1];
  if (!r || ev.finished) return { match: null, subs: [] };
  const match = r.matches.find(m => !scored(m) && (m.a.includes(pid) || m.b.includes(pid))) || null;
  return { match, subs: r.byes.filter(p => p !== pid && ev.active.includes(p)) };
}
export interface DropOpts { when: 'now' | 'next'; fix?: 'replace' | 'void'; sub?: string }
/** Withdraw a player mid-event. Past results stay; unscored future rounds are redrawn. */
export function dropPlayer(ev: EventT, pid: string, o: DropOpts, rng: Rng = Math.random) {
  const r = ev.rounds[ev.rounds.length - 1];
  if (o.when === 'now' && r && !ev.finished) {
    const { match } = dropImpact(ev, pid);
    r.byes = r.byes.filter(p => p !== pid);
    if (match) {
      if (o.fix === 'replace' && o.sub && r.byes.includes(o.sub)) {
        const t = match.a.includes(pid) ? match.a : match.b; t[t.indexOf(pid)] = o.sub;
        r.byes = r.byes.filter(p => p !== o.sub); delete match.sa; delete match.sb;
      } else {
        r.matches = r.matches.filter(m => m !== match);
        r.byes.push(...[...match.a, ...match.b].filter(p => p !== pid));
      }
    }
  }
  ev.active = ev.active.filter(p => p !== pid);
  ensurePlan(ev, rng);
}
/** Bring a withdrawn player back from the next round on. */
export function readdPlayer(ev: EventT, pid: string, rng: Rng = Math.random) { if (!ev.active.includes(pid)) ev.active.push(pid); ensurePlan(ev, rng); }
/** Join / add / drop is open once a game has started, until it is finished, a playoff, or Club vs Club (teams are the matchups). */
export function rosterOpen(ev: Pick<EventT, 'rounds' | 'finished' | 'format'>) {
  return ev.rounds.length > 0 && !ev.finished && ev.format !== 'club' && !ev.rounds.some(r => r.playoff);
}
/** Add someone after the start. They play from the next unplayed round; the round in progress is left alone. */
export function addActivePlayer(ev: EventT, p: Player, rng: Rng = Math.random) {
  if (!rosterOpen(ev)) return false;
  const name = (p.name || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  const key = name.toLowerCase();
  if (!name || ev.players.some(x => x.id === p.id)) return false;
  if (ev.players.some(x => ev.active.includes(x.id) && (x.name || '').trim().replace(/\s+/g, ' ').toLowerCase() === key)) return false;
  const max = [4, 8, 12, 16].includes(Number(ev.maxPlayers)) ? Number(ev.maxPlayers) : 0;
  if (max && new Set(ev.active).size >= max) return false;
  ev.players.push({ ...p, name });
  if (!ev.active.includes(p.id)) ev.active.push(p.id);
  ensurePlan(ev, rng);
  return true;
}

/** Start a lobby event with whoever has joined: form fixed pairs / teams of 4 (snake draft), draw Round 1 and pre-draw the rest. */
export function startEvent(ev: EventT, rng: Rng = Math.random) {
  if (ev.rounds.length) return;
  if (ev.format === 'club' && ev.club) { fillClub(ev); const ids = clubIds(ev.club); ev.active = ids; ev.teams = [...ev.club.homeTeams, ...ev.club.awayTeams].map(t => t.slice()); ev.courts = ev.club.n; }
  const unit = unitSize(ev.format);
  if (unit > 1) {
    // keep the organizer's preset pairs/teams (complete, all still in), auto-form the rest
    const used = new Set<string>(); const preset = (ev.teams || []).filter(tm => tm.length === unit && tm.every(p => ev.active.includes(p) && !used.has(p)) && (tm.forEach(p => used.add(p)), true));
    const ps = ev.players.filter(p => ev.active.includes(p.id) && !used.has(p.id));
    const order = ev.seeding === 'dupr' || ev.balanceDupr ? [...ps].sort((a, b) => (b.dupr ?? 3.5) - (a.dupr ?? 3.5)) : shuffle(ps, rng);
    const nT = Math.floor(order.length / unit); const teams: string[][] = Array.from({ length: nT }, () => []);
    order.slice(0, nT * unit).forEach((p, i) => { const r = Math.floor(i / nT), k = i % nT; teams[r % 2 ? nT - 1 - k : k].push(p.id); });
    ev.teams = [...preset, ...teams];
  }
  if (resultDependent(ev.format)) { ev.rounds.push(nextRound(ev, rng)); return; }
  // draw the whole schedule at once (round 1 included) so it is optimized as a set
  const all = searchSchedule(ev, Math.max(1, ev.totalRounds), rng);
  ev.rounds.push(all[0]); ev.plan = all.slice(1).map((r, i) => ({ ...r, n: i + 2 })); ev.planKey = planKeyOf(ev);
}
/** Extend the event by n rounds (from the last round) — new rounds are pre-drawn. */
export function addRounds(ev: EventT, n: number, rng: Rng = Math.random) { ev.totalRounds += Math.max(1, Math.floor(n)); ev.finished = false; ensurePlan(ev, rng); }
/** End: keep every played round (including fully scored play-ahead rounds), drop unplayed ones, mark complete. */
export function endEvent(ev: EventT) {
  for (const r of ev.plan || []) { if (!r.matches.length || !r.matches.every(m => scored(m) && m.sa !== m.sb)) break; ev.rounds.push({ n: r.n, matches: r.matches, byes: r.byes }); }
  ev.finished = true; delete ev.plan; delete ev.planKey;
}

/** A game can start only with exactly 4, 8, 12 or 16 players. */
export const startOk = (n: number) => n === 4 || n === 8 || n === 12 || n === 16;

// ---- Club vs Club ----
/** Round n: home team i (court slot i+1) plays visiting team (i + n - 1) mod N. Pairings never depend on results. */
export function clubRound(c: Club, n: number): Round {
  return { n, matches: c.homeTeams.map((h, i) => ({ court: i + 1, a: h.slice(), b: c.awayTeams[(i + n - 1) % c.n].slice() })), byes: [] };
}
export const clubIds = (c: Club) => [...c.homeTeams, ...c.awayTeams].flat().filter(Boolean);
/** Empty club with N teams per side. */
export const newClub = (home: string, away: string, n: number): Club => ({ home, away, n, homeTeams: Array.from({ length: n }, () => ['', '']), awayTeams: Array.from({ length: n }, () => ['', '']) });
/** Every home slot has a player (visitor slots may be empty: they become guests at the start). */
export const clubReady = (c?: Club) => !!c && c.homeTeams.length === c.n && c.homeTeams.every(t => t.length === 2 && t.every(Boolean));
/** Before the start: empty visitor slots become unnamed guests ("Visitor 2A") so every court has 4. */
export function fillClub(ev: EventT) {
  const c = ev.club; if (!c) return;
  c.awayTeams.forEach((t, i) => t.forEach((id, k) => { if (id) return; const p: Player = { id: 'g' + i + k + Math.random().toString(36).slice(2, 7), name: `${c.away || 'Visitor'} ${i + 1}${'AB'[k]}`, guest: true }; ev.players.push(p); ev.active.push(p.id); t[k] = p.id; }));
}
/** Put a name into a team slot: re-use a joined player with that name who isn't on a team, else add a new player. '' clears the slot. Returns false if the name is already on another team. */
export function setClubSlot(ev: EventT, side: 'home' | 'away', team: number, slot: number, name: string): boolean {
  const c = ev.club; if (!c || ev.rounds.length) return false;
  const teams = side === 'home' ? c.homeTeams : c.awayTeams; const k = normName(name);
  if (!k) { teams[team][slot] = ''; return true; }
  const onTeam = new Set(clubIds(c)); const cur = teams[team][slot];
  const same = ev.players.find(p => normName(p.name) === k && ev.active.includes(p.id));
  if (same && same.id === cur) return true;
  if (same && onTeam.has(same.id)) return false;
  let id = same?.id; if (!id) { id = Math.random().toString(36).slice(2, 10); ev.players.push({ id, name: name.trim().replace(/\s+/g, ' ') }); ev.active.push(id); }
  teams[team][slot] = id; return true;
}
const normName = (s: string) => (s || '').trim().replace(/\s+/g, ' ').toLowerCase();
export interface ClubTeamRow { side: 'home' | 'away'; idx: number; label: string; names: string; w: number; l: number; pf: number; pa: number; diff: number }
/** Per-team W/L/points and club totals (matches won, points). */
export function clubStandings(ev: EventT) {
  const c = ev.club!; const nm = (id: string) => ev.players.find(p => p.id === id)?.name || '?';
  const row = (side: 'home' | 'away', t: string[], i: number): ClubTeamRow => ({ side, idx: i, label: `${side === 'home' ? c.home : c.away} ${i + 1}`, names: t.map(nm).join(' & '), w: 0, l: 0, pf: 0, pa: 0, diff: 0 });
  const home = c.homeTeams.map((t, i) => row('home', t, i)), away = c.awayTeams.map((t, i) => row('away', t, i));
  const key = (t: string[]) => [...t].sort().join('+'); const byKey = new Map([...home.map((r, i) => [key(c.homeTeams[i]), r] as const), ...away.map((r, i) => [key(c.awayTeams[i]), r] as const)]);
  for (const r of [...ev.rounds, ...(ev.plan || []).filter(isLockedR)]) for (const m of r.matches) { if (!scored(m)) continue;
    for (const [t, f, a] of [[m.a, m.sa!, m.sb!], [m.b, m.sb!, m.sa!]] as const) { const x = byKey.get(key(t)); if (!x) continue; x.pf += f; x.pa += a; x.diff += f - a; if (f > a) x.w++; else x.l++; } }
  const tot = (rs: ClubTeamRow[]) => ({ won: rs.reduce((s, r) => s + r.w, 0), pf: rs.reduce((s, r) => s + r.pf, 0) });
  const sort = (rs: ClubTeamRow[]) => [...rs].sort((x, y) => y.w - x.w || y.diff - x.diff || y.pf - x.pf);
  return { home: sort(home), away: sort(away), totals: { home: tot(home), away: tot(away) } };
}

/** Trophy match: 1st place among players who played (most wins, then point diff; still tied = co-winners). Guests excluded. Same rule as the server. */
export function trophyWinners(ev: EventT) {
  if (!ev.trophy || !ev.finished) return [];
  const st = standings(ev).filter(s => s.gp > 0 && !/^guest$/i.test(s.name.trim()) && !ev.players.find(p => p.id === s.id)?.guest);
  if (!st.length) return [];
  const b = st.reduce((x, s) => s.w > x.w || (s.w === x.w && s.diff > x.diff) ? s : x, st[0]);
  return st.filter(s => s.w === b.w && s.diff === b.diff);
}

export const pct = (w: number, gp: number) => gp > 0 ? w / gp : -1;
/** Season/overall ranking: win% desc, diff desc, GP desc, name. */
export function rankBoard<T extends { name: string; wins: number; games: number; diff: number }>(rows: T[]): T[] {
  return [...rows].sort((x, y) => pct(y.wins, y.games) - pct(x.wins, x.games) || y.diff - x.diff || y.games - x.games || x.name.localeCompare(y.name));
}
