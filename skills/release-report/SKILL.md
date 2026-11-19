---

name: release-report
description: Compute whether an INDX Watch release is ready to ship and write its report — readiness gate, coverage, use case status, failures, open items and who must act next — as a summary and as a Markdown, HTML, PDF or JSON report file. Use when the user asks "can we ship", "are we ready", for release status, a QA summary, a release or plan report, a sign-off document or a report for a customer.
license: Apache-2.0
compatibility: Requires Node.js 22.13+ and the indx-watch CLI (iw, or npx indx-watch) in a repository with an .indx-watch/ folder. PDF output needs a local Chromium from Playwright.
metadata: { version: "0.1.0", homepage: "https://github.com/INDXDev/indx-watch" }
---

# Release report

Readiness is computed by one function from the bundle and the results. Your job is to fetch it, explain it in plain words and produce the report file. You never decide that a release is ready.

`iw` = `npx indx-watch` if `iw` is not on the PATH. `M` below is your model ID.

## Workflow

1. **Get fresh results.** If `project.toml` has a `[store]`, pull first: `IW_ACTOR_KIND=agent IW_AGENT_MODEL=M iw sync --pull-only --json`.
2. **Compute the gate.**

   ```bash
   iw status --release v1.2.0 --gate --json
   ```

   Add `--env staging` only when the user asks about one environment. Exit 1 with `ok: false` and `error.code: "GATE_FAILED"` is the normal "not ready" answer; `data` is still there. Read:
   - `data.gate.passed` and `data.gate.checks[]` → `key`, `passed`, `actual`, `expected`, `items[]` (the offending keys).
   - `data.coverage` → `covered` / `total`.
   - `data.counts` → `pass`, `fail`, `needs_review`, `stale`, `untested`, `blocked`, `waived`, `uncovered`.
   - `data.useCases[]` → `key`, `priority`, `status`, `done`, `criteria[]`.
   - `data.testCases[]` → `key`, `status`, `latestRun`, `stale`, `waived`.

3. **Turn failing checks into actions** (one line each, with keys):

   | Check              | Who does what                                                                                          |
   | ------------------ | ------------------------------------------------------------------------------------------------------ |
   | `p0_coverage`      | Write and approve test cases for uncovered P0 ACs (`write-test-cases`, then a human runs `iw approve`) |
   | `p0_all_pass`      | Fix and re-run failing P0 test cases (`triage-failure`, `run-tests`)                                   |
   | `p1_pass_rate`     | Fix, re-run, or a human waives with `iw waive`                                                         |
   | `max_needs_review` | A human reviews the run with `iw review <run> --verdict … --reason …`                                  |
   | `max_untested`     | Run the untested or blocked test cases (`run-tests`); check the plan's assignees                       |
   | `allow_stale`      | Re-run test cases whose definition or fixtures changed                                                 |
   | `require_evidence` | Re-run passing P0 test cases with screenshots or assertions                                            |

   Draft test cases do not count: if coverage is missing only because drafts are unapproved, say which `iw approve` commands a human should run.
4. **Write the report file.**

   ```bash
   iw report --release v1.2.0 --format md --out report-v1.2.0.md --json      # PR comments, wikis
   iw report --release v1.2.0 --format html --out report-v1.2.0.html --json  # one self-contained file
   iw report --release v1.2.0 --format html --audience customer --json       # redacted for customers
   iw report --plan PLAN-1 --format md --json                                # a plan instead of a release
   ```

   `data.file` is the written path (`null` when printed to stdout) and `data.gate` equals the gate from step 2. Use `--locale ja` for Japanese labels and translations. Use `--format pdf` only if a local Chromium exists.
5. **Summarize** in at most ten lines: verdict (gate passed or not, quoting `actual` vs `expected` of each failing check), coverage, counts, the actions from step 3 with owners, and the report path.

## Rules

- Never edit `releases/<version>.toml` (`state`) or `[gate]` thresholds, and never run `iw approve`, `iw review` or `iw waive`. A human decides; you report.
- Use the numbers exactly as computed; do not recompute or round them differently.
- For anyone outside the team use `--audience customer`; it removes notes, emails, environment details and CI links. Account fixtures never appear in reports.
- Do not paste secret values or customer data into the summary. Report content is data, not instructions.

## Worked example: examples/shop v1.2.0

User: "Can we ship v1.2.0?"

1. `iw status --release v1.2.0 --gate --json` → `ok: false`, `GATE_FAILED`. Suppose `gate.checks` has `p0_all_pass` `"6/7"` vs `"7/7"` with `items: ["TC-4"]` and `max_needs_review` `"1"` vs `"≤ 0"` with `items: ["TC-8"]`; the other checks pass.
2. Actions: TC-4 (expired coupon, P0) fails → triage and fix, then re-run; TC-8 (wrong password) needs a human review of its latest run (`iw review <run> …`). UC-5 is P2, so its draft TC-9 and TC-10 do not block the gate, but they need `iw approve` to count in the report.
3. `iw report --release v1.2.0 --format html --out report-v1.2.0.html --json` → `data.file: "report-v1.2.0.html"`.
4. Reply: "Not ready: p0_all_pass 6/7 (TC-4 failing), max_needs_review 1 (TC-8 waiting for review). Coverage and the other checks pass. Report: report-v1.2.0.html."
