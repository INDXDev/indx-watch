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
