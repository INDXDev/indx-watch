# Integrations: Playwright, GitHub Actions, CI identity

Automated results land in the same result store, with the same record shape, as manual results. This page specifies the Playwright reporter, the GitHub Action and how CI context is captured. Platform facts are in [platform notes](../research/platform-notes.md#playwright).

## Playwright reporter
```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: [['list'], ['indx-watch/playwright', { release: process.env.IW_RELEASE }]],
  use: { screenshot: 'on', trace: 'retain-on-failure' },
});
```

```ts
// tests/coupon.spec.ts
test('valid coupon reduces the total', { tag: ['@TC-3'] }, async ({ page }) => { /* … */ });
```

### Mapping

1. **The link is a tag.** `@TC-<n>` (or `@<PROJECT>:TC-<n>`, or the machine ID `@tc_01J…`) in the test's `tag` details or title. Tags are static, visible in every Playwright report and usable with `--grep @TC-3`. Annotations carry metadata, never identity.
2. **Many-to-many.** A test may carry several TC tags; a TC may be implemented by several tests.
3. **One run per (test case, Playwright project)** per `playwright test` invocation — and per set of selected fixture rows (item 6), since each row is its own [variant](concepts.md#computed-done). Each Playwright test mapped to the TC adds one `assert` judgement (`pass`/`fail`, reason = first error message with known secret values redacted, `test` = title path). The run's verdict comes from the [decision policy](concepts.md#decision-policy); how runs of several projects, rows and shards combine into one result is defined once in [computed done](concepts.md#computed-done).
4. **Outcome mapping** from `test.outcome()` after all retries: `expected` → `pass`; `unexpected` → `fail` (`interrupted` → run reported as `blocked`); `flaky` → `pass` with `flaky: true` on the judgement; `skipped` → run reported as `skipped`.
5. **Steps.** If a test uses `test.step('1. …')` / `test.step('2. …')`, step results map by the leading number to TC steps. Otherwise step results are omitted.
6. **Fixtures.** The run records the current version of every fixture the TC references (computed from the bundle at the commit under test). A test may add `test.info().annotations.push({ type: '_iw.fixture', description: 'FX-1:SUMMER10' })` to record selected rows.
7. **Evidence.** Attachments (screenshots, traces, videos) are hashed and copied into the local replica during `onTestEnd` (Playwright may delete its output directory later). Option `evidence`: `all` (default), `failures`, `none`. For test cases that use an `account` fixture, traces and videos are **skipped by default** because they record typed values (opt in with `traces: 'always'`).
8. **Unlinked tests** are counted and listed in the summary with a stable source key (`project › file › titlePath`). With `strict: true`, an unlinked test or an unknown TC key fails the Playwright run via `onEnd`.
9. **Safety.** Step parameters and stdout/stderr are not copied (they can contain typed passwords). Values resolved from secret references are redacted from every text the reporter writes.
10. **Uploads** happen in `onEnd` (awaited): records are always written to the local replica first; if a store is configured and `sync` is not `false`, they are pushed. A failed push is logged and retried by a later `iw sync`.

### Options

| Option | Default | |
|---|---|---|
| `dir` | discovered | Bundle directory |
| `release` | `IW_RELEASE` → release resolution in [bundle-format](bundle-format.md#releasesversiontoml) | |
| `environment` | `IW_ENV` → `project.default_environment` | |
| `evidence` | `all` | `all`, `failures`, `none` |
| `strict` | `false` | Fail the Playwright run on unlinked tests, unknown keys, a missing bundle or a failed push |
| `sync` | `true` when a store is configured | Push after the run (store: `IW_STORE` → `[store].url`) |
| `traces` | `auto` | `always` keeps traces and videos of test cases that use an `account` fixture |
| `dryRun` | `false` | Print what would be recorded |

### Sharding

Every run gets `automation.group` = `IW_RUN_GROUP`, else `github:<run_id>:<attempt>` in GitHub Actions, else a fresh ID per invocation, so runs of one sharded execution are combined ([computed done](concepts.md#computed-done)). Alternatively, shards use the `blob` reporter and a merge job runs `npx playwright merge-reports --reporter=indx-watch/playwright` — the reporter works unchanged.

## CI identity and context
The `ContextProvider` port detects the build and CI context and fills these record fields:

| Field | GitHub Actions source | Local source |
|---|---|---|
| `build.commit` | PR head SHA from `GITHUB_EVENT_PATH` for `pull_request*` events, else `GITHUB_SHA` | `git rev-parse HEAD` |
| `build.ref` | `refs/heads/$GITHUB_HEAD_REF` (PR) or `GITHUB_REF` | `git symbolic-ref HEAD` |
| `build.dirty` | `false` | `git status --porcelain` non-empty |
| `ci.provider` / `ci.url` | `github` / `$GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID/attempts/$GITHUB_RUN_ATTEMPT` | — |
| `ci.run_id`, `ci.run_attempt`, `ci.job`, `ci.workflow`, `ci.event` | `GITHUB_RUN_ID`, `GITHUB_RUN_ATTEMPT`, `GITHUB_JOB`, `GITHUB_WORKFLOW`, `GITHUB_EVENT_NAME` | — |
| `ci.pr` | PR number from the event payload | — |
| `actor` | `{ kind: "ci", id: "github:<GITHUB_ACTOR>", via: "github" }` | git identity |

Other CI providers are detected by their standard variables in v0.2 (GitLab, CircleCI, Buildkite); until then set `IW_ACTOR` and `IW_COMMIT`.

## GitHub Action
A **composite action** at the repository root (`action.yml`) wraps the CLI; there is no separate action code to maintain.

```yaml
- uses: INDXDev/indx-watch@v0
  if: ${{ !cancelled() }}
  with:
    release: v1.2.0
    gate: true
  env:
    AWS_ACCESS_KEY_ID: ${{ secrets.IW_S3_KEY_ID }}
    AWS_SECRET_ACCESS_KEY: ${{ secrets.IW_S3_SECRET }}
```

| Input | Default | |
|---|---|---|
| `version` | the action's tag | `indx-watch` npm version to run |
| `cli` | `auto` | `npm` runs `npx indx-watch@<version>`; `local` runs `packages/cli/dist/bin.js` from the action's own checkout (this repository's CI, after `pnpm build`); `auto` uses the local build when present |
| `dir` | `.indx-watch` discovery | |
| `release`, `environment` | project defaults | Scope |
| `store` | `[store].url` | Override store URL |
| `sync` | `true` if a store is configured | Push local records (e.g. from the reporter) and pull others before computing status; publishes a bundle snapshot on the default branch |
| `summary` | `true` | Append the Markdown report to `$GITHUB_STEP_SUMMARY` |
| `gate` | `false` | Fail the step if the readiness gate fails |
| `deployment` | — | Environment name: record a `deployment` record for this commit (use in deploy workflows) |
| `upload-artifact` | `true` when no store | Upload `.indx-watch/runs/` as a workflow artifact, so results are never lost |

Outputs: `gate` (`pass`/`fail`), `report` (path of the Markdown report), `pass`, `fail`, `untested` counts.

Steps it runs: optional `iw deployment add --env <deployment>` (first, so the sync pushes it) → `npx indx-watch@<version> sync --json` (if enabled; with `--snapshot` on the default branch) → `status --json` → `report --format md --out …` → append to job summary (truncated below 1 MiB) → optional `actions/upload-artifact` of `.indx-watch/runs/` (`include-hidden-files: true`) → exit according to `gate`.

PR comments and check runs are *v0.2* (they need `pull-requests: write` / `checks: write`); the job summary needs no permissions.

## Acceptance criteria

- [ ] In `examples/shop`, `npx playwright test` with the reporter writes one run per tagged TC × project with `test_case.version`, `fixtures[].version`, `build.commit` and `actor` filled, and evidence blobs for screenshots.
- [ ] A test tagged `@TC-999` (unknown) produces a warning; with `strict: true` the Playwright run fails.
- [ ] A test that fails once and passes on retry yields an `assert` judgement `pass` with `flaky: true`.
- [ ] In GitHub Actions, the run's `ci.url` points to the job's run attempt and `ci.pr` is set on pull requests; the job summary contains the report.
- [ ] With `gate: true` and a failing P0 test case, the action step fails.
