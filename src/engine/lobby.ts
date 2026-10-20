import type { EventT } from './engine';
/** Names compare trimmed, case-insensitive, inner spaces collapsed. */
export const normName = (s: string) => (s || '').trim().replace(/\s+/g, ' ').toLowerCase();
/** True if someone already in this game (joined) has this name. */
export const nameTaken = (ev: EventT, name: string) => { const k = normName(name); return !!k && ev.players.some(p => ev.active.includes(p.id) && normName(p.name) === k); };
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
