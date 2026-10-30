/** Possible same-person names. Stats stay split until an organizer confirms a merge. */

export type NameSrc = 'self' | 'host' | '';
export type AliasWhy = 'same name' | 'nickname' | 'shortened' | 'typo' | 'initial' | 'same initial';

const NICKS: string[][] = [
  ['mike', 'michael', 'mikey'],
  ['andy', 'drew', 'andrew'],
  ['jeff', 'jeffrey', 'geoff', 'geoffrey'],
  ['chris', 'christian', 'christopher', 'kristopher', 'kristian', 'kris'],
  ['joe', 'joseph', 'joey'],
  ['sam', 'samuel', 'sammy'],
  ['ian', 'iain', 'eian'],
  ['bob', 'robert', 'bobby', 'rob', 'robbie'],
  ['bill', 'william', 'will', 'billy', 'liam'],
  ['jim', 'james', 'jimmy', 'jamie'],
  ['tom', 'thomas', 'tommy'],
  ['dan', 'daniel', 'danny'],
  ['dave', 'david'],
  ['steve', 'steven', 'stephen'],
  ['matt', 'matthew'],
  ['alex', 'alexander'],
  ['nick', 'nicholas'],
  ['ben', 'benjamin'],
  ['jon', 'john', 'jonathan'],
  ['tony', 'anthony'],
  ['rick', 'richard'],
  ['ed', 'edward', 'ted'],
  ['ken', 'kenneth'],
  ['greg', 'gregory'],
  ['tim', 'timothy'],
  ['pat', 'patrick'],
  ['scott', 'scotty'],
  ['pete', 'peter'],
  ['phil', 'philip', 'phillip'],
  ['ron', 'ronald'],
  ['don', 'donald'],
  ['ray', 'raymond'],
  ['larry', 'lawrence'],
  ['jerry', 'gerald'],
  ['doug', 'douglas'],
  ['josh', 'joshua'],
  ['zach', 'zachary', 'zack'],
  ['nate', 'nathan', 'nathaniel'],
  ['gabe', 'gabriel'],
  ['max', 'maxwell'],
  ['wes', 'wesley'],
];

const nickAt = new Map<string, number>();
NICKS.forEach((g, i) => g.forEach(n => nickAt.set(n, i)));

export const whyText: Record<AliasWhy, string> = {
  'same name': 'Same name, aside from a club tag',
  nickname: 'Nickname, same last name',
  shortened: 'Shorter first name, same last name',
  typo: 'Close spelling',
  initial: 'Same last name, first initial',
  'same initial': 'Same last name and first initial',
};

export const normPerson = (s: string) => (s || '').trim().replace(/\s+/g, ' ').toLowerCase();

/** Drop a trailing club tag such as "(FC)" so "Ryan" and "Ryan (FC)" can be compared. */
export function comparable(s: string): string {
  return normPerson(s).replace(/\s*\([a-z0-9]{1,6}\)\s*$/i, '').trim();
}

export function splitName(raw: string): { first: string; last: string; all: string } {
  const all = comparable(raw);
  const bits = all.split(' ').filter(Boolean);
  if (!bits.length) return { first: '', last: '', all };
  if (bits.length === 1) return { first: bits[0], last: '', all };
  const mid = bits.slice(1, -1).filter(t => t.replace(/\.$/, '').length > 1);
  return { first: bits[0].replace(/\.$/, ''), last: [...mid, bits[bits.length - 1].replace(/\.$/, '')].join(' '), all };
}

export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 3) return 4;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[b.length];
}

function sameNick(a: string, b: string): boolean {
  if (!a || !b || a === b) return false;
  const i = nickAt.get(a);
  return i !== undefined && i === nickAt.get(b);
}

const clubTag = (s: string) => { const m = normPerson(s).match(/\(([a-z0-9]{1,6})\)\s*$/); return m ? m[1] : ''; };
/** Untagged names are Stone Creek. (FC) is Franco's. Two tags are the same club only when they map to one name. */
const CLUB_TAGS: Record<string, string> = { fc: 'francos', francos: 'francos', cg: 'crossgates', crossgates: 'crossgates', sc: 'stone creek', stonecreek: 'stone creek' };
export function clubOf(s: string): string { const tag = clubTag(s); return tag ? (CLUB_TAGS[tag] || tag) : 'stone creek'; }

