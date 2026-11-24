---
title: "Platform notes"
description: "Dated facts about Cloudflare, S3, Playwright and agent tooling, with sources."
---

# Platform Notes

Dated facts about the platforms and libraries INDX Watch depends on. Each fact has a source.

Last verified: 2026-11-19

## How to use this file

- Each bullet is one fact, followed by `(verified <date>, <source URL>)`. "Verified" means someone read the source on that date. It does not mean the fact is still true.
- **Re-verify any fact older than 90 days before you rely on it.** For facts verified 2026-11-19, that is any decision made after 2027-02-17. When you re-check a fact, update its date. If the fact changed, fix the bullet and add a line to the changelog at the bottom.
- Other docs (specs, ADRs, guides) link to a section here, such as `platform-notes.md#cloudflare`. They do not restate the fact. If you find a platform fact restated elsewhere, replace it with a link.
- `(unverified)` marks a claim that was not confirmed on an official page. Do not build on it without a test.
- Section anchors are linked from other docs. Do not rename the headings: `#playwright`, `#github-actions`, `#agent-skills`, `#mcp`, `#cloudflare`, `#s3-and-conditional-writes`, `#sync-prior-art`, `#toml-and-editor-tooling`, `#libraries-and-versions`.

---

## Node.js baseline

- Node 20 reached end of life on 2026-04-30. Node 22 is in maintenance until 2027-04-30, Node 24 is in maintenance LTS (since 2026-10-20) until 2028-04-30, and Node 26 is in active LTS (since 2026-10-28) until 2029-04-30. (verified 2026-11-19, https://raw.githubusercontent.com/nodejs/Release/main/schedule.json)
- Current majors that do not run on Node 20 include wrangler 4.165.0 (`>=22.12.0`), vitest 5.1.1, tsup 9.0.0, tsdown 0.23.7, commander 15, chokidar 6 and better-sqlite3 13. Vite 8.3.8 still allows `^20.19.0`. (verified 2026-11-19, https://registry.npmjs.org/wrangler , https://registry.npmjs.org/vitest , https://registry.npmjs.org/tsup)
- `node:sqlite` needs no flag from v22.13.0. `zlib.zstdCompress` was added in v22.15.0. Neither is available on Node 20. (verified 2026-11-19, https://nodejs.org/api/sqlite.html , https://nodejs.org/api/zlib.html)

## Playwright

- `@playwright/test` latest is **1.65.1** (2026-11-13). Its `engines.node` is `>=20`. (verified 2026-11-19, https://registry.npmjs.org/@playwright/test)
- The 1.65 release notes say "Playwright no longer tests on Node.js 20. Use Node.js 22, 24 or 26". (verified 2026-11-19, https://github.com/microsoft/playwright/blob/v1.65.1/docs/src/release-notes-js.md)
- Reporters are a default-exported class from a module. Options can be passed only through the config tuple `['module', { ... }]`. A package subpath such as `indx-watch/playwright` works as a module name. (verified 2026-11-19, https://playwright.dev/docs/api/class-reporter , https://github.com/microsoft/playwright/blob/v1.65.1/docs/src/test-api/class-testconfig.md)
- `--add-reporter` (1.63+) adds a reporter on top of the config's reporters. `--reporter` replaces them. Neither flag takes options. (verified 2026-11-19, https://github.com/microsoft/playwright/blob/v1.65.1/docs/src/test-cli-js.md)
- Playwright swallows errors thrown in custom reporter methods. `onEnd` is awaited and may return `{ status }` to override the run status and exit code. `onExit` (1.33+) runs last, and the docs name it as the place for uploads. (verified 2026-11-19, https://playwright.dev/docs/api/class-reporter)
- `onTestEnd` fires once per attempt. `TestResult.retry` is the attempt index. `TestCase.outcome()` returns `expected`, `unexpected`, `flaky` (passed on retry) or `skipped`. (verified 2026-11-19, https://github.com/microsoft/playwright/blob/v1.65.1/docs/src/test-reporter-api/class-testcase.md)
- `TestCase.id` is computed from the file, the title and the project. It changes on rename and is salted during `merge-reports`, so it is not a durable key. (verified 2026-11-19, https://github.com/microsoft/playwright/blob/v1.65.1/docs/src/test-reporter-api/class-testcase.md , https://github.com/microsoft/playwright/blob/v1.65.1/packages/playwright/src/reporters/merge.ts)
- `TestCase.tags` (1.42+) merges the `{ tag }` details with `@tokens` taken from describe titles and test titles. Tags must start with `@`. A tag on a `describe` applies to every test inside it. (verified 2026-11-19, https://github.com/microsoft/playwright/blob/v1.65.1/packages/playwright/src/common/test.ts)
- Changes to `TestInfo.tags` made at runtime are not visible to reporters. Annotations pushed to `TestInfo.annotations` at runtime reach reporters through `TestResult.annotations` (1.52+). (verified 2026-11-19, https://github.com/microsoft/playwright/blob/v1.65.1/docs/src/test-api/class-testinfo.md , https://github.com/microsoft/playwright/blob/v1.65.1/docs/src/test-reporter-api/class-testresult.md)
- The HTML reporter hides annotations whose `type` starts with `_`. (verified 2026-11-19, https://github.com/microsoft/playwright/blob/v1.65.1/docs/src/test-annotations-js.md)
- `--grep` is a regex, so `@TC-12` also matches `@TC-128`. Anchor the pattern, for example `@TC-12(\s|$)`. (verified 2026-11-19, https://github.com/microsoft/playwright/blob/v1.65.1/docs/src/test-annotations-js.md)
- Built-in screenshots, traces, videos and `error-context` arrive as **path** attachments under `outputDir`. `outputDir` is cleaned at the start of the next run, so copy or hash the files by `onEnd`. `testInfo.attach(name, { body })` arrives as a `body` Buffer. (verified 2026-11-19, https://github.com/microsoft/playwright/blob/v1.65.1/docs/src/test-api/class-testinfo.md , https://github.com/microsoft/playwright/blob/v1.65.1/packages/playwright/src/index.ts)
- `TestStep.params` (1.63+) can contain `fill()` values, including passwords. Redact them. (verified 2026-11-19, https://github.com/microsoft/playwright/blob/v1.65.1/docs/src/test-reporter-api/class-teststep.md)
- `Reporter.preprocess({ config, suite, testRun })` (1.62+) runs before `onBegin`. It can call `testRun.skip / exclude / fixme / fail` per test, which allows plan-driven runs. It sees the full corpus and ignores `--shard`. (verified 2026-11-19, https://github.com/microsoft/playwright/blob/v1.65.1/docs/src/release-notes-js.md)
- Custom reporters run unchanged under `merge-reports`. During a merge, attachments are extracted to `<blob dir>/resources/`, and each shard's project is a separate `TestProject` with the same name. All shards and the merge job must use the same Playwright version. (verified 2026-11-19, https://github.com/microsoft/playwright/blob/v1.65.1/docs/src/test-sharding-js.md)
- Playwright Test Agents (planner, generator, healer) arrived in 1.56; `npx playwright init-agents --loop=<vscode|claude|opencode>` writes the agent definitions. (verified 2026-11-21, https://github.com/microsoft/playwright/releases/tag/v1.56.0)
- The planner saves its plan with the `planner_save_plan` MCP tool, which renders fixed Markdown: `# <name>`, `## Application Overview`, `## Test Scenarios`, then per suite `### <i>. <suite>` and `` **Seed:** `<file>` ``, per test `#### <i>.<j>. <test>`, `` **File:** `<file>` `` and `**Steps:**` with `  <k>. <perform>` (or `-` when there is no action) followed by `    - expect: <result>` lines. The tool's example is `examples/todomvc/specs/basic-operations.plan.md`. The Test Agents docs page still shows an older hand-written layout with a separate `**Expected Results:**` list. (verified 2026-11-21, https://github.com/microsoft/playwright/blob/main/packages/playwright/src/mcp/test/plannerTools.ts , https://github.com/microsoft/playwright/blob/main/examples/todomvc/specs/basic-operations.plan.md , https://playwright.dev/docs/test-agents)
- The generator starts each test with `// spec: <plan>` and `// seed: <seed>` comments and keeps the plan's steps as comments. (verified 2026-11-21, https://playwright.dev/docs/test-agents)
- The official CI template uses `actions/checkout@v6`, `actions/setup-node@v6` (`lts/*`) and `npx playwright install --with-deps`. The docs say "Caching browser binaries is not recommended", and they warn that the built-in `github` reporter multiplies annotations in a matrix. (verified 2026-11-19, https://github.com/microsoft/playwright/blob/v1.65.1/docs/src/ci-intro.md)

## GitHub Actions

- Node 20 is no longer available on GitHub Actions runners (notice dated 2026-09-23). JavaScript actions run on Node 24, and the `ACTIONS_ALLOW_USE_UNSECURE_NODE_VERSION` opt-out is gone. New JavaScript actions must declare `runs.using: node24`. (verified 2026-11-19, https://github.blog/changelog/2026-09-24-node-20-is-no-longer-available-in-github-actions/)
- Composite actions (`runs.using: composite`) need no bundled `dist/`. They can read `${{ job.* }}` contexts through `env:`, call other actions with `uses:`, and must set `shell` on each `run` step. They have no `pre` or `post` hooks. (verified 2026-11-19, https://docs.github.com/en/actions/reference/workflows-and-actions/metadata-syntax)
- `job.check_run_id` is a context-only value with no environment variable. It is not available on GHES. (verified 2026-11-19, https://docs.github.com/en/actions/reference/workflows-and-actions/contexts)
- On `pull_request`, `GITHUB_SHA` is the merge commit. The PR head is `github.event.pull_request.head.sha`. On `deployment_status` the commit is `event.deployment.sha`, and `GITHUB_REF` can be empty. (verified 2026-11-19, https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)
- `GITHUB_RUN_ID` does not change on re-run. `GITHUB_RUN_ATTEMPT` increments on each re-run. `GITHUB_JOB` is the YAML job key, which all matrix legs share. (verified 2026-11-19, https://docs.github.com/en/actions/reference/workflows-and-actions/variables)
- A workflow run is not triggered when a deployment status is `inactive`. Referencing `environment:` creates a deployment object unless `deployment: false` is set. (verified 2026-11-19, https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows , https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)
- Each step's job summary is limited to 1 MiB. An oversized summary creates an error annotation but does not fail the step. At most 20 step summaries are shown per job. (verified 2026-11-19, https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands)
- Actions allows 10 warning and 10 error annotations per step. (verified 2026-11-19, https://docs.github.com/en/rest/checks/runs)
- OIDC needs `permissions: id-token: write`. Request the token with `$ACTIONS_ID_TOKEN_REQUEST_URL&audience=<aud>` and the bearer `$ACTIONS_ID_TOKEN_REQUEST_TOKEN`. The response is `{ "value": "<jwt>" }`. The issuer is `https://token.actions.githubusercontent.com` and the default `aud` is the repository owner URL. (verified 2026-11-19, https://docs.github.com/en/actions/reference/security/oidc , https://token.actions.githubusercontent.com/.well-known/openid-configuration)
- Repositories created after 2026-07-15 get an immutable OIDC `sub` with IDs (`repo:OWNER@ID/REPO@ID:...`). Authorize on the `repository_id` and `repository_owner_id` claims, not on the `sub` string. (verified 2026-11-19, https://docs.github.com/en/actions/reference/security/oidc)
- On a fork `pull_request`, `GITHUB_TOKEN` is read-only and secrets are not passed. OIDC on fork PRs is assumed to be unavailable (unverified on a current official page). (verified 2026-11-19, https://docs.github.com/en/actions/concepts/security/github_token)
- A PR conversation comment is an issue comment and needs `pull-requests: write` or `issues: write`. A commit status needs `statuses: write`. Check-run write is GitHub App only, and with `GITHUB_TOKEN` you cannot choose the check suite. (verified 2026-11-19, https://docs.github.com/en/rest/issues/comments , https://docs.github.com/en/rest/checks/runs)
- `actions/upload-artifact` is at v7 (v7.0.2). It runs on `node24`. Artifacts are immutable, matrix jobs need unique names, and **hidden files are excluded by default**, so uploading `.indx-watch/` needs `include-hidden-files: true`. It outputs `artifact-id`, `artifact-url` and `artifact-digest`. It is not supported on GHES. (verified 2026-11-19, https://github.com/actions/upload-artifact)
- `pnpm/action-setup` v4 declares `runs.using: node20`; v6 (latest v6.1.1) declares `node24` and reads the pnpm version from `packageManager` in `package.json` when `version` is not set. (verified 2026-11-19, https://github.com/pnpm/action-setup/releases , https://raw.githubusercontent.com/pnpm/action-setup/v6/action.yml)
- `npx <absolute path to a .tgz> <cmd>` fails on npm 10 and 11: libnpmexec resolves the path as a local binary and tries to execute the tarball (exit 126). Install the tarball (`npm install --save-dev ./pkg.tgz`) and run `npx <bin>`, or use `npx --package <tgz> -- <bin>`. (verified 2026-11-19 with npm 10.9 and 11.x, reproduced locally)
- A Marketplace listing needs a public repo with a single `action.yml` at the root. Actions in subfolders work (`owner/repo/path@ref`) but are not listed. (verified 2026-11-19, https://docs.github.com/en/actions/how-tos/create-and-publish-actions/publish-in-github-marketplace)
- With immutable releases (GA 2025-10-28), the documented pattern is an immutable release per exact version plus plain moving tags (`v1`). (verified 2026-11-19, https://docs.github.com/en/actions/how-tos/create-and-publish-actions/using-immutable-releases-and-tags-to-manage-your-actions-releases)

## Other CI providers

- GitLab: `GITLAB_USER_LOGIN` is the unique username of the user who started the pipeline, "unless the job is a manual job"; `GITLAB_USER_NAME` is the display name. `CI_MERGE_REQUEST_IID` is set only in merge request pipelines and is the number in the MR URL. `CI_COMMIT_TAG` is set only in tag pipelines; `CI_COMMIT_REF_NAME` is the branch or tag. `CI_PIPELINE_ID` is unique per instance and does not change when a job is retried (`CI_JOB_ID` does). `CI_JOB_RETRY_COUNT` (GitLab 19.3+) is `0` on the first run and counts retries of the job in the pipeline. `CI_NODE_INDEX` is set only with `parallel:`. (verified 2026-11-21, https://docs.gitlab.com/ci/variables/predefined_variables/)
- CircleCI: `CIRCLE_PULL_REQUEST` is a PR URL (one chosen at random when several exist), not a number. `CIRCLE_USERNAME` is the GitHub or Bitbucket username of the user who triggered the pipeline, only if they have a CircleCI account. `CIRCLE_BUILD_URL` is the job page. `CIRCLE_WORKFLOW_ID` identifies the workflow instance; a rerun creates a new workflow with a new ID (the API's rerun response returns the new `workflow_id`; a forum report confirms the variable changes while `CIRCLE_WORKFLOW_WORKSPACE_ID` stays). (verified 2026-11-21, https://circleci.com/docs/reference/variables/ , https://circleci.com/docs/api/v2/)
- Buildkite: `BUILDKITE_COMMIT` can be a symbolic name such as `HEAD` before checkout; the agent resolves it after checkout. `BUILDKITE_PULL_REQUEST` is the PR number or `false`. `BUILDKITE_BUILD_CREATOR` is a display name and `BUILDKITE_BUILD_CREATOR_EMAIL` the creator's notification email; `BUILDKITE_BUILD_AUTHOR` is the commit author, may be unverified, and can be blank for manual builds. `BUILDKITE_BUILD_ID` is the build UUID, unchanged by job retries; `BUILDKITE_RETRY_COUNT` counts retries of the job. (verified 2026-11-21, https://buildkite.com/docs/pipelines/configure/environment-variables)

## Agent skills

### Agent Skills standard

- A skill is a folder with `SKILL.md`, which has YAML frontmatter and a Markdown body. Required fields: `name` (1–64 chars, `[a-z0-9-]`, must equal the folder name) and `description` (1–1024 chars, says what the skill does and when to use it). Optional fields: `license`, `compatibility` (≤ 500 chars), `metadata` (string map) and `allowed-tools` (experimental). (verified 2026-11-19, https://agentskills.io/specification)
- Keep `SKILL.md` under 500 lines and put detail in `references/`, `scripts/` or `assets/`. (verified 2026-11-19, https://agentskills.io/specification)
- The cross-client convention is `<project>/.agents/skills/` and `~/.agents/skills/`. (verified 2026-11-19, https://agentskills.io/client-implementation/adding-skills-support)

### Claude Code

- Project skills live at `.claude/skills/<name>/SKILL.md`, personal skills at `~/.claude/skills/`, and plugin skills at `<plugin>/skills/` (invoked as `/plugin:skill`). The docs do **not** list `.agents/skills/`. Symlinked skill folders are supported. (verified 2026-11-19, https://code.claude.com/docs/en/skills)
- Uploads to claude.ai and the Claude API add to the standard: `name` cannot contain XML tags or the reserved words `anthropic` and `claude`, and `description` cannot contain XML tags. (verified 2026-11-23, https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)
- Claude Code accepts extra frontmatter keys (`when_to_use`, `argument-hint`, `disable-model-invocation`, `paths`, `context: fork`, …). Uploads to claude.ai and the Skills API accept only `name`, `description`, `license`, `compatibility`, `metadata` and `allowed-tools`, and any other key is a hard error. (verified 2026-11-19, https://code.claude.com/docs/en/skills#using-skill-frontmatter-outside-claude-code)
- `description` plus `when_to_use` is truncated at 1,536 chars in the skill listing. (verified 2026-11-19, https://code.claude.com/docs/en/skills)
- Claude Code v2.1.277+ reads `AGENTS.md` directly only when there is no `CLAUDE.md`, `.claude/CLAUDE.md` or `CLAUDE.local.md` in the working directory or above it. A `CLAUDE.md` with `@AGENTS.md` loads it without reading it twice. Claude never reads `AGENTS.override.md`, `AGENTS.local.md` or anything under `.agents/`. (verified 2026-11-19, https://code.claude.com/docs/en/memory#agents-md)
- Plugins use `.claude-plugin/plugin.json`, and marketplaces use `.claude-plugin/marketplace.json`. The marketplace entry `name` must equal the plugin `name`. A `CLAUDE.md` at the plugin root is not loaded. Validate with `claude plugin validate`. (verified 2026-11-19, https://code.claude.com/docs/en/plugins/manifest-reference , https://code.claude.com/docs/en/plugin-marketplaces)
- Claude Code loads `.claude/skills/` from the start directory and every parent up to the repository root; skills in subdirectories load when Claude first touches a file there. Collisions: enterprise over personal over project; plugin skills are namespaced (`/plugin:skill`). `/name args` at the start of a message runs a skill, with `$ARGUMENTS`, `$N` and named `arguments`. Unknown frontmatter keys are ignored in Claude Code. (verified 2026-11-23, https://code.claude.com/docs/en/skills)
- A committed `.mcp.json` registers project MCP servers; Claude Code asks each person to approve them, and a repository cannot approve its own servers. A committed `enabledPlugins` turns a plugin on but does not download it; each person installs it once. (verified 2026-11-23, https://code.claude.com/docs/en/mcp#project-scope , https://code.claude.com/docs/en/plugin-marketplaces)

### Codex

- Codex skills follow the open standard. Codex scans `.agents/skills` in every directory from the cwd up to the repo root, then `$HOME/.agents/skills`, then `/etc/codex/skills`, then the bundled system skills. It does not list `.claude/skills` or `~/.codex/skills`. (verified 2026-11-19, https://learn.chatgpt.com/docs/build-skills)
- `developers.openai.com/codex/*` pages now return 308 redirects to `learn.chatgpt.com/docs/*`. (verified 2026-11-19, https://developers.openai.com/codex/skills)
- The optional `agents/openai.yaml` in a skill sets UI metadata, `policy.allow_implicit_invocation` (default `true`) and tool dependencies such as MCP servers. (verified 2026-11-19, https://learn.chatgpt.com/docs/build-skills)
- Codex custom prompts are deprecated: "Use skills for reusable instructions". (verified 2026-11-19, https://learn.chatgpt.com/docs/custom-prompts)
- Codex reads `AGENTS.override.md` or `AGENTS.md` (one per directory) from the git root down to the cwd, joins them root-first, and stops at `project_doc_max_bytes`, which defaults to 32 KiB. (verified 2026-11-19, https://learn.chatgpt.com/docs/agent-configuration/agents-md)
- The portable Codex plugin format is a root `plugin.json` per Agent Plugins 1.0.0. Codex also accepts `.codex-plugin/plugin.json` and reads `$REPO_ROOT/.claude-plugin/marketplace.json` as a legacy-compatible marketplace. (verified 2026-11-19, https://developers.openai.com/codex/plugins/build.md , https://agent-plugins.org/)
- Agent environment markers used for automatic `actor.kind = "agent"`: Claude Code sets `CLAUDECODE=1` in shell-tool child processes; Codex injects `CODEX_THREAD_ID` (and `CODEX_SESSION_ID`) into shell-tool child environments. `CODEX_SANDBOX_NETWORK_DISABLED` is only set when network access is off, so it is not a reliable marker. (verified 2026-11-19, https://raw.githubusercontent.com/openai/codex/main/codex-rs/core/src/exec_env.rs)
- In Codex CLI and the IDE a person runs `/skills` or types `$` to mention a skill (`$skill-name`); Codex also picks a skill whose `description` matches. No argument syntax is documented. Two skills with the same `name` both appear; nothing is shadowed. Symlinked skill folders are followed. (verified 2026-11-23, https://learn.chatgpt.com/docs/build-skills)
- `agents/openai.yaml` in a skill sets `interface` (`display_name`, `short_description`, `default_prompt`, icons, `brand_color`), `policy.allow_implicit_invocation` (default `true`) and `dependencies.tools` (e.g. an MCP server); the page gives an example, not a schema. (verified 2026-11-23, https://learn.chatgpt.com/docs/build-skills)
- A project's `.codex/config.toml` can declare MCP servers; Codex loads it only for trusted projects. (verified 2026-11-23, https://learn.chatgpt.com/docs/extend/mcp)

## MCP

- The latest spec revision is **2026-07-28**. It removes the `initialize` handshake and `Mcp-Session-Id`, adds the required `server/discover`, adds `subscriptions/listen`, removes SSE resumability, requires `ttlMs`/`cacheScope` on list results, and deprecates Roots, Sampling and Logging. Servers SHOULD return `tools/list` in a deterministic order. (verified 2026-11-19, https://modelcontextprotocol.io/specification/2026-07-28/changelog)
- The TypeScript SDK v2 is the stable line. It ships as split packages: `@modelcontextprotocol/server` 2.4.0 (2026-10-23, `node >=20`, depends on `zod ^4.2`), `@modelcontextprotocol/client` 2.4.0, `@modelcontextprotocol/node` 2.1.2 and `@modelcontextprotocol/hono` 2.0.2. v1 `@modelcontextprotocol/sdk` is at 1.32.2. (verified 2026-11-19, https://registry.npmjs.org/@modelcontextprotocol/server , https://www.npmjs.com/package/@modelcontextprotocol/server)
- The v2 package root is runtime-neutral (no `node:*` imports). stdio lives at `@modelcontextprotocol/server/stdio` as `serveStdio(factory)`. JSON Schema validation uses AJV on Node and `@cfworker/json-schema` on workerd automatically. (verified 2026-11-19, https://ts.sdk.modelcontextprotocol.io/v2/get-started/packages.md , https://ts.sdk.modelcontextprotocol.io/v2/serving/stdio.md)
- `createMcpHandler(factory)` returns a web-standard `{ fetch }` and calls the factory once per request (stateless). It serves both 2025-era and 2026-07-28 clients by default. It does no Host, Origin or auth checks, so put those in front of it. (verified 2026-11-19, https://ts.sdk.modelcontextprotocol.io/v2/serving/http.md , https://ts.sdk.modelcontextprotocol.io/v2/serving/legacy-clients.md)
- `createMcpHonoApp()` from `@modelcontextprotocol/hono` adds JSON parsing and localhost DNS-rebinding protection. `export default app` runs on Workers, and Node runs it through `@hono/node-server`. (verified 2026-11-19, https://ts.sdk.modelcontextprotocol.io/v2/serving/hono.md)
- In v2, `registerTool` takes `inputSchema` and `outputSchema` as zod object schemas. Invalid arguments return `isError: true` without running the handler. `structuredContent` is validated at runtime against `outputSchema`. (verified 2026-11-19, https://ts.sdk.modelcontextprotocol.io/v2/servers/tools.md)
- Tool annotation defaults: `readOnlyHint` false, `destructiveHint` **true**, `idempotentHint` false, `openWorldHint` **true**. Set them explicitly. (verified 2026-11-19, https://modelcontextprotocol.io/specification/2026-07-28/schema)
- Claude Code runs `readOnlyHint: true` calls in parallel and may retry them. Its default output cap is 25,000 tokens (`MAX_MCP_OUTPUT_TOKENS`). Root-level `anyOf`/`oneOf`/`allOf` in `inputSchema` is flattened. `mcp__<server>__<tool>` must be ≤ 128 chars. (verified 2026-11-19, https://code.claude.com/docs/en/mcp)
- Claude Code `--scope project` writes `.mcp.json` at the repo root. The file supports `${VAR}` and `${VAR:-default}`. An entry with `url` but no `type` is an error, and `streamable-http` is an alias of `http`. (verified 2026-11-19, https://code.claude.com/docs/en/mcp)
- Codex reads MCP servers from `~/.codex/config.toml` or a project `.codex/config.toml` (trusted projects only) under `[mcp_servers.<name>]`. `codex mcp add <name> -- <cmd>` adds a stdio server, and `--url ... --bearer-token-env-var VAR` adds an HTTP server. (verified 2026-11-19, https://learn.chatgpt.com/docs/extend/mcp?surface=cli)
- The SDK's skills-over-MCP extension (`io.modelcontextprotocol/skills`, `loadSkills` + `attach`) is experimental. (verified 2026-11-19, https://ts.sdk.modelcontextprotocol.io/v2/servers/skills.md)

## Cloudflare

### Workers, Hono and static assets

- Hono's Workers guide serves static files through Workers Static Assets (`"assets": { "directory": "public" }` in `wrangler.jsonc`). It types bindings with `new Hono<{ Bindings: CloudflareBindings }>()` after running `wrangler types --env-interface CloudflareBindings`. (verified 2026-11-19, https://hono.dev/docs/getting-started/cloudflare-workers)
- Cloudflare recommends `wrangler.jsonc` for new projects, and `compatibility_date` is required. (verified 2026-11-19, https://developers.cloudflare.com/workers/wrangler/configuration/)
- `assets.not_found_handling: "single-page-application"` serves `/index.html` for navigations. From compatibility date 2025-04-01, navigation requests skip the Worker even for unmatched paths, so list API routes in `assets.run_worker_first` (pattern array, `!` negates, max 100 entries, Wrangler ≥ 4.20.0). (verified 2026-11-19, https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/)
- `assets.base_path` (added 2026-11-11) serves assets under a URL path prefix. (verified 2026-11-19, https://developers.cloudflare.com/changelog/product/workers/)
- Node.js compatibility is on by default for `compatibility_date >= 2026-08-04`, so no `nodejs_compat` flag is needed. `node:sqlite` is a non-functional stub on Workers. (verified 2026-11-19, https://developers.cloudflare.com/changelog/post/2026-08-04-nodejs-compat-default/ , https://developers.cloudflare.com/workers/runtime-apis/nodejs/)
- Compatibility date 2026-11-17 turns on the new module registry. The new registry rejects invalid import attributes and `require()` of modules that use top-level await. (verified 2026-11-19, https://developers.cloudflare.com/changelog/post/2026-11-02-module-registry-default/)
- In deployed Workers, `Date.now()` advances only after I/O, so IDs minted in one request share a timestamp. Use a monotonic ULID factory. (verified 2026-11-19, https://developers.cloudflare.com/workers/runtime-apis/performance/)

### Limits

- Workers: CPU per request is 10 ms on Free and 30 s by default on Paid (up to 5 min). Memory is 128 MB. Subrequests are 50 on Free and 10,000 by default on Paid. `waitUntil` has 30 s. Static asset files: 20,000 on Free, 100,000 on Paid. (verified 2026-11-19, https://developers.cloudflare.com/workers/platform/limits/)
- The request body limit depends on the zone plan: 100 MB on Free and Pro, 200 MB on Business, up to 5 GB on Enterprise. Send large evidence straight to R2 with presigned URLs. (verified 2026-11-19, https://developers.cloudflare.com/workers/platform/limits/)

### D1

- D1 limits: 10 GB per DB on Paid, 500 MB on Free. **100 bound parameters per query**. 100 KB per SQL statement. 2 MB per row, string or BLOB. 1,000 queries per invocation on Paid, 50 on Free (one `batch()` counts as one). Max query result 50 MB from 2026-11-04. (verified 2026-11-19, https://developers.cloudflare.com/d1/platform/limits/)
- `db.batch()` runs its statements as one SQL transaction and rolls back on any failure. It is the documented atomic grouping. Drizzle's `db.transaction()` (`BEGIN`) is reported to fail on D1 (unverified, https://github.com/drizzle-team/drizzle-orm/issues/4212). (verified 2026-11-19, https://developers.cloudflare.com/d1/worker-api/d1-database/)
- Migrations: `wrangler d1 migrations apply <db> --local|--remote` records applied files in `d1_migrations`. `migrations_dir` and `migrations_pattern` support drizzle-kit's `<n>_name/migration.sql` layout. `d1 migrations apply` has no `--json`. (verified 2026-11-19, https://developers.cloudflare.com/d1/reference/migrations/ , https://developers.cloudflare.com/d1/wrangler-commands/)

### R2

- PutObject `If-Match` and `If-None-Match` are "evaluated atomically against the committed bucket state". When several clients concurrently send `If-None-Match: *` for an absent key, at most one succeeds and the others get `412 PreconditionFailed`. `CompleteMultipartUpload` gives the same guarantee. Conditions sent on `CreateMultipartUpload` are not re-checked at completion. (verified 2026-11-19, https://developers.cloudflare.com/r2/api/s3/api/)
- ListObjectsV2 supports `start-after`, `prefix`, `delimiter` and `continuation-token`. (verified 2026-11-19, https://developers.cloudflare.com/r2/api/s3/api/)
- Workers binding: `put(key, value, { onlyIf })` accepts an `R2Conditional` (`etagMatches`, `etagDoesNotMatch`, `uploadedBefore`, `uploadedAfter`) or a `Headers` object, where "all conditional headers aside from `If-Range` are supported". A failed condition makes `put` return `null` and store nothing. The page does not name `If-None-Match: *` explicitly, so cover create-only through the binding with a test. (verified 2026-11-19, https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)
- Binding `list()` is lexicographic and takes `limit` (≤ 1000), `prefix`, `cursor`, `delimiter` and `include`. It has **no `startAfter`**. (verified 2026-11-19, https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)
- R2 is strongly consistent for reads, writes, deletes and lists. Custom domains with caching enabled can serve stale data, so never read the store through a cached custom domain. (verified 2026-11-19, https://developers.cloudflare.com/r2/reference/consistency/)
- R2 limits: 1 write per second to the same key (429 above that). Single PUT up to 5 GiB. Keys up to 1,024 bytes. Custom metadata up to 8,192 bytes. (verified 2026-11-19, https://developers.cloudflare.com/r2/platform/limits/)
- Presigned URLs support GET, HEAD, PUT and DELETE, expire in 1 s to 7 days, and work only on the S3 endpoint, not on custom domains. `Content-Type` is part of the signature. Browser uploads need bucket CORS. (verified 2026-11-19, https://developers.cloudflare.com/r2/api/s3/presigned-urls/)
- S3 endpoint is `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` with region `auto`. Egress is free. Class A requests (PUT, LIST) cost $4.50/M and Class B requests (GET, HEAD) $0.36/M. The free tier is 10 GB-month, 1M Class A and 10M Class B per month. (verified 2026-11-19, https://developers.cloudflare.com/r2/api/s3/api/ , https://developers.cloudflare.com/r2/pricing/)
- R2 event notifications send `object-create` and `object-delete` to a Queue. The page states no delivery or ordering guarantee. (verified 2026-11-19, https://developers.cloudflare.com/r2/buckets/event-notifications/)

### Access

- `ctx.access` is **not passed to Workers with Static Assets** ("the router does not pass `ctx.access` to the user Worker"). It is also not passed across service bindings. Validate `Cf-Access-Jwt-Assertion` yourself (for example with `jose`). (verified 2026-11-19, https://developers.cloudflare.com/workers/configuration/cloudflare-access/)
- A Worker can be protected from its dashboard **Access** tab ("Protect this Worker behind Access"), which covers every domain of the Worker. Worker-level policies do not support WebSockets. No Wrangler key turns on Access, except `access.dev` for local simulation. (verified 2026-11-19, https://developers.cloudflare.com/workers/configuration/cloudflare-access/ , https://developers.cloudflare.com/changelog/post/2026-08-14-workers-access/)
- JWT validation: JWKS at `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`. Check `iss`, `aud` (the app AUD tag), `exp` and `nbf`, and match keys by `kid`. Keys rotate about every 6 weeks. (verified 2026-11-19, https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)
- Service-token JWTs have an empty `sub`, `common_name` set to the Client ID, and no `email`. (verified 2026-11-19, https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/)
- Service tokens send `CF-Access-Client-Id` and `CF-Access-Client-Secret` and need a "Service Auth" policy. (verified 2026-11-19, https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/)
- CLI access: `cloudflared access login <url>` logs in. `cloudflared access token -app=<url>` prints a token to send as the `cf-access-token` header. (verified 2026-11-19, https://developers.cloudflare.com/cloudflare-one/tutorials/cli/)
- Identity groups: `GET https://<team>.cloudflareaccess.com/cdn-cgi/access/get-identity` with the user's token as the `CF_Authorization` cookie returns the full identity; Cloudflare recommends it when you need all groups. Application tokens carry a `groups` claim only when the IdP is configured to send it as a custom SAML attribute or OIDC claim, and Access trims custom claims above about 1 KB (dropping list values from the end), so do not authorize from the claim. The documented response fields are `email`, `idp`, `user_uuid`, `account_id`, `service_token_id`, … and the page does not show the shape of `groups`; IdP-backed identities return it as a list of objects with `id`, `name` and `email`, which INDX Watch reads defensively (strings or objects, missing fields skipped). (partly verified 2026-11-21, https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/ ; the `groups` shape is not on that page)
- Access Managed OAuth (2026-03-20) turns an Access app into an OAuth 2.0 authorization server for CLIs and MCP clients. The origin still receives `Cf-Access-Jwt-Assertion`. (verified 2026-11-19, https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/managed-oauth/)

### Wrangler and `cf`

- wrangler latest is 4.165.0 (2026-11-18), with `engines.node >=22.12.0`. (verified 2026-11-19, https://registry.npmjs.org/wrangler)
- Non-interactive auth uses `CLOUDFLARE_API_TOKEN` (plus `CLOUDFLARE_ACCOUNT_ID`), which takes precedence over OAuth login. (verified 2026-11-19, https://developers.cloudflare.com/workers/wrangler/system-environment-variables/)
- `WRANGLER_OUTPUT_FILE_PATH` makes Wrangler append ND-JSON records (`deploy`, `version-upload`, `command-failed`, …). `--json` exists only on some commands: `d1 list`, `d1 info`, `d1 execute` and `r2 bucket info`. (verified 2026-11-19, https://developers.cloudflare.com/workers/wrangler/system-environment-variables/ , https://developers.cloudflare.com/d1/wrangler-commands/ , https://developers.cloudflare.com/r2/reference/wrangler-commands/)
- `wrangler deploy` provisions D1, R2 and KV bindings that have no ID and writes the IDs back to the config file. `deploy --dry-run --outdir` builds without publishing. (verified 2026-11-19, https://developers.cloudflare.com/workers/wrangler/configuration/ , https://developers.cloudflare.com/workers/wrangler/commands/workers/)
- `getPlatformProxy()` gives Node code workerd-backed bindings. `unstable_dev` and `unstable_startWorker` are deprecated. (verified 2026-11-19, https://developers.cloudflare.com/workers/wrangler/api/)
- The new Cloudflare CLI `cf` is at 1.0.0-rc.2 (needs Node `^22.23 || ^24.22 || ^26.12`). Wrangler will get a final major that points to `cf`, followed by 18 months of maintenance. `cf` still delegates dev and deploy of JS Workers to Wrangler. (verified 2026-11-19, https://blog.cloudflare.com/cloudflare-cf-cli-launch , https://developers.cloudflare.com/changelog/post/2026-11-17-release-candidate/ , https://registry.npmjs.org/cf)

### Browser Run and Workflows

- Browser Rendering was renamed Browser Run on 2026-04-15. Limits: Free has 10 browser-minutes per day and 3 concurrent browsers. Paid has 200 concurrent browsers. The idle timeout is 60 s. (verified 2026-11-19, https://developers.cloudflare.com/changelog/post/2026-04-15-br-rename/ , https://developers.cloudflare.com/browser-run/limits/)
- Browser Run takes CDP connections from any environment, not only Workers: Playwright's `chromium.connectOverCDP('wss://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/browser-run/devtools/browser?keep_alive=600000', { headers: { Authorization: 'Bearer <API_TOKEN>' } })` with an API token that has *Browser Rendering - Edit* (`playwright-core` is enough). `keep_alive` is in milliseconds. `iw run --browser cloudflare` uses this endpoint. (verified 2026-11-21, https://developers.cloudflare.com/browser-run/cdp/playwright/ , https://developers.cloudflare.com/changelog/post/2026-04-10-browser-rendering-cdp-endpoint/)
- Playwright 1.65 `page.ariaSnapshot({ mode: 'ai' })` returns the accessibility snapshot with element refs (`[ref=e7]`; refs in a frame after a navigation look like `f1e2`), and `page.locator('aria-ref=e7')` (or `page.getByRef('e7')`) targets an element from the latest snapshot only. (verified 2026-11-21 against `playwright-core` 1.65.1 types and a local run)
- `@cloudflare/playwright` 1.4.0 is a Playwright fork. It has `expect` but no test runner, no Firefox or WebKit, and **no video**. Tracing works. (verified 2026-11-19, https://developers.cloudflare.com/browser-run/playwright/)
- Workflows limits: a step result is 1 MiB. Steps per instance: 1,024 on Free and 10,000 on Paid. CPU per step: 10 ms on Free and 30 s on Paid. Retention: 3 days on Free and 7 days on Paid. Waiting instances do not count toward concurrency. (verified 2026-11-19, https://developers.cloudflare.com/workflows/reference/limits/)

## S3 and conditional writes

- AWS S3 supports `If-None-Match: *` (create-if-absent, since 2024-08-20) and `If-Match` ETag CAS (since 2024-11-25) on `PutObject`, `CompleteMultipartUpload` and `CopyObject` (copy since 2025-10). The first write to finish wins, and later ones get `412`. A `409` can happen if a delete races the write. (verified 2026-11-19, https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html , https://aws.amazon.com/about-aws/whats-new/2024/08/amazon-s3-conditional-writes)
- Conditional requests cost nothing extra on S3. (verified 2026-11-19, https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-requests.html)
- An SDK retry can turn a write that succeeded into a false `412`. On a `412` for an immutable or content-addressed key, HEAD or GET the object and compare its hash. (verified 2026-11-19, https://alexr17.github.io/notes/the-sharp-edges-of-object-storage-conditional-writes.html)
- S3 has strong read-after-write consistency, and a new object appears in a list immediately. Updates to a single key are atomic. There are no atomic updates across keys. (verified 2026-11-19, https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html#ConsistencyModel)
- ListObjectsV2 on general-purpose buckets returns keys in lexicographic order, and `StartAfter` can be any key, even one that does not exist. Directory buckets (S3 Express One Zone) are not lexicographic and do not support `StartAfter`. (verified 2026-11-19, https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListObjectsV2.html)
- SHA-256 is only a composite checksum on multipart uploads, and a multipart ETag is not an MD5 of the content. Use our own sha256 in the key, never the ETag. (verified 2026-11-19, https://docs.aws.amazon.com/AmazonS3/latest/userguide/checking-object-integrity-upload.html)
- AWS SDK v3 (since 3.729.0) sends CRC checksums on PUT and validates on GET by default. Some S3-compatible stores reject these checksums, so set `requestChecksumCalculation` and `responseChecksumValidation` to `WHEN_REQUIRED`. (verified 2026-11-19, https://docs.aws.amazon.com/sdkref/latest/guide/feature-dataintegrity.html)
- GCS (XML interop): create-if-absent is `x-goog-if-generation-match: 0`. Do not rely on `If-None-Match: *` for PUT. XML multipart uploads do not support preconditions. GCS allows one write per second to the same object name. (verified 2026-11-19, https://docs.cloud.google.com/storage/docs/request-preconditions , https://docs.cloud.google.com/storage/quotas)
- MinIO (AIStor docs) lists `If-Match` and `If-None-Match` for `PutObject` and `CopyObject`. (verified 2026-11-19, https://docs.min.io/aistor/developers/s3-api-compatibility/)
- The MinIO community edition entered maintenance mode in December 2025. (verified 2026-11-19, https://www.infoq.com/news/2025/12/minio-s3-api-alternatives)
- Reports that the MinIO repository is archived come only from secondary sources (unverified, https://itsfoss.com/news/minio-moves-away-from-open-source/). Do not make MinIO the only local S3 used in CI.
- `dl.min.io` returns 410 Gone for community binaries ("community releases are no longer served"); the adapter test suite therefore uses an in-process S3-compatible fake and runs the MinIO variant only when a `minio` binary is on PATH. (verified 2026-11-19, https://dl.min.io/)
- Local filesystem: `fs.open(path, 'wx')` fails if the path exists. `link(tmp, final)` gives atomic create-if-absent with full content, whereas `rename` overwrites on POSIX. `readdir` order is unspecified, so sort the keys. (verified 2026-11-19, https://nodejs.org/api/fs.html#file-system-flags)

## Sync prior art

The sync design itself is in [docs/spec/sync.md](../spec/sync.md). These are the facts it borrows from.

- git-lfs: the pointer file is `version` / `oid sha256:<hex>` / `size`, and the client uploads objects before the ref. (verified 2026-11-19, https://github.com/git-lfs/git-lfs/blob/main/docs/spec.md)
- DVC: `.dvc` files hold `md5` + `size`. DVC 3.0 hashes files as binary (no CRLF normalization). `dvc gc --cloud` deletion is irreversible. (verified 2026-11-19, https://doc.dvc.org/user-guide/project-structure/dvc-files , https://doc.dvc.org/command-reference/gc)
- git-annex: keys put the size in the key (`SHA256E-s<size>--<hash>.<ext>`). (verified 2026-11-19, https://git-annex.branchable.com/internals/key_format/)
- Automerge: maps keep concurrent values and expose them through `getConflicts`. Yjs: the last inserted entry per key wins. (verified 2026-11-19, https://automerge.org/docs/reference/documents/conflicts/ , https://github.com/yjs/yjs/blob/main/INTERNALS.md)
- Dolt on AWS and Delta Lake on S3 both needed a DynamoDB side store for CAS, because they were designed before S3 had conditional writes. (verified 2026-11-19, https://www.dolthub.com/blog/2023-04-26-working-with-aws-remotes/ , https://docs.delta.io/latest/delta-storage.html)
- Hybrid Logical Clocks (Kulkarni et al., 2014) are the basis for ordering field edits. (verified 2026-11-19, https://cse.buffalo.edu/tech-reports/2014-04.pdf)

## TOML and editor tooling

- TOML 1.1.0 was released on 2025-12-18. It adds multi-line inline tables with trailing commas, the `\xHH` and `\e` escapes, and optional seconds in times. (verified 2026-11-19, https://raw.githubusercontent.com/toml-lang/toml/main/CHANGELOG.md)
- Tombi (npm `tombi` 1.11.3, 2026-11-16) resolves a schema in this order: a `#:schema <url-or-path>` directive at the top of the file, then `[[schemas]]` in `tombi.toml`, then the SchemaStore catalog. Its default TOML version is 1.0.0. A schema opts into 1.1 with `"x-tombi-toml-version": "v1.1.0"`. (verified 2026-11-19, https://tombi-toml.github.io/tombi/main/docs/json-schema/ , https://registry.npmjs.org/tombi)
- Tombi strict mode is on by default. It treats a schema object with no `additionalProperties` as `additionalProperties: false`. `x-tombi-table-keys-order: "schema"` makes its formatter use schema key order. (verified 2026-11-19, https://tombi-toml.github.io/tombi/main/docs/configuration/)
- Taplo (the engine of the "Even Better TOML" extension) supports `#:schema` as a header directive, with relative paths resolved from the file. It is TOML 1.0 only. `taplo-cli` 0.10.0 is from 2025-05-23. (verified 2026-11-19, https://taplo.tamasfe.dev/configuration/directives.html , https://crates.io/api/v1/crates/taplo-cli)
- SchemaStore accepts self-hosted schema URLs. Each catalog entry maps `fileMatch` patterns to one schema. Nested globs such as `**/.maestro/**/*.yaml` are already in the catalog. (verified 2026-11-19, https://github.com/SchemaStore/schemastore/blob/master/CONTRIBUTING.md , https://www.schemastore.org/api/json/catalog.json)
- smol-toml 1.9.1 parses TOML 1.1. Its `stringify` drops comments, turns `1.0` into `1`, turns inline tables into sections, adds milliseconds to datetimes and has no multi-line string output. It cannot produce canonical bytes, so use it only for parsing. `unsafeKeyBehaviour: 'throw'` (1.9.0+) rejects `__proto__` keys. (verified 2026-11-19, https://registry.npmjs.org/smol-toml ; stringify behaviour checked locally on 1.9.1)
- `@decimalturn/toml-patch` 3.3.3 edits TOML in place and keeps comments and formatting. (verified 2026-11-19, https://registry.npmjs.org/@decimalturn/toml-patch)
- zod 4 has `z.toJSONSchema()` built in. The default target is draft 2020-12. Other options are `io: "input"`, `unrepresentable`, `cycles`, `reused: "ref"` (to `$defs`), `override` and a `metadata` registry. Objects get `additionalProperties: false` except in `input` mode, which matches Tombi strict mode. `z.fromJSONSchema()` is experimental. (verified 2026-11-19, https://zod.dev/json-schema)
- Biome 2.6.8 does not format or lint TOML. (verified 2026-11-19, https://biomejs.dev/internals/language-support/)

## Libraries and versions

Latest versions on npm as of 2026-11-19 (source: `https://registry.npmjs.org/<package>`). "Pin" is what this project uses when it differs from latest.

| Package | Version | Date | Why |
|---|---|---|---|
| `zod` | 4.6.7 | 2026-10-12 | Schemas, types and JSON Schema (`z.toJSONSchema`) from one source |
| `smol-toml` | 1.9.1 | 2026-10-09 | TOML 1.1 parser, 0 deps, `engines >=18`. Parse only |
| `ulid` | 3.0.2 | 2025-11-30 | Revived official ULID package with ESM/CJS and `monotonicFactory()`, works on Workers. `ulidx` 2.4.1 has had no release since 2024-08-25 |
| `hono` | 4.13.19 | 2026-11-16 | One HTTP app for Node and Workers. 5.0.0-rc.1 is on `next` |
| `@hono/node-server` | 2.1.9 | 2026-11-17 | Runs Hono on Node, `engines >=20` |
| `jose` | 6.2.18 | 2026-11-18 | Verifies Cloudflare Access JWTs and GitHub OIDC tokens (`createRemoteJWKSet`) |
| `aws4fetch` | 1.0.20 | 2024-08-28 | SigV4 over `fetch` for S3, R2 and MinIO on any runtime. Stale but tiny. Set `retries` (default 10) to 2–3 |
| `@modelcontextprotocol/server` | 2.4.0 | 2026-10-23 | MCP SDK v2, runtime-neutral, stdio via `/stdio`, `node >=20` |
| `@modelcontextprotocol/hono` | 2.0.2 | 2026-10-02 | Hono adapter with host validation (optional) |
| `drizzle-orm` | 0.45.4 (1.0.0-rc.5 on `rc`) | 2026-10-08 | Shared SQLite schema for D1. **0.45.4 has no `node-sqlite` driver.** It exports `./d1`, `./better-sqlite3`, `./sqlite-proxy` and others. `node-sqlite` exists only on 1.0 RC |
| `citty` | 0.2.2 | 2026-04-01 | CLI with nested lazy subcommands, 0 deps. Still 0.x |
| `modern-tar` | 0.8.6 | 2026-10-14 | USTAR + PAX tar on Web Streams, Workers-compatible, 0 deps, deterministic output |
| `nanotar` | 0.3.0 | 2026-02-11 | **Avoid.** Names over 100 bytes are truncated and written as directories (checked locally) |
| `@playwright/test` | 1.65.1 | 2026-11-13 | Optional peer of the reporter. `engines >=20`, but not tested on 20 |
| `wrangler` | 4.165.0 | 2026-11-18 | Deploy, D1 migrations, `getPlatformProxy`. **Needs Node ≥ 22.12** |
| `@cloudflare/vite-plugin` | 1.70.1 | 2026-11-19 | Vite plugin for Workers. Peers `wrangler ^4.164.0` |
| `vite` | 8.3.8 | 2026-11-11 | SPA build, `^20.19.0 \|\| >=22.12.0` |
| `@vitejs/plugin-react` | 6.3.0 | 2026-11-09 | Peers `vite ^8` |
| `react` / `react-dom` | 19.3.1 | 2026-10-14 | SPA |
| `typescript` | 5.9.3 (pin); latest 7.0.2 (2026-07-08) | 2025-09-30 | Pinned by [ADR 0007](../adr/0007-one-server-node-and-workers.md). 7.x is the native port; check the toolchain before moving |
| `vitest` | 4.1.12 (pin); latest 5.1.1 (2026-11-18) | 2026-10-15 | `@cloudflare/vitest-pool-workers` 0.23.0 still peers `vitest ^4.1.0`. 5.x needs Node ≥ 22.12 |
| `@biomejs/biome` | 2.6.8 | 2026-11-15 | Lint and format for TS and JSON (not TOML) |
| `tombi` | 1.11.3 | 2026-11-16 | TOML formatter, linter and LSP with JSON Schema |
| `tsup` | 9.0.0 | 2026-10-14 | Bundler named in the architecture. 9.x needs Node `^22.18 \|\| ^24.11 \|\| >=26` |
| `pnpm` | 12.21.0 | 2026-11-13 | Pin via `packageManager` |

## TestRail and testomat.io exports

Used by `iw import testrail` and `iw import testomatio` (T-522, [cli.md](../spec/cli.md#iw-import-testrail-casescsv)).

- TestRail exports cases to CSV or Excel from a dialog in which you choose the sections and the columns (any built-in or custom case field). The article links a sample `reference.csv`. (verified 2026-11-25, https://support.testrail.com/hc/en-us/articles/15144643126932-Export-test-cases , https://www.testrail.com/blog/csv-excel-test-case-testrail-import/)
- TestRail's CSV import has two templates: Test Case (Text), with the steps in one cell, and Test Case (Steps), where a case with several steps spans several rows (a row per step, the case fields only on the first). (verified 2026-11-25, https://support.testrail.com/hc/en-us/articles/7101779988372 , https://support.testrail.com/hc/en-us/articles/7771173371796-Migration-CSV-Excel)
- **The exact export header names were not readable.** The support pages answered 403 to a fetch and no search result lists them. The importer therefore matches headers case-insensitively and by alias: `Title`; `Section Hierarchy` or `Section`; `Priority`; `Preconditions`; `ID` or `Case ID`; `Steps (Step)`, `Steps (Separated)` or `Steps`; `Steps (Expected Result)` or `Expected Result`. The priority names `Critical`, `High`, `Medium`, `Low` and the `C<number>` case IDs are TestRail's defaults from memory. (unverified: check a real export before relying on a header name; the tests use a hand-written file in this layout)
- testomat.io's classical Markdown format has one `<!-- suite … -->` block (`id: @S` + 8 characters, optional `emoji`, `tags`, `assignee`) followed by a `# Suite title`, then per test a `<!-- test … -->` block (`id: @T` + 8 characters, `type`, `priority`, `tags`, `labels`; one `key: value` per line, lines without a colon are ignored) followed by `# Test title` (a `##` title also works), a description, and `## Steps` with a nested Markdown list: each top-level item is an action and the nested `*Expected*` item is its verifiable result. `priority` is one of `low`, `normal`, `important`, `high`, `critical`. Parameters are a Markdown table after `<!-- example -->`. (verified 2026-11-25, https://docs.testomat.io/project/import-export/export-tests/classical-tests-markdown-format/)
- The same page shows the block both as `<!-- suite … -->` and as `<!-- suiteid: … -->` in one rendering, and its examples lost their line breaks when read as text. The importer accepts `suite` or `test` followed by `key: value` lines, on the same line or the following ones. (verified 2026-11-25, same page; unverified against a real export)

## Open items

- **Node floor.** The docs say Node ≥ 20 (architecture: ≥ 20.19). Node 20 is EOL, and wrangler 4.165, tsup 9, vitest 5 and Playwright's own CI have all dropped it. Decide whether to raise the floor to `>=22.13`, or to keep 20 for the `iw` CLI only and pin older dev tools.
- **Index driver.** ADR 0007 calls for Drizzle on `node:sqlite`. That driver needs Drizzle 1.0 RC. The options are the RC, `sqlite-proxy` over `DatabaseSync` on 0.45.x, or raw SQL.
- **`node:sqlite` warnings.** `node:sqlite` is Stability 1.2 (release candidate) on v24.15.0+ and v25.7.0+, but 1.1 on v22, where it prints an `ExperimentalWarning`. The v26 docs rename `DatabaseSync` to `Database` and keep `DatabaseSync` as a deprecated alias (DEP0210). Use `DatabaseSync` while Node 22 is supported. The store loads it with a dynamic import that drops only that warning, and tsup must keep the `node:` prefix (`removeNodeProtocol: false`): tsup 8 strips it by default, and `sqlite` has no unprefixed name. Node 24.22.1 prints no warning (checked 2026-11-21). (verified 2026-11-19, https://nodejs.org/api/sqlite.html , https://raw.githubusercontent.com/nodejs/node/v24.x/doc/api/sqlite.md , https://raw.githubusercontent.com/nodejs/node/v22.x/doc/api/sqlite.md)
- The architecture lists `ulidx` and `nanotar`. This file recommends `ulid` and `modern-tar` instead (see the table).
- Test the R2 binding's create-only write (`onlyIf: new Headers({ 'If-None-Match': '*' })`) and AWS SDK checksum headers against R2 in a spike.

## Changelog

- 2026-11-25: Added the TestRail CSV and testomat.io classical Markdown export formats (T-522).
- 2026-11-21: `node:sqlite` loading and the tsup `node:` prefix (T-210).
- 2026-11-21: Added the Playwright Test Agents planner plan format (T-212).
- 2026-11-21: Added GitLab CI, CircleCI and Buildkite variable semantics (T-208).
- 2026-11-19: Added `pnpm/action-setup` runtimes and the `npx <tgz>` pitfall (review fixes).
- 2026-11-19: First version, compiled from the Phase 0 research. Spot-checked on the web: R2 conditional PUT, `node:sqlite` stability, `z.toJSONSchema`, Codex skill locations, Hono static assets and `ctx.access` with Static Assets, the MCP 2026-07-28 changelog, D1 limits, Claude Code's AGENTS.md loading, GitHub Node 20 removal, and npm versions.
