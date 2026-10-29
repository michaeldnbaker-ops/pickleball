import crypto from 'node:crypto';
import https from 'node:https';

/** Players open the live site. Game links are ?g=CODE, which the app turns into the join screen. */
export const SITE = 'https://stonecreekpickleballclub.com';
const SUBJECT = 'mailto:notify@stonecreekpickleballclub.com';

/** A brand-new public game (not an edit, not a hidden test, not an already-finished or added-later game). */
export function shouldNotify(isNew: boolean, ev?: { hidden?: boolean; finished?: boolean; addedLater?: boolean } | null) {
  return isNew && !!ev && !ev.hidden && !ev.finished && !ev.addedLater;
}

/** Wall-clock date stored on the game ('YYYY-MM-DDTHH:MM'), not shifted by a timezone. */
export function gameWhen(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(date || '');
  if (!m) return '';
  const y = +m[1], mo = +m[2], d = +m[3], hh = +m[4], mm = +m[5];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || hh > 23 || mm > 59) return '';
  const wd = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(Date.UTC(y, mo - 1, d)).getUTCDay()];
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][mo - 1];
  const h12 = hh % 12 || 12;
  return `${wd}, ${mon} ${d} · ${h12}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}`;
}

/** Notification the phone shows: game name + time. Tapping opens the game. */
export function noteFor(name: string, date: string, code: string) {
  const title = (name || '').trim().replace(/\s+/g, ' ').slice(0, 80) || 'New game';
  const when = gameWhen(date);
  return { title, body: when || 'A new game was created', url: `${SITE}/?g=${encodeURIComponent(code)}`, tag: code };
}

const PUSH_HOST = /^(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com)$/i;

/** Real browsers talk to a known push service. Test subscriptions may only point at this API's catch URL (no arbitrary hosts). */
export function endpointOk(endpoint: string, test: boolean, apiHost: string): boolean {
  let u: URL;
  try { u = new URL(endpoint); } catch { return false; }
  if (u.protocol !== 'https:' || u.username || u.password) return false;
  if (test) return u.host === apiHost && /^\/push\/catch\/[A-Za-z0-9]{8,64}$/.test(u.pathname);
  if (PUSH_HOST.test(u.hostname)) return true;
  if (u.hostname.endsWith('.push.services.mozilla.com')) return true;
  if (u.hostname.endsWith('.notify.windows.com')) return true;
  return false;
}

type Row = { public_key: string; private_key: string };
type Client = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Row[] }>; release: () => void };
type Poolish = { connect: () => Promise<Client> };
let vapid: { publicKey: string; privateKey: string } | null = null;

