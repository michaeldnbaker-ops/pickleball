import type { EventT } from './engine';
/** Names compare trimmed, case-insensitive, inner spaces collapsed. */
export const normName = (s: string) => (s || '').trim().replace(/\s+/g, ' ').toLowerCase();
/** True if someone already in this game (joined) has this name. */
export const nameTaken = (ev: EventT, name: string) => { const k = normName(name); return !!k && ev.players.some(p => ev.active.includes(p.id) && normName(p.name) === k); };
/** Spelling already used for this person. First matching known name wins (pass all-time stats first). A new person keeps the cleaned typed name — never a different player's name. */
export function canonicalName(typed: string, known: string[]): string {
  const cleaned = (typed || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  const k = normName(cleaned);
  if (!k) return '';
  const hit = known.find(n => normName(n) === k);
  return (hit ? hit.trim() : cleaned).slice(0, 40);
}
/** One spelling per person: the name with the most scored games. A tie keeps the earlier spelling. */
export function bestNames(rows: { name: string; games?: number }[]): string[] {
  const best = new Map<string, { name: string; games: number }>();
  for (const p of rows) {
    const name = (p.name || '').trim(); const k = normName(name); if (!k) continue;
    const g = p.games || 0; const prev = best.get(k);
    if (!prev || g > prev.games) best.set(k, { name, games: g });
  }
  return [...best.values()].map(x => x.name);
}
/** Names a joiner is matched against: all-time stats spelling, then this game, then this phone's roster. */
export function joinNames(stats: string[], inGame: string[], roster: string[]): string[] {
  const out: string[] = []; const seen = new Set<string>();
  const add = (n: string) => { const t = (n || '').trim(); const k = normName(t); if (!k || seen.has(k)) return; seen.add(k); out.push(t); };
  for (const n of stats) add(n); for (const n of inGame) add(n); for (const n of roster) add(n);
  return out;
}
/** Number of extra entries sharing a name (0 = no duplicates). */
export const dupCount = (ev: Pick<EventT, 'players' | 'active'>) => { const ps = (ev.players || []).filter(p => (ev.active || []).includes(p.id)); return ps.length - new Set(ps.map(p => normName(p.name))).size; };
/** Remove a player before the start. Returns false (and changes nothing) once the game has started. */
export function removePlayer(ev: EventT, id: string) {
  if (ev.rounds.length) return false;
  ev.players = ev.players.filter(p => p.id !== id); ev.active = ev.active.filter(x => x !== id);
  ev.teams = (ev.teams || []).filter(t => !t.includes(id));
  if (ev.club) for (const ts of [ev.club.homeTeams, ev.club.awayTeams]) for (const t of ts) for (let k = 0; k < t.length; k++) if (t[k] === id) t[k] = '';
  return true;
}
export const CAPS = [4, 8, 12, 16];
/** The game's player cap (4/8/12/16), or 0 for no cap (older games). */
export const capOf = (ev: Pick<EventT, 'maxPlayers'>) => CAPS.includes(Number(ev.maxPlayers)) ? Number(ev.maxPlayers) : 0;
/** Signed up count has reached the cap: no more joins until someone drops out. */
export const isFull = (ev: Pick<EventT, 'maxPlayers' | 'active'>) => { const c = capOf(ev); return !!c && new Set(ev.active).size >= c; };
/** Smallest cap that fits n pre-selected players (default 8). */
export const fitCap = (n: number, def = 8) => n <= def ? def : CAPS.find(c => c >= n) ?? 0;
