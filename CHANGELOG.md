# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Customize without code (T-507): optional `.indx-watch/ui/` (`messages.<locale>.json` text overrides, `theme.toml` allowlisted tokens) and `[report]` title, logo and footer in `project.toml`; `iw check` rejects unknown keys, changed placeholders, markup and unsafe values, and warns about low contrast.
- `iw patch create | apply | check [--to <version>]` (T-508): keep your own changes as patches against upstream at `v<pinned>`; changes to verdict, gate, status, signing, identity and the secret scan are refused; `iw deploy` deploys the patched build. `patches/` is not loaded, scanned, snapshotted or uploaded.
- Patched servers say so (T-509): `/healthz`, `/api/project` (`server.patches`), MCP `serverInfo`, report footers, a note in the app and an additive `client` field on records they write.
- Guides: Customize INDX Watch safely and Keep a fork up to date; `[tool] source = "github:<owner>/<repo>"` names a fork (T-510; `iw patch` uses it, `iw doctor` and `iw update` do not follow it yet).
- Staying current with upstream: `iw doctor [--online]` reports every pinned part of a project (`[tool]`, the CLI, `package.json`, `.mcp.json`, skill copies, workflows, the hosted app) as `ok`, `outdated`, `unpinned` or `locally-edited` and changes nothing (T-503).
- `iw update [--to] [--dry-run] [--deploy] [--workflow]` moves the package entry, skill copies, `.mcp.json`, workflow versions and `#:schema` URLs to one version, prints the install command and checks the bundle; `--workflow` writes a weekly workflow that opens an update pull request (T-504, T-505).
- `project.toml` accepts `[tool] indx_watch = "x.y.z"`; `iw init` writes it, the GitHub Action runs that version when its `version` input is empty, and `iw deploy` pins `IW_VERSION` on the Worker; `.mcp.json` is written as `npx -y indx-watch@<version> mcp` and an unpinned entry is migrated (T-501, T-502).
- `GET /healthz` answers `{ ok, version }` and `GET /api/project` has `server: { version, pinned?, outdated? }`; the web app tells leads when it runs an older version than the project pins, in English and Japanese (T-501, T-506).
- `ReleaseSource` adapters for the npm registry and GitHub releases, a fake, and `releases.json` generated from this changelog and shipped in the package (T-503).
- BDD style for test cases: `style = "bdd"` reads the preconditions and steps as a Given / When / Then scenario, `iw new tc --template bdd` is built in, and the test case page, the manual runner and the editor show the labels and a "How to run this scenario" guide in English and Japanese (前提 / もし / ならば / かつ). examples/shop's TC-4 uses it.
- `iw issue <run | TC-n | AC-n.m | UC-n> [--open] [--link <url>]` and an Open as GitHub issue link on the run viewer and the test case page (T-518): a prefilled, length-capped, secret-scanned new-issue URL that a person submits; INDX Watch never writes to GitHub.
- `iw import github-issue <number | URL> [--from <file.json>] [--feature F]` (T-519): one GitHub issue becomes one draft use case with its task list as draft criteria and the issue URL in `links`; a re-import changes nothing. An `IssueSource` GitHub REST adapter (token optional) and a fake.
- GitHub issue forms `indx-watch-test-request.yml` and `indx-watch-test-failure.yml` (T-517, `githubTemplates()`), offered by `/iw-setup`.
- Optional `links` on test cases (http(s) only) and `[github] repo` in `project.toml`; test cases and the run viewer show Related issue #42 (T-520). The `iw-triage` skill uses `iw issue`, and `iw-design` reads GitHub issues.

### Changed

- Landing page (`site/`) rebuilt after proven developer-tool pages: a role switch (developer, tester or QA, product manager) that changes the hero, the demo and the For teams tabs (`?for=`), a four-chapter product demo drawn as HTML from the web app's own screens and strings, then features, roles, strengths (GitHub, agents, test data, sync, self-hosting) and getting started, in English and Japanese. Design rules and references: [site/DESIGN.md](site/DESIGN.md).
- README: developer-first, with benefits for developers, testers and product managers, and new Japanese ([README.ja.md](README.ja.md)) and Simplified Chinese ([README.zh-CN.md](README.zh-CN.md)) versions.

### Fixed

