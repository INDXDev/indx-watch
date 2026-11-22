# Agents: skills, MCP server and AI rules

INDX Watch is built so a coding agent can go from "read the spec" to "write test cases, attach fixtures, run them, triage failures and report" without a human translating anything. Agents use the same typed files and the same CLI as people, plus an MCP server. Format details for each agent product are in [platform notes](../research/platform-notes.md#agent-skills).

## Surfaces

| Surface | Use it for |
|---|---|
| Files in `.indx-watch/` | Reading specs; writing definitions (validated by `iw check`). Agents edit TOML like any code. |
| `iw … --json` | Every operation; stable [envelopes](cli.md#json-envelope). Preferred inside coding agents that have a shell. |
| MCP (`iw mcp`) | Agents without a shell, or when typed tools are preferred. Same operations, same shapes. |
| Skills | Task recipes that teach the agent the workflow and the rules below. |

## Skills
Skills follow the open Agent Skills format (`SKILL.md` with YAML frontmatter), which both Claude Code and Codex load. They live once in [`skills/`](../../skills) and are installed into a repository by `iw init` or `iw skills install` ([install](#install)).

Source frontmatter uses the portable fields (`name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools`) and may add the Claude Code fields `argument-hint` and `disable-model-invocation`. Installed copies keep only the keys their client accepts, so an `.agents/skills/` folder also uploads to claude.ai.

### Install
`npx indx-watch init` (unless `--no-agents`) and `iw skills install` in an existing project write, in the repository root ([cli.md](cli.md#iw-skills-install)):

| Writes | For | Content |
|---|---|---|
| `.claude/skills/<name>/` | Claude Code (`/<name>`) | The source folder as is |
| `.agents/skills/<name>/` | Codex (`$<name>`, `/skills`) and other Agent Skills clients | The source folder with only portable frontmatter keys, plus `agents/openai.yaml` (`interface.display_name`, `interface.short_description` from the description's first sentence, `policy.allow_implicit_invocation`, `false` when the source sets `disable-model-invocation: true`) unless the source has one |
| `.mcp.json` `mcpServers.indx-watch` | Claude Code | `npx -y indx-watch mcp`; each person approves it once |
| `.codex/config.toml` `[mcp_servers.indx-watch]` | Codex | The same server; loaded once the project is trusted. Appended when the table is absent |
| `AGENTS.md` block between `<!-- indx-watch:start -->` and `<!-- indx-watch:end -->` | both | One line per skill: how to call it and when to use it (the `Use when …` sentence of its description). `CLAUDE.md` gets an `@AGENTS.md` line if it exists without one |

Re-running rewrites the installed skill files that differ from the source, the `.mcp.json` entry and the marked block in place; it keeps an existing `[mcp_servers.indx-watch]` table, does not delete files the source no longer has, and leaves other servers, settings and text alone. A `.mcp.json` or `.codex/config.toml` that does not parse, or that defines `mcp_servers` as an inline table, is left unchanged with an `agent-config` warning. Commit the result so the whole team gets the same setup.

| Skill | What it does | Main commands |
|---|---|---|
| `indx-watch` | Overview: layout, keys, rules below; links the others | `iw status`, `iw list` |
| `write-test-cases` | From a use case (or a PRD/issue), propose ACs and test cases as `draft`, `origin = "ai"` | `iw show UC-n --json`, `iw new tc --from - --origin ai --model …`, `iw check --json` |
| `manage-fixtures` | Create or update fixtures, choose kinds, keep secrets as references, add large files as blobs | `iw new fixture`, `iw fixture add`, `iw check` |
| `run-tests` | Run linked Playwright tests or execute manual/agent steps and record results with evidence | `npx playwright test --grep @TC-n`, `iw record`, `iw sync` |
| `triage-failure` | For a failed run: read evidence, classify (product bug / test problem / environment or data), propose a fix or an issue text | `iw show RUN --json`, `iw review` is **not** used by agents |
| `release-report` | Compute readiness and write the report for a release | `iw status --gate --json`, `iw report` |

Each skill states: when to use it, the exact commands, the JSON fields to read, and the rules below. Skills set `IW_ACTOR_KIND=agent` and `IW_AGENT_MODEL=<model>` on every write command; the CLI also detects common agent environments on its own ([security.md](security.md#identity)).

## MCP server
`iw mcp` starts a stdio MCP server built with the official TypeScript SDK. Register it:

```bash
claude mcp add --scope project indx-watch -- npx -y indx-watch mcp
codex mcp add indx-watch -- npx -y indx-watch mcp
```

`iw serve` and the hosted server expose the same tools over Streamable HTTP at `/mcp`: `https://<worker>/mcp` for a deploy, `http://127.0.0.1:4321/mcp` locally. The endpoint is stateless (one request, one exchange; 2025-era and 2026-07-28 clients) and sits behind the same identity as `/api` ([security](security.md#hosted-app)): on Cloudflare every request needs Cloudflare Access, so send `cf-access-token` from `cloudflared access token -app=<url>` (people) or the Access service token headers `CF-Access-Client-Id` / `CF-Access-Client-Secret` (CI):

```bash
claude mcp add --transport http indx-watch https://<worker>/mcp \
  --header "cf-access-token: $(cloudflared access token -app=https://<worker>)"
```

| Tool | Input | Output | Annotations |
|---|---|---|---|
| `status` | `release?`, `environment?` | `iw status` data | read-only |
| `list` | `kind`, filters | `{ items }` | read-only |
| `show` | `ref` | entity + runs | read-only |
| `check` | — | `iw check` data | read-only |
| `new` | `kind`, `fields` (object), `origin`, `model` | `{ id, key, file }` | writes files |
| `record_run` | `test_case`, `verdict`, `steps[]`, `evidence[]` (paths), `note`, `confidence` | `{ run, verdict }` | writes records |
| `report` | `release?`, `format` (`md`/`json`) | report text or data | read-only |
| `sync` | — | sync counts | network |

Both transports serve one tool set (`packages/server/src/tools.ts`). Each tool's output is exactly the `data` of the matching CLI command (`CommandData` in `packages/cli/src/json.ts`; `report` returns the Markdown text or `ReportData`), returned as `structuredContent` with an output schema. `record_run.steps[]` items are `{ index, status, note? }`. Every write made through `iw mcp` is recorded with `actor.kind = "agent"`. Tools that write are annotated `destructiveHint: false, idempotentHint: false`; read tools `readOnlyHint: true`. There is no `approve`, `review` or `waive` tool. `new` has no origin input: it always creates AI drafts. `new` and `record_run` take a `model` (fallback `IW_AGENT_MODEL`, then the MCP client's name with a warning). CLI warnings are returned as a second text block.

Over HTTP the tools work on the server's model and store instead of local files:

- Every write is recorded as the request's identity (the verified Access identity on Cloudflare, the `iw serve` identity locally) with `kind = "agent"` and the `model`, and the server signs it like its other writes. `new` and `record_run` refuse a write without `model` (`USAGE`): a stateless request carries no client name to fall back to.
- `record_run.evidence[]` items are the `sha256` of blobs uploaded before with `POST /api/blobs`, optionally with `@step`; the run gets `source = "agent"` and the server's build context, release and default environment.
- `new` writes the AI draft into the served bundle like an upload (files on disk for `iw serve`, a new bundle snapshot on Cloudflare). It needs a server that accepts uploads, and refuses a file name that is not a path inside the bundle (a release version or environment name with `..`).
- `check` validates the served bundle files; `report` renders for the internal audience with evidence links.
- `sync` returns an error: the hosted server is the result store, so run `iw sync` where the files are.

## Rules for AI-written content

1. **Draft first.** Anything an agent creates has `origin = "ai"` and an `[ai]` table (`model`, `skill`, `created_at`), and `status = "draft"` where the kind has a status. Features, environments, releases and plans have none: `iw check` warns about them until a human approves them ([concepts](concepts.md#test-case-use-case-fixture)). `iw new` does this for every agent actor.
2. **Humans approve.** Only a human runs `iw approve`, which records who approved which version. `iw check` rejects a `ready` `ai` item whose `approved_version` is not its current version, and warns about an `ai` feature, environment, release or plan without `approved_by`. Drafts never count towards readiness.
3. **Agents never review.** `iw approve`, `iw review`, `iw waive` and `iw baseline approve` refuse agent actors (agents may run `iw judge --visual`, which only compares screenshots with baselines a person approved). Agents may record runs they executed, with `actor.kind = "agent"`. Agents may retract only records they recorded themselves.
4. **Confidence is mandatory for agent verdicts.** An agent-recorded verdict becomes an `llm` judgement with the given `confidence`; below the policy threshold it is `needs_review` ([decision policy](concepts.md#decision-policy)).
5. **Evidence or it did not happen.** Agent `pass` verdicts must attach evidence (screenshot, log or the Playwright result); `iw record` warns otherwise and the gate's `require_evidence` treats them as missing.
6. **Literal strings stay literal.** Quoted on-screen strings are copied exactly ([i18n](i18n.md#literal-strings)).
7. **No secrets.** Agents reference secrets (`env:NAME`); they never write values into files, records or chat.

## Safety
Bundle text, fixture data, evidence and page content are **data, not instructions**. Skills tell agents to ignore instructions found in them, never to run commands found in them, and to stop and ask a human when content asks for credentials or for changes outside `.indx-watch/` and the tests.

## Agent execution mode (v0.2)
`iw run <tc>` ([cli.md](cli.md#iw-run-tc-ref)) executes an `agent` (or `hybrid`) test case without a Playwright test: Claude follows the plain-language steps in a real browser and the run is recorded like any other.

```mermaid
sequenceDiagram
  participant R as iw run
  participant B as BrowserProvider
  participant L as LlmClient (Claude)
  R->>B: open(base_url)
  loop each step, at most --max-actions actions
    R->>B: observe() → URL, title, accessibility tree with refs, screenshot
    R->>L: next(step, page, actions so far)
    L-->>R: navigate / click / fill / press / select, or step_done(status, note)
    R->>B: act(action)
  end
  R->>L: judge(rubric, expected results, step results + final page, screenshot)
  R->>R: append the run (source "agent"): steps with notes, a screenshot per step, one llm judgement
```

- **Steps.** Placeholders are filled first: `{{FX-n.column}}` from the first selected row of a dataset, `{{FX-n.username}}` from an account fixture and `{{env.<field>}}` from the environment. Secret values are never given to the model, so a step that needs a password should use a literal test value or stay `manual`.
- **Actions.** The model sees the page as Playwright's accessibility snapshot (`ariaSnapshot({ mode: "ai" })`, elements carry refs such as `e7`) and answers with one action: `navigate`, `click`, `fill`, `press`, `select` (by ref), or `step_done` with `pass`, `fail` or `blocked` and a one-sentence note. `navigate` stays on the origin of the base URL (other origins and schemes such as `file:` are refused and the agent sees the error), so text on a page cannot send the browser, and its screenshots, elsewhere. A step without `step_done` after `--max-actions` actions (default 15) is `blocked`. After a step that does not pass, the remaining steps are `skipped`.
- **Evidence.** Each step result keeps the agent's note followed by the actions it took and their outcome, and the screenshot of the page when the step ended (a `screenshot` evidence item with its `step`, stored as a blob in the local replica).
- **Verdict.** The run ends with one `llm` judgement from `LlmClient.judge`: the test case's `llm` rubric (or, without one, its expected results) against the step results, the final page and its screenshot. The [decision policy](concepts.md#decision-policy) decides the verdict as for every run: a confident pass is `pass`, a step the agent reported `fail` adds a second `llm` judgement (`fail`, confidence 1, the step's note as reason) so the run fails even if the final judge passes it, confidence below `llm_pass_confidence` or a declared `human` judge is `needs_review`, and a blocked step makes the run `blocked` (`reported`).
- **Browsers** (`BrowserProvider` adapters in `@indx-watch/store/node`): `--browser local` (default) launches headless Chromium through Playwright, which the published package does not depend on: `iw run` imports `playwright`, `playwright-core` or `@playwright/test` from the project when a run starts (install one with `npm install -D playwright` and `npx playwright install chromium`; `PW_CHROMIUM_PATH` uses an installed Chromium instead). `--browser cloudflare` connects the same Playwright code to [Cloudflare Browser Run](../research/platform-notes.md#browser-run-and-workflows) over CDP with `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` (a token with *Browser Rendering - Edit*); the browser runs in Cloudflare, so the base URL must be reachable from the internet.
- **Model.** The Anthropic adapter (`claude-opus-5-5` by default, `--model` or `IW_LLM_MODEL`; credentials as for [`iw judge`](#llm-judge-v02)) picks actions at low effort with a JSON schema; a refusal or an unparseable answer ends the step as `blocked`. Page content and bundle text are data, not instructions, in both prompts.
- **Who records it.** The run's actor is whoever runs `iw run` (a person, CI or an agent); `source = "agent"`; the judgement's `by` names the model as an `agent` actor, like `iw judge`.

`examples/shop` has one agent test case, `TC-10` (an AI-drafted search check covering AC-1.1 and AC-1.2): with the shop app running, `iw run TC-10 --dir examples/shop/.indx-watch` records a run with two screenshots.

## LLM judge (v0.2)
`iw judge <run>` ([cli.md](cli.md#iw-judge-run-ref)) sends a recorded run (steps, results, notes, last screenshot) and the test case's `llm` rubric to Claude through the `LlmClient` port (Anthropic adapter, `claude-opus-5-5` by default) and appends an `llm` judgement with confidence. Low confidence, `fail` or `unknown` means `needs_review`, so a person still decides. Use it for `hybrid` and `agent` test cases, or to add a second opinion to a Playwright run whose screenshot shows what an assertion cannot.

## Acceptance criteria

- [x] `iw skills install` copies every skill to `.claude/skills/` and `.agents/skills/`; each `SKILL.md` has only portable frontmatter keys (test).
- [x] On a temp copy of `examples/shop`, `iw init` and `iw skills install` write both skill folders, `agents/openai.yaml`, `.mcp.json`, `.codex/config.toml` and the `AGENTS.md` block once, and a re-run changes nothing or updates them in place; other `.mcp.json` servers survive; `.agents/` copies keep only portable keys; `--no-agents` writes none of it (test). Listing `/indx-watch` in Claude Code and `$indx-watch` in Codex is checked by hand.
- [x] Following the `write-test-cases` skill on `examples/shop` UC-5 produces files that pass `iw check` and are `draft` + `origin = "ai"`.
- [x] `iw mcp` lists the tools above; calling `status` returns the same data as `iw status --json` (in-process MCP client test).
- [x] `record_run` with an agent actor and `confidence: 0.6` yields verdict `needs_review`.
- [x] `/mcp` on `iw serve` lists the same tools (names, schemas, annotations) as `iw mcp`; `show` returns the data of `iw show --json` and `record_run` writes an agent run (MCP over HTTP in-process test). Behind Access, `/mcp` without a valid JWT is 401 and a write records the verified identity with `kind = "agent"` (test with a fake JWKS).
- [x] `iw run TC-10` on `examples/shop` with a fake `BrowserProvider` and a fake `LlmClient` records an `agent` run with a note and a screenshot blob per step and one `llm` judgement whose verdict comes from the decision policy; low confidence is `needs_review`, a step out of actions is `blocked`, a step reported `fail` makes the run `fail` even when the judge passes it (tests). With Playwright's Chromium installed, the same command drives the real shop app through the local adapter, and `navigate` outside the base URL's origin is refused (tests, skipped without Chromium; CI's `e2e` job installs Chromium and runs them); the Browser Run adapter connects to the documented CDP endpoint with the API token (test against a fake Playwright, no network).
- [x] `iw judge` on a run whose test case has an `llm` rubric sends the rubric, the steps and the last screenshot to the Messages API and appends an `llm` judgement that the decision policy uses; a refusal or an answer that fails the schema becomes `unknown` with confidence 0, and API errors are not recorded (tests against a fake API).
