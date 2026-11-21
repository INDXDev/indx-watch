# Quickstart

From an empty folder to a shareable readiness report in about a minute, fully offline. You need Node 22.13 or later.

`iw` and `npx indx-watch` are the same CLI ([cli.md](../spec/cli.md)). This guide uses `npx indx-watch` in step 1 and `iw` after that. To get the short name, install the package (`npm install --global indx-watch`) or define `alias iw="npx indx-watch"`.

## 1. Create a bundle

```bash
npx indx-watch init demo
cd demo
```

`init` creates `demo/.indx-watch/` with a project (key `DEMO`, current release `v0.1.0`), an environment `local`, the release `v0.1.0` and a feature `FEAT-1` "General":

```text
.indx-watch/
├── .gitignore                     # cache/ and runs/
├── project.toml
├── environments/local.toml        # base_url = "http://localhost:3000" — point it at your app
├── releases/v0.1.0.toml
└── specs/FEAT-1-general/feature.toml
```

Want a full example instead? `npx indx-watch init demo --example` copies the [`examples/shop`](../../examples/shop) bundle.

## 2. Write a use case and a test case

A use case says who wants what; its acceptance criteria (ACs) say when it is done. A test case gives steps that verify one or more ACs.

```bash
iw new uc --title "Guest applies a coupon at checkout" \
  --ac "A valid coupon reduces the order total by its discount." --ready --json
```

```json
{
  "ok": true,
  "command": "new",
  "data": {
    "kind": "uc",
    "id": "uc_01J…",
    "key": "UC-1",
    "file": "…/specs/FEAT-1-general/UC-1-guest-applies-a-coupon-at-checkout/use-case.toml"
  },
  "warnings": []
}
```

```bash
iw new tc --uc UC-1 --title "Valid coupon reduces the total" \
  --step "Open the cart, enter SUMMER10 in the coupon field and press \"Apply\" => The total shows \"36.00\"" \
  --ready --json
```

```json
{
  "ok": true,
  "command": "new",
  "data": {
    "kind": "tc",
    "id": "tc_01J…",
    "key": "TC-1",
    "file": "…/UC-1-guest-applies-a-coupon-at-checkout/TC-1-valid-coupon-reduces-the-total.toml"
  },
  "warnings": []
}
```

The test case covers every AC of `UC-1` by default (`--covers` changes that). `--ready` says a person wrote and approved it; without it, items start as `draft` and do not count towards readiness until someone runs `iw approve`. Open the generated TOML files: they are plain text, meant to be read and edited. Their first line (`#:schema https://…/schemas/v1/….json`) gives editors with a TOML language server (such as Taplo) completion and validation; the editor downloads the schema from GitHub, so completion needs a network connection. How to write good ones: [writing test cases](writing-test-cases.md).

## 3. Check the bundle

```bash
iw check
```

`iw check` validates schemas, references, keys and formatting, and scans for secrets. Exit code 0 means valid. With `--json` the counts are in `data`:

```json
{
  "ok": true,
  "command": "check",
  "data": { "files": 6, "errors": 0, "warnings": 0, "problems": [], "changed": [], "renumbered": [] },
  "warnings": []
}
```

## 4. Keep it in git

```bash
git init && git add .indx-watch && git commit -m "Add INDX Watch bundle"
```

Definitions travel through git and pull requests. Results stay out of git (`runs/` is ignored) and travel through a result store. From now on every run records the commit it tested.

## 5. Open the dashboard

```bash
iw serve --open
```

```text
http://127.0.0.1:4321
```

`serve` keeps running; use a second terminal for the next commands. The readiness dashboard shows release `v0.1.0`: one use case, coverage 1/1, and `TC-1` as `untested`.

## 6. Run the test case manually

In the browser, open `TC-1` and start a run. Follow the step against your app, mark it passed, attach a screenshot and finish the run. The run is written to `.indx-watch/runs/` with your git identity, the commit (from step 4), the release and the environment.

Without the browser, the same result from the terminal:

```bash
iw record TC-1 --verdict pass --step 1=pass --evidence ./coupon.png@1 --json
```

```json
{
  "ok": true,
  "command": "record",
  "data": {
    "run": { "kind": "run", "id": "run_01J…", "test_case": { "key": "TC-1", "version": "tcv:…" }, "…": "…" },
    "verdict": "pass",
    "rule": 1
  },
  "warnings": []
}
```

Then ask for the status:

```bash
iw status --json
```

```json
{ "ok": true, "command": "status", "data": {
  "scope": { "release": "v0.1.0", "environment": null },
  "gate": { "passed": true, "checks": [ … ] },
  "coverage": { "covered": 1, "total": 1, "ratio": 1 },
  "useCases": [ { "key": "UC-1", "status": "pass", "done": true, … } ],
  "testCases": [ { "key": "TC-1", "status": "pass", "latestRun": "run_01J…", "stale": false, … } ],
  "counts": { "pass": 1, "fail": 0, "needs_review": 0, "untested": 0, … } }, "warnings": [] }
```

How the status, coverage and gate are computed: [concepts](../spec/concepts.md#computed-done).

## 7. Share a report

```bash
iw report --format html --out report.html
```

`report.html` is one self-contained file (inline CSS, no network; screenshot thumbnails are embedded for failing and open P0–P1 items) that you can email or attach to a ticket. Use `--format md` for a PR comment and `--audience customer` to remove internal details. Contents and formats: [reports](../spec/reports.md).

## Next

- [Writing good test cases](writing-test-cases.md) and [fixtures](fixtures.md)
- Link automated tests: [Playwright](playwright.md), then [GitHub Actions](github-actions.md)
- Share results with your team: [S3 sync](s3-sync.md)
- Let a coding agent help: `iw skills install` ([skills](../../skills/README.md))
