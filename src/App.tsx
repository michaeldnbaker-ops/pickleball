import { Fragment, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { nameTaken, removePlayer, capOf, isFull, fitCap, CAPS, normName, canonicalName, joinNames } from './engine/lobby';
import { EventT, Round, Format, Player, Match, nextRound, nextPlayoffRound, standings, teamStandings, toCSV, scored, unscoredCourts, courtName, courtLabel, courtsText, courtList, ensurePlan, takeNextRound, newClub, setClubSlot, clubReady, clubStandings, trophyWinners, rankBoard, slotName, subRound, subAt, resultDependent, isLocked, startEvent, startOk, addRounds, endEvent, unitSize, addActivePlayer, dropPlayer, rosterOpen } from './engine/engine';
import * as S from './store';

const ICONS: Record<string, string> = {
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1.2"/><circle cx="4.5" cy="12" r="1.2"/><circle cx="4.5" cy="18" r="1.2"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4"/><path d="M12 13v4M8 21h8M9.5 17h5v4h-5z"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1L7 17M17 7l2.1-2.1"/>',
  stats: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  flag: '<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/>',
  medal: '<circle cx="12" cy="15" r="6"/><path d="M8 3l4 6 4-6M12 12.5v5"/>',
  userMinus: '<circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 3-6.5 7-6.5s7 2.5 7 6.5M16 11h6"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  shuffle: '<path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  play: '<path d="M7 4l13 8-13 8z"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/>',
};
/** Clean line icons (Stone Creek navy/blue via currentColor). */
const Icon = ({ n, size = 20 }: { n: string; size?: number }) => <svg className="ico" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: ICONS[n] }} />;
/** Short share link built from the current origin + app base, so it follows a custom domain automatically. */
/** Shareable game link: a real page (HTTP 200) so iMessage/Facebook previews show the logo; opens straight to Add yourself. */
export function gameLink(code: string) { const p = location.pathname; const i = p.indexOf('/g/'); const base = i >= 0 ? p.slice(0, i + 1) : p.replace(/[^/]*$/, ''); return location.origin + base + '?g=' + code; }
const Logo = ({ size = 84 }: { size?: number }) => <img className="logoArt badge" src="./badge.webp" width={size} height={size} alt="Stone Creek" />;
/** Small perforated pickleball glyph for buttons/tabs. */
const Ball = () => <svg className="ballIcon" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8.5" fill="#7CC242" stroke="#4E9A1E" strokeWidth="1.5" />{[[10, 10], [6, 7.5], [14, 7.5], [6, 12.5], [14, 12.5], [10, 4.5], [10, 15.5]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="1.3" fill="#2F6B12" />)}</svg>;

const FORMATS: { id: Format; name: string; desc: string }[] = [
  { id: 'rotating', name: 'Round Robin', desc: 'Rotating partners — new partner every round, fewest repeats.' },
  { id: 'mixer', name: 'Mix-Up / Free-for-All', desc: 'Random social shuffle each round, byes kept fair.' },
  { id: 'mixed', name: 'Mixed Doubles', desc: 'Organizer sets the pairs; pairs stay together and rotate opponents.' },
  { id: 'fixed', name: 'Set Partners RR', desc: 'Same partner all event, rotate opponents.' },
  { id: 'kotc', name: 'King of the Court', desc: 'Up & down the river: winners move up a court, losers down, partners split.' },
  { id: 'ladder', name: 'Ladder', desc: 'Courts re-seeded by standings each round: best 4 on the top court.' },
  { id: 'team', name: 'Team Battle (4-player teams)', desc: 'MLP-style: teams of 4 play two doubles games per tie.' },
  { id: 'club', name: 'Club vs Club', desc: 'Two clubs, fixed 2-player teams. Home teams keep their court; visiting teams move one court each round.' },
];
const fmtName = (f: Format) => (FORMATS.find(x => x.id === f) ?? FORMATS[0]).name; // legacy formats (e.g. old 'mixed') show as Round Robin

function useRoute() {
  const [h, setH] = useState(location.hash);
  useEffect(() => { const f = () => setH(location.hash); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  return h.replace(/^#\/?/, '').split('/');
}
const go = (p: string) => { location.hash = '#/' + p; };

export default function App() {
  const r = useRoute();
  if (r[0] === 'new') return <NewEvent />;
  if (r[0] === 'roster') return <Roster />;
  if (r[0] === 'join') return <Join />;
  if (r[0] === 'past') return <Past />;
  if (r[0] === 'addpast') return <AddPast code={r[1] ? r[1].toUpperCase() : undefined} />;
  if (r[0] === 'stats') return <Stats name={r[1] ? decodeURIComponent(r[1]) : undefined} />;
  if (r[0] === 'e' && r[1]) return <EventView code={r[1].toUpperCase()} joining={r[2] === 'join'} />;
  return <Home />;
}

function Header({ title, back }: { title: string; back?: string }) {
  return <header>{back !== undefined && <button className="ghost" onClick={() => go(back)} aria-label="Back">‹</button>}<h1>{title}</h1></header>;
}

function Home() {
  return <div className="page landing">
    <div className="logo"><h1 className="wordmark" aria-label="Stone Creek Pickleball"><img className="fullLogo" src="./logo.webp" width={920} height={880} alt="Stone Creek Pickleball" /></h1></div>
    <div className="landBtns">
      <button className="big primary huge" onClick={() => go('new')}>Create a game</button>
      <button className="big huge secondary" onClick={() => go('join')}>Join a game</button>
    </div>
    <div className="row landLinks"><button className="ghost statsLink" onClick={() => go('stats')}><Icon n="stats" /> Overall stats</button>
      <button className="ghost statsLink pastLink" onClick={() => go('past')}><Icon n="list" /> Past matches</button></div>
    <NotifyGames />
  </div>;
}

/** Opt in to a phone notification when someone creates a game. iPhone needs the Home Screen app (iOS 16.4+). */
function iosNeedsInstall() {
  if (typeof navigator === 'undefined') return false;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent || '');
  const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
  return ios && !standalone;
}
function NotifyGames() {
  const ios = iosNeedsInstall();
  const [on, setOn] = useState(false); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState('');
  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    let stop = false;
    navigator.serviceWorker.ready.then(r => r.pushManager.getSubscription()).then(s => { if (!stop && s) setOn(true); }).catch(() => {});
    return () => { stop = true; };
  }, []);
  const turnOn = async () => {
    setMsg('');
    if (ios) { setMsg('Add to Home Screen first'); return; }
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) { setMsg("This browser can't receive notifications."); return; }
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { setMsg('Notifications are blocked. Allow them for this site, then try again.'); return; }
      await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
      const reg = await navigator.serviceWorker.ready;
      const key = await S.pushPublicKey();
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: S.pushKeyBytes(key) });
      await S.savePushSub(sub);
      setOn(true);
    } catch (e) { setMsg("Couldn't turn on notifications. " + ((e as Error).message || 'Try again.')); }
    finally { setBusy(false); }
  };
  const turnOff = async () => {
    setBusy(true); setMsg('');
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) { await S.deletePushSub(sub.endpoint); await sub.unsubscribe(); }
      setOn(false);
    } catch { setMsg("Couldn't turn notifications off. Try again."); }
    finally { setBusy(false); }
  };
  return <div className="notifyBox">
    {ios && <p className="iosHint" role="note"><b>Add to Home Screen first.</b> On iPhone, tap Share, then Add to Home Screen, and open the app from its icon (iOS 16.4 or later).</p>}
    {on
      ? <><p className="muted small" role="status">You'll be notified when a game is created.</p><button className="big" onClick={turnOff} disabled={busy}>Turn off notifications</button></>
      : <button className="big secondary" onClick={turnOn} disabled={busy}>{busy ? 'Turning on…' : 'Notify me when games are created'}</button>}
    {msg && <p className="warn" role="alert">{msg}</p>}
  </div>;
}

/** Completed matches, newest first; each opens read-only with its final standings. */
/** Club dropdown: Stone Creek first, then saved clubs; optional last option 'Add club…' opens a name box (saved server-side for everyone). */
function ClubSelect({ value, onChange, id, label, allowAdd, exclude }: { value: string; onChange: (c: string) => void; id: string; label: string; allowAdd?: boolean; exclude?: string }) {
  const [clubs, setClubs] = useState<string[]>([S.SC]); const [adding, setAdding] = useState(false); const [nm, setNm] = useState(''); const [err, setErr] = useState('');
  useEffect(() => { S.listClubs().then(setClubs); }, []);
  const opts = [...new Map([...clubs, value].filter(Boolean).map(c => [S.clubKey(c), c])).values()].filter(c => !exclude || S.clubKey(c) !== S.clubKey(exclude));
  const save = async () => { const n = nm.trim(); if (!n) return; setErr('');
    try { const got = await S.addClub(n); setClubs(await S.listClubs()); onChange(got); setAdding(false); setNm(''); } catch { setErr("Couldn't save the club (offline?)."); } };
  return <div className="clubSelect"><label htmlFor={id}>{label}</label>
    <select id={id} value={adding ? '__add' : value} onChange={e => { if (e.target.value === '__add') { setAdding(true); setNm(''); } else { setAdding(false); onChange(e.target.value); } }}>
      {!value && <option value="">Choose…</option>}
      {opts.map(c => <option key={c} value={c}>{c}</option>)}{allowAdd && <option value="__add">Add club…</option>}</select>
    {adding && <div className="row addClub"><input aria-label="New club name" placeholder="Club name" maxLength={40} value={nm} autoFocus onChange={e => setNm(e.target.value)} onKeyDown={e => e.key === 'Enter' && save()} />
      <button className="primary" onClick={save} disabled={!nm.trim()}>Save club</button><button className="ghost" onClick={() => setAdding(false)}>Cancel</button></div>}
    {err && <p className="warn">{err}</p>}</div>;
}
function TrophyBadge({ n, big }: { n?: number; big?: boolean }) { return n ? <span className={'trophyCount' + (big ? ' big' : '')} aria-label={n + (n === 1 ? ' trophy' : ' trophies')}>🏆 x{n}</span> : null; }
function useClubView(): [string, (c: string) => void] { const [c, setC] = useState(S.clubView()); return [c, (x: string) => { S.setClubView(x); setC(x); }]; }
function Past() {
  const [list, setList] = useState<S.Listed[] | null>(null); const [err, setErr] = useState(false); const [club, setClub] = useClubView();
  useEffect(() => { setList(null); S.listPast(club).then(setList).catch(() => setErr(true)); }, [club]);
  return <div className="page"><Header title="Past matches" back="" />
    <ClubSelect id="past-club" label="Club" value={club} onChange={setClub} />
    <button className="big secondary addPastBtn" onClick={() => go('addpast')}>+ Add past game</button>
    {err && <p className="warn">Couldn't load past matches (offline?).</p>}{!list && !err && <p className="muted">Loading…</p>}
    {list?.length === 0 && <div className="card empty"><b>No completed matches yet</b><p className="muted">A match shows here once its host ends it.</p></div>}
    {list?.map(g => <GameCard key={g.code} g={{ ...g, rounds: 0 }} onClick={() => { S.setTab(g.code, 'standings'); go('e/' + g.code); }} />)}
  </div>;
}

const fmtWhen = (iso: string) => { const d = new Date(iso); return isNaN(+d) ? { day: '', date: '', time: '' } : { day: d.toLocaleDateString([], { weekday: 'long' }), date: d.toLocaleDateString([], { month: 'short', day: 'numeric' }), time: d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) }; };
function GameCard({ g, onClick, join }: { g: { code: string; name: string; date: string; place?: string; players?: number; rounds?: number; max?: number | null; club?: string; away?: string | null; added_later?: boolean }; onClick: () => void; join?: boolean }) {
  const w = fmtWhen(g.date); const started = (g.rounds ?? 0) > 0; const live = started && new Date(g.date) <= new Date();
  const full = !started && !!g.max && (g.players ?? 0) >= g.max;
  // Started games open (tap your name); full games show Full (still openable by those already in).
  const pill = started ? 'Open' : full ? 'Full' : 'Join';
  return <button className="card tap game" onClick={onClick}>
    <div className="when"><div className="wday">{w.day.slice(0, 3)}</div><div className="wdate">{w.date}</div></div>
    <div className="gInfo"><div className="gTime">{w.day} · {w.time}{live && <span className="live">In progress</span>}</div>
      <div className="gName">{g.name}{g.club && S.clubKey(g.club) !== S.clubKey(S.SC) && <span className="clubTag">{g.club}</span>}{g.away && <span className="clubTag">vs {g.away}</span>}{g.added_later && <span className="clubTag addedLater">Added later</span>}</div>
      <div className="muted small">{g.place || 'Place TBA'}{g.players != null ? ` · ${g.max && !started ? g.players + '/' + g.max : g.players} players` : ''}</div></div>
    {join ? <span className={'joinPill' + (pill !== 'Join' ? ' pill' + pill : '')}>{pill}</span> : <span className="chev" aria-hidden="true">›</span>}</button>;
}

