import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { iw, serve, shopCopy } from './helpers';

// docs/spec/web.md#open-as-github-issue, docs/spec/integrations.md#github-issues
test('open a test case as a prefilled GitHub issue and link it back', { tag: ['@TC-27'] }, async ({
  page,
}) => {
  const dir = shopCopy();
  const issue = 'https://github.com/shop-co/shop/issues/42';
  const server = await serve(dir); // no [github] repo yet (and no remote in the copy): no button
  try {
    await test.step('1. without a repository the button is hidden', async () => {
      await page.goto(`${server.url}#/tc/TC-3`);
      await expect(page.getByRole('heading', { name: 'What this tests' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Open as GitHub issue' })).toBeHidden();
    });
  } finally {
    server.stop();
  }
  appendFileSync(join(dir, '.indx-watch/project.toml'), '\n[github]\nrepo = "shop-co/shop"\n');
  const withRepo = await serve(dir);
  try {
    await test.step('2. with [github] repo the button links to the prefilled new-issue page', async () => {
      await page.goto(`${withRepo.url}#/tc/TC-3`);
      const open = page.getByRole('link', { name: 'Open as GitHub issue' });
      await expect(open).toBeVisible();
      const url = new URL((await open.getAttribute('href'))!);
      expect(url.origin + url.pathname).toBe('https://github.com/shop-co/shop/issues/new');
      expect(url.searchParams.get('template')).toBe('indx-watch-test-failure.yml');
      expect(url.searchParams.get('title')).toBe('TC-3: Valid coupon reduces the total');
      expect(url.searchParams.get('keys')).toContain('TC-3');
      await page.screenshot({ path: test.info().outputPath('issue-button.png') });
    });
    await test.step('3. pasting the issue URL shows the command that links it', async () => {
      // the page stays here: the new-issue page is the person's to submit (the link opens in another tab)
      await page
        .getByRole('link', { name: 'Open as GitHub issue' })
        .evaluate((a) => a.removeAttribute('target'));
      await page
        .getByRole('link', { name: 'Open as GitHub issue' })
        .evaluate((a) => a.addEventListener('click', (e) => e.preventDefault()));
      await page.getByRole('link', { name: 'Open as GitHub issue' }).click();
      await page.getByLabel('Paste the issue URL').fill(issue);
      await expect(page.getByText(`iw issue TC-3 --link ${issue}`)).toBeVisible();
    });
    await test.step('4. after the command, the page shows the related issue', async () => {
      const r = iw(['issue', 'TC-3', '--link', issue], { cwd: dir });
      expect(r.code, r.stderr).toBe(0);
      const related = page.getByRole('link', { name: 'Related issue #42' });
      // the server notices the changed file a moment later
      await expect(async () => {
        await page.reload();
        await expect(related).toHaveAttribute('href', issue, { timeout: 1500 });
      }).toPass();
      await page.screenshot({ path: test.info().outputPath('issue-related.png') });
    });
  } finally {
    withRepo.stop();
  }
});
