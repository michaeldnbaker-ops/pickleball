import { useEffect, useRef, useState, useCallback } from 'react';
import { EventT, Format, Player, Match, nextRound, nextPlayoffRound, standings, teamStandings, canRegenerate, toCSV, scored, unscoredCourts } from './engine/engine';
import * as S from './store';

const FORMATS: { id: Format; name: string; desc: string }[] = [
  { id: 'rotating', name: 'Round Robin', desc: 'Rotating partners — new partner every round, fewest repeats.' },
  { id: 'mixer', name: 'Mix-Up / Free-for-All', desc: 'Random social shuffle each round, byes kept fair.' },
  { id: 'mixed', name: 'Mixed Doubles RR', desc: 'Rotating partners, each team one man + one woman.' },
  { id: 'fixed', name: 'Set Partners RR', desc: 'Same partner all event, rotate opponents.' },
  { id: 'kotc', name: 'King of the Court', desc: 'Up & down the river: winners move up a court, losers down, partners split.' },
  { id: 'ladder', name: 'Ladder', desc: 'Courts re-seeded by standings each round: best 4 on Court 1.' },
  { id: 'team', name: 'Team Battle (4-player teams)', desc: 'MLP-style: teams of 4 play two doubles games per tie.' },
];
const fmtName = (f: Format) => FORMATS.find(x => x.id === f)!.name;

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
  if (r[0] === 'e' && r[1]) return <EventView code={r[1].toUpperCase()} />;
  return <Home />;
}

function Header({ title, back }: { title: string; back?: string }) {
  return <header>{back !== undefined && <button className="ghost" onClick={() => go(back)} aria-label="Back">‹</button>}<h1>{title}</h1></header>;
}

function Home() {
  const [code, setCode] = useState('');
  const evs = S.myEvents();
  return <div className="page">
    <Header title="🏓 Dink Day" />
    <button className="big primary" onClick={() => go('new')}>+ New Event</button>
    <div className="card"><label htmlFor="join-code">Join with event code</label>
      <div className="row"><input id="join-code" value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="e.g. K7Q2MD" maxLength={8} /><button className="primary" disabled={code.length < 4} onClick={() => go('e/' + code)}>Join</button></div></div>
    <button className="big" onClick={() => go('roster')}>👥 Player Roster ({S.getRoster().length})</button>
    {evs.length > 0 && <h2>Recent events</h2>}
    {evs.map(e => <div key={e.code} className="card tap" onClick={() => go('e/' + e.code)}><b>{e.name}</b><div className="muted">{e.date ? new Date(e.date).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : ''} · code {e.code}</div></div>)}
    <p className="muted small">No sign-in. Share the event link — everyone refreshes to see courts and standings.</p>
  </div>;
}

function PlayerForm({ onAdd, label = 'Add' }: { onAdd: (p: Player) => void; label?: string }) {
  const [name, setName] = useState(''); const [dupr, setDupr] = useState(''); const [g, setG] = useState<'' | 'M' | 'F'>('');
  const submit = () => { if (!name.trim()) return; onAdd({ id: S.uid(), name: name.trim(), dupr: dupr ? Number(dupr) : undefined, gender: g || undefined }); setName(''); setDupr(''); setG(''); };
  const idp = useRef(S.uid()).current;
  return <div className="card"><div className="row labels"><label htmlFor={idp + '-n'}>Player name</label><label htmlFor={idp + '-d'} className="narrow">DUPR</label><label htmlFor={idp + '-g'} className="narrow">M/F</label></div><div className="row">
    <input id={idp + '-n'} placeholder="Name" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && submit()} />
    <input id={idp + '-d'} className="narrow" placeholder="DUPR" inputMode="decimal" value={dupr} onChange={e => setDupr(e.target.value.replace(/[^0-9.]/g, ''))} />
    <select id={idp + '-g'} className="narrow" value={g} onChange={e => setG(e.target.value as '')}><option value="">–</option><option value="M">M</option><option value="F">F</option></select>
  </div><button className="primary full" onClick={submit}>{label}</button></div>;
}