/** Join: only "Create a game" and the list of upcoming games. Pick a game → your name is already filled in on this phone. */
function Join() {
  const [list, setList] = useState<S.Listed[] | null>(null); const [err, setErr] = useState(false);
  useEffect(() => { S.listEvents().then(setList).catch(() => setErr(true)); }, []);
  return <div className="page"><Header title="Join a game" back="" />
    <button className="big primary createTop" onClick={() => go('new')}>Create a game</button>
    <h2>Upcoming games</h2>
    {list === null && !err && <p className="muted">Loading games…</p>}
    {err && <p className="warn">Couldn't load the games list (offline?). Pull down to retry.</p>}
    {list?.length === 0 && <div className="card empty"><div className="emptyIcon"><Logo size={72} /></div><b>No current games</b><p className="muted">Nobody has set up a game yet.</p></div>}
    <div className="gameList">{list?.map(g => <GameCard key={g.code} g={g} join onClick={() => go('e/' + g.code + '/join')} />)}</div>
  </div>;
}

const ITEM = 44;
function Wheel({ items, value, onChange, label }: { items: string[]; value: number; onChange: (i: number) => void; label: string }) {
  const ref = useRef<HTMLDivElement>(null); const t = useRef<number | undefined>(undefined);
  useEffect(() => { const el = ref.current; if (el && Math.round(el.scrollTop / ITEM) !== value) el.scrollTop = value * ITEM; }, [value]);
  const onScroll = () => { clearTimeout(t.current); t.current = window.setTimeout(() => { const el = ref.current!; const i = Math.max(0, Math.min(items.length - 1, Math.round(el.scrollTop / ITEM))); if (Math.abs(el.scrollTop - i * ITEM) > 1) el.scrollTo({ top: i * ITEM, behavior: 'smooth' }); if (i !== value) onChange(i); }, 90); };
  return <div className="wheel" ref={ref} onScroll={onScroll} role="listbox" aria-label={label} tabIndex={0}
    onKeyDown={e => { if (e.key === 'ArrowDown') { e.preventDefault(); onChange(Math.min(items.length - 1, value + 1)); } if (e.key === 'ArrowUp') { e.preventDefault(); onChange(Math.max(0, value - 1)); } }}>
    <div className="wpad" />{items.map((x, i) => <div key={x} role="option" aria-selected={i === value} className={'witem' + (i === value ? ' on' : '')} onClick={() => { ref.current?.scrollTo({ top: i * ITEM, behavior: 'smooth' }); onChange(i); }}>{x}</div>)}<div className="wpad" />
  </div>;
}
const HOURS = Array.from({ length: 12 }, (_, i) => String(i + 1)); const MINS = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'));
function TimeWheel({ h24, min, onChange }: { h24: number; min: number; onChange: (h: number, m: number) => void }) {
  const pm = h24 >= 12; const h12 = h24 % 12 || 12;
  const set = (h: number, m: number, p: boolean) => onChange((h % 12) + (p ? 12 : 0), m);
  return <div className="timeWheel" aria-label="Start time">
    <Wheel label="Hour" items={HOURS} value={h12 - 1} onChange={i => set(i + 1, min, pm)} />
    <div className="colon">:</div>
    <Wheel label="Minute" items={MINS} value={Math.round(min / 5) % 12} onChange={i => set(h12, i * 5, pm)} />
    <Wheel label="AM/PM" items={['AM', 'PM']} value={pm ? 1 : 0} onChange={i => set(h12, min, i === 1)} />
    <div className="wheelBand" aria-hidden="true" />
  </div>;
}
function Calendar({ value, onChange }: { value: string; onChange: (d: string) => void }) {
  const sel = new Date(value + 'T00:00'); const [m, setM] = useState(new Date(sel.getFullYear(), sel.getMonth(), 1));
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const first = m.getDay(); const days = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
  const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return <div className="cal" aria-label="Game day">
    <div className="calHead"><button className="ghost" aria-label="Previous month" onClick={() => setM(new Date(m.getFullYear(), m.getMonth() - 1, 1))}>‹</button>
      <b>{m.toLocaleDateString([], { month: 'long', year: 'numeric' })}</b>
      <button className="ghost" aria-label="Next month" onClick={() => setM(new Date(m.getFullYear(), m.getMonth() + 1, 1))}>›</button></div>
    <div className="calGrid">{['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <div key={i} className="dow">{d}</div>)}
      {Array.from({ length: first }, (_, i) => <div key={'x' + i} />)}
      {Array.from({ length: days }, (_, i) => { const d = new Date(m.getFullYear(), m.getMonth(), i + 1); const k = ymd(d); const past = d < today;
        return <button key={k} disabled={past} aria-label={d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })} aria-pressed={k === value} className={'day' + (k === value ? ' on' : '') + (+d === +today ? ' today' : '')} onClick={() => onChange(k)}>{i + 1}</button>; })}
    </div></div>;
}

function PlayerForm({ onAdd, label = 'Add', autoFocus, big, preset, known }: { onAdd: (p: Player, fromMemory?: boolean) => void | Promise<void>; label?: string; autoFocus?: boolean; big?: boolean; preset?: { name: string; dupr?: number } | null; known?: string[] }) {
  const [name, setName] = useState(preset?.name || ''); const [dupr, setDupr] = useState(preset?.dupr ? String(preset.dupr) : '');
  const [mine, setMine] = useState(!!preset?.name); const [busy, setBusy] = useState(false); const [edited, setEdited] = useState(false);
  const alive = useRef(true); const inputRef = useRef<HTMLInputElement>(null); const [idp] = useState(S.uid);
  useEffect(() => () => { alive.current = false; }, []);
  // Until they type, show the existing spelling of the remembered name (stats / this game / roster).
  const shown = !edited && preset?.name && known ? (canonicalName(preset.name, known) || name) : name;
  const change = () => { setEdited(true); setMine(false); setName(''); setDupr(''); inputRef.current?.focus(); };
  const submit = async () => {
    const n = known ? canonicalName(shown, known) : shown.trim(); if (!n || busy) return; setBusy(true);
    const fromMemory = mine && !!preset?.name && normName(n) === normName(preset.name);
    const d = Number(dupr);
    try { await onAdd({ id: S.uid(), name: n, dupr: dupr && Number.isFinite(d) && d > 0 ? d : undefined }, fromMemory); }
    finally { if (alive.current) setBusy(false); }
    if (!alive.current) return; setEdited(true); setName(''); setDupr(''); setMine(false);
  };
  return <div className="card pform">
    <div className="nameHead"><label htmlFor={idp + '-n'}>Player name</label>
      {mine && shown.trim() && <button type="button" className="ghost small notYou" onClick={change}>Not you? Change</button>}</div>
    <input id={idp + '-n'} ref={inputRef} autoFocus={autoFocus && !preset?.name} className="nameInput" placeholder="Full name" autoComplete={preset?.name ? 'off' : 'name'} autoCapitalize="words" maxLength={40} value={shown} onChange={e => { setEdited(true); setName(e.target.value); }} onKeyDown={e => e.key === 'Enter' && submit()} />
    <div className="duprRow"><label htmlFor={idp + '-d'}>DUPR <span className="opt-tag">(optional)</span></label>
      <input id={idp + '-d'} className="duprInput" placeholder="e.g. 3.75" inputMode="decimal" value={dupr} onChange={e => setDupr(e.target.value.replace(/[^0-9.]/g, '').slice(0, 5))} onKeyDown={e => e.key === 'Enter' && submit()} /></div>
    <button className={'primary full' + (big ? ' big' : '')} disabled={busy || !shown.trim()} onClick={submit}>{label}</button></div>;
}

function Roster() {
  const [r, setR] = useState(S.getRoster());
  const save = (x: Player[]) => { S.setRoster(x); setR(x); };
  return <div className="page"><Header title="Player Roster" back="" />
    <PlayerForm onAdd={p => save([...r, p])} label="Add player" />
    {r.sort((a, b) => a.name.localeCompare(b.name)).map(p => <div key={p.id} className="card row between"><span><b>{p.name}</b> <span className="muted">{p.dupr ? 'DUPR ' + p.dupr : ''}</span></span><button className="ghost danger" onClick={() => confirm('Remove ' + p.name + '?') && save(r.filter(x => x.id !== p.id))}>✕</button></div>)}
  </div>;
}

function localISO() { const d = new Date(); d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5, 0, 0); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); }

