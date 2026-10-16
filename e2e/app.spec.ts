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
  for (let i = 0; i < 7; i++) await page.locator('.stepper').nth(1).getByText('−').click();
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
  await expect(sheet).toContainText('Court 2');
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
  await page.locator('.stepper').first().getByText('−').click(); // 2 courts → 4 rotate out each round
  for (let i = 0; i < 2; i++) await page.locator('.stepper').nth(1).getByText('−').click(); // 6 rounds
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
  for (let i = 0; i < courtsMinus; i++) await page.locator('.stepper').first().getByText('−').click();
  for (let i = 0; i < 8 - rounds; i++) await page.locator('.stepper').nth(1).getByText('−').click();
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
  await page.locator('.stepper').first().getByText('−').click(); // 2 courts
  for (let i = 0; i < 6; i++) await page.locator('.stepper').nth(1).getByText('−').click(); // 2 rounds
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
  const listed = await (await p3.request.get(API + '/events?test=1&from=2000-01-01T00:00')).json(); expect(listed.events.map((e: { code: string }) => e.code)).not.toContain(code);
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
  await page.getByRole('button', { name: 'Next ›' }).click(); await page.getByLabel('Balance matchups by DUPR').check();
  await page.getByRole('button', { name: 'Create game' }).click();
  await expect(page.getByText('8 joined')).toBeVisible();
  const chip = page.locator('.chip.static', { hasText: long }); await expect(chip).toHaveText(long);
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
  await expect(p.getByText("You're in as")).toBeVisible(); await expect(p.locator('.chip.static', { hasText: 'Flow-' + tag })).toBeVisible();
  await p.screenshot({ path: 'e2e/shot-flow-3-joined.png' });
});
