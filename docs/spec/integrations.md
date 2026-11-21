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
9. **Safety.** Step parameters and stdout/stderr are not copied (they can contain typed passwords). Values resolved from secret references (of the test case's `account` fixtures and the run environment's access and hook references) are redacted from every text the reporter writes, including their URL-encoded, JSON-escaped and HTML-escaped forms. Traces and videos are also skipped by default when the environment uses such a secret.
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

Every run gets `automation.group` = `IW_RUN_GROUP`, else `<ci.provider>:<ci.run_id>:<ci.run_attempt or 1>` in a detected CI (for example `github:<run_id>:<attempt>`, `gitlab:<pipeline id>:<job retries + 1>`), else a fresh ID per invocation, so runs of one sharded execution are combined ([computed done](concepts.md#computed-done)). A retried job must land in a new execution, or its failed attempt keeps the execution at `fail`: GitHub counts the run attempt, GitLab (`CI_JOB_RETRY_COUNT`, GitLab 19.3+) and Buildkite (`BUILDKITE_RETRY_COUNT`) count the job's retries, and CircleCI gives a rerun a new `CIRCLE_WORKFLOW_ID`. On older GitLab, without `CI_JOB_RETRY_COUNT`, a retried job joins its first attempt's execution; set `IW_RUN_GROUP: gitlab:$CI_PIPELINE_ID:$CI_JOB_ID` on jobs that are not split with `parallel:` to keep retries apart. Alternatively, shards use the `blob` reporter and a merge job runs `npx playwright merge-reports --reporter=indx-watch/playwright` — the reporter works unchanged.

## CI identity and context
The `ContextProvider` port detects the build and CI context and fills these record fields:

| Field | GitHub Actions source | Local source |
|---|---|---|
| `build.commit` | PR head SHA from `GITHUB_EVENT_PATH` for `pull_request*` events, else `GITHUB_SHA` | `git rev-parse HEAD` |
| `build.ref` | `refs/heads/$GITHUB_HEAD_REF` (PR) or `GITHUB_REF` | `git symbolic-ref HEAD` |
| `build.dirty` | `false` | `git status --porcelain` non-empty |
| `ci.provider` / `ci.url` | `github` / the job page `$GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID/job/$IW_CHECK_RUN_ID` when the step sets `IW_CHECK_RUN_ID: ${{ job.check_run_id }}` (GitHub has no default variable for it), else `…/actions/runs/$GITHUB_RUN_ID/attempts/$GITHUB_RUN_ATTEMPT` | — |
| `ci.run_id`, `ci.run_attempt`, `ci.job`, `ci.workflow`, `ci.event` | `GITHUB_RUN_ID`, `GITHUB_RUN_ATTEMPT`, `GITHUB_JOB`, `GITHUB_WORKFLOW`, `GITHUB_EVENT_NAME` | — |
| `ci.pr` | PR number from the event payload | — |
| `actor` | `{ kind: "ci", id: "github:<GITHUB_ACTOR>", via: "github" }` | git identity |

*(v0.2)* GitLab CI, CircleCI and Buildkite are detected by their standard variables (`GITLAB_CI`, `CIRCLECI`, `BUILDKITE` = `true`); GitHub Actions wins when several are set, then GitLab CI, then CircleCI, then Buildkite. `IW_COMMIT` overrides the commit and `IW_ACTOR` the actor on every provider, and any other CI can set those two. `build.dirty` is `false` in CI; a field whose variable is unset is left out. When the commit variable is not a SHA (Buildkite sets `HEAD` before checkout), `build.commit` comes from `git rev-parse HEAD`. Buildkite has no stable login, so its actor id uses the creator's notification email and the display name goes in `name`. Variable semantics are recorded in [platform notes](../research/platform-notes.md#other-ci-providers).

| Field | GitLab CI | CircleCI | Buildkite |
|---|---|---|---|
| `build.commit` | `CI_COMMIT_SHA` | `CIRCLE_SHA1` | `BUILDKITE_COMMIT` |
| `build.ref` | `refs/tags/$CI_COMMIT_TAG`, else `refs/heads/$CI_COMMIT_REF_NAME` | `refs/tags/$CIRCLE_TAG`, else `refs/heads/$CIRCLE_BRANCH` | `refs/tags/$BUILDKITE_TAG`, else `refs/heads/$BUILDKITE_BRANCH` |
| `ci.provider` / `ci.url` | `gitlab` / `CI_JOB_URL` | `circleci` / `CIRCLE_BUILD_URL` | `buildkite` / `BUILDKITE_BUILD_URL` |
| `ci.run_id`, `ci.job` | `CI_PIPELINE_ID`, `CI_JOB_NAME` | `CIRCLE_WORKFLOW_ID`, `CIRCLE_JOB` | `BUILDKITE_BUILD_ID`, `BUILDKITE_LABEL` |
| `ci.run_attempt` | `CI_JOB_RETRY_COUNT` + 1 | — | `BUILDKITE_RETRY_COUNT` + 1 |
| `ci.workflow`, `ci.event`, `ci.repository` | —, `CI_PIPELINE_SOURCE`, `CI_PROJECT_PATH` | — | `BUILDKITE_PIPELINE_SLUG`, `BUILDKITE_SOURCE`, — |
| `ci.pr` | `CI_MERGE_REQUEST_IID` | trailing number of `CIRCLE_PULL_REQUEST` | `BUILDKITE_PULL_REQUEST` (unless `false`) |
| `actor` | `{ kind: "ci", id: "gitlab:<GITLAB_USER_LOGIN>", name: GITLAB_USER_NAME, via: "gitlab" }` | `{ kind: "ci", id: "circleci:<CIRCLE_USERNAME>", via: "circleci" }` | `{ kind: "ci", id: "buildkite:<BUILDKITE_BUILD_CREATOR_EMAIL>", name: BUILDKITE_BUILD_CREATOR, via: "buildkite" }` |

Without the user variable (for example a scheduled pipeline) the actor falls back to git, as on GitHub. Like `github`, the `gitlab`, `circleci` and `buildkite` identities are read from variables anyone running the job can set, so they claim a verified source and are only shown as verified when the record is signed ([signed records](security.md#signed-records)).

**Signing** *(v0.2)*: `via = "github"` is only shown as verified when the record is signed. Set `IW_SIGNING_KEY: ${{ secrets.IW_SIGNING_KEY }}` in the job's `env` so the reporter, `iw deployment add` and `iw sync --snapshot` (run by the action) sign what they write, and pin the matching public key in `project.toml` ([signed records](security.md#signed-records)). Signing through GitHub OIDC instead of a stored secret is not built yet.

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
| `comment` | `false` | On pull requests, post the gate line and the report as **one PR comment per bundle and release**, updated in place on every run (needs `pull-requests: write`) |
| `check` | `false` | Create a check run named `INDX Watch` (plus ` (<release>)` when set) on the head commit: `success` when the gate passes, `failure` otherwise, with the report as its summary (needs `checks: write`) |
| `token` | `github.token` | Token for `comment` and `check` |

Outputs: `gate` (`pass`/`fail`), `report` (path of the Markdown report), `pass`, `fail`, `untested` counts.

Steps it runs: optional `iw deployment add --env <deployment>` (first, so the sync pushes it) → `npx indx-watch@<version> sync --json` (if enabled; with `--snapshot` on the default branch) → `status --json` → `report --format md --out …` → append to job summary (truncated below 1 MiB) → on pull requests with `comment` or `check`, `impact --changed -` over the pull request's changed files → optional PR comment and check run (`gh api`; a missing permission is a warning, never a failure) → optional `actions/upload-artifact` of `.indx-watch/runs/` (`include-hidden-files: true`) → exit according to `gate`.

The job summary needs no permissions; `comment` needs `pull-requests: write` and `check` needs `checks: write`. The comment starts with a hidden marker `<!-- indx-watch:<dir>:<release> -->`, which is how the next run finds and edits it instead of adding another. Comment and check-run bodies are cut at a line boundary below GitHub's 65,536-character limit. On pull requests from forks the token is read-only, so both are skipped with a warning.

**Suggested test cases.** On a pull request, the comment and the check-run summary carry a "Suggested test cases" section between the gate line and the report: the output of [`iw impact`](cli.md#iw-impact) for the files the pull request changes, read with `gh api repos/<repo>/pulls/<n>/files` (works with a read-only token; GitHub lists at most 3,000 files). It lists each test case whose `[automation].files`, own file, use case or fixtures the change touches, with the reason ([impact analysis](concepts.md#impact-analysis)), or says that none is linked. When the files cannot be read, or the `version` input pins a CLI without `iw impact` (before T-304), the section is left out with a warning. The token reaches only that `gh api` call, not the `npx indx-watch` commands.

## Acceptance criteria

- [x] In `examples/shop`, `npx playwright test` with the reporter writes one run per tagged TC × project with `test_case.version`, `fixtures[].version`, `build.commit` and `actor` filled, and evidence blobs for screenshots.
- [x] A test tagged `@TC-999` (unknown) produces a warning; with `strict: true` the Playwright run fails.
- [x] A test that fails once and passes on retry yields an `assert` judgement `pass` with `flaky: true`.
- [x] In GitHub Actions, the run's `ci.url` points to the job (with `IW_CHECK_RUN_ID`, else to the run attempt) and `ci.pr` is set on pull requests; the job summary contains the report.
- [x] With `gate: true` and a failing P0 test case, the action step fails.
- [x] The "Suggested test cases" section for a change to `examples/shop/tests/coupon.spec.ts` lists TC-3 and TC-4 (`iw impact` human output, CLI test).
- [x] On this repository's pull requests (`comment: true` in CI), the PR comment carries that section (seen on PR #29).
- [x] With only GitLab CI, CircleCI or Buildkite variables set, `build`, `ci`, `actor` and `automation.group` come from the table above (store and reporter unit tests with fake environments).
