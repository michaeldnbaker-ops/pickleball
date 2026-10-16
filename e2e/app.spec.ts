import { test, expect, devices } from '@playwright/test';
test.use({ ...devices['iPhone 13'], browserName: 'chromium' });
const BASE = process.env.BASE || 'http://localhost:4173/';
// test-created games are flagged hidden so they never show in the public Join list or all-time stats
test.beforeEach(async ({ page }) => { await page.addInitScript(() => localStorage.setItem('pb:hidden', '1')); });
const startGame = async (page: import('@playwright/test').Page) => {
  await page.getByRole('button', { name: 'Create game 🏓' }).click();
  await page.getByRole('button', { name: '▶ Start game' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Start game' }).click();
};
test('organizer runs a round robin, player view sees it after refresh', async ({ page, browser }) => {
  page.on('dialog', d => d.accept());
  await page.goto(BASE);
  await page.getByText('Create a game').click();
  await page.getByPlaceholder('e.g. the gym').fill('Gym');
  await page.getByText('Next: Players').click();
  for (let i = 1; i <= 9; i++) { await page.getByPlaceholder('Name').fill('Player' + i); await page.getByLabel('DUPR (optional)').fill(String(3 + i / 10)); await page.getByText('Add new player').click(); }
  await expect(page.getByText('9 selected')).toBeVisible();
  await page.getByRole('button', { name: 'Next ›' }).click();
  await startGame(page);
  await expect(page.getByRole('heading', { name: /Round 1/ })).toBeVisible();
  await expect(page.locator('.match')).toHaveCount(2);
  await expect(page.getByText('Sitting out', { exact: true })).toBeVisible();
  const code = page.url().split('/e/')[1];
  // score both courts independently
  for (let c = 0; c < 2; c++) { const card = page.locator('.match').nth(c); for (let k = 0; k < 11; k++) await card.locator('.scorebox').first().getByText('+').click(); await card.locator('.scorebox').nth(1).locator('input').fill(String(5 + c)); await card.getByText('Save').click(); await expect(page.locator('.match').nth(c).locator('.final')).toBeVisible(); if (c === 0) await page.waitForTimeout(300); }
  await page.getByRole('button', { name: /Next: Round 2/ }).click();
  await expect(page.getByRole('heading', { name: /Round 2/ })).toBeVisible();
  await page.getByText('🏆 Standings').click();
  await expect(page.locator('tbody tr')).toHaveCount(9);
  // player phone
  const ctx = await browser.newContext({ ...devices['Pixel 7'] }); await ctx.addInitScript(() => localStorage.setItem('pb:hidden', '1')); const p2 = await ctx.newPage();
  await p2.goto(BASE + '#/e/' + code);
  await p2.getByText('🙋 Me').click();
  await p2.getByRole('button', { name: 'Player3', exact: true }).click();
  await expect(p2.getByText('Hi, Player3')).toBeVisible();
  await expect(p2.locator('.next')).toBeVisible();
  // organizer adds late player; player refreshes and sees him
  await page.getByText('⚙️ Manage').click();
  await page.getByPlaceholder('Name').fill('Latecomer'); await page.getByText('Add late player').click();
  await expect(page.getByText('Latecomer').first()).toBeVisible();
  await page.waitForTimeout(1500);
  await p2.getByLabel('Refresh').click();
  await p2.getByText('🏆 Standings').click();
  await expect(p2.getByText('Latecomer')).toBeVisible();
  const box = await page.locator('.tabs button').first().boundingBox(); expect(box!.height).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: 'e2e/shot-manage.png' });
  await page.getByText('🏓 Courts').click(); await page.screenshot({ path: 'e2e/shot-courts.png' });
  await p2.getByText('🙋 Me').click(); await p2.screenshot({ path: 'e2e/shot-me.png' });
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
  const names = ['Ann', 'Bob', 'Cat', 'Dan', 'Eve', 'Fay', 'Gus', 'Hal', 'Ivy'];
  for (const n of names) { await page.getByLabel('Player name').fill(n); await page.getByText('Add new player').click(); }
  await page.getByRole('button', { name: 'Next ›' }).click();
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
  await page.getByText('🙋 Me').click(); await page.getByRole('button', { name: meName, exact: true }).click();
  await page.getByText('🏓 Courts').click();
  await expect(page.locator('.match.mine')).toHaveCount(1);
  await expect(page.locator('.match.mine .tag')).toHaveText('You & partner');
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
  await page.getByText('🙋 Me').click();
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
test('play ahead locks a round; drop at 9 (replace) and 8 (void); re-add', async ({ page }) => {
  await setup(page, ['Ann', 'Bob', 'Cat', 'Dan', 'Eve', 'Fay', 'Gus', 'Hal', 'Ivy']);
  // play ahead: Court 1 of Round 3 finishes early
  await page.locator('.strip .dot').nth(2).click(); await expect(page.getByRole('heading', { name: 'Round 3 of 6' })).toBeVisible();
  const r3 = await roundNames(page);
  const c = page.locator('.match').first(); await c.getByLabel('Team A score').fill('11'); await c.getByLabel('Team B score').fill('9'); await c.getByText('Save score').click();
  await expect(page.getByText('Playing ahead · pairings locked 🔒')).toBeVisible(); await expect(c.locator('.final')).toBeVisible();
  await page.screenshot({ path: 'e2e/shot-playahead.png' });
  await page.getByText('Back to current round').click();
  // drop at 9 from Manage: out now, replaced by the sit-out
  const sitter = (await page.locator('.byeNames').textContent())!.trim();
  const victim1 = (await page.locator('.match').first().locator('.nameBtn').first().textContent())!.trim();
  await page.getByText('⚙️ Manage').click(); await page.getByText('🚑 Drop player').click();
  const sheet = page.getByRole('dialog'); await sheet.getByRole('button', { name: victim1, exact: true }).click();
  await expect(sheet.getByText('Out now')).toBeVisible(); await expect(sheet.getByText('player short')).toBeVisible();
  await expect(sheet.getByRole('button', { name: sitter, exact: true })).toHaveClass(/on/);
  await page.screenshot({ path: 'e2e/shot-drop-sheet.png' });
  await sheet.getByRole('button', { name: 'Drop ' + victim1 }).click();
  await expect(page.locator('.card', { hasText: victim1 }).locator('.wd')).toHaveText('withdrawn');
  await page.getByText('🏓 Courts').click();
  await expect(page.locator('.match').first()).toContainText(sitter); await expect(page.locator('.card.bye')).toHaveCount(0);
  // drop at 8 from a name on a card: no sit-outs left, so void the court
  const victim2 = (await page.locator('.match').nth(1).locator('.nameBtn').first().textContent())!.trim();
  await page.locator('.match').nth(1).getByRole('button', { name: 'Player ' + victim2 + ' options' }).click();
  const s2 = page.getByRole('dialog'); await expect(s2.getByText('Replace with a sit-out')).toHaveCount(0);
  await s2.getByText('Void Court 2').click(); await s2.getByRole('button', { name: 'Drop ' + victim2 }).click();
  await expect(page.locator('.match')).toHaveCount(1); await expect(page.locator('.card.bye')).toBeVisible();
  // future unscored rounds redrawn without both; locked round 3 unchanged
  await page.getByLabel('Next round').click(); await expect(page.getByRole('heading', { name: 'Round 2 of 6' })).toBeVisible();
  const r2 = await roundNames(page); expect(r2).not.toContain(victim1); expect(r2).not.toContain(victim2);
  await expect(page.locator('.match')).toHaveCount(1); await expect(page.locator('.card.bye .byeNames')).toBeVisible();
  await page.screenshot({ path: 'e2e/shot-after-drop.png' });
  await page.getByLabel('Next round').click(); expect(await roundNames(page)).toBe(r3);
  // standings keep withdrawn player; re-add returns him to upcoming rounds
  await page.getByText('🏆 Standings').click(); await expect(page.locator('tr', { hasText: victim1 }).locator('.wd')).toBeVisible();
  await page.getByText('⚙️ Manage').click(); await page.locator('.card', { hasText: victim2 }).getByText('↩ Re-add').click();
  await page.getByText('🏓 Courts').click(); await page.getByLabel('Next round').click();
  await page.getByText('🙋 Me').click(); await page.getByRole('button', { name: victim2, exact: true }).click();
  await expect(page.locator('.compact', { hasText: 'upcoming' }).first()).toBeVisible();
});
test('drop at 5 on one court: from next round on, 4 left play every round', async ({ page }) => {
  await setup(page, ['Ann', 'Bob', 'Cat', 'Dan', 'Eve'], 2, 4);
  const victim = (await page.locator('.match .nameBtn').first().textContent())!.trim();
  await page.locator('.match').first().getByRole('button', { name: 'Player ' + victim + ' options' }).click();
  const sh = page.getByRole('dialog'); await sh.getByText('From the next round on').click();
  await expect(sh.getByText('player short')).toHaveCount(0);
  await sh.getByRole('button', { name: 'Drop ' + victim }).click();
  await expect(page.locator('.match').first()).toContainText(victim); // finishes current round
  for (let i = 0; i < 3; i++) { await page.getByLabel('Next round').click(); await expect(page.getByRole('heading', { name: 'Round ' + (i + 2) + ' of 4' })).toBeVisible(); await expect.poll(() => roundNames(page)).not.toContain(victim); await expect(page.locator('.card.bye')).toHaveCount(0); }
});

const API = 'https://br-weathered-heart-b520ib6i-pbapi.compute.c-7.us-east-2.aws.neon.tech';
test('landing, Join list + empty state (mocked), time wheel', async ({ page }) => {
  await page.goto(BASE);
  await expect(page.locator('.landBtns button')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Create a game' })).toBeVisible(); await expect(page.getByRole('button', { name: 'Join a game' })).toBeVisible();
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
  await page.screenshot({ path: 'e2e/shot-join-empty.png' });
  await page.locator('.empty').getByRole('button', { name: 'Create a game' }).click();
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

test('sign-up lobby → start with 10 → late join → last round → stats', async ({ page, browser }) => {
  test.setTimeout(180000);
  const tag = Math.random().toString(36).slice(2, 6);
  await page.goto(BASE + '#/new'); await page.getByLabel('Event name').fill('Lobby ' + tag); await page.getByLabel('Place').fill('Stone Creek');
  await page.getByText('Next: Players').click(); await page.getByRole('button', { name: 'Next ›' }).click();
  await page.locator('.stepper').first().getByText('−').click(); // 2 courts
  for (let i = 0; i < 6; i++) await page.locator('.stepper').nth(1).getByText('−').click(); // 2 rounds
  await page.getByRole('button', { name: 'Create game 🏓' }).click();
  await expect(page.getByText('Signing up')).toBeVisible(); const code = page.url().split('/e/')[1].split('/')[0];
  // players sign up by name from the Join list
  const ctx = await browser.newContext({ ...devices['iPhone 13'] }); await ctx.addInitScript(() => localStorage.setItem('pb:hidden', '1')); const p2 = await ctx.newPage();
  await p2.goto(BASE + '#/join'); await p2.getByLabel('Have a code or link?').fill(code); await p2.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(p2.getByText('Who are you?')).toBeVisible();
  const names = Array.from({ length: 10 }, (_, i) => `${['Ann', 'Bob', 'Cat', 'Dan', 'Eve', 'Fay', 'Gus', 'Hal', 'Ivy', 'Jo'][i]}-${tag}`);
  for (const n of names) { await p2.getByLabel('Player name').fill(n); await p2.getByText('Join this game').click(); await expect(p2.getByText("You're in as")).toBeVisible(); if (n !== names[9]) { await p2.evaluate(c => localStorage.removeItem('pb:me:' + c), code); await p2.reload(); await expect(p2.getByText('Who are you?')).toBeVisible(); } }
  await expect(p2.getByText('10 joined')).toBeVisible();
  await p2.screenshot({ path: 'e2e/shot-lobby.png' });
  // a joined player (not the organizer) starts it, with a confirm step
  await p2.getByRole('button', { name: '▶ Start game' }).click();
  await expect(p2.getByRole('alertdialog')).toContainText('Start with 10 players?'); await p2.getByRole('alertdialog').getByRole('button', { name: 'Start game' }).click();
  await expect(p2.getByText('Hi, ' + names[9])).toBeVisible();
  await page.getByLabel('Refresh').click(); await expect(page.getByRole('heading', { name: 'Round 1 of 2' })).toBeVisible();
  await expect(page.locator('.match')).toHaveCount(2); await expect(page.locator('.byeNames')).toBeVisible();
  // late join after the start → slotted into upcoming rounds
  const p3 = await ctx.newPage(); await p3.goto(BASE + '#/e/' + code + '/join'); await p3.evaluate(c => localStorage.removeItem('pb:me:' + c), code); await p3.reload();
  await expect(p3.getByText('Who are you?')).toBeVisible(); await p3.getByLabel('Player name').fill('Late-' + tag); await p3.getByText('Join this event').click();
  await expect(p3.getByText('Hi, Late-' + tag)).toBeVisible(); await p3.waitForTimeout(1500); await p3.getByLabel('Refresh').click();
  await expect(p3.locator('.compact', { hasText: 'upcoming' })).toHaveCount(1);
  // score round 1, advance, score round 2 → last-round options
  await page.getByLabel('Refresh').click();
  const scoreAll = async () => { const n = await page.locator('.match').count(); for (let c = 0; c < n; c++) { const card = page.locator('.match').nth(c); await card.getByLabel('Team A score').fill('11'); await card.getByLabel('Team B score').fill(String(4 + c)); await card.getByText('Save score').click(); await expect(card.locator('.final')).toBeVisible(); } };
  await scoreAll(); await page.getByRole('button', { name: 'Next: Round 2 →' }).click(); await expect(page.getByRole('heading', { name: 'Round 2 of 2' })).toBeVisible();
  await scoreAll(); await expect(page.getByText("That's the last round.")).toBeVisible();
  await page.screenshot({ path: 'e2e/shot-last-round.png' });
  await page.getByRole('button', { name: '+1 round' }).click(); await expect(page.getByRole('button', { name: 'Next: Round 3 →' })).toBeVisible();
  // edit a score (stats must update, not duplicate)
  const c0 = page.locator('.match').first(); const winner = (await c0.locator('.side').first().locator('.nameBtn').first().textContent())!.trim();
  await c0.getByText('Edit score').click(); await c0.getByLabel('Team A score').fill('11'); await c0.getByLabel('Team B score').fill('9'); await c0.getByText('Save score').click(); await expect(c0.locator('.final')).toBeVisible();
  // End early from Manage
  await page.getByText('⚙️ Manage').click(); page.once('dialog', d => d.accept()); await page.getByRole('button', { name: '🏁 End early' }).click();
  await page.getByText('🏓 Courts').click(); await expect(page.getByText('Event finished')).toBeVisible();
  await page.getByText('🏆 Standings').click(); const gp = (await page.locator('tr', { hasText: winner }).first().locator('td').nth(4).textContent())!.trim();
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
  for (const n of ['Bo', 'Cy', 'Di', 'Ed']) { await page.getByLabel('Player name').fill(n); await page.getByLabel('DUPR (optional)').fill('3.5'); await page.getByText('Add new player').click(); }
  await expect(page.getByRole('button', { name: long })).toBeVisible();
  await page.getByRole('button', { name: 'Next ›' }).click(); await page.getByLabel('Balance matchups by DUPR').check();
  await page.getByRole('button', { name: 'Create game 🏓' }).click();
  await expect(page.getByText('5 joined')).toBeVisible();
  const chip = page.locator('.chip.static', { hasText: long }); await expect(chip).toHaveText(long);
  expect(await chip.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await expect(page.getByLabel('Player name')).toBeVisible();
  await page.screenshot({ path: 'e2e/shot-lobby-names.png', fullPage: true });
  await page.getByRole('button', { name: '▶ Start game' }).click(); await page.getByRole('alertdialog').getByRole('button', { name: 'Start game' }).click();
  await expect(page.locator('.match')).toHaveCount(1);
  const all = page.locator('.match .names div, .byeNames'); await expect(page.locator('.match, .card.bye').filter({ hasText: long })).toHaveCount(1);
  for (const el of await all.all()) expect(await el.evaluate(e => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: 'e2e/shot-longname-card.png' });
});

test('Mixed Doubles: organizer sets pairs in the lobby, pairs stay together', async ({ page }) => {
  await page.goto(BASE + '#/new'); await page.getByRole('radio', { name: /Mixed Doubles/ }).click(); await page.getByLabel('Place').fill('Gym');
  await page.getByText('Next: Players').click();
  for (const n of ['Ann', 'Bob', 'Cat', 'Dan']) { await page.getByLabel('Player name').fill(n); await page.getByText('Add new player').click(); }
  await expect(page.locator('select')).toHaveCount(0);
  await page.getByRole('button', { name: 'Next ›' }).click(); await page.getByRole('button', { name: 'Create game 🏓' }).click();
  const pb = page.locator('.pairs'); await pb.getByRole('button', { name: 'Ann', exact: true }).click(); await pb.getByRole('button', { name: 'Dan', exact: true }).click();
  await expect(pb.locator('.pairRow')).toHaveText(/Ann & Dan/);
  await page.screenshot({ path: 'e2e/shot-mixed-pairs.png' });
  await page.getByRole('button', { name: '▶ Start game' }).click(); await page.getByRole('alertdialog').getByRole('button', { name: 'Start game' }).click();
  const together = () => page.locator('.match .side .names').allTextContents().then(a => a.some(t => t.includes('Ann') && t.includes('Dan')));
  await expect(page.locator('.match')).toHaveCount(1); await expect.poll(together).toBe(true);
  await page.getByLabel('Next round').click(); await expect(page.getByRole('heading', { name: /Round 2/ })).toBeVisible(); await expect.poll(together).toBe(true);
});
