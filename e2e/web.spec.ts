import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { serve, shopCopy } from './helpers';

// docs/spec/web.md: Home, List and Focus, Focus runner sessions, the CLI panel, bilingual content
test('step through tests and run a session', { tag: ['@TC-12'] }, async ({ page, context }) => {
  const server = await serve(shopCopy());
  let session: string[] = [];
  try {
    await test.step('1. Home → "Start testing" opens the runner with a session', async () => {
      await page.goto(server.url);
      await expect(page.getByRole('heading', { name: 'Your queue' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Recent activity' })).toBeVisible();
      await expect(page.getByText('Release details')).toBeVisible();
      await expect(page.getByRole('cell', { name: 'Every P0 test passes' })).toBeHidden(); // gate checks sit in details
      await page.getByRole('link', { name: /Start testing/ }).click();
      await expect(page).toHaveURL(/#\/tc\/TC-\d+\/run\?session=TC-\d+%2CTC-\d+/);
      session = decodeURIComponent(/session=([^&]+)/.exec(page.url())![1]!).split(',');
      expect(page.url()).toContain(`#/tc/${session[0]}/run`);
      await expect(page.getByText(/Test 1 of \d/)).toBeVisible();
      await page.screenshot({ path: test.info().outputPath('session.png') });
    });
    await test.step('2. "Save and next" opens the next test case of the session', async () => {
      await expect(page.getByRole('group', { name: 'Result of step 1' })).toBeVisible();
      const save = page.getByRole('button', { name: 'Save and next' });
      // P passes the open step and opens the next one, then the Result block
      for (let i = 0; i < 10 && !(await save.isVisible()); i++) await page.keyboard.press('p');
      await save.click();
      await expect(page).toHaveURL(new RegExp(`#/tc/${session[1]}/run\\?session=`));
      await expect(page.getByText(/Test 2 of \d/)).toBeVisible();
    });
    await test.step('3. Focus view: → and ← move between test cases; List switches back', async () => {
      await page.goto(`${server.url}#/tc/TC-3`);
      await expect(page.getByText(/4 of \d/)).toBeVisible(); // spec tree order: TC-1, TC-2, TC-10 (UC-1), TC-3
      await page.keyboard.press('ArrowRight');
      await expect(page).toHaveURL(/#\/tc\/TC-4$/);
      await expect(page.getByText(/5 of \d/)).toBeVisible();
      await page.keyboard.press('ArrowLeft');
      await expect(page).toHaveURL(/#\/tc\/TC-3$/);
      await page.getByRole('link', { name: 'List' }).click();
      await expect(page).toHaveURL(/#\/tests$/);
    });
    await test.step('the CLI panel copies the clone command for this project', async () => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await page.getByRole('button', { name: 'Use it from your terminal' }).click();
      await page.getByRole('button', { name: /^Copy npx indx-watch clone / }).click();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
        'npx indx-watch clone file://../store',
      );
    });
    await test.step('in Japanese, titles come from [i18n.ja] and machine translations are marked', async () => {
      await page.evaluate(() => localStorage.setItem('indx-watch.locale', 'ja'));
      await page.goto(`${server.url}#/`);
      await page.reload();
      await expect(page.getByRole('heading', { name: /クーポンとサインイン/ })).toBeVisible(); // release title
      await expect(
        page.getByRole('link', { name: /誤ったパスワード|レビュー写真|確認ページ/ }).first(),
      ).toBeVisible();
      await page.goto(`${server.url}#/tc/TC-3`);
      await expect(page.getByRole('heading', { name: /有効なクーポンで合計が下がる/ })).toBeVisible();
      await page.getByRole('button', { name: '機械翻訳' }).click();
      await expect(page.getByRole('heading', { name: /Valid coupon reduces the total/ })).toBeVisible();
    });
  } finally {
    server.stop();
  }
});

test('declare who is testing', { tag: ['@TC-13'] }, async ({ page }) => {
  const dir = shopCopy();
  const server = await serve(dir);
  try {
    await test.step('1. "Not you?" stores the tester in a cookie', async () => {
      await page.goto(server.url);
      await page.getByRole('button', { name: /^Account:/ }).click();
      await page.getByRole('button', { name: /Not you\?/ }).click();
      await page.getByLabel('Name').fill('Sam');
      await page.getByLabel('Email').fill('sam@shop.test');
      await page.getByRole('button', { name: 'Save' }).click();
      await page.getByRole('button', { name: /^Account: Sam/ }).click();
      await expect(page.getByText('Declared in this browser (unverified)')).toBeVisible();
    });
    await test.step('2. a manual run is recorded as the declared tester', async () => {
      await page.goto(`${server.url}#/tc/TC-9/run`);
      await expect(page.getByRole('group', { name: 'Result of step 1' })).toBeVisible();
      await page.keyboard.press('p');
      await expect(page.getByRole('group', { name: 'Result of step 2' })).toBeVisible();
      await page.keyboard.press('p');
      await page.getByRole('button', { name: 'Save result' }).click();
      await expect(page).toHaveURL(/#\/runs\/run_/);
      await expect(page.getByText('Sam').first()).toBeVisible();
      const id = /#\/runs\/(run_[0-9A-Z]+)/.exec(page.url())![1]!;
      const records = join(dir, '.indx-watch/runs/records');
      const file = readdirSync(records, { recursive: true, encoding: 'utf8' }).find((f) => f.includes(id))!;
      const run = JSON.parse(readFileSync(join(records, file), 'utf8'));
      expect(run.actor).toEqual({ kind: 'human', id: 'sam@shop.test', name: 'Sam', via: 'browser' });
    });
  } finally {
    server.stop();
  }
});

// docs/spec/web.md#test-case-page (dogfood test cases for it come with T-408)
test('one-page test case with the manual run in place', async ({ page }) => {
  const dir = shopCopy();
  const server = await serve(dir);
  try {
    await test.step('1. TC-9 reads top to bottom; its photo card offers the download and names the upload step', async () => {
      await page.goto(`${server.url}#/tc/TC-9`);
      const headings = page.getByRole('heading', { level: 2 });
      await expect(headings).toHaveText(['What this tests', 'Before you start', 'Steps (2)', 'Result']);
      await expect(page.getByRole('link', { name: /Open http:\/\/localhost:4173\/sign-in/ })).toBeVisible();
      const card = page.locator('.data-card', { hasText: 'Review photo' });
      await expect(card).toContainText('Download this file, then attach it in this step');
      await expect(card).toContainText('Step 2: Attach the file from FX-4');
      const download = card.getByRole('link', { name: /Download review-photo\.png/ });
      const res = await page.request.get(new URL((await download.getAttribute('href'))!, server.url).href);
      expect(res.status()).toBe(200);
      expect(res.headers()['content-type']).toBe('image/png');
    });
    await test.step('2. "Run manually" on TC-3 opens the runner without changing the URL', async () => {
      await page.goto(`${server.url}#/tc/TC-3`);
      await page.getByRole('button', { name: /Run manually/ }).click();
      await expect(page.getByRole('group', { name: 'Result of step 1' })).toBeVisible();
      expect(new URL(page.url()).hash).toBe('#/tc/TC-3');
      await expect(page.getByRole('heading', { name: 'Before you start' })).toBeVisible();
    });
    await test.step('3. a fail with an unticked check asks for a note; ticking every check suggests pass', async () => {
      await page.getByRole('checkbox', { name: /The discount line shows/ }).check();
      await page.getByRole('group', { name: 'Result of step 1' }).getByText('Fail').click();
      const next = page.getByRole('button', { name: /Next step/ });
      await expect(next).toBeDisabled();
      await page.getByLabel(/Note for step 1 \(required\)/).fill('The total stayed at 40.00.');
      await next.click();
      await page.getByRole('checkbox', { name: /confirmation page opens/ }).check();
      await page.getByRole('checkbox', { name: /order number/ }).check();
      await expect(page.getByText('Every check holds, so this step passes.')).toBeVisible();
      await next.click();
      await page.getByLabel('Reason (required)').fill('The discount was not applied.');
      await page.getByRole('button', { name: /^Save/ }).click();
      await expect(page).not.toHaveURL(/#\/tc\/TC-3$/);
      const records = join(dir, '.indx-watch/runs/records');
      const runs = readdirSync(records, { recursive: true, encoding: 'utf8' })
        .filter((f) => f.endsWith('.json'))
        .map((f) => JSON.parse(readFileSync(join(records, f), 'utf8')))
        .filter((r) => r.kind === 'run' && r.test_case.key === 'TC-3' && r.source === 'manual');
      expect(runs).toHaveLength(1);
      expect(runs[0].steps).toEqual([
        { index: 1, status: 'fail', note: 'The total stayed at 40.00.', checks: [true, false] },
        { index: 2, status: 'pass', checks: [true, true] },
      ]);
    });
  } finally {
    server.stop();
  }
});
