---
title: "INDX Watch"
description: "Test management that lives in your repository: test cases, test data and results as typed files, release readiness computed from them, for people and coding agents."
---

# INDX Watch

INDX Watch keeps use cases, acceptance criteria, test cases and test data as typed TOML files in `.indx-watch/`, next to your code. Manual, Playwright and agent results sync through a folder or an S3-compatible bucket. Whether a release can ship is computed from those results, never declared. Coding agents (Claude Code, Codex) do the legwork through skills; people approve, review and decide.

![Home: release v1.2.0 "Not ready to ship: 1 of 8 checks fail", 7 of 10 tests pass, your queue and recent activity](./images/home.png)

## Start here

| If you want to | Read |
|---|---|
| See the whole path, from install to a release decision, by role | [From zero to "can we ship?"](./guides/journey.md) |
| Install it and talk to your agent | [Quickstart](./guides/quickstart.md) |
| Know what each agent skill does and what you approve | [Testing with Claude Code or Codex](./guides/testing-with-agents.md) |
| Test, review and report in the browser | [Using the web app](./guides/web-app.md) |
| Write test cases a newcomer can run | [Writing good test cases](./guides/writing-test-cases.md) and [Fixtures](./guides/fixtures.md) |
| Link Playwright and CI | [Playwright](./guides/playwright.md) and [GitHub Actions](./guides/github-actions.md) |
| Share results with a team | [S3 sync](./guides/s3-sync.md), [Cloudflare](./guides/self-host-cloudflare.md) or [Node/Docker](./guides/self-host-node.md) |
| Look up a rule, a file format or a command | [Concepts](./spec/concepts.md), [Bundle format](./spec/bundle-format.md), [CLI](./spec/cli.md) |

Try it without installing anything: the [live demo](https://indx-watch-demo.i-248.workers.dev) shows the sample shop project read-only. The source, issues and changelog are on [GitHub](https://github.com/INDXDev/indx-watch). The map of every page and the one home of each fact is in the [documentation map](https://github.com/INDXDev/indx-watch/blob/main/docs/README.md).