- `GET /api/report` and `POST /api/shares` refuse an unknown `evidence` value with 400; before, any value but `links` passed the share-link check and was rendered as evidence links, which a share link cannot serve.
- `PATCH /api/fixtures/<FX>` answers 400 when `table.rows` is not a list of lists, instead of 500.
- `GET /api/store/list` clamps `limit` to a whole number from 1 to 1000; zero, negative and fractional limits reached the object store.
- `iw --dir x <unknown command> --json` names the unknown command in its error envelope, not the value of `--dir`.
- The Test data page shows an error and re-enables its forms when a picked file cannot be read; the test case editor disables Save while it saves, so a double click no longer sends two edits.

## [0.1.2] - 2026-11-24

### Fixed

- A definition file that does not load (for example a TOML syntax error) no longer disappears silently: every command warns about it (text and `--json` `warnings`, also on error envelopes and MCP tools), and the readiness gate fails while it exists with a new first check `valid_definitions` in `evaluateGate()`, so `iw status --gate` can no longer flip to passed when a use case breaks.
- `iw check` names the line and column of a TOML syntax error and quotes the line; its summary is printed once and pluralized (`1 error`).
- `iw serve --port abc|70000` is a usage error instead of a stack trace that never exits; the server stops its watcher when it cannot listen.
- A missing `--from` file (`iw record`, `iw new`, `iw translate`) or `--out` folder (`iw report`) is `NOT_FOUND` (exit 2) instead of an internal error with a stack.
- A positional argument to a command that takes none (`iw sync s3://other`) is a usage error instead of being ignored.
- The MCP server reports the package version in `serverInfo` instead of `0.1.0`.
- `iw init --help` no longer shows a stray `cx.` prefix; `iw init` on an initialized directory says it is already set up and how to refresh the agent files.
- `iw list` sorts keys by number (`TC-2` before `TC-10`) and marks drafts in text output; `iw status` without ready criteria no longer prints `Coverage: 0/0 ACs (100%)`.
- The Playwright reporter prints why a run lands in `needs_review` (the decision policy's reason, and the `mode = "manual"` hint).

### Changed

- Docs: a restructured README (who it's for, screenshots, quickstart, key terms, status and versioning); new guides [From zero to "can we ship?"](docs/guides/journey.md) (the whole path by role) and [Using the web app](docs/guides/web-app.md); the docs are also published as a Mintlify site from the same Markdown files ([ADR 0014](docs/adr/0014-docs-site.md)), and `pnpm check:docs` also checks links to this repository on GitHub and the docs-site link rules.
- `iw init` and `iw skills install` install seven skills instead of twelve: the `indx-watch` overview and the six job skills. The five recipe skills of 0.1 (`write-test-cases`, `manage-fixtures`, `run-tests`, `triage-failure`, `release-report`), whose triggers overlapped the job skills', are now reference files of the job skill they served (`iw-design`, `iw-data`, `iw-test`, `iw-triage`, `iw-status`), loaded on demand. Re-running `iw skills install` removes the recipe folders INDX Watch wrote (a folder with files you added stays, with a warning) and lists them in `data.removed`.
- `iw init` ends with agent-first next steps that run as printed (`npx indx-watch serve --open`, or ask Claude Code or Codex to "Set up testing for this repo"); `iw init --example` also pulls the sample results so `iw status` and `iw serve` show them at once.

### Added

- Web app first run: a project without test cases shows "No test cases yet" on Home and Tests with the two ways to start (ask your agent, `/iw-setup` or `$iw-setup`, or `npx indx-watch new uc …`) and a quickstart link; draft test cases carry a Draft chip wherever they are listed and a criterion with only drafts reads "No approved test"; Home counts ready tests like the gate ("7 of 8 tests pass · 2 drafts not counted until approved"); without an upload the fourth card shows the latest result; the bar has a language switch; on your own run the review form explains that your review changes your verdict; UI strings use ICU plurals ("1 feature").
- `pnpm screenshots` regenerates the docs screenshots in `docs/images/` from the web app with `examples/shop` and its sample results; the guides use them instead of hand-made images.
- Test data in the web app for the whole team: any dropped file (PDF, image, CSV, …) becomes a draft fixture without writing TOML, and the Test data screen creates, edits (table rows, seed JSON, account, files) and deletes fixtures. Writes go through the upload path in git mode and as `file` records in workspace mode (uploads included), so edits on the hosted app reach every working copy with `iw sync`; testers may edit test data (T-410).
- Sharing test data and secrets like a shared drive: fixtures and secrets are shared with the whole team or only with listed emails and `group:` names (`shared_with`; leads always have access). The Test data screen gains a Share dialog, "Who has access" per item, a Secrets tab and, for leads, an Access tab that shows everything one email can open and why. On the hosted app with roles, people see only the data shared with them (T-411).
- Secrets kept by INDX Watch: `iw:<name>` references to a login ID and a value sealed with AES-256-GCM under the server's `IW_SECRETS_KEY` (`iw keygen --secrets`), stored as `secret` records; the value is shown only to people it is shared with, next to an account's login ID on the Test data screen and the test case page, and every view is recorded (T-411).

### Security

- `iw deploy --public` deploys are read-only: every visitor is an anonymous `viewer`, every write (bundle, store objects, blobs, runs, reviews, waivers, fixtures, secrets, share links, MCP write tools) answers 403 `read-only`, `[hosting.roles]`, the `iw_tester` cookie and `IW_SECRETS_KEY` are ignored, and the web app shows a read-only notice. Before, every visitor of a public deploy had the `lead` role.
- Secrets: an opened `secret` record is remembered by its content, not its ID, so a body swapped in the bucket under the same ID no longer counts without the key; revealing a value answers with `Cache-Control: no-store`.
- Release workflow: install and `pnpm verify` run without write tokens; publishing only downloads the packed tarball; the floating `v0` tag follows each 0.x release so `uses: INDXDev/indx-watch@v0` resolves. Dependabot watches GitHub Actions and npm; CI checkouts do not keep credentials.
- The public demo resets weekly and on each deploy from `examples/shop`.

## [0.1.1] - 2026-11-23

### Added

- Guided runs record ticked checks: `iw record --checks <n>=1,0` (one `1` or `0` per check of step `n`) and `checks` on MCP `record_run` steps write `steps[].checks`; a list whose length differs from the step's checks is refused. MCP `status` takes `mine` like `iw status --mine`. The `iw-test`, `iw-status` and `run-tests` skills use them (T-408).
- Dogfooding v0.4: `.indx-watch/` gains UC-9 (my features), UC-10 (one-command agent setup), AC-3.5 and AC-3.6 with TC-15–TC-18 (guidance fields filled), implemented by e2e tests tagged `@TC-15`–`@TC-18`; this repository installs its own skills with `iw skills install` and a test keeps the installed copies current (T-408).
- Docs: a skills-first quickstart ("install once, then ask your agent": `npx indx-watch init`, then `/iw-setup`, `/iw-design`, `/iw-data`, `/iw-test`, `/iw-status` in Claude Code or `$iw-…` in Codex, with the CLI in a "Without an agent" section), a guide "Testing with Claude Code or Codex" by job with English and Japanese phrases, the guidance fields in "Writing good test cases", and screenshots of the one-page test case; the README leads with the skills (T-409).
- Skill lint in `pnpm test`: every skill's frontmatter (name, description, compatibility, keys allowed per client, also on the installed `.agents/` copies), length, `iw` commands against cli.md, example keys against `examples/shop` and relative links (T-407).
- Job skills `iw-setup`, `iw-design` and `iw-data` (installed by `iw init` / `iw skills install`): a coding agent connects a repository (bundle, environment, release, features with proposed owners, the Playwright reporter and optionally a GitHub Actions workflow), designs tests from the source and the existing tests (plain-language proposals, drafts written only for those the user accepts, with the guidance fields) and prepares the fixtures test cases need (with `use` and `note`, secrets as `env:` references), in English or Japanese, one question at a time, without the user needing the CLI (T-405).
- One-page test case: the page reads What this tests (purpose, feature, covered criteria) → Before you start (an Open link from the environment's `base_url` and `start`, test data cards that say what to do with each fixture — download, upload in step N, enter, seeded — with a download button per file, preconditions as a checklist) → Steps with their `checks` → Result. "Run manually" opens the runner in place without changing the URL, one step at a time with Next; ticking every check suggests pass, a failed step with an unticked check asks for a note, and the run records the ticks as `steps[].checks` (additive). Run manually from Focus shows the session bar and steps through the session, and leaving a runner with unsaved results asks first. `#/tc/<TC>/run` opens the same page with the runner open; the run viewer shows the ticked checks; `GET /api/blobs/:sha256` also serves fixture files stored in git (T-404).
- One-command agent setup: `iw init` (unless `--no-agents`) and `iw skills install` write the skills to `.claude/skills/` and `.agents/skills/` (portable frontmatter plus `agents/openai.yaml` for Codex), the project MCP server `indx-watch` in `.mcp.json` and `.codex/config.toml`, and a marked block in `AGENTS.md` listing the skills and when to use them (`@AGENTS.md` added to an existing `CLAUDE.md`). Other MCP servers and text are kept, and re-running updates only what it wrote; `--json` adds `files` (and `agents` on `iw init`) (T-401).
- A `node:sqlite` index on Node with the D1 schema and merge writes; `iw reindex` builds it in `.indx-watch/cache/index.sqlite` instead of a throwaway in-memory index; an index file from another schema version is emptied when opened (T-210).
- `iw serve` reads records through `cache/index.sqlite`: a start or a replica change parses only record files the index does not hold yet, with the same API results; a removed or rewritten file rebuilds the index, an index file that is not a SQLite database is replaced, and an unusable index falls back to reading the replica (T-217).
- `iw import playwright-plan <file.md> --uc <UC>`: each scenario of a Playwright Test Agents planner plan becomes an AI-written draft test case; sample plan in `examples/shop/specs/` (T-212).
- Flaky tests: a flake rate per test case over its last 10 pass/fail runs (`flaky: true` judgements and pass/fail flips on the same build or back and forth) in `iw status --json`, the API and a Flaky (quarantine) view on the Tests screen; it never changes verdicts or the gate (T-303).
- GitLab CI, CircleCI and Buildkite context: the reporter and the CLI fill `build`, `ci`, the actor (`via = "gitlab"`, `"circleci"`, `"buildkite"`, verified only when signed) and the run group (a retried job starts a new execution) from each provider's standard variables (T-208).
- Impact analysis: `iw impact --changed <paths>` or `--base <ref>` suggests the test cases a change touches, from `[automation].files` (paths or globs), the test case and use case files and referenced fixtures; the GitHub Action adds a "Suggested test cases" section to its PR comment and check run (T-304).
- MCP over Streamable HTTP: `iw serve` and the hosted Worker serve the `iw mcp` tools at `/mcp`, behind the same identity as `/api` (Cloudflare Access on a deploy); writes record that identity with `kind = "agent"`, `record_run` evidence names uploaded blobs, and `new` publishes AI drafts into the served bundle (T-205).
- Log compaction: `iw compact` writes a log snapshot (`v1/snapshots/<ULID>.json`) holding the store's log objects with their keys; a fresh clone and the daily full listing read the newest one and then fetch only the log objects it lacks, with the same merge results as reading the whole log. A corrupt, foreign or newer snapshot falls back to the log with a warning; `iw sync --full` ignores snapshots; `iw sync --json` reports `logSnapshot`. Pulls merge the records of a log object concurrently, and folder stores create each folder once, so a fresh clone pulls 100,000 records in seconds (T-206).
- Visual judge with approved baselines: `iw baseline approve <run>` (people only) or "Approve as baseline" in the run viewer writes a `baseline` record for a run's PNG screenshot; `iw judge <run> --visual` compares later screenshots pixel by pixel and appends `visual` judgements with `diff_ratio`, which the decision policy weighs against `visual_threshold` (T-207).
- GitHub OIDC signing: in GitHub Actions with `id-token: write` and `IW_OIDC_SIGNER`, the CLI and the reporter record `via = "github-oidc"` and get each record signed by the hosted server, which verifies the job's OIDC token (GitHub JWKS, issuer, audience `indx-watch:<project>`, expiry) and the repositories pinned in `[hosting] oidc_repositories` (`POST /api/sign`); no long-lived signing secret in CI (T-211b).
- Report share links on the hosted app: the Report screen's Share links section (or `POST /api/shares`) freezes the previewed HTML report as a blob behind `/s/<token>` (128-bit token, stored hashed), which opens without signing in until it expires (default 7 days, max 90) or is revoked; creating, opening and revoking each write a new `share` record. Only people signed in through Cloudflare Access create or revoke links; `iw deploy` routes `/s/*` to the Worker, and the guide adds an Access Bypass application for it (T-203).
- Agent execution mode: `iw run <TC>` lets Claude follow an `agent` test case's steps in a browser (actions chosen from Playwright's accessibility snapshot) and records the run with a note and a screenshot per step and one `llm` judgement. A step the agent reports failed fails the run, and the agent can navigate only within the base URL's origin. `--browser local` uses the project's Playwright (imported only when a run starts); `--browser cloudflare` uses Cloudflare Browser Run over CDP. `examples/shop` gains the agent test case TC-10 (T-201).
- Roles on the hosted app: `[hosting.roles]` in `project.toml` (pinned by `iw deploy` as `ROLES`) maps Access user emails and group IDs, names or emails, looked up through Access `get-identity`, to `lead`, `tester`, `viewer` or `customer` (optional `default`). Viewers read only, testers also record runs, reviews and store writes (no waivers, baselines or snapshots), leads do everything; a customer sees and runs only the plan items assigned to them by email or by the new `group:<name>` assignee, across the API, reports and the web app, without the notes, judgement reasons, CI links, environment guides and other people's emails that customer reports redact, and `/mcp` is refused. The web app hides actions the role cannot use. Without roles, and on `iw serve`, everyone is `lead` (T-301).
- Workspace mode for teams without git (`[store] mode = "workspace"`): `iw sync` publishes changed definition files as `file` records (canonical TOML blobs, versions keyed by record ID) and writes the store's current definitions into the working tree; concurrent edits merge field by field, and edits of one field on both sides leave a `<name>.conflict-<sha8>.toml` file that fails `iw check` until resolved. `iw sync` refuses while git tracks the bundle, and an agent's changes are published only as AI drafts. The hosted app serves definitions from the `file` records and edits a test case's title, priority and steps (`PATCH /api/test-cases/:key`) as `file` records of the signed-in person; uploads are refused in workspace mode (T-209).
- Customer UAT: `iw invite <email> --plan <PLAN> [--items …] [--revoke]` and, on a workspace-mode hosted app, `POST`/`DELETE /api/plans/:key/invites` (leads only) assign or unassign a customer's plan items and add or remove their email in a reusable Cloudflare Access policy (`IW_ACCESS_POLICY`, `CLOUDFLARE_API_TOKEN`); customers sign in with an Access one-time PIN. Without `--items` an invite takes only the plan's unassigned items; naming an assigned item reassigns it and reports it. With a role table that has no `default`, an invited email assignee that matches no `[hosting.roles]` entry is a `customer`, and an uninvited one is refused; invites refuse a role table whose `default` is not `customer`, and tables with a `default` behave as before. The Access policy is written back with all its writable settings and read again to catch a concurrent write; the customer's Home lists only their assigned items with Run. Tested end to end on the Worker against a fake Access API and JWT issuer; a run against a real Access policy is a manual step (T-302).

- Feature owners: optional `owners` on `feature.toml` (emails or `group:<name>`, matched like plan assignees). `iw status --mine` and `iw list --mine` narrow to the features the current actor owns (`--json` adds `mine` to `status`); `GET /api/status` and `GET /api/specs` take `mine=1`, `GET /api/project` returns `owns`, and the spec tree carries `owners`. The web app starts Home, Tests, Focus and the runner session in "My features" when the viewer owns one, with an "All features" switch in the scope menu kept per browser; the Tests tree shows each feature's owners. `examples/shop` features get owners (T-402).
- Test case guidance fields: `purpose`, `start` (a path on the environment's `base_url`) with `start_note`, per-step `checks` (yes/no observations next to `expected`) and per-fixture `use` (`download`, `upload`, `enter`, `seeded`) with a `note`. They translate like the other fields (`[fixtures.i18n.<locale>]` is new; `iw translate` takes `steps.<n>.checks.<m>` and `fixtures.<n>.note`), are not part of the test case version, and `iw check` warns (`missing-guidance`) about a `ready` manual or hybrid test case without `purpose` or a start, and (`translation-length`) about a translated `checks` list whose length differs from the source. `examples/shop` fills them in English and Japanese (T-403).
- Job skills `iw-test`, `iw-triage` and `iw-status` (installed by `iw init` and `iw skills install`): run "my features" or named test cases and walk a person through a manual test case in the chat check by check, recording an agent run that a person then reviews; explain a failure with evidence and propose a fix or issue text; say whether a release can ship, by feature and owner, who must act next, and write the report. Triggers in English and Japanese; commands only on request (T-406).

### Fixed

- `iw new uc --origin ai` (and MCP `new` of a use case) writes the criteria given with `--ac` as drafts with their own `[ai]` table, as `iw new ac` does; before, they had `origin = "ai"` without either, so `iw check` failed on the new file (T-408).
- `iw-setup` treats a bundle that holds only the placeholders of `iw init` (no use cases, no runs) as new and replaces them, so `npx indx-watch init` followed by `/iw-setup` no longer keeps the `local` environment, the `v0.1.0` release and the "General" feature (T-409).
- `iw record` and the MCP `record_run` tool now answer with the verdict `iw show` and `iw status` compute: an agent's pass of a test case that declares a judge it has no judgement from (e.g. a `human` judge) is `needs_review` (rule 10), not `pass`. Every caller passes the test case's facts to `decide()` through `runFacts()` (T-406).
- A test case without `[[judges]]` now declares its mode's documented default judge (`human` for `manual`, `assert` for `playwright`), so an agent's confident `llm` pass, or a CI actor's `assert` pass, of such a manual test case is `needs_review` until a person reviews it, and an agent's pass of such a Playwright test case waits for an `assert` judgement (T-406).
- `iw run --browser local` loads Playwright from the project (the current directory) before the copy next to the CLI, so `npx indx-watch run` finds the project's `playwright` (T-201).

## [0.1.0] - 2026-11-21

### Added

- First open-source version (v0.1): bundle format, `iw` CLI, local server and web UI, result store sync (folder and S3-compatible), Playwright reporter, GitHub Action, agent skills and MCP server, Cloudflare deploy, full archive export/import. See [docs/roadmap.md](docs/roadmap.md#v01--file-first-core).
- A `Demo` workflow deploys `examples/shop` to a public Cloudflare Worker from `main`, so every change has a live demo site (T-118).
- GitHub Action: `comment` and `check` inputs keep one PR comment per bundle and release and create an `INDX Watch` check run (T-204).
- `iw judge <run>`: an LLM judge (Claude, `claude-opus-5-5` by default) that adds an `llm` judgement from the test case's rubric, the run's steps and its last screenshot (T-202).
- Web app v2: a calm Home (verdict, summary cards, your queue, recent activity), List and Focus views with ← / → and swipes, runner sessions with keyboard shortcuts, an Activity screen and a CLI panel with copyable commands (T-213).
- "Who's testing?": a tester can declare a name in the browser where no verified identity exists; runs record it as `via = "browser"` (T-214).
- `iw push`, `iw clone`, drag-and-drop upload with a checked preview, and an Uploads screen (T-215).
- `iw translate`; release and plan titles are translatable; reviews record their locale; `examples/shop` and this repository's bundle are complete in Japanese (T-216).
- Signed records: `iw keygen`, `IW_SIGNING_KEY` and `[[signing_keys]]` in `project.toml`. A record that claims a verified `via` without a valid signature is shown as unverified, and `[gate] ignore_unverified` keeps it out of the gate (T-211, #5).
- Features, environments, releases and plans written by an agent carry `origin = "ai"` and `[ai]`; `iw check` warns until `iw approve` records a reviewer (#4).

### Changed

- The Japanese machine translations in `examples/shop` and this repository's bundle use consistent terms and more natural phrasing; they stay `status = "machine"` until a human reviews them (T-216).

### Fixed

- Two bodies with one record ID now converge on the one whose log key sorts first, in every clone and in the hosted index; the conflict shows in `iw check` and the UI (#3).
- `iw translate` keeps every `--set`, not only the last.
- The remaining acceptance criteria are tested (T-117, #6).

[Unreleased]: https://github.com/INDXDev/indx-watch/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/INDXDev/indx-watch/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/INDXDev/indx-watch/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/INDXDev/indx-watch/releases/tag/v0.1.0
