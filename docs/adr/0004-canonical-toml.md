---
title: "0004. One canonical TOML serializer; comments are not preserved"
description: "Architecture decision record: One canonical TOML serializer; comments are not preserved."
---

# 0004. One canonical TOML serializer; comments are not preserved

- Status: accepted
- Date: 2026-11-19

## Context

Agents and humans both edit bundle files. Diffs must be small and stable, and a round trip (parse → write) must not churn files. TOML libraries differ in formatting, and format-preserving editing libraries are large and rare in JavaScript ([platform notes](../research/platform-notes.md#toml-and-editor-tooling)).

## Decision

Parse with a small spec-compliant parser and write with **our own serializer** in `packages/bundle`, driven by the Zod schema's field order and the rules in [bundle-format.md](../spec/bundle-format.md#common-rules-for-every-toml-file). Every tool writes through it. Canonical files round-trip byte-identically; `iw fmt` canonicalizes others. Comments are allowed but not preserved on rewrite; durable remarks go in `notes` fields.

## Consequences

- Stable diffs and trivial content hashing (hash of canonical bytes).
- Users who hand-write comments lose them when a tool rewrites that file. Documented in the format spec and in `iw fmt --help`.

## Alternatives considered

- **Format-preserving editor (CST)** — larger dependency, harder to guarantee canonical output.
- **YAML or JSON** — YAML has ambiguity pitfalls; JSON lacks comments and multi-line strings that make steps readable.
