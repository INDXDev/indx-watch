# Shop: the INDX Watch example project

`examples/shop` is the one sample project used by the INDX Watch docs and tests. It has four parts:

| Path           | What it is                                                                                                                              |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `app/`         | A tiny web shop (Node, no dependencies): product list, search, cart with coupons, orders, sign-in and product reviews with photos.      |
| `tests/`       | Playwright tests for the shop. Each test is tagged with the test case it implements (`@TC-3`).                                          |
| `.indx-watch/` | The bundle: features, use cases, acceptance criteria, test cases, fixtures, the `staging` environment, the `v1.2.0` release and a plan. |
| `store/`       | Sample results used by the docs and the committed report.                                                                               |

## Run the app

```bash
node examples/shop/app/server.mjs        # or: pnpm --filter shop start
```

Open <http://localhost:4173> (set `PORT` to change the port). It is the `staging` environment in `.indx-watch/environments/staging.toml`.

| Environment variable     | Default         | Purpose                                                                                                                                         |
| ------------------------ | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                   | `4173`          | Port to listen on                                                                                                                               |
| `SHOP_CUSTOMER_PASSWORD` | `demo-password` | Password of `casey@shop.test` (fixture FX-3). The default exists only so the local demo works out of the box; set your own value anywhere else. |
| `SHOP_SEED_TOKEN`        | unset           | When set, `POST /__test/seed` requires `Authorization: Bearer <token>`                                                                          |

State lives in memory. At start the app loads the FX-2 catalog. `POST /__test/seed` with the FX-2 JSON (`products`, `coupons`, `customers`) resets products, coupons, customers, reviews and the order counter (orders restart at `SHOP-1001`). This is the `[hooks.seed]` hook of the `staging` environment.

## Run the tests

```bash
cd examples/shop
npx playwright install chromium          # once
npx playwright test                      # starts the app through `webServer`
npx playwright test --grep "@TC-3(\s|$)" # one test case
```

- `IW_REPORTER=0` runs without the INDX Watch reporter (only the `list` reporter).
- `PW_CHROMIUM_PATH=/path/to/chrome` uses an already installed Chromium instead of the one from `npx playwright install`.
- `SHOP_BASE_URL=https://…` runs against an app that is already running instead of starting one.

With the reporter enabled (the default), every tagged test is recorded as a run of its test case in the result store configured in `.indx-watch/project.toml`. See [integrations](../../docs/spec/integrations.md#playwright-reporter).

## How the tests map to `.indx-watch`

| Test file                | Test cases                                   | Fixtures                                      |
| ------------------------ | -------------------------------------------- | --------------------------------------------- |
| `tests/catalog.spec.ts`  | `@TC-1` product list, `@TC-2` search         | FX-2 (seeded before each test)                |
| `tests/coupon.spec.ts`   | `@TC-3` valid coupon, `@TC-4` expired coupon | FX-1 rows `SUMMER10` / `OLD5`, FX-2           |
| `tests/checkout.spec.ts` | `@TC-5` place order                          | FX-2                                          |
| `tests/sign-in.spec.ts`  | `@TC-7` sign in                              | FX-3 (password from `SHOP_CUSTOMER_PASSWORD`) |

- **Tags are the link.** `{ tag: ['@TC-3'] }` ties a test to `TC-3`; the test case lists the file in `[automation] files`.
- **Steps match by number.** `test.step('1. …')` reports the result of step 1 of the test case.
- **Fixtures come from the bundle.** `tests/support.ts` posts `fixtures/FX-2-catalog/catalog.json` to the seed hook, reads coupon rows from `fixtures/FX-1-coupons/coupons.csv` (and records the chosen row as an `_iw.fixture` annotation) and takes the username from FX-3.
- **Manual test cases** (`TC-6` on a phone, `TC-8` wrong password, `TC-9` review photo) have no Playwright test. People run them in the browser runner against the same app.
