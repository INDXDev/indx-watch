# Documentation

INDX Watch keeps test cases, fixtures and results as typed files, syncs results through any bucket, and computes release readiness. These docs are the single source of truth for its design. Each fact has exactly one home; other pages link to it.

## Reading order

| You are… | Read |
|---|---|
| **A user** trying it out | [Quickstart](guides/quickstart.md) → [Writing good test cases](guides/writing-test-cases.md) → [Fixtures](guides/fixtures.md) → [Playwright](guides/playwright.md) → [GitHub Actions](guides/github-actions.md) → [S3 sync](guides/s3-sync.md) |
| **Self-hosting** a shared instance | [Cloudflare](guides/self-host-cloudflare.md) or [Node/Docker](guides/self-host-node.md), then [Security](spec/security.md) |
| **A maintainer / contributor** | [Vision](vision.md) → [Concepts](spec/concepts.md) → [Architecture](architecture.md) → [Bundle format](spec/bundle-format.md) → [Sync](spec/sync.md) → [ADRs](adr/README.md) → [Roadmap](roadmap.md) → [CONTRIBUTING](../CONTRIBUTING.md) |
| **A coding agent** | [AGENTS.md](../AGENTS.md) (working on this repo) or [Agents spec](spec/agents.md) (using INDX Watch from an agent) |

## Where each fact lives

| Fact | Home |
|---|---|
| Problem, principles, non-goals | [vision.md](vision.md) |
| Entities, IDs, states, computed done, gate, decision policy | [spec/concepts.md](spec/concepts.md) |
| `.indx-watch/` layout and every file type | [spec/bundle-format.md](spec/bundle-format.md) |
| Records, store layout, merge rules, `iw sync` | [spec/sync.md](spec/sync.md) |
| Commands, flags, JSON output, exit codes | [spec/cli.md](spec/cli.md) |
| Playwright reporter, GitHub Action, CI identity | [spec/integrations.md](spec/integrations.md) |
| Skills, MCP tools, AI rules | [spec/agents.md](spec/agents.md) |
| Report contents, formats, customer sharing | [spec/reports.md](spec/reports.md) |
| Identity, secrets, access, threat model | [spec/security.md](spec/security.md) |
| UI locales, content translations, literal strings | [spec/i18n.md](spec/i18n.md) |
| Packages, ports, runtime targets, line budget, dependencies | [architecture.md](architecture.md) |
| Decisions and their reasons | [adr/](adr/README.md) |
| Milestones and task IDs | [roadmap.md](roadmap.md) |
| Other tools and positioning | [research/landscape.md](research/landscape.md) |
| Dated platform facts with sources | [research/platform-notes.md](research/platform-notes.md) |
| Screen designs (HTML) | [design/](design/index.html) |
| Reusable maintainer prompts | [prompts/](prompts/) |

## Writing rules

- Plain, specific English. Lead with the answer.
- Examples come from [`examples/shop`](../examples/shop) only.
- Diagrams in Mermaid.
- Every spec page ends with **Acceptance criteria** that tests can check.
- Platform facts go in [platform-notes.md](research/platform-notes.md) with a date and a source URL, never inline in other pages.
- CI (`pnpm check:docs`) checks every relative link and anchor.
