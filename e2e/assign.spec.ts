import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { serve, shopCopy } from './helpers';

// docs/spec/web.md#home (assignee board), docs/spec/concepts.md#assignment-and-automation-mix
const PLAN = '.indx-watch/plans/PLAN-1-v1-2-0-regression.toml';

/** Who has which item in the plan file of the copy. */
const onDisk = (dir: string) =>
  Object.fromEntries(
    [
      ...readFileSync(join(dir, PLAN), 'utf8').matchAll(/test_case = "(TC-\d+)"(?:\nassignee = "([^"]+)")?/g),
    ].map((m) => [m[1], m[2]]),
  );

test('see who has what and hand items out', { tag: ['@TC-19'] }, async ({ page }) => {
  const dir = shopCopy();
  const project = join(dir, '.indx-watch/project.toml');
  writeFileSync(project, readFileSync(project, 'utf8').replace(/^mode = "git"/m, 'mode = "workspace"'));
  const server = await serve(dir, { IW_ACTOR: 'alex@shop.test', IW_ACTOR_NAME: 'Alex' });
  try {
    const board = page.getByRole('list', { name: 'Who has what' });
    await test.step('1. The board lists each assignee with a count and the mix line', async () => {
      await page.goto(server.url);
      await page.getByText('Release details').click();
      await expect(board.getByRole('listitem')).toHaveCount(4);
      await expect(board.getByRole('listitem').first()).toContainText('ci');
      await expect(board.getByRole('listitem').first()).toContainText('4 done');
      await expect(page.getByText('Run by: people 2 · CI 4 · agents 1')).toBeVisible();
      await page.locator('#plan').screenshot({ path: test.info().outputPath('board.png') });
    });
    await test.step('2. Select two items and assign them to Kim', async () => {
      await page.getByLabel('Select TC-8').check();
      await page.getByLabel('Select TC-9').check();
      await page.getByLabel('Assign to').fill('kim@shop.test');
      await page.getByRole('button', { name: 'Assign', exact: true }).click();
      await expect(board.getByRole('listitem').filter({ hasText: 'kim@shop.test' })).toContainText('2');
      expect(onDisk(dir)).toMatchObject({ 'TC-8': 'kim@shop.test', 'TC-9': 'kim@shop.test' });
    });
    await test.step('3. Give back TC-6, filter to unassigned items, take it', async () => {
      await page.getByRole('button', { name: 'Give back' }).click();
      await expect(board.getByRole('listitem').filter({ hasText: 'Unassigned' })).toContainText('1');
      await page.getByLabel('Unassigned only').check();
      await expect(page.getByRole('row', { name: /TC-6/ })).toBeVisible();
      await expect(page.getByRole('row', { name: /TC-8/ })).toBeHidden();
      await page.getByRole('button', { name: 'Take' }).click();
      await expect(page.getByRole('row', { name: /TC-6/ })).toBeHidden(); // no longer unassigned
      await page.getByLabel('Unassigned only').uncheck();
      await expect(page.getByRole('row', { name: /TC-6/ })).toContainText('alex@shop.test');
      expect(onDisk(dir)['TC-6']).toBe('alex@shop.test');
    });
    await test.step('4. Split by weight: preview, then apply', async () => {
      await page.getByRole('button', { name: 'Split…' }).click();
      const dialog = page.getByRole('dialog', { name: 'Split between people' });
      await dialog.getByLabel('Who and weight').fill('alex@shop.test:2,sam@shop.test:1,agent:claude:1');
      await dialog.getByRole('button', { name: 'Preview' }).click();
      await expect(dialog.getByText(/to change, 0 left unassigned/)).toBeVisible();
      await dialog.getByRole('button', { name: 'Apply split' }).click();
      await expect(dialog).toBeHidden();
      const row = (who: string) => board.getByRole('listitem').filter({ hasText: who });
      await expect(row('alex@shop.test')).toContainText('3');
      await expect(row('sam@shop.test')).toContainText('2');
      await expect(row('agent:claude')).toContainText('2');
      expect(onDisk(dir)).toMatchObject({
        'TC-3': 'alex@shop.test',
        'TC-7': 'sam@shop.test',
        'TC-5': 'agent:claude',
      });
    });
  } finally {
    server.stop();
  }
});