function b64url(buf: Buffer) { return buf.toString('base64url'); }
function pad32(buf: Buffer) { return buf.length >= 32 ? buf : Buffer.concat([Buffer.alloc(32 - buf.length), buf]); }
export function generateVapid() {
  const curve = crypto.createECDH('prime256v1'); curve.generateKeys();
  return { publicKey: b64url(curve.getPublicKey()), privateKey: b64url(pad32(curve.getPrivateKey())) };
}
function hkdf(salt: Buffer, ikm: Buffer, info: Buffer, len: number) {
  const prk = crypto.createHmac('sha256', salt).update(ikm).digest();
  let t = Buffer.alloc(0), out = Buffer.alloc(0); let c = 0;
  while (out.length < len) { c++; t = crypto.createHmac('sha256', prk).update(Buffer.concat([t, info, Buffer.from([c])])).digest(); out = Buffer.concat([out, t]); }
  return out.subarray(0, len);
}
/** aes128gcm body a push service (and our tests) can decrypt. */
export function encryptPush(p256dh: string, auth: string, payload: string) {
  const ua = Buffer.from(p256dh, 'base64url');
  const as = crypto.createECDH('prime256v1'); as.generateKeys();
  const salt = crypto.randomBytes(16);
  const secret = hkdf(Buffer.from(auth, 'base64url'), as.computeSecret(ua), Buffer.concat([Buffer.from('WebPush: info\0'), ua, as.getPublicKey()]), 32);
  const key = hkdf(salt, secret, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(salt, secret, Buffer.from('Content-Encoding: nonce\0'), 12);
  const gcm = crypto.createCipheriv('aes-128-gcm', key, nonce);
  const ct = Buffer.concat([gcm.update(payload), gcm.update(Buffer.from([2])), gcm.final(), gcm.getAuthTag()]);
  const head = Buffer.alloc(21); salt.copy(head, 0); head.writeUInt32BE(4096, 16); head[20] = 65;
  return Buffer.concat([head, as.getPublicKey(), ct]);
}
function vapidJwt(origin: string, publicKey: string, privateKey: string) {
  const pub = Buffer.from(publicKey, 'base64url');
  const header = b64url(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64url(Buffer.from(JSON.stringify({ aud: origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: SUBJECT })));
  const key = crypto.createPrivateKey({ key: { kty: 'EC', crv: 'P-256', d: privateKey, x: b64url(pub.subarray(1, 33)), y: b64url(pub.subarray(33)) }, format: 'jwk' });
  const sig = crypto.sign('sha256', Buffer.from(header + '.' + body), { key, dsaEncoding: 'ieee-p1363' });
  return 'vapid t=' + header + '.' + body + '.' + b64url(sig) + ', k=' + publicKey;
}
function postPush(endpoint: string, body: Buffer, authorization: string): Promise<number> {
  const u = new URL(endpoint);
  return new Promise((resolve, reject) => {
    const req = https.request({ method: 'POST', hostname: u.hostname, path: u.pathname + u.search, timeout: 8000, headers: { TTL: '86400', 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', 'Content-Length': body.length, Authorization: authorization } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode || 0)); });
    req.on('error', reject); req.on('timeout', () => req.destroy(new Error('timeout'))); req.end(body);
  });
}
/** One VAPID key pair for the whole club, created once and kept in Postgres. */
export async function vapidPublic(pool: Poolish): Promise<string> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('lock table push_vapid in exclusive mode');
    const cur = await client.query('select public_key, private_key from push_vapid where id=1');
    let row = cur.rows[0];
    if (!row) {
      const k = generateVapid();
      await client.query('insert into push_vapid(id, public_key, private_key) values (1,$1,$2)', [k.publicKey, k.privateKey]);
      row = { public_key: k.publicKey, private_key: k.privateKey };
    }
    await client.query('commit');
    vapid = { publicKey: row.public_key, privateKey: row.private_key };
    return row.public_key;
  } catch (e) { try { await client.query('rollback'); } catch { /* already finished */ } throw e; }
  finally { client.release(); }
}

export interface Sub { endpoint: string; p256dh: string; auth: string }
/** Fan-out. A 404/410 from the push service drops that phone's subscription. */
export async function notifySubs(pool: Poolish & { query: (sql: string, params?: unknown[]) => Promise<unknown> }, subs: Sub[], payload: object) {
  if (!subs.length) return 0;
  await vapidPublic(pool);
  const body = JSON.stringify(payload);
  let ok = 0, i = 0;
  await Promise.all(Array.from({ length: Math.min(8, subs.length) }, async () => {
    while (i < subs.length) {
      const sub = subs[i++];
      const r = await sendOne(sub, body);
      if (r === 'ok') ok++;
      else if (r === 'gone') await pool.query('delete from push_subs where endpoint=$1', [sub.endpoint]);
    }
  }));
  return ok;
}
/** Send one notification. 404/410 means the phone unsubscribed; caller deletes the row. */
export async function sendOne(sub: Sub, payload: string): Promise<'ok' | 'gone' | 'err'> {
  if (!vapid) return 'err';
  try {
    const status = await postPush(sub.endpoint, encryptPush(sub.p256dh, sub.auth, payload), vapidJwt(new URL(sub.endpoint).origin, vapid.publicKey, vapid.privateKey));
    if (status >= 200 && status < 300) return 'ok';
    if (status === 404 || status === 410) return 'gone';
    return 'err';
  } catch { return 'err'; }
}
