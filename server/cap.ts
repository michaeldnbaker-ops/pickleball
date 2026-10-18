/** Player cap chosen on Create (4, 8, 12 or 16). Games without one (older games) have no cap. */
export const CAPS = [4, 8, 12, 16];
interface CapEv { maxPlayers?: unknown; active?: string[] }
export const capOf = (ev?: CapEv | null) => { const n = Number(ev?.maxPlayers); return CAPS.includes(n) ? n : 0; };
/** Before the start: refuse a write that grows the signed-up count past the cap. Shrinking (drop out / remove) or keeping the count is always allowed. */
export function overCap(cur: CapEv | undefined | null, next: CapEv) {
  const max = capOf(cur ?? next); if (!max) return false;
  const n = new Set(next.active || []).size, c = cur ? new Set(cur.active || []).size : 0;
  return n > max && n > c;
}
/** Courts picked by letter on Create: strictly increasing whole numbers 1..60 (1=A), one per court. */
export function validCourtSet(cs: unknown, courts: unknown) {
  return Array.isArray(cs) && cs.length === Number(courts) && cs.length > 0 && cs.every((x, i) => Number.isInteger(x) && x >= 1 && x <= 60 && (i === 0 || x > cs[i - 1]));
}
/** What a write may do to the cap. Before the start the creator's phone may set it to 4/8/12/16, never below the current sign-ups; everyone else (and everyone after the start) keeps the stored cap. */
export function capChange(cur: CapEv | undefined | null, next: CapEv, opts: { started: boolean; org: boolean }): { max: number; error?: string } {
  const keep = capOf(cur);
  const want = capOf(next); const raw = (next as { maxPlayers?: unknown }).maxPlayers;
  if (!cur) return { max: want };
  if (opts.started || !opts.org || raw === undefined || want === keep) return { max: keep };
  if (!want) return { max: keep, error: 'bad max' };
  const n = new Set(next.active || []).size;
  if (want < n) return { max: keep, error: 'max below players' };
  return { max: want };
}
