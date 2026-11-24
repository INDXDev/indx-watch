/**
 * Excerpts shown on the page, copied from examples/shop (the project's only sample). Keep them in step
 * with the files they quote; lines left out are marked with "# …" or "// …".
 */

export const TOML_PATH = '.indx-watch/specs/FEAT-2-checkout/UC-2-guest-applies-coupon/TC-3-valid-coupon.toml';

export const TOML_TC3 = `#:schema https://raw.githubusercontent.com/INDXDev/indx-watch/main/schemas/v1/test-case.json

key = "TC-3"
title = "Valid coupon reduces the total"
status = "ready"
covers = ["AC-2.1"]
mode = "playwright"
purpose = "Coupons let shoppers pay less. This test proves that a valid code lowers the cart total by its discount."
start = "/cart"

[[fixtures]]
ref = "FX-1"
rows = ["SUMMER10"]
use = "enter"
note = "Type this code in the coupon field in step 1."

[[steps]]
instruction = "Open the cart and enter {{FX-1.code}} in the coupon field, then press \\"Apply\\"."
expected = "The discount line shows \\"-4.00\\" and the total is \\"36.00\\"."
checks = ["The discount line shows \\"-4.00\\".", "The total is \\"36.00\\"."]
evidence = ["screenshot"]

[steps.i18n.ja]
instruction = "カートを開き、クーポン欄に {{FX-1.code}} を入力して「Apply」を押す。"
checks = ["割引行に「-4.00」と表示される。", "合計が「36.00」になる。"]
# …

[automation]
files = ["examples/shop/tests/coupon.spec.ts"]`;

export const PW_PATH = 'examples/shop/tests/coupon.spec.ts';

export const PW_TC3 = `test('valid coupon reduces the total', { tag: ['@TC-3'] }, async ({ page }) => {
  const { code } = coupon('SUMMER10'); // read from fixture FX-1
  await cartWithOneTote(page);
  await test.step('1. Open the cart and apply the coupon', async () => {
    await applyCoupon(page, code!);
    await expect(page.getByTestId('discount')).toHaveText('-4.00');
    await expect(page.getByTestId('total')).toHaveText('36.00');
  });
  // …
});

// playwright.config.ts
reporter: [['list'], ['indx-watch/playwright', { environment: 'staging' }]],`;

export const STATUS_CMD = 'iw status --release v1.2.0 --json';

export const STATUS_JSON = `{
  "ok": true,
  "command": "status",
  "data": {
    "scope": { "release": "v1.2.0", "environment": null },
    "gate": {
      "passed": false,
      "checks": [
        { "key": "p0_coverage", "passed": true, "actual": "6/6", "expected": "≥ 1.00" },
        { "key": "p0_all_pass", "passed": false, "actual": "5/6", "expected": "6/6",
          "items": ["TC-8"] }
      ]
    },
    "coverage": { "covered": 8, "total": 9, "ratio": 0.889 },
    "useCases": [ { "key": "UC-4", "priority": "P0", "status": "fail", "done": false } ]
  }
}`;

/** The draft the agent writes in the demo's first chapter (a new test case for the shop's coupon flow). */
export const TC11_PATH = 'specs/FEAT-2-checkout/UC-2-guest-applies-coupon/TC-11-unknown-coupon.toml';

export const TOML_TC11 = `id = "tc_01JG7K2P9W4N6R8T0V3X5Z7B9D"
key = "TC-11"
title = "Unknown coupon is refused"
status = "draft"
origin = "ai"
covers = ["AC-2.3"]
mode = "playwright"
purpose = "Shoppers mistype codes. This test proves that a code that does not exist is refused and the total does not change."
start = "/cart"

[[steps]]
instruction = "Enter \\"NOPE42\\" in the coupon field and press \\"Apply\\"."
expected = "\\"This coupon is not valid\\" appears and the total stays \\"40.00\\"."
checks = ["\\"This coupon is not valid\\" appears.", "The total is \\"40.00\\"."]
evidence = ["screenshot"]

[automation]
files = ["examples/shop/tests/coupon.spec.ts"]`;

/** The CI log of the demo's second chapter: Playwright's list reporter, then the indx-watch reporter. */
export const CI_LOG = [
  '$ npx playwright test',
  'Running 7 tests using 4 workers',
  '  ✓  1 [chromium] › catalog.spec.ts:6:5 › product list shows names and prices @TC-1 (812ms)',
  '  ✓  2 [chromium] › catalog.spec.ts:17:5 › search filters products by name @TC-2 (744ms)',
  '  ✓  3 [chromium] › coupon.spec.ts:19:5 › valid coupon reduces the total @TC-3 (1.1s)',
  '  ✓  4 [chromium] › coupon.spec.ts:34:5 › expired coupon is rejected @TC-4 (958ms)',
  '  ✓  5 [chromium] › coupon.spec.ts:46:5 › unknown coupon is refused @TC-11 (902ms)',
  '  ✓  6 [chromium] › checkout.spec.ts:6:5 › placing an order shows a confirmation… @TC-5 (1.4s)',
  '  ✓  7 [chromium] › sign-in.spec.ts:6:5 › sign in with valid credentials @TC-7 (688ms)',
  '  7 passed (6.2s)',
  '[indx-watch] 7 run(s) to .indx-watch/runs: TC-1 pass, TC-2 pass, TC-3 pass, TC-4 pass, TC-11 pass, TC-5 pass, TC-7 pass',
  '[indx-watch] pushed 7 record(s), 7 blob(s) to s3://shop-watch as github:alex',
  '$ npx indx-watch status --release v1.2.0',
  'Release v1.2.0 · environment any · gate FAILED',
  '  ok   p0_coverage: 7/7 (expected ≥ 1.00)',
  '  FAIL p0_all_pass: 6/7 (expected 7/7)',
];
