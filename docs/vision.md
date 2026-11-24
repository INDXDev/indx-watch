---
title: "Vision"
description: "The problem INDX Watch solves, its principles, who it is for and its non-goals."
---

# Vision

INDX Watch keeps every test case, fixture and result of a product in **typed files next to the code**, syncs results as easily as a shared drive, and computes — never declares — whether a release is ready.

## The problem

Product teams ship with QA that *looks* done but is not.

- **Test cases are scattered** across Google Drive, spreadsheets, GitHub issues and people's heads. For a given release nobody can answer: which use cases are verified, by whom, when, on which build and environment, and what "done" even means.
- **Fixtures and test data are unmanaged.** They are not versioned, not linked to the test cases that need them, and no one knows which fixture version a run used. Fixtures only really work when they live in the repository next to the code.
- **Automated and manual results are disconnected.** Playwright and CI results are not linked to test cases, use cases, releases or deployments, and neither are manual results. Final integration and acceptance testing is the weakest part.
- **Test data is not AI-ready.** Coding agents such as Claude Code and Codex cannot reliably read, write, run or triage tests, because the information is not in a typed, local, file-based form.
- **Drive alone or Git alone is not enough.** Drive is easy to share but has no structure. Git has structure and history, but non-engineers and customers cannot use it, and large binaries do not belong there.
- **Customers and stakeholders need reports** — release readiness, coverage, evidence — without access to internal tools.

## The idea: the best of Git and the best of Drive

| From Git | From Drive |
|---|---|
| Typed files you can clone anywhere, diff, review, blame | Sync that is continuous and needs no ceremony |
| Any editor or AI agent can edit them | Non-engineers use a browser |
| History and review for *definitions* | Large files and results live outside the repo |

So INDX Watch splits data in two:

- **Definitions** (use cases, acceptance criteria, test cases, fixtures, plans) are canonical TOML files in `.indx-watch/`, synced through git.
- **Results** (runs, evidence, large blobs) are append-only records in a **result store** — a folder or any S3-compatible bucket — synced continuously by `iw sync`.

A hosted UI (on Node, Docker or Cloudflare) is just another client of the same files and store. See [architecture](./architecture.md).

## Principles

These are non-negotiable. Each links to where it is specified.

1. **File-first.** The bundle format is the source of truth. Any database is a disposable index rebuilt from the bundle plus the result store. → [bundle format](./spec/bundle-format.md), [ADR 0001](./adr/0001-file-first-bundle.md)
2. **Local-first, cloud-optional.** Everything works offline with `npx indx-watch`. Sharing goes through pluggable storage adapters; Cloudflare is the recommended host but replaceable. → [sync](./spec/sync.md), [ADR 0003](./adr/0003-storage-only-store-protocol.md)
3. **Agent-native.** Strict schemas, stable IDs, canonical formatting, `--json` everywhere, agent skills and an MCP server. → [agents](./spec/agents.md), [CLI](./spec/cli.md)
4. **Done is computed, never declared.** A use case is done only when every acceptance criterion is covered by test cases whose latest relevant result passes, on the release in question, with evidence. → [concepts](./spec/concepts.md#computed-done)
5. **Every result is attributable and reproducible.** Who or what ran it, when, against which build and environment, with which test case and fixture versions, how, and with what evidence. Identity comes from the environment you run in; INDX Watch never invents an auth system. → [security](./spec/security.md)
6. **AI proposes, humans approve.** AI-written definitions enter as `draft` with `origin = "ai"`. AI verdicts carry confidence; low confidence goes to a human. → [agents](./spec/agents.md)
7. **Small code, boring tech.** One TypeScript codebase for Node and Cloudflare Workers, with a line budget per package. → [architecture](./architecture.md#line-budget)
8. **Secrets never live in the bundle.** Only references. `iw check` refuses anything that looks like a secret. → [security](./spec/security.md#secrets)
9. **Bilingual-ready.** UI in English and Japanese; content can carry reviewed translations; literal on-screen strings of the app under test are never translated. → [i18n](./spec/i18n.md)

## Who it is for

| Role | What they do with INDX Watch |
|---|---|
| Engineer | Writes test cases and fixtures next to code, tags Playwright tests with `@TC-12`, reads readiness in CI. |
| QA lead / PM | Plans a release, assigns test cases, reviews `needs_review` verdicts, decides go/no-go from the computed gate. |
| Tester (incl. business staff) | Opens the browser, follows plain-language steps, attaches screenshots. |
| Coding agent | Reads the spec, writes draft test cases, runs them, triages failures, writes reports — through `iw --json` or MCP. |
| Customer / stakeholder | Receives a readable report (HTML/PDF) or a time-limited share link from the hosted app. |

## Non-goals

- **Not a test runner.** Playwright and LLM browser agents run tests; INDX Watch records, links and judges.
- **Not an issue tracker or requirements tool.** Link to GitHub issues; do not replace them.
- **No custom auth.** Use git identity, GitHub's CI identity, Cloudflare Access, and standard cloud credentials.
- **No real-time collaborative editing** of definitions in v0.x. Definitions are files; edit them with an editor or an agent.
- **No vendor lock-in.** Nothing outside an adapter may assume a specific cloud.
- **Not a BI tool.** Reports answer "is this release ready, and what is the evidence?" — not arbitrary analytics.

## Where the plan lives

Milestones and task IDs live only in the [roadmap](./roadmap.md). Competing tools and positioning live in the [landscape](./research/landscape.md).
