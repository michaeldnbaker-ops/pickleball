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
  await expect(page.getByText('Round 1')).toBeVisible();
  await expect(page.locator('.match')).toHaveCount(2);
  await expect(page.getByText('Sitting out:')).toBeVisible();
  const code = page.url().split('/e/')[1];
  // score both courts independently
  for (let c = 0; c < 2; c++) { const card = page.locator('.match').nth(c); for (let k = 0; k < 11; k++) await card.locator('.scorebox').first().getByText('+').click(); await card.locator('.scorebox').nth(1).locator('input').fill(String(5 + c)); await card.getByText('Save').click(); await expect(page.locator('.match').nth(c).locator('.score b')).toBeVisible(); if (c === 0) await page.waitForTimeout(300); }
  await page.getByRole('button', { name: /Next: Round 2/ }).click();
  await expect(page.getByText('Round 2')).toBeVisible();
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
  const scoreAll = async () => { await expect(page.locator('.match').first()).toBeVisible(); const n = await page.locator('.match').count(); for (let c = 0; c < n; c++) { const card = page.locator('.match').nth(c); await card.locator('.scorebox input').first().fill('11'); await card.locator('.scorebox input').nth(1).fill('4'); await card.getByText('Save').click(); await expect(card.locator('.score b')).toBeVisible(); } };
  await scoreAll(); await page.getByText('Start playoffs / finish').click();
  await expect(page.getByText('Semifinals')).toBeVisible(); await scoreAll();
  await page.getByText('Next playoff round').click(); await expect(page.getByText('Final', { exact: true })).toBeVisible(); await scoreAll();
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
  await c1.getByText('Save').click(); await expect(c1.locator('.score b')).toHaveText('11–8');
  let native = false; page.on('dialog', d => { native = true; d.dismiss(); });
  await page.getByRole('button', { name: /Next: Round 2/ }).click();
  const sheet = page.getByRole('alertdialog');
  await expect(sheet).toContainText('Court 2');
  await page.screenshot({ path: 'e2e/shot-warning.png' });
  await sheet.getByText('Go back and enter scores').click();
  await expect(sheet).toHaveCount(0); await expect(page.getByText('Round 1', { exact: false })).toBeVisible();
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
