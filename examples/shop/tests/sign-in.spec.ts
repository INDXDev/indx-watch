import { expect, test } from '@playwright/test';
import { customer, seedCatalog } from './support';

test.beforeEach(async ({ request }) => seedCatalog(request));

test('sign in with valid credentials', { tag: ['@TC-7'] }, async ({ page }) => {
  await page.goto('/');
  await test.step('1. Open "Sign in", enter the username and password, and press "Sign in"', async () => {
    await page.getByRole('banner').getByRole('link', { name: 'Sign in' }).click();
    await page.getByLabel('Email').fill(customer.username);
    await page.getByLabel('Password').fill(customer.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('banner')).toContainText('Welcome back, Casey');
  });
});
