import { expect, type Page, test } from '@playwright/test';
import { coupon, seedCatalog } from './support';

test.beforeEach(async ({ request }) => seedCatalog(request));

// Precondition of TC-3 and TC-4: the cart contains one "Canvas Tote" (price 40.00).
async function cartWithOneTote(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add Canvas Tote to cart' }).click();
  await expect(page.getByRole('link', { name: 'Cart (1)' })).toBeVisible();
}

async function applyCoupon(page: Page, code: string) {
  await page.getByRole('link', { name: /^Cart/ }).click();
  await page.getByLabel('Coupon code').fill(code);
  await page.getByRole('button', { name: 'Apply' }).click();
}

test('valid coupon reduces the total', { tag: ['@TC-3'] }, async ({ page }) => {
  const { code } = coupon('SUMMER10');
  await cartWithOneTote(page);
  await test.step('1. Open the cart and apply the coupon', async () => {
    await applyCoupon(page, code!);
    await expect(page.getByTestId('discount')).toHaveText('-4.00');
    await expect(page.getByTestId('total')).toHaveText('36.00');
  });
  await test.step('2. Press "Place order"', async () => {
    await page.getByRole('button', { name: 'Place order' }).click();
    await expect(page.getByRole('heading', { name: 'Thank you for your order' })).toBeVisible();
    await expect(page.getByText(/^SHOP-\d{4}$/)).toBeVisible();
  });
});

test('expired coupon is rejected', { tag: ['@TC-4'] }, async ({ page }) => {
  const { code, expected_message } = coupon('OLD5');
  await cartWithOneTote(page);
  await test.step('1. Open the cart and apply the coupon', async () => {
    await applyCoupon(page, code!);
    await expect(page.getByRole('alert')).toHaveText(expected_message!);
    await expect(page.getByTestId('discount')).toHaveCount(0);
    await expect(page.getByTestId('total')).toHaveText('40.00');
  });
});
