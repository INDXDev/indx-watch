# Rebuild INDX Watch as an open-source, file-first, agent-native test management tool

> Paste everything below into a **new** Claude Code session at the root of the target repository.
> This prompt is self-contained. It explicitly asks you to use multi-agent orchestration: **please use the Workflow tool (multi-agent workflows) and git worktrees** for the parallel phases described below.

---

## 0. Who you are and what you will deliver

You are the lead engineer and technical writer for a new open-source project. Working name: **INDX Watch**. The npm package is `indx-watch`, the CLI is `iw`, and the project folder inside a user's repo is `.indx-watch/`. If the repository already has another name, use that name instead. Do not block on naming.

By the end of this session, deliver **one pull request** to `main` that contains all of the following:

1. **OSS-grade documentation in Markdown, English.** The docs are the single source of truth for the design. They include:
   - `README.md`, `AGENTS.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `LICENSE`, `CHANGELOG.md`
   - `docs/` with specs, architecture, ADRs, a research landscape, and a dated platform-notes file
   - **Only visual designs are HTML** (`docs/design/`)
2. **A working MVP** (v0.1) of a small Node.js/TypeScript codebase. You can:
   - run it instantly with `npx indx-watch`
   - use it fully offline and locally
   - sync it through any S3-compatible bucket
   - self-host and share it on Cloudflare with one command
3. **A Playwright reporter and a GitHub Action.** Automated test results land in the same place as manual test results.
4. **Agent skills for Claude Code and Codex, plus an MCP server.** AI agents can manage tests natively.
5. **Dogfooding.** The repository manages its own QA with its own tool. That means a `.indx-watch/` folder describing the tool's use cases, test cases and fixtures, with CI posting results to it.

Ask the user questions (AskUserQuestion) only at the very start, in one batch, about:
- the license (default: Apache-2.0)
- the npm scope or name (default: `indx-watch`)
- the GitHub org/repo for links

If the user does not answer, use the defaults and continue.

## 1. The problem (in the user's words, summarised)

The user runs product teams. Their QA *looks* done but is not. Concretely:

- **Test cases are scattered.** They live across Google Drive, spreadsheets, GitHub issues and people's heads. Nobody can say, for a release, which use cases are verified, by whom, when, on which build and environment, or what counts as "done".
- **Fixtures and test data are not managed.** There is no way to:
  - version fixtures
  - link a fixture to the test cases that need it
  - know which fixture version a run used
  - share fixtures safely
  
  Fixtures only really work when they live in the repository next to the code, and today they don't.
- **Automated and manual results are disconnected.** Playwright runs and GitHub Actions results are not linked to test cases, use cases, releases or deployments. Manual tests are not either. The final integration and acceptance tests are the weakest part.
- **Test data is not AI-ready.** Agents such as Claude Code and Codex cannot reliably read, write, run or triage tests, because the information is not in a typed, local, file-based form.
- **Google Drive or GitHub alone is not enough.**
  - Drive is easy to share but has no structure or types.
  - Git has structure and history, but non-engineers and customers cannot use it, and large binaries don't belong there.
- **Customers and stakeholders need reports.** They need readable reports (release readiness, coverage, evidence) without access to internal tools.

The vision combines **the best of Git and the best of Google Drive**:
- typed files you can clone anywhere and edit with any editor or AI agent
- sync that is as easy as a shared drive, continuous and asynchronous
- a hosted UI for visualisation, collaboration and customer-facing reports
- **no lock-in to any vendor**, including Cloudflare

## 2. Product principles (non-negotiable)

1. **File-first, format is the source of truth.**
   - The canonical data is a typed directory of TOML files plus data files: the *bundle*.
   - Any database (D1, SQLite) is a **derived index/cache** that can be rebuilt from the bundle plus the result store.
   - Every feature must work on plain files.
2. **Local-first, cloud-optional.**
   - Everything works offline with `npx indx-watch`.
   - Sharing and sync go through pluggable storage adapters: local filesystem, any S3-compatible store (AWS S3, Cloudflare R2, MinIO, GCS interop), and a Cloudflare-hosted app.
   - Hosting on Cloudflare is the recommended way to share, but it is replaceable.
3. **Agent-native.**
   - Strict schemas (zod → JSON Schema), stable IDs and canonical formatting.
   - A CLI with `--json` output everywhere, agent skills, and an MCP server.
   - An agent should be able to go from "read the spec" to "write test cases, attach fixtures, run them, triage failures and report" without a human translating anything.
4. **Done is computed, never declared.**
   - Use cases have acceptance criteria (AC). Test cases cover ACs.
   - A use case is done only when every AC is covered by test cases whose **latest relevant result** passes, on the release/build in question, with evidence.
   - Readiness gates (for example "all P0 pass, P1 ≥ 95%, no unreviewed AI verdicts, nothing stale") are configurable and computed by one pure function.
5. **Every result is attributable and reproducible.**
   - Each run records:
     - who or what ran it: human, CI, or agent
     - when, and against which commit/build/deployment and environment
     - which test case version and which fixture content hashes
     - how: manual, Playwright, or agent
     - the evidence: screenshots, traces, logs
   - Identity comes from the environment you run in: git identity locally, GitHub OIDC/actor in CI, Cloudflare Access identity on the hosted app. Never invent an auth system.
6. **AI proposes, humans approve.**
   - AI-written specs or test cases enter as `draft` with `origin = "ai"` and model metadata.
   - AI verdicts carry a confidence value. Low confidence goes to a human review queue.
7. **Small code, boring tech.**
   - One TypeScript codebase that runs on Node and on Cloudflare Workers.
   - Prefer platform features and well-known libraries over custom infrastructure.
   - Budget the lines of code and keep to the budget.
8. **Secrets never live in the bundle.** Store references only (env var names, secret store keys). `iw check` refuses to push anything that looks like a secret.
9. **Bilingual-ready.**
   - The UI ships in English and Japanese.
   - Content fields can carry translations (`[i18n.ja]`, `[i18n.en]`) with a status of `machine`, `reviewed` or `stale`.
   - Literal on-screen strings of the app under test are never translated.

## 3. Lessons from the previous attempt (apply them)

A previous internal design (Japanese, HTML-heavy, Cloudflare-first) produced useful ideas but had these problems. Do not repeat them.

- **The source of truth moved mid-way.** It went from "D1 is the source of truth" to "the file format is the source of truth". → Start file-first. The database is an index.
- **Cloudflare lock-in crept in.** It came through D1, Workflows, Access and Browser Run being assumed everywhere. → Put every vendor behind a port/adapter from day one. Cloudflare is one adapter set.
- **Too much specification before code.** The design had 13 screens and 35 tables, with no running code. → Ship a thin vertical slice early:
  1. bundle
  2. CLI
  3. local UI
  4. Playwright reporter
  5. sync
  
  Grow it from there. Keep the docs small and non-overlapping.
- **Information was duplicated.** The file tree and the roadmap lived in two documents and drifted apart. → Each fact has exactly one home. Other docs link to it. CI checks links.
- **Docs were hard for agents and contributors.** Japanese HTML everywhere was heavy for agents and unfriendly to OSS contributors. → Use Markdown for everything. HTML is only for design mockups. GitHub renders Mermaid natively.
- **Platform facts went stale fast.** → Verify Cloudflare, Playwright and agent tooling on the web. Record the facts with dates and source URLs in `docs/research/platform-notes.md`.
- **A custom CLI auth was designed, then dropped.** → Wrap official tools instead:
  - `cloudflared access login` / `cloudflared access token` with the `cf-access-token` header, for a hosted app behind Cloudflare Access
  - `wrangler` for deploys
  - standard AWS credential chains for S3
  
  The CLI itself can be public.
- **No `main` branch at first.** That caused PR base problems. → Make sure `main` exists before branching.
- **Sample data was inconsistent across documents.** → Keep one canonical example project (`examples/shop`). Docs and tests use only that.
- **Multi-agent fan-out caused conflicts on shared files.** → Freeze contracts first: schemas, ports, package boundaries. Give each agent an exclusive set of paths. Integrate wave by wave.

Useful ideas to **keep**:
- the domain model
- the computed-done rule and readiness gate
- the decision policy that combines `assert`, `visual`, `llm` and `human` judges into one verdict
- fixture kinds
- bilingual content
- identity-attributed audit
- "one command to deploy a shared instance to Cloudflare from a folder"
- a portable full-archive export

If the old internal docs are present in this repository (`docs/spec/*.html`, `docs/guides/*.html`, `AGENTS.md`), read them as prior art. Then **replace** them with the new OSS structure. Do not keep two sets of docs. Move anything worth keeping into the new Markdown, and delete the old HTML specs, except designs worth porting into `docs/design/`.

## 4. Domain model (starting point; refine in `docs/spec/concepts.md`)

- **Project** — one product, usually one repository. Its config lives in `.indx-watch/project.toml`.
- **Environment** — where tests run: base URL, how to get in (as a secret reference), reset/seed hooks, and an entry guide for humans.
- **Release / Build / Deployment**
  - A release is a version under test.
  - A build is a commit SHA.
  - A deployment is a build on an environment. CI provides these automatically from GitHub.
- **Feature → Use case → Acceptance criterion (AC)**
  - A use case has an actor, a goal and a priority from P0 to P3.
  - ACs are observable, binary statements.
- **Test case (TC)**
  - Covers one or more ACs.
  - Has steps with expected results, preconditions, fixture refs, judges and a decision policy.
  - Has a mode: `manual`, `playwright`, `agent` or `hybrid`.
  - Links to automated tests (for example a Playwright test tagged `@TC-128`).
  - Is versioned by content hash.
- **Fixture**
  - Kinds: `dataset` (CSV/JSON rows for data-driven tests), `seed` (a payload for an app's reset/seed hook), `file` (an upload asset), `account` (a test account by secret reference).
  - Small fixtures live in git.
  - Large ones become pointer files (`*.blob.toml` holding sha256, size and store), fetched on demand, in the spirit of git-lfs and DVC.
  - Versions are content hashes.
- **Plan / Assignment** — which TCs, on which environment, by whom (a person, CI or an agent), and by when.
- **Run**
  - One execution of one TC version against one build/deployment and environment.
  - Has step results, evidence, judgements and a final verdict: `pass`, `fail`, `blocked`, `skipped` or `needs_review`.
  - Records the fixture hashes, the actor and the source: manual, Playwright, agent or CI.
- **Report** — a rendered snapshot for a release or plan: readiness, coverage matrix, failures, evidence links. Formats are Markdown, static HTML and PDF. It is shareable with customers.

IDs:
- Stable machine IDs are `{prefix}_{ULID}`, so files can be created offline without collisions.
- Human keys are `UC-12`, `AC-12.2`, `TC-128` and `FX-3`, assigned on first sync or locally in local-only mode.

## 5. The bundle and the sync model (design this first; it is the core)

Directory, committed to git by default unless noted:

```
.indx-watch/
  project.toml            # project, readiness gate, glossary, storage + hosting config (no secrets)
  environments/*.toml
  specs/<FEAT>/<UC>/use-case.toml        # use case + ACs
  specs/<FEAT>/<UC>/TC-*.toml            # test cases
  fixtures/<FX>/fixture.toml + data files | *.blob.toml pointers
  plans/*.toml
  templates/*.toml
  .gitignore              # ignores cache/ and runs/ by default
  cache/                  # local index, downloaded blobs (ignored)
  runs/                   # local copy of results pulled from the store (ignored by default)
```

Decisions to document as ADRs:
1. **Definitions and results sync differently.**
   - Definitions (specs, TCs, fixtures, plans) sync through git, which gives review, history and blame.
   - Results (runs, evidence, large blobs) sync through a **result store**, which keeps them out of git, keeps them append-only and lets them sync continuously.
   - Offer a "workspace mode" for teams without git. In that mode, definitions also live in the store and sync like a shared drive.
2. **The store protocol is storage-only.**
   - It works on any S3-compatible bucket with no server: content-addressed blobs plus an append-only log of small JSON records (one object per write, ULID-ordered).
   - Clients list and merge the log, so `iw sync` and `iw sync --watch` need nothing but a bucket.
   - The hosted app is just another client, plus an index DB and a UI.
   - Research prior art (git-lfs, DVC, git-annex, Automerge/CRDTs, Litestream) and choose the simplest merge rule that is correct for append-only results and field-level edits.
3. **Canonical TOML.** One serializer with stable key order and formatting. A round trip (parse → write) must be byte-identical. Every file starts with `#:schema <url>` followed by a blank line, so Tombi or Taplo give editor completion.
4. **Schema versioning.** `schema_version` is an integer. `iw migrate` handles breaking changes. Additive changes do not bump it.
5. **Full archive.** `iw export --full` writes a portable, lossless `.tar.zst`: a manifest with hashes, the bundle, NDJSON of all runs and history, and the blobs. `iw import` accepts it with `--dry-run`.

## 6. Components (target architecture; keep the code small)

Monorepo (pnpm workspaces, TypeScript strict, Biome, Vitest):

```
packages/
  bundle/      zod schemas → JSON Schema, canonical TOML, validation, ID rules, archive
  core/        pure domain logic: coverage, readiness gate, decision policy, staleness/flakiness, i18n resolve
  store/       storage ports + adapters: fs, s3 (works with R2/MinIO), cloudflare (R2 + D1 index)
  sync/        log merge, blob transfer, watch mode
  server/      Hono app (runs on Node and on Workers): API + serves the web UI + report rendering
  web/         small Vite + React SPA (readiness dashboard, spec tree, TC view, manual runner, fixture browser, run viewer, report preview)
  cli/         `iw` (bin of the `indx-watch` package): init, check, new, status, sync, serve, run, report, export, import, deploy, mcp, skills
  playwright/  Playwright reporter: maps tests to TCs via tags/annotations, uploads results/traces/screenshots as runs
  action/      GitHub Action (or root action.yml): runs the reporter context, links runs to PR/commit/deployment, writes a job summary
skills/
  claude-code/ SKILL.md files: write-test-cases, manage-fixtures, run-tests, triage-failure, release-report
  codex/       the same skills in the format Codex expects (verify the current Codex skills/AGENTS.md conventions on the web)
examples/
  shop/        tiny demo web app + Playwright tests + a full .indx-watch/ bundle (the ONE canonical sample)
schemas/       generated JSON Schemas (published for editors)
docs/          see §7
.indx-watch/   dogfooding: this repo's own use cases, test cases and fixtures
```

Notes:
- **Runtime targets.**
  - `npx indx-watch serve` runs the server on Node, with SQLite as the index and the fs or S3 store.
  - `iw deploy` deploys the *same* server to Cloudflare Workers. It wraps `wrangler`, creates R2/D1 idempotently from `project.toml` `[hosting]`, and can put the app behind Cloudflare Access.
  - Use Drizzle with the SQLite dialect so D1 and local SQLite share one schema.
  - The index DB is disposable and is rebuilt with `iw reindex`.
- **Auth.** Wrap official tools only.
  - Hosted app: Cloudflare Access. The CLI uses `cloudflared access token` → `cf-access-token`; the server verifies `Cf-Access-Jwt-Assertion` with `jose`.
  - S3: the standard AWS SDK credential chain.
  - CI: GitHub's built-in context, with optional OIDC.
  - Local: git identity.
  - Record `actor` and `source` on every write.
- **Agent execution.** An LLM browser agent and an LLM judge are on the roadmap (v0.2+). Design their ports now: `BrowserProvider` (local Playwright / Cloudflare Browser Run) and `LlmClient` (Anthropic via an optional gateway). Ship only fakes and interfaces in v0.1, unless time allows.
- **Reports.** `iw report --release v1.2 --format md|html|pdf` renders from the bundle plus results, offline. The hosted app adds share links with expiry.
- **Line budget.** Write a budget per package in `docs/architecture.md` (for example core ≤ 1.5k LOC, server ≤ 1.5k, web ≤ 3k). Justify every runtime dependency in a one-line comment in `package.json` or in the ADR.

## 7. Documentation set (Markdown; one home per fact)

```
README.md                 what/why, 60-second quickstart (npx), feature list, architecture diagram (Mermaid), comparison table, links
AGENTS.md                 the single guide for coding agents (CLAUDE.md just imports it: "@AGENTS.md")
CONTRIBUTING.md           dev setup, repo map, how to add a schema field / adapter / skill, commit + PR conventions, DCO or CLA (decide)
SECURITY.md, CODE_OF_CONDUCT.md, LICENSE, CHANGELOG.md (Keep a Changelog)
docs/README.md            docs index and reading order by role (user, maintainer, agent)
docs/vision.md            problem, principles, non-goals
docs/spec/concepts.md     domain model, IDs, states, computed-done, readiness gate (Mermaid state + ER diagrams)
docs/spec/bundle-format.md   THE format spec: layout, every file type with a full example, canonical rules, versioning
docs/spec/sync.md         store protocol, merge rules, conflicts, watch mode, sequence diagrams
docs/spec/cli.md          every command, flags, --json output shapes, exit codes
docs/spec/integrations.md Playwright reporter mapping, GitHub Action, CI identity
docs/spec/agents.md       skills, MCP tools, AI-draft rules, decision policy for AI verdicts
docs/spec/reports.md      report contents and formats, customer-sharing rules
docs/spec/security.md     identity, attribution, secrets, Access, threat model
docs/spec/i18n.md         UI locales, content translations, literal-string rule
docs/architecture.md      components, ports/adapters, data flow, runtime targets, LOC budget
docs/guides/              quickstart, self-host on Cloudflare, self-host on Node/Docker, S3 sync, Playwright, GitHub Actions, writing good test cases, fixtures how-to
docs/adr/NNNN-*.md        one decision per file (MADR style)
docs/research/landscape.md     OSS and commercial comparison and positioning (with sources)
docs/research/platform-notes.md  dated facts with source URLs (Cloudflare, Playwright, Codex/Claude Code skills, MCP)
docs/roadmap.md           milestones and task IDs with acceptance criteria (the only place for the plan)
docs/design/              HTML mockups only: index.html + one file per key screen + shared tokens.css (light/dark), linked from the docs
docs/prompts/             reusable prompts for maintainers (keep this file here)
```

Writing rules:
- Plain, specific English. Lead with the answer. Use one example project throughout (`examples/shop`).
- Use Mermaid for diagrams. Every spec page ends with **"Acceptance criteria"** that tests can check.
- CI checks: link check, schema generation is clean, canonical round trip, `examples/shop` validates, and docs code samples run when practical.

## 8. Research first (Phase 0, parallel agents)

Before writing specs, run research agents in parallel. Every claim needs a source URL and a date. Write the results into `docs/research/`.

1. **OSS and commercial landscape of test case management.**
   - Look at least at: Kiwi TCMS, TestLink, Squash TM, ReportPortal, Allure Report / Allure TestOps, Qase, TestRail, Xray, Zephyr, Testmo, Testiny, testomat.io, Tuleap, and Gherkin/Cucumber-style "tests as text" approaches.
   - For each: license, data model, whether it is file-based or git-native, automation integration, AI features, self-hosting, and weaknesses.
   - Write down the gap this project fills: file-first + agent-native + fixtures + git/Drive-style sync + customer reports.
2. **Playwright.** The reporter API (`onBegin`, `onTestEnd`, attachments, tags/annotations), trace and screenshot handling, and how to map tests to TC IDs robustly.
3. **GitHub Actions.** Context variables, job summaries, OIDC, deployments/environments, artifact upload, and composite vs JavaScript actions.
4. **Agent skills.**
   - Current Claude Code skill format (`SKILL.md`, frontmatter, folders).
   - Current Codex conventions (AGENTS.md, skills/prompts directories).
   - MCP server best practice in Node.
5. **Cloudflare (it changes fast).**
   - Workers with Hono and static assets, D1 limits, R2 S3-compatibility and presigned URLs.
   - Access: Worker-level protection, JWT validation, `cloudflared access token`, Managed OAuth status.
   - Wrangler programmatic usage, Browser Run, Workflows.
   - Record everything in platform-notes with dates.
6. **Sync prior art.** git-lfs, DVC, git-annex, Automerge, and S3 conditional writes (`If-None-Match`) for append-only logs. Recommend the simplest correct design.
7. **TOML tooling.** Tombi/Taplo `#:schema`, a TOML library for Node that preserves formatting (or decide on canonical re-serialization), and JSON Schema Store registration.

## 9. Execution plan (multi-agent, worktrees, waves)

0. **Setup**
   - Make sure `main` exists and is the default branch (tell the user if you cannot change the default branch).
   - Create the integration branch `feat/oss-v0.1`.
   - Load the `workflow-authoring` skill before writing Workflow scripts.
   - Track work with TaskCreate/TaskUpdate.
1. **Phase 0 — Research** (Workflow, about 6 parallel read-only agents). Output: `docs/research/*.md`.
2. **Phase 1 — Specs and contracts** (you, sequentially).
   - Write `vision.md`, `concepts.md`, `bundle-format.md`, `sync.md`, `architecture.md`, the ADRs and `roadmap.md`.
   - Then write the **contracts**:
     - `packages/bundle` schemas
     - `packages/core` domain types
     - `packages/store` port interfaces
     - the CLI command list with `--json` shapes
     - `examples/shop` bundle
   - Run a spec review with 2 independent reviewer agents. Give them the files, not your conclusions. Fix what they find.
   - **Freeze the contracts.**
3. **Phase 2 — Parallel implementation** (Workflow, each agent in its own git worktree on `wip/<area>`, exclusive paths):
   - A: `bundle` + `core` (+ unit tests, round trip)
   - B: `store` (fs, s3) + `sync` (log merge, blobs, watch)
   - C: `cli` (all v0.1 commands, `--json`)
   - D: `server` (Hono, Node + Workers) + `web` (SPA screens per `docs/design`)
   - E: `playwright` reporter + `action` + `examples/shop` app and tests
   - F: `skills/` (Claude Code + Codex) + MCP server (`iw mcp`) + `docs/spec/agents.md`
   - G: `iw deploy` for Cloudflare (wrangler wrapper, idempotent R2/D1, Access instructions) + hosting guides
   
   Agents do not edit frozen contracts. They report change requests, and you apply them during integration.
4. **Integration** (you, after each wave): merge `--no-ff`, resolve conflicts toward the docs, then run typecheck, lint, test and the e2e of `examples/shop`. Clean up the worktrees.
5. **Phase 3 — Dogfood.** Write `.indx-watch/` for this repository (its own use cases, ACs, TCs and fixtures). Wire CI so the Playwright reporter and the GitHub Action post runs to a store: fs in CI artifacts, plus an optional S3 bucket via secrets. Generate a release report.
6. **Phase 4 — Verification** (Workflow, independent reviewers per area). Each reviewer checks:
   - every spec's acceptance criteria
   - the principles in §2
   - the lessons in §3: no duplicated facts, no vendor assumptions outside adapters, one sample project
   - line budgets
   - `npx` cold start in a clean temp directory: `npx <packed tarball> init && iw check && iw serve`
   - an offline full flow
   - S3 sync between two clones using MinIO, or the fs adapter if Docker is unavailable
   - Playwright results mapped to TCs
   - `iw report` output
   - `iw deploy --dry-run`
   
   Fix the findings, or list them as known issues.
7. **PR.**
   - One PR from `feat/oss-v0.1` to `main`.
   - The description has: summary, what works (checked), what is designed but not built (with roadmap IDs), how to try it in 60 seconds, verification evidence, known issues, and the ADR list.
   - Do **not** publish to npm or create releases. Prepare `npm pack` and a release workflow only.

If time or context runs short, stop at a wave boundary with a green build. Keep the single PR and mark what is unfinished. The v0.1 minimum is:
- bundle + check
- CLI init/new/status/report
- local serve with the manual runner
- fs + S3 sync
- the Playwright reporter
- the Claude Code skills
- the docs

## 10. Definition of done for v0.1

- In an empty directory: `npx indx-watch init demo` → `iw new uc` / `iw new tc` → `iw check` passes → `iw serve` shows the readiness dashboard → run a TC manually in the browser with a screenshot → `iw report --format html` produces a shareable file. All of this works offline.
- Two clones with the same S3 bucket see each other's runs within seconds via `iw sync --watch`. Definitions sync through git.
- In `examples/shop`, `npx playwright test` with the reporter creates runs linked to `TC-*` by tag, including fixture hashes, the commit SHA and the actor. In GitHub Actions the run links to the PR and job and appears in the job summary.
- Claude Code with the shipped skills can be asked "add test cases for UC-12 and run them". It writes valid TOML (drafts marked `origin = "ai"`), runs them and reports, using `iw --json` and/or MCP.
- `iw deploy --dry-run` prints the exact Cloudflare resources and wrangler commands. The deployed server is the same code as `iw serve`.
- `iw export --full` → `iw import` into a fresh folder round-trips with identical manifest hashes.
- The docs follow §7. Every fact has one home. CI enforces links, schemas and the round trip. `README.md` lets a stranger succeed in 60 seconds.

Report back at the end, in Japanese (the user's language):
- the PR URL
- what works
- what is designed but not yet built
- the top risks
- what the user should do next: repository settings, secrets for optional S3/Cloudflare, publishing
