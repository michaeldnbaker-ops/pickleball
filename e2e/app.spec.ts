import { test, expect, devices } from '@playwright/test';
test.use({ ...devices['iPhone 13'], browserName: 'chromium' });
const BASE = process.env.BASE || 'http://localhost:4173/';
test('organizer runs a round robin, player view sees it after refresh', async ({ page, browser }) => {
  page.on('dialog', d => d.accept());
  await page.goto(BASE);
  await page.getByText('+ New Event').click();
  await page.getByPlaceholder('e.g. the gym').fill('Gym');
  await page.getByText('Next: Players').click();
  for (let i = 1; i <= 9; i++) { await page.getByPlaceholder('Name').fill('Player' + i); await page.getByPlaceholder('DUPR').fill(String(3 + i / 10)); await page.getByText('Add new player').click(); }
  await expect(page.getByText('9 selected')).toBeVisible();
  await page.getByRole('button', { name: 'Next ›' }).click();
  await page.getByRole('button', { name: 'Start Event 🏓' }).click();
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
  const ctx = await browser.newContext({ ...devices['Pixel 7'] }); const p2 = await ctx.newPage();
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
  await page.getByRole('button', { name: 'Start Event 🏓' }).click();
  const scoreAll = async () => { await expect(page.locator('.match').first()).toBeVisible(); const n = await page.locator('.match').count(); for (let c = 0; c < n; c++) { const card = page.locator('.match').nth(c); await card.locator('.scorebox input').first().fill('11'); await card.locator('.scorebox input').nth(1).fill('4'); await card.getByText('Save').click(); await expect(card.locator('.final')).toBeVisible(); } };
  await scoreAll(); await page.getByText('Start playoffs / finish').click();
  await expect(page.getByRole('heading', { name: 'Semifinals' })).toBeVisible(); await scoreAll();
  await page.getByText('Next playoff round').click(); await expect(page.getByRole('heading', { name: 'Final', exact: true })).toBeVisible(); await scoreAll();
  await page.getByText('Finish event').click(); await expect(page.getByText(/Champions:/)).toBeVisible();
});
test('warns before advancing with unscored courts; labels, typing, format highlight', async ({ page }) => {
  await page.goto(BASE + '#/new');
  await page.getByLabel('Event name').fill('Warn test');
  await page.getByLabel('Place').fill('Gym');
  await expect(page.getByLabel('Date & time')).toBeVisible();
  await page.getByRole('radio', { name: /Ladder/ }).click();
  await expect(page.getByRole('radio', { name: /Ladder/ })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('radio', { name: /Round Robin/ })).toHaveAttribute('aria-checked', 'false');
  await page.screenshot({ path: 'e2e/shot-format.png' });
  await page.getByText('Next: Players').click();
  for (let i = 1; i <= 8; i++) { await page.getByLabel('Player name').fill('W' + i); await page.getByText('Add new player').click(); }
  await page.getByRole('button', { name: 'Next ›' }).click();
  await page.getByRole('button', { name: 'Start Event 🏓' }).click();
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
  await page.getByRole('button', { name: 'Start Event 🏓' }).click();
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
  expect(preview.length).toBeGreaterThan(0); await expect(page.locator('.match .scorebox')).toHaveCount(0);
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
