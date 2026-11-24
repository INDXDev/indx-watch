---
title: "0001. The bundle is the source of truth; databases are indexes"
description: "Architecture decision record: The bundle is the source of truth; databases are indexes."
---

# 0001. The bundle is the source of truth; databases are indexes

- Status: accepted
- Date: 2026-11-19

## Context

The previous internal design started with a cloud database (Cloudflare D1) as the source of truth and later moved to "the file format is the source of truth". The move was expensive: every screen, API and table had been designed around the database. Teams also need to edit tests in any editor or AI agent, review them in pull requests, and leave a vendor without losing data.

## Decision

The `.indx-watch/` bundle (typed TOML + data files, [bundle-format.md](../spec/bundle-format.md)) plus the result store ([sync.md](../spec/sync.md)) hold all data. Every database — SQLite on Node, D1 on Cloudflare, an in-memory model — is a **derived index** that `iw reindex` can drop and rebuild. No feature may store data only in an index.

## Consequences

- Every feature works on plain files and offline.
- Backups and migrations are file copies; `iw export --full` is a tarball of what already exists.
- Queries that need joins are computed in `packages/core` over an in-memory model; indexes exist for speed, not for truth.
- Writes from the hosted UI must go to the store (records) or to git (definitions), never only to D1.

## Alternatives considered

- **Database as source, files as export** — the previous design; causes lock-in and drift between export and truth.
- **Git only (results committed too)** — simple, but evidence blobs and CI results bloat the repository and non-engineers cannot write. Still possible as an option (un-ignore `runs/`).
