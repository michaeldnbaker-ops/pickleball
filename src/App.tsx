import { useEffect, useRef, useState, useCallback } from 'react';
import { nameTaken, removePlayer, capOf, isFull, fitCap, CAPS } from './engine/lobby';
import { EventT, Round, Format, Player, Match, nextRound, nextPlayoffRound, standings, teamStandings, toCSV, scored, unscoredCourts, courtName, courtLabel, courtsText, courtList, ensurePlan, takeNextRound, resultDependent, isLocked, startEvent, startOk, addRounds, endEvent, unitSize } from './engine/engine';
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
  </div>;
}

/** Completed matches, newest first; each opens read-only with its final standings. */
function Past() {
  const [list, setList] = useState<S.Listed[] | null>(null); const [err, setErr] = useState(false);
  useEffect(() => { S.listPast().then(setList).catch(() => setErr(true)); }, []);
  return <div className="page"><Header title="Past matches" back="" />
    {err && <p className="warn">Couldn't load past matches (offline?).</p>}{!list && !err && <p className="muted">Loading…</p>}
    {list?.length === 0 && <div className="card empty"><b>No completed matches yet</b><p className="muted">A match shows here once its host ends it.</p></div>}
    {list?.map(g => <GameCard key={g.code} g={{ ...g, rounds: 0 }} onClick={() => { S.setTab(g.code, 'standings'); go('e/' + g.code); }} />)}
  </div>;
}

const fmtWhen = (iso: string) => { const d = new Date(iso); return isNaN(+d) ? { day: '', date: '', time: '' } : { day: d.toLocaleDateString([], { weekday: 'long' }), date: d.toLocaleDateString([], { month: 'short', day: 'numeric' }), time: d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) }; };
function GameCard({ g, onClick, join }: { g: { code: string; name: string; date: string; place?: string; players?: number; rounds?: number; max?: number | null }; onClick: () => void; join?: boolean }) {
  const w = fmtWhen(g.date); const started = (g.rounds ?? 0) > 0; const live = started && new Date(g.date) <= new Date();
  const full = !started && !!g.max && (g.players ?? 0) >= g.max;
  // Started games open (tap your name); full games show Full (still openable by those already in).
  const pill = started ? 'Open' : full ? 'Full' : 'Join';
  return <button className="card tap game" onClick={onClick}>
    <div className="when"><div className="wday">{w.day.slice(0, 3)}</div><div className="wdate">{w.date}</div></div>
    <div className="gInfo"><div className="gTime">{w.day} · {w.time}{live && <span className="live">In progress</span>}</div>
      <div className="gName">{g.name}</div>
      <div className="muted small">{g.place || 'Place TBA'}{g.players != null ? ` · ${g.max && !started ? g.players + '/' + g.max : g.players} players` : ''}</div></div>
    {join ? <span className={'joinPill' + (pill !== 'Join' ? ' pill' + pill : '')}>{pill}</span> : <span className="chev" aria-hidden="true">›</span>}</button>;
}

/** Join: only "Create a game" and the list of upcoming games. Pick a game → Join → enter your name. */
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

