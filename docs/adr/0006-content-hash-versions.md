# 0006. Test case and fixture versions are content hashes

- Status: accepted
- Date: 2026-11-19

## Context

Results must say exactly which test case and fixture content they were produced with. Stored version counters (`version = 3`) need a central authority and drift on branches.

## Decision

A version is `tcv:`/`fxv:` + the first 12 hex characters of SHA-256 over the canonical bytes of the fields that define behavior ([concepts](../spec/concepts.md#versions-and-staleness)). Nothing is stored in the file. Git history is the version history.

## Consequences

- Two branches with identical content have identical versions; staleness is a string comparison.
- Cosmetic edits (title, tags, translations) do not invalidate results.
- 48 bits per project is far beyond collision risk for this use.

## Alternatives considered

- **Integer versions** — needs coordination; meaningless across branches.
- **Git blob SHA** — includes cosmetic fields and depends on git.
