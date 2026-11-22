# Contributing

Thanks for helping! This project is small on purpose. Read [AGENTS.md](AGENTS.md) — it is the short guide for humans too — and [docs/README.md](docs/README.md).

## Development setup

Requirements: Node 22.13+, pnpm 10.

```bash
git clone https://github.com/INDXDev/indx-watch && cd indx-watch
pnpm install
pnpm verify                   # what CI's check job runs: lint, typecheck, tests, schemas, docs links, purity,
                              # line budget, build, example check, sample report, Worker dry-run build
pnpm iw serve --dir examples/shop/.indx-watch   # UI with the sample project
```

End-to-end tests (after `pnpm build` and `pnpm exec playwright install chromium`): `pnpm --filter shop test` for the sample app, `pnpm e2e` for this repository's own test cases in `e2e/`.

To try your build as a user would, run `pnpm build && npm install --global ./packages/cli` and use `iw` in a folder outside the clone (or call `node packages/cli/dist/bin.js`).

`pnpm ci` does not work: pnpm reserves `ci` as a built-in command, so the script is called `verify`.

## Repository map

See [AGENTS.md](AGENTS.md#repository-map) and [docs/architecture.md](docs/architecture.md).

## How to…

### Add a field to the bundle format

1. Add it to the Zod schema in `packages/bundle/src/schema/` (optional, in the right position — order is the canonical key order).
2. `pnpm schemas` to regenerate `schemas/v1/`.
3. Document it in [bundle-format.md](docs/spec/bundle-format.md) (or [sync.md](docs/spec/sync.md) for records).
4. Use it in `examples/shop` if it helps understanding, and add tests.
5. Breaking changes need an ADR, a `schema_version` bump and an `iw migrate` step.

### Add a storage adapter

Implement `ObjectStore` from `packages/store/src/ports.ts` in `packages/store/src/adapters/<name>.ts`, register its URL scheme, and run the shared contract suite (`packages/store/test/contract.ts`) against it.

### Add or change a skill

Skills live in `skills/<name>/SKILL.md` (Agent Skills format, portable frontmatter plus the Claude Code keys [agents.md](docs/spec/agents.md#skills) allows). Test them on `examples/shop`, update the table in [agents.md](docs/spec/agents.md#skills), and run `pnpm test`, which includes the [skill lint](docs/spec/agents.md#lint).

### Use sample data

[`examples/shop`](examples/shop) is the only sample project, and `examples/shop/store/` holds the only sample results (the ones [reports.md](docs/spec/reports.md#example) documents). Docs, skills and guides use only them. A unit test may build hand-made records over the shop bundle to test one scenario; keep them inside the test and do not call them sample results.

### Add a UI string

Add the key to both `packages/web/src/messages/en.json` and `ja.json`.

## Dogfooding
This repository manages its own QA in [`.indx-watch/`](.indx-watch). When you add a feature, add or update its use case, acceptance criteria and test cases there, and tag the automated test with `@TC-n`. CI records results with the Playwright reporter and posts a report to the job summary.

The repository also uses its own agent skills: `pnpm iw skills install` at the root wrote `.claude/skills/`, `.agents/skills/`, `.mcp.json`, `.codex/config.toml` and the marked block at the end of [AGENTS.md](AGENTS.md). Edit skills only in [`skills/`](skills), then run `pnpm iw skills install` again and commit the copies; a test fails while they differ. The project MCP server runs the published package (`npx -y indx-watch mcp`), as in any other repository, so a re-run does not rewrite it. That package can be older than `.indx-watch/` here: indx-watch 0.1.0 cannot load test cases that use `purpose`, `start` or step `checks` (TC-15 to TC-18 do), and it has no MCP `status` `mine` or `record_run` `checks`. So until the next release the project MCP server does not work in this repository; use `pnpm iw …`, or add a local server that runs your working copy, e.g. `claude mcp add --scope local indx-watch-dev -- pnpm --silent iw mcp`.

## Commits and pull requests

- [Conventional Commits](https://www.conventionalcommits.org/): `feat(sync): add lookback window`.
- **DCO**: sign off every commit (`git commit -s`). By signing off you certify the [Developer Certificate of Origin](https://developercertificate.org/).
- One topic per PR. Update the home doc of anything you change. Reference roadmap task IDs (`T-105`).
- Keep packages within their [line budget](docs/architecture.md#line-budget).
- Add a line to [CHANGELOG.md](CHANGELOG.md) under "Unreleased".

## Code of conduct

See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Releasing (maintainers)

1. Update the version in `packages/cli/package.json` and move the "Unreleased" entries in [CHANGELOG.md](CHANGELOG.md) under the new version, dated with the publish day. If that version already has an entry (0.1.0 does), add the entries to it and update its date.
2. Push a tag `vX.Y.Z` (or create it by publishing a release on GitHub's release page; the workflow then attaches the tarball to that release). [`.github/workflows/release.yml`](.github/workflows/release.yml) runs `pnpm verify`, packs the package, publishes it to npm with provenance (secret `NPM_TOKEN`) and creates a GitHub release whose notes are generated from merged PRs (`--generate-notes`), not from CHANGELOG.md. Run it manually with `dry-run` to only build and pack.
