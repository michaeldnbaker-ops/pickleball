import { test, expect, devices } from '@playwright/test';
test.use({ ...devices['iPhone 13'], browserName: 'chromium' });
const BASE = process.env.BASE || 'http://localhost:4173/';
const API = 'https://br-weathered-heart-b520ib6i-pbapi.compute.c-7.us-east-2.aws.neon.tech';
/** Every context in this suite: test mode on, and any game write is force-flagged hidden so e2e games never reach the public Join list/stats. */
async function markTest(ctx: import('@playwright/test').BrowserContext) {
  await ctx.addInitScript(() => localStorage.setItem('pb:hidden', '1'));
  await ctx.route(API + '/e/*', async r => { if (r.request().method() !== 'PUT') return r.continue(); const b = r.request().postDataJSON(); if (b?.data) b.data.hidden = true; await r.continue({ postData: JSON.stringify(b) }); });
}
// test-created games are flagged hidden so they never show in the public Join list or all-time stats
test.beforeEach(async ({ page }) => { await markTest(page.context()); });
// safety net: after the run, nothing created by this suite may be visible in the public Join list
test.afterAll(async ({ request }) => { const r = await (await request.get(API + '/events?from=2000-01-01T00:00')).json(); expect(r.events.filter((e: { name: string }) => /test|e2e|demo/i.test(e.name || ''))).toEqual([]); });
const startGame = async (page: import('@playwright/test').Page) => {
  await page.getByRole('button', { name: 'Create game' }).click();
  await page.getByRole('button', { name: 'Start game', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Start game' }).click();
};
test('organizer runs a round robin, player view sees it after refresh', async ({ page, browser }) => {
  page.on('dialog', d => d.accept());
  await page.goto(BASE);
  await page.getByText('Create a game').click();
  await page.getByPlaceholder('e.g. the gym').fill('Gym');
  await page.getByText('Next: Players').click();
  for (let i = 1; i <= 8; i++) { await page.getByPlaceholder('Name').fill('Player' + i); await page.getByLabel('DUPR (optional)').fill(String(3 + i / 10)); await page.getByText('Add new player').click(); }
  await expect(page.getByText('8 selected')).toBeVisible();
  await page.getByRole('button', { name: 'Next ›' }).click();
  await startGame(page);
  await expect(page.getByRole('heading', { name: /Round 1/ })).toBeVisible();
  await expect(page.locator('.match')).toHaveCount(2);
  await expect(page.getByText('Sitting out', { exact: true })).toHaveCount(0);
  const code = page.url().split('/e/')[1];
  // score both courts independently
  for (let c = 0; c < 2; c++) { const card = page.locator('.match').nth(c); await card.locator('.scorebox input').first().fill('11'); await card.locator('.scorebox').nth(1).locator('input').fill(String(5 + c)); await card.getByText('Save').click(); await expect(page.locator('.match').nth(c).locator('.final')).toBeVisible(); if (c === 0) await page.waitForTimeout(300); }
  await page.getByRole('button', { name: /Next: Round 2/ }).click();
  await expect(page.getByRole('heading', { name: /Round 2/ })).toBeVisible();
  await page.getByRole('button', { name: 'Standings', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(8);
  // player phone
  const ctx = await browser.newContext({ ...devices['Pixel 7'] }); await markTest(ctx); const p2 = await ctx.newPage();
  await p2.goto(BASE + '#/e/' + code);
  await expect(p2.getByText('This game already started')).toBeVisible(); // not yet identified → started screen with name picker
  await p2.getByRole('button', { name: 'Player3', exact: true }).click();
  await expect(p2.getByText('Hi, Player3')).toBeVisible();
  await expect(p2.locator('.next')).toBeVisible();
  // roster is locked after the start: no add / drop controls in Manage
  await page.getByRole('button', { name: 'Manage', exact: true }).click();
  await expect(page.getByText('Roster locked')).toBeVisible(); await expect(page.getByText('Add late player')).toHaveCount(0); await expect(page.getByRole('button', { name: /Drop/ })).toHaveCount(0);
  const box = await page.locator('.tabs button').first().boundingBox(); expect(box!.height).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: 'e2e/shot-manage.png' });
  await page.locator('.tabs button').first().click(); await page.screenshot({ path: 'e2e/shot-courts.png' });
  await p2.getByRole('button', { name: 'Me', exact: true }).click(); await p2.screenshot({ path: 'e2e/shot-me.png' });
});
test('KOTC and playoffs reach a champion', async ({ page }) => {
  page.on('dialog', d => d.accept());
  await page.goto(BASE + '#/new');
  await page.getByText('King of the Court').click();
  await page.getByText('Next: Players').click();
  for (let i = 1; i <= 8; i++) { await page.getByPlaceholder('Name').fill('K' + i); await page.getByText('Add new player').click(); }
  await page.getByRole('button', { name: 'Next ›' }).click();
  for (let i = 0; i < 7; i++) await page.locator('.stepper').first().getByText('−').click();
  await startGame(page);
  const scoreAll = async () => { await expect(page.locator('.match').first()).toBeVisible(); const n = await page.locator('.match').count(); for (let c = 0; c < n; c++) { const card = page.locator('.match').nth(c); await card.locator('.scorebox input').first().fill('11'); await card.locator('.scorebox input').nth(1).fill('4'); await card.getByText('Save').click(); await expect(card.locator('.final')).toBeVisible(); } };
  await scoreAll(); await expect(page.getByText("That's the last round.")).toBeVisible(); await page.getByText('Start playoffs ›').click();
  await expect(page.getByRole('heading', { name: 'Semifinals' })).toBeVisible(); await scoreAll();
  await page.getByText('Next playoff round').click(); await expect(page.getByRole('heading', { name: 'Final', exact: true })).toBeVisible(); await scoreAll();
  await page.getByText('Finish event').click(); await expect(page.getByText(/Champions:/)).toBeVisible();
});
test('warns before advancing with unscored courts; labels, typing, format highlight', async ({ page }) => {
  await page.goto(BASE + '#/new');
  await page.getByLabel('Event name').fill('Warn test');
  await page.getByLabel('Place').fill('Gym');
  await expect(page.getByRole('listbox', { name: 'Hour' })).toBeVisible();
  await page.getByRole('radio', { name: /Ladder/ }).click();
  await expect(page.getByRole('radio', { name: /Ladder/ })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('radio', { name: /Round Robin/ })).toHaveAttribute('aria-checked', 'false');
  await page.screenshot({ path: 'e2e/shot-format.png' });
  await page.getByText('Next: Players').click();
  for (let i = 1; i <= 8; i++) { await page.getByLabel('Player name').fill('W' + i); await page.getByText('Add new player').click(); }
  await page.getByRole('button', { name: 'Next ›' }).click();
  await startGame(page);
  const c1 = page.locator('.match').first();
  await c1.locator('.scorebox input').first().fill('11'); await c1.locator('.scorebox input').nth(1).fill('8');
  await c1.getByText('Save').click(); await expect(c1.locator('.pts').first()).toHaveText('11'); await expect(c1.locator('.pts').nth(1)).toHaveText('8');
  let native = false; page.on('dialog', d => { native = true; d.dismiss(); });
  await page.getByRole('button', { name: /Next: Round 2/ }).click();
  const sheet = page.getByRole('alertdialog');
  await expect(sheet).toContainText('Court B');
  await page.screenshot({ path: 'e2e/shot-warning.png' });
  await sheet.getByText('Go back and enter scores').click();
  await expect(sheet).toHaveCount(0); await expect(page.getByRole('heading', { name: /Round 1/ })).toBeVisible();
  await page.getByRole('button', { name: /Next: Round 2/ }).click();
  await page.getByRole('alertdialog').getByText('Continue anyway').click();
  await expect(page.getByRole('heading', { name: /Round 2/ })).toBeVisible();
  expect(native).toBe(false);
  // full width at phone size
  const w = await page.evaluate(() => [document.querySelector('.page')!.getBoundingClientRect().width, innerWidth]);
  expect(w[0]).toBe(w[1]);
  const c = page.locator('.match').first(); await c.locator('.scorebox input').first().fill('9');
  await page.screenshot({ path: 'e2e/shot-courts.png' });
});

test('Swish-style round pages: strip, arrows, swipe, preview, me highlight, me mini cards', async ({ page }) => {
  await page.goto(BASE + '#/new');
  await page.getByLabel('Place').fill('Stone Creek');
  await page.getByText('Next: Players').click();
  const names = ['Ann', 'Bob', 'Cat', 'Dan', 'Eve', 'Fay', 'Gus', 'Hal', 'Ivy', 'Jo', 'Kai', 'Lu'];
  for (const n of names) { await page.getByLabel('Player name').fill(n); await page.getByText('Add new player').click(); }
  await page.getByRole('button', { name: 'Next ›' }).click();
  await page.locator('.courtChip.on').last().click(); // 2 courts → 4 rotate out each round
  for (let i = 0; i < 2; i++) await page.locator('.stepper').first().getByText('−').click(); // 6 rounds
  await startGame(page);
  await expect(page.getByRole('heading', { name: 'Round 1 of 6' })).toBeVisible();
  await expect(page.locator('.strip .dot')).toHaveCount(6);
  await expect(page.locator('.dot.cur')).toHaveText('1');
  // each court: 2 stacked names per team + per-team score box
  const c1 = page.locator('.match').first();
  await expect(c1.locator('.side').first().locator('.names > div')).toHaveCount(2);
  await expect(c1.locator('.side').nth(1).locator('.names > div')).toHaveCount(2);
  await expect(c1.getByLabel('Team A score')).toBeVisible(); await expect(c1.getByLabel('Team B score')).toBeVisible();
  await expect(page.locator('.card.bye')).toContainText('Sitting out');
  // pick Me = first player on court 1
  const meName = (await c1.locator('.side').first().locator('.names > div').first().textContent())!.trim();
  await page.getByRole('button', { name: 'Me', exact: true }).click(); await page.getByRole('button', { name: meName, exact: true }).click();
  await page.locator('.tabs button').first().click();
  await expect(page.locator('.match.mine')).toHaveCount(1);
  await expect(page.locator('.match.mine .tag')).toHaveText('You & partner');
  expect(await page.evaluate(() => /\p{Extended_Pictographic}/u.test(document.body.innerText))).toBe(false); // no emoji in UI
  await page.screenshot({ path: 'e2e/shot-round.png' });
  // preview a future round with arrows: drawn pairings visible, no score entry
  await page.getByLabel('Next round').click();
  await expect(page.getByRole('heading', { name: 'Round 2 of 6' })).toBeVisible();
  await expect(page.getByText('Upcoming · preview')).toBeVisible();
  const preview = await page.locator('.match .names').allTextContents();
  expect(preview.length).toBeGreaterThan(0); await expect(page.locator('.match .scorebox').first()).toBeVisible();
  // jump via strip to round 5, then swipe right back to 4
  await page.locator('.strip .dot').nth(4).click(); await expect(page.getByRole('heading', { name: 'Round 5 of 6' })).toBeVisible();
  await page.screenshot({ path: 'e2e/shot-future.png' });
  await page.locator('.roundNav').dispatchEvent('touchstart', { touches: [{ identifier: 1, clientX: 60, clientY: 300 }] });
  await page.locator('.roundNav').dispatchEvent('touchend', { changedTouches: [{ identifier: 1, clientX: 300, clientY: 300 }] });
  await expect(page.getByRole('heading', { name: 'Round 4 of 6' })).toBeVisible();
  await page.getByText('Back to current round').click();
  // score all, big Next button, preview matches what is played
  for (let c = 0; c < 2; c++) { const card = page.locator('.match').nth(c); await card.getByLabel('Team A score').fill('11'); await card.getByLabel('Team B score').fill(String(3 + c)); await card.getByText('Save score').click(); await expect(card.locator('.final')).toBeVisible(); }
  await expect(page.locator('.dot').first()).toContainText('✓');
  const nxt = page.getByRole('button', { name: 'Next: Round 2 →' }); await expect(nxt).toHaveClass(/primary/);
  await page.screenshot({ path: 'e2e/shot-scored.png' });
  await nxt.click();
  await expect(page.getByRole('heading', { name: 'Round 2 of 6' })).toBeVisible(); await expect(page.getByText('Now playing')).toBeVisible();
  expect(await page.locator('.match .names').allTextContents()).toEqual(preview);
  // Me view: round-by-round mini cards incl. upcoming
  await page.getByRole('button', { name: 'Me', exact: true }).click();
  await expect(page.locator('.compact').first()).toBeVisible();
  expect(await page.locator('.compact').count()).toBe(6);
  await page.screenshot({ path: 'e2e/shot-me.png', fullPage: true });
});

const setup = async (page: import('@playwright/test').Page, names: string[], courtsMinus = 0, rounds = 6) => {
  await page.goto(BASE + '#/new'); await page.getByLabel('Place').fill('Gym'); await page.getByText('Next: Players').click();
  for (const n of names) { await page.getByLabel('Player name').fill(n); await page.getByText('Add new player').click(); }
  await page.getByRole('button', { name: 'Next ›' }).click();
  for (let i = 0; i < courtsMinus; i++) await page.locator('.courtChip.on').last().click();
  for (let i = 0; i < 8 - rounds; i++) await page.locator('.stepper').first().getByText('−').click();
  await startGame(page);
  await expect(page.getByRole('heading', { name: new RegExp('Round 1 of ' + rounds) })).toBeVisible();
};
const roundNames = async (page: import('@playwright/test').Page) => (await page.locator('.match .names').allTextContents()).join(' ');
test('play ahead locks a round', async ({ page }) => {
  await setup(page, ['Ann', 'Bob', 'Cat', 'Dan', 'Eve', 'Fay', 'Gus', 'Hal', 'Ivy', 'Jo', 'Kai', 'Lu'], 1);
  // play ahead: Court 1 of Round 3 finishes early
  await page.locator('.strip .dot').nth(2).click(); await expect(page.getByRole('heading', { name: 'Round 3 of 6' })).toBeVisible();
  const r3 = await roundNames(page);
  const c = page.locator('.match').first(); await c.getByLabel('Team A score').fill('11'); await c.getByLabel('Team B score').fill('9'); await c.getByText('Save score').click();
  await expect(page.getByText(/Playing ahead · pairings locked/)).toBeVisible(); await expect(c.locator('.final')).toBeVisible();
  await page.screenshot({ path: 'e2e/shot-playahead.png' });
  await page.getByText('Back to current round').click(); await expect(page.locator('.match .nameBtn')).toHaveCount(0); // tapping names no longer opens a drop sheet
  await page.locator('.strip .dot').nth(2).click(); expect(await roundNames(page)).toBe(r3);
});
test('landing, Join list + empty state (mocked), time wheel', async ({ page }) => {
  await page.goto(BASE);
  await expect(page.locator('.landBtns button')).toHaveCount(2); await expect(page.getByRole('heading', { name: 'Stone Creek Pickleball' })).toBeVisible(); await expect(page).toHaveTitle('Stone Creek Pickleball');
  await expect(page.getByRole('button', { name: 'Create a game' })).toBeVisible(); await expect(page.getByRole('button', { name: 'Join a game' })).toBeVisible();
  await expect(page.locator('.logo img.fullLogo')).toBeVisible(); expect(await page.locator('.logo img.fullLogo').evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(500);
  await page.screenshot({ path: 'e2e/shot-brand-landing.png' });
  expect(await page.evaluate(() => document.body.innerText.includes('🏓'))).toBe(false);
  await page.screenshot({ path: 'e2e/shot-landing.png' });
  const now = new Date(); const at = (addDays: number, h: number, m: number) => { const d = new Date(now); d.setDate(d.getDate() + addDays); d.setHours(h, m, 0, 0); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
  const thu = (4 - now.getDay() + 7) % 7, sun = (7 - now.getDay()) % 7 || 7;
  await page.route(API + '/events*', r => r.fulfill({ json: { events: [
    { code: 'THU630', name: 'Thursday Night Dinks', date: at(thu, 18, 30), place: 'Stone Creek Gym', format: 'rotating', players: 12, rounds: 0 },
    { code: 'SUN900', name: 'Sunday Morning Social', date: at(sun, 9, 0), place: 'Stone Creek Courts', format: 'kotc', players: 8, rounds: 0 }].sort((a, b) => a.date.localeCompare(b.date)) } }));
  await page.getByRole('button', { name: 'Join a game' }).click();
  await expect(page.locator('.game')).toHaveCount(2);
  await expect(page.locator('.game', { hasText: 'Thursday Night Dinks' })).toContainText('6:30 PM'); await expect(page.locator('.game', { hasText: 'Thursday Night Dinks' })).toContainText('12 players');
  await expect(page.locator('.game', { hasText: 'Sunday Morning Social' })).toContainText('9:00 AM');
  await page.screenshot({ path: 'e2e/shot-join-list.png' });
  await page.unroute(API + '/events*'); await page.route(API + '/events*', r => r.fulfill({ json: { events: [] } }));
  await page.reload(); await expect(page.getByText('No current games')).toBeVisible();
  expect(await page.evaluate(() => document.body.innerText.includes('🏓'))).toBe(false);
  await page.screenshot({ path: 'e2e/shot-join-empty.png' });
  await expect(page.locator('.empty').getByRole('button')).toHaveCount(0); await page.locator('.createTop').click();
  // calendar + wheels
  await page.locator('.day:not([disabled])').last().click();
  await page.getByRole('listbox', { name: 'Hour' }).getByRole('option', { name: '6', exact: true }).click();
  await page.getByRole('listbox', { name: 'Minute' }).getByRole('option', { name: '30' }).click();
  await page.getByRole('listbox', { name: 'AM/PM' }).getByRole('option', { name: 'PM' }).click();
  await expect(page.locator('.pickedTime')).toContainText('6:30 PM');
  // real scroll gesture on the minute wheel snaps to a 5-minute step
  await page.getByRole('listbox', { name: 'Minute' }).evaluate(el => { el.scrollTop = 44 * 9 + 10; el.dispatchEvent(new Event('scroll')); });
  await expect(page.locator('.pickedTime')).toContainText('6:45 PM');
  await page.getByRole('listbox', { name: 'Hour' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'e2e/shot-time-wheel.png' });
});

test('sign-up lobby → 10 blocked → start with 12 → host-only end, roster locked → stats', async ({ page, browser }) => {
  test.setTimeout(180000);
  const tag = Math.random().toString(36).slice(2, 6);
  await page.goto(BASE + '#/new'); await page.getByLabel('Event name').fill('Lobby ' + tag); await page.getByLabel('Place').fill('Stone Creek');
  await page.getByText('Next: Players').click(); await page.getByRole('button', { name: 'Next ›' }).click();
  await page.getByRole('radio', { name: '16' }).click(); // max players 16 (default is 8)
  await page.locator('.courtChip.on').last().click(); // 2 courts
  for (let i = 0; i < 6; i++) await page.locator('.stepper').first().getByText('−').click(); // 2 rounds
  await page.getByRole('button', { name: 'Create game' }).click();
  await expect(page.getByText('Signing up')).toBeVisible(); const code = page.url().split('/e/')[1].split('/')[0];
  // players sign up by name from the Join list
  const ctx = await browser.newContext({ ...devices['iPhone 13'] }); await markTest(ctx); const p2 = await ctx.newPage();
  await p2.goto(BASE + '#/join'); await expect(p2.getByText('Have a code or link?')).toHaveCount(0); await expect(p2.locator('#join-code')).toHaveCount(0); await p2.screenshot({ path: 'e2e/shot-join-nocode.png' }); await p2.goto(new URL('?g=' + code, BASE).toString());
  await expect(p2.getByText('Add yourself to this game')).toBeVisible();
  const names = Array.from({ length: 12 }, (_, i) => `${['Ann', 'Bob', 'Cat', 'Dan', 'Eve', 'Fay', 'Gus', 'Hal', 'Ivy', 'Jo', 'Kai', 'Lu'][i]}-${tag}`);
  const join = async (n: string, last: boolean) => { await p2.getByLabel('Player name').fill(n); await p2.getByRole('button', { name: 'Join', exact: true }).click(); await expect(p2.getByText("You're in as")).toBeVisible(); if (!last) { await p2.evaluate(c => localStorage.removeItem('pb:me:' + c), code); await p2.reload(); await expect(p2.getByText('Add yourself to this game')).toBeVisible(); } };
  for (const n of names.slice(0, 3)) await join(n, n === names[2]);
  // 3 players: Start is disabled with a clear message; the API refuses a start too
  await expect(p2.getByRole('button', { name: 'Start game', exact: true })).toBeDisabled(); await expect(p2.getByText('Need 4, 8, 12 or 16 players to start (have 3)')).toBeVisible();
  await p2.screenshot({ path: 'e2e/shot-start-blocked.png' });
  { const cur0 = (await (await p2.request.get(API + '/e/' + code)).json()).data; const r = await p2.request.put(API + '/e/' + code, { data: { data: { ...cur0, hidden: true, rounds: [{ n: 1, matches: [], byes: [] }] } } }); expect(r.status()).toBe(409); expect((await r.json()).error).toBe('need 4, 8, 12 or 16 players'); }
  await p2.evaluate(c => localStorage.removeItem('pb:me:' + c), code); await p2.reload(); await expect(p2.getByText('Add yourself to this game')).toBeVisible();
  for (const n of names.slice(3, 10)) await join(n, false);
  // 11 players: still blocked
  await join(names[10], true); await expect(p2.getByText('11 joined')).toBeVisible(); await expect(p2.getByRole('button', { name: 'Start game', exact: true })).toBeDisabled(); await expect(p2.getByText('Need 4, 8, 12 or 16 players to start (have 11)')).toBeVisible();
  await p2.screenshot({ path: 'e2e/shot-start-blocked-11.png' });
  await p2.evaluate(c => localStorage.removeItem('pb:me:' + c), code); await p2.reload(); await expect(p2.getByText('Add yourself to this game')).toBeVisible();
  await join(names[11], true);
  await expect(p2.getByText('12 joined')).toBeVisible();
  await p2.screenshot({ path: 'e2e/shot-lobby.png' });
  // a joined player (not the organizer) starts it, with a confirm step
  await p2.getByRole('button', { name: 'Start game', exact: true }).click();
  await expect(p2.getByRole('alertdialog')).toContainText('Start with 12 players?'); await p2.getByRole('alertdialog').getByRole('button', { name: 'Start game' }).click();
  await expect(p2.getByText('Hi, ' + names[11])).toBeVisible();
  await page.getByLabel('Refresh').click(); await expect(page.getByRole('heading', { name: 'Round 1 of 2' })).toBeVisible();
  await expect(page.locator('.match')).toHaveCount(2); await expect(page.locator('.byeNames')).toBeVisible();
  await page.screenshot({ path: 'e2e/shot-brand-round.png' });
  // Start is one-time: whoever tapped it is the host (organizer on their phone); no Start button anywhere after
  expect(await p2.evaluate(c => localStorage.getItem('pb:org:' + c), code)).toBe('1');
  await expect(page.getByRole('button', { name: 'Start game', exact: true })).toHaveCount(0); await expect(p2.getByRole('button', { name: 'Start game', exact: true })).toHaveCount(0);
  // after the start: game drops off the public Join list, the link shows "already started", and the API refuses new players
  const p3 = await ctx.newPage(); await p3.goto(BASE + '#/e/' + code + '/join'); await p3.evaluate(c => { localStorage.removeItem('pb:me:' + c); localStorage.removeItem('pb:org:' + c); }, code); await p3.reload();
  await expect(p3.getByText('This game already started')).toBeVisible(); await expect(p3.getByText('Add yourself to this game')).toHaveCount(0);
  await p3.screenshot({ path: 'e2e/shot-started.png' });
  const listed = await (await p3.request.get(API + '/events?test=1&from=2000-01-01T00:00')).json(); expect(listed.events.find((e: { code: string }) => e.code === code)?.rounds).toBeGreaterThan(0); // started games stay listed (opens the game)
  const cur = (await (await p3.request.get(API + '/e/' + code)).json()).data;
  const bad = await p3.request.put(API + '/e/' + code, { data: { data: { ...cur, players: [...cur.players, { id: 'x' + tag, name: 'Sneak-' + tag }], active: [...cur.active, 'x' + tag] } } }); expect(bad.status()).toBe(409);
  expect(cur.startedAt).toBeTruthy(); expect(cur.host).toBeTruthy();
  // API: a second start / re-draw is refused and returns the existing game; setup fields are locked after the start
  const again = await p3.request.put(API + '/e/' + code, { data: { data: { ...cur, startedAt: cur.startedAt + 1, rounds: [{ ...cur.rounds[0], matches: [] }] } } });
  expect(again.status()).toBe(409); expect((await again.json()).data.startedAt).toBe(cur.startedAt);
  for (const ch of [{ courts: cur.courts + 1 }, { date: '2030-01-01T09:00' }, { format: 'kotc' }]) { const r = await p3.request.put(API + '/e/' + code, { data: { data: { ...cur, ...ch } } }); expect(r.status()).toBe(409); expect((await r.json()).error).toBe('locked'); }
  const after = (await (await p3.request.get(API + '/e/' + code)).json()).data; expect(JSON.stringify(after.rounds[0])).toBe(JSON.stringify(cur.rounds[0])); expect(after.courts).toBe(cur.courts);
  // an existing player can still tap their name and get back in
  await p3.getByRole('button', { name: names[0], exact: true }).click(); await expect(p3.getByText('Hi, ' + names[0])).toBeVisible();
  // roster locked: API refuses dropping a player, even from the creator; only the host (who tapped Start) can end or change rounds
  const hostId = cur.startedBy; expect(hostId).toBe(cur.players.find((p: { name: string }) => p.name === names[11]).id);
  await p2.evaluate(([c, id]) => localStorage.setItem('pb:me:' + c, id), [code, hostId]); // p3 shares this phone's storage; p2 is the host again
  const drop = await p3.request.put(API + '/e/' + code + '?by=organizer', { data: { data: { ...cur, active: cur.active.slice(1) } } }); expect(drop.status()).toBe(409);
  const endNon = await p3.request.put(API + '/e/' + code + '?by=' + cur.players[0].id, { data: { data: { ...cur, finished: true } } }); expect(endNon.status()).toBe(409); expect((await endNon.json()).error).toBe('host only');
  const moreNon = await p3.request.put(API + '/e/' + code + '?by=organizer', { data: { data: { ...cur, totalRounds: cur.totalRounds + 1 } } }); expect(moreNon.status()).toBe(409);
  // creator's phone (not the host): settings + roster locked, no End / add rounds; host note instead
  await page.getByRole('button', { name: 'Manage', exact: true }).click();
  await expect(page.getByText('Locked: game started')).toBeVisible(); await expect(page.getByText('Roster locked')).toBeVisible(); await expect(page.getByRole('button', { name: /Re-draw/ })).toHaveCount(0); await expect(page.getByText('Balance by DUPR')).toHaveCount(0);
  await expect(page.getByText('Add late player')).toHaveCount(0); await expect(page.getByRole('button', { name: /Drop/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /End early/ })).toHaveCount(0); await expect(page.getByText('only ' + names[11] + ' (who started the game) can end it')).toBeVisible();
  await page.getByText('Locked: game started').scrollIntoViewIfNeeded(); await page.screenshot({ path: 'e2e/shot-locked-settings.png' }); await page.screenshot({ path: 'e2e/shot-nonhost-manage.png', fullPage: true });
  // host's phone: End early + total rounds available
  await p2.getByRole('button', { name: 'Manage', exact: true }).click(); await expect(p2.getByRole('button', { name: /End early/ })).toBeVisible(); await expect(p2.getByText('Roster locked')).toBeVisible();
  await p2.screenshot({ path: 'e2e/shot-host-manage.png', fullPage: true });
  await page.getByRole('button', { name: 'Courts', exact: true }).click();
  // score round 1, advance, score round 2 → last-round options
  await page.getByLabel('Refresh').click();
  const scoreAll = async () => { const n = await page.locator('.match').count(); for (let c = 0; c < n; c++) { const card = page.locator('.match').nth(c); await card.getByLabel('Team A score').fill('11'); await card.getByLabel('Team B score').fill(String(4 + c)); await card.getByText('Save score').click(); await expect(card.locator('.final')).toBeVisible(); } };
  await scoreAll(); await page.getByRole('button', { name: 'Next: Round 2 →' }).click(); await expect(page.getByRole('heading', { name: 'Round 2 of 2' })).toBeVisible();
  await scoreAll(); await expect(page.getByText("That's the last round.")).toBeVisible();
  // non-host: no End now / +rounds
  await expect(page.getByRole('button', { name: 'End now' })).toHaveCount(0); await expect(page.getByRole('button', { name: '+1 round' })).toHaveCount(0);
  await expect(page.getByText('Only ' + names[11] + ' (who started the game) can end it or add rounds.')).toBeVisible();
  await page.screenshot({ path: 'e2e/shot-nonhost-last-round.png' });
  // host: End now / +1 round
  await page.waitForTimeout(1000); await p2.getByRole('button', { name: 'Courts', exact: true }).click(); await p2.getByLabel('Refresh').click();
  await expect(p2.getByRole('button', { name: 'End now' })).toBeVisible(); await p2.screenshot({ path: 'e2e/shot-host-last-round.png' }); await p2.screenshot({ path: 'e2e/shot-last-round.png' });
  await p2.getByRole('button', { name: '+1 round' }).click(); await expect(p2.getByRole('button', { name: 'Next: Round 3 →' })).toBeVisible();
  await page.waitForTimeout(1000); await page.getByLabel('Refresh').click(); await expect(page.getByRole('button', { name: 'Next: Round 3 →' })).toBeVisible();
  // edit a score (stats must update, not duplicate)
  const c0 = page.locator('.match').first(); const winner = (await c0.locator('.side').first().locator('.names > div').first().textContent())!.trim();
  await c0.getByText('Edit score').click(); await c0.getByLabel('Team A score').fill('11'); await c0.getByLabel('Team B score').fill('9'); await c0.getByText('Save score').click(); await expect(c0.locator('.final')).toBeVisible();
  // host ends early from Manage
  await page.waitForTimeout(1000); await p2.getByRole('button', { name: 'Manage', exact: true }).click(); p2.once('dialog', d => d.accept()); await p2.getByRole('button', { name: 'End early' }).click();
  await page.waitForTimeout(1500); await page.getByLabel('Refresh').click(); await expect(page.getByText('Event finished')).toBeVisible();
  await page.getByRole('button', { name: 'Standings', exact: true }).click(); const gp = (await page.locator('tr', { hasText: winner }).first().locator('td').nth(4).textContent())!.trim();
  // all-time stats
  await page.goto(BASE + '#/stats'); const row = page.locator('tr', { hasText: winner });
  await expect(row).toBeVisible(); await expect(row.locator('td').nth(4)).toHaveText(gp); // same games as the event: edit updated, not duplicated
  await page.screenshot({ path: 'e2e/shot-stats.png' });
  await row.click(); await expect(page.locator('.hist')).toHaveCount(Number(gp)); await expect(page.locator('.hist').first()).toContainText('11–9');
  // case-insensitive lookup
  await page.goto(BASE + '#/stats/' + encodeURIComponent(winner.toUpperCase())); await expect(page.locator('.hist')).toHaveCount(Number(gp));
  await page.screenshot({ path: 'e2e/shot-player-history.png' });
});

test('long names show fully; no M/F anywhere; DUPR optional', async ({ page }) => {
  const long = 'Alexandria Montgomery-Smith'; // 27 chars
  await page.goto(BASE + '#/new');
  await expect(page.getByRole('radio', { name: /Mixed Doubles/ })).toBeVisible(); await expect(page.getByText(/\b(wo)?man\b/i)).toHaveCount(0);
  await page.getByLabel('Place').fill('Stone Creek'); await page.getByText('Next: Players').click();
  await expect(page.locator('select')).toHaveCount(0); await expect(page.getByText('M/F')).toHaveCount(0);
  await expect(page.getByText('DUPR (optional)')).toBeVisible();
  const input = page.getByLabel('Player name'); await input.fill(long);
  const [iw, cw] = await input.evaluate(el => [el.getBoundingClientRect().width, el.closest('.card')!.clientWidth]); expect(iw).toBeGreaterThan(cw * 0.85);
  expect(await input.evaluate(el => (el as HTMLInputElement).scrollWidth <= (el as HTMLInputElement).clientWidth + 1)).toBe(true);
  await page.screenshot({ path: 'e2e/shot-create-players.png' });
  await page.getByText('Add new player').click(); // no DUPR → still added
  for (const n of ['Bo', 'Cy', 'Di', 'Ed', 'Fy', 'Gi', 'Hu']) { await page.getByLabel('Player name').fill(n); await page.getByLabel('DUPR (optional)').fill('3.5'); await page.getByText('Add new player').click(); }
  await expect(page.getByRole('button', { name: long })).toBeVisible();
  await page.getByRole('button', { name: 'Next ›' }).click(); await page.getByRole('radio', { name: '12' }).click(); await page.getByLabel('Balance matchups by DUPR').check();
  await page.getByRole('button', { name: 'Create game' }).click();
  await expect(page.getByText('8 joined')).toBeVisible();
  const chip = page.locator('.lobbyRow .grow', { hasText: long }); await expect(chip).toHaveText(long);
  expect(await chip.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await expect(page.getByLabel('Player name')).toBeVisible();
  await page.screenshot({ path: 'e2e/shot-lobby-names.png', fullPage: true });
  await page.getByRole('button', { name: 'Start game', exact: true }).click(); await page.getByRole('alertdialog').getByRole('button', { name: 'Start game' }).click();
  await expect(page.locator('.match')).toHaveCount(2);
  const all = page.locator('.match .names div, .byeNames'); await expect(page.locator('.match, .card.bye').filter({ hasText: long })).toHaveCount(1);
  for (const el of await all.all()) expect(await el.evaluate(e => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: 'e2e/shot-longname-card.png' });
});

test('Mixed Doubles: organizer sets pairs in the lobby, pairs stay together', async ({ page }) => {
  await page.goto(BASE + '#/new'); await page.getByRole('radio', { name: /Mixed Doubles/ }).click(); await page.getByLabel('Place').fill('Gym');
  await page.getByText('Next: Players').click();
  for (const n of ['Ann', 'Bob', 'Cat', 'Dan']) { await page.getByLabel('Player name').fill(n); await page.getByText('Add new player').click(); }
  await expect(page.locator('select')).toHaveCount(0);
  await page.getByRole('button', { name: 'Next ›' }).click(); await page.getByRole('button', { name: 'Create game' }).click();
  const pb = page.locator('.pairs'); await pb.getByRole('button', { name: 'Ann', exact: true }).click(); await pb.getByRole('button', { name: 'Dan', exact: true }).click();
  await expect(pb.locator('.pairRow')).toHaveText(/Ann & Dan/);
  await page.screenshot({ path: 'e2e/shot-mixed-pairs.png' });
  await page.getByRole('button', { name: 'Start game', exact: true }).click(); await page.getByRole('alertdialog').getByRole('button', { name: 'Start game' }).click();
  const together = () => page.locator('.match .side .names').allTextContents().then(a => a.some(t => t.includes('Ann') && t.includes('Dan')));
  await expect(page.locator('.match')).toHaveCount(1); await expect.poll(together).toBe(true);
  await page.getByLabel('Next round').click(); await expect(page.getByRole('heading', { name: /Round 2/ })).toBeVisible(); await expect.poll(together).toBe(true);
});

test('icons: manifest, favicon and apple-touch-icon load', async ({ page, request }) => {
  await page.goto(BASE);
  const href = (sel: string) => page.locator(sel).getAttribute('href');
  for (const h of [await href('link[rel="apple-touch-icon"]'), await href('link[rel="icon"][sizes="32x32"]'), 'icon-maskable-512.png', 'badge.webp', 'logo.webp', await href('link[rel="manifest"]'), 'icon-192.png', 'icon-512.png']) {
    const r = await request.get(new URL(h!, page.url()).toString()); expect(r.ok()).toBe(true);
  }
  const m = await (await request.get(new URL('manifest.webmanifest', page.url()).toString())).json(); expect(m.icons.map((i: { src: string }) => i.src)).toContain('icon-512.png');
  await page.goto(new URL('icon-512.png', page.url()).toString()); await page.screenshot({ path: 'e2e/shot-icon-new.png' });
  expect(m.theme_color).toBe('#141929'); expect(m.icons.some((i: { purpose?: string }) => i.purpose === 'maskable')).toBe(true);
});
test('Share game: short ?g=CODE link, native share, copy-link fallback, deep link → Add yourself', async ({ page, browser }) => {
  await page.addInitScript(() => { (window as unknown as { __shared: unknown[] }).__shared = []; Object.defineProperty(navigator, 'share', { configurable: true, value: async (d: unknown) => { (window as unknown as { __shared: unknown[] }).__shared.push(d); } }); });
  await page.goto(BASE + '#/new'); await page.getByLabel('Event name').fill('Share test'); await page.getByLabel('Place').fill('Stone Creek');
  await page.getByText('Next: Players').click(); await page.getByRole('button', { name: 'Next ›' }).click(); await page.getByRole('button', { name: 'Create game' }).click();
  await expect(page.getByText('Signing up')).toBeVisible(); const code = page.url().split('/e/')[1].split('/')[0];
  const expected = new URL('?g=' + code, BASE).toString();
  // lobby: native share sheet gets the short link
  await page.locator('.shareBig').click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __shared: { url: string }[] }).__shared.map(s => s.url))).toEqual([expected]);
  expect(await page.evaluate(() => document.querySelector('.qr, [aria-label*="QR"]'))).toBeNull();
  await expect(page.getByRole('button', { name: /QR/ })).toHaveCount(0);
  // fallback (native share fails) → simple Copy link
  await page.evaluate(() => Object.defineProperty(navigator, 'share', { configurable: true, value: async () => { throw new Error('nope'); } }));
  await page.locator('.shareBig').click();
  const sheet = page.getByRole('dialog', { name: 'Share game' }); await expect(sheet.getByTestId('share-link')).toHaveText(expected);
  await sheet.getByRole('button', { name: 'Copy link' }).click(); await expect(sheet.getByText('Link copied')).toBeVisible();
  await page.screenshot({ path: 'e2e/shot-share.png' });
  await sheet.getByRole('button', { name: 'Done' }).click();
  // no native share → header button falls back to the sheet
  const ctx = await browser.newContext({ ...devices['Pixel 7'] }); await markTest(ctx); await ctx.addInitScript(() => { Object.defineProperty(navigator, 'share', { configurable: true, value: undefined }); });
  const p2 = await ctx.newPage();
  // deep link opens straight to "Add yourself to this game" (no picker first)
  await p2.goto(expected);
  await expect(p2).toHaveURL(new RegExp('#/e/' + code + '/join$')); await expect(p2.getByText('Add yourself to this game')).toBeVisible();
  await expect(p2.getByText('Who are you?')).toHaveCount(0); await expect(p2.getByLabel('Player name')).toBeFocused(); await expect(p2.getByLabel('DUPR (optional)')).toBeVisible();
  await p2.screenshot({ path: 'e2e/shot-join-link.png' });
  await p2.keyboard.type('Sharer'); await p2.getByRole('button', { name: 'Join', exact: true }).click(); await expect(p2.getByText("You're in as")).toBeVisible();
  // already-joined names are tappable below the form
  const p3 = await ctx.newPage(); await p3.goto(expected); await expect(p3.getByText("You're in as")).toBeVisible();
  await p3.evaluate(c => { localStorage.removeItem('pb:me:' + c); localStorage.removeItem('pb:org:' + c); }, code); await p3.reload();
  await expect(p3.getByText('Already joined? Tap your name')).toBeVisible(); await p3.getByRole('button', { name: 'Sharer', exact: true }).click(); await expect(p3.getByText("You're in as")).toBeVisible();
  await p3.close();
  // 1 player: Start is disabled (needs 4, 8, 12 or 16)
  await expect(p2.getByRole('button', { name: 'Start game', exact: true })).toBeDisabled(); await expect(p2.getByText('Need 4, 8, 12 or 16 players to start (have 1)')).toBeVisible();
  await p2.locator('.shareBig').click();
  await expect(p2.getByRole('dialog', { name: 'Share game' }).getByTestId('share-link')).toHaveText(expected);
});
test('typed-only scores: empty "–", number pad, auto-advance, any score (15–13, 12–10), ties blocked, stats exact', async ({ page }) => {
  const tag = Math.random().toString(36).slice(2, 6);
  await setup(page, ['Ann', 'Bob', 'Cat', 'Dan', 'Eve', 'Fay', 'Gus', 'Hal'].map(n => n + tag), 1, 2);
  const c1 = page.locator('.match').first(), c2 = page.locator('.match').nth(1);
  await expect(page.locator('.scorebox button')).toHaveCount(0); // no +/− steppers
  const a1 = c1.getByLabel('Team A score'), b1 = c1.getByLabel('Team B score');
  await expect(a1).toHaveValue(''); await expect(a1).toHaveAttribute('placeholder', '–'); await expect(a1).toHaveAttribute('inputmode', 'numeric');
  await a1.click(); await page.keyboard.type('15'); await expect(b1).toBeFocused(); // auto-advance after 2 digits
  await page.screenshot({ path: 'e2e/shot-score-entry.png' });
  await page.keyboard.type('13'); await c1.getByText('Save score').click();
  await expect(c1.locator('.pts').first()).toHaveText('15'); await expect(c1.locator('.pts').nth(1)).toHaveText('13');
  // tie can't be saved; single digits + Next/Enter advance
  const a2 = c2.getByLabel('Team A score'), b2 = c2.getByLabel('Team B score');
  await a2.click(); await page.keyboard.type('9'); await page.keyboard.press('Enter'); await expect(b2).toBeFocused(); await page.keyboard.type('9');
  await expect(c2.getByText('Save score')).toBeDisabled();
  await b2.fill('12'); await a2.fill('10'); await c2.getByText('Save score').click();
  await expect(c2.locator('.pts').first()).toHaveText('10'); await expect(c2.locator('.pts').nth(1)).toHaveText('12');
  await expect(c2.locator('.side').nth(1)).toHaveClass(/win/);
  // standings: point differential exactly as typed
  const winA = (await c1.locator('.side').first().locator('.names > div').first().textContent())!.trim();
  await page.getByRole('button', { name: 'Standings', exact: true }).click();
  const row = page.locator('tbody tr', { hasText: winA }); await expect(row.locator('td').nth(5)).toHaveText('15'); await expect(row.locator('td').nth(6)).toHaveText('13'); await expect(row.locator('td').nth(7)).toHaveText('+2');
  await expect(page.getByText('Live · updates as scores are entered')).toBeVisible(); await page.screenshot({ path: 'e2e/shot-match-standings.png' });
  // in progress: not in Overall stats yet
  await page.waitForTimeout(1500); const code = page.url().split('/e/')[1];
  const pre = await (await page.request.get(API + '/stats/player?test=1&name=' + encodeURIComponent(winA.toLowerCase()))).json(); expect(pre.matches.filter((m: { code: string }) => m.code === code)).toEqual([]);
  // host ends it → read-only, listed in Past matches, counted in Overall stats
  await page.getByRole('button', { name: 'Manage', exact: true }).click(); page.once('dialog', d => d.accept()); await page.getByRole('button', { name: 'End early' }).click();
  await page.locator('.tabs button').first().click(); await expect(page.getByText('Match complete · scores are final (read-only)')).toBeVisible();
  await expect(page.getByText('Edit score')).toHaveCount(0); await expect(page.locator('.scorebox')).toHaveCount(0);
  await page.screenshot({ path: 'e2e/shot-completed-readonly.png' });
  await expect.poll(async () => (await (await page.request.get(API + '/e/' + code)).json()).data.finished).toBe(true);
  const cur = (await (await page.request.get(API + '/e/' + code)).json()).data;
  const edit = await page.request.put(API + '/e/' + code + '?by=organizer', { data: { data: { ...cur, finished: true, rounds: cur.rounds.map((r: { matches: { sa?: number }[] }) => ({ ...r, matches: r.matches.map(m => ({ ...m, sa: 99 })) })) } } }); expect(edit.status()).toBe(409); expect((await edit.json()).error).toBe('finished');
  await page.goto(BASE); await page.getByRole('button', { name: /Past matches/ }).click(); await expect(page.getByRole('heading', { name: 'Past matches' })).toBeVisible();
  await page.locator('.game').first().waitFor(); await page.screenshot({ path: 'e2e/shot-past-matches.png' });
  await page.goto(BASE + '#/e/' + code); await page.getByRole('button', { name: 'Standings', exact: true }).click(); await expect(page.getByText('Final standings · match complete')).toBeVisible();
  await page.goto(BASE); await page.getByRole('button', { name: /Overall stats/ }).click(); await expect(page.getByRole('heading', { name: 'Overall stats' })).toBeVisible(); await expect(page.locator('th', { hasText: 'Win%' })).toBeVisible();
  await page.locator('tr', { hasText: winA }).first().waitFor(); await page.screenshot({ path: 'e2e/shot-overall-stats.png' });
  await page.goto(BASE + '#/stats/' + encodeURIComponent(winA.toLowerCase()));
  await expect(page.locator('.hist').first()).toContainText('15–13');
});
test('auto-cleanup: past never-started games leave Join at once and are deleted the next day', async ({ request }) => {
  const ct = (ms: number) => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms)).map(x => [x.type, x.value])); return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`; };
  const tag = Math.random().toString(36).slice(2, 6).toUpperCase(); const old = 'ZO' + tag, late = 'ZL' + tag, soon = 'ZS' + tag;
  const mk = (code: string, date: string) => request.put(API + '/e/' + code, { data: { data: { id: code, name: 'e2e cleanup ' + code, date, place: 'x', format: 'rotating', courts: 1, totalRounds: 1, balanceDupr: false, seeding: 'random', players: [], active: [], teams: [], rounds: [], createdAt: Date.now(), hidden: true } } });
  expect((await mk(old, ct(Date.now() - 30 * 3600e3))).ok()).toBe(true); // yesterday (or earlier), never started
  expect((await mk(soon, ct(Date.now() + 2 * 3600e3))).ok()).toBe(true); // upcoming
  const lateDate = ct(Date.now() - 5 * 3600e3); const sameDay = lateDate.slice(0, 10) === ct(Date.now()).slice(0, 10);
  if (sameDay) expect((await mk(late, lateDate)).ok()).toBe(true); // earlier today, start time long past
  const codes = (await (await request.get(API + '/events?test=1&from=2000-01-01T00:00')).json()).events.map((e: { code: string }) => e.code);
  expect(codes).not.toContain(old); expect(codes).toContain(soon); if (sameDay) expect(codes).not.toContain(late);
  expect((await request.get(API + '/e/' + old)).status()).toBe(404); // purged
  if (sameDay) expect((await request.get(API + '/e/' + late)).status()).toBe(200); // kept until tomorrow
});
test('Join flow: only Create + game list; pick a game → Join → enter name', async ({ page, browser }) => {
  const tag = Math.random().toString(36).slice(2, 6);
  const t = new Date(Date.now() + 26 * 3600e3); const d = new Date(t.getTime() - t.getTimezoneOffset() * 6e4).toISOString().slice(0, 11) + '09:00';
  const code = 'JF' + tag.toUpperCase();
  await page.request.put(API + '/e/' + code, { data: { data: { id: code, name: 'Flow test ' + tag, date: d, place: 'Stone Creek', format: 'rotating', courts: 2, totalRounds: 4, balanceDupr: false, seeding: 'random', players: [], active: [], teams: [], rounds: [], createdAt: Date.now(), hidden: true } } });
  const ctx = await browser.newContext({ ...devices['iPhone 13'] }); await markTest(ctx); const p = await ctx.newPage();
  await p.goto(BASE + '#/join');
  await expect(p.getByRole('button', { name: 'Create a game' })).toBeVisible();
  await expect(p.getByText(/code or link|enter code/i)).toHaveCount(0); await expect(p.locator('input')).toHaveCount(0); await expect(p.getByText(/QR/)).toHaveCount(0);
  const card = p.locator('.game', { hasText: 'Flow test ' + tag }); await expect(card).toBeVisible(); await expect(card.locator('.joinPill')).toHaveText('Join');
  await card.scrollIntoViewIfNeeded(); await p.screenshot({ path: 'e2e/shot-flow-1-join-list.png' });
  await card.click();
  await expect(p.getByText('Add yourself to this game')).toBeVisible(); await expect(p.getByLabel('Player name')).toBeFocused();
  await p.screenshot({ path: 'e2e/shot-flow-2-enter-name.png' });
  await p.keyboard.type('Flow-' + tag); await p.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(p.getByText("You're in as")).toBeVisible(); await expect(p.locator('.lobbyRow', { hasText: 'Flow-' + tag })).toBeVisible();
  await p.screenshot({ path: 'e2e/shot-flow-3-joined.png' });
});

test('lobby: drop out, creator removes / cancels, duplicate names blocked, roster locked after start', async ({ page, browser }) => {
  const tag = Math.random().toString(36).slice(2, 6).toUpperCase(); const code = 'DO' + tag;
  const t = new Date(Date.now() + 26 * 3600e3); const d = new Date(t.getTime() - t.getTimezoneOffset() * 6e4).toISOString().slice(0, 11) + '09:00';
  const players = ['Ann', 'Bob', 'Cat'].map((n, i) => ({ id: 'p' + i, name: n }));
  const r0 = await page.request.put(API + '/e/' + code, { data: { data: { id: code, name: 'Dropout test ' + tag, date: d, place: 'Stone Creek', format: 'rotating', courts: 1, totalRounds: 3, balanceDupr: false, seeding: 'random', players, active: players.map(p => p.id), teams: [], rounds: [], createdAt: Date.now(), hidden: true } } });
  expect(r0.ok()).toBe(true);
  // API refuses a second "ann" (trimmed, any case) before the start
  const dup = await page.request.put(API + '/e/' + code, { data: { data: { id: code, name: 'Dropout test ' + tag, date: d, place: 'Stone Creek', format: 'rotating', courts: 1, totalRounds: 3, balanceDupr: false, seeding: 'random', players: [...players, { id: 'x', name: ' ANN ' }], active: [...players.map(p => p.id), 'x'], teams: [], rounds: [], hidden: true } } });
  expect(dup.status()).toBe(409);
  // Player device: join form blocks a duplicate name with a friendly message
  const ctx = await browser.newContext({ ...devices['iPhone 13'] }); await markTest(ctx); const p = await ctx.newPage();
  const msgs: string[] = []; p.on('dialog', dl => { msgs.push(dl.message()); dl.accept(); });
  await p.goto(BASE + '#/e/' + code + '/join');
  await p.getByLabel('Player name').fill('  bob '); await p.getByRole('button', { name: 'Join', exact: true }).click();
  await expect.poll(() => msgs.join()).toContain('already in this game');
  await expect(p.locator('.lobbyRow')).toHaveCount(3);
  // Join as Dee, then drop out (only own row has Drop out; non-creator sees no ✕)
  await p.getByLabel('Player name').fill('Dee'); await p.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(p.locator('.lobbyRow')).toHaveCount(4); await expect(p.locator('.lobbyRow', { hasText: 'Dee' }).getByRole('button', { name: 'Drop out' })).toBeVisible();
  await expect(p.getByRole('button', { name: /^Remove / })).toHaveCount(0); await expect(p.getByRole('button', { name: 'Cancel game' })).toHaveCount(0);
  await p.getByRole('button', { name: 'Drop out' }).click();
  await expect(p.locator('.lobbyRow')).toHaveCount(3); await expect(p.getByText('Add yourself to this game')).toBeVisible();
  // Creator device: ✕ next to others, remove Cat, screenshot, then cancel the whole game
  page.on('dialog', dl => dl.accept());
  await page.addInitScript(c => localStorage.setItem('pb:org:' + c, '1'), code);
  await page.goto(BASE + '#/e/' + code);
  await expect(page.getByRole('button', { name: 'Remove Cat' })).toBeVisible(); await expect(page.getByRole('button', { name: 'Cancel game' })).toBeVisible();
  await page.screenshot({ path: 'e2e/shot-lobby-dropout-remove.png', fullPage: true });
  await page.getByRole('button', { name: 'Remove Cat' }).click();
  await expect(page.locator('.lobbyRow')).toHaveCount(2);
  expect(((await (await page.request.get(API + '/e/' + code)).json()).data.players as { name: string }[]).map(x => x.name)).toEqual(['Ann', 'Bob']);
  await page.getByRole('button', { name: 'Cancel game' }).click();
  await expect(page.getByText('Create a game')).toBeVisible();
  expect((await page.request.get(API + '/e/' + code)).status()).toBe(404);
  await ctx.close();
});

test('API: started games cannot be deleted or have players removed', async ({ request }) => {
  const code = 'DS' + Math.random().toString(36).slice(2, 6).toUpperCase();
  const players = ['A', 'B', 'C', 'D'].map((n, i) => ({ id: 'q' + i, name: n })); const base = { id: code, name: 'Delstart test', date: '2026-10-17T09:00', place: 'x', format: 'rotating', courts: 1, totalRounds: 1, balanceDupr: false, seeding: 'random', teams: [], hidden: true };
  const rounds = [{ n: 1, matches: [{ court: 1, a: ['q0', 'q1'], b: ['q2', 'q3'] }], byes: [] }];
  expect((await request.put(API + '/e/' + code, { data: { data: { ...base, players, active: players.map(p => p.id), rounds, startedAt: 1, startedBy: 'q0' } } })).ok()).toBe(true);
  expect((await request.delete(API + '/e/' + code)).status()).toBe(409);
  expect((await request.put(API + '/e/' + code, { data: { data: { ...base, players: players.slice(0, 3), active: ['q0', 'q1', 'q2'], rounds, startedAt: 1, startedBy: 'q0' } } })).status()).toBe(409);
  // cleanup: finish it so it never shows in Join (hidden anyway)
  await request.put(API + '/e/' + code + '?by=q0', { data: { data: { ...base, players, active: players.map(p => p.id), rounds, startedAt: 1, startedBy: 'q0', finished: true } } });
});

test('courts display as letters (A, B, C); stored court numbers unchanged', async ({ page }) => {
  page.on('dialog', d => d.accept());
  await page.goto(BASE); await page.getByText('Create a game').click(); await page.getByPlaceholder('e.g. the gym').fill('Letters test');
  await page.getByText('Next: Players').click();
  for (let i = 1; i <= 12; i++) { await page.getByPlaceholder('Name').fill('L' + i); await page.getByText('Add new player').click(); }
  await page.getByRole('button', { name: 'Next ›' }).click();
  await startGame(page);
  await expect(page.locator('.courtHead .court')).toHaveText(['Court A', 'Court B', 'Court C']);
  await page.screenshot({ path: '/workspace/shot-court-letters-local.png' });
  const code = (await page.locator('header .small b').first().textContent())!.trim();
  const ev = (await (await page.request.get(API + '/e/' + code)).json()).data;
  expect(ev.rounds[0].matches.map((m: { court: number }) => m.court)).toEqual([1, 2, 3]);
});

test('API: creator phone that also joined as a player can End a game started as organizer', async ({ request }) => {
  const code = 'EN' + Math.random().toString(36).slice(2, 6).toUpperCase();
  const players = ['A', 'B', 'C', 'D'].map((n, i) => ({ id: 'e' + i, name: n }));
  const base = { id: code, name: 'End test', date: '2026-10-17T09:00', place: 'x', format: 'rotating', courts: 1, totalRounds: 3, balanceDupr: false, seeding: 'random', teams: [], hidden: true, players, active: players.map(p => p.id) };
  const rounds = [{ n: 1, matches: [{ court: 1, a: ['e0', 'e1'], b: ['e2', 'e3'], sa: 11, sb: 5 }], byes: [] }];
  expect((await request.put(API + '/e/' + code, { data: { data: { ...base, rounds, startedAt: 1, startedBy: 'organizer', host: 'organizer' } } })).ok()).toBe(true);
  expect((await request.put(API + '/e/' + code + '?by=e1', { data: { data: { ...base, rounds, startedAt: 1, startedBy: 'organizer', finished: true } } })).status()).toBe(409); // a player phone can't end it
  expect((await request.put(API + '/e/' + code + '?by=e0&org=1', { data: { data: { ...base, rounds, startedAt: 1, startedBy: 'organizer', finished: true } } })).ok()).toBe(true);
  expect((await (await request.get(API + '/e/' + code)).json()).data.finished).toBe(true);
});

test('API: started-but-not-ended games auto-close the day after their date (like End early); completed and current games untouched', async ({ request }) => {
  const tag = Math.random().toString(36).slice(2, 6).toUpperCase(); const old = 'AC' + tag, cur = 'AD' + tag;
  const players = ['A', 'B', 'C', 'D'].map((n, i) => ({ id: 'c' + i, name: n + tag }));
  const m = (sa?: number, sb?: number) => ({ court: 1, a: ['c0', 'c1'], b: ['c2', 'c3'], sa, sb });
  const base = { name: 'Autoclose test', place: 'x', format: 'rotating', courts: 1, totalRounds: 4, balanceDupr: false, seeding: 'random', teams: [], hidden: true, players, active: players.map(p => p.id), startedAt: 1, startedBy: 'organizer' };
  const t = new Date(Date.now() + 2 * 3600e3); const today = new Date(t.getTime() - t.getTimezoneOffset() * 6e4).toISOString().slice(0, 16);
  expect((await request.put(API + '/e/' + old, { data: { data: { ...base, id: old, date: new Date(Date.now() - 30 * 3600e3).toISOString().slice(0, 10) + 'T09:00', rounds: [{ n: 1, matches: [m(11, 2)], byes: [] }], plan: [{ n: 2, matches: [m(11, 9)], byes: [] }, { n: 3, matches: [m()], byes: [] }] } } })).ok()).toBe(true);
  expect((await request.put(API + '/e/' + cur, { data: { data: { ...base, id: cur, date: today, rounds: [{ n: 1, matches: [m()], byes: [] }] } } })).ok()).toBe(true);
  let d: { finished?: boolean; rounds: { n: number }[]; plan?: unknown } = { rounds: [] };
  await expect.poll(async () => { d = (await (await request.get(API + '/e/' + old)).json()).data; return !!d.finished; }, { timeout: 120000 }).toBe(true);
  expect(d.rounds.map(r => r.n)).toEqual([1, 2]); expect(d.plan).toBeUndefined();
  expect((await (await request.get(API + '/past?test=1')).json()).events.some((e: { code: string }) => e.code === old)).toBe(true);
  expect(((await (await request.get(API + '/stats/player?test=1&name=' + encodeURIComponent('A' + tag))).json()).matches)).toHaveLength(2);
  const c = (await (await request.get(API + '/e/' + cur)).json()).data; expect(c.finished).toBeFalsy(); expect(c.rounds).toHaveLength(1);
  await request.put(API + '/e/' + cur + '?by=organizer', { data: { data: { ...c, finished: true } } });
});

test('player cap: creator picks max players; Join list shows Full; full game refuses joins; drop out reopens; removed phone forgets its name; started shows Open', async ({ page, browser }) => {
  test.setTimeout(180000);
  const tag = Math.random().toString(36).slice(2, 6);
  page.on('dialog', d => d.accept());
  await page.goto(BASE + '#/new'); await page.getByLabel('Event name').fill('Cap test ' + tag); await page.getByLabel('Place').fill('Stone Creek');
  await page.getByText('Next: Players').click(); await page.getByRole('button', { name: 'Next ›' }).click();
  // selector: 4 / 8 / 12 / 16, default 8
  const radios = page.getByRole('radiogroup', { name: 'Max players' }).getByRole('radio');
  await expect(radios).toHaveText(['4', '8', '12', '16']); await expect(page.getByRole('radio', { name: '8' })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('radio', { name: '4' }).click(); await expect(page.getByRole('radio', { name: '4' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByText('Join closes once 4 players have signed up')).toBeVisible();
  await page.screenshot({ path: 'e2e/shot-create-max-players.png' });
  await page.getByRole('button', { name: 'Create game' }).click();
  await expect(page.getByText('Signing up')).toBeVisible(); const code = page.url().split('/e/')[1].split('/')[0];
  await expect(page.getByText('4 max')).toBeVisible();
  expect((await (await page.request.get(API + '/e/' + code)).json()).data.maxPlayers).toBe(4);
  // 4 players join from one phone (clearing its name between joins)
  const ctx = await browser.newContext({ ...devices['iPhone 13'] }); await markTest(ctx); const p = await ctx.newPage();
  const msgs: string[] = []; p.on('dialog', dl => { msgs.push(dl.message()); dl.accept(); });
  await p.goto(BASE + '#/e/' + code + '/join');
  const names = ['Ann', 'Bob', 'Cat', 'Dan'].map(n => n + '-' + tag);
  for (const n of names) { await p.getByLabel('Player name').fill(n); await p.getByRole('button', { name: 'Join', exact: true }).click(); await expect(p.getByText("You're in as")).toBeVisible();
    if (n !== names[3]) { await p.evaluate(c => localStorage.removeItem('pb:me:' + c), code); await p.reload(); await expect(p.getByText('Add yourself to this game')).toBeVisible(); } }
  // API refuses a 5th
  const cur = (await (await p.request.get(API + '/e/' + code)).json()).data;
  const fifth = await p.request.put(API + '/e/' + code, { data: { data: { ...cur, players: [...cur.players, { id: 'x' + tag, name: 'Eve' }], active: [...cur.active, 'x' + tag] } } });
  expect(fifth.status()).toBe(409); expect((await fifth.json()).error).toBe('full');
  // cap can't be raised/removed later
  await p.request.put(API + '/e/' + code, { data: { data: { ...cur, maxPlayers: 16 } } }); expect((await (await p.request.get(API + '/e/' + code)).json()).data.maxPlayers).toBe(4);
  // Join list: Full pill, 4/4 players; tapping opens "Game is full" with tap-your-name
  const q = await browser.newContext({ ...devices['iPhone 13'] }); await markTest(q); const f = await q.newPage();
  await f.goto(BASE + '#/join'); const card = f.locator('.game', { hasText: 'Cap test ' + tag });
  await expect(card.locator('.joinPill')).toHaveText('Full'); await expect(card).toContainText('4/4 players');
  await card.scrollIntoViewIfNeeded(); await f.screenshot({ path: 'e2e/shot-join-list-full.png' });
  await card.click();
  await expect(f.getByRole('heading', { name: 'Game is full' })).toBeVisible(); await expect(f.getByLabel('Player name')).toHaveCount(0);
  await expect(f.getByText('Already playing? Tap your name')).toBeVisible();
  await f.screenshot({ path: 'e2e/shot-game-full.png', fullPage: true });
  await f.getByRole('button', { name: names[1] }).click(); await expect(f.getByText("You're in as")).toContainText(names[1]);
  // a phone whose join lost the race gets the friendly message
  const r = await browser.newContext({ ...devices['iPhone 13'] }); await markTest(r); const g = await r.newPage(); const gm: string[] = []; g.on('dialog', dl => { gm.push(dl.message()); dl.accept(); });
  // creator removes Dan (whose phone is p) → spot reopens; Dan's phone forgets the name and can join again
  await page.reload(); await page.getByRole('button', { name: 'Remove ' + names[3] }).click(); await expect(page.locator('.lobbyRow')).toHaveCount(3);
  await f.goto(BASE + '#/join'); await expect(f.locator('.game', { hasText: 'Cap test ' + tag }).locator('.joinPill')).toHaveText('Join');
  await g.goto(BASE + '#/e/' + code + '/join'); await expect(g.getByText('Add yourself to this game')).toBeVisible();
  await p.reload(); await expect(p.getByText('Add yourself to this game')).toBeVisible(); expect(await p.evaluate(c => localStorage.getItem('pb:me:' + c), code)).toBeFalsy();
  await p.getByLabel('Player name').fill(names[3]); await p.getByRole('button', { name: 'Join', exact: true }).click(); await expect(p.getByText("You're in as")).toBeVisible();
  // g still shows the form from before; its join is refused with "Game is full"
  await g.getByLabel('Player name').fill('Late-' + tag); await g.getByRole('button', { name: 'Join', exact: true }).click();
  await expect.poll(() => gm.join()).toContain('Game is full'); await expect(g.getByRole('heading', { name: 'Game is full' })).toBeVisible();
  // start (exactly 4) → Join list shows Open, not Join/Full
  await page.reload(); await page.getByRole('button', { name: 'Start game', exact: true }).click(); await page.getByRole('alertdialog').getByRole('button', { name: 'Start game' }).click();
  await expect(page.getByRole('heading', { name: /Round 1/ })).toBeVisible();
  await f.reload(); await expect(f.locator('.game', { hasText: 'Cap test ' + tag }).locator('.joinPill')).toHaveText('Open');
  await f.locator('.game', { hasText: 'Cap test ' + tag }).scrollIntoViewIfNeeded(); await f.screenshot({ path: 'e2e/shot-join-list-open.png' });
  // clean up: end it (creator/host)
  const fin = (await (await page.request.get(API + '/e/' + code)).json()).data;
  expect((await page.request.put(API + '/e/' + code + '?by=organizer&org=1', { data: { data: { ...fin, finished: true, hidden: true } } })).ok()).toBe(true);
  await ctx.close(); await q.close(); await r.close();
});

test('API: older games without a cap are never full', async ({ request }) => {
  const code = 'NC' + Math.random().toString(36).slice(2, 6).toUpperCase(); const t = new Date(Date.now() + 26 * 3600e3); const d = new Date(t.getTime() - t.getTimezoneOffset() * 6e4).toISOString().slice(0, 11) + '09:00';
  const ps = (n: number) => Array.from({ length: n }, (_, i) => ({ id: 'n' + i, name: 'N' + i }));
  const ev = (n: number) => ({ id: code, name: 'e2e nocap ' + code, date: d, place: 'x', format: 'rotating', courts: 1, totalRounds: 1, balanceDupr: false, seeding: 'random', players: ps(n), active: ps(n).map(p => p.id), teams: [], rounds: [], createdAt: 1, hidden: true });
  expect((await request.put(API + '/e/' + code, { data: { data: ev(16) } })).ok()).toBe(true);
  expect((await request.put(API + '/e/' + code, { data: { data: ev(17) } })).ok()).toBe(true);
  const l = (await (await request.get(API + '/events?test=1&from=2000-01-01T00:00')).json()).events.find((e: { code: string }) => e.code === code); expect(l.max).toBeNull();
  expect((await request.delete(API + '/e/' + code)).ok()).toBe(true);
});

test('pick courts by letter (A, B, D): pairings use only those courts, labeled A/B/D; locked after start', async ({ page }) => {
  test.setTimeout(120000);
  const tag = Math.random().toString(36).slice(2, 6);
  page.on('dialog', d => d.accept());
  await page.goto(BASE + '#/new'); await page.getByLabel('Event name').fill('Courts test ' + tag); await page.getByLabel('Place').fill('Stone Creek');
  await page.getByText('Next: Players').click();
  for (let i = 1; i <= 16; i++) { await page.getByLabel('Player name').fill('C' + i + '-' + tag); await page.getByText('Add new player').click(); }
  await page.getByRole('button', { name: 'Next ›' }).click();
  // default A, B, C selected; chips A…H plus More…; max-players picker still there
  await expect(page.getByRole('radiogroup', { name: 'Max players' })).toBeVisible();
  const chip = (l: string) => page.getByRole('button', { name: 'Court ' + l, exact: true });
  for (const l of ['A', 'B', 'C']) await expect(chip(l)).toHaveAttribute('aria-pressed', 'true');
  await expect(chip('D')).toHaveAttribute('aria-pressed', 'false'); await expect(chip('H')).toBeVisible(); await expect(chip('I')).toHaveCount(0);
  await page.getByRole('button', { name: 'More…' }).click(); await expect(chip('Z')).toBeVisible();
  await chip('C').click(); await chip('D').click();
  await expect(page.locator('.courtRange')).toHaveText('3 courts: A, B, D');
  await page.locator('.courtRange').scrollIntoViewIfNeeded(); await page.screenshot({ path: 'e2e/shot-create-court-chips.png' });
  await page.getByRole('button', { name: 'Create game' }).click();
  await expect(page.getByText('3 courts (A, B, D)')).toBeVisible();
  const code = page.url().split('/e/')[1].split('/')[0];
  const ev0 = (await (await page.request.get(API + '/e/' + code)).json()).data; expect(ev0.courtSet).toEqual([1, 2, 4]); expect(ev0.courts).toBe(3);
  await page.getByRole('button', { name: 'Start game', exact: true }).click();
  // Start step is pre-filled with the create-time pick
  const sheet = page.getByRole('alertdialog'); for (const l of ['A', 'B', 'D']) await expect(sheet.getByRole('button', { name: 'Court ' + l, exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(sheet.getByRole('button', { name: 'Court C', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(sheet.locator('.startCourts')).toHaveText('3 games per round on Courts A, B, D · 4 sit out each round');
  await sheet.getByRole('button', { name: 'Start game' }).click();
  await expect(page.getByRole('heading', { name: /Round 1/ })).toBeVisible();
  await expect(page.locator('.match')).toHaveCount(3);
  await expect(page.locator('.match .court')).toHaveText(['Court A', 'Court B', 'Court D']);
  await expect(page.locator('.byeNames')).toBeVisible(); // 16 players on 3 courts → 4 sit out
  await page.screenshot({ path: 'e2e/shot-courts-abd.png', fullPage: true });
  // next round still A, B, D
  for (let i = 0; i < 3; i++) { const m = page.locator('.match').nth(i); await m.getByLabel('Team A score').fill('11'); await m.getByLabel('Team B score').fill(String(i + 3)); await m.getByRole('button', { name: 'Save score' }).click(); await expect(m.locator('.final')).toBeVisible(); }
  await page.getByRole('button', { name: /Next: Round 2/ }).click(); await expect(page.getByRole('heading', { name: /Round 2/ })).toBeVisible();
  await expect(page.locator('.match .court')).toHaveText(['Court A', 'Court B', 'Court D']);
  await page.getByRole('button', { name: /Manage/ }).click(); await expect(page.getByText('3 courts (A, B, D)')).toBeVisible();
  // locked after start: API refuses a change of picked courts
  const cur = (await (await page.request.get(API + '/e/' + code)).json()).data;
  const r = await page.request.put(API + '/e/' + code, { data: { data: { ...cur, courtSet: [1, 2, 3] } } }); expect(r.status()).toBe(409); expect((await r.json()).field).toBe('courtSet');
  expect((await page.request.put(API + '/e/' + code + '?by=organizer&org=1', { data: { data: { ...cur, finished: true, hidden: true } } })).ok()).toBe(true);
});

test('API: malformed picked courts are dropped (game falls back to A, B, C…)', async ({ request }) => {
  const code = 'CS' + Math.random().toString(36).slice(2, 6).toUpperCase(); const t = new Date(Date.now() + 26 * 3600e3); const d = new Date(t.getTime() - t.getTimezoneOffset() * 6e4).toISOString().slice(0, 11) + '09:00';
  const base = { id: code, name: 'e2e courtset ' + code, date: d, place: 'x', format: 'rotating', courts: 2, totalRounds: 1, balanceDupr: false, seeding: 'random', players: [], active: [], teams: [], rounds: [], createdAt: 1, hidden: true };
  expect((await request.put(API + '/e/' + code, { data: { data: { ...base, courtSet: [4, 1, 2] } } })).ok()).toBe(true);
  expect((await (await request.get(API + '/e/' + code)).json()).data.courtSet).toBeUndefined();
  expect((await request.put(API + '/e/' + code, { data: { data: { ...base, courtSet: [2, 4] } } })).ok()).toBe(true);
  expect((await (await request.get(API + '/e/' + code)).json()).data.courtSet).toEqual([2, 4]);
  expect((await request.delete(API + '/e/' + code)).ok()).toBe(true);
});

test('Start step: pick courts for a game created before the picker (no courtSet); existing sign-ups kept', async ({ page }) => {
  const tag = Math.random().toString(36).slice(2, 6).toUpperCase(); const code = 'SC' + tag;
  const t = new Date(Date.now() + 26 * 3600e3); const d = new Date(t.getTime() - t.getTimezoneOffset() * 6e4).toISOString().slice(0, 11) + '17:00';
  const players = Array.from({ length: 8 }, (_, i) => ({ id: 's' + i, name: 'S' + i + '-' + tag }));
  // same shape as a game made before court letters existed: courts 2, no courtSet, max 8
  const legacy = { id: code, name: 'Start courts test ' + tag, date: d, place: 'Stone Creek', format: 'rotating', courts: 2, totalRounds: 4, balanceDupr: false, seeding: 'random', players, active: players.map(p => p.id), teams: [], rounds: [], createdAt: Date.now(), maxPlayers: 8, hidden: true };
  expect((await page.request.put(API + '/e/' + code, { data: { data: legacy } })).ok()).toBe(true);
  // listing and lobby unchanged before the start
  const pre = (await (await page.request.get(API + '/e/' + code)).json()).data; expect(pre.courtSet).toBeUndefined(); expect(pre.active).toHaveLength(8);
  await page.addInitScript(c => localStorage.setItem('pb:org:' + c, '1'), code);
  await page.goto(BASE + '#/e/' + code); await expect(page.getByText('2 courts (A–B)')).toBeVisible();
  await page.getByRole('button', { name: 'Start game', exact: true }).click();
  const sheet = page.getByRole('alertdialog');
  await expect(sheet.getByRole('button', { name: 'Court A', exact: true })).toHaveAttribute('aria-pressed', 'true'); await expect(sheet.getByRole('button', { name: 'Court B', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(sheet.locator('.startCourts')).toHaveText('2 games per round on Courts A–B');
  // pick B and D instead; can't deselect the last one
  await sheet.getByRole('button', { name: 'Court A', exact: true }).click(); await sheet.getByRole('button', { name: 'Court D', exact: true }).click();
  await expect(sheet.locator('.startCourts')).toHaveText('2 games per round on Courts B, D');
  await sheet.getByRole('button', { name: 'Court B', exact: true }).click(); await expect(sheet.locator('.startCourts')).toHaveText('1 game per round on Court D · 4 sit out each round');
  await sheet.getByRole('button', { name: 'Court D', exact: true }).click(); await expect(sheet.getByRole('button', { name: 'Court D', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await sheet.getByRole('button', { name: 'Court B', exact: true }).click();
  await page.screenshot({ path: 'e2e/shot-start-court-step.png' });
  await sheet.getByRole('button', { name: 'Start game' }).click();
  await expect(page.getByRole('heading', { name: /Round 1/ })).toBeVisible();
  await expect(page.locator('.match .court')).toHaveText(['Court B', 'Court D']);
  await page.screenshot({ path: 'e2e/shot-start-courts-bd.png' });
  const ev = (await (await page.request.get(API + '/e/' + code)).json()).data;
  expect(ev.courts).toBe(2); expect(ev.courtSet).toEqual([2, 4]); expect(ev.players).toEqual(players); expect(ev.active).toEqual(legacy.active); expect(ev.maxPlayers).toBe(8); expect(ev.date).toBe(d); expect(ev.name).toBe(legacy.name);
  const r = await page.request.put(API + '/e/' + code, { data: { data: { ...ev, courtSet: [1, 2] } } }); expect(r.status()).toBe(409);
  expect((await page.request.put(API + '/e/' + code + '?by=organizer&org=1', { data: { data: { ...ev, finished: true, hidden: true } } })).ok()).toBe(true);
});

const day2 = () => { const t = new Date(Date.now() + 26 * 3600e3); return new Date(t.getTime() - t.getTimezoneOffset() * 6e4).toISOString().slice(0, 11) + '09:00'; };
const lobbyGame = (code: string, n: number, max: number, courts = 2) => { const players = Array.from({ length: n }, (_, i) => ({ id: code + 'p' + i, name: 'M' + i + '-' + code }));
  return { id: code, name: 'Max test ' + code, date: day2(), place: 'Stone Creek', format: 'rotating', courts, totalRounds: 3, balanceDupr: false, seeding: 'random', players, active: players.map(p => p.id), teams: [], rounds: [], createdAt: Date.now(), maxPlayers: max, hidden: true }; };

test('max players is a ceiling: max 16 starts with 8, max 12 starts with 4, max 16 starts with 12', async ({ page, request }) => {
  const code = 'MC' + Math.random().toString(36).slice(2, 6).toUpperCase();
  expect((await request.put(API + '/e/' + code, { data: { data: lobbyGame(code, 8, 16) } })).ok()).toBe(true);
  page.on('dialog', d => d.accept()); await page.addInitScript(c => localStorage.setItem('pb:org:' + c, '1'), code);
  await page.goto(BASE + '#/e/' + code); await expect(page.getByText('8 joined')).toBeVisible(); await expect(page.getByText('16 max')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start game', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Start game', exact: true }).click(); await page.getByRole('alertdialog').getByRole('button', { name: 'Start game' }).click();
  await expect(page.getByRole('heading', { name: /Round 1/ })).toBeVisible(); await expect(page.locator('.match')).toHaveCount(2);
  await page.screenshot({ path: 'e2e/shot-max16-start8.png' });
  const ev = (await (await request.get(API + '/e/' + code)).json()).data; expect(ev.rounds).toHaveLength(1); expect(ev.active).toHaveLength(8); expect(ev.maxPlayers).toBe(16);
  await request.put(API + '/e/' + code + '?by=organizer&org=1', { data: { data: { ...ev, finished: true } } });
  // API: start writes under the ceiling are accepted
  for (const [n, max] of [[4, 12], [12, 16], [4, 4]]) {
    const c = 'MC' + Math.random().toString(36).slice(2, 6).toUpperCase(); const g = lobbyGame(c, n, max, 3); expect((await request.put(API + '/e/' + c, { data: { data: g } })).ok()).toBe(true);
    const ids = g.active; const rounds = [{ n: 1, matches: Array.from({ length: Math.min(3, n / 4) }, (_, k) => ({ court: k + 1, a: [ids[4 * k], ids[4 * k + 1]], b: [ids[4 * k + 2], ids[4 * k + 3]] })), byes: ids.slice(Math.min(3, n / 4) * 4) }];
    const r = await request.put(API + '/e/' + c + '?by=organizer&org=1', { data: { data: { ...g, rounds, startedAt: 1, startedBy: 'organizer', host: 'organizer' } } }); expect(r.ok(), `start ${n} under max ${max}`).toBe(true);
    await request.put(API + '/e/' + c + '?by=organizer&org=1', { data: { data: { ...g, rounds, startedAt: 1, startedBy: 'organizer', host: 'organizer', finished: true } } });
  }
});

test('creator changes max before start (never below sign-ups, no one lost); others cannot; locked after start', async ({ page, browser, request }) => {
  const code = 'MX' + Math.random().toString(36).slice(2, 6).toUpperCase(); const g = lobbyGame(code, 6, 8);
  expect((await request.put(API + '/e/' + code, { data: { data: g } })).ok()).toBe(true);
  page.on('dialog', d => d.accept()); await page.addInitScript(c => localStorage.setItem('pb:org:' + c, '1'), code);
  await page.goto(BASE + '#/e/' + code);
  const grp = page.getByRole('radiogroup', { name: /Max players/ });
  await expect(grp.getByRole('radio', { name: '8' })).toHaveAttribute('aria-checked', 'true'); await expect(grp.getByRole('radio', { name: '4' })).toBeDisabled();
  await grp.getByRole('radio', { name: '12' }).click(); await expect(grp.getByRole('radio', { name: '12' })).toHaveAttribute('aria-checked', 'true'); await expect(page.getByText('12 max')).toBeVisible();
  await page.screenshot({ path: 'e2e/shot-lobby-change-max.png', fullPage: true });
  let ev = (await (await request.get(API + '/e/' + code)).json()).data; expect(ev.maxPlayers).toBe(12); expect(ev.players).toEqual(g.players); expect(ev.active).toEqual(g.active);
  // API: below sign-ups refused; non-creator change ignored
  const low = await request.put(API + '/e/' + code + '?org=1', { data: { data: { ...ev, maxPlayers: 4 } } }); expect(low.status()).toBe(409); expect((await low.json()).error).toBe('max below players');
  await request.put(API + '/e/' + code, { data: { data: { ...ev, maxPlayers: 16 } } }); expect((await (await request.get(API + '/e/' + code)).json()).data.maxPlayers).toBe(12);
  // a player's phone sees no max picker
  const ctx = await browser.newContext({ ...devices['iPhone 13'] }); await markTest(ctx); const p = await ctx.newPage(); await p.goto(BASE + '#/e/' + code);
  await expect(p.getByText('12 max')).toBeVisible(); await expect(p.getByRole('radiogroup', { name: /Max players/ })).toHaveCount(0); await ctx.close();
  // lower back to 8 (2 more join → 8 = full), then start; after start the cap is locked
  await grp.getByRole('radio', { name: '8' }).click(); await expect(page.getByText('8 max')).toBeVisible();
  ev = (await (await request.get(API + '/e/' + code)).json()).data; expect(ev.maxPlayers).toBe(8);
  const more = [{ id: code + 'x1', name: 'X1' }, { id: code + 'x2', name: 'X2' }];
  expect((await request.put(API + '/e/' + code, { data: { data: { ...ev, players: [...ev.players, ...more], active: [...ev.active, ...more.map(m => m.id)] } } })).ok()).toBe(true);
  await page.reload(); await expect(page.getByText('8 joined')).toBeVisible();
  await page.getByRole('button', { name: 'Start game', exact: true }).click(); await page.getByRole('alertdialog').getByRole('button', { name: 'Start game' }).click();
  await expect(page.getByRole('heading', { name: /Round 1/ })).toBeVisible();
  ev = (await (await request.get(API + '/e/' + code)).json()).data;
  await request.put(API + '/e/' + code + '?by=organizer&org=1', { data: { data: { ...ev, maxPlayers: 16 } } }); expect((await (await request.get(API + '/e/' + code)).json()).data.maxPlayers).toBe(8);
  await request.put(API + '/e/' + code + '?by=organizer&org=1', { data: { data: { ...ev, finished: true } } });
});

test('Sub in (starter only): Guest / named sub from a round on, pairings unchanged, credited to the sub, undo + back in; Guest kept out of Overall', async ({ page, browser, request }) => {
  test.setTimeout(150000);
  const tag = Math.random().toString(36).slice(2, 6).toLowerCase(); const code = 'SB' + tag.toUpperCase();
  const ps = ['Ann', 'Bob', 'Cat', 'Dan', 'Eve', 'Fay', 'Gus', 'Hal'].map((n, i) => ({ id: 'b' + i, name: n + ' ' + tag }));
  const lobby = { id: code, name: 'Sub test ' + tag, date: day2(), place: 'x', format: 'rotating', courts: 2, totalRounds: 3, balanceDupr: false, seeding: 'random', players: ps, active: ps.map(p => p.id), teams: [], rounds: [], createdAt: 1, hidden: true };
  expect((await request.put(API + '/e/' + code, { data: { data: lobby } })).ok()).toBe(true);
  page.on('dialog', d => d.accept()); await page.addInitScript(c => localStorage.setItem('pb:org:' + c, '1'), code);
  await page.goto(BASE + '#/e/' + code); await page.getByRole('button', { name: 'Start game', exact: true }).click(); await page.getByRole('alertdialog').getByRole('button', { name: 'Start game' }).click();
  await expect(page.getByRole('heading', { name: /Round 1/ })).toBeVisible();
  const scoreAll = async () => { for (let i = 0; i < 2; i++) { const m = page.locator('.match').nth(i); await m.getByLabel('Team A score').fill('11'); await m.getByLabel('Team B score').fill(String(4 + i)); await m.getByRole('button', { name: 'Save score' }).click(); await expect(m.locator('.final')).toBeVisible(); } };
  await scoreAll(); await page.getByRole('button', { name: /Next: Round 2/ }).click(); await expect(page.getByRole('heading', { name: /Round 2/ })).toBeVisible();
  const r2 = JSON.stringify((await (await request.get(API + '/e/' + code)).json()).data.rounds[1]);
  const p0 = (await (await request.get(API + '/e/' + code)).json()).data.rounds[1].matches[0].a[0] as string; const n0 = ps.find(p => p.id === p0)!.name;
  const p1 = (await (await request.get(API + '/e/' + code)).json()).data.rounds[1].matches[1].b[1] as string; const n1 = ps.find(p => p.id === p1)!.name;
  // Manage: Sub in Guest for p0 from Round 2 (current)
  await page.getByRole('button', { name: /Manage/ }).click();
  await page.getByRole('button', { name: 'Sub in for ' + n0 }).click();
  await expect(page.getByLabel('Starting round')).toHaveValue('2'); await expect(page.getByLabel("Sub's name")).toHaveAttribute('placeholder', 'Guest');
  await page.screenshot({ path: 'e2e/shot-sub-sheet.png' });
  await page.getByRole('dialog').getByRole('button', { name: 'Sub in' }).click();
  await expect(page.getByText('Guest for ' + n0 + ' · from Round 2')).toBeVisible();
  // named sub for p1, then undo it
  await page.getByRole('button', { name: 'Sub in for ' + n1 }).click(); await page.getByLabel("Sub's name").fill('Zoe ' + tag); await page.getByRole('dialog').getByRole('button', { name: 'Sub in' }).click();
  await expect(page.getByText('Zoe ' + tag + ' for ' + n1)).toBeVisible();
  await page.getByRole('button', { name: 'Undo sub ' + n1 + ' round 2' }).click(); await expect(page.getByText('Zoe ' + tag + ' for ' + n1)).toHaveCount(0);
  await page.getByRole('button', { name: 'Sub in for ' + n1 }).click(); await page.getByLabel("Sub's name").fill('Zoe ' + tag); await page.getByRole('dialog').getByRole('button', { name: 'Sub in' }).click();
  await page.screenshot({ path: 'e2e/shot-sub-manage.png', fullPage: true });
  // a player's phone can't change subs
  const cur = (await (await request.get(API + '/e/' + code)).json()).data; expect(JSON.stringify(cur.rounds[1])).toBe(r2); expect(cur.players).toEqual(ps); expect(cur.active).toEqual(lobby.active);
  const bad = await request.put(API + '/e/' + code + '?by=b3', { data: { data: { ...cur, subs: [] } } }); expect(bad.status()).toBe(409); expect((await bad.json()).field).toBe('subs');
  // Courts: round 2 names show the subs; round 1 unchanged
  await page.getByRole('button', { name: /Courts/ }).click();
  await expect(page.locator('.match').first()).toContainText('Guest (for ' + n0 + ')'); await expect(page.locator('.match').nth(1)).toContainText('Zoe ' + tag + ' (for ' + n1 + ')');
  await page.screenshot({ path: 'e2e/shot-sub-courts.png', fullPage: true });
  await scoreAll(); await page.getByRole('button', { name: /Next: Round 3/ }).click(); await expect(page.getByRole('heading', { name: /Round 3/ })).toBeVisible();
  // put p0 back in from Round 3
  await page.getByRole('button', { name: /Manage/ }).click(); await page.getByRole('button', { name: 'Put ' + n0 + ' back in' }).click();
  await expect(page.getByLabel('Starting round')).toHaveValue('3'); await page.getByRole('dialog').getByRole('button', { name: 'Put back in' }).click();
  await expect(page.getByText(n0 + ' back in · from Round 3')).toBeVisible();
  await page.getByRole('button', { name: /Courts/ }).click(); await expect(page.locator('.match', { hasText: 'Guest' })).toHaveCount(0);
  await scoreAll();
  const fin = (await (await request.get(API + '/e/' + code)).json()).data;
  expect((await request.put(API + '/e/' + code + '?by=organizer&org=1', { data: { data: { ...fin, finished: true } } })).ok()).toBe(true);
  // stats: p0 has r1 + r3; Guest nowhere; Zoe (never swapped back) has r2 + r3; p1 only r1
  const hist = (n: string) => request.get(API + '/stats/player?test=1&name=' + encodeURIComponent(n.toLowerCase())).then(r => r.json()).then(j => j.matches.map((m: { id: string }) => m.id.split(':')[1]).sort());
  expect(await hist(n0), 'n0').toEqual(['r1', 'r3']); expect(await hist('Zoe ' + tag), 'zoe stays in').toEqual(['r2', 'r3']); expect(await hist(n1), 'n1').toEqual(['r1']);
  const guestRows = await hist('guest'); expect(guestRows.filter((x: string) => x)).toEqual([]);
  // game standings: Guest row + sub tag
  await page.getByRole('button', { name: /Standings/ }).click();
  await expect(page.locator('tr', { hasText: 'Guest (for ' + n0 + ')' })).toBeVisible(); await expect(page.locator('tr', { hasText: 'Zoe ' + tag })).toContainText('sub');
  await page.screenshot({ path: 'e2e/shot-sub-standings.png', fullPage: true });
});

test('Club vs Club: create with typed teams, joiner placed on a team, home teams stay on their court, visitors rotate, club totals; guests kept out of Overall', async ({ page, browser, request }) => {
  test.setTimeout(150000);
  const tag = Math.random().toString(36).slice(2, 6).toLowerCase(); const V = 'Oak ' + tag;
  page.on('dialog', d => d.accept());
  await page.goto(BASE); await page.getByText('Create a game').click();
  await page.getByLabel('Event name').fill('Club e2e ' + tag); await page.getByPlaceholder('e.g. the gym').fill('Gym');
  await page.getByRole('radio', { name: /Club vs Club/ }).click();
  await expect(page.getByLabel(/^Home club/)).toHaveValue('Stone Creek'); await page.getByLabel('Visiting club').selectOption({ label: 'Add club…' }); await page.getByLabel('New club name').fill(V); await page.getByRole('button', { name: 'Save club' }).click();
  await expect(page.getByLabel('Visiting club')).toHaveValue(V);
  await expect(page.locator('.clubSetup')).toContainText('2 home teams vs 2 visiting teams');
  await page.screenshot({ path: 'e2e/shot-club-create.png', fullPage: true });
  await page.getByRole('button', { name: 'Next: Teams ›' }).click();
  const nm = (s: string) => s + ' ' + tag;
  await page.getByLabel('Home team 1 player 1').fill(nm('Hana')); await page.getByLabel('Home team 1 player 2').fill(nm('Hugo'));
  await page.getByLabel('Home team 2 player 1').fill(nm('Hope'));
  await page.getByLabel('Visiting team 1 player 1').fill(nm('Vera')); await page.getByLabel('Visiting team 1 player 2').fill(nm('Vic'));
  await page.screenshot({ path: 'e2e/shot-club-teams.png', fullPage: true });
  await page.getByRole('button', { name: 'Next ›' }).click();
  await expect(page.getByText('Max players')).toHaveCount(0);
  await page.getByRole('button', { name: 'Court A', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Create game' })).toBeDisabled();
  await page.getByRole('button', { name: 'Court D', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Create game' })).toBeEnabled();
  await page.getByRole('button', { name: 'Create game' }).click();
  await expect(page.locator('.lobbyStatus')).toBeVisible(); const code = page.url().split('/e/')[1];
  await expect(page.getByRole('button', { name: 'Start game', exact: true })).toBeDisabled();
  await expect(page.getByText('Fill every home team spot')).toBeVisible();
  // a joiner by link, placed on Home team 2 by the creator
  const ctx = await browser.newContext({ ...devices['Pixel 7'] }); await markTest(ctx); const p2 = await ctx.newPage();
  await p2.goto(BASE + '#/e/' + code); await p2.getByRole('radio', { name: 'Join as Stone Creek' }).click(); await p2.getByPlaceholder('Name').fill(nm('Joe')); await p2.getByRole('button', { name: 'Join as Stone Creek' }).last().click();
  await expect(p2.getByText("You're in as")).toBeVisible(); await expect(p2.getByLabel('Home team 1 player 1')).toHaveText(nm('Hana'));
  await page.getByRole('button', { name: 'Refresh' }).click(); await expect(page.locator('.clubFree')).toContainText(nm('Joe'));
  await page.getByLabel('Home team 2 player 2').fill(nm('Joe')); await page.getByLabel('Home team 2 player 2').press('Enter');
  await expect(page.locator('.clubFree')).toHaveCount(0);
  const lob = (await (await request.get(API + '/e/' + code)).json()).data;
  const joe = lob.players.find((p: { name: string }) => p.name === nm('Joe')).id; expect(lob.club.homeTeams[1][1]).toBe(joe); expect(lob.players).toHaveLength(6);
  await page.screenshot({ path: 'e2e/shot-club-lobby.png', fullPage: true });
  await page.getByRole('button', { name: 'Start game', exact: true }).click();
  const sheet = page.getByRole('alertdialog'); await expect(sheet).toContainText('Start Stone Creek vs ' + V);
  await expect(sheet.getByRole('button', { name: 'Court B' })).toHaveAttribute('aria-pressed', 'true'); await expect(sheet.getByRole('button', { name: 'Court D' })).toHaveAttribute('aria-pressed', 'true');
  await sheet.getByRole('button', { name: 'Start game' }).click();
  await expect(page.getByRole('heading', { name: /Round 1/ })).toBeVisible();
  await expect(page.locator('.match .court')).toHaveText(['Court B', 'Court D']);
  await expect(page.locator('.clubMatchup')).toHaveText(['Stone Creek 1 vs ' + V + ' 1', 'Stone Creek 2 vs ' + V + ' 2']);
  await expect(page.locator('.match').nth(1)).toContainText(V + ' 2A');
  const score = async (x: number[]) => { for (let i = 0; i < 2; i++) { const m = page.locator('.match').nth(i); await m.getByLabel('Team A score').fill(String(x[i * 2])); await m.getByLabel('Team B score').fill(String(x[i * 2 + 1])); await m.getByRole('button', { name: 'Save' }).click(); await expect(m.locator('.final')).toBeVisible(); } };
  await score([11, 7, 5, 11]); await page.getByRole('button', { name: /Next: Round 2/ }).click();
  await expect(page.getByRole('heading', { name: /Round 2/ })).toBeVisible();
  await expect(page.locator('.clubMatchup')).toHaveText(['Stone Creek 1 vs ' + V + ' 2', 'Stone Creek 2 vs ' + V + ' 1']);
  await expect(page.locator('.match').first()).toContainText(nm('Hana'));
  // the joiner's phone can score too
  await p2.reload(); await p2.getByRole('button', { name: /Courts/ }).click(); const m2 = p2.locator('.match').nth(1); await m2.getByLabel('Team A score').fill('11'); await m2.getByLabel('Team B score').fill('9'); await m2.getByRole('button', { name: 'Save' }).click(); await expect(m2.locator('.final')).toBeVisible();
  await page.getByRole('button', { name: 'Refresh' }).click();
  { const m = page.locator('.match').first(); await m.getByLabel('Team A score').fill('11'); await m.getByLabel('Team B score').fill('3'); await m.getByRole('button', { name: 'Save' }).click(); await expect(m.locator('.final')).toBeVisible(); }
  await page.screenshot({ path: 'e2e/shot-club-courts.png', fullPage: true });
  const fin = (await (await request.get(API + '/e/' + code)).json()).data;
  expect((await request.put(API + '/e/' + code + '?by=organizer&org=1', { data: { data: { ...fin, finished: true } } })).ok()).toBe(true);
  // locked after start
  expect((await request.put(API + '/e/' + code + '?by=organizer&org=1', { data: { data: { ...fin, club: { ...fin.club, home: 'X' } } } })).status()).toBe(409);
  await page.reload(); await page.getByRole('button', { name: 'Standings', exact: true }).click();
  const tot = page.getByRole('status', { name: 'Club totals' });
  await expect(tot).toContainText('Stone Creek3matches won · 38 pts'); await expect(tot).toContainText(V + '1matches won · 30 pts');
  await expect(page.locator('.clubTable').first()).toContainText('Stone Creek 1');
  await page.screenshot({ path: 'e2e/shot-club-standings.png', fullPage: true });
  const hist = (n: string) => request.get(API + '/stats/player?test=1&name=' + encodeURIComponent(n.toLowerCase())).then(r => r.json()).then(j => (j.matches || []).length);
  const histC = (n: string, c: string) => request.get(API + '/stats/player?test=1&club=' + encodeURIComponent(c) + '&name=' + encodeURIComponent(n.toLowerCase())).then(r => r.json()).then(j => (j.matches || []).length);
  expect(await hist(nm('Hana'))).toBe(2); expect(await hist(nm('Joe'))).toBe(2); expect(await histC(nm('Vera'), V)).toBe(2); expect(await hist(nm('Vera'))).toBe(0); expect(await histC(V + ' 2A', V)).toBe(0);
  await ctx.close();
  console.log('CLUBCODE ' + code);
});

test('Player icons: built-in icon or photo, first phone owns it, others refused, admin reset; shown in lobby/courts/standings/Overall', async ({ page, browser, request }) => {
  test.setTimeout(150000);
  const tag = Math.random().toString(36).slice(2, 6).toLowerCase(); const code = 'IC' + tag.toUpperCase(); const ivy = 'Ivy ' + tag;
  const lobby = { id: code, name: 'Icon e2e ' + tag, date: day2(), place: 'x', format: 'rotating', courts: 1, totalRounds: 1, balanceDupr: false, seeding: 'random', players: [], active: [], teams: [], rounds: [], createdAt: 1, hidden: true };
  expect((await request.put(API + '/e/' + code, { data: { data: lobby } })).ok()).toBe(true);
  page.on('dialog', d => d.accept());
  await page.goto(BASE + '#/e/' + code); await page.getByPlaceholder('Full name').fill(ivy); await page.getByRole('button', { name: 'Join' }).click();
  await expect(page.getByText("You're in as")).toBeVisible();
  await expect(page.locator('.lobbyRow .av')).toHaveAttribute('data-icon', 'none');
  await page.getByRole('button', { name: 'Set icon' }).click(); await page.screenshot({ path: 'e2e/shot-icon-picker.png' });
  await expect(page.getByLabel('Take photo')).toHaveAttribute('capture', 'user'); await expect(page.getByLabel('Choose photo')).not.toHaveAttribute('capture', /.*/);
  await expect(page.getByLabel('Take photo')).toHaveAttribute('accept', 'image/*');
  await page.getByRole('button', { name: 'Icon fox' }).click();
  await expect(page.locator('.lobbyRow .av')).toHaveAttribute('data-icon', 'fox');
  // a different phone can't change Ivy's icon
  const bad = await request.put(API + '/icon?test=1', { data: { name: ivy.toUpperCase(), icon: 'bear' } }); expect(bad.status()).toBe(403);
  const bad2 = await request.put(API + '/icon?test=1', { data: { name: ivy, icon: 'bear', token: 'nope' } }); expect(bad2.status()).toBe(403);
  const ctx = await browser.newContext({ ...devices['Pixel 7'] }); await markTest(ctx); const p2 = await ctx.newPage(); p2.on('dialog', d => d.accept());
  await p2.goto(BASE + '#/e/' + code); await p2.getByPlaceholder('Full name').fill('Max ' + tag); await p2.getByRole('button', { name: 'Join' }).click();
  await expect(p2.locator('.lobbyRow', { hasText: ivy }).locator('.av')).toHaveAttribute('data-icon', 'fox');
  // the owner uploads a photo: resized to 256px JPEG on the phone
  await page.getByRole('button', { name: 'Set icon' }).click(); await page.getByLabel('Choose photo').setInputFiles('e2e/fixture-photo.png');
  await expect(page.locator('.lobbyRow', { hasText: ivy }).locator('.av')).toHaveAttribute('data-icon', 'photo');
  const img = await request.get(API + '/icon?k=' + encodeURIComponent(ivy.toLowerCase()) + '&v=2'); expect(img.headers()['content-type']).toBe('image/jpeg');
  const jb = await img.body(); expect(jb.length).toBeLessThan(90000); expect(jb.readUInt16BE(jb.indexOf(Buffer.from([0xff, 0xc0])) + 5)).toBe(256);
  await expect.poll(() => page.locator('.lobbyRow', { hasText: ivy }).locator('img').evaluate((e: HTMLImageElement) => e.naturalWidth)).toBe(256);
  await page.screenshot({ path: 'e2e/shot-icon-lobby.png', fullPage: true });
  // add 2 more and play: icons on courts + standings
  for (const n of ['Ned', 'Oli']) { await p2.getByRole('button', { name: 'Not you?' }).click(); await p2.getByPlaceholder('Full name').fill(n + ' ' + tag); await p2.getByRole('button', { name: 'Join' }).click(); await expect(p2.getByText("You're in as")).toBeVisible(); }
  await page.getByRole('button', { name: 'Refresh' }).click(); await page.getByRole('button', { name: 'Start game', exact: true }).click(); await page.getByRole('alertdialog').getByRole('button', { name: 'Start game' }).click();
  await expect(page.getByRole('heading', { name: /Round 1/ })).toBeVisible();
  await expect(page.locator('.match img.av')).toHaveCount(1);
  await page.screenshot({ path: 'e2e/shot-icon-courts.png', fullPage: true });
  // admin reset (admin key from env, never in the repo)
  expect((await request.put(API + '/icon?test=1', { data: { name: ivy, reset: true } })).status()).toBe(403);
  if (process.env.ADMIN_KEY) {
    expect((await request.put(API + '/icon?test=1', { headers: { 'x-admin': process.env.ADMIN_KEY }, data: { name: ivy, reset: true } })).ok()).toBe(true);
    expect((await (await request.get(API + '/icons?test=1')).json()).icons[ivy.toLowerCase()]).toBeUndefined();
    // after a reset the next phone becomes the owner
    const r = await request.put(API + '/icon?test=1', { data: { name: ivy, icon: 'crown' } }); expect(r.ok()).toBe(true); expect((await r.json()).token).toBeTruthy();
    await page.reload(); await expect(page.locator('.match .av[data-icon="crown"]')).toHaveCount(1);
  }
  await ctx.close(); console.log('ICONCODE ' + code);
});

test('Trophy match: checkbox at Create; 1st place (wins, then diff; co-winners) gets a trophy on completion; badge + count in Overall + trophy list', async ({ page, request }) => {
  test.setTimeout(120000);
  page.on('dialog', d => d.accept());
  await page.goto(BASE); await page.getByText('Create a game').click(); await page.getByText('Next: Players').click(); await page.getByRole('button', { name: 'Next ›' }).click();
  await expect(page.getByLabel(/Trophy match/)).not.toBeChecked();
  const tag = Math.random().toString(36).slice(2, 6).toLowerCase(); const code = 'TR' + tag.toUpperCase();
  const ps = ['Ann', 'Bob', 'Cat', 'Dan', 'Eve', 'Fay', 'Gus', 'Hal'].map((n, i) => ({ id: 't' + i, name: n + ' ' + tag }));
  const lobby = { id: code, name: 'Trophy e2e ' + tag, date: day2(), place: 'x', format: 'rotating', courts: 2, totalRounds: 1, balanceDupr: false, seeding: 'random', players: ps, active: ps.map(p => p.id), teams: [], rounds: [], createdAt: 1, hidden: true, trophy: true };
  expect((await request.put(API + '/e/' + code, { data: { data: lobby } })).ok()).toBe(true);
  await page.evaluate(c => localStorage.setItem('pb:org:' + c, '1'), code);
  await page.goto(BASE + '#/e/' + code); await page.reload(); await page.getByRole('button', { name: 'Start game', exact: true }).click(); await page.getByRole('alertdialog').getByRole('button', { name: 'Start game' }).click();
  await expect(page.getByRole('heading', { name: /Round 1/ })).toBeVisible();
  for (let i = 0; i < 2; i++) { const m = page.locator('.match').nth(i); await m.getByLabel('Team A score').fill('11'); await m.getByLabel('Team B score').fill(String(3 + i * 4)); await m.getByRole('button', { name: 'Save' }).click(); await expect(m.locator('.final')).toBeVisible(); }
  await page.getByRole('button', { name: 'Standings', exact: true }).click(); await expect(page.locator('.trophyNote')).toBeVisible();
  const ev = (await (await request.get(API + '/e/' + code)).json()).data;
  const nm = (id: string) => ps.find(p => p.id === id)!.name; const win = ev.rounds[0].matches[0].a.map(nm).sort();
  expect((await request.put(API + '/e/' + code + '?by=organizer&org=1', { data: { data: { ...ev, finished: true } } })).ok()).toBe(true);
  await page.reload(); await page.getByRole('button', { name: 'Standings', exact: true }).click();
  await expect(page.locator('.trophyWin')).toContainText(win.join(' & ')); await expect(page.locator('.trophyWin')).toContainText('co-winners');
  await expect(page.locator('tbody tr', { has: page.locator('.trophyBadge') })).toHaveCount(2);
  await expect(page.locator('.trophyWin')).toContainText('🏆 Winners: ');
  expect(await page.locator('.trophyWin').evaluate(e => { const p = e.parentElement!; return [...p.children].indexOf(e); })).toBe(0);
  const st = (await (await request.get(API + '/stats?test=1')).json()).players; expect(st.find((p: { k: string }) => p.k === win[0].toLowerCase()).trophies).toBe(1); expect(st.find((p: { k: string }) => p.k === nm(ev.rounds[0].matches[1].a[0]).toLowerCase()).trophies).toBe(0);
  // a second trophy game won by the same player → x2
  const code2 = 'TS' + tag.toUpperCase(); const w0 = ev.rounds[0].matches[0].a[0];
  const g2 = { ...lobby, id: code2, name: 'Trophy e2e ' + tag + ' two', courts: 1, totalRounds: 1, players: ps.slice(0, 4).map(p => p.id === 't0' ? ps.find(x => x.id === w0)! : p.id === w0 ? ps[0] : p), active: ['t0', 't1', 't2', 't3'],
    rounds: [{ n: 1, byes: [], matches: [{ court: 1, a: ['t0', 't1'], b: ['t2', 't3'], sa: 11, sb: 2 }] }], startedAt: 2, startedBy: 'organizer', host: 'organizer', finished: true };
  g2.players = ps.slice(0, 4).map((p, i) => i === 0 ? { id: 't0', name: nm(w0) } : { id: 't' + i, name: 'X' + i + ' ' + tag }); expect((await request.put(API + '/e/' + code2, { data: { data: g2 } })).ok()).toBe(true);
  await page.screenshot({ path: 'e2e/shot-trophy-standings.png', fullPage: true });
  const wn = nm(w0);
  await page.goto(BASE + '#/stats'); await expect(page.locator('tr', { hasText: wn }).locator('.trophyCount')).toHaveText('🏆 x2');
  await page.getByRole('tab', { name: /Trophies/ }).click(); const tb = page.locator('.trophyBoard tbody tr');
  await expect(tb.filter({ hasText: wn }).locator('.trophyCount')).toHaveText('🏆 x2');
  const counts = await tb.locator('.trophyCount').allTextContents(); const nums = counts.map(t => Number(t.replace(/\D/g, ''))); expect([...nums].sort((a, b) => b - a)).toEqual(nums);
  await page.screenshot({ path: 'e2e/shot-trophy-overall.png', fullPage: true });
  await page.screenshot({ path: 'e2e/shot-trophy-leaderboard.png', fullPage: true });
  await page.goto(BASE + '#/stats/' + encodeURIComponent(wn.toLowerCase())); const tcase = page.getByLabel('Trophy case');
  await expect(tcase).toContainText('🏆 x2'); await expect(tcase.locator('li')).toHaveCount(2); await expect(tcase).toContainText('Trophy e2e ' + tag + ' two');
  await expect(page.locator('.playerHead .trophyCount')).toHaveText('🏆 x2');
  await page.screenshot({ path: 'e2e/shot-trophy-player.png', fullPage: true });
  // can't flip trophy after the start
  expect((await request.put(API + '/e/' + code + '?by=organizer&org=1', { data: { data: { ...ev, trophy: false } } })).status()).toBe(409);
  // in-game standings show lifetime trophy counts next to names
  await page.goto(BASE + '#/e/' + code); await page.getByRole('button', { name: 'Standings', exact: true }).click(); await expect(page.locator('tr', { hasText: wn }).locator('.trophyCount')).toHaveText('🏆 x2');
  console.log('TROPHYCODE ' + code + ' ' + code2);
});

test('Club vs Club join: link opener picks Join as <club>; visitor joined list; joiner takes a visitor spot, creator places another; named visitors count in Overall, guests do not', async ({ page, browser, request }) => {
  test.setTimeout(150000);
  const tag = Math.random().toString(36).slice(2, 6).toLowerCase(); const code = 'CJ' + tag.toUpperCase(); const V = 'Elm ' + tag;
  const hs = ['Hal', 'Hep', 'Hix', 'Hob'].map((n, i) => ({ id: 'h' + i, name: n + ' ' + tag }));
  const lobby = { id: code, name: 'Club e2e ' + tag, date: day2(), place: 'x', format: 'club', courts: 2, courtSet: [1, 2], totalRounds: 2, balanceDupr: false, seeding: 'random', players: hs, active: hs.map(p => p.id), teams: [], rounds: [], createdAt: 1, hidden: true,
    club: { home: 'Stone Creek', away: V, n: 2, homeTeams: [['h0', 'h1'], ['h2', 'h3']], awayTeams: [['', ''], ['', '']] } };
  expect((await request.put(API + '/e/' + code, { data: { data: lobby } })).ok()).toBe(true);
  page.on('dialog', d => d.accept());
  // visitor phone: choose the club, join, appear in the visitor joined list, take a spot
  const ctx = await browser.newContext({ ...devices['Pixel 7'] }); await markTest(ctx); const v = await ctx.newPage(); v.on('dialog', d => d.accept());
  await v.goto(BASE + '#/e/' + code);
  await expect(v.getByRole('radio', { name: 'Join as Stone Creek' })).toBeVisible(); await expect(v.getByPlaceholder('Full name')).toHaveCount(0);
  await v.screenshot({ path: 'e2e/shot-clubjoin-choose.png', fullPage: true });
  await v.getByRole('radio', { name: 'Join as ' + V }).click(); await v.getByPlaceholder('Full name').fill('Val ' + tag); await v.getByRole('button', { name: 'Join as ' + V }).last().click();
  await expect(v.getByText("You're in as")).toBeVisible();
  await expect(v.locator('.clubFree-away')).toContainText('Val ' + tag);
  await expect(v.getByRole('button', { name: /^Take Home team/ })).toHaveCount(0);
  await v.screenshot({ path: 'e2e/shot-clubjoin-visitor-list.png', fullPage: true });
  await v.getByRole('button', { name: 'Take Visiting team 2 player 1' }).click();
  await expect(v.locator('.mySpot')).toContainText('Val ' + tag); await expect(v.locator('.clubFree-away')).toHaveCount(0);
  // a second visitor joins; the creator places them
  const ctx2 = await browser.newContext({ ...devices['Pixel 7'] }); await markTest(ctx2); const w = await ctx2.newPage();
  await w.goto(BASE + '#/e/' + code); await w.getByRole('radio', { name: 'Join as ' + V }).click(); await w.getByPlaceholder('Full name').fill('Wes ' + tag); await w.getByRole('button', { name: 'Join as ' + V }).last().click(); await expect(w.getByText("You're in as")).toBeVisible();
  await page.evaluate(c => localStorage.setItem('pb:org:' + c, '1'), code).catch(() => {}); await page.goto(BASE); await page.evaluate(c => localStorage.setItem('pb:org:' + c, '1'), code); await page.goto(BASE + '#/e/' + code); await page.reload();
  await expect(page.locator('.clubFree-away')).toContainText('Wes ' + tag);
  await expect(page.getByLabel('Visiting team 2 player 1')).toHaveValue('Val ' + tag);
  await page.getByLabel('Visiting team 1 player 1').fill('Wes ' + tag); await page.getByLabel('Visiting team 1 player 1').press('Enter');
  await expect(page.locator('.clubFree-away')).toHaveCount(0);
  await page.screenshot({ path: 'e2e/shot-clubjoin-creator.png', fullPage: true });
  const lob = (await (await request.get(API + '/e/' + code)).json()).data;
  const vid = lob.players.find((p: { name: string }) => p.name === 'Val ' + tag); expect(vid.side).toBe('away'); expect(lob.club.awayTeams[1][0]).toBe(vid.id);
  // start: 2 named visitors + 2 guest spots
  await page.getByRole('button', { name: 'Start game', exact: true }).click(); await page.getByRole('alertdialog').getByRole('button', { name: 'Start game' }).click();
  await expect(page.getByRole('heading', { name: /Round 1/ })).toBeVisible();
  for (let r = 0; r < 2; r++) {
    for (let i = 0; i < 2; i++) { const m = page.locator('.match').nth(i); await m.getByLabel('Team A score').fill('11'); await m.getByLabel('Team B score').fill(String(5 + i)); await m.getByRole('button', { name: 'Save' }).click(); await expect(m.locator('.final')).toBeVisible(); }
    if (r === 0) { await page.getByRole('button', { name: /Next: Round 2/ }).click(); await expect(page.getByRole('heading', { name: /Round 2/ })).toBeVisible(); }
  }
  const fin = (await (await request.get(API + '/e/' + code)).json()).data;
  expect((await request.put(API + '/e/' + code + '?by=organizer&org=1', { data: { data: { ...fin, finished: true } } })).ok()).toBe(true);
  const hist = (n: string) => request.get(API + '/stats/player?test=1&name=' + encodeURIComponent(n.toLowerCase())).then(r => r.json()).then(j => (j.matches || []).length);
  const histC = (n: string, c: string) => request.get(API + '/stats/player?test=1&club=' + encodeURIComponent(c) + '&name=' + encodeURIComponent(n.toLowerCase())).then(r => r.json()).then(j => (j.matches || []).length);
  // visitors' stats go to the visiting club, home players' to the home club
  expect(await histC('Val ' + tag, V)).toBe(2); expect(await histC('Wes ' + tag, V)).toBe(2); expect(await hist('Val ' + tag)).toBe(0); expect(await hist('Hal ' + tag)).toBe(2); expect(await histC('Hal ' + tag, V)).toBe(0); expect(await histC(V + ' 1B', V)).toBe(0);
  await page.reload(); await page.getByRole('button', { name: 'Standings', exact: true }).click(); await page.screenshot({ path: 'e2e/shot-clubjoin-standings.png', fullPage: true });
  await ctx.close(); await ctx2.close(); console.log('CJCODE ' + code);
});

test('Clubs: pick/add club at Create (saved for everyone, case-insensitive), stats/Past/trophies scoped by club, Join list tag; existing games stay Stone Creek', async ({ page, request }) => {
  test.setTimeout(150000);
  const tag = Math.random().toString(36).slice(2, 6).toLowerCase(); const C = 'Maple ' + tag + ' Club'; const ps = ['Amy', 'Ben', 'Cy', 'Di'].map(n => n + ' ' + tag);
  page.on('dialog', d => d.accept());
  await page.goto(BASE); await page.getByText('Create a game').click();
  await page.getByLabel('Event name').fill('Clubs e2e ' + tag);
  const sel = page.getByLabel('Club (stats go to this club)'); await expect(sel).toHaveValue('Stone Creek');
  await sel.selectOption({ label: 'Add club…' }); await page.getByLabel('New club name').fill(C); await page.screenshot({ path: 'e2e/shot-clubs-add.png', fullPage: true });
  await page.getByRole('button', { name: 'Save club' }).click(); await expect(sel).toHaveValue(C);
  // saved for everyone, deduped case-insensitively
  const again = await (await request.put(API + '/clubs?test=1', { data: { name: '  ' + C.toUpperCase() + ' ' } })).json(); expect(again.name).toBe(C);
  const list = (await (await request.get(API + '/clubs?test=1')).json()).clubs as string[]; expect(list[0]).toBe('Stone Creek'); expect(list.filter(c => c.toLowerCase() === C.toLowerCase())).toHaveLength(1);
  expect((await (await request.get(API + '/clubs')).json()).clubs).not.toContain(C); // hidden test clubs never show publicly
  await page.screenshot({ path: 'e2e/shot-clubs-create.png', fullPage: true });
  await page.getByText('Next: Players').click();
  for (const n of ps) { await page.getByPlaceholder('Full name').fill(n); await page.getByText('Add new player').click(); }
  await page.getByRole('button', { name: 'Next ›' }).click(); await page.getByLabel(/Trophy match/).check();
  await page.getByRole('button', { name: 'Create game' }).click(); await expect(page.locator('.lobbyStatus')).toBeVisible(); const code = page.url().split('/e/')[1];
  expect((await (await request.get(API + '/e/' + code)).json()).data.clubName).toBe(C);
  // Join list tag (game not started yet)
  await page.goto(BASE + '#/join'); await expect(page.locator('.game', { hasText: 'Clubs e2e ' + tag }).locator('.clubTag')).toHaveText(C);
  await page.screenshot({ path: 'e2e/shot-clubs-join.png', fullPage: true });
  await page.goto(BASE + '#/e/' + code); await page.getByRole('button', { name: 'Start game', exact: true }).click(); await page.getByRole('alertdialog').getByRole('button', { name: 'Start game' }).click();
  await expect(page.getByRole('heading', { name: /Round 1/ })).toBeVisible();
  const m = page.locator('.match').first(); await m.getByLabel('Team A score').fill('11'); await m.getByLabel('Team B score').fill('4'); await m.getByRole('button', { name: 'Save' }).click(); await expect(m.locator('.final')).toBeVisible();
  const fin = (await (await request.get(API + '/e/' + code)).json()).data;
  expect((await request.put(API + '/e/' + code + '?by=organizer&org=1', { data: { data: { ...fin, finished: true } } })).ok()).toBe(true);
  expect((await request.put(API + '/e/' + code + '?by=organizer&org=1', { data: { data: { ...fin, clubName: 'Stone Creek' } } })).status()).toBe(409);
  const win = fin.rounds[0].matches[0].a.map((id: string) => fin.players.find((p: { id: string }) => p.id === id).name)[0] as string;
  const board = (c: string) => request.get(API + '/stats?test=1&club=' + encodeURIComponent(c)).then(r => r.json()).then(j => j.players.find((p: { k: string }) => p.k === win.toLowerCase()));
  expect(await board('Stone Creek')).toBeUndefined(); expect(await board(C)).toMatchObject({ games: 1, wins: 1, trophies: 1 });
  const past = (c: string) => request.get(API + '/past?test=1&club=' + encodeURIComponent(c)).then(r => r.json()).then(j => j.events.map((e: { code: string }) => e.code));
  expect(await past(C)).toContain(code); expect(await past('Stone Creek')).not.toContain(code);
  // UI: Overall + Past selectors (default Stone Creek)
  await page.goto(BASE + '#/stats'); await page.evaluate(() => localStorage.removeItem('pb:clubView')); await page.reload();
  await expect(page.getByLabel('Club')).toHaveValue('Stone Creek'); await expect(page.locator('tr', { hasText: win })).toHaveCount(0);
  await page.getByLabel('Club').selectOption(C); await expect(page.locator('tr', { hasText: win }).locator('.trophyCount')).toHaveText('🏆 x1');
  await page.screenshot({ path: 'e2e/shot-clubs-overall.png', fullPage: true });
  await page.locator('tr', { hasText: win }).click(); await expect(page.locator('.trophyList')).toContainText('Clubs e2e ' + tag); await expect(page.locator('.hist')).toHaveCount(1);
  await page.goto(BASE + '#/past'); await expect(page.getByLabel('Club')).toHaveValue(C); await expect(page.locator('.game', { hasText: 'Clubs e2e ' + tag })).toBeVisible();
  await page.screenshot({ path: 'e2e/shot-clubs-past.png', fullPage: true });
  await page.getByLabel('Club').selectOption('Stone Creek'); await expect(page.locator('.game', { hasText: 'Clubs e2e ' + tag })).toHaveCount(0);
  console.log('CLUBSCODE ' + code);
});

test('Test cleanup endpoint: admin key + test mode only', async ({ request }) => {
  expect((await request.post(API + '/test/cleanup?test=1')).status()).toBe(403);
  expect((await request.post(API + '/test/cleanup?test=1', { headers: { 'x-admin': 'not-the-key-0000000000' } })).status()).toBe(403);
  if (process.env.ADMIN_KEY) expect((await request.post(API + '/test/cleanup', { headers: { 'x-admin': process.env.ADMIN_KEY } })).status()).toBe(403); // not without test mode
});
