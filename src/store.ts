import type { EventT, Player } from './engine/engine';
export const API = 'https://br-weathered-heart-b520ib6i-pbapi.compute.c-7.us-east-2.aws.neon.tech';
const LS = localStorage;
export const uid = () => Math.random().toString(36).slice(2, 10);
export const newCode = () => Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
export const getRoster = (): Player[] => JSON.parse(LS.getItem('pb:roster') || '[]');
export const setRoster = (r: Player[]) => LS.setItem('pb:roster', JSON.stringify(r));
export function addToRoster(p: Player) { const r = getRoster(); if (!r.some(x => x.name.toLowerCase() === p.name.toLowerCase())) { r.push(p); setRoster(r); } }
export const localEvent = (code: string): EventT | null => JSON.parse(LS.getItem('pb:ev:' + code) || 'null');
export const isDirty = (code: string) => LS.getItem('pb:dirty:' + code) === '1';
export function saveLocal(code: string, ev: EventT, dirty: boolean) {
  LS.setItem('pb:ev:' + code, JSON.stringify(ev)); dirty ? LS.setItem('pb:dirty:' + code, '1') : LS.removeItem('pb:dirty:' + code);
  const list = myEvents().filter(e => e.code !== code); list.unshift({ code, name: ev.name, date: ev.date }); LS.setItem('pb:list', JSON.stringify(list.slice(0, 50)));
}
export const myEvents = (): { code: string; name: string; date: string }[] => JSON.parse(LS.getItem('pb:list') || '[]');
export const forget = (code: string) => { LS.setItem('pb:list', JSON.stringify(myEvents().filter(e => e.code !== code))); };
export const getMe = (code: string) => LS.getItem('pb:me:' + code) || '';
export const setMe = (code: string, id: string) => LS.setItem('pb:me:' + code, id);

