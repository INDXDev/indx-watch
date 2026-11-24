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