function Roster() {
  const [r, setR] = useState(S.getRoster());
  const save = (x: Player[]) => { S.setRoster(x); setR(x); };
  return <div className="page"><Header title="Player Roster" back="" />
    <PlayerForm onAdd={p => save([...r, p])} label="Add player" />
    {r.sort((a, b) => a.name.localeCompare(b.name)).map(p => <div key={p.id} className="card row between"><span><b>{p.name}</b> <span className="muted">{p.dupr ? 'DUPR ' + p.dupr : ''} {p.gender || ''}</span></span><button className="ghost danger" onClick={() => confirm('Remove ' + p.name + '?') && save(r.filter(x => x.id !== p.id))}>✕</button></div>)}
  </div>;
}

function localISO() { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); }

function NewEvent() {
  const roster = S.getRoster();
  const [step, setStep] = useState(1);
  const [name, setName] = useState('Pickleball ' + new Date().toLocaleDateString([], { weekday: 'long' }));
  const [date, setDate] = useState(localISO());
  const [place, setPlace] = useState(localStorage.getItem('pb:lastPlace') || '');
  const [format, setFormat] = useState<Format>('rotating');
  const [courts, setCourts] = useState(3); const [rounds, setRounds] = useState(8);
  const [balance, setBalance] = useState(false); const [seeding, setSeeding] = useState<'random' | 'dupr'>('random');
  const [players, setPlayers] = useState<Player[]>([]);
  const [busy, setBusy] = useState(false);
  const sel = new Set(players.map(p => p.id));
  const toggle = (p: Player) => setPlayers(sel.has(p.id) ? players.filter(x => x.id !== p.id) : [...players, p]);
  const unit = format === 'team' ? 4 : format === 'fixed' ? 2 : 1;
  const makeTeams = (ps: Player[]) => {
    if (unit === 1) return [];
    const order = seeding === 'dupr' || balance ? [...ps].sort((a, b) => (b.dupr ?? 3.5) - (a.dupr ?? 3.5)) : [...ps].sort(() => Math.random() - 0.5);
    const nT = Math.floor(order.length / unit); const teams: string[][] = Array.from({ length: nT }, () => []);
    // snake draft for balanced teams
    order.slice(0, nT * unit).forEach((p, i) => { const r = Math.floor(i / nT), k = i % nT; teams[r % 2 ? nT - 1 - k : k].push(p.id); });
    return teams;
  };
  const create = async () => {
    setBusy(true); localStorage.setItem('pb:lastPlace', place);
    players.forEach(S.addToRoster);
    const code = S.newCode();
    const ev: EventT = { id: code, name, date, place, format, courts, totalRounds: rounds, balanceDupr: balance, seeding, players, active: players.map(p => p.id), teams: makeTeams(players), rounds: [], createdAt: Date.now() };
    ev.rounds.push(nextRound(ev));
    S.saveLocal(code, ev, true);
    try { await S.pushRemote(code, ev); S.saveLocal(code, ev, false); } catch { /* will push later */ }
    go('e/' + code);
  };
  const maxCourts = Math.max(1, Math.floor(players.length / 4));
  return <div className="page"><Header title={`New Event · ${step}/3`} back="" />
    {step === 1 && <>
      <label htmlFor="ev-name">Event name</label><input id="ev-name" value={name} onChange={e => setName(e.target.value)} />
      <label htmlFor="ev-date">Date & time</label><input id="ev-date" type="datetime-local" value={date} onChange={e => setDate(e.target.value)} />
      <label htmlFor="ev-place">Place</label><input id="ev-place" value={place} placeholder="e.g. the gym" onChange={e => setPlace(e.target.value)} />
      <label id="fmt-label">Format</label>
      <div role="radiogroup" aria-labelledby="fmt-label">{FORMATS.map(f => <button type="button" role="radio" aria-checked={format === f.id} key={f.id} className={'card tap fmt ' + (format === f.id ? 'sel' : '')} onClick={() => setFormat(f.id)}><span className="radio" aria-hidden="true">{format === f.id ? '✓' : ''}</span><span className="fmtText"><b>{f.name}</b><span className="muted small">{f.desc}</span></span></button>)}</div>
      <button className="big primary" onClick={() => setStep(2)}>Next: Players ›</button></>}
    {step === 2 && <>
      <PlayerForm onAdd={p => { S.addToRoster(p); setPlayers([...players, p]); }} label="Add new player" />
      <div className="row between"><h2>{players.length} selected</h2><button className="ghost" onClick={() => setPlayers(players.length ? [] : roster)}>{players.length ? 'Clear' : 'Select all'}</button></div>
      <div className="chips">{[...roster, ...players.filter(p => !roster.some(r => r.id === p.id))].map(p => <button key={p.id} className={'chip ' + (sel.has(p.id) ? 'on' : '')} onClick={() => toggle(p)}>{p.name}{p.dupr ? ` · ${p.dupr}` : ''}</button>)}</div>
      {format === 'mixed' && <p className="muted small">Mixed: set M/F on each player (roster) so teams are 1 man + 1 woman.</p>}
      {unit > 1 && players.length % unit !== 0 && <p className="warn">{players.length % unit} player(s) won't fit a team of {unit}. Add or remove players.</p>}
      <div className="row"><button className="big" onClick={() => setStep(1)}>‹ Back</button><button className="big primary" disabled={players.length < 4} onClick={() => { setCourts(Math.min(courts, maxCourts) || 1); setStep(3); }}>Next ›</button></div></>}
    {step === 3 && <>
      <label>Courts available</label><Stepper value={courts} min={1} max={30} onChange={setCourts} />
      <p className="muted small">{players.length} players → up to {Math.floor(players.length / 4)} courts; {Math.max(0, players.length - Math.min(courts, Math.floor(players.length / 4)) * 4)} sit out per round (rotated fairly).</p>
      <label>Number of rounds</label><Stepper value={rounds} min={1} max={40} onChange={setRounds} />
      {(format === 'kotc' || format === 'ladder' || unit > 1) && <><label>Starting order / teams</label>
        <div className="row"><button className={'chip ' + (seeding === 'random' ? 'on' : '')} onClick={() => setSeeding('random')}>Random</button><button className={'chip ' + (seeding === 'dupr' ? 'on' : '')} onClick={() => setSeeding('dupr')}>Seed by DUPR</button></div></>}
      <label className="row check"><input type="checkbox" checked={balance} onChange={e => setBalance(e.target.checked)} /> Balance matchups by DUPR</label>
      <div className="row"><button className="big" onClick={() => setStep(2)}>‹ Back</button><button className="big primary" disabled={busy} onClick={create}>Start Event 🏓</button></div></>}
  </div>;
}

function Stepper({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (n: number) => void }) {
  return <div className="stepper"><button onClick={() => onChange(Math.max(min, value - 1))}>−</button><span>{value}</span><button onClick={() => onChange(Math.min(max, value + 1))}>+</button></div>;
}

type Tab = 'courts' | 'me' | 'schedule' | 'standings' | 'manage';
function EventView({ code }: { code: string }) {
  const [ev, setEv] = useState<EventT | null>(S.localEvent(code));
  const [online, setOnline] = useState(true); const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>(S.getMe(code) ? 'me' : 'courts');
  const [stamp, setStamp] = useState<Date | null>(null);
  const refresh = useCallback(async () => { setLoading(true); const r = await S.load(code); if (r.ev) setEv(r.ev); setOnline(r.online); setStamp(new Date()); setLoading(false); }, [code]);
  useEffect(() => { refresh(); const f = () => refresh(); addEventListener('online', f); return () => removeEventListener('online', f); }, [refresh]);
  usePullToRefresh(refresh);
  const act = async (fn: (e: EventT) => void) => { if (!ev) return; const r = await S.mutate(code, fn, ev); setEv(r.ev); setOnline(r.online); setStamp(new Date()); };
  if (!ev) return <div className="page"><Header title="Event" back="" />{loading ? <p>Loading…</p> : <p>Event {code} not found{online ? '' : ' (offline)'}.</p>}</div>;
  const nm = (id: string) => ev.players.find(p => p.id === id)?.name || '?';
  return <div className="page withtabs">
    <header><button className="ghost" onClick={() => go('')}>‹</button><div className="grow"><h1>{ev.name}</h1><div className="muted small">{fmtName(ev.format)} · {ev.place} · code <b>{code}</b></div></div>
      <button className="ghost refresh" onClick={refresh} aria-label="Refresh">{loading ? '…' : '⟳'}</button></header>
    <div className={'status ' + (online ? '' : 'off')}>{online ? (stamp ? 'Updated ' + stamp.toLocaleTimeString([], { timeStyle: 'short' }) + ' · pull down or tap ⟳ to refresh' : '') : 'Offline — changes saved on this phone, will upload when back online'}</div>
    {tab === 'courts' && <Courts ev={ev} act={act} nm={nm} />}
    {tab === 'me' && <Me ev={ev} code={code} nm={nm} act={act} />}
    {tab === 'schedule' && <Schedule ev={ev} nm={nm} act={act} />}
    {tab === 'standings' && <Standings ev={ev} />}
    {tab === 'manage' && <Manage ev={ev} code={code} act={act} />}
    <nav className="tabs">{(['courts', 'me', 'schedule', 'standings', 'manage'] as Tab[]).map(t => <button key={t} className={tab === t ? 'on' : ''} onClick={() => { setTab(t); scrollTo(0, 0); }}>{{ courts: '🏓 Courts', me: '🙋 Me', schedule: '📋 Rounds', standings: '🏆 Standings', manage: '⚙️ Manage' }[t]}</button>)}</nav>
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
function currentRound(ev: EventT) { return ev.rounds[ev.rounds.length - 1]; }
function roundLabel(ev: EventT, idx: number) { const r = ev.rounds[idx]; if (!r.playoff) return 'Round ' + r.n; const po = ev.rounds.filter(x => x.playoff); const left = po[po.indexOf(r)].matches.length; return left === 1 ? 'Final' : left === 2 ? 'Semifinals' : 'Quarterfinals'; }

function Courts({ ev, act, nm }: { ev: EventT; act: Act; nm: (id: string) => string }) {
  const idx = ev.rounds.length - 1; const r = currentRound(ev);
  const regular = ev.rounds.filter(x => !x.playoff).length;
  const done = r.matches.every(scored);
  const isPO = !!r.playoff;
  const advance = () => act(e => { if (isPO || e.rounds.filter(x => !x.playoff).length >= e.totalRounds) { const p = nextPlayoffRound(e); if (p) e.rounds.push(p); else e.finished = true; } else e.rounds.push(nextRound(e)); });
  const [ask, setAsk] = useState(false);
  const missing = unscoredCourts(r);
  const champion = ev.finished && isPO && r.matches.length === 1 && scored(r.matches[0]) ? (r.matches[0].sa! > r.matches[0].sb! ? r.matches[0].a : r.matches[0].b) : null;
  if (!r) return null;
  return <div>
    <h2>{roundLabel(ev, idx)} {!isPO && <span className="muted">of {ev.totalRounds}</span>}</h2>
    {champion && <div className="card champ">🏆 Champions: {champion.map(nm).join(' & ')}</div>}
    {ev.finished && !champion && <div className="card champ">🏁 Event finished — see Standings</div>}
    {r.matches.map((m, i) => <MatchCard key={idx + '-' + i} m={m} nm={nm} onScore={(a, b) => act(e => { const mm = e.rounds[idx].matches[i]; mm.sa = a; mm.sb = b; })} />)}
    {r.byes.length > 0 && <div className="card bye">Sitting out: <b>{r.byes.map(nm).join(', ')}</b></div>}
    {!ev.finished && <button className={'big ' + (done ? 'primary' : '')} onClick={() => missing.length ? setAsk(true) : advance()}>
      {isPO ? (r.matches.length === 1 ? 'Finish event' : 'Next playoff round ›') : regular >= ev.totalRounds ? 'Start playoffs / finish ›' : `Next: Round ${regular + 1} ›`}</button>}
    {ask && <div className="sheetBg" onClick={() => setAsk(false)}><div className="sheet" role="alertdialog" aria-modal="true" aria-labelledby="unsc-t" onClick={e => e.stopPropagation()}>
      <h2 id="unsc-t">⚠️ {missing.length === 1 ? '1 court has' : missing.length + ' courts have'} no score</h2>
      <p>Court {missing.join(', ')} {missing.length === 1 ? "hasn't" : "haven't"} been scored. If you continue, {missing.length === 1 ? 'that game' : 'those games'} won't count in the standings.</p>
      <button className="big primary" onClick={() => setAsk(false)}>Go back and enter scores</button>
      <button className="big danger" onClick={() => { setAsk(false); advance(); }}>Continue anyway</button></div></div>}
    {!ev.finished && !isPO && regular >= ev.totalRounds && <button className="big" onClick={() => act(e => { e.finished = true; })}>Finish without playoffs</button>}
  </div>;
}

function MatchCard({ m, nm, onScore, me }: { m: Match; nm: (id: string) => string; onScore?: (a: number, b: number) => void; me?: string }) {
  const [a, setA] = useState<number | ''>(m.sa ?? ''); const [b, setB] = useState<number | ''>(m.sb ?? '');
  useEffect(() => { setA(m.sa ?? ''); setB(m.sb ?? ''); }, [m.sa, m.sb]);
  const [edit, setEdit] = useState(false);
  const has = m.sa != null && m.sb != null; const winA = has && m.sa! > m.sb!;
  const team = (t: string[], win: boolean) => <div className={'team ' + (has ? (win ? 'win' : 'lose') : '')}>{t.map(p => <div key={p} className={p === me ? 'meName' : ''}>{nm(p)}</div>)}</div>;
  return <div className="card match">
    <div className="court">Court {m.court}</div>
    <div className="vs">{team(m.a, winA)}<div className="score">{has && !edit ? <b>{m.sa}–{m.sb}</b> : 'vs'}</div>{team(m.b, has && !winA)}</div>
    {onScore && (!has || edit ? <div className="entry">
      <ScoreBox v={a} set={setA} /><span>–</span><ScoreBox v={b} set={setB} />
      <button className="primary" disabled={a === '' || b === '' || a === b} onClick={() => { onScore(Number(a), Number(b)); setEdit(false); }}>Save</button>
    </div> : <button className="ghost small" onClick={() => setEdit(true)}>Edit score</button>)}
  </div>;
}
function ScoreBox({ v, set }: { v: number | ''; set: (n: number | '') => void }) {
  return <div className="scorebox"><button aria-label="minus" onClick={() => set(Math.max(0, (v || 0) - 1))}>−</button><input type="text" inputMode="numeric" pattern="[0-9]*" aria-label="Score" placeholder="0" onFocus={e => e.target.select()} value={v} onChange={e => set(e.target.value === '' ? '' : Math.min(99, Number(e.target.value.replace(/\D/g, ''))))} /><button aria-label="plus" onClick={() => set(Math.min(99, (v || 0) + 1))}>+</button></div>;
}

function Me({ ev, code, nm, act }: { ev: EventT; code: string; nm: (id: string) => string; act: Act }) {
  const [me, setMeS] = useState(S.getMe(code));
  const pick = (id: string) => { S.setMe(code, id); setMeS(id); };
  if (!me || !ev.players.some(p => p.id === me)) return <div><h2>Who are you?</h2>
    <div className="chips">{[...ev.players].sort((a, b) => a.name.localeCompare(b.name)).map(p => <button key={p.id} className="chip big" onClick={() => pick(p.id)}>{p.name}</button>)}</div>
    <h2>Not listed? Add yourself</h2>
    <PlayerForm label="Join this event" onAdd={p => { act(e => { e.players.push(p); e.active.push(p.id); }); pick(p.id); }} />
  </div>;
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
      <div className="bigcourt">Court {cur.m.court}</div>
      <div>Partner: <b>{partner(cur.m).map(nm).join(', ') || '—'}</b></div>
      <div>vs <b>{opps(cur.m).map(nm).join(' & ')}</b></div></> : cur?.bye ? <b>You're sitting out this round</b> : <b>Not in the current round</b>}</div>
    {s && <div className="card"><b>#{rank + 1}</b> · {s.w}W–{s.l}L · diff {s.diff > 0 ? '+' : ''}{s.diff} · {s.pf} pts</div>}
    <h2>Your games</h2>
    {mine.map(({ i, m, bye }) => m ? <div key={i}><div className="muted small">{roundLabel(ev, i)}</div><MatchCard m={m} nm={nm} me={me} /></div> : bye ? <div key={i} className="muted small">{roundLabel(ev, i)}: sat out</div> : null)}
    <h2>Standings</h2><Standings ev={ev} me={me} />
  </div>;
}

function Schedule({ ev, nm, act }: { ev: EventT; nm: (id: string) => string; act: Act }) {
  return <div>{[...ev.rounds].map((r, i) => <details key={i} open={i === ev.rounds.length - 1}><summary>{roundLabel(ev, i)} <span className="muted">{r.matches.filter(scored).length}/{r.matches.length} scored</span></summary>
    {r.matches.map((m, j) => <MatchCard key={j} m={m} nm={nm} onScore={(a, b) => act(e => { e.rounds[i].matches[j].sa = a; e.rounds[i].matches[j].sb = b; })} />)}
    {r.byes.length > 0 && <div className="muted small">Sat out: {r.byes.map(nm).join(', ')}</div>}
  </details>).reverse()}</div>;
}

function Standings({ ev, me }: { ev: EventT; me?: string }) {
  const st = standings(ev);
  const teams = ev.format === 'fixed' || ev.format === 'team';
  return <div>
    {ev.finished && st[0] && <div className="card champ">🥇 Top player: {st[0].name} ({st[0].w}W, {st[0].diff > 0 ? '+' : ''}{st[0].diff})</div>}
    {teams && <><h3>Teams</h3><table><thead><tr><th>#</th><th>Team</th><th>W</th><th>L</th><th>+/-</th></tr></thead><tbody>{teamStandings(ev).map((t, i) => <tr key={t.id}><td>{i + 1}</td><td>{t.name}</td><td>{t.w}</td><td>{t.l}</td><td>{t.diff}</td></tr>)}</tbody></table><h3>Players</h3></>}
    <table><thead><tr><th>#</th><th>Player</th><th>W</th><th>L</th><th>GP</th><th>PF</th><th>PA</th><th>+/-</th></tr></thead>
      <tbody>{st.map((s, i) => <tr key={s.id} className={s.id === me ? 'meRow' : ''}><td>{i + 1}</td><td>{s.name}{!ev.active.includes(s.id) ? ' (left)' : ''}</td><td>{s.w}</td><td>{s.l}</td><td>{s.gp}</td><td>{s.pf}</td><td>{s.pa}</td><td>{s.diff > 0 ? '+' : ''}{s.diff}</td></tr>)}</tbody></table>
    <p className="muted small">Ranked by wins, then point differential, then points scored. Playoff games not included.</p>
  </div>;
}

function Manage({ ev, code, act }: { ev: EventT; code: string; act: Act }) {
  const link = location.origin + location.pathname + '#/e/' + code;
  const share = async () => { try { if (navigator.share) await navigator.share({ title: ev.name, url: link }); else { await navigator.clipboard.writeText(link); alert('Link copied'); } } catch { /* cancelled */ } };
  const regen = canRegenerate(ev);
  const download = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([toCSV(ev)], { type: 'text/csv' })); a.download = ev.name.replace(/\W+/g, '_') + '.csv'; a.click(); };
  const unit = ev.format === 'team' ? 4 : ev.format === 'fixed' ? 2 : 1;
  return <div>
    <div className="card"><b>Share with players</b><div className="muted small break">{link}</div><button className="primary full" onClick={share}>📤 Share link</button></div>
    <h2>Players ({ev.active.length} playing)</h2>
    {unit === 1 ? <PlayerForm label="Add late player" onAdd={p => { S.addToRoster(p); act(e => { e.players.push(p); e.active.push(p.id); }); }} />
      : <AddTeam unit={unit} act={act} />}
    {ev.players.map(p => { const on = ev.active.includes(p.id); return <div key={p.id} className="card row between"><span className={on ? '' : 'muted'}><b>{p.name}</b> {p.dupr ? 'DUPR ' + p.dupr : ''} {p.gender || ''}{on ? '' : ' — out'}</span>
      <button className={on ? 'ghost danger' : 'ghost'} onClick={() => act(e => { e.active = on ? e.active.filter(x => x !== p.id) : [...e.active, p.id]; })}>{on ? 'Remove' : 'Return'}</button></div>; })}
    <p className="muted small">Changes apply from the next round. Past scores are kept.{regen ? ' The current round has no scores yet, so you can re-draw it now.' : ''}</p>
    {regen && <button className="big" onClick={() => act(e => { e.rounds.pop(); e.rounds.push(nextRound(e)); })}>🔀 Re-draw current round</button>}
    <h2>Settings</h2>
    <label>Courts</label><Stepper value={ev.courts} min={1} max={30} onChange={n => act(e => { e.courts = n; })} />
    <label>Total rounds</label><Stepper value={ev.totalRounds} min={Math.max(1, ev.rounds.filter(r => !r.playoff).length)} max={60} onChange={n => act(e => { e.totalRounds = n; e.finished = false; })} />
    <label className="row check"><input type="checkbox" checked={ev.balanceDupr} onChange={x => act(e => { e.balanceDupr = x.target.checked; })} /> Balance by DUPR</label>
    <button className="big" onClick={download}>⬇️ Export scores (CSV)</button>
    <button className="big" onClick={() => { const code2 = S.newCode(); const copy: EventT = { ...JSON.parse(JSON.stringify(ev)), id: code2, rounds: [], finished: false, date: localISO(), createdAt: Date.now() }; copy.rounds.push(nextRound(copy)); S.saveLocal(code2, copy, true); S.pushRemote(code2, copy).then(() => S.saveLocal(code2, copy, false)).catch(() => {}); go('e/' + code2); }}>📄 Duplicate as new event</button>
    <button className="big danger" onClick={() => confirm('Remove from this phone? (Others with the link keep it.)') && (S.forget(code), go(''))}>Remove from my list</button>
  </div>;
}

function AddTeam({ unit, act }: { unit: number; act: Act }) {
  const [names, setNames] = useState<string[]>(Array(unit).fill(''));
  return <div className="card"><b>Add a {unit === 2 ? 'pair' : 'team of 4'}</b>{names.map((n, i) => <input key={i} placeholder={'Player ' + (i + 1)} value={n} onChange={e => { const c = [...names]; c[i] = e.target.value; setNames(c); }} />)}
    <button className="primary full" disabled={names.some(n => !n.trim())} onClick={() => { const ps = names.map(n => ({ id: S.uid(), name: n.trim() })); ps.forEach(S.addToRoster); act(e => { e.players.push(...ps); e.active.push(...ps.map(p => p.id)); e.teams.push(ps.map(p => p.id)); }); setNames(Array(unit).fill('')); }}>Add</button></div>;
}
