interface M { court: number; a: string[]; b: string[]; sa?: number; sb?: number }
interface R { n: number; matches: M[]; byes?: string[]; playoff?: boolean }
export interface CloseEv { rounds?: R[]; plan?: R[]; planKey?: string; finished?: boolean; [k: string]: unknown }
/** Same as the app's End early: keep played rounds plus fully scored play-ahead rounds (in order), drop unplayed, mark complete. */
export function closeEvent<T extends CloseEv>(ev: T): T {
  const e: T = JSON.parse(JSON.stringify(ev)); e.rounds = e.rounds || [];
  for (const r of e.plan || []) { if (!(r.matches || []).length || !r.matches.every(m => m.sa != null && m.sb != null && m.sa !== m.sb)) break; e.rounds.push({ n: r.n, matches: r.matches, byes: r.byes || [] }); }
  e.finished = true; delete e.plan; delete e.planKey; return e;
}
