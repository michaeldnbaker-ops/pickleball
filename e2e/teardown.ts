// Runs after every Playwright run (local and live): removes ONLY hidden test data through the API's admin-only cleanup endpoint,
// and checks the public (real) data is identical before/after. The admin key comes from ADMIN_KEY or the bot's private store file; it is never committed.
import { readFileSync, existsSync } from 'node:fs';
const API = 'https://br-weathered-heart-b520ib6i-pbapi.compute.c-7.us-east-2.aws.neon.tech';
const KEYFILE = '/cursor/stores/store-51a247a5-b164-434b-9dfc-b84c9c51c03a/secrets/pickleball-admin-key.txt';
export default async function teardown() {
  const key = process.env.ADMIN_KEY || (existsSync(KEYFILE) ? readFileSync(KEYFILE, 'utf8').trim() : '');
  if (!key) { console.log('[cleanup] skipped: no admin key available'); return; }
  const pub = async () => JSON.stringify(await Promise.all(['/stats', '/past', '/clubs', '/icons'].map(p => fetch(API + p, { cache: 'no-store' }).then(r => r.json()))));
  const before = await pub();
  const r = await fetch(API + '/test/cleanup?test=1', { method: 'POST', headers: { 'x-admin': key } });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('[cleanup] failed: HTTP ' + r.status + ' ' + JSON.stringify(b));
  const after = await pub();
  if (before !== after) throw new Error('[cleanup] public data changed during cleanup!');
  console.log('[cleanup] removed hidden test data:', JSON.stringify(b.deleted), '· public data unchanged');
}
