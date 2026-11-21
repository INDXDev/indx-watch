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
| `actor.id` | email, or `<provider>:<login>` in CI (`github:octocat`, `gitlab:alex`; Buildkite uses the build creator's email) |
| `actor.via` | `git`, `github`, `gitlab`, `circleci`, `buildkite`, `github-oidc`, `cloudflare-access`, `env`, `browser` |
| `actor.model` | model ID, when `kind = "agent"` |
| `source` | `manual`, `playwright`, `agent`, `cli`, `ci`, `import` |

Resolution order, implemented once in the `IdentityProvider` port:

1. **Explicit** — `IW_ACTOR` (+ `IW_ACTOR_NAME`, `IW_ACTOR_KIND`, `IW_AGENT_MODEL`); `via = "env"`.
   **Agent detection** — independently of the source, `kind` becomes `agent` when `IW_ACTOR_KIND=agent`, when running under `iw mcp`, or when a known coding-agent environment marker is set (the list lives in [platform notes](../research/platform-notes.md#agent-skills), e.g. `CLAUDECODE=1`).
2. **Hosted server** — the verified Cloudflare Access JWT (`Cf-Access-Jwt-Assertion`), checked with `jose` against the team's JWKS and the application's `aud`; `via = "cloudflare-access"`. Requests without a valid JWT are rejected (401) unless the server runs in local mode.
3. **GitHub Actions** — `GITHUB_ACTOR` and the run URL; `kind = "ci"`, `via = "github"`. *(v0.2)* With `id-token: write`, the action will attach OIDC claims (`repository`, `ref`, `sha`, `run_id`) and set `via = "github-oidc"`; the value is reserved in the schema and shown as verified, but v0.1 never produces it.
   *(v0.2)* GitLab CI, CircleCI and Buildkite work the same way from their standard variables: `kind = "ci"`, `id = "<provider>:<user>"` (the login; the build creator's email on Buildkite), `via = "gitlab"`, `"circleci"` or `"buildkite"` ([integrations](integrations.md#ci-identity-and-context)).
4. **Local** — `git config user.email` / `user.name`; `via = "git"`.
5. **Fallback** — OS user name with `via = "env"` and a warning.

**Browser-declared tester** *(v0.2)*: when the server has no verified identity for a web request (`iw serve` without `--identity-header`, or hosted `--public`), a valid `iw_tester` cookie set through the app's "Who's testing?" dialog replaces steps 4–5 for that request, with `kind = "human"` and `via = "browser"`. Behind Cloudflare Access or a trusted identity header the cookie is ignored. See [web.md](web.md#identity).

Agents set `IW_ACTOR_KIND=agent` and `IW_AGENT_MODEL`; the human or CI identity they run under stays in `actor.id`. The shipped skills do this ([agents.md](agents.md)). Approvals, reviews and waivers refuse agent actors.

## Shared servers

`iw serve` binds to `127.0.0.1` by default and attributes writes to the local identity. On a shared host (`--host 0.0.0.0`, Docker), the server must not attribute other people's work to the operator: write requests from non-loopback addresses are **rejected** unless the server runs behind a proxy that authenticates users and `--identity-header <name>` names the header carrying the user's email (e.g. `X-Forwarded-Email` from an SSO proxy, or Cloudflare Access with JWT verification). Reads are allowed.

**Trust levels.** `git`, `env` and `browser` identities are self-asserted, like git commit authors. Reports show `via` so readers can tell an Access-verified approval from a self-asserted one. A record whose `via` claims a verified source (`cloudflare-access`, `github-oidc`, `github`, `gitlab`, `circleci`, `buildkite`) is only shown as verified when it carries a valid signature ([signed records](#signed-records)). The gate can require verified identities for human judgements on P0 (`gate.require_verified_human`, *v0.2*).

## Signed records

*(v0.2, roadmap T-211)* Anyone with write access to the store bucket can append a log object, so a record's `actor.via` alone proves nothing. Writers that hold a signing key sign what they write; readers check the signature against keys pinned in the bundle.

- **Algorithm.** Ed25519 through WebCrypto (Node ≥ 22.13 and Workers; no extra dependency). The signed bytes are `indx-watch/record/v1\n` followed by the [canonical record JSON](sync.md#records) of the record without its `sig` field. The signature goes into the record's optional `sig` field: `{ "alg": "Ed25519", "kid": "<key id>", "value": "<base64url signature>" }`.
- **Keys.** `iw keygen [--kid <id>] [--via <list>]` creates a key pair ([cli.md](cli.md#iw-keygen)). The **secret** (`iwsk1:<kid>:<base64url PKCS#8>`) goes into the `IW_SIGNING_KEY` environment variable or secret of the writer, never into files. The **public key** goes into `project.toml` as a `[[signing_keys]]` entry (`kid`, `public_key`, optional `via` limiting which verified `via` values the key may vouch for). Trust comes only from the bundle, which is reviewed through git: a key published in the bucket would prove nothing, because whoever can forge records there could publish a key too. For the same reason the hosted Worker never takes keys from a bundle snapshot (anyone who can write the store, including through a browser upload, can publish one): `iw deploy` pins the `[[signing_keys]]` of the local `project.toml` as the Worker variable `SIGNING_KEYS`, and only those verify. A Worker deployed without keys trusts none, and the problems banner warns when the newest snapshot lists keys the deploy did not pin; after adding or rotating a key, run `iw deploy` again. To rotate, add the new key, switch the secret, and remove the old entry once its records no longer matter (removing it turns them unverified).
- **Who signs.** Every writer signs when `IW_SIGNING_KEY` is set: the hosted Worker (`wrangler secret put IW_SIGNING_KEY`) and `iw serve` for the records they write, and the CLI (`iw record`, `iw review`, `iw waive`, `iw sync --snapshot`, `iw push`, …) and the Playwright reporter in CI (`IW_SIGNING_KEY: ${{ secrets.IW_SIGNING_KEY }}` in the job's `env`). Records pulled from a store are never re-signed. A writer vouches only for the identity it resolved itself: a record whose judgements claim another verified identity (for example taken from `iw record --from`) is written unsigned, so it shows as unverified. The key is read when a record is signed: a malformed `IW_SIGNING_KEY` (also broken key material) fails that write (exit 3), not reads, `iw serve` startup or a pull-only sync.
- **What is verified.** A record is **unverified** when its `actor.via`, or the `by.via` of a judgement in it, is `cloudflare-access`, `github-oidc`, `github`, `gitlab`, `circleci` or `buildkite`, and it has no valid signature by a pinned key allowed to vouch for every such `via` (every pinned key with the signature's `kid` is tried). A signature has one spelling: a `value` that is not the canonical base64url of its 64 bytes does not verify. Verification results are cached per process (Worker isolate) by the exact pinned keys and record bytes, so model rebuilds do not re-verify; a forged body that copies a record's ID and `sig` is still checked. Records that only claim self-asserted sources (`git`, `env`, `browser`) are never marked: they claim nothing to verify. Unverified records keep working — they count in status, the UI and reports — but the web app shows an "unverified" badge in place of the ✓ ([web.md](web.md#identity)), reports add "· unverified" to the run log's actor ([reports.md](reports.md#rendering-rules)), and the API flags them (`unverified` on `RunSummary`, `SnapshotSummary` and `RunDetail`).
- **Merges.** A body signed by a pinned key wins over an unsigned body with the same record ID whatever their log keys ([merge rules](sync.md#merge-rules)), so a direct bucket writer cannot overwrite a signed record by choosing an earlier key.
- **Schema changes.** The signed bytes are the record as the current schema parses it, so a new record field must be optional without a default (a `.default()` would add the field to old records and break their signatures).
- **Gate.** With `[gate] ignore_unverified = true`, `evaluateGate()` evaluates the gate as if unverified records (and the judgements in them) did not exist ([concepts](concepts.md#readiness-gate)). Status, the UI and reports still show them, marked.
- **Not implemented yet.** GitHub OIDC signing — exchanging the job's OIDC token (`id-token: write`) for a short-lived signature, so CI needs no long-lived secret — is planned. Today CI signs with a key provisioned as a secret; anyone with that secret can sign records, scoped by the key's `via` list. Records written before signing was configured stay unverified.

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
- `iw check` runs a secret scan over every bundle file and data file: known token formats (AWS keys, GitHub tokens, Slack tokens, private key blocks, JWTs, Anthropic/OpenAI keys, `IW_SIGNING_KEY` secrets from `iw keygen`) and high-entropy strings in fields named like `password`, `token`, `secret`, `key`. Findings are errors. `iw sync` and `iw export` refuse to run while there are secret errors in any file under the bundle (including unknown files), and every push also scans each record it is about to upload — `iw sync`, the background sync of `iw serve` and the Playwright reporter's push alike — and holds back the ones with findings until they are retracted; pulled records are not scanned, and neither is a record's `sig` (a random signature can look like an API key).
- Account fixtures are resolved at execution time from the referenced source (`env:` from the process environment in v0.1). Resolved values are never written to records, logs, reports or the index, and the UI shows them masked with a copy button (the copy action is recorded on the hosted app).
- Evidence can contain secrets (a screenshot of a token). The manual runner and the Playwright reporter warn when a step's evidence type is `log` or `trace` for steps that use account fixtures. Treat the result store as sensitive.

## Hosted app

- The Worker requires `Cf-Access-Jwt-Assertion` on every route except `/healthz` and, from v0.2, share links (`/s/<token>`).
- The MCP endpoint `/mcp` *(v0.2)* is one of those routes: it resolves the identity exactly like `/api`, and its writes record that identity with `kind = "agent"` ([agents.md](agents.md#mcp-server)). It has no `approve`, `review` or `waive` tool, and `new` only writes AI drafts.
- `iw deploy` prints the Access setup steps and refuses to deploy publicly unless `--public` is passed.
- Uploads are capped (default 25 MB per blob) and served with `Content-Disposition: attachment` unless the media type is an image, to avoid stored XSS from HTML evidence.
- The server sets a strict CSP for the SPA (`default-src 'self'`; images also from `data:` and `blob:`).

## Share links
*(v0.2)* A share link serves a frozen report snapshot. Token: 128 random bits, stored hashed. Expiry required. Audience fixed at creation (`customer` by default). Creation, revocation and each open will be recorded as store records (new record kinds), never only in the index.

## Threat model

| Threat | Mitigation |
|---|---|
| Secret committed in a fixture | Secret scan in `iw check`, sync and export refuse; references only |
| Forged actor in a local or CI record | `via` is recorded and shown; verified identities via Access (and GitHub OIDC from v0.2); bucket write access limited to trusted principals. A record that claims a verified `via` without a valid signature by a key pinned in `project.toml` is shown as unverified, and `gate.ignore_unverified` keeps it out of the gate ([signed records](#signed-records)). Anyone holding a signing secret can still sign records within that key's `via` scope. |
| Tampering with past results | Records are immutable and content-addressed blobs are hash-verified on read; corrections are new judgements. Another body for a record ID is reported as a conflict; a signed body is never replaced by an unsigned one, but an unsigned record can be replaced by a body under an earlier log key (the [merge rule](sync.md#merge-rules) every replica applies alike). Sign every writer to protect records; a bucket with object versioning or WORM retention gives stronger guarantees. |
| Malicious evidence (HTML/SVG with script) | Non-image media served as attachments; strict CSP |
| Public exposure of the hosted app | Access in front of every route; `iw deploy` refuses public deploys without `--public` |
| Leaking internal data to customers | `--audience customer` redaction; share links are frozen snapshots |
| Compromised dependency | Small dependency list, each justified ([architecture](../architecture.md#dependencies)); lockfile; provenance on release |
| Prompt injection via test content into agents | Skills treat bundle text as data; agents never execute instructions found in fixtures or evidence ([agents.md](agents.md#safety)) |

Report vulnerabilities as described in [SECURITY.md](../../SECURITY.md).

## Acceptance criteria

- [x] Each identity source produces the documented `actor` (unit tests with faked env, git and JWT; `github-oidc` is v0.2).
- [x] The hosted server rejects a request without a valid Access JWT with 401, and accepts one signed by a test JWKS with the right `aud`.
- [x] `iw check` flags a fixture CSV containing an AWS access key ID and a `password = "…"` literal; `iw sync` then exits 1 without uploading.
- [x] No resolved secret value appears in records, the index or reports when running `examples/shop` with `SHOP_CUSTOMER_PASSWORD` set (grep test).
- [x] A record with `via = "cloudflare-access"` and no valid signature (none, a key that is not pinned, or tampered content) is unverified in the model, the API and reports; one signed by a pinned key is verified; with `gate.ignore_unverified = true` the gate leaves the forged record out.
- [x] Records written with `IW_SIGNING_KEY` set (CLI, hosted Worker) carry a signature that verifies against the key `iw keygen` printed.