function NewEvent() {
  const roster = S.getRoster();
  const [step, setStep] = useState(1);
  const [name, setName] = useState('Pickleball ' + new Date().toLocaleDateString([], { weekday: 'long' }));
  const [date, setDate] = useState(localISO());
  const [place, setPlace] = useState(localStorage.getItem('pb:lastPlace') || '');
  const [format, setFormat] = useState<Format>('rotating');
  const [courtSet, setCourtSet] = useState<number[]>([1, 2, 3]); const courts = courtSet.length; const [rounds, setRounds] = useState(8);
  const [balance, setBalance] = useState(false); const [seeding, setSeeding] = useState<'random' | 'dupr'>('random');
  const [players, setPlayers] = useState<Player[]>([]);
  const [maxP, setMaxP] = useState(8); const [trophy, setTrophy] = useState(false);
  const [homeClub, setHomeClub] = useState(S.SC); const [awayClub, setAwayClub] = useState(''); const [nT, setNT] = useState(2);
  const [clubNames, setClubNames] = useState<{ home: string[][]; away: string[][] }>({ home: [['', ''], ['', '']], away: [['', ''], ['', '']] });
  const isClub = format === 'club';
  const setTeamsN = (n: number) => { setNT(n); setRounds(n); setCourtSet(Array.from({ length: n }, (_, i) => i + 1));
    const fit = (x: string[][]) => Array.from({ length: n }, (_, i) => x[i] || ['', '']); setClubNames({ home: fit(clubNames.home), away: fit(clubNames.away) }); };
  const pickFormat = (f: Format) => { setFormat(f); if (f === 'club') setTeamsN(nT); };
  useEffect(() => { if (players.length > maxP) { const c = fitCap(players.length); if (c) setMaxP(c); } }, [players.length, maxP]);
  const [busy, setBusy] = useState(false);
  const sel = new Set(players.map(p => p.id));
  const toggle = (p: Player) => setPlayers(sel.has(p.id) ? players.filter(x => x.id !== p.id) : [...players, p]);
  const create = async () => {
    setBusy(true); localStorage.setItem('pb:lastPlace', place);
    players.forEach(S.addToRoster);
    const code = S.newCode();
    const ev: EventT = isClub
      ? { id: code, name, date, place, format, courts, courtSet, totalRounds: rounds, balanceDupr: false, seeding: 'random', players: [], active: [], teams: [], rounds: [], createdAt: Date.now(), clubName: homeClub, club: newClub(homeClub.trim() || S.SC, awayClub.trim() || 'Visitors', nT), ...(trophy ? { trophy: true } : {}), ...(S.testMode() ? { hidden: true } : {}) }
      : { id: code, name, date, place, format, courts, courtSet, totalRounds: rounds, balanceDupr: balance, seeding, players, active: players.map(p => p.id), teams: [], rounds: [], createdAt: Date.now(), ...(players.length <= maxP ? { maxPlayers: maxP } : {}), ...(S.clubKey(homeClub) !== S.clubKey(S.SC) ? { clubName: homeClub } : {}), ...(trophy ? { trophy: true } : {}), ...(S.testMode() ? { hidden: true } : {}) };
    if (isClub) (['home', 'away'] as const).forEach(sd => clubNames[sd].forEach((t, i) => t.forEach((nm, k) => { if (nm.trim()) setClubSlot(ev, sd, i, k, nm); })));
    S.setOrg(code);
    S.saveLocal(code, ev, true);
    try { await S.pushRemote(code, ev); S.saveLocal(code, ev, false); } catch { /* will push later */ }
    go('e/' + code);
  };
  const unit = unitSize(format);
  return <div className="page"><Header title={`New Event · ${step}/3`} back="" />
    {step === 1 && <>
      <label htmlFor="ev-name">Event name</label><input id="ev-name" value={name} onChange={e => setName(e.target.value)} />
      <label id="day-l">Day</label><Calendar value={date.slice(0, 10)} onChange={d => setDate(d + date.slice(10))} />
      <label id="time-l">Time · <span className="pickedTime">{fmtWhen(date).day} {fmtWhen(date).time}</span></label>
      <TimeWheel h24={Number(date.slice(11, 13))} min={Number(date.slice(14, 16))} onChange={(h, m) => setDate(date.slice(0, 11) + String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0'))} />
      <label htmlFor="ev-place">Place</label><input id="ev-place" value={place} placeholder="e.g. the gym" onChange={e => setPlace(e.target.value)} />
      <label id="fmt-label">Format</label>
      <div role="radiogroup" aria-labelledby="fmt-label">{FORMATS.map(f => <button type="button" role="radio" aria-checked={format === f.id} key={f.id} className={'card tap fmt ' + (format === f.id ? 'sel' : '')} onClick={() => pickFormat(f.id)}><span className="radio" aria-hidden="true">{format === f.id ? '✓' : ''}</span><span className="fmtText"><b>{f.name}</b><span className="muted small">{f.desc}</span></span></button>)}</div>
      <ClubSelect id="club-home" label={isClub ? 'Home club (stats go to this club)' : 'Club (stats go to this club)'} value={homeClub} onChange={setHomeClub} allowAdd />
      {isClub && <div className="card clubSetup">
        <ClubSelect id="club-away" label="Visiting club" value={awayClub} onChange={setAwayClub} allowAdd exclude={homeClub} />
        <label>Teams per club</label><Stepper value={nT} min={1} max={8} onChange={setTeamsN} />
        <p className="muted small">{nT} home team{nT === 1 ? '' : 's'} vs {nT} visiting team{nT === 1 ? '' : 's'} · 2 players per team · {nT * 4} players</p></div>}
      <button className="big primary" disabled={isClub && (!awayClub.trim() || S.clubKey(awayClub) === S.clubKey(homeClub))} onClick={() => setStep(2)}>{isClub ? 'Next: Teams ›' : 'Next: Players ›'}</button></>}
    {step === 2 && isClub && <>
      <p className="muted small">Optional — type the teams now, or later in the lobby. Players can also join by the game link and you place them on a team. Visitor spots left empty play as guests (not counted in Overall stats).</p>
      {(['home', 'away'] as const).map(sd => <div key={sd} className="card clubSide"><h3>{sd === 'home' ? (homeClub || 'Home') : (awayClub || 'Visitors')}</h3>
        {clubNames[sd].map((t, i) => <div key={i} className="clubTeam"><span className="pairNo">{i + 1}</span>{t.map((v, k) => <input key={k} aria-label={`${sd === 'home' ? 'Home' : 'Visiting'} team ${i + 1} player ${k + 1}`} placeholder={sd === 'home' ? 'Name' : 'Guest'} maxLength={40} value={v}
          onChange={e => { const x = { home: clubNames.home.map(r => r.slice()), away: clubNames.away.map(r => r.slice()) }; x[sd][i][k] = e.target.value; setClubNames(x); }} />)}</div>)}</div>)}
      <div className="row"><button className="big" onClick={() => setStep(1)}>‹ Back</button><button className="big primary" onClick={() => setStep(3)}>Next ›</button></div></>}
    {step === 2 && !isClub && <>
      <p className="muted small">Optional — anyone can also join by name from the game link, including after the game has started.</p>
      <PlayerForm onAdd={p => { S.addToRoster(p); setPlayers([...players, p]); }} label="Add new player" />
      <div className="row between"><h2>{players.length} selected</h2><button className="ghost" onClick={() => setPlayers(players.length ? [] : roster)}>{players.length ? 'Clear' : 'Select all'}</button></div>
      <div className="chips">{[...roster, ...players.filter(p => !roster.some(r => r.id === p.id))].map(p => <button key={p.id} className={'chip ' + (sel.has(p.id) ? 'on' : '')} onClick={() => toggle(p)}>{p.name}{p.dupr ? ` · ${p.dupr}` : ''}</button>)}</div>
      {unit > 1 && <p className="muted small">{unit === 2 ? 'Pairs' : 'Teams of 4'} are formed when the game starts; anyone left over rotates in as a sub.</p>}
      <div className="row"><button className="big" onClick={() => setStep(1)}>‹ Back</button><button className="big primary" onClick={() => setStep(3)}>Next ›</button></div></>}
    {step === 3 && <>
      {!isClub && <><label id="max-l">Max players</label>
      <div className="row maxRow" role="radiogroup" aria-labelledby="max-l">{CAPS.map(c => <button key={c} type="button" role="radio" aria-checked={maxP === c} disabled={c < players.length} className={'chip maxChip ' + (maxP === c ? 'on' : '')} onClick={() => setMaxP(c)}>{c}</button>)}</div></>}
      {!isClub && <p className="muted small">Join closes once {maxP} players have signed up; if someone drops out, the spot opens again.</p>}
      <CourtPicker value={courtSet} onChange={setCourtSet} />
      {isClub ? <p className={'muted small clubCourtsNeed' + (courts !== nT ? ' warn' : '')} role="status">Pick exactly {nT} court{nT === 1 ? '' : 's'} — one per home team (picked {courts}). Home team 1 plays on the first court, team 2 on the next, and so on. Visiting teams move one court each round.</p>
      : <p className="muted small">Games start with exactly 4, 8, 12 or 16 players. Courts fill 4 at a time; if there are more players than courts, the extras sit out in fair rotation. Partners don't repeat until they have to.</p>}
      <label>Number of rounds</label><Stepper value={rounds} min={1} max={40} onChange={setRounds} />
      {isClub && <p className="muted small">{nT} round{nT === 1 ? '' : 's'} = every home team plays every visiting team once.</p>}
      {(format === 'kotc' || format === 'ladder' || unit > 1) && <><label>Starting order / teams</label>
        <div className="row"><button className={'chip ' + (seeding === 'random' ? 'on' : '')} onClick={() => setSeeding('random')}>Random</button><button className={'chip ' + (seeding === 'dupr' ? 'on' : '')} onClick={() => setSeeding('dupr')}>Seed by DUPR</button></div></>}
      {!isClub && <label className="row check"><input type="checkbox" checked={balance} onChange={e => setBalance(e.target.checked)} /> Balance matchups by DUPR</label>}
      <label className="row check trophyCheck"><input type="checkbox" checked={trophy} onChange={e => setTrophy(e.target.checked)} /> 🏆 Trophy match — 1st place wins a trophy</label>
      <div className="row"><button className="big" onClick={() => setStep(2)}>‹ Back</button><button className="big primary" disabled={busy || (isClub && courts !== nT)} onClick={create}>Create game <Ball /></button></div></>}
  </div>;
}

/** Pick courts by letter (A–H, More… for up to Z). At least one stays selected. */
function CourtPicker({ value, onChange, id = 'courts-l' }: { value: number[]; onChange: (v: number[]) => void; id?: string }) {
  const [more, setMore] = useState(false); const hi = value[value.length - 1] ?? 0; const n = value.length;
  return <><label id={id}>Courts</label>
    <div className="chips courtChips" role="group" aria-labelledby={id}>{Array.from({ length: more || hi > 8 ? 26 : 8 }, (_, i) => i + 1).map(c => { const on = value.includes(c);
      return <button key={c} type="button" aria-pressed={on} aria-label={'Court ' + courtName(c)} className={'chip courtChip ' + (on ? 'on' : '')} onClick={() => { if (on && n === 1) return; onChange(on ? value.filter(x => x !== c) : [...value, c].sort((a, b) => a - b)); }}>{courtName(c)}</button>; })}
      {!more && hi <= 8 && <button type="button" className="chip ghost moreCourts" onClick={() => setMore(true)}>More…</button>}</div>
    <p className="muted small courtRange">{n} court{n === 1 ? '' : 's'}: {courtsText({ courts: n, courtSet: value })}</p></>;
}

function Stepper({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (n: number) => void }) {
  return <div className="stepper"><button onClick={() => onChange(Math.max(min, value - 1))}>−</button><span>{value}</span><button onClick={() => onChange(Math.min(max, value + 1))}>+</button></div>;
}

type Tab = 'courts' | 'me' | 'schedule' | 'standings' | 'manage';
function EventView({ code, joining }: { code: string; joining?: boolean }) {
  const [ev, setEv] = useState<EventT | null>(S.localEvent(code));
  const [online, setOnline] = useState(true); const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>((S.takeTab(code) as Tab) || (joining || S.getMe(code) ? 'me' : 'courts'));
  const [stamp, setStamp] = useState<Date | null>(null); const [sharing, setSharing] = useState(false); const [watching, setWatching] = useState(false);
  const refresh = useCallback(async () => { setLoading(true); const r = await S.load(code); if (r.ev) setEv(r.ev); setOnline(r.online); setStamp(new Date()); setLoading(false); }, [code]);
  useEffect(() => { refresh(); const f = () => refresh(); addEventListener('online', f); return () => removeEventListener('online', f); }, [refresh]);
  usePullToRefresh(refresh);
  // Added-later games have no live play: open on Standings (with the Added later note)
  useEffect(() => { if (ev?.addedLater) setTab(t => t === 'courts' || t === 'me' ? 'standings' : t); }, [ev?.addedLater]);
  // Serialize writes so a quick second action never re-reads the server before the first one has landed.
  const queue = useRef<Promise<void>>(Promise.resolve());
  const act = (fn: (e: EventT) => void) => (queue.current = queue.current.then(async () => { const base = S.localEvent(code) || ev; if (!base) return; const r = await S.mutate(code, fn, base); setEv(r.ev); setOnline(r.online); setStamp(new Date()); }).catch(() => {}));
  // A late join changes who plays later, so the preview is redrawn. That save has to wait
  // behind any score already being entered, or it would put the old round back.
  useEffect(() => { if (ev && !loading && ensurePlan(JSON.parse(JSON.stringify(ev)))) act(e => { ensurePlan(e); }); }, [ev, loading, code]);
  if (!ev) return <div className="page"><Header title="Event" back="" />{loading ? <p>Loading…</p> : <p>Event {code} not found{online ? '' : ' (offline)'}.</p>}</div>;
  const nm = (id: string) => ev.players.find(p => p.id === id)?.name || '?';
  if (!ev.rounds.length) return <Lobby ev={ev} code={code} act={act} refresh={refresh} loading={loading} />;
  const meId = S.getMe(code); const member = !!meId && ev.players.some(p => p.id === meId && ev.active.includes(p.id));
  const enter = (id: string) => { const p = ev.players.find(x => x.id === id); if (p) S.rememberPlayer(p); S.setMe(code, id); setTab('me'); setWatching(true); };
  if (!member && !S.isOrg(code) && !watching && !ev.finished) {
    if (rosterOpen(ev) && isFull(ev)) return <FullCard ev={ev} onPick={enter} />;
    if (rosterOpen(ev)) return <LateJoin ev={ev} code={code} act={act} onPick={enter} onJoined={enter} />;
    return <Started ev={ev} code={code} onPick={enter} />;
  }
  return <div className="page withtabs">
    <header><button className="ghost" onClick={() => go('')}>‹</button><Logo size={34} /><div className="grow"><h1>{ev.name}</h1><div className="muted small">{fmtName(ev.format)} · {ev.place} · code <b>{code}</b></div></div>
      <button className="ghost hdrShare" onClick={() => shareGame(ev, code, () => setSharing(true))} aria-label="Share game"><ShareIcon /></button>
      <button className="ghost refresh" onClick={refresh} aria-label="Refresh">{loading ? '…' : <Icon n="refresh" size={22} />}</button></header>
    {sharing && <ShareGame ev={ev} code={code} onClose={() => setSharing(false)} />}
    <div className={'status ' + (online ? '' : 'off')}>{online ? (stamp ? 'Updated ' + stamp.toLocaleTimeString([], { timeStyle: 'short' }) + ' · pull down or tap refresh' : '') : 'Offline — changes saved on this phone, will upload when back online'}</div>
    {tab === 'courts' && <Courts ev={ev} act={act} nm={nm} me={S.getMe(code)} host={isHost(ev, code)} />}
    {tab === 'me' && <Me ev={ev} code={code} nm={nm} act={act} />}
    {tab === 'schedule' && <Schedule ev={ev} nm={nm} act={act} />}
    {tab === 'standings' && <Standings ev={ev} />}
    {tab === 'manage' && <Manage ev={ev} code={code} act={act} />}
    <nav className="tabs">{(['courts', 'me', 'schedule', 'standings', 'manage'] as Tab[]).map(t => <button key={t} className={tab === t ? 'on' : ''} onClick={() => { setTab(t); scrollTo(0, 0); }}>{{ courts: <><Ball /> Courts</>, me: <><Icon n="user" size={22} /> Me</>, schedule: <><Icon n="list" size={22} /> Rounds</>, standings: <><Icon n="trophy" size={22} /> Standings</>, manage: <><Icon n="settings" size={22} /> Manage</> }[t]}</button>)}</nav>
  </div>;
}

function usePullToRefresh(fn: () => void) {
  const start = useRef<number | null>(null);
  useEffect(() => {
    const ts = (e: TouchEvent) => { start.current = scrollY <= 0 ? e.touches[0].clientY : null; };
    const te = (e: TouchEvent) => { if (start.current != null && e.changedTouches[0].clientY - start.current > 90) fn(); start.current = null; };
    addEventListener('touchstart', ts, { passive: true }); addEventListener('touchend', te);
    return () => { removeEventListener('touchstart', ts); removeEventListener('touchend', te); };
  }, [fn]);
}

type Act = (fn: (e: EventT) => void) => Promise<void>;
/** The player who tapped Start is the host: only they can end the game or add rounds. Older games without a starter fall back to the creator's phone. */
export function isHost(ev: EventT, code: string) { const me = S.getMe(code); if (!ev.startedBy) return S.isOrg(code); if (ev.startedBy === 'organizer') return S.isOrg(code); return !!me && me === ev.startedBy; }
const hostName = (ev: EventT) => ev.players.find(p => p.id === ev.startedBy)?.name || 'the host';
function currentRound(ev: EventT) { return ev.rounds[ev.rounds.length - 1]; }
function roundLabel(ev: EventT, idx: number) { const r = ev.rounds[idx]; if (!r.playoff) return 'Round ' + r.n; const po = ev.rounds.filter(x => x.playoff); const left = po[po.indexOf(r)].matches.length; return left === 1 ? 'Final' : left === 2 ? 'Semifinals' : 'Quarterfinals'; }

type View = { kind: 'played'; idx: number; r: Round } | { kind: 'plan'; r: Round; n: number } | { kind: 'tbd'; n: number };
function allViews(ev: EventT): View[] {
  const v: View[] = ev.rounds.map((r, idx) => ({ kind: 'played', idx, r }));
  if (ev.finished || ev.rounds.some(r => r.playoff)) return v;
  const reg = ev.rounds.filter(r => !r.playoff).length;
  (ev.plan || []).forEach((r, k) => v.push({ kind: 'plan', r, n: reg + k + 1 }));
  for (let n = reg + (ev.plan?.length || 0) + 1; n <= ev.totalRounds; n++) v.push({ kind: 'tbd', n });
  return v;
}

function Courts({ ev, act, me, host }: { ev: EventT; act: Act; nm: (id: string) => string; me?: string; host: boolean }) {
  const views = allViews(ev); const curIdx = ev.rounds.length - 1;
  const [sel, setSel] = useState(curIdx);
  const lastCur = useRef(curIdx);
  useEffect(() => { if (lastCur.current !== curIdx) { lastCur.current = curIdx; setSel(curIdx); } }, [curIdx]);
  const vi = Math.min(Math.max(0, sel), views.length - 1); const v = views[vi];
  const [ask, setAsk] = useState(false);
  const r = currentRound(ev); const regular = ev.rounds.filter(x => !x.playoff).length; const isPO = !!r.playoff;
  const missing = unscoredCourts(r); const done = missing.length === 0;
  const advanceFn = (e: EventT) => { if (isPO || e.rounds.filter(x => !x.playoff).length >= e.totalRounds) { delete e.plan; const p = nextPlayoffRound(e); if (p) e.rounds.push(p); else e.finished = true; } else takeNextRound(e); };
  const advance = () => act(advanceFn);
  // Would this advance end the game? Only the host can do that.
  const willFinish = (() => { const c: EventT = JSON.parse(JSON.stringify(ev)); try { advanceFn(c); } catch { return false; } return !!c.finished; })();
  const canAdvance = host || !willFinish;
  const champion = ev.finished && isPO && r.matches.length === 1 && scored(r.matches[0]) ? (r.matches[0].sa! > r.matches[0].sb! ? r.matches[0].a : r.matches[0].b) : null;
  const tx = useRef<number | null>(null);
  const go2 = (d: number) => setSel(Math.min(Math.max(0, vi + d), views.length - 1));
  const title = v.kind === 'played' ? roundLabel(ev, v.idx) : 'Round ' + v.n;
  // names as of this round (subs show as "Guest (for Steve)")
  const vnm = (id: string) => slotName(ev, id, v.kind === 'played' ? subRound(v.r) : v.n);
  const showOf = v.kind !== 'played' || !v.r.playoff;
  const state = (x: View, i: number) => i === curIdx ? 'cur' : x.kind === 'played' ? (x.r.matches.every(scored) ? 'done' : 'part') : x.kind === 'plan' && isLocked(x.r) ? (x.r.matches.every(scored) ? 'done' : 'part') : 'up';
  const lastReg = !isPO && regular >= ev.totalRounds;
  const nextLabel = isPO ? (r.matches.length === 1 ? 'Finish event' : 'Next playoff round →') : regular >= ev.totalRounds ? (ev.club ? 'Finish game' : 'Start playoffs / finish →') : `Next: Round ${regular + 1} →`;
  return <div onTouchStart={e => { tx.current = e.touches[0].clientX; }} onTouchEnd={e => { if (tx.current == null) return; const dx = e.changedTouches[0].clientX - tx.current; tx.current = null; if (Math.abs(dx) > 60) go2(dx < 0 ? 1 : -1); }}>
    <div className="strip" role="tablist" aria-label="Rounds">{views.map((x, i) => <button key={i} role="tab" aria-selected={i === vi} aria-label={(x.kind === 'played' ? roundLabel(ev, x.idx) : 'Round ' + x.n) + ' ' + ({ cur: 'current', done: 'scored', part: 'partly scored', up: 'upcoming' } as Record<string, string>)[state(x, i)]} className={'dot ' + state(x, i) + (i === vi ? ' viewing' : '')} onClick={() => setSel(i)}>{x.kind === 'played' && x.r.playoff ? (roundLabel(ev, x.idx)[0]) : (x.kind === 'played' ? x.r.n : x.n)}{x.kind !== 'tbd' && x.r.matches.every(scored) && <i>✓</i>}</button>)}</div>
    <div className="roundNav"><button className="arrow" aria-label="Previous round" disabled={vi === 0} onClick={() => go2(-1)}>‹</button>
      <div className="rtitle"><h2>{title} {showOf && <span className="muted">of {ev.totalRounds}</span>}</h2><div className="small muted">{vi === curIdx ? (ev.finished ? 'Final round' : 'Now playing') : v.kind === 'played' ? 'Earlier round' : v.kind === 'plan' ? (isLocked(v.r) ? <>Playing ahead · pairings locked <Icon n="lock" size={14} /></> : 'Upcoming · preview') : 'Upcoming'}</div></div>
      <button className="arrow" aria-label="Next round" disabled={vi >= views.length - 1} onClick={() => go2(1)}>›</button></div>
    {vi === curIdx && champion && <div className="card champ"><Icon n="trophy" /> Champions: {champion.map(vnm).join(' & ')}</div>}
    {vi === curIdx && ev.finished && !champion && <div className="card champ"><Icon n="flag" /> Event finished — see Standings</div>}
    {ev.finished && <div className="lockNote readOnly" role="note"><Icon n="lock" size={18} /> Match complete · scores are final (read-only)</div>}
    {v.kind === 'tbd' ? <div className="card tbd">Pairings for Round {v.n} are drawn when it starts — {fmtName(ev.format)} moves players by results.</div> : <>
      {v.kind === 'plan' && !isLocked(v.r) && <p className="muted small">Pairings already drawn — courts can play ahead: enter a score and this round locks. Unscored previews redraw only if players or courts change.</p>}
      {v.r.matches.map((m, i) => <Fragment key={vi + '-' + i}>{ev.club && <div className="clubMatchup">{clubMatchup(ev, m)}</div>}<CourtCard m={m} nm={vnm} me={me} cn={n => courtLabel(ev, n)} onScore={ev.finished ? undefined : v.kind === 'played' ? (a, b) => act(e => { const mm = e.rounds[v.idx].matches[i]; mm.sa = a; mm.sb = b; }) : (a, b) => act(e => { ensurePlan(e); const pr = e.plan?.[vi - e.rounds.length]; if (pr && pr.matches[i]) { pr.matches[i].sa = a; pr.matches[i].sb = b; } })} /></Fragment>)}
      {v.r.byes.length > 0 && <div className={'card bye' + (me && v.r.byes.includes(me) ? ' mine' : '')}><div className="courtHead"><span>Sitting out</span>{me && v.r.byes.includes(me) && <span className="tag">You</span>}</div><div className="byeNames">{v.r.byes.map(vnm).join(' · ')}</div></div>}</>}
    {vi === curIdx && !ev.finished && !(lastReg) && canAdvance && <button className={'big next ' + (done ? 'primary' : '')} onClick={() => missing.length ? setAsk(true) : advance()}>{nextLabel}</button>}
    {vi === curIdx && !ev.finished && !canAdvance && !lastReg && <div className="card hostOnly" role="note"><Icon n="lock" size={18} /> Only {hostName(ev)} (who started the game) can finish it.</div>}
    {vi === curIdx && !ev.finished && lastReg && !host && <div className="card lastRound hostOnly"><b>That's the last round.</b><div className="muted small">Only {hostName(ev)} (who started the game) can end it or add rounds.</div>
      {canAdvance && <button className="big" onClick={() => missing.length ? setAsk(true) : advance()}>Start playoffs ›</button>}</div>}
    {vi === curIdx && !ev.finished && lastReg && host && <div className="card lastRound"><b>That's the last round.</b>
      <button className="big primary" onClick={() => act(e => endEvent(e))}><Icon n="flag" /> End now</button>
      <div className="row addR"><button onClick={() => act(e => addRounds(e, 1))}>+1 round</button><button onClick={() => act(e => addRounds(e, 3))}>+3 rounds</button><button onClick={() => { const n = Number(prompt('How many more rounds?', '2')); if (n > 0) act(e => addRounds(e, n)); }}>Custom…</button></div>
      <button className="big" onClick={() => missing.length ? setAsk(true) : advance()}>Start playoffs ›</button></div>}
    {vi !== curIdx && <button className="big" onClick={() => setSel(curIdx)}>Back to current round</button>}
    {ask && <div className="sheetBg" onClick={() => setAsk(false)}><div className="sheet" role="alertdialog" aria-modal="true" aria-labelledby="unsc-t" onClick={e => e.stopPropagation()}>
      <h2 id="unsc-t"><Icon n="alert" size={22} /> {missing.length === 1 ? '1 court has' : missing.length + ' courts have'} no score</h2>
      <p>Court {missing.map(n => courtLabel(ev, n)).join(', ')} {missing.length === 1 ? "hasn't" : "haven't"} been scored. If you continue, {missing.length === 1 ? 'that game' : 'those games'} won't count in the standings.</p>
      <button className="big primary" onClick={() => setAsk(false)}>Go back and enter scores</button>
      <button className="big danger" onClick={() => { setAsk(false); advance(); }}>Continue anyway</button></div></div>}
  </div>;
}

function CourtCard({ m, nm, onScore, me, label, compact, onName, cn = courtName }: { m: Match; nm: (id: string) => string; onScore?: (a: number, b: number) => void; me?: string; label?: string; compact?: boolean; onName?: (id: string) => void; cn?: (n: number) => string }) {
  const [a, setA] = useState<number | ''>(m.sa ?? ''); const [b, setB] = useState<number | ''>(m.sb ?? '');
  useEffect(() => { setA(m.sa ?? ''); setB(m.sb ?? ''); }, [m.sa, m.sb]);
  const [edit, setEdit] = useState(false);
  const has = m.sa != null && m.sb != null; const winA = has && m.sa! > m.sb!;
  const mine = !!me && (m.a.includes(me) || m.b.includes(me));
  const entering = !!onScore && (!has || edit);
  const side = (t: string[], v: number | '', set: (n: number | '') => void, pts: number | undefined, win: boolean, tag: string) => <div className={'side ' + (has && !entering ? (win ? 'win' : 'lose') : '') + (me && t.includes(me) ? ' myside' : '')}>
    <div className="names" aria-label={'Team ' + tag}>{t.map(p => onName ? <div key={p}><button className={'nameBtn' + (p === me ? ' meName' : '')} aria-label={'Player ' + nm(p) + ' options'} onClick={() => onName(p)}><Avatar name={nm(p)} size={22} /> {nm(p)}</button></div> : <div key={p} className={p === me ? 'meName' : ''}><Avatar name={nm(p)} size={22} /> {nm(p)}</div>)}</div>
    {entering ? <ScoreBox v={v} set={set} label={'Team ' + tag + ' score'} last={tag === 'B'} onDone={() => { if (a !== '' && b !== '' && a !== b && onScore) { onScore(Number(a), Number(b)); setEdit(false); } }} /> : <div className="pts" aria-label={'Team ' + tag + ' points'}>{pts ?? '–'}</div>}
  </div>;
  return <div className={'card match' + (mine ? ' mine' : '') + (compact ? ' compact' : '')}>
    <div className="courtHead"><span className="court">{label ?? 'Court ' + cn(m.court)}</span>{mine && <span className="tag">You &amp; partner</span>}{has && !entering && <span className="final">Final</span>}</div>
    {side(m.a, a, setA, m.sa, winA, 'A')}<div className="vsLine"><span>VS</span></div>{side(m.b, b, setB, m.sb, has && !winA, 'B')}
    {onScore && (entering ? <button className="primary full" disabled={a === '' || b === '' || a === b} onClick={() => { onScore(Number(a), Number(b)); setEdit(false); }}>Save score</button>
      : <button className="ghost small editBtn" onClick={() => setEdit(true)}>Edit score</button>)}
  </div>;
}
/** Typed-only score: number pad, starts empty ('–'), any whole number 0–99. Two digits (or Next) jumps to the other team's box. */
function ScoreBox({ v, set, label = 'Score', onDone, last }: { v: number | ''; set: (n: number | '') => void; label?: string; onDone?: () => void; last?: boolean }) {
  const advance = (el: HTMLInputElement) => { const boxes = [...(el.closest('.match')?.querySelectorAll<HTMLInputElement>('.scorebox input') || [])]; const nxt = boxes[boxes.indexOf(el) + 1]; if (nxt) nxt.focus(); else onDone?.(); };
  return <div className="scorebox"><input type="text" inputMode="numeric" pattern="[0-9]*" enterKeyHint={last ? 'done' : 'next'} autoComplete="off" aria-label={label} placeholder="–" onFocus={e => e.target.select()} value={v}
    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); advance(e.currentTarget); } }}
    onChange={e => { const d = e.target.value.replace(/\D/g, '').slice(0, 2); set(d === '' ? '' : Number(d)); if (d.length === 2 && !last) advance(e.target); }} /></div>;
}

