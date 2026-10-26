/** "Add past game": a pre-app or missed game entered after the fact. Pure validation + builder (no I/O), shared by the API and its tests. */
export interface PastIn { date?: unknown; club?: unknown; away?: unknown; name?: unknown; trophy?: unknown; hidden?: unknown; matches?: unknown }
export interface PastMatchIn { a?: unknown; b?: unknown; court?: unknown; sa?: unknown; sb?: unknown }
export const PAST_MAX_MATCHES = 40, PAST_MAX_PLAYERS = 32, PAST_MIN_YEAR = 2000;
const clean = (s: unknown, max: number) => typeof s === 'string' ? s.trim().replace(/\s+/g, ' ').slice(0, max) : '';
const key = (s: string) => s.toLowerCase();
/** today = Central-time YYYY-MM-DD. Returns the event data, or an error message. Players with the same name (any case) are one player. */
export function buildPast(inp: PastIn, today: string, code: string, ownerHash: string, createdAt: number): { ev?: Record<string, unknown>; error?: string } {
  const date = typeof inp.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(inp.date) ? inp.date : '';
  if (!date || isNaN(Date.parse(date + 'T00:00:00Z'))) return { error: 'bad date' };
  if (date >= today) return { error: 'date must be in the past' };
  if (+date.slice(0, 4) < PAST_MIN_YEAR) return { error: 'date too old' };
  const club = clean(inp.club, 40) || 'Stone Creek';
  // Optional visiting club: side B of every match is that club, so its players stay out of the home club's stats.
  const away = clean(inp.away, 40); if (away && away.toLowerCase() === club.toLowerCase()) return { error: 'visiting club must differ' };
  const ms = Array.isArray(inp.matches) ? inp.matches as PastMatchIn[] : [];
  if (!ms.length) return { error: 'add at least one match' };
  if (ms.length > PAST_MAX_MATCHES) return { error: `at most ${PAST_MAX_MATCHES} matches` };
  const players: { id: string; name: string }[] = []; const byKey = new Map<string, string>();
  const pid = (n: string) => { const k = key(n); let id = byKey.get(k); if (!id) { id = 'h' + (players.length + 1); byKey.set(k, id); players.push({ id, name: n }); } return id; };
  const rounds: unknown[] = [];
  for (let i = 0; i < ms.length; i++) {
    const m = ms[i] || {};
    const a = (Array.isArray(m.a) ? m.a : []).map(x => clean(x, 40)), b = (Array.isArray(m.b) ? m.b : []).map(x => clean(x, 40));
    if (a.length !== 2 || b.length !== 2 || [...a, ...b].some(x => !x)) return { error: `match ${i + 1}: 2 players per team` };
    if (new Set([...a, ...b].map(key)).size !== 4) return { error: `match ${i + 1}: 4 different players` };
    if ([...a, ...b].some(x => /^guest$/i.test(x))) return { error: `match ${i + 1}: use a real name` };
    const sa = m.sa, sb = m.sb;
    if (!Number.isInteger(sa) || !Number.isInteger(sb) || (sa as number) < 0 || (sb as number) < 0 || (sa as number) > 99 || (sb as number) > 99) return { error: `match ${i + 1}: scores 0–99` };
    if (sa === sb) return { error: `match ${i + 1}: no ties` };
    const court = Number.isInteger(m.court) && (m.court as number) >= 1 && (m.court as number) <= 4 ? m.court as number : 1;
    rounds.push({ n: i + 1, matches: [{ court, a: a.map(pid), b: b.map(pid), sa, sb }], byes: [] });
  }
  if (players.length > PAST_MAX_PLAYERS) return { error: `at most ${PAST_MAX_PLAYERS} players` };
  const name = clean(inp.name, 60) || 'Past game';
  return { ev: { id: code, name, date: date + 'T12:00', place: '', format: 'rotating', courts: 4, totalRounds: rounds.length, balanceDupr: false, seeding: 'random',
    players, active: players.map(p => p.id), teams: [], rounds, clubName: club, ...(away ? { awayClub: away } : {}), trophy: inp.trophy === true, finished: true, addedLater: true, ownerHash,
    createdAt, startedAt: createdAt, startedBy: 'organizer', host: 'organizer', hidden: inp.hidden === true } };
}
