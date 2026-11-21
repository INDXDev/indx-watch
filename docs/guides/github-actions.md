# GitHub Actions

Run your Playwright tests with the [reporter](playwright.md), then let the INDX Watch composite action sync results, write the readiness report into the job summary and, if you want, fail the job when the release gate fails. The action's inputs, outputs and steps are specified in [integrations](../spec/integrations.md#github-action); CI identity and context in [CI identity](../spec/integrations.md#ci-identity-and-context).

## The workflow

```yaml
# .github/workflows/e2e.yml
name: e2e

on:
  push:
    branches: [main, "release/**"]
  pull_request:

permissions:
  contents: read

jobs:
  e2e:
    runs-on: ubuntu-latest
    env:
      # Attribute every run of this job to the release under test (PR builds do not
      # fall back to current_release, so set it explicitly).
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
          # Lets ci.url open this job instead of the whole run (the `job` context exists only in step env).
          IW_CHECK_RUN_ID: ${{ job.check_run_id }}
          SHOP_CUSTOMER_PASSWORD: ${{ secrets.SHOP_CUSTOMER_PASSWORD }}
          AWS_ACCESS_KEY_ID: ${{ secrets.IW_S3_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.IW_S3_SECRET }}

      - name: INDX Watch summary and gate
        id: iw
        uses: INDXDev/indx-watch@v0
        if: ${{ !cancelled() }}
        with:
          release: v1.2.0
          summary: true
          gate: true
        env:
          AWS_ACCESS_KEY_ID: ${{ secrets.IW_S3_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.IW_S3_SECRET }}
```

What happens:

1. Playwright runs the tests. The reporter writes one run per tagged test case (and Playwright project) into `.indx-watch/runs/`, with the PR head commit, `ci.url` pointing at this job (at the run attempt without `IW_CHECK_RUN_ID`), `ci.pr` on pull requests and the actor `github:<login>`. With a store configured it also pushes them.
2. `if: ${{ !cancelled() }}` runs the action even when tests failed — that is when you need the report most.
3. The action runs `indx-watch sync`, `status` and `report --format md`, appends the report to the job summary, and with `gate: true` fails the step when the [readiness gate](../spec/concepts.md#readiness-gate) fails. On the default branch it also publishes a bundle snapshot for hosted viewers.

The job summary needs no extra permissions; `contents: read` is enough.

### PR comment and check run

To see the gate on the pull request itself, turn on `comment` and/or `check` and grant the permissions they need:

```yaml
permissions:
  contents: read
  pull-requests: write # comment: true
  checks: write # check: true
# …
      - uses: INDXDev/indx-watch@v0
        if: ${{ !cancelled() }}
        with:
          release: v1.2.0
          comment: true
          check: true
```

The action keeps **one comment per pull request** (per bundle and release) and edits it on every push, so the conversation does not fill up with reports. The check run `INDX Watch (v1.2.0)` is green when the gate passes and red otherwise; make it a required check in branch protection to block merging an unready release. Pull requests from forks get a read-only token, so the comment and check are skipped with a warning; the job summary still works.

Both also list **suggested test cases**: the test cases whose `[automation].files`, definition or fixtures the pull request changes, so reviewers know what to run or record ([`iw impact`](../spec/cli.md#iw-impact)). Run the same locally with `npx indx-watch impact --base origin/main`.

## Choosing when to gate

`gate: true` turns "not ready" into a red job. Common setups:

- Pull requests: `summary: true`, `gate: false` — show the state, do not block unrelated work.
- Release branches and tags: `gate: true` — a release cannot be cut while P0 test cases fail.

```yaml
with:
  gate: ${{ startsWith(github.ref, 'refs/heads/release/') }}
```

Use the outputs in later steps:

```yaml
- if: ${{ !cancelled() && steps.iw.outputs.gate == 'fail' }}
  run: echo "Not ready: ${{ steps.iw.outputs.fail }} failing, ${{ steps.iw.outputs.untested }} untested"
```

Outputs: `gate` (`pass`/`fail`), `report` (path of the Markdown report), `pass`, `fail`, `untested`.

## Store credentials

The store URL lives in `.indx-watch/project.toml` (`[store]`); credentials come from the environment, never from the file. Create repository secrets and pass them to both the Playwright step and the action:

| Store                                      | Secrets → environment variables                                                      |
| ------------------------------------------ | ------------------------------------------------------------------------------------ |
| AWS S3                                     | `IW_S3_KEY_ID` → `AWS_ACCESS_KEY_ID`, `IW_S3_SECRET` → `AWS_SECRET_ACCESS_KEY`       |
| Cloudflare R2, MinIO, GCS interop          | The same two variables, holding the R2 token's / HMAC key's access key ID and secret |
| Hosted INDX Watch behind Cloudflare Access | `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET` (an Access service token)           |

Create the bucket and a least-privilege key with the [S3 sync guide](s3-sync.md). Give CI a read-write key scoped to the one bucket.

## No store: the artifact fallback

Without a `[store]`, nothing is lost: `upload-artifact` defaults to `true`, so the action uploads `.indx-watch/runs/` as a workflow artifact (hidden files included). The summary and gate still work from the results of this job. To bring the results to your machine, download the artifact (for example `gh run download <run-id>`) and copy its `records/` and `blobs/` folders into your `.indx-watch/runs/`; record files are uniquely named, so copying merges.

Pull requests from forks do not receive secrets. Skip syncing there and keep the artifact instead:

```yaml
with:
  sync: ${{ github.event.pull_request.head.repo.fork != true }}
  upload-artifact: ${{ github.event.pull_request.head.repo.fork == true }}
```

## Sharded tests

Every shard of one workflow run gets the same run group (`github:<run_id>:<attempt>`), so INDX Watch combines them into one result per test case. Let each shard push its records, then compute the summary and gate once:

```yaml
jobs:
  e2e:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        shard: [1, 2, 3, 4]
    env:
      IW_RELEASE: v1.2.0
      AWS_ACCESS_KEY_ID: ${{ secrets.IW_S3_KEY_ID }}
      AWS_SECRET_ACCESS_KEY: ${{ secrets.IW_S3_SECRET }}
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: lts/*
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npx playwright test --shard=${{ matrix.shard }}/4

  readiness:
    needs: e2e
    if: ${{ !cancelled() }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: lts/*
      - uses: INDXDev/indx-watch@v0
        with:
          release: v1.2.0
          gate: true
        env:
          AWS_ACCESS_KEY_ID: ${{ secrets.IW_S3_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.IW_S3_SECRET }}
```

Without a store, use Playwright's `blob` reporter in the shards and run `npx playwright merge-reports --reporter=indx-watch/playwright` in the merge job, followed by the action ([Playwright → sharding](playwright.md#sharding)).

## Recording deployments

In the workflow that deploys to an environment, record which commit is live there:

```yaml
- uses: INDXDev/indx-watch@v0
  with:
    deployment: staging
    summary: false
  env:
    AWS_ACCESS_KEY_ID: ${{ secrets.IW_S3_KEY_ID }}
    AWS_SECRET_ACCESS_KEY: ${{ secrets.IW_S3_SECRET }}
```

This runs `indx-watch deployment add --env staging` for the current commit.

## Versions

`INDXDev/indx-watch@v0` follows the latest v0 release. Pin the CLI separately with the `version` input (for example `version: 0.1.0`), or pin the action to an exact release tag.