function Me({ ev, code, nm }: { ev: EventT; code: string; nm: (id: string) => string; act?: Act }) {
  const [me, setMeS] = useState(S.getMe(code));
  const pick = (id: string) => { S.setMe(code, id); setMeS(id); if (id) S.rememberPlayer(ev.players.find(x => x.id === id)); };
  if (!me || !ev.players.some(p => p.id === me)) return <div className="card"><h3 className="small muted">Already playing? Tap your name. New players use the game link — they join the next round.</h3>
    <div className="chips">{ev.players.filter(p => ev.active.includes(p.id)).sort((a, b) => a.name.localeCompare(b.name)).map(p => <button key={p.id} className="chip" onClick={() => pick(p.id)}>{p.name}</button>)}</div></div>;
  const mine = ev.rounds.map((r, i) => ({ r, i, m: r.matches.find(m => m.a.includes(me) || m.b.includes(me)), bye: r.byes.includes(me) }));
  const cur = mine[mine.length - 1];
  const st = standings(ev); const rank = st.findIndex(s => s.id === me);
  const s = st[rank];
  const partner = (m: Match) => (m.a.includes(me) ? m.a : m.b).filter(p => p !== me);
  const opps = (m: Match) => (m.a.includes(me) ? m.b : m.a);
  return <div>
    <div className="row between"><h2>Hi, {nm(me)}</h2><button className="ghost small" onClick={() => pick('')}>Not you?</button></div>
    <div className="card next">{ev.finished ? <b>Event finished</b> : cur?.m ? <>
      <div className="muted">{scored(cur.m) ? 'Your latest game' : 'Your game now'} · {roundLabel(ev, cur.i)}</div>
      <div className="bigcourt">Court {courtLabel(ev, cur.m.court)}</div>
      <div>Partner: <b>{partner(cur.m).map(id => slotName(ev, id, subRound(cur.r))).join(', ') || '—'}</b></div>
      <div>vs <b>{opps(cur.m).map(id => slotName(ev, id, subRound(cur.r))).join(' & ')}</b></div></> : cur?.bye ? <b>You're sitting out this round</b> : <b>Not in the current round</b>}</div>
    {s && <div className="card"><b>#{rank + 1}</b> · {s.w}W–{s.l}L · diff {s.diff > 0 ? '+' : ''}{s.diff} · {s.pf} pts</div>}
    <h2>Your games</h2>
    {mine.map(({ i, r, m, bye }) => m ? <CourtCard key={i} compact m={m} nm={id => slotName(ev, id, subRound(r))} me={me} label={roundLabel(ev, i) + ' · Court ' + courtLabel(ev, m.court)} /> : bye ? <div key={i} className="card bye compact"><div className="courtHead"><span className="court">{roundLabel(ev, i)}</span></div>Sitting out</div> : null)}
    {(ev.plan || []).map((r, k) => { const m = r.matches.find(m => m.a.includes(me) || m.b.includes(me)); const n = ev.rounds.filter(x => !x.playoff).length + k + 1; return m ? <CourtCard key={'p' + k} compact m={m} nm={id => slotName(ev, id, n)} me={me} label={'Round ' + n + ' · Court ' + courtLabel(ev, m.court) + ' · upcoming'} /> : <div key={'p' + k} className="card bye compact"><div className="courtHead"><span className="court">Round {n} · upcoming</span></div>Sitting out</div>; })}
    <h2>Standings</h2><Standings ev={ev} me={me} />
  </div>;
}

function Schedule({ ev, act }: { ev: EventT; nm: (id: string) => string; act: Act }) {
  return <div>{[...ev.rounds].map((r, i) => <details key={i} open={i === ev.rounds.length - 1}><summary>{roundLabel(ev, i)} <span className="muted">{r.matches.filter(scored).length}/{r.matches.length} scored</span></summary>
    {r.matches.map((m, j) => <CourtCard key={j} m={m} nm={id => slotName(ev, id, subRound(r))} cn={n => courtLabel(ev, n)} onScore={ev.finished ? undefined : (a, b) => act(e => { e.rounds[i].matches[j].sa = a; e.rounds[i].matches[j].sb = b; })} />)}
    {r.byes.length > 0 && <div className="muted small">Sat out: {r.byes.map(id => slotName(ev, id, subRound(r))).join(', ')}</div>}
  </details>).reverse()}</div>;
}

function clubMatchup(ev: EventT, m: Match) {
  const c = ev.club!; const key = (t: string[]) => [...t].sort().join();
  const hi = c.homeTeams.findIndex(t => key(t) === key(m.a)); const ai = c.awayTeams.findIndex(t => key(t) === key(m.b));
  return <>{c.home} {hi + 1} <span className="muted">vs</span> {c.away} {ai + 1}</>;
}
function ClubBoard({ ev }: { ev: EventT }) {
  const s = clubStandings(ev); const c = ev.club!;
  const lead = s.totals.home.won === s.totals.away.won ? 0 : s.totals.home.won > s.totals.away.won ? 1 : -1;
  const tbl = (rows: typeof s.home) => <table className="clubTable"><thead><tr><th>Team</th><th>W</th><th>L</th><th>+/-</th></tr></thead><tbody>{rows.map(r => <tr key={r.side + r.idx}><td>{r.label}<div className="muted small">{r.names}</div></td><td>{r.w}</td><td>{r.l}</td><td>{r.diff > 0 ? '+' : ''}{r.diff}</td></tr>)}</tbody></table>;
  return <div className="clubBoard">
    <div className="card clubTotals" role="status" aria-label="Club totals">
      <div className={'clubTot' + (lead > 0 ? ' lead' : '')}><div className="clubName">{c.home}</div><div className="clubWon">{s.totals.home.won}</div><div className="muted small">matches won · {s.totals.home.pf} pts</div></div>
      <div className="muted">vs</div>
      <div className={'clubTot' + (lead < 0 ? ' lead' : '')}><div className="clubName">{c.away}</div><div className="clubWon">{s.totals.away.won}</div><div className="muted small">matches won · {s.totals.away.pf} pts</div></div></div>
    <h3>{c.home} teams</h3>{tbl(s.home)}<h3>{c.away} teams</h3>{tbl(s.away)}<h3>Players</h3></div>;
}
function ClubTeams({ ev, act, edit, me }: { ev: EventT; act: Act; edit: boolean; me?: string }) {
  const c = ev.club!; const nm = (id: string) => ev.players.find(p => p.id === id)?.name || '';
  const placed = new Set([...c.homeTeams.flat(), ...c.awayTeams.flat()]);
  const free = ev.players.filter(p => ev.active.includes(p.id) && !placed.has(p.id));
  const freeOf = (sd: 'home' | 'away') => free.filter(p => !p.side || p.side === sd);
  const mine = ev.players.find(p => p.id === me); const iPlaced = !!me && placed.has(me);
  const take = (sd: 'home' | 'away', i: number, k: number) => { let bad = false; act(x => { if (x.rounds.length) return; const mp = x.players.find(p => p.id === me); if (!mp || !setClubSlot(x, sd, i, k, mp.name)) bad = true; }).then(() => { if (bad) alert("Couldn't take that spot — try again."); }); };
  const leave = (sd: 'home' | 'away', i: number, k: number) => act(x => { if (x.rounds.length) return; const t = (sd === 'home' ? x.club!.homeTeams : x.club!.awayTeams)[i]; if (t[k] === me) t[k] = ''; });
  const side = (sd: 'home' | 'away') => <div className="card clubSide" key={sd}><h3>{sd === 'home' ? c.home : c.away}</h3>
    {(sd === 'home' ? c.homeTeams : c.awayTeams).map((t, i) => <div className="clubTeam" key={i}><span className="pairNo">{i + 1}</span>
      {t.map((id, k) => { const label = `${sd === 'home' ? 'Home' : 'Visiting'} team ${i + 1} player ${k + 1}`;
        if (!edit && id && id === me) return <span key={k} className="chip static on mySpot" aria-label={label}>{nm(id)} <button className="ghost small" aria-label="Leave this spot" onClick={() => leave(sd, i, k)}>✕</button></span>;
        if (!edit && !id && mine && !iPlaced && (!mine.side || mine.side === sd)) return <button key={k} className="chip takeSpot" aria-label={'Take ' + label} onClick={() => take(sd, i, k)}>Take this spot</button>;
        return edit ? <input key={k + ':' + id} list={'club-free-' + sd} aria-label={label} defaultValue={nm(id)} placeholder={sd === 'home' ? 'Name' : 'Guest'} maxLength={40}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          onBlur={e => { const v = e.target.value.trim(); if (v === nm(id)) return; let bad = false; act(x => { if (x.rounds.length) return; if (!setClubSlot(x, sd, i, k, v)) bad = true; }).then(() => { if (bad) alert(v + ' is already on another team.'); }); }} />
          : <span key={k} className={'chip static' + (id ? '' : ' empty')} aria-label={label}>{id ? nm(id) : (sd === 'home' ? 'open' : 'guest')}</span>; })}</div>)}</div>;
  const list = (sd: 'home' | 'away', title: string) => { const xs = free.filter(p => p.side === sd); return xs.length > 0 && <p className={'muted small clubFree clubFree-' + sd}>{title} joined, not on a team yet: <b>{xs.map(p => p.name).join(', ')}</b>{edit ? ' — type a name into a team spot.' : ''}</p>; };
  const other = free.filter(p => !p.side);
  return <div className="clubTeams">{(['home', 'away'] as const).map(sd => <datalist key={sd} id={'club-free-' + sd}>{freeOf(sd).map(p => <option key={p.id} value={p.name} />)}</datalist>)}{side('home')}{side('away')}
    {list('home', c.home)}{list('away', c.away + ' (visitors)')}
    {other.length > 0 && <p className="muted small clubFree">Joined, not on a team yet: <b>{other.map(p => p.name).join(', ')}</b>{edit ? ' — type a name into a team spot.' : ''}</p>}
    {mine && !iPlaced && !edit && <p className="small clubPickHint">Tap “Take this spot” on an open {mine.side === 'away' ? c.away : mine.side === 'home' ? c.home : ''} team spot.</p>}
    <p className="muted small">Empty visitor spots play as guests (not counted in Overall stats).</p></div>;
}
function Standings({ ev, me }: { ev: EventT; me?: string }) {
  const st = standings(ev); const tw = trophyWinners(ev); const twIds = new Set(tw.map(t => t.id));
  const [tc, setTc] = useState<Record<string, number>>({});
  useEffect(() => { const c = ev.format === 'club' && ev.club ? ev.club.home : ev.clubName || S.SC; S.statsBoard(c).then(b => setTc(Object.fromEntries(b.filter(x => x.trophies).map(x => [x.k, x.trophies!])))).catch(() => {}); }, [ev.finished, ev.clubName, ev.format, ev.club]);
  const teams = unitSize(ev.format) > 1;
  return <div>
    {ev.addedLater && <PastOwnerBar ev={ev} />}
    {tw.length > 0 && <div className="card trophyWin" role="status"><span aria-hidden="true">🏆</span> {tw.length > 1 ? 'Winners' : 'Winner'}: <b>{tw.map(t => t.name).join(' & ')}</b>{tw.length > 1 ? ' (co-winners)' : ''}</div>}
    <div className={'lockNote ' + (ev.finished ? 'readOnly' : 'liveNote')} role="note">{ev.finished ? <><Icon n="lock" size={18} /> Final standings · match complete</> : <>Live · updates as scores are entered · counts toward Overall stats once the match ends</>}</div>
    {ev.trophy && !ev.finished && <div className="card trophyNote"><span aria-hidden="true">🏆</span> Trophy match — 1st place wins a trophy when the game is completed</div>}
    {ev.finished && st[0] && !tw.length && <div className="card champ"><Icon n="medal" /> Top player: {st[0].name} ({st[0].w}W, {st[0].diff > 0 ? '+' : ''}{st[0].diff})</div>}
    {ev.club && <ClubBoard ev={ev} />}
    {teams && !ev.club && <><h3>Teams</h3><table><thead><tr><th>#</th><th>Team</th><th>W</th><th>L</th><th>+/-</th></tr></thead><tbody>{teamStandings(ev).map((t, i) => <tr key={t.id}><td>{i + 1}</td><td>{t.name}</td><td>{t.w}</td><td>{t.l}</td><td>{t.diff}</td></tr>)}</tbody></table><h3>Players</h3></>}
    <table><thead><tr><th>#</th><th>Player</th><th>W</th><th>L</th><th>Win%</th><th>GP</th><th>PF</th><th>PA</th><th>+/-</th></tr></thead>
      <tbody>{st.map((s, i) => <tr key={s.id} className={s.id === me ? 'meRow' : ''}><td>{i + 1}</td><td><Avatar name={s.name} size={22} /> {s.name}{twIds.has(s.id) && <span className="trophyBadge" aria-label="trophy">🏆</span>}<TrophyBadge n={tc[s.name.trim().toLowerCase()]} />{s.id.startsWith('sub:') ? <span className="wd subTag">sub</span> : !ev.active.includes(s.id) ? <span className="wd">withdrawn</span> : ''}</td><td>{s.w}</td><td>{s.l}</td><td>{s.gp ? Math.round(100 * s.w / s.gp) + '%' : '–'}</td><td>{s.gp}</td><td>{s.pf}</td><td>{s.pa}</td><td>{s.diff > 0 ? '+' : ''}{s.diff}</td></tr>)}</tbody></table>
    <p className="muted small">Ranked by win %, then point differential, then games played. Playoff games not included.</p>
  </div>;
}

function Manage({ ev, code, act }: { ev: EventT; code: string; act: Act }) {
  const link = gameLink(code);
  const [sharing, setSharing] = useState(false);
  const download = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([toCSV(ev)], { type: 'text/csv' })); a.download = ev.name.replace(/\W+/g, '_') + '.csv'; a.click(); };
  const unit = unitSize(ev.format);
  const host = isHost(ev, code);
  return <div>
    <div className="card"><b>Share with players</b><div className="muted small break">{link}</div><div className="row shareRow"><button className="primary" onClick={() => shareGame(ev, code, () => setSharing(true))}>Share game</button></div></div>
    {sharing && <ShareGame ev={ev} code={code} onClose={() => setSharing(false)} />}
    <h2>Players ({ev.active.length} playing)</h2>
    {rosterOpen(ev) && host && <LateRoster ev={ev} act={act} />}
    {rosterOpen(ev) && !host && <><div className="lockNote" role="note"><Icon n="lock" size={18} /> Players can still join with the game link. Only {hostName(ev)} can add or remove someone.</div>
      <div className="chips">{ev.players.filter(p => ev.active.includes(p.id)).map(p => <span key={p.id} className="chip static">{p.name}</span>)}</div></>}
    {!rosterOpen(ev) && <div className="lockNote" role="note"><Icon n="lock" size={18} /> Roster locked{ev.format === 'club' ? ' for Club vs Club' : ev.rounds.some(r => r.playoff) ? ' once playoffs start' : ''}. The starter can still sub someone in below.</div>}
    {!rosterOpen(ev) && <div className="chips">{ev.players.filter(p => ev.active.includes(p.id)).map(p => <span key={p.id} className="chip static">{p.name}</span>)}</div>}
    <SubIn ev={ev} act={act} host={host} />
    <h2>Settings</h2>
    <div className="lockNote" role="note"><Icon n="lock" size={18} /> Locked: game started</div>
    <div className="card locked"><div className="muted small">Day &amp; time</div><div className="lockedVal">{fmtWhen(ev.date).day} {fmtWhen(ev.date).date} · {fmtWhen(ev.date).time}</div>
      <div className="muted small">Courts · Format</div><div className="lockedVal">{ev.courts} court{ev.courts === 1 ? '' : 's'} ({courtsText(ev)}) · {fmtName(ev.format)}{ev.balanceDupr ? ' · DUPR balanced' : ''}</div>
      {unit > 1 && <><div className="muted small">{unit === 2 ? 'Pairs' : 'Teams'}</div><div className="lockedVal">{ev.teams.filter(t => t.length === unit).map(t => t.map(id => ev.players.find(p => p.id === id)?.name || '?').join(' & ')).join(' · ')}</div></>}</div>
    {host ? <><label>Total rounds</label><Stepper value={ev.totalRounds} min={Math.max(1, ev.rounds.filter(r => !r.playoff).length)} max={60} onChange={n => act(e => { e.totalRounds = n; e.finished = false; })} />
      {!ev.finished && <button className="big danger" onClick={() => confirm('End the event now? Standings are final; unplayed rounds are dropped.') && act(e => endEvent(e))}><Icon n="flag" /> End early</button>}
</>
      : <div className="card hostOnly" role="note"><Icon n="lock" size={18} /> {ev.totalRounds} rounds · only {hostName(ev)} (who started the game) can end it or add rounds.</div>}
    <button className="big" onClick={download}><Icon n="download" /> Export scores (CSV)</button>
    <button className="big" onClick={() => { const code2 = S.newCode(); const copy: EventT = { ...JSON.parse(JSON.stringify(ev)), id: code2, rounds: [], finished: false, date: localISO(), createdAt: Date.now() }; delete copy.plan; delete copy.planKey; delete copy.startedAt; delete copy.startedBy; delete copy.host; S.setOrg(code2); S.saveLocal(code2, copy, true); S.pushRemote(code2, copy).then(() => S.saveLocal(code2, copy, false)).catch(() => {}); go('e/' + code2); }}><Icon n="copy" /> Duplicate as new event</button>
    <button className="big danger" onClick={() => confirm('Remove from this phone? (Others with the link keep it.)') && (S.forget(code), go(''))}>Remove from my list</button>
  </div>;
}

function Lobby({ ev, code, act, refresh, loading }: { ev: EventT; code: string; act: Act; refresh: () => void; loading: boolean }) {
  const [me, setMeS] = useState(S.getMe(code)); const [ask, setAsk] = useState(false); const [starting, setStarting] = useState(false);
  const [pickC, setPickC] = useState<number[]>([]); const [icFor, setIcFor] = useState('');
  const openStart = () => { setPickC(courtList(ev)); setAsk(true); };
  const start = () => { const cs = pickC.length ? pickC : courtList(ev); setAsk(false); if (starting) return; setStarting(true); const stamp = Date.now();
    // Start once: if someone else already started, startEvent is a no-op on the fresh server copy and the API refuses a second draw.
    act(e => { if (e.rounds.length || !(e.club ? clubReady(e.club) && cs.length === e.club.n : startOk(e.active.length))) return; e.courts = cs.length; e.courtSet = cs; startEvent(e); e.startedAt = stamp; e.startedBy = me || 'organizer'; if (!e.host) e.host = me || 'organizer'; })
      .then(() => { if (S.localEvent(code)?.startedAt === stamp) S.setOrg(code); setStarting(false); refresh(); }); };
  const pick = (id: string) => { S.setMe(code, id); setMeS(id); if (id) S.rememberPlayer((S.localEvent(code) || ev).players.find(x => x.id === id)); };
  // This phone forgets a name that was removed (by the creator) or dropped elsewhere, so it can join again.
  useEffect(() => { if (me && !loading && !ev.players.some(p => p.id === me)) { S.setMe(code, ''); setMeS(''); } }, [me, loading, ev, code]);
  const joined = ev.players.filter(p => ev.active.includes(p.id));
  const cap = capOf(ev); const full = isFull(ev);
  const club = ev.format === 'club' && ev.club ? ev.club : null;
  const canStart = S.isOrg(code) || (!!me && ev.players.some(p => p.id === me)); const ok = club ? clubReady(club) : startOk(joined.length);
  const courtsOk = !club || pickC.length === club.n;
  const org = S.isOrg(code);
  const drop = (id: string, name: string, self: boolean) => { if (!confirm(self ? 'Drop out of this game?' : 'Remove ' + name + ' from this game?')) return;
    act(e => { removePlayer(e, id); }).then(() => { if (self) pick(''); }); };
  const cancelGame = async () => { if (!confirm('Cancel and delete this game for everyone? This can\'t be undone.')) return;
    try { await S.deleteRemote(code); S.forget(code); go(''); } catch (e) { alert(String(e).includes('started') ? 'This game already started and can no longer be cancelled.' : 'Could not cancel (offline?). Try again.'); } };
  const w = fmtWhen(ev.date); const link = gameLink(code);
  const [sharing, setSharing] = useState(false);
  // Rename before the start: the creator's phone or an admin. Saved like any other lobby edit (server bumps the version).
  const canRename = org || !!S.adminKey(); const [renaming, setRenaming] = useState<string | null>(null);
  const saveName = () => { const n = (renaming || '').trim().replace(/\s+/g, ' ').slice(0, 60); setRenaming(null); if (!n || n === ev.name) return; act(e => { if (!e.rounds.length) e.name = n; }); };
  return <div className="page">
    <header><button className="ghost" onClick={() => go('')} aria-label="Back">‹</button><div className="grow"><h1>{ev.name}</h1><div className="muted small">{fmtName(ev.format)} · code <b>{code}</b></div></div>
      <button className="ghost refresh" onClick={refresh} aria-label="Refresh">{loading ? '…' : <Icon n="refresh" size={22} />}</button></header>
    {canRename && (renaming === null ? <button className="ghost small editName" onClick={() => setRenaming(ev.name)}>Edit name</button>
      : <div className="card nameEdit"><label htmlFor="lobby-name">Game name</label><input id="lobby-name" autoFocus maxLength={60} value={renaming} onChange={e => setRenaming(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') setRenaming(null); }} />
        <div className="row"><button className="primary" disabled={!renaming.trim()} onClick={saveName}>Save name</button><button className="ghost" onClick={() => setRenaming(null)}>Cancel</button></div></div>)}
    <div className="card lobbyWhen"><div className="when"><div className="wday">{w.day.slice(0, 3)}</div><div className="wdate">{w.date}</div></div><div><b>{w.day} · {w.time}</b><div className="muted">{ev.place || 'Place TBA'}</div><div className="muted small">{ev.courts} courts ({courtsText(ev)}) · {ev.totalRounds} rounds{cap ? ` · max ${cap} players` : ''}</div></div></div>
    <div className="lobbyStatus"><span className="pulse" aria-hidden="true" /> {full ? 'Full' : 'Signing up'} · <b>{joined.length} joined</b>{cap ? <span className="muted"> · {cap} max</span> : null}</div>
    {org && !club && <div className="card maxEdit"><div className="muted small" id="lobby-max-l">Max players (only you can change this until the game starts)</div>
      <div className="row maxRow" role="radiogroup" aria-labelledby="lobby-max-l">{CAPS.map(c => <button key={c} type="button" role="radio" aria-checked={cap === c} disabled={c < joined.length} className={'chip maxChip ' + (cap === c ? 'on' : '')}
        onClick={() => cap !== c && act(e => { if (!e.rounds.length && c >= new Set(e.active).size) e.maxPlayers = c; })}>{c}</button>)}</div>
      {!cap && <div className="muted small">No limit set</div>}</div>}
    {canStart && <button className="big primary huge" disabled={starting || !ok} onClick={() => ok && openStart()}><Icon n="play" /> {starting ? 'Starting…' : 'Start game'}</button>}
    {canStart && !ok && <p className="startNeed" role="status">{club ? 'Fill every home team spot to start (empty visitor spots play as guests)' : `Need 4, 8, 12 or 16 players to start (have ${joined.length})`}</p>}
    {club && <ClubTeams ev={ev} act={act} edit={org} me={me} />}
    {!me && full && <FullCard ev={ev} onPick={pick} />}
    {!me && !full && <JoinForm ev={ev} onJoin={(p, fromMemory) => { const done = act(e => { if (e.rounds.length || nameTaken(e, p.name) || isFull(e)) return; e.players.push(p); e.active.push(p.id); }); return done.then(() => { const cur = S.localEvent(code); if (cur?.players.some(x => x.id === p.id)) { pick(p.id); return; } const same = fromMemory ? cur?.players.find(x => cur.active.includes(x.id) && normName(x.name) === normName(p.name)) : undefined; if (same) { pick(same.id); return; } if (cur && isFull(cur)) alert('Game is full. All ' + capOf(cur) + ' spots are taken. If someone drops out, a spot opens up.'); else if (cur?.rounds.length) refresh(); else alert('Someone named "' + p.name.trim() + '" is already in this game. If that\'s you, tap your name below; otherwise add a last initial.'); }); }} onPick={pick} />}
    {me && ev.players.some(p => p.id === me) && <div className="card youIn"><Icon n="checkCircle" /> You're in as <b>{ev.players.find(p => p.id === me)!.name}</b> <button className="ghost small" onClick={() => pick('')}>Not you?</button> <button className="ghost small" onClick={() => setIcFor(ev.players.find(p => p.id === me)!.name)}>Set icon</button></div>}
    {icFor && <IconEditor name={icFor} onClose={() => setIcFor('')} />}
    {unitSize(ev.format) === 2 && canStart && <PairBuilder ev={ev} act={act} />}
    <h2>Players ({joined.length})</h2>
    <ul className="lobbyList">{joined.map(p => <li key={p.id} className={'lobbyRow' + (p.id === me ? ' on' : '')}><span className="grow"><Avatar name={p.name} /> {p.name}{p.id === me && <span className="tag">You</span>}</span>
      {p.id === me ? <button className="ghost small danger dropBtn" onClick={() => drop(p.id, p.name, true)}>Drop out</button>
        : org && <button className="ghost small danger" aria-label={'Remove ' + p.name} onClick={() => drop(p.id, p.name, false)}>✕</button>}</li>)}</ul>
    {joined.length === 0 && <p className="muted">No one yet — share the link.</p>}
    {org && <button className="big danger cancelGame" onClick={cancelGame}>Cancel game</button>}
    <div className="row shareRow"><button className="big primary shareBig" onClick={() => shareGame(ev, code, () => setSharing(true))}>Share game</button></div>
    {sharing && <ShareGame ev={ev} code={code} onClose={() => setSharing(false)} />}
    {ask && <div className="sheetBg" onClick={() => setAsk(false)}><div className="sheet" role="alertdialog" aria-modal="true" aria-labelledby="st-t" onClick={e => e.stopPropagation()}>
      <h2 id="st-t">{club ? `Start ${club.home} vs ${club.away}?` : `Start with ${joined.length} player${joined.length === 1 ? '' : 's'}?`}</h2>
      <CourtPicker id="start-courts-l" value={pickC} onChange={setPickC} />
      {club && (() => { const pl = new Set([...club.homeTeams.flat(), ...club.awayTeams.flat()]); const un = joined.filter(p => !pl.has(p.id)); return un.length > 0 && <p className="warn startUnplaced" role="status">Not on a team (won't play): {un.map(p => p.name).join(', ')}</p>; })()}
      {club ? <p className={'startCourts' + (courtsOk ? '' : ' warn')} role="status">Pick exactly {club.n} court{club.n === 1 ? '' : 's'} — one per home team (picked {pickC.length})</p> : (() => { const out = Math.max(0, joined.length - Math.min(pickC.length, Math.floor(joined.length / 4)) * 4); return <p className="startCourts" role="status">{Math.min(pickC.length, Math.floor(joined.length / 4))} game{Math.min(pickC.length, Math.floor(joined.length / 4)) === 1 ? '' : 's'} per round on Court{pickC.length === 1 ? '' : 's'} {courtsText({ courts: pickC.length, courtSet: pickC })}{out ? ` · ${out} sit out each round` : ''}</p>; })()}
      <p>The whole schedule is drawn now from everyone who has joined{joined.length % 4 ? ` — with ${joined.length} players, sit-outs rotate evenly` : ''}. Courts are locked once you start. After the start, players can still join from the link and you can add or remove people: this round stays, and later rounds are redrawn (sit-outs rotate when the count is not a multiple of 4). Only you can end the game or add rounds. Anyone playing can enter scores.</p>
      <button className="big primary" disabled={starting || !ok || !courtsOk} onClick={start}>Start game</button>
      <button className="big" onClick={() => setAsk(false)}>Keep waiting</button></div></div>}
  </div>;
}

function useIcons() { const [, f] = useState(0); useEffect(() => { const u = S.onIcons(() => f(x => x + 1)); S.loadIcons(); return u; }, []); return S.iconsNow(); }
function Avatar({ name, size = 26 }: { name: string; size?: number }) {
  const ic = useIcons()[S.iconKey(name)]; const st = { width: size, height: size, minWidth: size, fontSize: Math.round(size * (name.length ? 0.42 : 0.6)), whiteSpace: 'nowrap' as const, overflow: 'hidden' };
  const ini = name.trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase();
  if (ic?.photo) return <img className="av" style={st} src={S.photoUrl(S.iconKey(name), ic.v)} alt="" aria-hidden="true" data-icon="photo" loading="lazy" />;
  if (ic?.icon && S.ICONS[ic.icon]) return <span className="av avIcon" style={st} aria-hidden="true" data-icon={ic.icon} data-g={S.ICONS[ic.icon]} />;
  return <span className="av avInit" style={st} aria-hidden="true" data-icon="none" data-g={ini} />;
}
/** Resize/crop to a 256px square JPEG on the phone before upload. */
async function toPhoto(f: File): Promise<string> {
  const img = await createImageBitmap(f); const c = document.createElement('canvas'); c.width = c.height = 256;
  const sz = Math.min(img.width, img.height); c.getContext('2d')!.drawImage(img, (img.width - sz) / 2, (img.height - sz) / 2, sz, sz, 0, 0, 256, 256);
  for (const qy of [0.82, 0.7, 0.55, 0.4]) { const d = c.toDataURL('image/jpeg', qy); if (d.length <= 110000) return d; }
  throw new Error('too big');
}
function IconEditor({ name, onClose }: { name: string; onClose: () => void }) {
  const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);
  const save = async (v: { icon?: string; photo?: string }) => { setBusy(true); setMsg(''); const r = await S.setIcon(name, v); setBusy(false);
    if (r === 'ok') onClose(); else setMsg(r === 'notOwner' ? `${name}'s icon was set on another phone. Only that phone (or the club admin) can change it.` : "Couldn't save (offline?). Try again."); };
  return <div className="sheetBg" onClick={onClose}><div className="sheet" role="dialog" aria-modal="true" aria-labelledby="ic-t" onClick={e => e.stopPropagation()}>
    <h2 id="ic-t"><Avatar name={name} size={40} /> Icon for {name}</h2>
    <p className="muted small">The first phone to set this name's icon owns it; only that phone can change it later.</p>
    <div className="iconGrid">{Object.entries(S.ICONS).map(([id, g]) => <button key={id} type="button" className="chip iconPick" aria-label={'Icon ' + id} disabled={busy} onClick={() => save({ icon: id })}>{g}</button>)}</div>
    <div className="row photoBtns">{([['Take photo', true], ['Choose photo', false]] as const).map(([l, cam]) => <label key={l} className="big uploadBtn">{cam ? '📷 ' : '🖼️ '}{l}<input type="file" accept="image/*" {...(cam ? { capture: 'user' as const } : {})} aria-label={l} hidden disabled={busy} onChange={async e => { const f = e.target.files?.[0]; e.target.value = ''; if (!f) return; try { await save({ photo: await toPhoto(f) }); } catch { setMsg("That photo couldn't be used. Try another."); } }} /></label>)}</div>
    {msg && <p className="warn" role="alert">{msg}</p>}
    {S.adminKey() && <button className="big danger" onClick={async () => { await S.resetIcon(name); onClose(); }}>Reset icon (admin)</button>}
    <button className="big" onClick={onClose}>Close</button></div></div>;
}
function AdminKey() {
  const [on, setOn] = useState(!!S.adminKey());
  return <button className="ghost small adminBtn" onClick={async () => { if (on) { if (confirm('Turn off club admin on this phone?')) { localStorage.removeItem('pb:admin'); setOn(false); } return; }
    const k = prompt('Club admin key'); if (!k) return; if (await S.checkAdmin(k.trim())) { localStorage.setItem('pb:admin', k.trim()); setOn(true); } else alert('That key is not valid.'); }}>{on ? 'Club admin: on' : 'Club admin'}</button>;
}
function Stats({ name }: { name?: string }) {
  const [board, setBoard] = useState<S.Stat[] | null>(null); const [hist, setHist] = useState<S.StatMatch[] | null>(null); const [err, setErr] = useState(false);
  const [tro, setTro] = useState<S.Trophy[]>([]); const [editIc, setEditIc] = useState(false); const [club, setClub] = useClubView();
  useEffect(() => { setErr(false); setBoard(null); if (name) { setHist(null); S.statsPlayer(name, club).then(setHist).catch(() => setErr(true)); S.playerTrophies(name, club).then(setTro).catch(() => {}); } S.statsBoard(club).then(b => setBoard(rankBoard(b))).catch(() => setErr(true)); }, [name, club]);
  const picker = <ClubSelect id="stats-club" label="Club" value={club} onChange={setClub} />;
  const [tab, setTab] = useState<'players' | 'trophies'>('players');
  if (name) { const k = name.toLowerCase(); const st = board?.find(b => b.k === k);
    return <div className="page"><Header title={st?.name || name} back="stats" />
      <div className="row playerHead"><Avatar name={st?.name || name} size={64} /><TrophyBadge n={tro.length} big /><button className="ghost small" onClick={() => setEditIc(true)}>Change icon</button></div>
      {picker}
      <div className="card trophyCase" aria-label="Trophy case"><div className="row between"><h2>Trophy case</h2><span className="trophyCount big">🏆 x{tro.length}</span></div>
        {tro.length ? <ul className="trophyList">{tro.map(t => <li key={t.code}><span aria-hidden="true">🏆</span> <b>{t.ev_name}</b> <span className="muted small">{fmtWhen(t.date).date} · {fmtWhen(t.date).day}</span></li>)}</ul>
          : <p className="muted small">No trophies yet{club !== S.SC ? ' for ' + club : ''} — win a Trophy match to earn one.</p>}</div>
      {editIc && <IconEditor name={st?.name || name} onClose={() => setEditIc(false)} />}
      {st && <div className="statGrid">{([['Games', st.games], ['Wins', st.wins], ['Losses', st.losses], ['Win %', st.games ? Math.round(100 * st.wins / st.games) + '%' : '–'], ['Pts for', st.pf], ['Pts against', st.pa], ['+/-', (st.diff > 0 ? '+' : '') + st.diff], ['Events', st.events], ['Trophies', st.trophies || 0]] as [string, string | number][]).map(([l, v]) => <div key={l} className="stat"><div className="sv">{v}</div><div className="sl">{l}</div></div>)}</div>}
      <h2>Match history</h2>{err && <p className="warn">Couldn't load stats (offline?).</p>}{!hist && !err && <p className="muted">Loading…</p>}
      {hist?.length === 0 && <p className="muted">No scored games yet.</p>}
      {hist?.map(m => { const onA = m.an.some(x => x.toLowerCase() === k); const mine = onA ? m.an : m.bn, opp = onA ? m.bn : m.an; const pf = onA ? m.sa : m.sb, pa = onA ? m.sb : m.sa; const won = pf > pa; const d = fmtWhen(m.date);
        return <div key={m.id} className="card hist"><div className={'res ' + (won ? 'w' : 'l')}>{won ? 'W' : 'L'}</div><div className="grow"><div className="small muted">{d.date} · {m.ev_name}</div>
          <div>with <b>{mine.filter(x => x.toLowerCase() !== k).join(' & ') || '—'}</b></div><div>vs <b>{opp.join(' & ')}</b></div></div><div className="hScore">{pf}–{pa}</div></div>; })}
    </div>; }
  return <div className="page"><Header title="Overall stats" back="" />
    {picker}
    {err && <p className="warn">Couldn't load stats (offline?).</p>}{!board && !err && <p className="muted">Loading…</p>}
    {board?.length === 0 && <div className="card empty"><b>No scored games yet</b><p className="muted">Results are added when a match is completed.</p></div>}
    <div className="row statTabs" role="tablist">{(['players', 'trophies'] as const).map(t => <button key={t} role="tab" aria-selected={tab === t} className={'chip ' + (tab === t ? 'on' : '')} onClick={() => setTab(t)}>{t === 'players' ? 'Players' : '🏆 Trophies'}</button>)}</div>
    {board && tab === 'trophies' && (() => { const tb = board.filter(b => b.trophies).sort((a, b) => b.trophies! - a.trophies! || b.wins - a.wins); return tb.length ? <table className="board trophyBoard"><thead><tr><th>#</th><th>Player</th><th>Trophies</th></tr></thead>
      <tbody>{tb.map((b, i) => <tr key={b.k} className="tap" onClick={() => go('stats/' + encodeURIComponent(b.k))}><td>{i + 1}</td><td><button className="linkBtn"><Avatar name={b.name} size={26} /> {b.name}</button></td><td><TrophyBadge n={b.trophies} big /></td></tr>)}</tbody></table>
      : <div className="card empty"><b>No trophies yet{club !== S.SC ? ' for ' + club : ''}</b><p className="muted">Check “Trophy match” when creating a game; 1st place wins a trophy.</p></div>; })()}
    {board && board.length > 0 && tab === 'players' && <table className="board"><thead><tr><th>#</th><th>Player</th><th>W-L</th><th>Win%</th><th>GP</th><th>+/-</th></tr></thead>
      <tbody>{board.map((b, i) => <tr key={b.k} className="tap" onClick={() => go('stats/' + encodeURIComponent(b.k))}><td>{i + 1}</td><td><button className="linkBtn"><Avatar name={b.name} size={22} /> {b.name}</button><TrophyBadge n={b.trophies} /></td><td>{b.wins}-{b.losses}</td><td>{b.games ? Math.round(100 * b.wins / b.games) + '%' : '–'}</td><td>{b.games}</td><td>{b.diff > 0 ? '+' : ''}{b.diff}</td></tr>)}</tbody></table>}
    {board && board.length > 0 && tab === 'players' && <p className="muted small">Ranked by win %, then point differential, then games played.</p>}
    <p className="muted small">Completed matches only (in-progress matches count once their host ends them). Matched by name, not case-sensitive.</p>
    <AdminKey />
  </div>;
}

/** Organizer sets the pairs (Mixed Doubles / Set Partners): tap two players to pair them. Unpaired players are auto-paired at start. */
function PairBuilder({ ev, act }: { ev: EventT; act: Act }) {
  const [first, setFirst] = useState('');
  const nm = (id: string) => ev.players.find(p => p.id === id)?.name || '?';
  const pairs = (ev.teams || []).filter(t => t.length === 2 && t.every(p => ev.active.includes(p)));
  const paired = new Set(pairs.flat()); const free = ev.players.filter(p => ev.active.includes(p.id) && !paired.has(p.id));
  const tap = (id: string) => { if (!first) return setFirst(id); if (first === id) return setFirst(''); const a = first; setFirst(''); act(e => { e.teams = [...(e.teams || []).filter(t => !t.includes(a) && !t.includes(id)), [a, id]]; }); };
  return <div className="card pairs"><b>Pairs ({pairs.length})</b>
    <p className="muted small">{first ? `Now tap ${nm(first)}'s partner.` : 'Tap two players to pair them. Anyone left unpaired is paired automatically when the game starts.'}</p>
    {pairs.map((t, i) => <div key={t.join()} className="pairRow"><span className="pairNo">{i + 1}</span><span className="grow pairNames">{nm(t[0])} &amp; {nm(t[1])}</span>
      <button className="ghost small" aria-label={'Unpair ' + nm(t[0]) + ' and ' + nm(t[1])} onClick={() => act(e => { e.teams = (e.teams || []).filter(x => x.join() !== t.join()); })}>✕</button></div>)}
    {free.length > 0 && <div className="chips">{free.map(p => <button key={p.id} className={'chip ' + (first === p.id ? 'on' : '')} onClick={() => tap(p.id)}>{p.name}</button>)}</div>}
  </div>;
}

const ShareIcon = () => <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12" /><path d="M7 8l5-5 5 5" /><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" /></svg>;
/** Native share sheet with just the link; fallback is a simple Copy link sheet. */
async function shareGame(_ev: EventT, code: string, fallback: () => void) {
  const url = gameLink(code);
  if (navigator.share) { try { await navigator.share({ url }); return; } catch (e) { if ((e as Error)?.name === 'AbortError') return; } }
  fallback();
}
function ShareGame({ code, onClose }: { ev?: EventT; code: string; onClose: () => void }) {
  const url = gameLink(code); const [copied, setCopied] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(url); } catch { const t = document.createElement('textarea'); t.value = url; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); } setCopied(true); };
  return <div className="sheetBg" onClick={onClose}><div className="sheet shareSheet" role="dialog" aria-modal="true" aria-labelledby="sh-t" onClick={e => e.stopPropagation()}>
    <h2 id="sh-t">Share game</h2>
    <div className="linkBox" data-testid="share-link">{url}</div>
    <button className="big primary" onClick={copy}>{copied ? 'Link copied' : <><Icon n="copy" /> Copy link</>}</button>
    <button className="big" onClick={onClose}>Done</button>
  </div></div>;
}

/** Shown when a visitor opens a started game they are not in: join for the next round, or tap a name if they are already in. */
function LateJoin({ ev, code, act, onPick, onJoined }: { ev: EventT; code: string; act: Act; onPick: (id: string) => void; onJoined: (id: string) => void }) {
  return <div className="page"><Header title={ev.name} back="" />
    <p className="muted small">This game has started. Joining puts you in from the next round — the round on court now stays as it is.</p>
    <JoinForm ev={ev} onPick={onPick} onJoin={(p, fromMemory) => {
      let added = false;
      const done = act(e => { added = addActivePlayer(e, p); });
      return done.then(() => {
        const cur = S.localEvent(code);
        if (added && cur?.players.some(x => x.id === p.id)) { onJoined(p.id); return; }
        const same = fromMemory ? cur?.players.find(x => cur.active.includes(x.id) && normName(x.name) === normName(p.name)) : undefined;
        if (same) { onJoined(same.id); return; }
        if (cur && isFull(cur)) alert('Game is full. All ' + capOf(cur) + ' spots are taken. If someone drops out, or the host raises the max, a spot opens up.');
        else alert(cur?.rounds.some(r => r.playoff) ? 'Playoffs have started, so no one new can be added.' : 'Could not join. If that name is already in the game, tap it below.');
      });
    }} />
  </div>;
}
function LateRoster({ ev, act }: { ev: EventT; act: Act }) {
  const [name, setName] = useState('');
  const cap = capOf(ev); const n = new Set(ev.active).size;
  const add = () => { const nm = name.trim().replace(/\s+/g, ' '); if (!nm) return; setName(''); act(e => { if (!addActivePlayer(e, { id: S.uid(), name: nm })) return; }); };
  const drop = (id: string, who: string) => { if (!confirm('Remove ' + who + ' from the next round on? This round stays, and games they already played still count.')) return; act(e => { dropPlayer(e, id, { when: 'next' }); }); };
  return <div className="card lateRoster">
    <p className="muted small">Add or remove players. This round stays. From the next round, matchups and sit-outs are redrawn. Games already played still count.</p>
    {cap > 0 && <div className="maxEdit"><div className="muted small" id="live-max-l">Max players</div>
      <div className="row maxRow" role="radiogroup" aria-labelledby="live-max-l">{CAPS.map(c => <button key={c} type="button" role="radio" aria-checked={cap === c} disabled={c < n} className={'chip maxChip ' + (cap === c ? 'on' : '')}
        onClick={() => cap !== c && act(e => { if (rosterOpen(e) && c >= new Set(e.active).size) e.maxPlayers = c; })}>{c}</button>)}</div></div>}
    <label htmlFor="late-name">Add a player</label>
    <div className="row"><input id="late-name" value={name} maxLength={40} placeholder="Full name" onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add(); }} />
      <button className="primary" disabled={!name.trim() || isFull(ev)} onClick={add}>Add player</button></div>
    <div className="chips" style={{ marginTop: 8 }}>{ev.players.filter(p => ev.active.includes(p.id)).map(p => <span key={p.id} className="chip static">{p.name} <button className="ghost small danger" aria-label={'Remove ' + p.name} onClick={() => drop(p.id, p.name)}>✕</button></span>)}</div>
  </div>;
}
function Started({ ev, code, onPick }: { ev: EventT; code: string; onPick: (id: string) => void }) {
  const joined = ev.players.filter(p => ev.active.includes(p.id)).sort((a, b) => a.name.localeCompare(b.name));
  return <div className="page"><Header title={ev.name} back="" />
    <div className="card startedCard"><h2>This game already started</h2>
      <p className="muted">{ev.name} is underway ({code}), so no one new can be added.</p>
      <button className="big primary" onClick={() => go('join')}>Find another game</button></div>
    {joined.length > 0 && <div className="card"><h3 className="small muted">Already playing? Tap your name</h3>
      <div className="chips">{joined.map(p => <button key={p.id} className="chip" onClick={() => onPick(p.id)}>{p.name}</button>)}</div></div>}
  </div>;
}

/** Shared-link landing: name remembered on this phone (pre-filled, one tap). "Not you? Change" for a shared phone. */
function JoinForm({ ev, onJoin, onPick }: { ev: EventT; onJoin: (p: Player, fromMemory?: boolean) => void | Promise<void>; onPick: (id: string) => void }) {
  const [who] = useState(() => S.getWho());
  const [known, setKnown] = useState<string[]>([]);
  const knownRef = useRef<string[]>([]); const pending = useRef<Promise<void>>(Promise.resolve());
  const joined = ev.players.filter(p => ev.active.includes(p.id)).sort((a, b) => a.name.localeCompare(b.name));
  const [side, setSide] = useState<'home' | 'away' | ''>('');
  const c = ev.format === 'club' ? ev.club : undefined;
  const clubs = c ? [c.home, c.away || ''] : [ev.clubName || S.SC];
  const clubKey = clubs.join('\n');
  useEffect(() => {
    let stop = false;
    const list = clubKey ? clubKey.split('\n') : [S.SC];
    const job = (async () => {
      const [board, hit] = await Promise.all([S.knownPlayerNames(list), who?.name ? S.lookupName(who.name, list) : Promise.resolve(null)]);
      if (stop) return;
      const ns = hit ? [hit, ...board] : board; knownRef.current = ns; setKnown(ns);
    })().catch(() => {});
    pending.current = job;
    return () => { stop = true; };
  }, [clubKey, who?.name]);
  const names = useMemo(() => joinNames(known, joined.map(p => p.name), S.getRoster().map(p => p.name)), [known, joined]);
  const add = async (p: Player, fromMemory?: boolean) => {
    await Promise.race([pending.current, new Promise(r => setTimeout(r, 8000))]);
    const cur = S.localEvent(ev.id) || ev;
    const hit = await Promise.race([S.lookupName(p.name, clubs), new Promise<null>(r => setTimeout(() => r(null), 8000))]);
    const list = joinNames(hit ? [hit, ...knownRef.current] : knownRef.current, cur.players.filter(x => cur.active.includes(x.id)).map(x => x.name), S.getRoster().map(x => x.name));
    const n = canonicalName(p.name, list);
    await onJoin({ ...p, name: n }, !!(fromMemory && normName(n) === normName(p.name)));
  };
  return <div className="joinForm"><h2>Add yourself to this game</h2>
    {c && <div className="row joinSide" role="radiogroup" aria-label="Your club">{(['home', 'away'] as const).map(sd => <button key={sd} type="button" role="radio" aria-checked={side === sd} className={'big chip ' + (side === sd ? 'on primary' : '')} onClick={() => setSide(sd)}>Join as {sd === 'home' ? c.home : c.away}</button>)}</div>}
    {c && !side ? <p className="muted small">Pick your club first.</p> : <PlayerForm autoFocus big preset={who} known={names} label={c ? 'Join as ' + (side === 'home' ? c.home : c.away) : 'Join'} onAdd={(p, fromMemory) => add(c && side ? { ...p, side } : p, fromMemory)} />}
    {joined.length > 0 && <><h3 className="small muted">Already joined? Tap your name</h3>
      <div className="chips">{joined.map(p => <button key={p.id} className="chip" onClick={() => onPick(p.id)}>{p.name}</button>)}</div></>}
  </div>;
}

/** Join closed: the game reached its player cap. Those already in can still tap their name. */
function FullCard({ ev, onPick }: { ev: EventT; onPick: (id: string) => void }) {
  const joined = ev.players.filter(p => ev.active.includes(p.id)).sort((a, b) => a.name.localeCompare(b.name));
  return <div className="card fullCard" role="status"><h2>Game is full</h2>
    <p className="muted">All {capOf(ev)} spots are taken. If someone drops out, a spot opens up.</p>
    <button className="big" onClick={() => go('join')}>Find another game</button>
    {joined.length > 0 && <><h3 className="small muted">Already playing? Tap your name</h3>
      <div className="chips">{joined.map(p => <button key={p.id} className="chip" onClick={() => onPick(p.id)}>{p.name}</button>)}</div></>}
  </div>;
}

/** Starter only: someone plays a player's spot from a round on (pairings unchanged); results go to the sub. Undo, or put the player back in for a later round. */
function SubIn({ ev, act, host }: { ev: EventT; act: Act; host: boolean }) {
  const [who, setWho] = useState(''); const reg = ev.rounds.filter(r => !r.playoff).length;
  const [from, setFrom] = useState(Math.max(1, reg)); const [name, setName] = useState(''); const [back, setBack] = useState(false);
  const nm = (id: string) => ev.players.find(p => p.id === id)?.name || '?';
  const subs = [...(ev.subs || [])].sort((a, b) => nm(a.slot).localeCompare(nm(b.slot)) || a.from - b.from);
  const open = (id: string, isBack: boolean) => { setWho(id); setBack(isBack); setName(''); setFrom(Math.max(1, reg)); };
  const save = () => { const id = who, f = from, n = back ? null : (name.trim() || 'Guest'); setWho('');
    act(e => { e.subs = [...(e.subs || []).filter(x => !(x.slot === id && x.from === f)), { slot: id, from: f, name: n, at: Date.now() }]; }); };
  const rounds = Array.from({ length: Math.max(ev.totalRounds, reg) }, (_, i) => i + 1);
  if (!host && !subs.length) return null;
  return <div className="card subsCard"><b>Subs</b>
    {host && !ev.finished && <p className="muted small">Someone filling in for a player? Tap Sub in. Pairings stay the same; from that round on, that spot's games count for the sub (Guest stays out of Overall stats).</p>}
    {subs.map(x => <div key={x.slot + x.from} className="pairRow subRow"><span className="grow">{x.name ? <><b>{x.name}</b> for {nm(x.slot)}</> : <><b>{nm(x.slot)}</b> back in</>} · from Round {x.from}</span>
      {host && !ev.finished && <button className="ghost small" aria-label={'Undo sub ' + nm(x.slot) + ' round ' + x.from} onClick={() => act(e => { e.subs = (e.subs || []).filter(y => !(y.slot === x.slot && y.from === x.from)); })}>Undo</button>}</div>)}
    {host && !ev.finished && <div className="subList">{ev.players.filter(p => ev.active.includes(p.id)).map(p => { const out = !!subAt(ev, p.id, 9999);
      return <div key={p.id} className="pairRow"><span className="grow">{p.name}{out && <span className="tag">subbed out</span>}</span>
        <button className="ghost small" aria-label={'Sub in for ' + p.name} onClick={() => open(p.id, false)}>Sub in</button>
        {out && <button className="ghost small" aria-label={'Put ' + p.name + ' back in'} onClick={() => open(p.id, true)}>Back in</button>}</div>; })}</div>}
    {who && <div className="sheetBg" onClick={() => setWho('')}><div className="sheet" role="dialog" aria-modal="true" aria-labelledby="sub-t" onClick={e => e.stopPropagation()}>
      <h2 id="sub-t">{back ? `Put ${nm(who)} back in` : `Sub in for ${nm(who)}`}</h2>
      <label htmlFor="sub-from">Starting round</label>
      <select id="sub-from" value={from} onChange={e => setFrom(Number(e.target.value))}>{rounds.map(n => <option key={n} value={n}>Round {n}{n < reg ? ' (played)' : n === reg ? ' (current)' : ''}</option>)}</select>
      {!back && <><label htmlFor="sub-name">Sub's name</label><input id="sub-name" placeholder="Guest" maxLength={40} autoCapitalize="words" value={name} onChange={e => setName(e.target.value)} />
        <p className="muted small">Leave blank for Guest (not counted in Overall stats).</p></>}
      <button className="big primary" onClick={save}>{back ? 'Put back in' : 'Sub in'}</button>
      <button className="big" onClick={() => setWho('')}>Cancel</button></div></div>}
  </div>;
}

/** Added-later game: note + Edit/Delete for the phone that added it (or club admin). */
function PastOwnerBar({ ev }: { ev: EventT }) {
  const can = S.ownsPast(ev.id) || !!S.adminKey(); const [err, setErr] = useState('');
  return <div className="card addedLaterNote" role="note"><span className="clubTag addedLater">Added later</span> <span className="muted small">Entered after the game was played.</span>
    {can && <div className="row"><button className="ghost" onClick={() => go('addpast/' + ev.id)}>Edit past game</button>
      <button className="ghost danger" onClick={async () => { if (!confirm('Delete this past game? Its results come out of the stats.')) return; try { await S.deletePast(ev.id); go('past'); } catch (e) { setErr(String((e as Error).message)); } }}>Delete past game</button></div>}
    {err && <p className="warn">{err}</p>}</div>;
}
type PM = { a: [string, string]; b: [string, string]; court: number; sa: string; sb: string };
const blankPM = (): PM => ({ a: ['', ''], b: ['', ''], court: 0, sa: '', sb: '' });
const ymd = (d: Date) => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 10); };
/** Add past game: date (past only), club, optional name + trophy, then matches one by one (2 v 2, optional court, scores). Saved closed. */
function AddPast({ code }: { code?: string }) {
  const yday = ymd(new Date(Date.now() - 864e5));
  const [date, setDate] = useState(''); const [club, setClub] = useState(S.clubView() || S.SC); const [name, setName] = useState(''); const [trophy, setTrophy] = useState(false);
  const [ms, setMs] = useState<PM[]>([blankPM()]); const [names, setNames] = useState<string[]>([]); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [loaded, setLoaded] = useState(!code);
  useEffect(() => { S.statsBoard(club).then(b => setNames(b.map(x => x.name))).catch(() => {}); }, [club]);
  useEffect(() => { if (!code) return; S.fetchRemote(code).then(e => { if (!e || !e.addedLater) { setErr('Past game not found.'); return; } const nm = (id: string) => e.players.find(p => p.id === id)?.name || '';
    setDate(e.date.slice(0, 10)); setClub(e.clubName || S.SC); setName(e.name === 'Past game' ? '' : e.name); setTrophy(!!e.trophy);
    setMs(e.rounds.flatMap(r => r.matches).map(m => ({ a: [nm(m.a[0]), nm(m.a[1])], b: [nm(m.b[0]), nm(m.b[1])], court: m.court || 0, sa: String(m.sa ?? ''), sb: String(m.sb ?? '') }))); setLoaded(true); }).catch(() => setErr("Couldn't load (offline?).")); }, [code]);
  const used = [...new Set([...names, ...ms.flatMap(m => [...m.a, ...m.b]).map(x => x.trim()).filter(Boolean)])].sort((a, b) => a.localeCompare(b));
  const upd = (i: number, f: (m: PM) => void) => setMs(xs => xs.map((m, j) => { if (j !== i) return m; const c = { ...m, a: [...m.a] as [string, string], b: [...m.b] as [string, string] }; f(c); return c; }));
  // Typed name matches an existing one in a different case → use the existing spelling (avoids duplicate players).
  const order = [...names, ...ms.flatMap(m => [...m.a, ...m.b]).map(x => x.trim().replace(/\s+/g, ' ')).filter(Boolean)]; // saved names first, then first spelling typed
  const canon = (v: string) => { const t = v.trim().replace(/\s+/g, ' '); return order.find(u => u.toLowerCase() === t.toLowerCase()) || t; };
  const problem = (m: PM, i: number) => { const ps = [...m.a, ...m.b].map(x => x.trim()); if (ps.some(x => !x)) return `Match ${i + 1}: enter all 4 players.`; if (new Set(ps.map(x => x.toLowerCase())).size < 4) return `Match ${i + 1}: 4 different players.`;
    const a = +m.sa, b = +m.sb; if (m.sa === '' || m.sb === '' || !Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0 || a > 99 || b > 99) return `Match ${i + 1}: enter both scores.`; if (a === b) return `Match ${i + 1}: scores can't tie.`; return ''; };
  const save = async () => { setErr('');
    if (!date || date > yday) return setErr('Pick a past date.'); for (let i = 0; i < ms.length; i++) { const p = problem(ms[i], i); if (p) return setErr(p); }
    const g: S.PastGame = { date, club, name: name.trim(), trophy, matches: ms.map(m => ({ a: [canon(m.a[0]), canon(m.a[1])], b: [canon(m.b[0]), canon(m.b[1])], court: m.court || undefined, sa: +m.sa, sb: +m.sb })) };
    setBusy(true); try { if (code) { await S.updatePast(code, g); S.setTab(code, 'standings'); go('e/' + code); } else { const c = await S.addPast(g); S.setTab(c, 'standings'); go('e/' + c); } } catch (e) { setErr("Couldn't save: " + (e as Error).message); } finally { setBusy(false); } };
  const pin = (i: number, side: 'a' | 'b', k: 0 | 1, label: string) => <input aria-label={`Match ${i + 1} ${label}`} list="pastNames" placeholder="Player name" maxLength={40} autoComplete="off" value={ms[i][side][k]} onChange={e => upd(i, m => { m[side][k] = e.target.value; })} onBlur={e => upd(i, m => { m[side][k] = canon(e.target.value); })} />;
  if (!loaded) return <div className="page"><Header title="Edit past game" back="past" />{err ? <p className="warn">{err}</p> : <p className="muted">Loading…</p>}</div>;
  return <div className="page addPast"><Header title={code ? 'Edit past game' : 'Add past game'} back="past" />
    <p className="muted small">For games played before the app or missed. Saved as a completed game: it shows in Past matches (marked “Added later”) and counts in that club’s stats and trophies.</p>
    <label htmlFor="past-date">Date played</label><input id="past-date" type="date" max={yday} value={date} onChange={e => setDate(e.target.value)} />
    <ClubSelect id="addpast-club" label="Club" value={club} onChange={setClub} allowAdd />
    <label htmlFor="past-name">Name (optional)</label><input id="past-name" maxLength={60} placeholder="e.g. Friday open play" value={name} onChange={e => setName(e.target.value)} />
    <label className="row check"><input type="checkbox" checked={trophy} onChange={e => setTrophy(e.target.checked)} /> Trophy match (1st place gets a trophy)</label>
    <datalist id="pastNames">{used.map(n => <option key={n} value={n} />)}</datalist>
    {ms.map((m, i) => <div key={i} className="card pastMatch"><div className="row between"><b>Match {i + 1}</b>{ms.length > 1 && <button className="ghost danger small" aria-label={`Remove match ${i + 1}`} onClick={() => setMs(xs => xs.filter((_, j) => j !== i))}>✕</button>}</div>
      <div className="pmTeams"><div><div className="muted small">Team 1</div>{pin(i, 'a', 0, 'Team 1 player 1')}{pin(i, 'a', 1, 'Team 1 player 2')}<input aria-label={`Match ${i + 1} Team 1 score`} inputMode="numeric" placeholder="Score" value={m.sa} onChange={e => upd(i, x => { x.sa = e.target.value.replace(/\D/g, '').slice(0, 2); })} /></div>
        <div><div className="muted small">Team 2</div>{pin(i, 'b', 0, 'Team 2 player 1')}{pin(i, 'b', 1, 'Team 2 player 2')}<input aria-label={`Match ${i + 1} Team 2 score`} inputMode="numeric" placeholder="Score" value={m.sb} onChange={e => upd(i, x => { x.sb = e.target.value.replace(/\D/g, '').slice(0, 2); })} /></div></div>
      <label className="small">Court (optional) <select aria-label={`Match ${i + 1} court`} value={m.court} onChange={e => upd(i, x => { x.court = +e.target.value; })}><option value={0}>–</option>{[1, 2, 3, 4].map(c => <option key={c} value={c}>{courtName(c)}</option>)}</select></label></div>)}
    {ms.length < 40 && <button className="big secondary" onClick={() => setMs(xs => [...xs, { ...blankPM(), a: [...xs[xs.length - 1].a] as [string, string], b: [...xs[xs.length - 1].b] as [string, string] }])}>+ Add match</button>}
    {err && <p className="warn" role="alert">{err}</p>}
    <button className="big primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : code ? 'Save changes' : 'Save past game'}</button>
  </div>;
}
