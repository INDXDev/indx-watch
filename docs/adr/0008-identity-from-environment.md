---
title: "0008. Identity comes from the environment; no custom auth"
description: "Architecture decision record: Identity comes from the environment; no custom auth."
---

# 0008. Identity comes from the environment; no custom auth

- Status: accepted
- Date: 2026-11-19

## Context

The previous design specified a custom CLI login and then dropped it. Auth systems are costly to build and to trust.

## Decision

Every write records an `actor` (`kind`: `human` | `ci` | `agent`, `id`, `name`, `via`) and a `source`. The actor comes from where the command runs:

| Where | Identity source | `via` |
|---|---|---|
| Local CLI / `iw serve` | `git config user.email` / `user.name` (override: `IW_ACTOR`) | `git` |
| GitHub Actions | `GITHUB_ACTOR`, run URL; optional OIDC token claims | `github` |
| Hosted on Cloudflare | `Cf-Access-Jwt-Assertion` verified with `jose` | `cloudflare-access` |
| Agents | the human or CI identity above, plus `kind = "agent"` and the model (`IW_ACTOR_KIND=agent`, `IW_AGENT_MODEL`) | as above |

Access to stores uses the platform's own credentials: the AWS SDK credential chain for S3, `cloudflared access token` (sent as `cf-access-token`) for a hosted server behind Cloudflare Access, `wrangler` login for deploys.

## Consequences

- Local identity is self-asserted, exactly like git commits. Reports show `via` so readers can weigh it. Stronger guarantees come from the hosted app (Access) and CI (OIDC).
- The CLI contains no secrets and can be public.

## Alternatives considered

- **Own accounts / API keys** — a second identity system to secure and operate.
