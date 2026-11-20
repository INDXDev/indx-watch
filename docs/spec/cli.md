# CLI (`iw`)

`iw` is the command-line interface of the `indx-watch` npm package. `npx indx-watch <command>` and `iw <command>` are the same. Every command works offline unless it talks to a store or Cloudflare.

## Conventions

| Topic | Rule |
|---|---|
| Bundle discovery | Walk up from the current directory to find `.indx-watch/`. Override with `--dir <path>` or `IW_DIR`. |
| Output | Human-readable by default. `--json` prints exactly one JSON document to stdout (the **envelope** below) and nothing else; logs go to stderr. |
| Color | Off when stdout is not a TTY or `NO_COLOR` is set. |
| Identity | See [security.md](security.md#identity). Override with `IW_ACTOR`, `IW_ACTOR_KIND`, `IW_AGENT_MODEL`. |
| Keys and IDs | Wherever a command takes `<ref>`, it accepts a human key (`TC-3`), a machine ID (`tc_01J…`), or a cross-project key (`SHOP:TC-3`). Runs are referenced by ID or a unique prefix of ≥ 8 characters after `run_`; runs recorded together share the ULID timestamp prefix, so scripts and agents should pass the full ID. |
| Agents | When the actor is an agent (see [security.md](security.md#identity)), `iw approve`, `iw review` and `iw waive` exit 2. |
| Running tests | v0.1 has no test executor: automated tests run with Playwright and the [reporter](integrations.md#playwright-reporter); people run tests in the browser runner; anything else is recorded with `iw record`. An `iw run` executor arrives with the agent mode in v0.2. |
| Non-interactive | Commands never prompt when stdin is not a TTY or `--yes` is given; missing input is an error (exit 2). |

### JSON envelope

```json
{ "ok": true, "command": "check", "data": { }, "warnings": [] }
```

```json
{ "ok": false, "command": "check", "error": { "code": "CHECK_FAILED", "message": "3 problems in 2 files", "details": [] } }
```

`warnings` and `error.details` items are **problems**:

```json
{ "severity": "error", "code": "unknown-key", "file": "specs/FEAT-2-checkout/UC-2-guest-applies-coupon/TC-3-valid-coupon.toml", "path": "steps[0].expectd", "message": "Unknown key \"expectd\". Did you mean \"expected\"?" }
```

The shapes are defined as Zod schemas in [`packages/cli/src/json.ts`](../../packages/cli/src/json.ts) (`CommandData`, `ErrorEnvelope`), which is the field-level reference; the `data` lines below summarize them. They are part of the public contract: additive changes only within a major version. When the answer is "no" (`check` with errors, `status --gate` failing), the error envelope also carries the command's `data`.

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

`data`: `{ "dir": string, "files": string[] }`

### `iw check`

Validate the whole bundle: schemas, canonical formatting, references (`covers`, fixture refs, plan items), duplicate keys and IDs, AI approval rule, secret scan, unknown files.

| Flag | |
|---|---|
| `--fix` | Canonicalize files, regenerate slugs, renumber duplicate keys (prints mapping) |
| `--strict` | Treat warnings as errors |

Reference checks: see [concepts invariants](concepts.md#invariants).

`data`: `{ "files": number, "errors": number, "warnings": number, "problems": Problem[], "changed": string[], "renumbered": { "from": string, "to": string, "id": string }[] }`

### `iw fmt [paths...]`

Rewrite files in canonical form. Equivalent to the formatting part of `check --fix`. `data`: `{ "changed": string[] }`

### `iw new <kind>`

When the actor is an agent, `uc`, `ac`, `tc` and `fixture` are always created as `origin = "ai"` drafts: `--origin human|import` and `--ready` are rejected, and the model comes from `--model` or `IW_AGENT_MODEL` (otherwise exit 2). A new use case defaults to priority `P1`.

Create a definition file with a fresh ID and the next free key. Kinds: `feature`, `uc`, `ac`, `tc`, `fixture`, `env`, `release`, `plan`.

| Flag | Applies to | |
|---|---|---|
| `--title <text>` | all | Required in non-interactive use |
| `--feature <FEAT>` | `uc` | Parent feature (default: the only feature, or `FEAT-1`) |
| `--actor <text>`, `--goal <text>` | `uc` | Default: "User" and the title |
| `--ac <text>` | `uc` | Repeatable; at least one acceptance criterion is required |
| `--step "<instruction> => <expected>"` | `tc` | Repeatable; without it (and without `--template`/`--from`) one placeholder step is written and the file stays `draft` |
| `--uc <UC>` | `ac`, `tc` | Parent use case (`ac` appends a criterion) |
| `--text <text>` | `ac` | Criterion text |
| `--covers <AC,...>` | `tc` | Default: all ACs of `--uc` |
| `--mode <mode>` | `tc` | Default `manual` |
| `--priority <P0-P3>` | `uc`, `tc` | |
| `--kind <kind>` | `fixture` | `dataset`, `seed`, `file`, `account` |
| `--template <name>` | `tc`, `uc`, `fixture` | From `templates/` |
| `--from <file.toml\|->` | all | Merge field values from a TOML/JSON file or stdin (agents use this) |
| `--ready` | `uc`, `tc`, `fixture` | Create as `ready` (humans only; rejected with `--origin ai`). Default `draft`. |
| `--origin ai --model <id> [--skill <name>]` | `uc`, `ac`, `tc`, `fixture` | Marks the item as AI-written (`origin = "ai"`, `[ai]` table, `draft`; for `ac`, a criterion with `status = "draft"`) |

`data`: `{ "kind": string, "id": string, "key": string, "file": string }`

### `iw approve <ref>`

For an acceptance criterion, `approve` sets `status = "ready"` and `approved_by` (criteria have no `approved_version`); the returned `version` is the use case's content hash.

Approve a draft use case, test case or fixture (or a draft acceptance criterion): sets `status = "ready"`, `approved_by` from your identity and `approved_version`. Refused for agents. `data`: `{ "ref", "file", "version", "approved_by" }`

### `iw status`

Compute coverage, use case status and the readiness gate for a scope.

| Flag | Default | |
|---|---|---|
| `--release <version>` | `project.current_release` | |
| `--env <name>` | any | |
| `--gate` | | Exit 1 if the gate fails |
| `--sync` | | Run `iw sync` first |

`data`:

```json
{
  "scope": { "release": "v1.2.0", "environment": null },
  "gate": { "passed": false, "checks": [ { "key": "p0_all_pass", "passed": false, "actual": "3/4", "expected": "4/4" } ] },
  "coverage": { "covered": 8, "total": 9, "ratio": 0.889 },
  "useCases": [ { "key": "UC-2", "title": "…", "priority": "P0", "status": "fail", "criteria": [ { "key": "AC-2.1", "status": "pass", "testCases": ["TC-3"] } ] } ],
  "testCases": [ { "key": "TC-3", "status": "pass", "latestRun": "run_01J…", "stale": false } ],
  "counts": { "pass": 5, "fail": 1, "needs_review": 1, "untested": 2, "stale": 0, "waived": 0, "uncovered": 1 }
}
```

### `iw show <ref>`

Show one entity with resolved references, current version hash and recent runs. `--versions` lists versions from git history. `data`: the entity object as in the [programmatic model](../architecture.md#core-model) plus `runs`.

### `iw list <kind>`

List `features`, `ucs`, `tcs`, `fixtures`, `envs`, `releases`, `plans`, `runs`. Filters: `--status`, `--tag`, `--priority`, `--mode`, `--uc`, `--tc`, `--release`, `--limit`. `data`: `{ "items": object[] }`

### `iw record <tc-ref>`

Record a run that was executed outside the browser runner — by a person in a terminal or by an agent.

| Flag | |
|---|---|
| `--verdict <pass\|fail\|blocked\|skipped>` | Executor's reported result; becomes a judgement of the executor's kind (`human` for people, `llm` for agents with `--confidence`) |
| `--step <n>=<status>[:note]` | Repeatable |
| `--evidence <path>[@step]` | Repeatable; files are hashed into the local replica |
| `--note <text>` | |
| `--confidence <0-1>` | Agents only |
| `--release`, `--env`, `--commit` | Override detection |
| `--rows <key,...>` | Dataset rows used |
| `--from <run.json\|->` | Full run input as JSON (see [sync.md](sync.md#run-record)) |

`data`: `{ "run": RunRecord, "verdict": Verdict }`

### `iw review <run-ref>`

Append a `human` judgement to a run. `--verdict <pass|fail|blocked|skipped>` and `--reason <text>` are required. `data`: `{ "judgement": Judgement, "verdict": Verdict }`

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

Exchange records and blobs between the local replica (`.indx-watch/runs/`) and the store in `project.toml`. In git mode, also publishes a bundle snapshot when the bundle changed. See [sync.md](sync.md).

| Flag | |
|---|---|
| `--watch` | Keep running; push local writes immediately and poll the store (default every 3 s, `--interval`) |
| `--pull-only`, `--push-only` | |
| `--evidence <on-demand\|all\|none>` | Override `[store].evidence` |
| `--store <url>` | Override `[store].url` |
| `--snapshot` | Also publish a bundle snapshot for hosted viewers (used by CI on the default branch) |
| `--full` | List the whole store log |

`data`: `{ "pushed": { "records": number, "blobs": number }, "pulled": { "records": number, "blobs": number }, "snapshot": string | null, "cursor": string | null, "warnings"?: string[], "held"?: Problem[] }`. Records held back by the secret scan stay local; the command then fails with `SECRETS_FOUND` and carries this `data` too.

### `iw serve`

If the port is in use, `iw serve` exits at once with `CONFLICT` (exit 1) and suggests `--port <n>`.

Start the server and web UI on Node: readiness dashboard, spec tree, test case view, manual runner, run viewer with review, fixture browser, report preview.

| Flag | Default | |
|---|---|---|
| `--port <n>` | `4321` | |
| `--host <addr>` | `127.0.0.1` | Use `0.0.0.0` to share on a LAN (no auth: see [security.md](security.md)) |
| `--open` | | Open the browser |
| `--sync` | on if `[store]` is set | Run sync in the background |
| `--identity-header <name>` | | Trust this proxy header for the user's email (e.g. `X-Forwarded-Email`). Without it, writes from non-loopback clients are rejected ([security.md](security.md#shared-servers)). |

Prints the URL. With `--json`, prints `{ "url": string }` once listening and keeps running.

### `iw report`

Without `--out`, `html` and `pdf` reports are written to `report-<release or plan>.<ext>`, and customer reports to `report-<release or plan>.customer.<ext>`.

Render a report offline from the bundle plus the local replica. See [reports.md](reports.md).

| Flag | Default | |
|---|---|---|
| `--release <version>` | current | |
| `--plan <PLAN>` | | Report on a plan instead |
| `--env <name>` | any | |
| `--format <md\|html\|pdf\|json>` | `md` | `pdf` needs a local Chromium (Playwright) |
| `--out <path>` | stdout for `md`/`json`, `report-<release>.<ext>` otherwise | |
| `--evidence <none\|links\|embed>` | `embed` for `html`, `links` otherwise | |
| `--audience <internal\|customer>` | `internal` | `customer` applies the [redaction rules](reports.md#sharing-with-customers) |
| `--locale <en\|ja>` | project `source_locale` | Labels and content translations |
| `--evidence-base <url>` | | Prefix for evidence links in `md` |

`data`: `{ "file": string | null, "gate": GateResult, "text"?: string }` — `text` holds the rendered report when `--json` is used without `--out` for `md`/`json`.

### `iw export --full` and `iw import <archive>`

Write / read a portable archive (`.tar.zst`, or `.tar.gz` where zstd is unavailable) with a manifest of SHA-256 hashes, the bundle, all records as NDJSON and all blobs. `import` writes into the current directory (must not contain a bundle unless `--merge`) and verifies every hash; `--dry-run` reports what would change. Archive layout: `manifest.json`, `bundle/**` (definition and data files only; no `cache/`, `runs/`), `records.ndjson` (canonical record JSON, sorted by ID), `blobs/sha256/<aa>/<hash>`. Tar entries have fixed mtime, uid and mode; the manifest hash covers contents, not compression. `data` (export): `{ "archive", "manifest": { "sha256", "files", "records", "blobs" } }`; `import` adds `dryRun` and `changes`.

### `iw deploy`

Deploy the same server to Cloudflare Workers with R2 (store) and D1 (index), using `wrangler`. Idempotent: lists existing resources before creating any. See [guides/self-host-cloudflare.md](../guides/self-host-cloudflare.md).

| Flag | |
|---|---|
| `--dry-run` | Print the resources and the exact `wrangler` commands, change nothing |
| `--name <worker>` | Overrides `[hosting].name` |
| `--public` | Allow deploying without Cloudflare Access (not recommended) |

`data`: `{ "resources": { "type": "r2" \| "d1" \| "worker", "name": string, "exists": boolean }[], "commands": string[], "url": string | null }`

### `iw reindex`

Drop and rebuild the local index from the bundle and the local replica. `data`: `{ "records": number, "definitions": number, "ms": number }`

### `iw migrate`

Upgrade the bundle to the current `schema_version`. In v0.1 there is only version 1, so it verifies the version and changes nothing. `data`: `{ "from": number, "to": number, "changed": string[] }`

### `iw mcp`

Start the MCP server on stdio. See [agents.md](agents.md#mcp-server).

### `iw skills install`

Copy the shipped agent skills into the repository: `--claude` → `.claude/skills/`, `--codex` → `.agents/skills/` (see [agents.md](agents.md#skills)). Default: both. `data`: `{ "installed": string[] }`

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
| `IW_NOW` | report | Fixed "generated at" time for reproducible reports |

## Acceptance criteria

- [ ] Every command supports `--json` and its output validates against the schema in `packages/cli/src/json.ts` (tested for each command).
- [ ] Exit codes match the table for: valid bundle (0), invalid bundle (1), unknown flag (2), missing bundle (3), unreachable store (4).
- [ ] `iw new tc --uc UC-2 --title "x" --origin ai --model m --json` creates a `draft` file with `origin = "ai"` and an `[ai]` table, and `iw check` passes.
- [ ] In an empty directory, `iw init` → `iw new uc --title "Guest applies a coupon" --ac "A valid coupon reduces the total" --ready` → `iw new tc --uc UC-1 --title "Valid coupon" --step "Apply SUMMER10 => Total drops by 10%" --ready` → `iw check` exits 0.
- [ ] `iw approve TC-9` with `IW_ACTOR_KIND=agent` exits 2.
- [ ] `iw record TC-3 --verdict pass --evidence shot.png --json` writes one record to the local replica and stores the blob under its SHA-256.
- [ ] No command prompts when stdin is not a TTY.