/** Why these two stored names might be one player, or null when they look different. */
export function aliasReason(a: string, b: string): AliasWhy | null {
  const A = splitName(a), B = splitName(b);
  if (!A.all || !B.all || normPerson(a) === normPerson(b)) return null;
  if (clubOf(a) !== clubOf(b)) return null;
  if (A.all === B.all) return 'same name';
  const lastEq = !!A.last && A.last === B.last;
  const bothSingle = !A.last && !B.last;
  // Two first names with no last name ("Bill (CG)" and "Will (BC)") are not enough, unless one is a nickname and they are not tagged as different clubs.
  if (bothSingle) {
    const ta = clubTag(a), tb = clubTag(b);
    if (sameNick(A.first, B.first) && !(ta && tb && ta !== tb)) return 'nickname';
    return null;
  }
  if (lastEq) {
    if (sameNick(A.first, B.first)) return 'nickname';
    const af = A.first.replace(/\.$/, ''), bf = B.first.replace(/\.$/, '');
    if (af && bf && af[0] === bf[0]) {
      if (af.length === 1 || bf.length === 1) return 'initial';
      const short = Math.min(af.length, bf.length);
      if (short >= 3 && (af.startsWith(bf) || bf.startsWith(af))) return 'shortened';
      const d = editDistance(af, bf);
      if (d === 1 || (d === 2 && short >= 5)) return 'typo';
      return 'same initial';
    }
  }
  const dAll = editDistance(A.all, B.all);
  if (dAll === 1) return 'typo';
  if (dAll === 2 && Math.min(A.all.length, B.all.length) >= 10 && (A.first === B.first || lastEq)) return 'typo';
  return null;
}

/** The existing spelling to offer, or null when the typed name is already exact or not close. */
export function suggestName(typed: string, known: string[]): string | null {
  const t = (typed || '').trim().replace(/\s+/g, ' ');
  if (comparable(t).length < 3) return null;
  if (known.some(n => normPerson(n) === normPerson(t))) return null;
  for (const n of known) if (aliasReason(t, n)) return n.trim();
  return null;
}

export function duplicatePairs(names: string[]): { a: string; b: string; why: AliasWhy }[] {
  const list = names.map(n => n.trim()).filter(Boolean);
  const out: { a: string; b: string; why: AliasWhy }[] = [];
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const why = aliasReason(list[i], list[j]);
    if (why) out.push(list[i].localeCompare(list[j]) <= 0 ? { a: list[i], b: list[j], why } : { a: list[j], b: list[i], why });
  }
  return out.sort((x, y) => x.a.localeCompare(y.a) || x.b.localeCompare(y.b));
}

export interface NameUse { name: string; src?: NameSrc; games?: number }

function srcRank(s: NameSrc | undefined): number { return s === 'self' ? 2 : s === 'host' ? 0 : 1; }

/** Which spelling a confirmed merge keeps. A name typed on Join wins. Callers only pass names from the same club. */
export function chooseKeptName(uses: NameUse[]): { name: string; why: string } {
  const by = new Map<string, { name: string; src: NameSrc; games: number }>();
  for (const u of uses) {
    const name = (u.name || '').trim().replace(/\s+/g, ' ');
    const k = normPerson(name); if (!k) continue;
    const src: NameSrc = u.src === 'self' || u.src === 'host' ? u.src : '';
    const cur = by.get(k) || { name, src, games: 0 };
    cur.games += u.games || 0;
    if (srcRank(src) > srcRank(cur.src)) cur.src = src;
    if (name.length > cur.name.length) cur.name = name;
    by.set(k, cur);
  }
  const rows = [...by.values()];
  if (!rows.length) return { name: '', why: '' };
  const pick = (xs: typeof rows) => [...xs].sort((a, b) => b.games - a.games || a.name.localeCompare(b.name))[0];
  const self = rows.filter(r => r.src === 'self');
  if (self.length) { const n = pick(self).name; return { name: n, why: `Keeps ${n}, the name entered on Join.` }; }
  const open = rows.filter(r => r.src !== 'host');
  const host = rows.filter(r => r.src === 'host');
  if (open.length && host.length) { const n = pick(open).name; return { name: n, why: `Keeps ${n}, the name from a game someone joined. The other spelling was added by a host or imported.` }; }
  const n = pick(rows).name;
  return { name: n, why: `Keeps ${n}. None of these spellings was marked as typed on Join, so this is the one with the most games.` };
}

