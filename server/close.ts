interface M { court: number; a: string[]; b: string[]; sa?: number; sb?: number }
interface R { n: number; matches: M[]; byes?: string[]; playoff?: boolean }
export interface CloseEv { rounds?: R[]; plan?: R[]; planKey?: string; finished?: boolean; [k: string]: unknown }
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
