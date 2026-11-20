# Security, identity and attribution

INDX Watch never runs its own authentication. It records *who did what* using the identity of the environment it runs in, keeps secrets out of files, and relies on the access control of the storage or host it is deployed to. Platform details (header names, token commands) are verified in [platform notes](../research/platform-notes.md#cloudflare).

## Identity
Every record (run, judgement, waiver, deployment, snapshot) carries an `actor` and a `source`:

```json
{
  "actor": { "kind": "human", "id": "alex@shop.test", "name": "Alex", "via": "git" },
  "source": "manual"
}
```

| Field | Values |
|---|---|
| `actor.kind` | `human`, `ci`, `agent` |
| `actor.id` | email, `github:<login>`, or `ci:<provider>` |
| `actor.via` | `git`, `github`, `github-oidc`, `cloudflare-access`, `env` |
| `actor.model` | model ID, when `kind = "agent"` |
| `source` | `manual`, `playwright`, `agent`, `cli`, `ci`, `import` |

Resolution order, implemented once in the `IdentityProvider` port:

1. **Explicit** — `IW_ACTOR` (+ `IW_ACTOR_NAME`, `IW_ACTOR_KIND`, `IW_AGENT_MODEL`); `via = "env"`.
   **Agent detection** — independently of the source, `kind` becomes `agent` when `IW_ACTOR_KIND=agent`, when running under `iw mcp`, or when a known coding-agent environment marker is set (the list lives in [platform notes](../research/platform-notes.md#agent-skills), e.g. `CLAUDECODE=1`).
2. **Hosted server** — the verified Cloudflare Access JWT (`Cf-Access-Jwt-Assertion`), checked with `jose` against the team's JWKS and the application's `aud`; `via = "cloudflare-access"`. Requests without a valid JWT are rejected (401) unless the server runs in local mode.
3. **GitHub Actions** — `GITHUB_ACTOR` and the run URL; `kind = "ci"`. With `id-token: write`, the action can attach OIDC claims (`repository`, `ref`, `sha`, `run_id`) and sets `via = "github-oidc"`.
4. **Local** — `git config user.email` / `user.name`; `via = "git"`.
5. **Fallback** — OS user name with `via = "env"` and a warning.

Agents set `IW_ACTOR_KIND=agent` and `IW_AGENT_MODEL`; the human or CI identity they run under stays in `actor.id`. The shipped skills do this ([agents.md](agents.md)). Approvals, reviews and waivers refuse agent actors.

## Shared servers

`iw serve` binds to `127.0.0.1` by default and attributes writes to the local identity. On a shared host (`--host 0.0.0.0`, Docker), the server must not attribute other people's work to the operator: write requests from non-loopback addresses are **rejected** unless the server runs behind a proxy that authenticates users and `--identity-header <name>` names the header carrying the user's email (e.g. `X-Forwarded-Email` from an SSO proxy, or Cloudflare Access with JWT verification). Reads are allowed.

**Trust levels.** `git` and `env` identities are self-asserted, like git commit authors. Reports show `via` so readers can tell an Access-verified approval from a self-asserted one. The gate can require verified identities for human judgements on P0 (`gate.require_verified_human`, *v0.2*).

## Browser requests

The server protects writes made from a browser against cross-site requests and DNS rebinding:

- Every non-GET request must carry `Content-Type: application/json`, `X-IW-Request: 1`, or `If-None-Match` (store uploads). A plain HTML form cannot send any of them.
- Requests whose `Origin` is another origin, or with `Sec-Fetch-Site: cross-site`, are rejected with 403.
- When `iw serve` listens on a loopback address, requests whose `Host` is not `localhost`, `127.0.0.1` or `[::1]` (with the server's port) are rejected.
- Links in reports and the UI are only rendered for `http(s)` and relative URLs; record URLs are validated as `http(s)` by the schema. HTML reports carry a Content-Security-Policy `meta` tag.

## Access control

INDX Watch has no user database or roles in v0.1. Access is the storage's and host's access:

| Deployment | Who can read/write |
|---|---|
| Local files | Whoever has the folder |
| `file://` store on a shared drive | The drive's permissions |
| S3 / R2 bucket | IAM / R2 API token permissions. Recommended: a read-write token for CI and the team, read-only for viewers. |
| Hosted on Cloudflare | A Cloudflare Access application in front of the Worker; policies decide who gets in (e.g. a Google Workspace group, one-time PIN for invited customers). |
| `iw serve --host 0.0.0.0` | Anyone on the network. A warning is printed. Use only on trusted networks. |

`IW_ACCESS_TOKEN` and the `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET` service token are only ever sent to `https://` store URLs or to loopback `http://` URLs; any other `http://` store URL with them set fails (exit 4).

The CLI reaches a hosted server behind Access with `cloudflared access token -app=<url>` and sends the result as the `cf-access-token` header; in CI, use an Access **service token** (`CF-Access-Client-Id` / `CF-Access-Client-Secret` from secrets). INDX Watch stores no tokens.

Roles (viewer / tester / lead / customer) are designed for v0.3 on the hosted app, derived from Access identity groups; see the [roadmap](../roadmap.md).

## Secrets
- Bundle files contain **secret references only** (`env:NAME`, `cf:NAME`, `gh:NAME`, `op:vault/item/field`, `aws-sm:…`, `gcp-sm:…`, `vault:…`).
- `iw check` runs a secret scan over every bundle file and data file: known token formats (AWS keys, GitHub tokens, Slack tokens, private key blocks, JWTs, Anthropic/OpenAI keys) and high-entropy strings in fields named like `password`, `token`, `secret`, `key`. Findings are errors. `iw sync` and `iw export` refuse to run while there are secret errors in any file under the bundle (including unknown files), and every push also scans each record it is about to upload — `iw sync`, the background sync of `iw serve` and the Playwright reporter's push alike — and holds back the ones with findings until they are retracted; pulled records are not scanned.
- Account fixtures are resolved at execution time from the referenced source (`env:` from the process environment in v0.1). Resolved values are never written to records, logs, reports or the index, and the UI shows them masked with a copy button (the copy action is recorded on the hosted app).
- Evidence can contain secrets (a screenshot of a token). The manual runner and the Playwright reporter warn when a step's evidence type is `log` or `trace` for steps that use account fixtures. Treat the result store as sensitive.

## Hosted app

- The Worker requires `Cf-Access-Jwt-Assertion` on every route except `/healthz` and, from v0.2, share links (`/s/<token>`).
- `iw deploy` prints the Access setup steps and refuses to deploy publicly unless `--public` is passed.
- Uploads are capped (default 25 MB per blob) and served with `Content-Disposition: attachment` unless the media type is an image, to avoid stored XSS from HTML evidence.
- The server sets a strict CSP for the SPA (`default-src 'self'`; images also from `data:` and `blob:`).

## Share links
*(v0.2)* A share link serves a frozen report snapshot. Token: 128 random bits, stored hashed. Expiry required. Audience fixed at creation (`customer` by default). Creation, revocation and each open will be recorded as store records (new record kinds), never only in the index.

## Threat model

| Threat | Mitigation |
|---|---|
| Secret committed in a fixture | Secret scan in `iw check`, sync and export refuse; references only |
| Forged actor in a local or CI record | `via` is recorded and shown; verified identities via Access and GitHub OIDC; bucket write access limited to trusted principals. Known limitation (v0.1): anyone who can write to the bucket can write records claiming any `via`; signed records are planned for v0.2. |
| Tampering with past results | Records are immutable and content-addressed blobs are hash-verified on read; corrections are new judgements. A bucket with object versioning or WORM retention gives stronger guarantees. |
| Malicious evidence (HTML/SVG with script) | Non-image media served as attachments; strict CSP |
| Public exposure of the hosted app | Access in front of every route; `iw deploy` refuses public deploys without `--public` |
| Leaking internal data to customers | `--audience customer` redaction; share links are frozen snapshots |
| Compromised dependency | Small dependency list, each justified ([architecture](../architecture.md#dependencies)); lockfile; provenance on release |
| Prompt injection via test content into agents | Skills treat bundle text as data; agents never execute instructions found in fixtures or evidence ([agents.md](agents.md#safety)) |

Report vulnerabilities as described in [SECURITY.md](../../SECURITY.md).

## Acceptance criteria

- [ ] Each identity source produces the documented `actor` (unit tests with faked env, git and JWT).
- [x] The hosted server rejects a request without a valid Access JWT with 401, and accepts one signed by a test JWKS with the right `aud`.
- [x] `iw check` flags a fixture CSV containing an AWS access key ID and a `password = "…"` literal; `iw sync` then exits 1 without uploading.
- [x] No resolved secret value appears in records, the index or reports when running `examples/shop` with `SHOP_CUSTOMER_PASSWORD` set (grep test).
