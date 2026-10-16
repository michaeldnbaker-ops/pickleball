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
export async function pushRemote(code: string, ev: EventT) {
  const r = await fetch(`${API}/e/${code}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data: ev }) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
}
/** Load: push pending local changes first, else take server copy. Falls back to local offline. */
export async function load(code: string): Promise<{ ev: EventT | null; online: boolean }> {
  const local = localEvent(code);
  try {
    if (local && isDirty(code)) { await pushRemote(code, local); saveLocal(code, local, false); return { ev: local, online: true }; }
    const remote = await fetchRemote(code);
    if (remote) { saveLocal(code, remote, false); return { ev: remote, online: true }; }
    return { ev: local, online: true };
  } catch { return { ev: local, online: false }; }
}
/** Mutate: re-fetch latest (to avoid clobbering others), apply change, save locally, push. */
export async function mutate(code: string, fn: (e: EventT) => void, current: EventT): Promise<{ ev: EventT; online: boolean }> {
  let base = current;
  try { if (!isDirty(code)) { const r = await fetchRemote(code); if (r) base = r; } } catch { /* offline */ }
  const ev: EventT = JSON.parse(JSON.stringify(base)); fn(ev);
  saveLocal(code, ev, true);
  try { await pushRemote(code, ev); saveLocal(code, ev, false); return { ev, online: true }; } catch { return { ev, online: false }; }
}
