# Contributing

Thanks for helping! This project is small on purpose. Read [AGENTS.md](AGENTS.md) — it is the short guide for humans too — and [docs/README.md](docs/README.md).

## Development setup

Requirements: Node 22+ (20.19 minimum), pnpm 10.

```bash
git clone https://github.com/INDXDev/indx-watch && cd indx-watch
pnpm install
pnpm ci                       # lint, typecheck, tests, schemas, docs links, example check
pnpm iw serve --dir examples/shop/.indx-watch   # UI with the sample project
```

End-to-end tests of the sample app: `pnpm --filter shop exec playwright install chromium && pnpm --filter shop test`.

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

Skills live in `skills/<name>/SKILL.md` (Agent Skills format, portable frontmatter only). Test them on `examples/shop` and update the table in [agents.md](docs/spec/agents.md#skills).

### Add a UI string

Add the key to both `packages/web/src/messages/en.json` and `ja.json`.

## Dogfooding {#dogfooding}

This repository manages its own QA in [`.indx-watch/`](.indx-watch). When you add a feature, add or update its use case, acceptance criteria and test cases there, and tag the automated test with `@TC-n`. CI records results with the Playwright reporter and posts a report to the job summary.

## Commits and pull requests

- [Conventional Commits](https://www.conventionalcommits.org/): `feat(sync): add lookback window`.
- **DCO**: sign off every commit (`git commit -s`). By signing off you certify the [Developer Certificate of Origin](https://developercertificate.org/).
- One topic per PR. Update the home doc of anything you change. Reference roadmap task IDs (`T-105`).
- Keep packages within their [line budget](docs/architecture.md#line-budget).
- Add a line to [CHANGELOG.md](CHANGELOG.md) under "Unreleased".

## Code of conduct

See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
