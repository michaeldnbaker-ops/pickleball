import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import ece from 'http_ece';
import { shouldNotify, gameWhen, noteFor, endpointOk, SITE, encryptPush } from './push';

describe('new-game notifications', () => {
  it('notifies only a brand-new public game', () => {
    expect(shouldNotify(true, {})).toBe(true);
    expect(shouldNotify(false, {})).toBe(false);
    expect(shouldNotify(true, { hidden: true })).toBe(false);
    expect(shouldNotify(true, { finished: true })).toBe(false);
    expect(shouldNotify(true, { addedLater: true })).toBe(false);
    expect(shouldNotify(true, null)).toBe(false);
  });
  it('text is the game name plus the clock time on the game, and the link opens that game', () => {
    expect(gameWhen('2026-10-29T18:30')).toBe('Thursday, Oct 29 · 6:30 PM');
    expect(gameWhen('2026-01-01T00:05')).toBe('Thursday, Jan 1 · 12:05 AM');
    expect(gameWhen('2026-01-01T12:00')).toBe('Thursday, Jan 1 · 12:00 PM');
    expect(gameWhen('nope')).toBe('');
    const n = noteFor('  Thursday   Night  ', '2026-10-29T18:30', 'AB12');
    expect(n.title).toBe('Thursday Night');
    expect(n.body).toBe('Thursday, Oct 29 · 6:30 PM');
    expect(n.url).toBe(SITE + '/?g=AB12');
    expect(n.tag).toBe('AB12');
  });
  it('accepts real push services and only our own catch URL for tests', () => {
    const host = 'api.example.test';
    expect(endpointOk('https://fcm.googleapis.com/fcm/send/abc', false, host)).toBe(true);
    expect(endpointOk('https://web.push.apple.com/Q', false, host)).toBe(true);
    expect(endpointOk('https://updates.push.services.mozilla.com/wpush/v2/x', false, host)).toBe(true);
    expect(endpointOk('https://wns2-ab.notify.windows.com/w/?token=1', false, host)).toBe(true);
    expect(endpointOk('https://evil.example/push', false, host)).toBe(false);
    expect(endpointOk('http://fcm.googleapis.com/x', false, host)).toBe(false);
    expect(endpointOk('https://api.example.test/push/catch/abcd1234', true, host)).toBe(true);
    expect(endpointOk('https://fcm.googleapis.com/fcm/send/abc', true, host)).toBe(false);
    expect(endpointOk('https://api.example.test/push/catch/short', true, host)).toBe(false);
  });
  it('round-trips a payload encrypted the way Web Push sends it', () => {
    const curve = crypto.createECDH('prime256v1');
    curve.generateKeys();
    const p256dh = curve.getPublicKey().toString('base64url');
    const auth = crypto.randomBytes(16).toString('base64url');
    const payload = JSON.stringify(noteFor('Thursday Night', '2026-10-29T18:30', 'AB12'));
    const plain = ece.decrypt(encryptPush(p256dh, auth, payload), { version: 'aes128gcm', privateKey: curve, authSecret: auth });
    expect(plain.toString()).toBe(payload);
  });
});
