# Wiring Playwright and CI (iw-setup)

Write these only after the user said yes, and show the list of changed files afterwards. Guides: [Playwright](https://github.com/INDXDev/indx-watch/blob/main/docs/guides/playwright.md), [GitHub Actions](https://github.com/INDXDev/indx-watch/blob/main/docs/guides/github-actions.md).

## Playwright reporter

Add the INDX Watch reporter **after** the reporters the project already has; never replace them. For `examples/shop`:

```ts
// playwright.config.ts
reporter: [['list'], ['indx-watch/playwright']],
```

- A config that already names `indx-watch/playwright` needs nothing: say so and skip this question.
- A config that builds `reporter` in code (as `examples/shop` does) gets one `reporter.push(['indx-watch/playwright'])` line instead.
- Install the package as a dev dependency with the project's package manager (`npm install -D indx-watch`, `pnpm add -D indx-watch`, `yarn add -D indx-watch`), the one whose lock file is in the repository.
- The reporter records one run per test tagged `@TC-n`. Untagged tests are ignored, so wiring it changes nothing until `iw-design` links tests to test cases.
- With no `[store]` in `project.toml`, results stay in `.indx-watch/runs/` (git-ignored). Do not add a store without asking.

## GitHub Actions workflow

Only when the user wants results on pull requests. Use the Node version, install command and test command the repository already uses, and the release chosen in this conversation:

```yaml
# .github/workflows/indx-watch.yml
name: indx-watch

on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read
  pull-requests: write # comment: true
  checks: write # check: true

jobs:
  e2e:
    runs-on: ubuntu-latest
    env:
      IW_RELEASE: v1.2.0
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: lts/*
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - name: Playwright tests (records runs through indx-watch/playwright)
        run: npx playwright test
        env:
          IW_CHECK_RUN_ID: ${{ job.check_run_id }}
      - name: INDX Watch summary, comment and check
        uses: INDXDev/indx-watch@v0
        if: ${{ !cancelled() }}
        with:
          release: v1.2.0
          summary: true
          comment: true
          check: true
```

- Secrets (a test account password such as `SHOP_CUSTOMER_PASSWORD`, store keys) go into `env:` as `${{ secrets.NAME }}`. Tell the person which repository secrets to add; never ask for their values.
- Do not set `gate: true` unless the user asks: a failing gate fails the job.
- Committing and adding secrets are the person's steps.
