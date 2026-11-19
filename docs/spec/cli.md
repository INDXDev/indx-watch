# CLI (`iw`)

`iw` is the command-line interface of the `indx-watch` npm package. `npx indx-watch <command>` and `iw <command>` are the same. Every command works offline unless it talks to a store or Cloudflare.

## Conventions

| Topic | Rule |
|---|---|
| Bundle discovery | Walk up from the current directory to find `.indx-watch/`. Override with `--dir <path>` or `IW_DIR`. |
| Output | Human-readable by default. `--json` prints exactly one JSON document to stdout (the **envelope** below) and nothing else; logs go to stderr. |
| Color | Off when stdout is not a TTY or `NO_COLOR` is set. |
| Identity | See [security.md](security.md#identity). Override with `IW_ACTOR`, `IW_ACTOR_KIND`, `IW_AGENT_MODEL`. |
| Keys and IDs | Wherever a command takes `<ref>`, it accepts a human key (`TC-3`), a machine ID (`tc_01J…`), or a cross-project key (`SHOP:TC-3`). |
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

The shapes are defined as Zod schemas in `packages/cli/src/json.ts` and are part of the public contract: additive changes only within a major version.

### Exit codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | The command ran and the answer is "no": `check` found errors, `status --gate` failed, `import --dry-run` found conflicts |
| 2 | Usage error (unknown flag, missing argument, ambiguous ref) |
| 3 | Bundle or config error (no `.indx-watch/`, unsupported `schema_version`, invalid `project.toml`) |
| 4 | Store, network or external tool error (S3, hosted server, `wrangler`, `cloudflared`) |

## Commands

v0.1 commands are listed below. Commands marked *(v0.2)* are designed but not built; see the [roadmap](../roadmap.md).

### `iw init [dir]`

Create `.indx-watch/` in `dir` (default: current directory) with `project.toml`, `.gitignore`, and one environment.

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

`data`: `{ "files": number, "errors": number, "warnings": number, "problems": Problem[], "renumbered": { "from": string, "to": string, "id": string }[] }`

### `iw fmt [paths...]`

Rewrite files in canonical form. Equivalent to the formatting part of `check --fix`. `data`: `{ "changed": string[] }`

### `iw new <kind>`

Create a definition file with a fresh ID and the next free key. Kinds: `feature`, `uc`, `ac`, `tc`, `fixture`, `env`, `release`, `plan`.

| Flag | Applies to | |
|---|---|---|
| `--title <text>` | all | Required in non-interactive use |
| `--feature <FEAT>` | `uc` | Parent feature |
| `--uc <UC>` | `ac`, `tc` | Parent use case (`ac` appends a criterion) |
| `--text <text>` | `ac` | Criterion text |
| `--covers <AC,...>` | `tc` | Default: all ACs of `--uc` |
| `--mode <mode>` | `tc` | Default `manual` |
| `--priority <P0-P3>` | `uc`, `tc` | |
| `--kind <kind>` | `fixture` | `dataset`, `seed`, `file`, `account` |
| `--template <name>` | `tc`, `uc`, `fixture` | From `templates/` |
| `--from <file.toml\|->` | all | Merge field values from a TOML/JSON file or stdin (agents use this) |
| `--origin ai --model <id> [--skill <name>]` | all | Marks the file as AI-written; forces `status = "draft"` |

`data`: `{ "kind": string, "id": string, "key": string, "file": string }`

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
  "coverage": { "covered": 9, "total": 9, "ratio": 1 },
  "useCases": [ { "key": "UC-2", "title": "…", "priority": "P0", "status": "fail", "criteria": [ { "key": "AC-2.1", "status": "pass", "testCases": ["TC-3"] } ] } ],
  "testCases": [ { "key": "TC-3", "status": "pass", "latestRun": "run_01J…", "stale": false } ],
  "counts": { "pass": 5, "fail": 1, "needs_review": 1, "untested": 2, "stale": 0, "waived": 0, "uncovered": 0 }
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
| `--from <run.json\|->` | Full run input as JSON (see [sync.md](sync.md#run-record)) |

`data`: `{ "run": RunRecord, "verdict": Verdict }`

### `iw review <run-ref>`

Append a `human` judgement to a run. `--verdict <pass|fail|blocked|skipped>` and `--reason <text>` are required. `data`: `{ "judgement": Judgement, "verdict": Verdict }`

### `iw waive <tc-ref>`

Accept a known failure for a release. `--release`, `--reason` required. Rejected for P0. `data`: `{ "waiver": WaiverRecord }`

### `iw fixture add <path> --to <FX>` / `iw fixture fetch <FX>`

Add a data file to a fixture (pointer if large, or with `--blob`) / download pointer blobs into `cache/blobs/` and verify hashes. `data`: `{ "files": { "name": string, "sha256": string, "pointer": boolean }[] }`

### `iw sync`

Exchange records and blobs between the local replica (`.indx-watch/runs/`) and the store in `project.toml`. In git mode, also publishes a bundle snapshot when the bundle changed. See [sync.md](sync.md).

| Flag | |
|---|---|
| `--watch` | Keep running; push local writes immediately and poll the store (default every 3 s, `--interval`) |
| `--pull-only`, `--push-only` | |
| `--evidence <on-demand\|all\|none>` | Override `[store].evidence` |
| `--store <url>` | Override `[store].url` |

`data`: `{ "pushed": { "records": number, "blobs": number }, "pulled": { "records": number, "blobs": number }, "snapshot": string | null, "cursor": string }`

### `iw serve`

Start the server and web UI on Node: readiness dashboard, spec tree, test case view, manual runner, run viewer with review, fixture browser, report preview.

| Flag | Default | |
|---|---|---|
| `--port <n>` | `4321` | |
| `--host <addr>` | `127.0.0.1` | Use `0.0.0.0` to share on a LAN (no auth: see [security.md](security.md)) |
| `--open` | | Open the browser |
| `--sync` | on if `[store]` is set | Run sync in the background |

Prints the URL. With `--json`, prints `{ "url": string }` once listening and keeps running.

### `iw report`

Render a report offline from the bundle plus the local replica. See [reports.md](reports.md).

| Flag | Default | |
|---|---|---|
| `--release <version>` | current | |
| `--plan <PLAN>` | | Report on a plan instead |
| `--env <name>` | any | |
| `--format <md\|html\|pdf\|json>` | `md` | `pdf` needs a local Chromium (Playwright) |
| `--out <path>` | stdout for `md`/`json`, `report-<release>.<ext>` otherwise | |
| `--evidence <none\|links\|embed>` | `embed` for `html`, `links` otherwise | |
| `--audience <internal\|customer>` | `internal` | `customer` omits internal notes, actor emails and environment guides |

`data`: `{ "file": string | null, "gate": GateResult }`

### `iw export --full` / `iw import <archive>`

Write / read a portable archive (`.tar.zst`, or `.tar.gz` where zstd is unavailable) with a manifest of SHA-256 hashes, the bundle, all records as NDJSON and all blobs. `import` writes into the current directory (must not contain a bundle unless `--merge`) and verifies every hash; `--dry-run` reports what would change. `data`: `{ "archive": string, "manifest": { "sha256": string, "files": number, "records": number, "blobs": number } }`

### `iw deploy`

Deploy the same server to Cloudflare Workers with R2 (store) and D1 (index), using `wrangler`. Idempotent: lists existing resources before creating any. See [guides/self-host-cloudflare.md](../guides/self-host-cloudflare.md).

| Flag | |
|---|---|
| `--dry-run` | Print the resources and the exact `wrangler` commands, change nothing |
| `--name <worker>` | Overrides `[hosting].name` |

`data`: `{ "resources": { "type": "r2" \| "d1" \| "worker", "name": string, "exists": boolean }[], "commands": string[], "url": string | null }`

### `iw reindex`

Drop and rebuild the local index from the bundle and the local replica. `data`: `{ "records": number, "definitions": number, "ms": number }`

### `iw migrate`

Upgrade the bundle to the current `schema_version`. `--dry-run` lists changes. `data`: `{ "from": number, "to": number, "changed": string[] }`

### `iw mcp`

Start the MCP server on stdio. See [agents.md](agents.md#mcp-server).

### `iw skills install`

Copy the shipped agent skills into the repository: `--claude` → `.claude/skills/`, `--codex` → `.agents/skills/` (see [agents.md](agents.md#skills)). Default: both. `data`: `{ "installed": string[] }`

### `iw login <url>` *(thin wrapper)*

Runs `cloudflared access login <url>` so later commands can obtain a token with `cloudflared access token -app=<url>`. INDX Watch stores nothing itself.

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
| `IW_ACCESS_TOKEN` | http store | Pre-obtained Cloudflare Access token (CI) |

## Acceptance criteria

- [ ] Every command supports `--json` and its output validates against the schema in `packages/cli/src/json.ts` (tested for each command).
- [ ] Exit codes match the table for: valid bundle (0), invalid bundle (1), unknown flag (2), missing bundle (3), unreachable store (4).
- [ ] `iw new tc --uc UC-2 --title "x" --origin ai --model m --json` creates a `draft` file with `origin = "ai"` and an `[ai]` table, and `iw check` passes.
- [ ] `iw record TC-3 --verdict pass --evidence shot.png --json` writes one record to the local replica and stores the blob under its SHA-256.
- [ ] No command prompts when stdin is not a TTY.
