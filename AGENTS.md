# AGENTS.md

Guide for coding agents (Claude Code, Codex, others) working **on this repository**. `CLAUDE.md` imports this file. Users of INDX Watch who want agent skills should read [docs/spec/agents.md](docs/spec/agents.md) instead.

## What this is

INDX Watch is a file-first, agent-native test management tool. Test cases, acceptance criteria and fixtures are typed TOML files in `.indx-watch/`; results sync through any folder or S3-compatible bucket; a small server and web UI run locally (`npx indx-watch serve`) or on Cloudflare (`iw deploy`). Start with [docs/README.md](docs/README.md).

## Sources of truth

Each fact has one home. Read the home before changing behavior; update it in the same PR as the code.

| Topic | Home |
|---|---|
| Domain model, IDs, states, computed done, gate, decision policy | [docs/spec/concepts.md](docs/spec/concepts.md) |
| File format | [docs/spec/bundle-format.md](docs/spec/bundle-format.md) + `packages/bundle/src/schema/` |
| Records, store layout, sync | [docs/spec/sync.md](docs/spec/sync.md) + `packages/bundle/src/schema/records.ts` |
| CLI commands and JSON output | [docs/spec/cli.md](docs/spec/cli.md) + `packages/cli/src/json.ts` |
| Ports, packages, line budget, dependencies | [docs/architecture.md](docs/architecture.md) + `packages/store/src/ports.ts` |
| Web app screens and interaction patterns | [docs/spec/web.md](docs/spec/web.md) |
| Plan and task IDs | [docs/roadmap.md](docs/roadmap.md) |
| Platform facts (Cloudflare, Playwright, agent tooling) | [docs/research/platform-notes.md](docs/research/platform-notes.md) — verify on the web before relying on anything older than 90 days |
| Sample data | [examples/shop](examples/shop) — the only sample project and the only sample result set (`store/`); docs and skills use only it |

## Repository map

```text
packages/bundle      schemas, canonical TOML, IDs, hashes, load, check, archive (pure; Node fs only in src/node/)
packages/core        model, decide, status, gate, i18n, report data (pure)
packages/store       ports + adapters (details: docs/architecture.md#ports-and-adapters)
packages/sync        push/pull/watch, snapshots, workspace merge
packages/server      Hono app for Node and Workers; report rendering
packages/web         Vite + React SPA (messages in src/messages/{en,ja}.json)
packages/cli         `iw` → published as `indx-watch`; MCP server; deploy
packages/playwright  reporter → `indx-watch/playwright`
skills/              Agent Skills (Claude Code + Codex)
schemas/             generated JSON Schemas (do not edit by hand)
examples/shop        demo app + Playwright tests + .indx-watch bundle + sample store
.indx-watch/         this repository's own QA (dogfooding)
e2e/                 Playwright tests implementing .indx-watch/ test cases (tagged @TC-n)
scripts/             docs links, line budget, report, purity and Worker build checks
docs/                Markdown docs; HTML only in docs/design/
```

## Commands

```bash
pnpm install
pnpm iw <command>          # run the CLI from source (tsx)
pnpm test                  # vitest
pnpm typecheck && pnpm lint
pnpm schemas               # regenerate schemas/v1/*.json from Zod
pnpm build                 # web + bundled CLI (packages/cli/dist)
pnpm verify                # what the CI check job runs, except the tarball cold start (needs network for wrangler)
```

## Rules

1. **Docs first for behavior changes.** Change the home doc and the code in the same PR. If code and docs disagree, the docs win until someone changes them on purpose.
2. **Schema changes** go through `packages/bundle/src/schema/`, then `pnpm schemas`, then `bundle-format.md` / `sync.md`, then `examples/shop`. Additive changes only within `schema_version = 1`.
3. **Pure core.** `packages/core` and `packages/bundle` (outside `src/node/`) must not import `node:*` I/O modules, vendor SDKs or `hono`. Biome enforces this.
4. **Vendors behind ports.** Only adapter folders in `packages/store` (and `packages/cli/src/deploy/`) may talk to Cloudflare, S3 or other services. The one exception is `iw login`, which only runs `cloudflared`. Biome enforces this for `core` and `bundle`; review enforces it elsewhere.
5. **One rule, one function.** Verdicts come only from `decide()`; readiness only from `evaluateGate()`; status only from `computeStatus()`. Never re-implement them in the server, UI, reporter or CLI.
6. **Canonical writes.** Every TOML write goes through `formatToml()`. Never hand-assemble TOML strings in other packages.
7. **`--json` is a contract.** Shapes live in `packages/cli/src/json.ts`; additive changes only.
8. **Line budget.** Respect the per-package budget in [architecture.md](docs/architecture.md#line-budget); prefer deleting code to adding it. Every new runtime dependency needs a line in the dependency table.
9. **No secrets** in code, fixtures, tests or docs. Use `env:NAME` references.
10. **Tests**: unit tests in `packages/*/test/`; dogfood end-to-end tests in `e2e/`, tagged `@TC-n`. Use `examples/shop` as the fixture and do not invent other sample projects. A unit test may build hand-made records over the shop bundle for one scenario; keep them local to the test and do not call them "sample results" (those are `examples/shop/store`).
11. **UI strings** go in both `en.json` and `ja.json`.
12. **Commits**: Conventional Commits (`feat(cli): …`), signed off (`git commit -s`, DCO). One logical change per commit.

## Verify before you finish

`pnpm lint && pnpm typecheck && pnpm test` must pass (`pnpm verify` runs everything). Coding agents: the CLI treats `CLAUDECODE=1` as an agent and refuses `--ready`, so run `pnpm e2e` and manual quickstarts with `env -u CLAUDECODE`. For CLI or format changes also run `pnpm iw check --dir examples/shop/.indx-watch`. For UI changes run `pnpm iw serve --dir examples/shop/.indx-watch` and look at the page.
