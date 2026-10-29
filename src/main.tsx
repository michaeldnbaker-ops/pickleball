import '@fontsource-variable/montserrat';
import '@fontsource-variable/inter';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
declare const __BUILD__: string;
// Updates apply on their own: check version.json (never cached) on open and whenever the app comes back to the foreground; reload once if a newer build is live.
async function checkVersion() {
  try {
    const r = await fetch('./version.json?t=' + Date.now(), { cache: 'no-store' }); if (!r.ok) return;
    const v = (await r.json()).build as string;
    if (v && v !== __BUILD__ && sessionStorage.getItem('pb:reloadedFor') !== v) {
      sessionStorage.setItem('pb:reloadedFor', v);
      const regs = await navigator.serviceWorker?.getRegistrations?.() || []; await Promise.all(regs.map(x => x.update().catch(() => {})));
      if (self.caches) for (const k of await caches.keys()) await caches.delete(k);
      location.reload();
    }
  } catch { /* offline */ }
}
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then(r => r.update()).catch(() => {});
if (location.hostname !== 'localhost') {
  checkVersion(); document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkVersion(); });
}
