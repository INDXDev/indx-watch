# indx-watch

File-first, agent-native test management. Use cases, acceptance criteria, test cases and fixtures are typed TOML files in `.indx-watch/` in your repository; results are immutable records that sync through any folder or S3-compatible bucket. One package gives you the `iw` CLI, a local web UI, a Playwright reporter, an MCP server and agent skills.

Requires Node.js 22.13 or later.

## Quick start

```bash
npx indx-watch init                       # creates .indx-watch/ (project, environment, release, feature)
npx indx-watch new uc --title "Sign up" --ac "A confirmation email is sent" --ready
npx indx-watch new tc --uc UC-1 --title "Sign up by email" --step "Sign up => The email arrives" --ready
npx indx-watch check                      # validate everything
npx indx-watch serve                      # web UI on http://127.0.0.1:4321
```

`npx indx-watch init --example` copies a complete sample project (with a sample store) instead.

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

```bash
npx indx-watch skills install                                   # .claude/skills/ and .agents/skills/
claude mcp add --scope project indx-watch -- npx -y indx-watch mcp
codex mcp add indx-watch -- npx -y indx-watch mcp
```

Agents write drafts (`origin = "ai"`) and record runs with a confidence; only people approve, review and waive.

## Programmatic API

```ts
import { loadProject, computeStatus, recordRun } from 'indx-watch';

const { model } = await loadProject('.');
const status = computeStatus(model, { release: 'v1.2.0' });
```

## Documentation

Full documentation: <https://github.com/INDXDev/indx-watch/tree/main/docs>. License: Apache-2.0.
