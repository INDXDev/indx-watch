---
title: "CLI (iw)"
description: "Every iw command, its flags, JSON output and exit codes."
---

# CLI (`iw`)

`iw` is the command-line interface of the `indx-watch` npm package. `npx indx-watch <command>` and `iw <command>` are the same. Every command works offline unless it talks to a store or Cloudflare.

## Conventions

| Topic | Rule |
|---|---|
| Bundle discovery | Walk up from the current directory to find `.indx-watch/`. Override with `--dir <path>` or `IW_DIR`. |
| Output | Human-readable by default. `--json` prints exactly one JSON document to stdout (the **envelope** below) and nothing else; logs go to stderr. |
| Color | Off when stdout is not a TTY or `NO_COLOR` is set. |
| Identity | See [security.md](./security.md#identity). Override with `IW_ACTOR`, `IW_ACTOR_KIND`, `IW_AGENT_MODEL`. |
| Keys and IDs | Wherever a command takes `<ref>`, it accepts a human key (`TC-3`), a machine ID (`tc_01J…`), or a cross-project key (`SHOP:TC-3`). Runs are referenced by ID or a unique prefix of ≥ 8 characters after `run_`; runs recorded together share the ULID timestamp prefix, so scripts and agents should pass the full ID. |
| Agents | When the actor is an agent (see [security.md](./security.md#identity)), `iw approve`, `iw review` and `iw waive` exit 2. |
| Running tests | Automated tests run with Playwright and the [reporter](./integrations.md#playwright-reporter); people run tests in the browser runner; `agent` test cases run with [`iw run`](#iw-run-tc-ref); anything else is recorded with `iw record`. |
| Non-interactive | Commands never prompt when stdin is not a TTY or `--yes` is given; missing input is an error (exit 2). |
| Arguments | A command that takes no positional argument rejects one with `USAGE` (exit 2): `iw sync s3://other` does not quietly sync the configured store. A file or folder named by a flag that does not exist (`--from`, `--out`, `--evidence`) is `NOT_FOUND` (exit 2), never an internal error. |
| Load problems | A definition file that does not load (a TOML syntax error, an invalid value, a missing `feature.toml`/`use-case.toml`) is left out of the bundle. Every command that opens the bundle then reports each such error as a warning (the problem with `severity = "warning"`, same `code`, `file` and `message`) in its output: on stderr as text, in `warnings` with `--json`; `iw check` reports them as its own errors instead. The [readiness gate](./concepts.md#readiness-gate) fails while one exists (`valid_definitions`). |

### JSON envelope

```json
{ "ok": true, "command": "check", "data": { }, "warnings": [] }
```

```json
{ "ok": false, "command": "check", "error": { "code": "CHECK_FAILED", "message": "3 problems in 2 files", "details": [] } }
```

`warnings` and `error.details` items are **problems**. An error envelope also carries `warnings` when there were any before the error (such as definition files that do not load).

```json
{ "severity": "error", "code": "unknown-key", "file": "specs/FEAT-2-checkout/UC-2-guest-applies-coupon/TC-3-valid-coupon.toml", "path": "steps[0].expectd", "message": "Unknown key \"expectd\". Did you mean \"expected\"?" }
```

The shapes are defined as Zod schemas in [`packages/cli/src/json.ts`](https://github.com/INDXDev/indx-watch/blob/main/packages/cli/src/json.ts) (`CommandData`, `ErrorEnvelope`), which is the field-level reference; the `data` lines below summarize them. They are part of the public contract: additive changes only within a major version. When the answer is "no" (`check` with errors, `status --gate` failing), the error envelope also carries the command's `data`.

### Exit codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | The command ran and the answer is "no": `check` found errors, `status --gate` failed, `import --dry-run` found conflicts, `sync`/`export` refused by the secret scan |
| 2 | Usage error (unknown flag, missing argument, ambiguous ref) |
| 3 | Bundle or config error (no `.indx-watch/`, unsupported `schema_version`, invalid `project.toml`) |
| 4 | Store, network or external tool error (S3, hosted server, `wrangler`, `cloudflared`), or an internal error |

## Commands

v0.1 commands are listed below. Commands marked *(v0.2)* are designed but not built; see the [roadmap](../roadmap.md).

### `iw init [dir]`

Create `.indx-watch/` in `dir` (default: current directory) with `project.toml` (with `current_release = "v0.1.0"`), `.gitignore`, an environment `local` (`base_url = "http://localhost:3000"`, change it), a release `v0.1.0` and a feature `FEAT-1` "General" — so `iw new uc` works immediately.

| Flag | Default | |
|---|---|---|
| `--key <KEY>` | from directory name | Project key |
| `--name <name>` | directory name | Project name |
| `--locale <en\|ja>` | `en` | Source locale |
| `--example` | | Copy the `examples/shop` bundle instead of an empty one |
| `--no-agents` | | Skip the agent setup below |
| `--github` | | *(v0.5)* Also write the GitHub files below. Works in an existing project too: only the GitHub files are written, and `init` then exits 0 instead of 1 |

*(v0.5)* `iw init` pins the project to the running version: `project.toml` gets `[tool] indx_watch = "<version>"` ([staying current](#iw-doctor)), and the agent setup writes `.mcp.json` as `npx -y indx-watch@<version> mcp`.

Unless `--no-agents` is given, `iw init` also sets up Claude Code and Codex exactly like [`iw skills install`](#iw-skills-install) (both agents), in the git repository root of `dir`, or in `dir` itself when `init` creates it or it is outside git. The text output names the directory it set up.

With `--example`, `init` also pulls the sample results from the copied store (`iw sync --pull-only`), so `iw status` and `iw serve` show them at once.

The text output ends with next steps that run as printed: with agents, open Claude Code or Codex and say "Set up testing for this repo" (`/iw-setup`, `$iw-setup`; "Can we ship?" for `--example`), or run `npx indx-watch serve --open` (with `--dir` when `dir` was given). Commands are printed as `iw …` when `init` was run as `iw`, else as `npx indx-watch …`.

When `dir` already has `.indx-watch/project.toml`, `init` changes nothing and exits 1 (`CONFLICT`) with "Already set up. To refresh the agent files: npx indx-watch skills install".

**`--github`** *(v0.5)* writes, relative to the git root (or `dir`), only the files that are missing and never overwrites one:

| File | What it does |
|---|---|
| `.github/workflows/indx-watch.yml` | On pull requests and pushes to `main`: `npx --yes indx-watch@<version> check` (the running version; `iw update` keeps it in step with `[tool]`), Playwright with the reporter (skipped without a `playwright.config.*`), then the [Action](./integrations.md#github-action) with `comment` and `check` (including [the test cases the PR changes](./integrations.md#github-action)); the release is read from `project.toml` |
| `.github/workflows/indx-watch-deploy.yml` | On pushes to `main` that touch `.indx-watch/`, `package.json` or the lockfile, and by hand: `npx --yes indx-watch@<version> deploy` when `project.toml` has `[hosting]`, else a notice |
| `.github/ISSUE_TEMPLATE/indx-watch-*.yml` | The issue forms of GitHub Issues (written by `githubTemplates()`) |

The text output lists the files written and kept and names the repository secrets the deploy workflow reads (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`), never a value. Run it again to see `skipped` and no `secrets`.

`data`: `{ "dir": string, "files": string[], "agents"?: { "installed": string[], "files": string[], "removed": string[] }, "github"?: { "root": string, "written": string[], "skipped": string[], "secrets": string[] } }` (`agents` is the `iw skills install` data; `github` only with `--github`, paths relative to `root`)

### `iw check`

Validate the whole bundle: schemas, canonical formatting, references (`covers`, fixture refs, plan items, *(v0.5)* shared steps: an unknown `use` is `unresolved-ref`, a loop `shared-step-cycle`), duplicate keys and IDs, AI approval rule, secret scan, unknown files.

| Flag | |
|---|---|
| `--fix` | Canonicalize files, regenerate slugs, renumber duplicate keys (prints mapping) |
| `--strict` | Treat warnings as errors |

A TOML syntax error (`invalid-toml`) names the line and column and quotes the line (`… at line 37, column 3: [[[`). The text output ends with one summary line (`30 files, 1 error, 0 warnings`); when the check fails, that line is the error message on stderr and is not repeated on stdout.

*(v0.5)* `ui/` and `[report]` are checked as described in [Customizing](./bundle-format.md#customizing-v05) (`invalid-ui`, `unknown-ui-key`, `ui-placeholder`, `ui-markup`, `invalid-logo`, `low-contrast`).

Reference checks: see [concepts invariants](./concepts.md#invariants). With a `[store]` (or `IW_STORE`), records the store has two bodies of, as of the last sync, are `record-conflict` warnings ([merge rules](./sync.md#merge-rules)). *(v0.2)* A `<name>.conflict-<sha8>.<ext>` file left by a [workspace-mode](./sync.md#workspace-mode-v02) merge is a `workspace-conflict` error until it is deleted.

`data`: `{ "files": number, "errors": number, "warnings": number, "problems": Problem[], "changed": string[], "renumbered": { "from": string, "to": string, "id": string }[] }`

### `iw fmt [paths...]`

Rewrite files in canonical form. Equivalent to the formatting part of `check --fix`. `data`: `{ "changed": string[] }`

### `iw new <kind>`

When the actor is an agent, every kind is created with `origin = "ai"` and an `[ai]` table, and `uc`, `ac`, `tc` and `fixture` as drafts: `--origin human|import` and `--ready` are rejected, and the model comes from `--model` or `IW_AGENT_MODEL` (otherwise exit 2). An `origin = "ai"` item never starts approved: `approved_by` from `--from` is dropped (only `iw approve` writes it). A new use case defaults to priority `P1`.

Create a definition file with a fresh ID and the next free key. Kinds: `feature`, `uc`, `ac`, `tc`, `ss` (*(v0.5)* a [shared step](./bundle-format.md#shared-steps) in `steps/`, key `SS-n`, with `--title` and `--step`; without a step one placeholder step is written), `fixture`, `env`, `release`, `plan`.

| Flag | Applies to | |
|---|---|---|
| `--title <text>` | all | Required in non-interactive use |
| `--feature <FEAT>` | `uc` | Parent feature (default: the only feature, or `FEAT-1`) |
| `--actor <text>`, `--goal <text>` | `uc` | Default: "User" and the title |
| `--ac <text>` | `uc` | Repeatable; at least one acceptance criterion is required |
| `--step "<instruction> => <expected>"` | `tc`, `ss` | Repeatable; without it (and without `--template`/`--from`) one placeholder step is written and the file stays `draft` |
| `--uc <UC>` | `ac`, `tc` | Parent use case (`ac` appends a criterion) |
| `--text <text>` | `ac` | Criterion text |
| `--covers <AC,...>` | `tc` | Default: all ACs of `--uc` |
| `--mode <mode>` | `tc` | Default `manual` |
| `--priority <P0-P3>` | `uc`, `tc` | |
| `--kind <kind>` | `fixture` | `dataset`, `seed`, `file`, `account` |
| `--template <name>` | `tc`, `uc`, `fixture` | From `templates/` |
| `--from <file.toml\|->` | all | Merge field values from a TOML/JSON file or stdin (agents use this) |
| `--ready` | `uc`, `tc`, `fixture` | Create as `ready` (humans only; rejected with `--origin ai`). Default `draft`. |
| `--origin ai --model <id> [--skill <name>]` | all | Marks the item as AI-written (`origin = "ai"`, `[ai]` table; `uc`, `tc`, `fixture` are `draft`; for `ac`, and for each `--ac` of a new `uc`, a criterion with `status = "draft"` and its own `[ai]` table) |

`data`: `{ "kind": string, "id": string, "key": string, "file": string }`

### `iw approve <ref>`

For an acceptance criterion, `approve` sets `status = "ready"` and `approved_by` (criteria have no `approved_version`); the returned `version` is the use case's content hash. For a feature (`FEAT-n`), plan (`PLAN-n`), environment (its name) or release (its version), `approve` sets only `approved_by`, which clears the `ai-not-approved` warning; the returned `version` is `""`.

Approve a draft use case, test case or fixture (or a draft acceptance criterion): sets `status = "ready"`, `approved_by` from your identity and `approved_version`. Refused for agents. `data`: `{ "ref", "file", "version", "approved_by" }`

### `iw invite <email>`

*(v0.3)* Invite a customer to plan items for [customer UAT](./security.md#customer-uat): set `assignee = "<email>"` on the items of `--plan` (written through `formatToml()`), then add the email to the Access policy named by `IW_ACCESS_POLICY` (`<account id>/<policy id>`) with `CLOUDFLARE_API_TOKEN`. Without those variables the plan is still written, `access` is `"manual"` and a warning says to add the email in the dashboard. Humans only (agents: exit 2). Exits 3 (`INVALID_CONFIG`) when `project.toml` has no `[hosting.roles]` or gives them a `default` other than `customer`, 2 (`NOT_FOUND`) for an unknown plan or a test case that is not in it, and 4 (`EXTERNAL_TOOL`) when the Cloudflare API call fails (the plan is already written; run it again).

| Flag | |
|---|---|
| `--plan <PLAN-n>` | Required. The plan |
| `--items <TC-n,…>` | These items, reassigning any that someone else is assigned to (default: every item of the plan that is unassigned or already the email's) |
| `--revoke` | Remove the email from the items' `assignee` instead (default: every item assigned to it); it leaves the Access policy once no plan item is assigned to it |

`data`: `{ "email": string, "plan": string, "file": string, "items": string[], "reassigned": string[], "revoked": boolean, "access": "added" | "removed" | "kept" | "manual" }` (`items`: the items whose assignee changed, the plan file is not written when there are none; `reassigned`: those taken from another assignee; `kept`: a revoke left the policy entry because other items are still assigned). The Access policy call runs even when no item changed, so running the command again repairs the policy.

### `iw assign`

*(v0.5)* Assign the items of a plan to people, `ci` or agents ([assignment](./concepts.md#assignment-and-automation-mix)). The plan file is written through `formatToml()`; a run that changes nothing writes nothing. Writing needs a person: with `--dry-run` anyone (agents included) gets the proposal, without it an agent gets exit 2 (`CLAUDECODE=1` counts as an agent).

| Flag | |
|---|---|
| `--plan <PLAN-n>` | Required. The plan |
| `--split <who:weight,…>` | Split by weight, for example `alex@shop.test:2,sam@shop.test:1,agent:claude:1`. A whole number weight follows the last colon (default 1); every entry must be an email, `ci`, `agent:<name>` or `group:<name>`. Owners keep their own features first and high priorities are spread ([rules](./concepts.md#assignment-and-automation-mix)) |
| `--only-unassigned` | With `--split`: leave items that already have an assignee alone (they still count toward that assignee's share) |
| `--to <who> --items <TC-n,…>` | Give those items to one assignee, reassigning them if needed |
| `--dry-run` | Print the proposal; write nothing |

Pass `--split` or `--to` with `--items`, not both. `data`: `{ "plan": string, "file": string, "dry_run": boolean, "assignments": [ { "test_case": string, "environment"?: string, "assignee": string, "from"?: string } ], "load": { "<assignee>": number }, "unassigned": number }`. `assignments` lists the items whose assignee changes (`from`: the previous assignee); `load` is the number of items each assignee holds after the change; `unassigned` the items still without one. The MCP tool `assign` returns the same data and is always a dry run.

### `iw status`

Compute coverage, use case status and the readiness gate for a scope.

| Flag | Default | |
|---|---|---|
| `--release <version>` | `project.current_release` | |
| `--env <name>` | any | |
| `--gate` | | Exit 1 if the gate fails |
| `--sync` | | Run `iw sync` first |
| `--mine` | | *(v0.4)* Only the features you own ([feature owners](./concepts.md#feature-owners)): yours by your actor ID (`IW_ACTOR`, else `git config user.email`); `group:` owners do not match locally. `data` adds `mine` |

`data`:

```json
{
  "scope": { "release": "v1.2.0", "environment": null },
  "gate": { "passed": false, "checks": [ { "key": "p0_all_pass", "passed": false, "actual": "3/4", "expected": "4/4" } ] },
  "coverage": { "covered": 8, "total": 9, "ratio": 0.889 },
  "useCases": [ { "key": "UC-2", "title": "…", "priority": "P0", "status": "fail", "criteria": [ { "key": "AC-2.1", "status": "pass", "testCases": ["TC-3"] } ] } ],
  "testCases": [ { "key": "TC-3", "status": "pass", "latestRun": "run_01J…", "stale": false, "flaky": { "rate": 0.2, "flakes": 2, "runs": 10 } } ],
  "counts": { "pass": 5, "fail": 1, "needs_review": 1, "untested": 2, "stale": 0, "waived": 0, "uncovered": 1 }
}
```

With `--mine`, `data` also has `"mine": { "actor": "alex@shop.test", "features": ["FEAT-2"] }` (the features you own; empty when you own none, and then the rest of `data` is empty too). `iw list features` shows every feature's `owners`, including `group:` ones.

`data.automation` *(v0.5)* is the [automation mix](./concepts.md#assignment-and-automation-mix) of the plans of the release in scope: `{ "people": 3, "ci": 4, "agents": 1, "total": 8 }`; it is absent when no plan has items.

A test case has `flaky` only when it has at least one flake among its last 10 pass/fail runs in the scope ([flaky tests](./concepts.md#flaky-tests)).

When the scope has no `ready` acceptance criterion (a new bundle, or only drafts), the text output says "Coverage: no ready acceptance criteria yet" instead of a 0/0 ratio; `data.coverage` is unchanged. While a definition file does not load, the gate's first check is a failing `valid_definitions` and the file is a warning ([load problems](#conventions)).

### `iw impact`

Suggest the test cases a change touches, from the changed files and each test case's `[automation].files`, own file, use case and fixtures ([impact analysis](./concepts.md#impact-analysis)). Paths are relative to the repository root (the bundle's parent outside git). One of `--changed` or `--base` is required (exit 2); a failing `git diff` is `EXTERNAL_TOOL` (exit 4); `--base` reads non-ASCII paths unquoted (`core.quotePath=false`). `--changed` splits on commas, so pass a path that contains a comma through `--changed -` (stdin, one path per line). The human output is a Markdown section headed "Suggested test cases", one bullet per test case with its reasons; the GitHub Action puts it in its [PR comment](./integrations.md#github-action).

| Flag | |
|---|---|
| `--changed <paths>` | Changed paths, comma-separated or repeated; `-` reads one path per line from stdin |
| `--base <ref>` | Use `git diff --name-only <ref>...HEAD` (the changes since the branch left `<ref>`), e.g. `--base origin/main` |

`data`: `{ "base": string | null, "changed": string[], "testCases": { "key", "id", "title", "status", "priority", "reasons": { "kind": "automation" \| "definition" \| "fixture", "file": string, "pattern"?: string }[] }[] }`

### `iw diff`

*(v0.5)* List the use cases, criteria and test cases added, changed or removed since a commit, from the [bundle diff](./concepts.md#bundle-diff) of the bundle at `--base` and the bundle in the working tree. `--base <ref>` is required (exit 2); a ref that is not a commit is `EXTERNAL_TOOL` (exit 4). When `HEAD` has a merge base with `<ref>`, that is the commit compared (what a pull request changed); else `<ref>` itself, as in a shallow clone. A base commit without a bundle makes everything added. The human output is the Markdown section "Test cases changed in this PR" with at most 20 lines (the rest is "…and n more"), which the [GitHub Action](./integrations.md#github-action) puts in its PR comment.

`data`: `{ "base": string, "added": Entry[], "changed": Entry[], "removed": Entry[] }` with `Entry = { "kind": "uc" | "ac" | "tc", "key": string, "title": string, "what"?: ("title" | "steps" | "criteria" | "data" | "details")[] }` (`what` only in `changed`).

### `iw show <ref>`

Show one entity with resolved references, current version hash and recent runs. `--versions` lists versions from git history. `data`: the entity object as in the [programmatic model](../architecture.md#core-model) plus `runs`.

### `iw list <kind>`

List `features`, `ucs`, `tcs`, `fixtures`, `envs`, `releases`, `plans`, `runs`. Keyed items are sorted by key number (`TC-2` before `TC-10`); runs keep their time order. In the text output, a draft use case or test case ends with `(draft)`. Filters: `--status`, `--tag`, `--priority`, `--mode`, `--uc`, `--tc`, `--release`, `--limit`, and *(v0.4)* `--mine` (only the features you own, their use cases and test cases, as in `iw status --mine`). `data`: `{ "items": object[] }`

### `iw record <tc-ref>`

Record a run that was executed outside the browser runner — by a person in a terminal or by an agent.

| Flag | |
|---|---|
| `--verdict <pass\|fail\|blocked\|skipped>` | Executor's reported result; becomes a judgement of the executor's kind (`human` for people, `llm` for agents with `--confidence`) |
| `--step <n>=<status>[:note]` | Repeatable |
| `--checks <n>=<1\|0>[,…]` | *(v0.4)* Repeatable: which of step `n`'s `checks` hold, one `1` or `0` per check in order (`--checks 2=1,0`); recorded as that step's `checks` ([run record](./sync.md#run-record)). Needs `--step n=…`; a count that differs from the step's checks, or a second `--checks` for the same step, is a usage error |
| `--evidence <path>[@step]` | Repeatable; files are hashed into the local replica |
| `--note <text>` | |
| `--confidence <0-1>` | Agents only |
| `--release`, `--env`, `--commit` | Override detection |
| `--rows <key,...>` | Dataset rows used |
| `--from <run.json\|->` | Full run input as JSON (see [sync.md](./sync.md#run-record)) |

`data`: `{ "run": RunRecord, "verdict": Verdict }`

### `iw issue <ref>`

*(v0.5)* Build the prefilled GitHub new-issue URL of a failure ([GitHub issues](./integrations.md#github-issues)). `<ref>` is a run ID, `TC-n`, `AC-n.m` or `UC-n`; a test case uses its latest run (the text comes from the run's failing steps, note and judgements), a criterion or use case gives its text and the test cases that cover it. The repository is `[github] repo` or the `origin` remote; without one the command exits 3 (`INVALID_CONFIG`) and says to add `[github] repo = "owner/name"`. Nothing is sent to GitHub: the URL is printed, and a person opens it and submits. Fields shortened or left out (length, secrets) are listed as warnings.

| Flag | |
|---|---|
| `--open` | Open the page in the browser. People only: an agent gets exit 2 |
| `--link <url>` | Store an http(s) issue URL in `links` of the test case (a run uses its test case; an AC or UC the use case), once, through the normal definition write; `iw sync` publishes it in workspace mode. Without a repository this alone works and prints no URL |

`data`: `{ "ref": string, "run": string | null, "repo": string | null, "url": string | null, "title"?: string, "keys"?: string[], "trimmed"?: string[], "secrets"?: string[], "link": { "file": string, "key": string, "links": string[], "added": boolean } | null }`. `run` is the run the text comes from; `trimmed` and `secrets` name the fields that were shortened or left out.

### `iw run <tc-ref>`

Execute an `agent` or `hybrid` test case in a browser: Claude follows its steps through a `BrowserProvider` and the run is recorded with `source = "agent"`, a note and a screenshot per step, and one `llm` judgement ([agent execution mode](./agents.md#agent-execution-mode-v02)). Other modes fail with `USAGE` before a browser opens. Available to agents.

| Flag | Default | |
|---|---|---|
| `--browser <local\|cloudflare>` | `local` | `local`: headless Chromium through the project's Playwright (`playwright`, `playwright-core` or `@playwright/test`; `PW_CHROMIUM_PATH` for an installed Chromium). `cloudflare`: Cloudflare Browser Run over CDP with `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` |
| `--base-url <url>` | the environment's `base_url` | Where the browser starts |
| `--model <id>` | `IW_LLM_MODEL`, else `claude-opus-5-5` | Claude model for actions and the judgement |
| `--max-actions <n>` | `15` | Actions per step before the step is `blocked` |
| `--release`, `--env`, `--commit` | | As for `iw record` |

Exit 3 (`INVALID_CONFIG`) without an Anthropic credential or, for `cloudflare`, without the two variables; exit 4 when Playwright is not installed or the browser fails. `data`: `{ "run": RunRecord, "verdict": Verdict, "rule": number }` (as `iw record`)

### `iw review <run-ref>`

Append a `human` judgement to a run. `--verdict <pass|fail|blocked|skipped>` and `--reason <text>` are required. `data`: `{ "judgement": Judgement, "verdict": Verdict }`

### `iw judge <run-ref>`

Ask an LLM to judge a recorded run against the `rubric` of the test case's `llm` judge, and append the answer as an `llm` judgement (`verdict` `pass`/`fail`/`unknown`, `confidence`, `reason`; `by` names the model as an `agent` actor). The model sees the test case's steps (instruction, expected result), the run's step results and notes, and the run's last screenshot (fetched from the store when only a pointer is local). Bundle text, notes and page content are data, not instructions, for the judge. The [decision policy](./concepts.md#decision-policy) then applies as for any `llm` judgement: below `llm_pass_confidence` the run is `needs_review`. A refusal by the model becomes `unknown` with confidence 0. Fails with `USAGE` when the test case declares no `llm` judge, and with `INVALID_CONFIG` when no Anthropic credential is available. Available to agents (it adds a judgement, it does not review).

| Flag | Default | |
|---|---|---|
| `--model <id>` | `IW_LLM_MODEL`, else `claude-opus-5-5` | Claude model |
| `--dry-run` | | Print the judgement without recording it |
| `--visual` | | *v0.2*: compare the run's PNG screenshots with their approved baselines instead of asking an LLM (below) |

**`--visual`** appends one `visual` judgement per compared screenshot ([visual baselines](./concepts.md#visual-baselines)): `pass`, `diff` with `diff_ratio`, or `unknown` when the screenshot has no approved baseline or is not a decodable PNG. Screenshot and baseline blobs that are not local (the default `[store].evidence = "on-demand"` does not pull them) are fetched from the store; a blob found in neither gives `unknown` with the reason `baseline blob not found` or `screenshot blob not found`. It needs no credential, and runs offline when the blobs are local. Fails with `USAGE` when the test case declares no `visual` judge or the run has no PNG screenshot to compare. `data` adds `judgements` (every judgement appended; `judgement` is the first).

Credentials: `ANTHROPIC_API_KEY` (or any credential the Anthropic SDK resolves, such as an `ant auth login` profile). `ANTHROPIC_BASE_URL` routes requests through a gateway (for example Cloudflare AI Gateway). `data`: `{ "judgement": Judgement, "judgements"?: Judgement[], "verdict": Verdict, "recorded": boolean }`

### `iw baseline approve <run-ref>`

*(v0.2)* Approve a run's PNG screenshots as the [visual baselines](./concepts.md#visual-baselines) of its test case: one `baseline` record per screenshot (`--name <evidence name>` approves only that one). Humans only: agents and CI actors exit 2. Fails with `USAGE` when the run has no matching PNG screenshot. `data`: `{ "baselines": BaselineRecord[] }`

### `iw waive <tc-ref>`

Accept a known failure for a release. `--release`, `--reason` required. Applies to the current test case version and records the latest failing run. Rejected for P0 (effective priority) and for agents. `--revoke <waiver-id>` cancels one. `data`: `{ "waiver": WaiverRecord }`

### `iw retract <record-id>`

Agents may only retract records they recorded themselves (same `actor.id`, kind `agent`); otherwise exit 2.

Hide a run or other record recorded by mistake (`--reason` required). `data`: `{ "retraction": RetractionRecord }`

### `iw deployment add`

Record that a build was deployed: `--env <name>` (required), `--release`, `--url`, `--commit` (default: detected). The GitHub Action uses this. `data`: `{ "deployment": DeploymentRecord }`

### `iw fixture add <path> --to <FX>` / `iw fixture fetch <FX>`

Add a data file to a fixture (pointer if large, or with `--blob`) / download pointer blobs into `cache/blobs/` and verify hashes. `add` runs the secret scan first and refuses to create a pointer without a `[store]` unless `--local-only`. `data`: `{ "files": { "name": string, "sha256": string, "pointer": boolean }[] }`

### `iw sync`

Exchange records and blobs between the local replica (`.indx-watch/runs/`) and the store in `project.toml`. With `--snapshot`, also publishes a bundle snapshot when the bundle changed. *(v0.2)* In [workspace mode](./sync.md#workspace-mode-v02) it also publishes changed definition files as `file` records and writes the store's current definitions into the working tree, with conflict files where concurrent edits of one field disagree; it refuses (exit 1, `CONFLICT`) while git tracks files of the bundle. See [sync.md](./sync.md).

| Flag | |
|---|---|
| `--watch` | Keep running; push local writes immediately and poll the store (default every 3 s, `--interval`) |
| `--pull-only`, `--push-only` | `--push-only` skips the workspace-mode apply, so it publishes no definition edits |
| `--evidence <on-demand\|all\|none>` | Override `[store].evidence` |
| `--store <url>` | Override `[store].url` |
| `--snapshot` | Also publish a bundle snapshot for hosted viewers (used by CI on the default branch) |
| `--full` | List the whole store log |

`data`: `{ "pushed": { "records": number, "blobs": number }, "pulled": { "records": number, "blobs": number }, "snapshot": string | null, "cursor": string | null, "warnings"?: string[], "held"?: Problem[], "logSnapshot"?: string, "workspace"?: { "published": string[], "written": string[], "removed": string[], "conflicts": string[], "held": string[] } }`. `workspace` (workspace mode only) lists bundle-relative paths: files published as new versions, written or removed in the working tree, conflict files present after the sync, and changes kept local (an agent's change that is not an AI draft, or a TOML file that does not parse). `logSnapshot` is the key of the [log snapshot](./sync.md#log-snapshots-v02) a full listing started from. Records held back by the secret scan stay local; the command then fails with `SECRETS_FOUND` and carries this `data` too.

### `iw compact`

Write a [log snapshot](./sync.md#log-snapshots-v02) to the store: the newest snapshot plus every readable log object older than the lookback window that it lacks, so fresh clones fetch one object instead of every log object. Needs direct write access (`file://` or `s3://`); a hosted server refuses the upload (`STORE_ERROR`, exit 4). Writes nothing when no log object is new. Safe to run at any time, from any number of places: snapshots are create-only and the log is never changed.

| Flag | |
|---|---|
| `--store <url>` | Override `[store].url` |

`data`: `{ "snapshot": string | null, "written": boolean, "logs": number, "records": number, "warnings"?: string[] }`: the newest snapshot key afterwards, whether this run wrote it, and the log objects and records it holds.

### `iw push`

Upload everything in one step: sync results (like `iw sync`), then publish a bundle snapshot of the current definitions so hosted viewers and `iw clone` get them. This is the terminal side of the web app's [Upload](./web.md#upload). Unlike `iw sync --snapshot`, it publishes even from a dirty working tree or a branch other than the default, because a person asked for it. The snapshot records `dirty: true` and the commit, if there is one. Refused while `iw check` has errors (exit 1, `CHECK_FAILED`). It skips the upload when the definitions are unchanged since the newest snapshot in the store.

| Flag | |
|---|---|
| `--store <url>` | Override `[store].url` |
| `--message <text>` | Free text shown on the Uploads screen |

`data`: `{ "snapshot": string | null, "files": number, "unchanged": boolean, "pushed": { "records": number, "blobs": number }, "url": string | null }`. `url` is the hosted app's Uploads screen when the store is a hosted app.

### `iw clone <source> [dir]`

Create a working copy from a hosted app or a store. `<source>` is either a hosted app URL (`https://watch.shop.test`, read through its `/api/store` endpoints, with an Access token as for any `https://` store) or a store URL (`s3://…`, `file://…`). The command:

1. finds the newest `bundle` record;
2. downloads its tarball;
3. writes it to `<dir>/.indx-watch/` (`dir` defaults to the project key in lower case; it must be empty or missing);
4. sets `[store].url` to `<source>` when the snapshot's `project.toml` names a different store or none;
5. pulls results;
6. prints `cd <dir> && npx indx-watch serve`.

`data`: `{ "dir": string, "snapshot": string, "files": number, "pulled": { "records": number, "blobs": number } }`. With no snapshot in the store it exits 4 (`STORE_ERROR`); a non-empty target directory exits 1 (`CONFLICT`).

### `iw translate [ref]`

Read and write content translations ([i18n](./i18n.md#content-translations)) with the right `source_hash`, so nobody computes hashes by hand.

| Usage | |
|---|---|
| `iw translate TC-3 --locale ja` | List every translatable field of `TC-3` with its source text, its current translation and that translation's state (`missing`, `machine`, `reviewed`, `stale`) |
| `iw translate TC-3 --locale ja --set title="有効なクーポンで合計が下がる" --set steps.1.expected="…"` | Write those fields into `[i18n.ja]` (or into `[steps.i18n.ja]` / `[criteria.i18n.ja]`) and stamp the current `source_hash` |
| `iw translate --missing --locale ja` | List the entities whose translation for `ja` is missing or stale (all kinds) |

Field paths: `title`, `description`, `actor`, `goal`, `preconditions`, `purpose`, `start_note`, `guide`, `steps.<n>.instruction`, `steps.<n>.expected`, `steps.<n>.checks.<m>` (one per check), `fixtures.<n>.note` (all 1-based), `criteria.<AC-key>.text`. *(v0.5)* `iw translate SS-n` works on a shared step (`title`, `steps.<n>.…`); a test case that uses one lists and writes only its own steps (the steps from the shared step keep their numbers but are translated in its file). A write of `checks` must leave every check of the step translated. Only a field with source text can be translated (a path to an absent field is a usage error), and a write drops translations of fields the source no longer has. With `--from <file.json|->`, it reads `{ "<path>": "<text>" }` instead of `--set`. New translations are written with `status = "machine"`; `--reviewed` writes `status = "reviewed"`, and agents may not pass it, because a person reviews. A write refreshes `source_hash` for the whole table, so the fields not passed must already be current. Otherwise it fails and lists them. `iw check` warns when a translation drops a literal from the source, or when a translated `checks` does not have one item per source check.

`data` (list): `{ "ref": string | null, "locale": string, "fields": { "ref": string, "path": string, "source": string, "text"?: string, "state": "missing" | "machine" | "reviewed" | "stale" }[] }`. `data` (write): `{ "ref", "locale", "file", "status", "written": string[] }`.

### `iw notify`

*(v0.5)* Send what changed since the last notification to Slack ([notifications](./integrations.md#notifications)). Meant for CI and cron; run `iw sync --pull-only` (or `iw status --sync`) first so it sees the newest results.

| Flag | |
|---|---|
| `--since <time>` | ISO date-time or a duration (`90m`, `2h`, `1d`) instead of the state's time; for CI jobs without the state file |
| `--state <file>` | State file (default `cache/notify-state.json` in the bundle folder) |
| `--dry-run` | Print the messages; send nothing and keep the state |

`data` (`NotifyData`): `{ "sent": number, "dryRun": boolean, "baseline": boolean, "since": string | null, "messages": { "event": "gate_changed" | "run_failed" | "run_needs_review" | "assigned" | "approval_waiting", "text": string, "url"?: string }[] }`. `baseline` is true on the first run, which writes the state and sends nothing. `sent` is the number of messages posted (0 with `--dry-run`). Missing `[notify] slack_webhook` or an unset environment variable is `INVALID_CONFIG` (exit 3); a refused or failed post is `STORE_ERROR` (exit 4) and keeps the state. Agents may run it with `--dry-run` only; sending needs a person or CI (`CLAUDECODE=1` is refused without `--dry-run`).

### `iw insights`

*(v0.5)* The numbers of the web app's [Insights](./web.md#insights) view, from the one function `insights()` ([definitions](./concepts.md#insights)).

| Flag | Default | |
|---|---|---|
| `--release <version>` | `project.current_release` | The release for the assignee and feature tables |

`data` (`InsightsData`):

```json
{
  "release": "v1.2.0",
  "releases": [ { "version": "v1.1.0", "state": "released", "tests": 8, "passRate": 0.875, "coverage": 1, "flaky": 1, "gate": true } ],
  "assignees": [ { "assignee": "alex@shop.test", "todo": 1, "review": 0, "blocked": 0, "done": 3 }, { "assignee": null, "todo": 2, "review": 0, "blocked": 0, "done": 0 } ],
  "features": [ { "key": "FEAT-1", "title": "Checkout", "tests": 4, "pass": 3, "fail": 1, "open": 0 } ],
  "manual": { "median": 95, "samples": 6, "byRelease": [ { "version": "v1.1.0", "median": 95, "samples": 6 } ] }
}
```

`passRate` and `median` are `null` without a sample; durations are seconds. Text output is one small table per block.

### `iw serve`

If the port is in use, `iw serve` exits at once with `CONFLICT` (exit 1) and suggests `--port <n>`. A `--port` that is not a whole number from 0 to 65535 is a usage error (exit 2).

Start the server and web UI on Node: readiness dashboard, spec tree, test case view, manual runner, run viewer with review, fixture browser, report preview.

| Flag | Default | |
|---|---|---|
| `--port <n>` | `4321` | |
| `--host <addr>` | `127.0.0.1` | Use `0.0.0.0` to share on a LAN (no auth: see [security.md](./security.md)) |
| `--open` | | Open the browser |
| `--sync` | on if `[store]` is set | Run sync in the background |
| `--identity-header <name>` | | Trust this proxy header for the user's email (e.g. `X-Forwarded-Email`). Without it, writes from non-loopback clients are rejected ([security.md](./security.md#shared-servers)). |

Prints the URL. With `--json`, prints `{ "url": string }` once listening and keeps running.

Records come from the local replica through the `node:sqlite` index at `cache/index.sqlite` (the one `iw reindex` builds), always, with no size threshold or flag. On start and after every replica change the server lists `runs/records/` with file times and parses only the files whose record the index does not hold yet, then ingests them; a restart on a large replica therefore reads no record file it already indexed. The API answers exactly as if every file had been read: same records, same order, same `invalid record` warnings (invalid files, and a second file holding a record ID another file already holds, are not indexed and are read again each time). The index remembers each indexed file's path and modification time; when such a file is gone, or its modification time changed in either direction (sync applying the [merge rule](./sync.md#merge-rules) replaces a file), the index is emptied and rebuilt from the replica once. An index file from another schema version is emptied when opened, and one that is not a SQLite database is deleted and created again; if the index still cannot be used, the server reads every replica file, as before. A file rewritten with exactly the same modification time is not noticed: run `iw reindex` or delete `cache/`.

### `iw report`

Without `--out`, `html` and `pdf` reports are written to `report-<release or plan>.<ext>`, and customer reports to `report-<release or plan>.customer.<ext>`.

Render a report offline from the bundle plus the local replica. See [reports.md](./reports.md).

| Flag | Default | |
|---|---|---|
| `--release <version>` | current | |
| `--plan <PLAN>` | | Report on a plan instead |
| `--env <name>` | any | |
| `--format <md\|html\|pdf\|json>` | `md` | `pdf` needs a local Chromium (Playwright) |
| `--out <path>` | stdout for `md`/`json`, `report-<release>.<ext>` otherwise | |
| `--evidence <none\|links\|embed>` | `embed` for `html`, `links` otherwise | |
| `--audience <internal\|customer>` | `internal` | `customer` applies the [redaction rules](./reports.md#sharing-with-customers) |
| `--locale <en\|ja>` | project `source_locale` | Labels and content translations |
| `--evidence-base <url>` | | Prefix for evidence links in `md` |

`data`: `{ "file": string | null, "gate": GateResult, "text"?: string }` — `text` holds the rendered report when `--json` is used without `--out` for `md`/`json`.

### `iw export --full` and `iw import <archive>`

Write / read a portable archive (`.tar.zst`, or `.tar.gz` where zstd is unavailable) with a manifest of SHA-256 hashes, the bundle, all records as NDJSON and all blobs. `import` writes into the current directory (must not contain a bundle unless `--merge`) and verifies every hash; `--dry-run` reports what would change. Archive layout: `manifest.json`, `bundle/**` (definition and data files only; no `cache/`, `runs/`), `records.ndjson` (canonical record JSON, sorted by ID), `blobs/sha256/<aa>/<hash>`. Tar entries have fixed mtime, uid and mode; the manifest hash covers contents, not compression. `data` (export): `{ "archive", "manifest": { "sha256", "files", "records", "blobs" } }`; `import` adds `dryRun` and `changes`.

### `iw import playwright-plan <file.md>`

Turn a [Playwright Test Agents](../research/platform-notes.md#playwright) planner plan (`specs/*.plan.md`, written by the planner's `planner_save_plan` tool) into test cases: one per scenario, under the use case given by `--uc`. The planner is an AI agent, so every test case is written as `iw new tc --origin ai` would write it: `status = "draft"`, `origin = "ai"` and an `[ai]` table with the model from `--model` (or `IW_AGENT_MODEL`; otherwise exit 2) and `skill = "playwright-test-planner"` (override with `--skill`). They count towards nothing until a human runs `iw approve` ([states](./concepts.md#test-case-use-case-fixture)). Example: [`examples/shop/specs/coupon.plan.md`](https://github.com/INDXDev/indx-watch/blob/main/examples/shop/specs/coupon.plan.md).

| Plan | Test case |
|---|---|
| `#### 1.2. should-reject-expired-coupon` | `title = "Should reject expired coupon"` (a hyphenated name becomes words; the numbering is dropped) |
| `**Seed:** \`tests/seed.spec.ts\`` of its `### n. Suite` | `preconditions = "Playwright seed test: tests/seed.spec.ts"` |
| `**Steps:**` `1. <action>` with `- expect: <result>` bullets | one step: `instruction` = the action, `expected` = the results, one per line |
| a step without `- expect:` | joins the next step's `instruction` (trailing ones join the last step) |
| a separate `**Expected Results:**` list (the format shown in the Playwright docs) | the results of the last step |
| — | `covers` = every criterion of `--uc` that is not retired; `mode` from `--mode` (default `manual`) |

`**File:**` lines are ignored: tag the generated test with `@TC-n` to link it ([Playwright guide](../guides/playwright.md#link-tests-to-test-cases-with-tags)). A scenario with no expected result is skipped with a `plan-no-expected` warning; a plan with none to import is `INVALID_INPUT` (exit 2). `--dry-run` and `--merge` apply to archives only, and `--uc`, `--mode`, `--model` and `--skill` to plans only (exit 2). Keys are the next free ones, as with `iw new`.

| Flag | |
|---|---|
| `--uc <UC>` | Required. Parent use case |
| `--model <id>` | Model the planner ran with (default `IW_AGENT_MODEL`) |
| `--skill <name>` | Default `playwright-test-planner` |
| `--mode <mode>` | Default `manual` |

`data`: `{ "plan": string, "uc": string, "created": { "kind", "id", "key", "file" }[] }`

### `iw import testrail <cases.csv>`

*(v0.5)* Turn a TestRail case export (CSV) into drafts: one use case per section, one acceptance criterion and one test case per case. Nothing counts until a person runs `iw approve` ([states](./concepts.md#test-case-use-case-fixture)): every item is `origin = "import"` and `status = "draft"` (criteria too). The columns are read by their header, case-insensitively ([export format](../research/platform-notes.md#testrail-and-testomatio-exports)); other columns are ignored.

| TestRail column | INDX Watch |
|---|---|
| `Section Hierarchy` (else `Section`) | one use case per distinct value, titled by its last part (`Checkout > Payment` → "Payment"); no section → "Imported from TestRail". It goes under `--feature` (default: the only feature, else `FEAT-1`), as with `iw new uc`. `notes` names the source |
| `Priority` | the use case gets the highest of its cases (`Critical` P0, `High` P1, `Medium` P2, `Low` P3; none → P1). A test case may not be lower than its use case, so test cases carry no priority of their own |
| `Title` | the criterion text and the test case `title`; the criterion is the one the test case `covers` |
| `Preconditions` | `preconditions` |
| `Steps (Step)` / `Steps (Separated)` / `Steps` and `Steps (Expected Result)` / `Expected Result` | one step per row. A case row with a title starts a case; the rows under it with an empty title add steps (separated steps). With a single `Steps` and `Expected Result` cell the case has one step |
| `ID` (`C123`) | `x.import = { source = "testrail", id = "C123" }` on the test case. Without an `ID` column the id is the section path and title |

The test cases are `mode = "manual"`. A step without an expected result gets "Describe the expected result." and a `import-no-expected` warning; a case with no steps is skipped with `import-no-steps`. A file with no importable case is `INVALID_INPUT` (exit 2), as is a file without a `Title` column. **Importing again changes nothing**: a case whose `x.import` id is already in the bundle is skipped and counted in `skipped`. Keys are the next free ones, as with `iw new`. When the actor is an agent the items are written as AI drafts (`origin = "ai"`, `--model` or `IW_AGENT_MODEL` required) instead, because agents never write `origin = "import"`.

| Flag | |
|---|---|
| `--feature <FEAT>` | Parent feature of the new use cases |
| `--model <id>`, `--skill <name>` | Agents only: the AI marker (`skill` default `import-testrail`) |

`--dry-run`, `--merge` and `--uc` apply to other imports (exit 2). `data`: `{ "source": "testrail", "files": string[], "created": { "kind", "id", "key", "file" }[], "skipped": number }`.

### `iw import testomatio <dir|file.md>`

*(v0.5)* Turn testomat.io [classical Markdown](../research/platform-notes.md#testrail-and-testomatio-exports) (the files its export and `check-tests` write, `*.md` in a folder, or one file) into the same drafts as `iw import testrail`: one use case per suite, one criterion and one test case per test.

| testomat.io | INDX Watch |
|---|---|
| `<!-- suite … -->` and the `# Title` after it | a use case (a leading `# Title` with no block is a suite too) |
| `<!-- test … -->` and the `# Title` (or `##`) after it | a criterion and a test case with that title; the text under the heading is ignored |
| `## Steps` list: a top-level item, with `*Expected*: …` lines under it | one step each; several `Expected` lines are joined, one per line |
| `priority:` (`critical` P0, `high` and `important` P1, `normal` P2, `low` P3) | the use case's priority, as for TestRail |
| `tags:` | `tags` of the test case (lower case, other characters become `-`) |
| `id: @T…` | `x.import = { source = "testomatio", id = "@T…" }`, so a second import skips it |
| `<!-- example -->` tables | ignored |

`import-no-expected`, `import-no-steps`, repeat imports, agents and flags work as for `iw import testrail`; `files` lists the Markdown files read. `data`: `{ "source": "testomatio", "files": string[], "created": …, "skipped": number }`.
### `iw import github-issue <number | URL>`

*(v0.5)* Import one GitHub issue as one **draft** use case ([GitHub issues](./integrations.md#github-issues)): `origin = "import"` (an agent writes `origin = "ai"` with `--model`), the issue title as `title`, `links = [<issue URL>]`, and one draft criterion per task-list item (`- [ ] …`, ticked or not). A rendered [test request form](./integrations.md#issue-forms) also sets `actor`, `goal` and `priority`; otherwise the actor is `User`, the goal the title and the priority the label `P0`–`P3` or `P2`. A number needs the repository (`[github] repo` or the `origin` remote). The issue is read through the `IssueSource` port: the REST adapter (`GITHUB_TOKEN` when set; none for public repositories), or `--from`. An issue with no task list is `INVALID_INPUT` (exit 2) and points to `/iw-design`. The same issue again changes nothing: `created` is `null` and `existing` names the use case.

| Flag | |
|---|---|
| `--from <file.json\|->` | The output of `gh issue view <n> --json title,body,labels,url` instead of the API |
| `--feature <FEAT>` | Feature (key or title) of the new use case; default: the feature a label names, else the only feature, else exit 2 |
| `--model`, `--skill` | For an agent's draft (`--skill` defaults to `iw-design`) |

`data`: `{ "issue": string, "created": { "kind", "id", "key", "file" } | null, "existing": string | null, "criteria": number }`

### `iw deploy`

Deploy the same server to Cloudflare Workers with R2 (store) and D1 (index), using `wrangler`. Idempotent: lists existing resources before creating any. See [guides/self-host-cloudflare.md](../guides/self-host-cloudflare.md).

| Flag | |
|---|---|
| `--dry-run` | Print the resources and the exact `wrangler` commands, change nothing |
| `--name <worker>` | Overrides `[hosting].name` |
| `--public` | Allow deploying without Cloudflare Access: a read-only demo, *(v0.5)* anonymous visitors can only read ([public deploys](./security.md#public-deploys)) |

*(v0.5)* The Worker is deployed with the version of the CLI that runs `iw deploy` as the variable `IW_VERSION`, so `GET /healthz` answers `{ "ok": true, "version": "0.1.3" }` and `GET /api/project` has `server.version`. `iw doctor --online` reads it back; the web app tells leads when the project pins a newer version than the app runs ([version notice](./web.md#version-notice)).

`data`: `{ "resources": { "type": "r2" \| "d1" \| "worker", "name": string, "exists": boolean }[], "commands": string[], "url": string | null }`

*(v0.5)* With `.indx-watch/patches/patches.toml`, `iw deploy` deploys the patched build from `cache/patched/dist` instead of the package's own `dist/`, and stops with `INVALID_CONFIG` when it was not built from the current patch files (run `iw patch apply`). The Worker then reports its [patched build](./security.md#patched-servers).

### `iw patch`

*(v0.5)* Keep your own changes to INDX Watch as patches against the upstream source, so you can still update ([customizing](../guides/customize.md#level-3-patches), [fork guide](../guides/fork.md)). Needs `git` and `pnpm` on the PATH (`EXTERNAL_TOOL` names which). `patches/patches.toml` records `base = "x.y.z"`, the upstream version (git tag `v<x.y.z>` of `source`, default `INDXDev/indx-watch`) the patches were made against, which is `[tool] indx_watch`.

| Command | |
|---|---|
| `iw patch create <name>` | Prepare the upstream source at `v<base>` in `cache/upstream/` (once), then turn the edits made there (`git diff`) into `patches/NNNN-<name>.patch`. First call: prepares the folder and prints where to edit. |
| `iw patch apply` | Apply every patch in order to a clean copy (`git apply --3way`), install and build it, and write the result to `cache/patched/dist/` with the patch-set hash (`patched.json`). `--dry-run` only applies, without building. |
| `iw patch check [--to <version>]` | Dry-run the patches against `v<version>` (default: `base`). Exit 1 (`CONFLICT`) and the conflicting files when one does not apply; a refused file exits 2 (`INVALID_INPUT`). `iw update` runs this first. |

A patch that touches a refused file is rejected by `create`, `apply` and `check`, listing the files: the verdict, gate and status rules (`packages/core/src/decide.ts`, `status.ts`, `roles.ts`), signing and identity (`packages/bundle/src/sign.ts`, `seal.ts`; `packages/server/src/oidc.ts`, `store-routes.ts`; `packages/store/src/node/identity.ts`, `packages/store/src/workers/index.ts`, `packages/store/src/adapters/github-oidc.ts`) and the secret scan (`packages/bundle/src/check.ts`). There is no override: a patched build's verdicts, gate, signatures and secret checks must stay those of upstream, or its results would not be comparable.

`data`: `{ "action": "create" \| "apply" \| "check", "base": string, "to": string | null, "patches": { "file": string, "files": string[], "refused": string[], "applies": boolean | null }[], "conflicts": string[], "patch_hash": string | null, "dist": string | null }`

### `iw reindex`

Drop and rebuild the local index from the bundle and the local replica. The index is a `node:sqlite` database at `cache/index.sqlite` (same schema as the D1 index; safe to delete). The file records a schema version (`PRAGMA user_version`); a file written with another schema is emptied when opened and rebuilt in the current one. `iw serve` reads its records from this index and keeps it current ([`iw serve`](#iw-serve)). `data`: `{ "records": number, "definitions": number, "ms": number }`

### `iw migrate`

Upgrade the bundle to the current `schema_version`. In v0.1 there is only version 1, so it verifies the version and changes nothing. `data`: `{ "from": number, "to": number, "changed": string[] }`

### `iw mcp`

Start the MCP server on stdio. See [agents.md](./agents.md#mcp-server). `iw serve` and the hosted server serve the same tools over Streamable HTTP at `/mcp`.

### `iw skills install`

Set up the repository root (the git root, else the directory above `.indx-watch/`, else the current directory) for coding agents ([agents.md](./agents.md#install)): the shipped skills, the project MCP server `indx-watch` (`npx -y indx-watch@<version> mcp`; *(v0.5)* `<version>` is `[tool] indx_watch`, else the running version, and an unpinned `.mcp.json` entry is migrated to it) and a marked block in `AGENTS.md`.

| Flag | Writes |
|---|---|
| `--claude` | `.claude/skills/<name>/`, `.mcp.json` (`mcpServers.indx-watch`), the `@AGENTS.md` line in an existing `CLAUDE.md` that lacks it |
| `--force` | Overwrite locally edited skill copies too |
| `--codex` | `.agents/skills/<name>/` with portable frontmatter and `agents/openai.yaml`, `.codex/config.toml` (`[mcp_servers.indx-watch]`) |
| (neither) | Both of the above |

Both write the `<!-- indx-watch:start -->` … `<!-- indx-watch:end -->` block of `AGENTS.md` (created if missing). Re-running rewrites only what the command owns: the skill folders it installs, the `indx-watch` server entries and the marked block; other servers, tables and text stay as they are. An existing `[mcp_servers.indx-watch]` table is left unchanged. It also removes the folders of the recipe skills that indx-watch 0.1 installed and that INDX Watch wrote, so an upgrade converges on the same skills ([agents.md](./agents.md#install)); a changed one stays with an `agent-config` warning. A `.mcp.json` or `.codex/config.toml` that does not parse is skipped with an `agent-config` warning. *(v0.5)* Each skills folder gets a manifest `.indx-watch.json` (`{ "version", "files": { "<name>/<path>": "<sha256>" } }`) that records the package version and what was written; a skill folder with a file changed since then is *locally edited*: it is skipped with an `agent-config` warning (`--force` overwrites it). `data`: `{ "installed": string[], "files": string[], "removed": string[], "skipped"?: string[] }`: the skill folders, the files created or changed by this run (empty when nothing changed), the retired skill folders it removed and *(v0.5)* the locally edited folders it left alone.

### `iw doctor`

*(v0.5)* Is everything that pins INDX Watch on the same version? A read-only report that changes nothing and, by default, makes no network call. It compares each pinned part with the **target**: `[tool] indx_watch` when the project has one, else the running version.

| Flag | |
|---|---|
| `--online` | Also ask for the newest published version (`ReleaseSource`: the npm registry) and read `/healthz` of the hosted app when `[store].url` is an `https://` URL. A failed request is a note, never an error |

Parts and states (`ok`, `outdated`, `unpinned`, `locally-edited`):

| Part | What is read | State |
|---|---|---|
| `tool` | `[tool] indx_watch` in `project.toml` | `unpinned` without it; with `--online`, `outdated` when a newer version exists |
| `cli` | the running CLI | `outdated` when older than the pin |
| `package` | the `indx-watch` entry of `package.json` (`dependencies`, `devDependencies`) | `outdated` when older than the target; absent entries are not listed |
| `mcp` | `.mcp.json` `mcpServers.indx-watch` | `unpinned` for `npx -y indx-watch mcp`, `outdated` when the pinned version is older than the target |
| `skills` | `.claude/skills/` and `.agents/skills/` | `locally-edited` when a file differs from its manifest hash; `outdated` when the manifest version is older; `unpinned` without a manifest (installed before v0.5) |
| `workflow` | `version:` inputs of `INDXDev/indx-watch` steps and `indx-watch@x.y.z` in `.github/workflows/*.yml` | `outdated` when older; a workflow that names none follows `[tool]` (the action reads it) and is `unpinned` only without `[tool]` |
| `worker` | `GET /healthz` of the hosted app (`--online` only) | `outdated` when older than the target |

`data`: `{ "version": string, "pinned": string | null, "latest": string | null, "ok": boolean, "parts": { "part": string, "target": string, "version": string | null, "state": "ok" | "outdated" | "unpinned" | "locally-edited", "note"?: string }[], "releases": { "version": string, "breaking": boolean, "migrate": boolean }[] }`. `ok` is true when every part is `ok`; `releases` lists the releases after the target that the package knows (`releases.json`, generated from `CHANGELOG.md` at build time; `breaking` and `migrate` mark the ones to read first). The exit code is 0 either way; read `ok`. The next step for anything but `ok` is [`iw update`](#iw-update).

### `iw update`

*(v0.5)* Bring every pinned part to one version, in this order. Each step is idempotent: a second run changes nothing.

| Flag | |
|---|---|
| `--to <version>` | Target (default: the running version, so `npx indx-watch@latest update` updates to the newest; `latest` asks `ReleaseSource`). A version other than the running one skips step 3, because the skills ship inside the package that runs |
| `--dry-run` | Print every change, write nothing |
| `--deploy` | Run [`iw deploy`](#iw-deploy) at the end (with `--dry-run`: its dry run) |
| `--workflow` | Only write `.github/workflows/indx-watch-update.yml` ([weekly update pull request](../guides/github-actions.md#keep-indx-watch-up-to-date)) when it is missing, and nothing else |

1. `[tool] indx_watch` in `project.toml` (added when missing).
2. `package.json`: the `indx-watch` entry keeps its `^` or `~` and gets the target; then the install command of the detected package manager is printed (`data.install`). `iw update` never runs it.
3. `iw skills install`: skill copies, `.mcp.json` pin and the `AGENTS.md` block; locally edited skill copies are skipped with a warning.
4. `version:` inputs and `indx-watch@x.y.z` of workflows.
5. `#:schema` URLs of the bundle move to the tag `v<target>`.
6. `iw migrate`, only when a release after the old pin has `migrate` in `releases.json` or the bundle's `schema_version` is behind.
7. `iw check`: errors make the command exit 1 (`CHECK_FAILED`) after the files are written.
8. With `--deploy`, `iw deploy`.

Before step 1 the patches of the project must still apply: `iw patch check --to <target>` (T-508); any failing patch refuses the update (exit 1, nothing written). `data`: `{ "from": string | null, "to": string, "dryRun": boolean, "steps": { "step": "tool" | "package" | "skills" | "workflow" | "schema" | "migrate" | "check" | "deploy", "changed": string[], "note"?: string }[], "install": string | null, "notes": string }`; `notes` is the changelog excerpt of the releases between the old pin and the target (also used as the pull request text).

### `iw keygen`

Create an Ed25519 key pair for [signed records](./security.md#signed-records). Prints the `[[signing_keys]]` entry to add to `project.toml` (public; commit it; run `iw fmt` afterwards so the file stays canonical) and the secret to set as `IW_SIGNING_KEY` on the hosted Worker (`wrangler secret put IW_SIGNING_KEY`) or in CI. The secret is printed once and stored nowhere; never commit it (the secret scan reports it). In the rare case that `iw check` reports the new public key as a possible secret (about one key in 200,000 looks like an API key), run `iw keygen` again.

| Flag | Default | |
|---|---|---|
| `--kid <id>` | `iw-<date>` | Key ID (letters, digits, `.`, `_`, `-`; at most 64) |
| `--via <list>` | all | Comma-separated verified `via` values the key may vouch for: `cloudflare-access`, `github-oidc`, `github`, `gitlab`, `circleci`, `buildkite` |
| `--secrets` | | *(v0.5)* Instead, print a new `IW_SECRETS_KEY` for the server that keeps `iw:` secrets ([security](./security.md#secrets)); `data`: `{ "secret": string }` |

`data`: `{ "kid": string, "public_key": string, "via"?: string[], "secret": string, "toml": string }`

### `iw login <url>` *(thin wrapper)*

Runs `cloudflared access login <url>` so later commands can obtain a token with `cloudflared access token -app=<url>`. INDX Watch stores nothing itself. `data`: `{ "url": string }`

## Environment variables

| Variable | Used by | |
|---|---|---|
| `IW_DIR` | all | Bundle location |
| `IW_ACTOR`, `IW_ACTOR_NAME` | writes | Override identity (`alice@example.com`) |
| `IW_ACTOR_KIND` | writes | `human`, `ci`, `agent` |
| `IW_AGENT_MODEL` | writes | Model ID recorded on agent writes |
| `IW_RELEASE`, `IW_ENV` | writes, status, report | Scope defaults |
| `IW_STORE` | sync | Store URL override |
| `AWS_*` | S3 store | Standard AWS SDK credential chain |
| `IW_ACCESS_TOKEN` | http store | Pre-obtained Cloudflare Access token |
| `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET` | http store | Access service token (CI) |
| `IW_COMMIT` | writes | Build commit when git is unavailable |
| `IW_CHECK_RUN_ID` | writes (GitHub Actions) | `${{ job.check_run_id }}`: makes `ci.url` link to the job instead of the run |
| `IW_RUN_GROUP` | reporter | Groups runs of one execution (default: CI run + attempt, or one per invocation) |
| `IW_RELEASES` | doctor, update | *(v0.5)* Path of a `releases.json` replacing the one shipped in the package (tests) |
| `IW_NOW` | report | Fixed "generated at" time for reproducible reports |
| `IW_SIGNING_KEY` | writes, serve, reporter | Secret from `iw keygen`: sign every record written ([signed records](./security.md#signed-records)) |
| `IW_SECRETS_KEY` | serve | *(v0.5)* Secret from `iw keygen --secrets`: seal and open `iw:` secrets ([security](./security.md#secrets)) |
| `IW_OIDC_SIGNER` | writes, reporter (GitHub Actions) | Hosted server URL: with `id-token: write` and no `IW_SIGNING_KEY` or `IW_ACTOR`, record `via = "github-oidc"` and sign through the server ([GitHub OIDC](./security.md#github-oidc)) |
| `IW_ACCESS_POLICY`, `CLOUDFLARE_API_TOKEN` | invite | The Access policy (`<account id>/<policy id>`) and an API token with *Access: Apps and Policies Write* ([customer UAT](./security.md#customer-uat)) |
| `CLOUDFLARE_API_BASE_URL` | invite | Replaces `https://api.cloudflare.com/client/v4` (an `https://` or loopback URL; tests use a fake API) |
| `IW_LLM_MODEL` | judge | Model for `iw judge` (default `claude-opus-5-5`) |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL` | judge | Anthropic credential and optional gateway URL |

## Acceptance criteria

- [x] `iw patch create` prepares the upstream source at `v<base>`, turns the edits into `patches/NNNN-<name>.patch` and `patches.toml`, and refuses a file of the refused list; `check --to` exits 1 naming the conflicting files and 2 for an unknown version; `apply` builds `cache/patched/dist` with the patch-set hash and `iw deploy` stops while it is stale; a missing git or pnpm exits 4 naming it (tests with a local git repository and a fake pnpm).
- [x] Every command supports `--json` and its output validates against the schema in `packages/cli/src/json.ts` (tested for each command).
- [x] Exit codes match the table for: valid bundle (0), invalid bundle (1), unknown flag (2), missing bundle (3), unreachable store (4).
- [x] `iw new tc --uc UC-2 --title "x" --origin ai --model m --json` creates a `draft` file with `origin = "ai"` and an `[ai]` table, and `iw check` passes.
- [x] `iw new feature|env|release|plan` by an agent writes `origin = "ai"` and an `[ai]` table; `iw check` warns `ai-not-approved` until a human runs `iw approve` on it.
- [x] In an empty directory, `iw init` → `iw new uc --title "Guest applies a coupon" --ac "A valid coupon reduces the total" --ready` → `iw new tc --uc UC-1 --title "Valid coupon" --step "Apply SUMMER10 => Total drops by 10%" --ready` → `iw check` exits 0.
- [x] `iw approve TC-9` with `IW_ACTOR_KIND=agent` exits 2.
- [x] `iw baseline approve <run>` with `IW_ACTOR_KIND=agent` exits 2; by a human it writes a `baseline` record, and `iw judge <run> --visual` then appends `visual` judgements (`pass` for the same image, `diff` with `diff_ratio` for a changed one).
- [x] `iw record TC-3 --verdict pass --evidence shot.png --json` writes one record to the local replica and stores the blob under its SHA-256.
- [x] *(v0.5)* `iw doctor --json` on a temp copy of the shop reports `unpinned` for the project, an unpinned `.mcp.json` and skill copies without a manifest, and `ok` for each after `iw update`; a skill file edited by hand is `locally-edited`; it makes no network call without `--online` (tests).
- [x] *(v0.5)* `iw update --to <v>` writes `[tool]`, the `package.json` entry, `.mcp.json`, workflow versions and `#:schema` tags, prints the install command, and a second run changes nothing; `--dry-run` writes nothing; a locally edited skill copy is skipped with a warning; `iw update --workflow` writes a workflow that parses and refuses to overwrite one (tests).
- [x] No command prompts when stdin is not a TTY.
- [x] `iw impact --changed examples/shop/tests/coupon.spec.ts --json` in a copy of the shop suggests TC-3 and TC-4 with an `automation` reason, and the human output is the "Suggested test cases" Markdown section; without `--changed` or `--base` it exits 2.
- [x] `iw init --github` in an empty directory writes `indx-watch.yml` and `indx-watch-deploy.yml` and names `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`; a second run writes nothing, keeps edited files and names no secret (CLI test on a temp copy of the shop).
- [x] `iw diff --base HEAD` after editing one step of TC-3 in a copy of the shop lists TC-3 under "Changed" with `steps`; without `--base` it exits 2.
- [x] `iw import playwright-plan examples/shop/specs/coupon.plan.md --uc UC-2 --model m` in a copy of the shop creates one `draft`, `origin = "ai"` test case per scenario, and `iw check` reports 0 errors.
- [x] `iw import testrail` on a small export with separated steps creates a draft use case per section and a draft criterion and test case per case, `iw check` reports 0 errors, and a second import creates nothing and reports `skipped` (CLI test).
- [x] `iw import testomatio` on a folder of classical Markdown creates the same drafts from suites and tests, joins several `Expected` lines and warns about a step without one (CLI test).
- [x] `iw new ss --title "Sign in" --step "Open Sign in => The form opens"` creates `steps/SS-n-sign-in.toml`; a test case step `use = "SS-n"` is expanded by `iw show`, an unknown or looping one fails `iw check`, and editing the shared step changes the version of every test case that uses it (bundle tests).
- [x] *(v0.5, T-515, T-516)* `iw assign --plan PLAN-1 --split alex@shop.test:2,sam@shop.test:1,agent:claude:1` on a copy of the shop assigns 3, 2 and 2 items deterministically (alex first his own features), `--dry-run` writes nothing and works for agents, writing as an agent exits 2, and `iw status --json` has `automation` (`packages/cli/test/cli-assign.test.ts`, `packages/core/test/assign.test.ts`).