function PlayerForm({ onAdd, label = 'Add', autoFocus, big }: { onAdd: (p: Player) => void; label?: string; autoFocus?: boolean; big?: boolean }) {
  const [name, setName] = useState(''); const [dupr, setDupr] = useState('');
  const submit = () => { if (!name.trim()) return; const d = Number(dupr); onAdd({ id: S.uid(), name: name.trim(), dupr: dupr && Number.isFinite(d) && d > 0 ? d : undefined }); setName(''); setDupr(''); };
  const idp = useRef(S.uid()).current;
  return <div className="card pform">
    <label htmlFor={idp + '-n'}>Player name</label>
    <input id={idp + '-n'} autoFocus={autoFocus} className="nameInput" placeholder="Full name" autoComplete="name" autoCapitalize="words" maxLength={40} value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} />
    <div className="duprRow"><label htmlFor={idp + '-d'}>DUPR <span className="opt-tag">(optional)</span></label>
      <input id={idp + '-d'} className="duprInput" placeholder="e.g. 3.75" inputMode="decimal" value={dupr} onChange={e => setDupr(e.target.value.replace(/[^0-9.]/g, '').slice(0, 5))} onKeyDown={e => e.key === 'Enter' && submit()} /></div>
    <button className={'primary full' + (big ? ' big' : '')} disabled={!name.trim()} onClick={submit}>{label}</button></div>;
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
  const [maxP, setMaxP] = useState(8);
  useEffect(() => { if (players.length > maxP) { const c = fitCap(players.length); if (c) setMaxP(c); } }, [players.length, maxP]);
  const [busy, setBusy] = useState(false);
  const sel = new Set(players.map(p => p.id));
  const toggle = (p: Player) => setPlayers(sel.has(p.id) ? players.filter(x => x.id !== p.id) : [...players, p]);
  const create = async () => {
    setBusy(true); localStorage.setItem('pb:lastPlace', place);
    players.forEach(S.addToRoster);
    const code = S.newCode();
    const ev: EventT = { id: code, name, date, place, format, courts, courtSet, totalRounds: rounds, balanceDupr: balance, seeding, players, active: players.map(p => p.id), teams: [], rounds: [], createdAt: Date.now(), ...(players.length <= maxP ? { maxPlayers: maxP } : {}), ...(S.testMode() ? { hidden: true } : {}) };
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
      <div role="radiogroup" aria-labelledby="fmt-label">{FORMATS.map(f => <button type="button" role="radio" aria-checked={format === f.id} key={f.id} className={'card tap fmt ' + (format === f.id ? 'sel' : '')} onClick={() => setFormat(f.id)}><span className="radio" aria-hidden="true">{format === f.id ? '✓' : ''}</span><span className="fmtText"><b>{f.name}</b><span className="muted small">{f.desc}</span></span></button>)}</div>
      <button className="big primary" onClick={() => setStep(2)}>Next: Players ›</button></>}
    {step === 2 && <>
      <p className="muted small">Optional — anyone can also join by name from the game link or the Join list until the game starts.</p>
      <PlayerForm onAdd={p => { S.addToRoster(p); setPlayers([...players, p]); }} label="Add new player" />
      <div className="row between"><h2>{players.length} selected</h2><button className="ghost" onClick={() => setPlayers(players.length ? [] : roster)}>{players.length ? 'Clear' : 'Select all'}</button></div>
      <div className="chips">{[...roster, ...players.filter(p => !roster.some(r => r.id === p.id))].map(p => <button key={p.id} className={'chip ' + (sel.has(p.id) ? 'on' : '')} onClick={() => toggle(p)}>{p.name}{p.dupr ? ` · ${p.dupr}` : ''}</button>)}</div>
      {unit > 1 && <p className="muted small">{unit === 2 ? 'Pairs' : 'Teams of 4'} are formed when the game starts; anyone left over rotates in as a sub.</p>}
      <div className="row"><button className="big" onClick={() => setStep(1)}>‹ Back</button><button className="big primary" onClick={() => setStep(3)}>Next ›</button></div></>}
    {step === 3 && <>
      <label id="max-l">Max players</label>
      <div className="row maxRow" role="radiogroup" aria-labelledby="max-l">{CAPS.map(c => <button key={c} type="button" role="radio" aria-checked={maxP === c} disabled={c < players.length} className={'chip maxChip ' + (maxP === c ? 'on' : '')} onClick={() => setMaxP(c)}>{c}</button>)}</div>
      <p className="muted small">Join closes once {maxP} players have signed up; if someone drops out, the spot opens again.</p>
      <CourtPicker value={courtSet} onChange={setCourtSet} />
      <p className="muted small">Games start with exactly 4, 8, 12 or 16 players. Courts fill 4 at a time; if there are more players than courts, the extras sit out in fair rotation. Partners don't repeat until they have to.</p>
      <label>Number of rounds</label><Stepper value={rounds} min={1} max={40} onChange={setRounds} />
      {(format === 'kotc' || format === 'ladder' || unit > 1) && <><label>Starting order / teams</label>
        <div className="row"><button className={'chip ' + (seeding === 'random' ? 'on' : '')} onClick={() => setSeeding('random')}>Random</button><button className={'chip ' + (seeding === 'dupr' ? 'on' : '')} onClick={() => setSeeding('dupr')}>Seed by DUPR</button></div></>}
      <label className="row check"><input type="checkbox" checked={balance} onChange={e => setBalance(e.target.checked)} /> Balance matchups by DUPR</label>
      <div className="row"><button className="big" onClick={() => setStep(2)}>‹ Back</button><button className="big primary" disabled={busy} onClick={create}>Create game <Ball /></button></div></>}
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
  useEffect(() => { if (ev && !loading && ensurePlan(JSON.parse(JSON.stringify(ev)))) S.mutate(code, e => { ensurePlan(e); }, ev).then(r => setEv(r.ev)); }, [ev, loading, code]);
  // Serialize writes so a quick second action never re-reads the server before the first one has landed.
  const queue = useRef<Promise<void>>(Promise.resolve());
  const act = (fn: (e: EventT) => void) => (queue.current = queue.current.then(async () => { const base = S.localEvent(code) || ev; if (!base) return; const r = await S.mutate(code, fn, base); setEv(r.ev); setOnline(r.online); setStamp(new Date()); }).catch(() => {}));
  if (!ev) return <div className="page"><Header title="Event" back="" />{loading ? <p>Loading…</p> : <p>Event {code} not found{online ? '' : ' (offline)'}.</p>}</div>;
  const nm = (id: string) => ev.players.find(p => p.id === id)?.name || '?';
  if (!ev.rounds.length) return <Lobby ev={ev} code={code} act={act} refresh={refresh} loading={loading} />;
  const meId = S.getMe(code); const member = !!meId && ev.players.some(p => p.id === meId);
  if (!member && !S.isOrg(code) && !watching && !ev.finished) return <Started ev={ev} code={code} onPick={id => { S.setMe(code, id); setTab('me'); setWatching(true); }} />;
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