export async function fetchRemote(code: string): Promise<EventT | null> {
  const r = await fetch(`${API}/e/${code}`, { cache: 'no-store' });
  if (r.status === 404) return null; if (!r.ok) throw new Error('HTTP ' + r.status);
  return (await r.json()).data;
}
export class StartedError extends Error { reason: string; constructor(reason = 'started') { super(reason); this.reason = reason; } }
export async function pushRemote(code: string, ev: EventT) {
  const r = await fetch(`${API}/e/${code}?by=${encodeURIComponent(getMe(code) || (isOrg(code) ? 'organizer' : ''))}${isOrg(code) ? '&org=1' : ''}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data: ev }) });
  if (r.status === 409) { let why = 'started'; try { why = (await r.json()).error || why; } catch { /* keep */ } throw new StartedError(why); }
  if (!r.ok) throw new Error('HTTP ' + r.status);
}
/** Server refused a join because the game already started: drop the local edit and take the server copy. */
async function rejected(code: string, fallback: EventT): Promise<{ ev: EventT; online: boolean; started: true }> {
  let ev = fallback; try { ev = (await fetchRemote(code)) || fallback; } catch { /* keep */ }
  saveLocal(code, ev, false); return { ev, online: true, started: true };
}
/** Load: push pending local changes first, else take server copy. Falls back to local offline. */
export async function load(code: string): Promise<{ ev: EventT | null; online: boolean }> {
  const local = localEvent(code);
  try {
    if (local && isDirty(code)) { try { await pushRemote(code, local); } catch (e) { if (e instanceof StartedError) return rejected(code, local); throw e; } saveLocal(code, local, false); return { ev: local, online: true }; }
    const remote = await fetchRemote(code);
    if (remote) { saveLocal(code, remote, false); return { ev: remote, online: true }; }
    return { ev: local, online: true };
  } catch { return { ev: local, online: false }; }
}
/** Mutate: re-fetch latest (to avoid clobbering others), apply change, save locally, push. */
export async function mutate(code: string, fn: (e: EventT) => void, current: EventT): Promise<{ ev: EventT; online: boolean; started?: boolean }> {
  let base = current;
  try { if (!isDirty(code)) { const r = await fetchRemote(code); if (r) base = r; } } catch { /* offline */ }
  const ev: EventT = JSON.parse(JSON.stringify(base)); fn(ev);
  saveLocal(code, ev, true);
  try { await pushRemote(code, ev); saveLocal(code, ev, false); return { ev, online: true }; } catch (e) { if (e instanceof StartedError) return rejected(code, base); return { ev, online: false }; }
}

export interface Listed { code: string; name: string; date: string; place: string; format: string; players: number; rounds: number; max?: number | null }
/** Public upcoming games not yet started, soonest first (hides events more than a day past). */
export async function listEvents(): Promise<Listed[]> {
  const d = new Date(Date.now() - 864e5); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  const r = await fetch(`${API}/events?from=${d.toISOString().slice(0, 16)}${testMode() ? '&test=1' : ''}`, { cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status); return (await r.json()).events;
}
export const testMode = () => LS.getItem('pb:hidden') === '1';

export interface Stat { k: string; name: string; games: number; wins: number; losses: number; pf: number; pa: number; diff: number; events: number; trophies?: number }
export interface StatMatch { id: string; code: string; ev_name: string; date: string; an: string[]; bn: string[]; sa: number; sb: number }
const q = () => (testMode() ? '&test=1' : '');
export async function statsBoard(): Promise<Stat[]> { const r = await fetch(`${API}/stats?x=1${q()}`, { cache: 'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status); return (await r.json()).players; }
export async function statsPlayer(name: string): Promise<StatMatch[]> { const r = await fetch(`${API}/stats/player?name=${encodeURIComponent(name)}${q()}`, { cache: 'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status); return (await r.json()).matches; }
export const isOrg = (code: string) => LS.getItem('pb:org:' + code) === '1';
export const setOrg = (code: string) => LS.setItem('pb:org:' + code, '1');
export async function listPast(): Promise<Listed[]> { const r = await fetch(`${API}/past?x=1${q()}`, { cache: 'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status); return (await r.json()).events; }
export const setTab = (code: string, t: string) => sessionStorage.setItem('pb:tab:' + code, t);
export const takeTab = (code: string) => { const t = sessionStorage.getItem('pb:tab:' + code); sessionStorage.removeItem('pb:tab:' + code); return t; };
/** Creator cancels an unstarted game: deleted on the server for everyone. */
export async function deleteRemote(code: string) {
  const r = await fetch(`${API}/e/${code}`, { method: 'DELETE' });
  if (r.status === 409) throw new Error('started'); if (!r.ok && r.status !== 404) throw new Error('HTTP ' + r.status);
  LS.removeItem('pb:ev:' + code); LS.removeItem('pb:dirty:' + code);
}

// ---- Player icons ----
export const ICONS: Record<string, string> = { paddle: '🏓', ball: '🥎', star: '⭐', fire: '🔥', bolt: '⚡', eagle: '🦅', tiger: '🐯', fox: '🦊', bear: '🐻', turtle: '🐢', cactus: '🌵', wave: '🌊', clover: '🍀', crown: '👑', rocket: '🚀', target: '🎯' };
export interface IconT { icon: string | null; photo: boolean; v: number }
export const iconKey = (n: string) => (n || '').trim().replace(/\s+/g, ' ').toLowerCase();
let icons: Record<string, IconT> = (() => { try { return JSON.parse(LS.getItem('pb:icons') || '{}'); } catch { return {}; } })();
const subs = new Set<() => void>(); let lastLoad = 0;
export const iconsNow = () => icons;
export function onIcons(f: () => void) { subs.add(f); return () => { subs.delete(f); }; }
export async function loadIcons(force = false) {
  if (!force && Date.now() - lastLoad < 30000) return; lastLoad = Date.now();
  try { const r = await fetch(`${API}/icons?x=1${q()}`, { cache: 'no-store' }); if (!r.ok) return; icons = (await r.json()).icons || {}; LS.setItem('pb:icons', JSON.stringify(icons)); subs.forEach(f => f()); } catch { /* offline: cached */ }
}
export const photoUrl = (k: string, v: number) => `${API}/icon?k=${encodeURIComponent(k)}&v=${v}`;
export const adminKey = () => LS.getItem('pb:admin') || '';
const ah = (): Record<string, string> => adminKey() ? { 'x-admin': adminKey() } : {};
export const ownsIcon = (name: string) => !!LS.getItem('pb:iconTok:' + iconKey(name));
/** Set a player's icon (built-in id or JPEG data URL). 'notOwner' = another phone owns this name's icon. */
export async function setIcon(name: string, v: { icon?: string; photo?: string }): Promise<'ok' | 'notOwner' | 'error'> {
  const k = iconKey(name);
  try {
    const r = await fetch(`${API}/icon?x=1${q()}`, { method: 'PUT', headers: { 'content-type': 'application/json', ...ah() }, body: JSON.stringify({ name, ...v, token: LS.getItem('pb:iconTok:' + k) || undefined }) });
    if (r.status === 403) return 'notOwner'; if (!r.ok) return 'error';
    const b = await r.json(); if (b.token) LS.setItem('pb:iconTok:' + k, b.token);
    await loadIcons(true); return 'ok';
  } catch { return 'error'; }
}
export async function resetIcon(name: string) {
  const r = await fetch(`${API}/icon?x=1${q()}`, { method: 'PUT', headers: { 'content-type': 'application/json', ...ah() }, body: JSON.stringify({ name, reset: true }) });
  await loadIcons(true); return r.ok;
}
export async function checkAdmin(key: string) { const r = await fetch(`${API}/admin`, { headers: { 'x-admin': key }, cache: 'no-store' }); return r.ok && !!(await r.json()).admin; }
export interface Trophy { code: string; ev_name: string; date: string; w: number; diff: number }
export async function playerTrophies(name: string): Promise<Trophy[]> { const r = await fetch(`${API}/stats/player?name=${encodeURIComponent(name)}${q()}`, { cache: 'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status); return (await r.json()).trophies || []; }
