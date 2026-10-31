// Network-first, never from the HTTP cache, for the app shell; cache fallback only when offline. API calls are not cached.
const C='pb-v42';
self.addEventListener('install',e=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil((async()=>{for(const k of await caches.keys())if(k!==C)await caches.delete(k);await self.clients.claim();})()));
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==location.origin)return;
if(u.pathname.endsWith('/version.json'))return;
const html=e.request.mode==='navigate'||u.pathname.endsWith('/')||u.pathname.endsWith('.html');
e.respondWith((html?fetch(e.request.url,{cache:'no-store',credentials:'same-origin'}):fetch(e.request)).then(r=>{if(r.ok){const c=r.clone();caches.open(C).then(x=>x.put(e.request,c));}return r;}).catch(()=>caches.match(e.request).then(r=>r||caches.match('./'))));});
// New game: name + time. Tapping opens that game.
self.addEventListener('push', e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch { d = {}; }
  const title = d.title || 'New game';
  const url = d.url || './';
  e.waitUntil(self.registration.showNotification(title, { body: d.body || '', icon: 'icon-192.png', badge: 'icon-192.png', data: { url }, tag: d.tag || 'game' }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './', self.location.origin).href;
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) { if (new URL(c.url).origin === self.location.origin) { await c.focus(); if (c.navigate) await c.navigate(url); return; } }
    await self.clients.openWindow(url);
  })());
});
