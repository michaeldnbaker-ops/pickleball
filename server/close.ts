interface M { court: number; a: string[]; b: string[]; sa?: number; sb?: number }
interface R { n: number; matches: M[]; byes?: string[]; playoff?: boolean }
export interface CloseEv { rounds?: R[]; plan?: R[]; planKey?: string; finished?: boolean; [k: string]: unknown }
/** Wall-clock 'YYYY-MM-DDTHH:MM' in America/Chicago, matching the date stored on a game. */
export function ctStamp(ms: number) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
/** A started game stays open until 24 hours after its scheduled start, so play that runs past midnight is not closed at 12:01am. */
export const liveUntil = (now = Date.now()) => ctStamp(now - 24 * 3600e3);

/** Same as the app's End: keep every scored match, including rounds played after a skip. Blank courts are left out. */
export function closeEvent<T extends CloseEv>(ev: T): T {
  const e: T = JSON.parse(JSON.stringify(ev)); e.rounds = e.rounds || [];
  const scored = (m: M) => m.sa != null && m.sb != null && m.sa !== m.sb;
  for (const r of e.plan || []) {
    const matches = (r.matches || []).filter(scored);
    if (!matches.length) continue;
    e.rounds.push({ n: r.n, matches, byes: r.byes || [], ...(r.playoff ? { playoff: true } : {}) });
  }
  e.finished = true; delete e.plan; delete e.planKey; return e;
}
