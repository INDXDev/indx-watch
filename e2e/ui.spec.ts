import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { ROOT, serve, shopCopy } from './helpers';

const SHOT = join(ROOT, '.indx-watch/fixtures/FX-2-evidence-screenshot/evidence.png');

test('manual run with a screenshot', { tag: ['@TC-4'] }, async ({ page }) => {
  const server = await serve(shopCopy());
  try {
    await test.step('1. open the manual runner for TC-8', async () => {
      await page.goto(`${server.url}#/tc/TC-8/run`);
      await expect(page.getByRole('group', { name: 'Result of step 1' })).toBeVisible();
      await expect(page.getByRole('group', { name: 'Result of step 2' })).toBeVisible();
    });
    await test.step('2. upload a screenshot, record steps and a fail verdict', async () => {
      await page.locator('input[type=file]').first().setInputFiles(SHOT);
      await expect(page.getByText('✓ evidence.png')).toBeVisible();
      await page.getByRole('group', { name: 'Result of step 1' }).getByText('Fail').click();
      await page.getByRole('group', { name: 'Result of step 2' }).getByText('Pass').click();
      await page.getByRole('group', { name: 'Your verdict' }).getByText('Fail').click();
      await page.getByLabel('Reason (required)').fill('The error message did not appear.');
      await page.getByRole('button', { name: 'Save result' }).click();
      await expect(page).toHaveURL(/#\/runs\/run_/);
      await expect(page.getByText('Tester (human)')).toBeVisible();
      await expect(page.locator('img[alt="evidence.png"]').first()).toBeVisible();
      await page.screenshot({ path: test.info().outputPath('run.png') });
    });
  } finally {
    server.stop();
  }
});

test('manual runner in Japanese', { tag: ['@TC-5'] }, async ({ page }) => {
  const dir = shopCopy();
  const server = await serve(dir);
  try {
    await test.step('1. switch the UI to Japanese and open the manual runner for TC-4', async () => {
      await page.goto(server.url);
      await page.getByRole('button', { name: /^Account:/ }).click();
      await page.getByRole('combobox', { name: 'Language' }).selectOption('ja');
      await page.goto(`${server.url}#/tc/TC-4/run`);
      const step = page.getByRole('group', { name: '手順 1 の結果' });
      await expect(step).toBeVisible();
      // the reviewed Japanese translation, with the quoted on-screen strings left in English
      await expect(page.getByText(/カートを開き、クーポン欄に/)).toBeVisible();
      await expect(page.getByText(/「This coupon has expired」と表示され/)).toBeVisible();
      await page.screenshot({ path: test.info().outputPath('runner-ja.png') });
    });
    await test.step('2. finish the run with "pass"', async () => {
      // the radio is visually hidden; click its label like a person would
      const pick = (group: string, name: string) =>
        page
          .getByRole('group', { name: group })
          .locator('label', { has: page.getByRole('radio', { name, exact: true }) })
          .click();
      await pick('手順 1 の結果', '合格');
      await pick('あなたの判定', '合格');
      await page.getByRole('button', { name: '結果を保存' }).click();
      await expect(page).toHaveURL(/#\/runs\/run_/);
      const id = /#\/runs\/(run_[0-9A-Z]+)/.exec(page.url())![1]!;
      const records = join(dir, '.indx-watch/runs/records');
      const file = readdirSync(records, { recursive: true, encoding: 'utf8' }).find((f) => f.includes(id))!;
      expect(JSON.parse(readFileSync(join(records, file), 'utf8'))).toMatchObject({ id, locale: 'ja' });
      await page.screenshot({ path: test.info().outputPath('run-ja.png') });
    });
  } finally {
    server.stop();
  }
});
