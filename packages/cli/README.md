# indx-watch

Test management that lives in your repository, for people and coding agents. Use cases, acceptance criteria, test cases and test data are typed TOML files in `.indx-watch/`; manual, Playwright and agent results sync through any folder or S3-compatible bucket; whether a release can ship is computed from them. One package gives you the `iw` CLI, a local web app, a Playwright reporter, an MCP server and agent skills for Claude Code and Codex.

![INDX Watch Home: release v1.2.0 "Not ready to ship: 1 of 8 checks fail"](https://raw.githubusercontent.com/INDXDev/indx-watch/main/docs/images/home.png)

Requires Node.js 22.13 or later. Docs: <https://github.com/INDXDev/indx-watch/tree/main/docs> · Live demo (read-only): <https://indx-watch-demo.i-248.workers.dev>

## Quick start

In your app's repository:

```bash
npx indx-watch init
```

This writes the `.indx-watch/` bundle, the skills for Claude Code (`.claude/skills/`) and Codex (`.agents/skills/`), the `indx-watch` MCP server for both (`.mcp.json`, `.codex/config.toml`) and a block in `AGENTS.md`. Commit it, open Claude Code or Codex in the repository, and say "Set up testing for this repo" (or type `/iw-setup`, `$iw-setup` in Codex). Then:

| Job | Claude Code | You say |
|---|---|---|
| Design tests | `/iw-design` | "What should we test in checkout?" |
| Prepare data | `/iw-data` | "The review photo tests need data" |
| Run tests | `/iw-test` | "Walk me through TC-3" |
| Fix failures | `/iw-triage` | "Why did TC-8 fail?" |
| Know where you are | `/iw-status` | "Can we ship 1.2.0?" |

Agents write drafts (`origin = "ai"`) and record runs with a confidence; only people approve, review and waive. Guides: [quickstart](https://github.com/INDXDev/indx-watch/blob/main/docs/guides/quickstart.md), [from zero to "can we ship?"](https://github.com/INDXDev/indx-watch/blob/main/docs/guides/journey.md).

To look around first: `npx indx-watch init demo --example`, then `cd demo && npx indx-watch serve --open`. Without an agent, `npx indx-watch serve --open` starts the web app and every step is also a command (below).

The tables below use `iw`, the short command the package installs. Without installing, write `npx indx-watch <command>` instead; never `npx iw`, which downloads an unrelated npm package. To get `iw` on your PATH, run `npm i -g indx-watch`.

## Commands

| Command | What it does |
|---|---|
| `iw init`, `iw new <kind>`, `iw approve <ref>` | Create definitions; humans approve AI drafts |
| `iw check [--fix]`, `iw fmt` | Validate and canonicalize the bundle |
| `iw status [--gate]`, `iw show <ref>`, `iw list <kind>` | Coverage, use case status and the readiness gate |
| `iw record <TC>`, `iw review <run>`, `iw waive <TC>`, `iw retract <id>` | Results and human judgements |
| `iw fixture add` / `fetch`, `iw deployment add` | Test data and deployments |
| `iw sync [--watch]` | Exchange results with the store in `project.toml` |
| `iw report --format md\|html\|pdf\|json` | Release and plan reports |
| `iw export --full [--zstd]`, `iw import` | Portable archives (`.tar.gz`; zstd on request) |
| `iw serve`, `iw deploy` | Run the server locally, or on Cloudflare Workers |
| `iw mcp`, `iw skills install` | MCP server on stdio and agent skills for Claude Code and Codex |

Every command accepts `--json` and prints exactly one JSON envelope (`{ ok, command, data, warnings }`). Exit codes: 0 success, 1 a "no" answer (check failed, gate failed), 2 usage, 3 bundle or config, 4 store or external tool.

## Playwright reporter

```ts
// playwright.config.ts
export default defineConfig({
  reporter: [['list'], ['indx-watch/playwright']],
});
```

Tag tests with the test case key (`test('valid coupon @TC-3', …)`); each result becomes a run record.

## Agents

`iw init` (unless `--no-agents`) installs the skills and the MCP server for Claude Code and Codex. After upgrading the package, `npx indx-watch skills install` updates what it wrote. Each person approves the project MCP server once in their agent.

## Programmatic API

```ts
import { loadProject, computeStatus, recordRun } from 'indx-watch';

const { model } = await loadProject('.');
const status = computeStatus(model, { release: 'v1.2.0' });
```

## Documentation

Full documentation: <https://github.com/INDXDev/indx-watch/tree/main/docs>. Source and issues: <https://github.com/INDXDev/indx-watch>. License: Apache-2.0.
