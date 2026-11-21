# 0009. Every vendor sits behind a port

- Status: accepted
- Date: 2026-11-19

## Context

Cloudflare-specific services (D1, R2 bindings, Access, Browser Run, Workflows) leaked into every layer of the previous design.

## Decision

`packages/core` and `packages/bundle` are pure and vendor-free. Everything that touches the outside world is a port with adapters ([architecture.md](../architecture.md#ports-and-adapters)):

| Port | v0.1 adapters |
|---|---|
| `ObjectStore` | `fs`, `s3` (AWS S3, R2, MinIO, GCS interop), `r2` (Workers binding), `http` (hosted server), `memory` |
| `Index` | `memory` (Node), `d1` (Workers); `sqlite` (`node:sqlite`, Node) since T-210 |
| `IdentityProvider` | process (`env`, `github`, `git`), `cloudflare-access`, trusted header |
| `BrowserProvider` | interface + fake (v0.2: local Playwright, Cloudflare Browser Run) |
| `LlmClient` | interface + fake (v0.2: Anthropic, optionally via a gateway) |

A lint rule (Biome `noRestrictedImports`) forbids vendor SDK imports outside adapter folders.

## Consequences

- Cloudflare is one adapter set; replacing it means writing adapters, not refactoring.
- Adapters are small and tested against a shared contract test suite.
