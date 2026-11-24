---
title: "Playwright"
description: "Link Playwright tests to test cases with @TC-n tags and record their results with the reporter."
---

# Playwright

The `indx-watch/playwright` reporter turns Playwright results into INDX Watch runs, next to manual results, with the commit, the CI job, the fixture versions and screenshots. The link between a test and a test case is a tag. The reporter's behavior and options are specified in [integrations](../spec/integrations.md#playwright-reporter); this guide shows how to set it up, using [`examples/shop`](https://github.com/INDXDev/indx-watch/tree/main/examples/shop).

## Install

```bash
npm install --save-dev indx-watch @playwright/test
```

You need an `.indx-watch/` bundle in the repository ([quickstart](./quickstart.md)).

## Configure the reporter

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  reporter: [['list'], ['indx-watch/playwright', { environment: 'staging' }]],
  use: { baseURL: 'http://localhost:4173', screenshot: 'on', trace: 'retain-on-failure' },
});
```

- Keep your usual reporter (`list`, `html`) in front; the INDX Watch reporter is added, not a replacement.
- `screenshot: 'on'` gives every run screenshot evidence. The gate's `require_evidence` accepts an `assert` judgement as proof for passing P0 test cases, but screenshots make reports far more useful.
- Options (`dir`, `release`, `environment`, `evidence`, `strict`, `sync`, `dryRun`) are listed in the [options table](../spec/integrations.md#options). Options can only be passed in the config, not on the command line.
- [`examples/shop/playwright.config.ts`](https://github.com/INDXDev/indx-watch/blob/main/examples/shop/playwright.config.ts) names the reporter `indx-watch/playwright`, exactly as your project does; inside this repository it resolves to the workspace CLI package, so run `pnpm build` first.
- To try it without editing the config: `npx playwright test --add-reporter=indx-watch/playwright` (Playwright 1.63+, default options).

## Link tests to test cases with tags

```ts
// examples/shop/tests/coupon.spec.ts
test('valid coupon reduces the total', { tag: ['@TC-3'] }, async ({ page }) => {
  /* … */
});
test('expired coupon is rejected', { tag: ['@TC-4'] }, async ({ page }) => {
  /* … */
});
```

- The tag is the link: `@TC-3`, a cross-project key `@SHOP:TC-3`, or the machine ID `@tc_01JF…`. A tag on `test.describe` applies to every test inside it.
- A test can carry several tags; a test case can be implemented by several tests. Each mapped test adds one `assert` judgement to the run.
- In the test case, set `mode = "playwright"` and list the file, so people (and `iw check --fix` when it renumbers keys) can find it:

  ```toml
  [automation]
  files = ["examples/shop/tests/coupon.spec.ts"]
  ```

- Run one test case by tag. `--grep` is a regular expression, so anchor it or `@TC-1` also matches `@TC-12`:

  ```bash
  npx playwright test --grep "@TC-3(\s|$)"
  ```

## Map steps by number

If a test uses numbered `test.step` titles, each step's result is recorded against the test case step with the same number:

```ts
await test.step('1. Open the cart and apply the coupon', async () => {
  await applyCoupon(page, code!);
  await expect(page.getByTestId('total')).toHaveText('36.00');
});
await test.step('2. Press "Place order"', async () => {
  /* … */
});
```

Without numbered steps, the run has no step results; the verdict still comes from the test outcome.

## Fixtures and rows

The reporter records the current version of every fixture the test case references, computed from the bundle at the commit under test, so results become [stale](../spec/concepts.md#versions-and-staleness) when the data changes. Tests should read their data from the bundle rather than duplicating it ([fixtures](./fixtures.md)). When a test uses particular dataset rows, record them with an annotation:

```ts
test.info().annotations.push({ type: '_iw.fixture', description: 'FX-1:SUMMER10' });
```

The shop's `tests/support.ts` does this inside its `coupon()` helper, so each coupon row becomes its own variant of `TC-3`/`TC-4`. Playwright's HTML report hides annotations whose type starts with `_`.

## Results and evidence

| Playwright outcome (after retries) | Recorded as                                   |
| ---------------------------------- | --------------------------------------------- |
| expected                           | `pass`                                        |
| unexpected                         | `fail` (`interrupted` → the run is `blocked`) |
| flaky (passed on retry)            | `pass`, marked `flaky`                        |
| skipped                            | the run is `skipped`                          |

- One run is written per test case and Playwright project (`chromium`, `webkit`, …) per invocation. A failure in any project makes the test case fail.
- Screenshots, traces and videos are hashed and copied into `.indx-watch/runs/` as soon as each test ends. Use the `evidence` option (`all`, `failures`, `none`) to limit them.
- For test cases that use an `account` fixture, traces and videos are skipped by default because they record typed passwords. Step parameters and stdout/stderr are never copied. Set `traces: 'always'` to keep them anyway.
- Records are written locally first. If `project.toml` has a `[store]`, the reporter pushes them at the end of the run; a failed push is retried by the next `iw sync`.

## Release and environment

Runs are attributed to `environment` (option, `IW_ENV`, or `project.default_environment`) and to a release (option, `IW_RELEASE`, a release whose `refs` contain the build's tag or branch, or `project.current_release`). In CI, `current_release` only applies on the default branch, so results from unmerged branches do not count. To count a release branch or PR, set the release explicitly:

```bash
IW_RELEASE=v1.2.0 npx playwright test
```

Details: [release resolution](../spec/bundle-format.md#releasesversiontoml).

## Unlinked tests and strict mode

Tests without a TC tag are counted and listed at the end of the run. An unknown key such as `@TC-999` is a warning. With `strict: true` both fail the Playwright run, which is useful once every test is linked:

```ts
reporter: [['list'], ['indx-watch/playwright', { strict: true }]],
```

`dryRun: true` prints what would be recorded without writing anything.

## Sharding

Runs from one sharded execution are combined into one result per test case and variant. Every run gets a group: `IW_RUN_GROUP` if set, otherwise `github:<run_id>:<attempt>` in GitHub Actions, otherwise a fresh ID per invocation. Outside GitHub Actions, set the same `IW_RUN_GROUP` on all shards:

```bash
IW_RUN_GROUP=build-512 npx playwright test --shard=1/4
```

Alternatively, let shards write Playwright's `blob` reporter and run the INDX Watch reporter once in a merge job:

```bash
npx playwright merge-reports --reporter=indx-watch/playwright ./all-blob-reports
```

All shards and the merge job must use the same Playwright version.

## Import plans from Playwright Test Agents

If you use Playwright's planner agent, import its Markdown plan as draft test cases, then review and approve them:

```bash
iw import playwright-plan specs/coupon.plan.md --uc UC-2 --model <planner-model-id>
iw check
iw approve TC-11       # a human, after reading it
```

Each scenario becomes one AI-written draft that covers the use case's criteria. When the generator writes the test, tag it with the new key (`@TC-11`). Details: [cli.md](../spec/cli.md#iw-import-playwright-plan-filemd).

## See the results

```bash
iw status              # coverage and gate for the current release
iw show TC-3           # the test case with its recent runs
iw list runs --tc TC-3 --limit 5
```

In CI, the [GitHub Action](./github-actions.md) adds the report to the job summary and can block a release on the gate.