/** Where a stored player name came from. Older games have no flag: an added-later import counts as the host. */
export function sourceOf(ev: { addedLater?: boolean }, p: { id?: string; src?: string }): NameSrc {
  if (p.src === 'self' || p.src === 'host') return p.src;
  if (ev.addedLater) return 'host';
  if (typeof p.id === 'string' && /^h\d+$/.test(p.id)) return 'host';
  return '';
}

interface M { a?: string[]; b?: string[] }
interface Rd { matches?: M[]; byes?: string[] }
export interface MergeEv {
  addedLater?: boolean; startedBy?: string; host?: string;
  players?: { id: string; name?: string; src?: string }[];
  active?: string[]; teams?: string[][]; rounds?: Rd[]; plan?: Rd[];
  club?: { homeTeams?: string[][]; awayTeams?: string[][] };
  subs?: { slot?: string; name?: string | null }[];
}

function mapIds(ids: string[] | undefined, drop: Set<string>, keep: string) {
  if (!ids) return;
  for (let i = 0; i < ids.length; i++) if (drop.has(ids[i])) ids[i] = keep;
}
function roundsOf(ev: MergeEv, drop: Set<string>, keep: string) {
  for (const r of [...(ev.rounds || []), ...(ev.plan || [])]) {
    mapIds(r.byes, drop, keep);
    for (const m of r.matches || []) { mapIds(m.a, drop, keep); mapIds(m.b, drop, keep); }
  }
}
function together(ev: MergeEv, ids: string[]): boolean {
  const want = new Set(ids);
  for (const r of [...(ev.rounds || []), ...(ev.plan || [])]) for (const m of r.matches || []) {
    const hit = new Set([...(m.a || []), ...(m.b || [])].filter(id => want.has(id)));
    if (hit.size > 1) return true;
  }
  return false;
}

/** Rename every listed spelling to `kept` inside one game. Two people who played the same match are left alone. */
export function applyNameMerge(ev: MergeEv, from: string[], kept: string): { error?: string } {
  const keys = new Set(from.map(normPerson));
  const name = kept.trim().replace(/\s+/g, ' ');
  if (!name || !keys.size) return { error: 'bad name' };
  const hits = (ev.players || []).filter(p => keys.has(normPerson(p.name || '')));
  if (hits.length > 1) {
    if (together(ev, hits.map(p => p.id))) return { error: 'played together' };
    const keepId = (hits.find(p => normPerson(p.name || '') === normPerson(name)) || hits[0]).id;
    const drop = new Set(hits.map(p => p.id).filter(id => id !== keepId));
    roundsOf(ev, drop, keepId);
    for (const ts of [ev.teams, ev.club?.homeTeams, ev.club?.awayTeams]) for (const t of ts || []) mapIds(t, drop, keepId);
    for (const s of ev.subs || []) if (s.slot && drop.has(s.slot)) s.slot = keepId;
    if (ev.startedBy && drop.has(ev.startedBy)) ev.startedBy = keepId;
    if (ev.host && drop.has(ev.host)) ev.host = keepId;
    ev.players = (ev.players || []).filter(p => !drop.has(p.id));
    const active: string[] = [];
    for (const id of ev.active || []) { const n = drop.has(id) ? keepId : id; if (!active.includes(n)) active.push(n); }
    ev.active = active;
  }
  for (const p of ev.players || []) if (keys.has(normPerson(p.name || ''))) p.name = name;
  for (const s of ev.subs || []) if (s.name && keys.has(normPerson(s.name))) s.name = name;
  return {};
}
