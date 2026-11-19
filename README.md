# INDX Watch

**An AI-native end-to-end testing and QA management platform, self-hosted on Cloudflare.**

INDX Watch gives business people, engineers and QA one shared place to answer three questions for every release:

1. **What has to work?** Features → use cases → acceptance criteria, written in plain language.
2. **Has it been verified, and how do we know?** Test cases cover acceptance criteria. Every run records the exact spec version, fixture versions and deployment it ran against, along with screenshots and judge reasoning.
3. **Who does what next?** Test plans assign each test case to a person (or the AI browser agent) on a specific environment, with priority and due date.

All of this lives in a single Cloudflare D1 database, which is the single source of truth. Files (evidence, fixture data, visual baselines) live in R2.

> **Status: M0 — design documentation.** There is no application code yet. The `docs/` folder holds the specification that the implementation will follow.

## Key ideas

- **Done is computed, not declared.** A use case is done when all of its acceptance criteria pass. A release is Go when the P0/P1 gate conditions are met.
- **Evidence for every verdict.** Every pass or fail carries screenshots, DOM/accessibility snapshots, logs and the reasoning of each judge.
- **AI proposes, humans approve.** AI drafts use cases, test cases and fixtures from PRDs or pull requests. It runs browser tests and judges results with a confidence score. Anything below the threshold, or any P0 test case, goes to a human review queue.
- **Fixtures and test cases are versioned.** You can upload, edit, diff and roll back test data in the browser. Each run pins the versions it used.
- **No one gets lost.** Each environment has an entry guide (URL, how to get in, test accounts, reset hooks), so a tester can start from "My tasks" without asking anyone.
- **Small codebase.** One Next.js app plus one runner Worker. The project leans on Cloudflare managed services instead of custom infrastructure.

## Architecture at a glance

| Concern | Cloudflare service |
|---|---|
| UI + API | Next.js (App Router) on Workers via `@opennextjs/cloudflare` |
| Database | D1 (SQLite), Drizzle ORM |
| Files | R2 (evidence, fixtures, baselines) |
| Test execution | Workflows + Queues + Browser Rendering (`@cloudflare/playwright`) |
| Scheduled runs | Cron Triggers |
| Access control | Cloudflare Access (Zero Trust): company domain plus invited customers via one-time PIN |
| LLM | Anthropic Claude through Cloudflare AI Gateway |
| Integrations | GitHub App (deployments, PR impact analysis, Check Runs, issues) and an MCP server for coding agents |

## Repository layout

```
AGENTS.md        Guide for coding agents (Japanese). Read this first.
CLAUDE.md        Claude Code entry point (imports AGENTS.md)
docs/            Single source of truth, as HTML (Japanese)
  index.html       Entry point
  spec/            Layer 1: what and why (PRD, domain, UX, data model, architecture, AI)
  screens/         Layer 2: one page per screen (mockup + screen spec), S01–S11
  guides/          Layer 2: implementation guide, target app onboarding
apps/web/        Next.js app (planned)
apps/runner/     Execution Worker (planned)
packages/core/   Domain types, decision policy, judges, LLM client (planned)
packages/db/     Drizzle schema and D1 migrations (planned)
```

## Reading the docs

Open `docs/index.html` in a browser. Diagrams use Mermaid. When you open the files locally, `docs/assets/docs.js` loads Mermaid from a CDN to render them.

All documentation except this README is written in Japanese.

## Roadmap

| Milestone | Scope |
|---|---|
| M0 | Design documentation (this) |
| M1 | Auth, projects/environments/releases, spec tree, manual runner, my tasks, fixtures, release readiness |
| M2 | AI spec import, browser agent runs, LLM judge, review queue |
| M3 | GitHub App, scheduled runs, visual diff, MCP server |
| M4 | Customer UAT (guest role), analytics, flaky test detection |

See `docs/guides/implementation.html` for details.