function Courts({ ev, act, nm, me, host }: { ev: EventT; act: Act; nm: (id: string) => string; me?: string; host: boolean }) {
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
  const showOf = v.kind !== 'played' || !v.r.playoff;
  const state = (x: View, i: number) => i === curIdx ? 'cur' : x.kind === 'played' ? (x.r.matches.every(scored) ? 'done' : 'part') : x.kind === 'plan' && isLocked(x.r) ? (x.r.matches.every(scored) ? 'done' : 'part') : 'up';
  const lastReg = !isPO && regular >= ev.totalRounds;
  const nextLabel = isPO ? (r.matches.length === 1 ? 'Finish event' : 'Next playoff round →') : regular >= ev.totalRounds ? 'Start playoffs / finish →' : `Next: Round ${regular + 1} →`;
  return <div onTouchStart={e => { tx.current = e.touches[0].clientX; }} onTouchEnd={e => { if (tx.current == null) return; const dx = e.changedTouches[0].clientX - tx.current; tx.current = null; if (Math.abs(dx) > 60) go2(dx < 0 ? 1 : -1); }}>
    <div className="strip" role="tablist" aria-label="Rounds">{views.map((x, i) => <button key={i} role="tab" aria-selected={i === vi} aria-label={(x.kind === 'played' ? roundLabel(ev, x.idx) : 'Round ' + x.n) + ' ' + ({ cur: 'current', done: 'scored', part: 'partly scored', up: 'upcoming' } as Record<string, string>)[state(x, i)]} className={'dot ' + state(x, i) + (i === vi ? ' viewing' : '')} onClick={() => setSel(i)}>{x.kind === 'played' && x.r.playoff ? (roundLabel(ev, x.idx)[0]) : (x.kind === 'played' ? x.r.n : x.n)}{x.kind !== 'tbd' && x.r.matches.every(scored) && <i>✓</i>}</button>)}</div>
    <div className="roundNav"><button className="arrow" aria-label="Previous round" disabled={vi === 0} onClick={() => go2(-1)}>‹</button>
      <div className="rtitle"><h2>{title} {showOf && <span className="muted">of {ev.totalRounds}</span>}</h2><div className="small muted">{vi === curIdx ? (ev.finished ? 'Final round' : 'Now playing') : v.kind === 'played' ? 'Earlier round' : v.kind === 'plan' ? (isLocked(v.r) ? <>Playing ahead · pairings locked <Icon n="lock" size={14} /></> : 'Upcoming · preview') : 'Upcoming'}</div></div>
      <button className="arrow" aria-label="Next round" disabled={vi >= views.length - 1} onClick={() => go2(1)}>›</button></div>
    {vi === curIdx && champion && <div className="card champ"><Icon n="trophy" /> Champions: {champion.map(nm).join(' & ')}</div>}
    {vi === curIdx && ev.finished && !champion && <div className="card champ"><Icon n="flag" /> Event finished — see Standings</div>}
    {ev.finished && <div className="lockNote readOnly" role="note"><Icon n="lock" size={18} /> Match complete · scores are final (read-only)</div>}
    {v.kind === 'tbd' ? <div className="card tbd">Pairings for Round {v.n} are drawn when it starts — {fmtName(ev.format)} moves players by results.</div> : <>
      {v.kind === 'plan' && !isLocked(v.r) && <p className="muted small">Pairings already drawn — courts can play ahead: enter a score and this round locks. Unscored previews redraw only if players or courts change.</p>}
      {v.r.matches.map((m, i) => <CourtCard key={vi + '-' + i} m={m} nm={nm} me={me} cn={n => courtLabel(ev, n)} onScore={ev.finished ? undefined : v.kind === 'played' ? (a, b) => act(e => { const mm = e.rounds[v.idx].matches[i]; mm.sa = a; mm.sb = b; }) : (a, b) => act(e => { ensurePlan(e); const pr = e.plan?.[vi - e.rounds.length]; if (pr && pr.matches[i]) { pr.matches[i].sa = a; pr.matches[i].sb = b; } })} />)}
      {v.r.byes.length > 0 && <div className={'card bye' + (me && v.r.byes.includes(me) ? ' mine' : '')}><div className="courtHead"><span>Sitting out</span>{me && v.r.byes.includes(me) && <span className="tag">You</span>}</div><div className="byeNames">{v.r.byes.map(nm).join(' · ')}</div></div>}</>}
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
    <div className="names" aria-label={'Team ' + tag}>{t.map(p => onName ? <div key={p}><button className={'nameBtn' + (p === me ? ' meName' : '')} aria-label={'Player ' + nm(p) + ' options'} onClick={() => onName(p)}>{nm(p)}</button></div> : <div key={p} className={p === me ? 'meName' : ''}>{nm(p)}</div>)}</div>
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
  const pick = (id: string) => { S.setMe(code, id); setMeS(id); };
  if (!me || !ev.players.some(p => p.id === me)) return <div className="card"><h3 className="small muted">The game started — new players can't be added. Already playing? Tap your name</h3>
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
      <div>Partner: <b>{partner(cur.m).map(nm).join(', ') || '—'}</b></div>
      <div>vs <b>{opps(cur.m).map(nm).join(' & ')}</b></div></> : cur?.bye ? <b>You're sitting out this round</b> : <b>Not in the current round</b>}</div>
    {s && <div className="card"><b>#{rank + 1}</b> · {s.w}W–{s.l}L · diff {s.diff > 0 ? '+' : ''}{s.diff} · {s.pf} pts</div>}
    <h2>Your games</h2>
    {mine.map(({ i, m, bye }) => m ? <CourtCard key={i} compact m={m} nm={nm} me={me} label={roundLabel(ev, i) + ' · Court ' + courtLabel(ev, m.court)} /> : bye ? <div key={i} className="card bye compact"><div className="courtHead"><span className="court">{roundLabel(ev, i)}</span></div>Sitting out</div> : null)}
    {(ev.plan || []).map((r, k) => { const m = r.matches.find(m => m.a.includes(me) || m.b.includes(me)); const n = ev.rounds.filter(x => !x.playoff).length + k + 1; return m ? <CourtCard key={'p' + k} compact m={m} nm={nm} me={me} label={'Round ' + n + ' · Court ' + courtLabel(ev, m.court) + ' · upcoming'} /> : <div key={'p' + k} className="card bye compact"><div className="courtHead"><span className="court">Round {n} · upcoming</span></div>Sitting out</div>; })}
    <h2>Standings</h2><Standings ev={ev} me={me} />
  </div>;
}

function Schedule({ ev, nm, act }: { ev: EventT; nm: (id: string) => string; act: Act }) {
  return <div>{[...ev.rounds].map((r, i) => <details key={i} open={i === ev.rounds.length - 1}><summary>{roundLabel(ev, i)} <span className="muted">{r.matches.filter(scored).length}/{r.matches.length} scored</span></summary>
    {r.matches.map((m, j) => <CourtCard key={j} m={m} nm={nm} cn={n => courtLabel(ev, n)} onScore={ev.finished ? undefined : (a, b) => act(e => { e.rounds[i].matches[j].sa = a; e.rounds[i].matches[j].sb = b; })} />)}
    {r.byes.length > 0 && <div className="muted small">Sat out: {r.byes.map(nm).join(', ')}</div>}
  </details>).reverse()}</div>;
}

function Standings({ ev, me }: { ev: EventT; me?: string }) {
  const st = standings(ev);
  const teams = unitSize(ev.format) > 1;
  return <div>
    <div className={'lockNote ' + (ev.finished ? 'readOnly' : 'liveNote')} role="note">{ev.finished ? <><Icon n="lock" size={18} /> Final standings · match complete</> : <>Live · updates as scores are entered · counts toward Overall stats once the match ends</>}</div>
    {ev.finished && st[0] && <div className="card champ"><Icon n="medal" /> Top player: {st[0].name} ({st[0].w}W, {st[0].diff > 0 ? '+' : ''}{st[0].diff})</div>}
    {teams && <><h3>Teams</h3><table><thead><tr><th>#</th><th>Team</th><th>W</th><th>L</th><th>+/-</th></tr></thead><tbody>{teamStandings(ev).map((t, i) => <tr key={t.id}><td>{i + 1}</td><td>{t.name}</td><td>{t.w}</td><td>{t.l}</td><td>{t.diff}</td></tr>)}</tbody></table><h3>Players</h3></>}
    <table><thead><tr><th>#</th><th>Player</th><th>W</th><th>L</th><th>GP</th><th>PF</th><th>PA</th><th>+/-</th></tr></thead>
      <tbody>{st.map((s, i) => <tr key={s.id} className={s.id === me ? 'meRow' : ''}><td>{i + 1}</td><td>{s.name}{!ev.active.includes(s.id) ? <span className="wd">withdrawn</span> : ''}</td><td>{s.w}</td><td>{s.l}</td><td>{s.gp}</td><td>{s.pf}</td><td>{s.pa}</td><td>{s.diff > 0 ? '+' : ''}{s.diff}</td></tr>)}</tbody></table>
    <p className="muted small">Ranked by wins, then point differential, then points scored. Playoff games not included.</p>
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
    <div className="lockNote" role="note"><Icon n="lock" size={18} /> Roster locked: no adding or removing players after the start</div>
    <div className="chips">{ev.players.filter(p => ev.active.includes(p.id)).map(p => <span key={p.id} className="chip static">{p.name}</span>)}</div>
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
  const [pickC, setPickC] = useState<number[]>([]);
  const openStart = () => { setPickC(courtList(ev)); setAsk(true); };
  const start = () => { const cs = pickC.length ? pickC : courtList(ev); setAsk(false); if (starting) return; setStarting(true); const stamp = Date.now();
    // Start once: if someone else already started, startEvent is a no-op on the fresh server copy and the API refuses a second draw.
    act(e => { if (e.rounds.length || !startOk(e.active.length)) return; e.courts = cs.length; e.courtSet = cs; startEvent(e); e.startedAt = stamp; e.startedBy = me || 'organizer'; if (!e.host) e.host = me || 'organizer'; })
      .then(() => { if (S.localEvent(code)?.startedAt === stamp) S.setOrg(code); setStarting(false); refresh(); }); };
  const pick = (id: string) => { S.setMe(code, id); setMeS(id); };
  // This phone forgets a name that was removed (by the creator) or dropped elsewhere, so it can join again.
  useEffect(() => { if (me && !loading && !ev.players.some(p => p.id === me)) { S.setMe(code, ''); setMeS(''); } }, [me, loading, ev, code]);
  const joined = ev.players.filter(p => ev.active.includes(p.id));
  const cap = capOf(ev); const full = isFull(ev);
  const canStart = S.isOrg(code) || (!!me && ev.players.some(p => p.id === me)); const ok = startOk(joined.length);
  const org = S.isOrg(code);
  const drop = (id: string, name: string, self: boolean) => { if (!confirm(self ? 'Drop out of this game?' : 'Remove ' + name + ' from this game?')) return;
    act(e => { removePlayer(e, id); }).then(() => { if (self) pick(''); }); };
  const cancelGame = async () => { if (!confirm('Cancel and delete this game for everyone? This can\'t be undone.')) return;
    try { await S.deleteRemote(code); S.forget(code); go(''); } catch (e) { alert(String(e).includes('started') ? 'This game already started and can no longer be cancelled.' : 'Could not cancel (offline?). Try again.'); } };
  const w = fmtWhen(ev.date); const link = gameLink(code);
  const [sharing, setSharing] = useState(false);
  return <div className="page">
    <header><button className="ghost" onClick={() => go('')} aria-label="Back">‹</button><div className="grow"><h1>{ev.name}</h1><div className="muted small">{fmtName(ev.format)} · code <b>{code}</b></div></div>
      <button className="ghost refresh" onClick={refresh} aria-label="Refresh">{loading ? '…' : <Icon n="refresh" size={22} />}</button></header>
    <div className="card lobbyWhen"><div className="when"><div className="wday">{w.day.slice(0, 3)}</div><div className="wdate">{w.date}</div></div><div><b>{w.day} · {w.time}</b><div className="muted">{ev.place || 'Place TBA'}</div><div className="muted small">{ev.courts} courts ({courtsText(ev)}) · {ev.totalRounds} rounds{cap ? ` · max ${cap} players` : ''}</div></div></div>
    <div className="lobbyStatus"><span className="pulse" aria-hidden="true" /> {full ? 'Full' : 'Signing up'} · <b>{joined.length} joined</b>{cap ? <span className="muted"> · {cap} max</span> : null}</div>
    {canStart && <button className="big primary huge" disabled={starting || !ok} onClick={() => ok && openStart()}><Icon n="play" /> {starting ? 'Starting…' : 'Start game'}</button>}
    {canStart && !ok && <p className="startNeed" role="status">Need 4, 8, 12 or 16 players to start (have {joined.length})</p>}
    {!me && full && <FullCard ev={ev} onPick={pick} />}
    {!me && !full && <JoinForm ev={ev} onJoin={p => { act(e => { if (e.rounds.length || nameTaken(e, p.name) || isFull(e)) return; e.players.push(p); e.active.push(p.id); }).then(() => { const cur = S.localEvent(code); if (cur?.players.some(x => x.id === p.id)) pick(p.id); else if (cur && isFull(cur)) alert('Game is full. All ' + capOf(cur) + ' spots are taken. If someone drops out, a spot opens up.'); else if (cur?.rounds.length) refresh(); else alert('Someone named "' + p.name.trim() + '" is already in this game. If that\'s you, tap your name below; otherwise add a last initial.'); }); }} onPick={pick} />}
    {me && ev.players.some(p => p.id === me) && <div className="card youIn"><Icon n="checkCircle" /> You're in as <b>{ev.players.find(p => p.id === me)!.name}</b> <button className="ghost small" onClick={() => pick('')}>Not you?</button></div>}
    {unitSize(ev.format) === 2 && canStart && <PairBuilder ev={ev} act={act} />}
    <h2>Players ({joined.length})</h2>
    <ul className="lobbyList">{joined.map(p => <li key={p.id} className={'lobbyRow' + (p.id === me ? ' on' : '')}><span className="grow">{p.name}{p.id === me && <span className="tag">You</span>}</span>
      {p.id === me ? <button className="ghost small danger dropBtn" onClick={() => drop(p.id, p.name, true)}>Drop out</button>
        : org && <button className="ghost small danger" aria-label={'Remove ' + p.name} onClick={() => drop(p.id, p.name, false)}>✕</button>}</li>)}</ul>
    {joined.length === 0 && <p className="muted">No one yet — share the link.</p>}
    {org && <button className="big danger cancelGame" onClick={cancelGame}>Cancel game</button>}
    <div className="row shareRow"><button className="big primary shareBig" onClick={() => shareGame(ev, code, () => setSharing(true))}>Share game</button></div>
    {sharing && <ShareGame ev={ev} code={code} onClose={() => setSharing(false)} />}
    {ask && <div className="sheetBg" onClick={() => setAsk(false)}><div className="sheet" role="alertdialog" aria-modal="true" aria-labelledby="st-t" onClick={e => e.stopPropagation()}>
      <h2 id="st-t">Start with {joined.length} player{joined.length === 1 ? '' : 's'}?</h2>
      <CourtPicker id="start-courts-l" value={pickC} onChange={setPickC} />
      {(() => { const out = Math.max(0, joined.length - Math.min(pickC.length, Math.floor(joined.length / 4)) * 4); return <p className="startCourts" role="status">{Math.min(pickC.length, Math.floor(joined.length / 4))} game{Math.min(pickC.length, Math.floor(joined.length / 4)) === 1 ? '' : 's'} per round on Court{pickC.length === 1 ? '' : 's'} {courtsText({ courts: pickC.length, courtSet: pickC })}{out ? ` · ${out} sit out each round` : ''}</p>; })()}
      <p>The whole schedule is drawn now from everyone who has joined{joined.length % 4 ? ` — with ${joined.length} players, sit-outs rotate evenly` : ''}. Courts are locked once you start. After the start the roster is locked (no adding or removing players), and only you can end the game or add rounds. Anyone playing can enter scores.</p>
      <button className="big primary" disabled={starting || !ok} onClick={start}>Start game</button>
      <button className="big" onClick={() => setAsk(false)}>Keep waiting</button></div></div>}
  </div>;
}

function Stats({ name }: { name?: string }) {
  const [board, setBoard] = useState<S.Stat[] | null>(null); const [hist, setHist] = useState<S.StatMatch[] | null>(null); const [err, setErr] = useState(false);
  useEffect(() => { setErr(false); if (name) { setHist(null); S.statsPlayer(name).then(setHist).catch(() => setErr(true)); } S.statsBoard().then(setBoard).catch(() => setErr(true)); }, [name]);
  if (name) { const k = name.toLowerCase(); const st = board?.find(b => b.k === k);
    return <div className="page"><Header title={st?.name || name} back="stats" />
      {st && <div className="statGrid">{([['Games', st.games], ['Wins', st.wins], ['Losses', st.losses], ['Win %', st.games ? Math.round(100 * st.wins / st.games) + '%' : '–'], ['Pts for', st.pf], ['Pts against', st.pa], ['+/-', (st.diff > 0 ? '+' : '') + st.diff], ['Events', st.events]] as [string, string | number][]).map(([l, v]) => <div key={l} className="stat"><div className="sv">{v}</div><div className="sl">{l}</div></div>)}</div>}
      <h2>Match history</h2>{err && <p className="warn">Couldn't load stats (offline?).</p>}{!hist && !err && <p className="muted">Loading…</p>}
      {hist?.length === 0 && <p className="muted">No scored games yet.</p>}
      {hist?.map(m => { const onA = m.an.some(x => x.toLowerCase() === k); const mine = onA ? m.an : m.bn, opp = onA ? m.bn : m.an; const pf = onA ? m.sa : m.sb, pa = onA ? m.sb : m.sa; const won = pf > pa; const d = fmtWhen(m.date);
        return <div key={m.id} className="card hist"><div className={'res ' + (won ? 'w' : 'l')}>{won ? 'W' : 'L'}</div><div className="grow"><div className="small muted">{d.date} · {m.ev_name}</div>
          <div>with <b>{mine.filter(x => x.toLowerCase() !== k).join(' & ') || '—'}</b></div><div>vs <b>{opp.join(' & ')}</b></div></div><div className="hScore">{pf}–{pa}</div></div>; })}
    </div>; }
  return <div className="page"><Header title="Overall stats" back="" />
    {err && <p className="warn">Couldn't load stats (offline?).</p>}{!board && !err && <p className="muted">Loading…</p>}
    {board?.length === 0 && <div className="card empty"><b>No scored games yet</b><p className="muted">Results are added when a match is completed.</p></div>}
    {board && board.length > 0 && <table className="board"><thead><tr><th>#</th><th>Player</th><th>W-L</th><th>Win%</th><th>GP</th><th>+/-</th></tr></thead>
      <tbody>{board.map((b, i) => <tr key={b.k} className="tap" onClick={() => go('stats/' + encodeURIComponent(b.k))}><td>{i + 1}</td><td><button className="linkBtn">{b.name}</button></td><td>{b.wins}-{b.losses}</td><td>{b.games ? Math.round(100 * b.wins / b.games) + '%' : '–'}</td><td>{b.games}</td><td>{b.diff > 0 ? '+' : ''}{b.diff}</td></tr>)}</tbody></table>}
    <p className="muted small">Completed matches only (in-progress matches count once their host ends them). Matched by name, not case-sensitive.</p>
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

/** Shown to a /g/CODE (or Join) visitor who isn't in a game that already started: no new joins. */
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

/** Shared-link landing: add yourself first (name focused, optional DUPR, big Join); already-joined names below. */
function JoinForm({ ev, onJoin, onPick }: { ev: EventT; onJoin: (p: Player) => void; onPick: (id: string) => void }) {
  const joined = ev.players.filter(p => ev.active.includes(p.id)).sort((a, b) => a.name.localeCompare(b.name));
  return <div className="joinForm"><h2>Add yourself to this game</h2>
    <PlayerForm autoFocus big label="Join" onAdd={onJoin} />
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
