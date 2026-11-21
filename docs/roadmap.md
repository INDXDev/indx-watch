# Roadmap

This is the only place for the plan. Task IDs (`T-1xx`) are referenced from PRs, specs and issues. A task is done when its acceptance criteria hold and CI is green. Status: ✅ done · 🚧 in progress · ⏳ planned.

## v0.1 — file-first core (this release)

Goal: the [definition of done](#v01-definition-of-done) below, offline-first, one npm package.

| ID | Task | Area | Acceptance criteria | Status |
|---|---|---|---|---|
| T-101 | Bundle schemas, canonical TOML, IDs, hashes, JSON Schema generation | `bundle` | [bundle-format.md](spec/bundle-format.md#acceptance-criteria) | ✅ |
| T-102 | `check` (schemas, refs, keys, AI approval rule, priority rule, secret scan, unknown files) and `approve` | `bundle` | [concepts.md](spec/concepts.md#acceptance-criteria), [security.md](spec/security.md#acceptance-criteria) | ✅ |
| T-103 | Model, decision policy, status, coverage, gate, i18n resolve | `core` | [concepts.md](spec/concepts.md#acceptance-criteria), [i18n.md](spec/i18n.md#acceptance-criteria) | ✅ |
| T-104 | ObjectStore adapters (memory, fs, s3, r2, http) + contract tests; local replica; identity and context providers | `store` | [sync.md](spec/sync.md#acceptance-criteria) (adapter suite), [security.md](spec/security.md#acceptance-criteria) (identity) | ✅ |
| T-105 | Sync: push, pull with lookback, watch, bundle snapshots | `sync` | [sync.md](spec/sync.md#acceptance-criteria) | ✅ |
| T-106 | CLI v0.1 commands with `--json` | `cli` | [cli.md](spec/cli.md#acceptance-criteria) | ✅ |
| T-107 | Server (Hono) for Node and Workers; report rendering md/html | `server` | [reports.md](spec/reports.md#acceptance-criteria), [architecture.md](architecture.md#acceptance-criteria) | ✅ Worker bundle checked by `pnpm check:worker` (`wrangler deploy --dry-run`); no live deploy in CI |
| T-108 | Web UI: dashboard, spec tree, TC view, manual runner, run viewer + review, fixtures, report preview (en/ja) | `web` | [design](design/index.html) screens; [i18n.md](spec/i18n.md#acceptance-criteria) | ✅ |
| T-109 | Playwright reporter | `playwright` | [integrations.md](spec/integrations.md#acceptance-criteria) | ✅ |
| T-110 | GitHub Action (composite) | `action.yml` | [integrations.md](spec/integrations.md#acceptance-criteria) | ✅ |
| T-111 | `examples/shop` app, Playwright tests, sample results, committed report | `examples` | [reports.md](spec/reports.md#example) | ✅ unit tests may add scenario records of their own over the shop bundle ([AGENTS.md](../AGENTS.md) rule 10) |
| T-112 | Skills (Claude Code + Codex) and `iw mcp` | `skills`, `cli` | [agents.md](spec/agents.md#acceptance-criteria) | ✅ `BrowserProvider` and `LlmClient` exist only as interfaces (no fakes yet); adapters are T-201/T-202 |
| T-113 | `iw deploy` for Cloudflare (dry-run exact) + hosting guides | `cli`, `docs` | [guides/self-host-cloudflare.md](guides/self-host-cloudflare.md) | ✅ dry run and fake-wrangler tests only; a real deploy is manual |
| T-114 | `iw export --full` / `iw import` | `bundle`, `cli` | [cli.md](spec/cli.md#iw-export---full-and-iw-import-archive) | ✅ |
| T-115 | Dogfooding: this repo's `.indx-watch/`, CI posting runs, release report | repo | [CONTRIBUTING.md](../CONTRIBUTING.md#dogfooding) | ✅ |
| T-116 | CI: lint, typecheck, test, schemas, round trip, docs links, LOC budget, e2e | repo | [.github/workflows/ci.yml](../.github/workflows/ci.yml) green | ✅ green on GitHub since PR #2 (Node 22 and 24; e2e writes both job-summary reports) |
| T-117 | Close the remaining acceptance-criteria test gaps: the unchecked `- [ ]` bullets in `docs/spec/*.md` (fixture size threshold → `*.blob.toml`; `serve --json` schema; `evaluateGate()` on the shop sample store; a step edit makes earlier runs `stale`; stale step translation in the UI; the action's gate step failing; offline HTML with zero requests; customer report without bundle `notes`; report gate vs `status --json`; `github-oidc` identity; two clones under `iw sync --watch` via the CLI) | all | the bullets themselves | ✅ every bullet is ticked; `github-oidc` is v0.2 ([security.md](spec/security.md#identity)) |
| T-118 | Demo site: GitHub Actions deploys `examples/shop` to a public Worker on every push to `main` | repo | [guides/self-host-cloudflare.md](guides/self-host-cloudflare.md#demo-site-from-github-actions) | ✅ live at <https://indx-watch-demo.i-248.workers.dev>; the smoke test checks the demo's gate against the sample |

### v0.1 definition of done

1. In an empty directory: `npx indx-watch init demo` → `iw new uc` / `iw new tc` → `iw check` passes → `iw serve` shows the readiness dashboard → run a TC manually in the browser with a screenshot → `iw report --format html` produces a shareable file. All offline.
2. Two clones with the same S3 bucket see each other's runs within seconds via `iw sync --watch`. Definitions sync through git.
3. In `examples/shop`, `npx playwright test` with the reporter creates runs linked to `TC-*` by tag, including fixture versions, the commit SHA and the actor. In GitHub Actions the run links to the PR and job and appears in the job summary.
4. Claude Code with the shipped skills can be asked "add test cases for UC-5 and run them": it writes valid drafts (`origin = "ai"`), runs them and reports, through `iw --json` and/or MCP.
5. `iw deploy --dry-run` prints the exact Cloudflare resources and `wrangler` commands; the deployed server is the same code as `iw serve`.
6. `iw export --full` → `iw import` into a fresh folder round-trips with identical manifest hashes.
7. Docs follow [docs/README.md](README.md); CI enforces links, schemas and the round trip.

## v0.2 — agents and sharing

The rows marked ✅ here (T-202, T-204, T-211, T-213–T-216) ship in the first npm release, 0.1.0, alongside v0.1; the rest stay planned. See [CHANGELOG.md](../CHANGELOG.md).

| ID | Task | Acceptance criteria | Status |
|---|---|---|---|
| T-201 | Agent execution mode via `BrowserProvider` (local Playwright, Cloudflare Browser Run) | An `agent` TC in `examples/shop` runs end to end and records evidence per step | ⏳ |
| T-202 | LLM judge via `LlmClient` (Anthropic, optional AI gateway) | `llm` judgements with confidence; low confidence → `needs_review` | ✅ `iw judge` with the Anthropic adapter; tested against a fake Messages API (no live call in CI) |
| T-203 | Report share links on the hosted app (frozen snapshots, expiry, audit records) | [reports.md](spec/reports.md#sharing-with-customers) | ⏳ |
| T-204 | PR comment + check run from the GitHub Action | One comment per PR, updated in place | ✅ verified on this repository's PR #7 (comment edited in place on the next push, check run `INDX Watch (v0.1.0)`) |
| T-205 | Streamable HTTP MCP endpoint on the hosted server | Same tools as `iw mcp` behind Access | ⏳ |
| T-206 | Log compaction snapshots | New clone pulls 100k records in < 10 s from a snapshot | ⏳ |
| T-207 | Visual judge with approved baselines | `visual` judgements; baseline approval is a human record | ⏳ |
| T-208 | Other CI providers' context (GitLab, CircleCI, Buildkite) | Context detected from standard variables | ⏳ |
| T-209 | Workspace mode: definitions synced through the store, edited in the hosted UI | [sync.md](spec/sync.md#workspace-mode-v02) design notes hold | ⏳ |
| T-210 | `node:sqlite` index for large local projects | Same SQL schema file as D1 (`packages/store/src/index-schema.sql`) | ✅ `sqliteIndex` runs the D1 index code over `DatabaseSync` and passes the shared Index contract tests; `iw reindex` writes `cache/index.sqlite`; a file from another schema version is emptied on open. Reading it in `iw serve` is T-217 |
| T-211 | Signed records (server and OIDC) so direct bucket writes cannot claim verified identities | Forged `via` is shown as unverified | ✅ Ed25519 `sig` on records, keys pinned in `project.toml` `[[signing_keys]]`, `iw keygen`, signing by the hosted server, `iw serve`, the CLI and the reporter (`IW_SIGNING_KEY`), "unverified" in the UI, API and reports, `gate.ignore_unverified`. CI signs with a secret key; GitHub OIDC-based signing is not built yet |
| T-212 | Interoperate with Playwright Test Agents' `specs/*.md` plans (import as draft test cases) | A planner spec imports into drafts that pass `iw check` | ✅ [`iw import playwright-plan`](spec/cli.md#iw-import-playwright-plan-filemd) reads the planner's `planner_save_plan` format and the older docs format; `examples/shop/specs/coupon.plan.md` imports into AI drafts with 0 check errors (tested) |
| T-213 | Web app v2: calm Home, List and Focus views on every collection, Focus runner sessions, Activity, CLI panel | [web.md](spec/web.md#acceptance-criteria) | ✅ Home, Tests, Activity and Test data with List / Focus, runner sessions with keyboard shortcuts, CLI panel |
| T-214 | "Who's testing?": browser-declared tester identity (`via = "browser"`) where no verified identity exists | [web.md](spec/web.md#identity) | ✅ `iw_tester` cookie, honored only without a verified identity |
| T-215 | Upload and clone: `iw push`, `iw clone`, drag-and-drop upload with preview, Uploads screen | [web.md](spec/web.md#upload), [cli.md](spec/cli.md#iw-push) | ✅ `iw push`, `iw clone`, browser upload with preview (Node writes files; Workers publish a snapshot), Uploads screen. Worker upload tested against fake R2/D1 and on the real demo deploy (`iw push` to https://indx-watch-demo.i-248.workers.dev in the Demo workflow) |
| T-216 | Bilingual content everywhere: `iw translate`, release and plan titles, `judgement.locale`, complete `ja` in the examples | [i18n.md](spec/i18n.md#acceptance-criteria) | ✅ `iw translate`, release/plan titles, `judgement.locale`; both example bundles are complete in `ja`; the machine translations were reviewed and approved in #19 |
| T-217 | `iw serve` reads records from the `node:sqlite` index (load `cache/index.sqlite` on start, ingest new replica files incrementally) | Start-up on a large local replica does not parse every log file | ⏳ |

## v0.3 — teams and customers

| ID | Task | Acceptance criteria | Status |
|---|---|---|---|
| T-301 | Roles from Access identity groups (viewer, tester, lead, customer) | A customer sees only assigned items | ⏳ |
| T-302 | Customer UAT flow: invite by email (Access one-time PIN), assigned plan items only | End-to-end with a test Access policy | ⏳ |
| T-303 | Flaky test detection and quarantine view | Flake rate per TC over the last N runs | ✅ flake rate over the last 10 pass/fail runs in core, `iw status --json` and the API; Tests → Flaky view ([concepts](spec/concepts.md#flaky-tests)) |
| T-304 | Impact analysis: suggest TCs for a PR from changed files and `[automation].files` | Suggestions listed in the PR summary | ⏳ |

## v1.0 — stable format

- Freeze `schema_version = 1` (or migrate to 2 with `iw migrate`), publish JSON Schemas to the Schema Store, semantic versioning of CLI JSON output.
