import { expect, test } from '@playwright/test';
import { seedCatalog } from './support';

test.beforeEach(async ({ request }) => seedCatalog(request));

test('placing an order shows a confirmation and empties the cart', { tag: ['@TC-5'] }, async ({ page }) => {
  await page.goto('/');
  await test.step('1. Add "Enamel Mug" to the cart, open the cart and press "Place order"', async () => {
    await page.getByRole('button', { name: 'Add Enamel Mug to cart' }).click();
    await page.getByRole('link', { name: 'Cart (1)' }).click();
    await page.getByRole('button', { name: 'Place order' }).click();
    await expect(page.getByRole('heading', { name: 'Thank you for your order' })).toBeVisible();
    await expect(page.getByText(/^SHOP-\d{4}$/)).toBeVisible();
  });
  await test.step('2. Open the cart again', async () => {
    await page.getByRole('link', { name: 'Cart', exact: true }).click();
    await expect(page.getByText('Your cart is empty')).toBeVisible();
  });
});
