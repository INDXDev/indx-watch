import { expect, test } from '@playwright/test';
import { seedCatalog } from './support';

test.beforeEach(async ({ request }) => seedCatalog(request));

test('product list shows names and prices', { tag: ['@TC-1'] }, async ({ page }) => {
  await test.step('1. Open the home page', async () => {
    await page.goto('/');
    const products = page.getByRole('list', { name: 'Products' }).getByRole('listitem');
    await expect(products).toHaveCount(3);
    await expect(products.filter({ hasText: 'Canvas Tote' })).toContainText('40.00');
    await expect(products.filter({ hasText: 'Enamel Mug' })).toContainText('18.00');
    await expect(products.filter({ hasText: 'Wool Cap' })).toContainText('25.00');
  });
});

test('search filters products by name', { tag: ['@TC-2'] }, async ({ page }) => {
  await page.goto('/');
  await test.step('1. Type "mug" in the search box', async () => {
    await page.getByLabel('Search').fill('mug');
    const products = page.getByRole('list', { name: 'Products' }).getByRole('listitem');
    await expect(products).toHaveCount(1);
    await expect(products).toContainText('Enamel Mug');
  });
});
