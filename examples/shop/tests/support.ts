import { readFileSync } from 'node:fs';
import { type APIRequestContext, expect, test } from '@playwright/test';

const fixtures = new URL('../.indx-watch/fixtures/', import.meta.url);

/** FX-2: POST the catalog to the environment's seed hook (staging.toml `[hooks.seed]`). */
export async function seedCatalog(request: APIRequestContext): Promise<void> {
  const token = process.env.SHOP_SEED_TOKEN;
  const res = await request.post('/__test/seed', {
    data: JSON.parse(readFileSync(new URL('FX-2-catalog/catalog.json', fixtures), 'utf8')),
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  expect(res.ok(), `seed hook answered ${res.status()}`).toBe(true);
}

/** FX-1: one row of the coupon dataset, keyed by `code`. Records the row for the INDX Watch reporter. */
export function coupon(code: string): Record<string, string> {
  const [header = '', ...lines] = readFileSync(new URL('FX-1-coupons/coupons.csv', fixtures), 'utf8')
    .trim()
    .split('\n');
  const keys = header.split(',');
  const rows = lines.map((line) => Object.fromEntries(line.split(',').map((v, i) => [keys[i], v])));
  const row = rows.find((r) => r.code === code);
  if (!row) throw new Error(`FX-1 has no row ${code}`);
  test.info().annotations.push({ type: '_iw.fixture', description: `FX-1:${code}` });
  return row;
}

/** FX-3: the staging customer. The password comes from the environment, never from a file. */
export const customer = {
  username: /username = "(.+)"/.exec(
    readFileSync(new URL('FX-3-staging-customer/fixture.toml', fixtures), 'utf8'),
  )![1]!,
  password: process.env.SHOP_CUSTOMER_PASSWORD ?? 'demo-password',
};
