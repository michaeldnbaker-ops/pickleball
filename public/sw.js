// Network-first, never from the HTTP cache, for the app shell; cache fallback only when offline. API calls are not cached.
const C='pb-v15';
self.addEventListener('install',e=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil((async()=>{for(const k of await caches.keys())if(k!==C)await caches.delete(k);await self.clients.claim();})()));
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==location.origin)return;
if(u.pathname.endsWith('/version.json'))return;
const html=e.request.mode==='navigate'||u.pathname.endsWith('/')||u.pathname.endsWith('.html');
e.respondWith(fetch(e.request,html?{cache:'no-store'}:{}).then(r=>{if(r.ok){const c=r.clone();caches.open(C).then(x=>x.put(e.request,c));}return r;}).catch(()=>caches.match(e.request).then(r=>r||caches.match('./'))));});
