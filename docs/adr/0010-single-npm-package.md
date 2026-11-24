---
title: "0010. Ship one npm package, indx-watch"
description: "Architecture decision record: Ship one npm package, indx-watch."
---

# 0010. Ship one npm package, `indx-watch`

- Status: accepted
- Date: 2026-11-19

## Context

`npx indx-watch` must work cold, offline after first install, with no build step for the user. Several internal packages (bundle, core, store, sync, server, web, playwright) would otherwise be published and versioned separately.

## Decision

Workspace packages are private (`@indx-watch/*`). `packages/cli` publishes as **`indx-watch`**, bundling the internal packages with esbuild (via tsup) and including the built web UI and JSON Schemas. Subpath exports:

| Import | Purpose |
|---|---|
| `indx-watch` (bin `iw`, `indx-watch`) | CLI |
| `indx-watch/playwright` | Playwright reporter |
| `indx-watch/api` | Programmatic API (load bundle, compute status, write records) |

## Consequences

- One version number, one changelog, one install.
- Runtime dependencies are those of the CLI package; each is justified in [architecture.md](../architecture.md#dependencies).

## Alternatives considered

- **Publish each package** — more release work, version skew between reporter and CLI.
