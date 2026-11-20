# 0011. Docs are Markdown with one home per fact; HTML only for design mockups

- Status: accepted
- Date: 2026-11-19

## Context

The previous design used Japanese HTML for every document. It was heavy for agents, hard for OSS contributors, and facts (file tree, roadmap) were duplicated across pages and drifted.

## Decision

- All docs are English Markdown; GitHub renders Mermaid.
- Each fact has exactly one home ([docs/README.md](../README.md) lists them). Other pages link to it.
- HTML is only used for visual design mockups in `docs/design/`.
- Platform facts that change (Cloudflare, Playwright, agent tooling) live only in [platform-notes.md](../research/platform-notes.md) with dates and sources.
- CI checks links, schema generation, the canonical round trip and that `examples/shop` validates.

## Consequences

Smaller docs, reviewable diffs, agent-friendly. Japanese UI strings live in the app's message files, not in docs.
