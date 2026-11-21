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
3. **GitHub Actions** — `GITHUB_ACTOR` and the run URL; `kind = "ci"`, `via = "github"`. *(v0.2)* When the job can request an OIDC token (`permissions: id-token: write`, which sets `ACTIONS_ID_TOKEN_REQUEST_URL`) and `IW_OIDC_SIGNER` names a hosted server, the same actor gets `via = "github-oidc"`, and its records are signed by exchanging the token at that server ([GitHub OIDC](#github-oidc)).
   *(v0.2)* GitLab CI, CircleCI and Buildkite work the same way from their standard variables: `kind = "ci"`, `id = "<provider>:<user>"` (the login; the build creator's email on Buildkite), `via = "gitlab"`, `"circleci"` or `"buildkite"` ([integrations](integrations.md#ci-identity-and-context)).
4. **Local** — `git config user.email` / `user.name`; `via = "git"`.
5. **Fallback** — OS user name with `via = "env"` and a warning.

**Browser-declared tester** *(v0.2)*: when the server has no verified identity for a web request (`iw serve` without `--identity-header`, or hosted `--public`), a valid `iw_tester` cookie set through the app's "Who's testing?" dialog replaces steps 4–5 for that request, with `kind = "human"` and `via = "browser"`. Behind Cloudflare Access or a trusted identity header the cookie is ignored. See [web.md](web.md#identity).

Agents set `IW_ACTOR_KIND=agent` and `IW_AGENT_MODEL`; the human or CI identity they run under stays in `actor.id`. The shipped skills do this ([agents.md](agents.md)). Approvals, reviews and waivers refuse agent actors. In [workspace mode](sync.md#workspace-mode-v02) agents publish definition edits only as AI drafts: `iw sync` keeps an agent's other changes local, and the hosted editor writes an agent's edit with `origin = "ai"`, `status = "draft"` and an `[ai]` table, without `approved_by` and `approved_version`. Whoever may write through the app may edit definitions there, the same rule as uploads (with [roles](#roles), only a `lead`): on a hosted `--public` deploy that includes anyone who reaches it (as a browser-declared tester), so keep workspace-mode editing behind Cloudflare Access; `iw serve` attributes edits like its other writes ([shared servers](#shared-servers)). Approving a [visual baseline](concepts.md#visual-baselines) also refuses CI actors, and the model ignores `baseline` records whose actor is not `human`.

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
- **CI without a secret.** A CI job either signs with a key provisioned as a secret (anyone with that secret can sign records, scoped by the key's `via` list) or, on GitHub Actions, exchanges its OIDC token at the hosted server ([GitHub OIDC](#github-oidc)). Records written before signing was configured stay unverified.

### GitHub OIDC

*(v0.2, roadmap T-211b)* A GitHub Actions job gets a verifiable identity without a long-lived signing secret: the hosted server checks the job's OIDC ID token and signs the record with its own pinned key. Readers keep verifying only Ed25519 signatures by pinned keys, offline and long after GitHub rotates its token keys; the token itself never goes into a record.

- **Setup.** The Worker has `IW_SIGNING_KEY`, and its public key is pinned in `[[signing_keys]]` with `github-oidc` in its `via` list (or no list). `[hosting] oidc_repositories` in `project.toml` lists the repositories whose tokens it accepts, as `owner/name` (compared without case) or as the numeric repository ID (the `repository_id` claim, which survives renames and cannot be reused); `iw deploy` pins the list as the Worker variable `OIDC_REPOSITORIES`, never read from a snapshot. With no list or no `IW_SIGNING_KEY`, the endpoint answers 404. The job grants `permissions: id-token: write` and sets `IW_OIDC_SIGNER` to the server's URL.
- **Writer.** In GitHub Actions with `GITHUB_ACTOR`, `IW_OIDC_SIGNER` and `ACTIONS_ID_TOKEN_REQUEST_URL` set, and neither `IW_SIGNING_KEY` (which wins when set) nor `IW_ACTOR` (whose actor is `via = "env"`, so its records stay unsigned instead of being refused by the server), the CLI and the reporter resolve the actor `{ kind: "ci", id: "github:<GITHUB_ACTOR>", name: GITHUB_ACTOR, via: "github-oidc" }` and, for every record they write, request an ID token with the audience `indx-watch:<project id>` (reused until a minute before it expires) and send `POST <IW_OIDC_SIGNER>/api/sign` with `Authorization: Bearer <token>` and `{ "records": [record] }`. They keep their own record and take only the returned `sig`; a refused or failed exchange, or a malformed token or reply, fails that write (exit 4). `IW_OIDC_SIGNER` must be `https://` (or loopback `http://`); an Access service token (`CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET`) is sent along when set.
- **Server.** `POST /api/sign` takes the token instead of a Cloudflare Access identity (the Worker does not ask for `Cf-Access-Jwt-Assertion` on this route; at the Cloudflare edge, add an Access *Bypass* policy for `/api/sign` or give the job a service token). It verifies the token's signature against GitHub's JWKS (`https://token.actions.githubusercontent.com/.well-known/jwks`, fetched by an adapter behind the `OidcVerifier` port), the issuer `https://token.actions.githubusercontent.com`, the audience `indx-watch:<project id>` of the served project and the expiry (so the token is checked at write time), then requires the `repository` or `repository_id` claim to be pinned. Each record (at most 1000 per request, each valid under the record schema) must belong to the project, have the actor `via = "github-oidc"` with `id = "github:<actor claim>"` (`kind` may be `ci` or `agent`), and, when it has a `ci` context, `ci.repository` and `ci.run_id` equal to the `repository` and `run_id` claims. Any mismatch refuses the whole request (401 for a bad token, 403 otherwise). Accepted records are signed exactly as the server signs its own writes, so a record whose judgements claim another verified identity comes back unsigned. Response: `{ "records": [signed record] }`. The server stores nothing.
- **Limits.** Anyone who obtains a token within its lifetime (minutes) can get signatures for records with that job's actor; the token goes only to the server over https. Any workflow of a pinned repository, including on another branch, can sign; pin only repositories whose workflows you trust. Pull requests from forks get no OIDC token.

## Browser requests

The server protects writes made from a browser against cross-site requests and DNS rebinding:

- Every non-GET request must carry `Content-Type: application/json`, `X-IW-Request: 1`, or `If-None-Match` (store uploads). A plain HTML form cannot send any of them.
- Requests whose `Origin` is another origin, or with `Sec-Fetch-Site: cross-site`, are rejected with 403.
- When `iw serve` listens on a loopback address, requests whose `Host` is not `localhost`, `127.0.0.1` or `[::1]` (with the server's port) are rejected.
- Links in reports and the UI are only rendered for `http(s)` and relative URLs; record URLs are validated as `http(s)` by the schema. HTML reports carry a Content-Security-Policy `meta` tag.

## Access control

INDX Watch has no user database. Access is the storage's and host's access; on the hosted app, [roles](#roles) *(v0.3)* narrow what each signed-in person may do:

| Deployment | Who can read/write |
|---|---|
| Local files | Whoever has the folder |
| `file://` store on a shared drive | The drive's permissions |
| S3 / R2 bucket | IAM / R2 API token permissions. Recommended: a read-write token for CI and the team, read-only for viewers. |
| Hosted on Cloudflare | A Cloudflare Access application in front of the Worker; policies decide who gets in (e.g. a Google Workspace group, one-time PIN for invited customers). |
| `iw serve --host 0.0.0.0` | Anyone on the network. A warning is printed. Use only on trusted networks. |

`IW_ACCESS_TOKEN` and the `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET` service token are only ever sent to `https://` store URLs or to loopback `http://` URLs; any other `http://` store URL with them set fails (exit 4).

The CLI reaches a hosted server behind Access with `cloudflared access token -app=<url>` and sends the result as the `cf-access-token` header; in CI, use an Access **service token** (`CF-Access-Client-Id` / `CF-Access-Client-Secret` from secrets). INDX Watch stores no tokens.

## Roles

*(v0.3, roadmap T-301)* On the hosted app behind Cloudflare Access, `[hosting.roles]` in `project.toml` maps Access identities and groups to four roles ([bundle format](bundle-format.md#projecttoml)):

```toml
[hosting.roles]
lead = ["qa-leads@shop.test"]          # Access group emails, names or IDs, or user emails
tester = ["qa@shop.test", "ci:access:<client id>"]
viewer = ["Engineering"]
customer = ["uat@shop.test"]
default = "viewer"                     # optional: the role of a signed-in identity that matches nothing
```

- **Where roles apply.** Only on a Worker deployed with Access and a pinned role table. Without `[hosting.roles]`, on a `--public` deploy, and always on `iw serve` (a local single user, or a trusted proxy header without groups) every identity is `lead`, which is the v0.2 behavior.
- **Trust root.** `iw deploy` pins the table as the Worker variable `ROLES`, like `SIGNING_KEYS`; the Worker never reads roles from a bundle snapshot, because anyone who can write the store (or upload a bundle) could promote themselves. After changing roles, run `iw deploy` again. An invalid `ROLES` value lets nobody in.
- **Principals.** A request is matched by its actor ID (the Access email, or `ci:access:<client id>` for a service token) and by the `id`, `name` and `email` of each of its Access groups, all compared without case. The highest matching role wins, in the order lead, tester, viewer, customer. With no match, an identity that is the email `assignee` of a plan item is a `customer` ([customer UAT](#customer-uat)); otherwise it gets `default`, and with no `default` every route except the public ones (`/healthz`, `/api/sign`, `/s/*`) answers 403.
- **Group lookup.** Groups come from the Access `get-identity` endpoint (`https://<team>.cloudflareaccess.com/cdn-cgi/access/get-identity`, called with the already verified token as the `CF_Authorization` cookie) through the optional `groups(request)` method of the `IdentityProvider` port; the `cloudflare-access` adapter caches the answer per token for five minutes and asks only when roles are configured. A failed lookup (an error or a non-2xx answer) means no groups for that request, so the identity falls back to its email entries or `default`; it is kept for five seconds only, so a transient failure does not drop a role for five minutes. The token's own claims are not used for groups: Access adds a `groups` claim only for custom IdP claims and trims large ones ([platform notes](../research/platform-notes.md#access)).

| Request | viewer | tester | lead | customer |
|---|---|---|---|---|
| Read the app and the API (`GET`), reports | ✓ | ✓ | ✓ | assigned items only |
| `GET /api/store/*`, `/api/snapshots`, `/api/shares` | ✓ | ✓ | ✓ | — |
| Manual runs and evidence (`POST /api/runs`, `POST /api/blobs`) | — | ✓ | ✓ | assigned test cases |
| Reviews (`POST /api/runs/:id/judgements`) | — | ✓ | ✓ | — |
| Store writes (`PUT /api/store/objects/*`: `iw sync`, the reporter) | — | ✓ without `waiver`, `baseline` or `bundle` records | ✓ | — |
| Definition edits in workspace mode (`PATCH /api/test-cases/:key`) | — | — | ✓ | — |
| Baselines, bundle uploads, share links, everything else | — | — | ✓ | — |
| `/mcp` | read tools | also `record_run` | also `new` | — |

The server enforces this table in one middleware before any route (Node and Workers run the same `createApp`), and `/mcp` checks the tool. Agents keep their own limits on top ([hosted app](#hosted-app)). `GET /api/project` returns the `role` and `can.run`, `can.review` and `can.approve`, and `can.upload`, `can.share` and `can.edit` are false below `lead`; the web app hides actions the role cannot use ([web.md](web.md#identity)), but the server never relies on that. Editing definitions in workspace mode is a management action like an upload, so it needs `lead`; an agent under a `lead` identity still saves only AI drafts ([identity](#identity)).

**Assigned items.** A plan item is assigned to a customer when its `assignee` equals the customer's email, or is `group:<name>` with `<name>` equal to the `id`, `name` or `email` of one of the customer's Access groups (without case). For a customer the server builds every response from a model restricted to those items (`customerModel()` in core): the test cases of assigned items, the use cases and features above them with only the criteria those test cases cover, the fixtures they use, the runs, judgements, waivers and baselines of those test cases, and the plans with only the assigned items; no deployments, snapshots or share records. Status, the gate and reports are computed by the same functions over that model, so they describe only the assigned items, and reports a customer requests are always `customer` audience. `GET /api/project` shows a customer no load problems, snapshot or clone source, and `GET /api/blobs/<sha>` serves a customer only evidence of the runs they see or blobs uploaded through that server instance. A customer sees an assigned test case in full (they run it), including the values of the fixtures it uses and the environments' `base_url`, which they test against, and other people's runs of it with what customer reports redact ([reports.md](reports.md#sharing-with-customers)) removed: run and step notes, judgement reasons (and the decision reason, which quotes them), CI links, and environment guides and access methods; other people's emails become their display names or "QA team" in runs, judgements, waivers and baselines, while the customer's own runs keep their email. A customer may record a run of an assigned test case in any release and environment: the plan's `release` and the item's `environment` are not enforced.

**Limits.** Roles guard the server, not the bucket: whoever can write the store directly is not bound by them ([signed records](#signed-records) still mark forged verified identities).

### Customer UAT

*(v0.3, roadmap T-302)* A lead invites a customer by email to the plan items the customer should accept; the customer signs in with an Access one-time PIN and runs only those items.

- **Invite.** `iw invite <email> --plan <PLAN-n> [--items TC-n,…]` in a working copy ([cli.md](cli.md#iw-invite-email)), or `POST /api/plans/<PLAN-n>/invites` with `{ "email", "items"? }` on the hosted app in [workspace mode](sync.md#workspace-mode-v02). Both set `assignee = "<email>"` on the selected items (every item of the plan without `items`; an item assigned to someone else is reassigned; a test case that is not in the plan is refused) and then add the email to the Access policy. The CLI writes the plan file through `formatToml()` (commit it, or `iw sync` it in workspace mode); the hosted app appends a `file` record for the plan with the lead's Access identity, like a [definition edit](web.md#editing-in-workspace-mode). On a Worker whose definitions come from git the route answers 409: run `iw invite` and publish the definitions. Only a person may invite (agents get 403 or exit 2), and on the hosted app only a `lead`.
- **Revoke.** `iw invite <email> --plan <PLAN-n> --revoke [--items …]`, or `DELETE /api/plans/<PLAN-n>/invites/<email>`: the email is removed from the `assignee` of those items (every item of the plan without `items`), and from the Access policy once no plan item is assigned to it any more.
- **Role.** An identity that matches no `[hosting.roles]` entry but is the email `assignee` of a plan item is a `customer`, ahead of `default` (`roleOf()` in core). An invited customer therefore needs no role entry and no redeploy, and loses the role when uninvited: a customer whose Access session is still valid then gets 403 (or the `default` role). Assignments come from the definitions, which store writers can change, so this only ever gives the lowest role to an identity Access already let in; the Access policy stays the gate. A teammate who is an assignee by email and would otherwise get only `default` becomes a customer too, so list teammates explicitly or through their groups. Invites need roles: without a pinned role table everyone Access lets in is `lead`, so the API answers 409 and `iw invite` exits 3 (`INVALID_CONFIG`) when `project.toml` has no `[hosting.roles]`.
- **Access policy.** The email goes into one reusable Access policy through the `AccessPolicy` port (`allow(email)`, `revoke(email)`; the `cloudflareAccessPolicy` adapter in `packages/store`, a fake in tests; CI never calls Cloudflare). The adapter reads the policy with `GET https://api.cloudflare.com/client/v4/accounts/<account id>/access/policies/<policy id>` and writes it back with `PUT` to the same URL, sending `name`, `decision`, `include`, `exclude`, `require` and `session_duration` as read, with `{ "email": { "email": "<email>" } }` added to (or removed from) `include`. Emails compare without case, and adding a present email or removing an absent one sends no `PUT`. It is configured by `IW_ACCESS_POLICY = "<account id>/<policy id>"` and `CLOUDFLARE_API_TOKEN` (a token with the *Access: Apps and Policies Write* permission): Worker secrets on the hosted app, environment variables for the CLI. Without them the assignment is still written and the answer says `access: "manual"`: add or remove the email in the dashboard. A failed API call fails the request after the assignment was written (502, exit 4); running the invite again is safe.
- **Sign-in.** The customer opens the app's URL, enters the invited email on the Access login page and types the one-time PIN Access mails them. One-time PIN is an Access login method enabled once for the application ([guide](../guides/self-host-cloudflare.md#invite-customers-uat)); INDX Watch sends no mail.
- **Testing.** The app opens on the customer's assigned items ([web.md](web.md#customer-view)) and runs them in the manual runner. Runs carry the Access identity (`kind = "human"`, `via = "cloudflare-access"`; the role is not recorded) and are signed when the Worker has `IW_SIGNING_KEY`. The lead sees them like every run, and a `customer` report of the plan shows the results.

## Secrets
- Bundle files contain **secret references only** (`env:NAME`, `cf:NAME`, `gh:NAME`, `op:vault/item/field`, `aws-sm:…`, `gcp-sm:…`, `vault:…`).
- `iw check` runs a secret scan over every bundle file and data file: known token formats (AWS keys, GitHub tokens, Slack tokens, private key blocks, JWTs, Anthropic/OpenAI keys, `IW_SIGNING_KEY` secrets from `iw keygen`) and high-entropy strings in fields named like `password`, `token`, `secret`, `key`. Findings are errors. `iw sync` and `iw export` refuse to run while there are secret errors in any file under the bundle (including unknown files), and every push also scans each record it is about to upload — `iw sync`, the background sync of `iw serve` and the Playwright reporter's push alike — and holds back the ones with findings until they are retracted; pulled records are not scanned, and neither is a record's `sig` (a random signature can look like an API key).
- Account fixtures are resolved at execution time from the referenced source (`env:` from the process environment in v0.1). Resolved values are never written to records, logs, reports or the index, and the UI shows them masked with a copy button (the copy action is recorded on the hosted app).
- Evidence can contain secrets (a screenshot of a token). The manual runner and the Playwright reporter warn when a step's evidence type is `log` or `trace` for steps that use account fixtures. Treat the result store as sensitive.

## Hosted app

- The Worker requires `Cf-Access-Jwt-Assertion` on every route except `/healthz`, `POST /api/sign` (which requires a GitHub OIDC token instead, [GitHub OIDC](#github-oidc)) and, from v0.2, share links (`/s/<token>`, [below](#share-links)).
- The MCP endpoint `/mcp` is one of those routes: it resolves the identity exactly like `/api`, and its writes record that identity with `kind = "agent"` ([agents.md](agents.md#mcp-server)). It has no `approve`, `review` or `waive` tool, and `new` only writes AI drafts, at paths inside the bundle.
- `iw deploy` prints the Access setup steps and refuses to deploy publicly unless `--public` is passed.
- Uploads are capped (default 25 MB per blob) and served with `Content-Disposition: attachment` unless the media type is an image, to avoid stored XSS from HTML evidence.
- The server sets a strict CSP for the SPA (`default-src 'self'`; images also from `data:` and `blob:`).

## Share links
*(v0.2)* A share link serves a frozen report snapshot; how links are created, opened and revoked is in [reports.md](reports.md#share-links).

- **Token**: 128 random bits in the URL `/s/<token>`; records store only its SHA-256. Expiry is required (default 7 days, max 90). The audience is fixed at creation (`customer` by default).
- **Who may create and revoke**: only a person signed in through Cloudflare Access (`kind = "human"`, `via = "cloudflare-access"`) on the hosted app. Agents, CI, declared testers, the anonymous identity of a `--public` deploy and `iw serve` get 403.
- **Public path**: `/s/*` is the only path besides `/healthz` where the server resolves no identity. It serves nothing but the snapshot blob of an active link (unknown, expired and revoked tokens: 404), with the report CSP, `Cache-Control: no-store`, `Referrer-Policy: no-referrer` and `X-Robots-Tag: noindex`. Cloudflare Access must let it through: add a separate Access application for `/s/*` with a Bypass policy ([guide](../guides/self-host-cloudflare.md#3-put-cloudflare-access-in-front)); `iw deploy` routes `/s/*` to the Worker before static assets.
- **Audit**: creation, revocation and each open are `share` records written by the server ([sync.md](sync.md#other-records)), never only in the index. The store endpoint (`PUT /api/store/objects/*`) refuses log objects with `share` records, and only `create` and `revoke` records by a person signed in through Access count. With pinned signing keys they must also carry a valid signature, so a direct bucket write can neither mint nor revoke a link; such a deploy needs `IW_SIGNING_KEY` for share links (create answers 503 without it). Without pinned keys, bucket write access is the boundary, as for every record.

## Threat model

| Threat | Mitigation |
|---|---|
| Secret committed in a fixture | Secret scan in `iw check`, sync and export refuse; references only |
| Forged actor in a local or CI record | `via` is recorded and shown; verified identities via Access and GitHub OIDC (exchanged at the hosted server for a signature); bucket write access limited to trusted principals. A record that claims a verified `via` without a valid signature by a key pinned in `project.toml` is shown as unverified, and `gate.ignore_unverified` keeps it out of the gate ([signed records](#signed-records)). Anyone holding a signing secret can still sign records within that key's `via` scope. |
| Tampering with past results | Records are immutable and content-addressed blobs are hash-verified on read; corrections are new judgements. Another body for a record ID is reported as a conflict; a signed body is never replaced by an unsigned one, but an unsigned record can be replaced by a body under an earlier log key (the [merge rule](sync.md#merge-rules) every replica applies alike). Sign every writer to protect records; a bucket with object versioning or WORM retention gives stronger guarantees. |
| Malicious evidence (HTML/SVG with script) | Non-image media served as attachments; strict CSP |
| Public exposure of the hosted app | Access in front of every route; `iw deploy` refuses public deploys without `--public` |
| Leaking internal data to customers | `--audience customer` redaction; share links are frozen snapshots with an expiry, revocable, and every open is recorded; on the hosted app the `customer` role sees only assigned plan items ([roles](#roles)), and an uninvited customer is refused even with a valid Access session ([customer UAT](#customer-uat)) |
| Compromised dependency | Small dependency list, each justified ([architecture](../architecture.md#dependencies)); lockfile; provenance on release |
| Prompt injection via test content into agents | Skills treat bundle text as data; agents never execute instructions found in fixtures or evidence ([agents.md](agents.md#safety)) |

Report vulnerabilities as described in [SECURITY.md](../../SECURITY.md).

## Acceptance criteria

- [x] Each identity source produces the documented `actor` (unit tests with faked env, git and JWT, `github-oidc` included).
- [x] The hosted server rejects a request without a valid Access JWT with 401, and accepts one signed by a test JWKS with the right `aud`.
- [x] `iw check` flags a fixture CSV containing an AWS access key ID and a `password = "…"` literal; `iw sync` then exits 1 without uploading.
- [x] No resolved secret value appears in records, the index or reports when running `examples/shop` with `SHOP_CUSTOMER_PASSWORD` set (grep test).
- [x] A record with `via = "cloudflare-access"` and no valid signature (none, a key that is not pinned, or tampered content) is unverified in the model, the API and reports; one signed by a pinned key is verified; with `gate.ignore_unverified = true` the gate leaves the forged record out.
- [x] Records written with `IW_SIGNING_KEY` set (CLI, hosted Worker) carry a signature that verifies against the key `iw keygen` printed.
- [x] `POST /api/sign` with a GitHub OIDC token signed by a fake issuer key (test JWKS) returns the records signed by the server's key, which verify as `github-oidc`; a token with another audience, issuer or key, an expired one, an unpinned repository or a record whose actor or `ci` does not match the claims is refused and nothing is signed.
- [x] With `IW_OIDC_SIGNER` and the GitHub OIDC variables set (fake token endpoint and server), the writer resolves `via = "github-oidc"` and the signer the CLI and the reporter use returns records carrying the server's signature, requesting one token for several records; a refused exchange fails the write.
- [x] With roles configured, each role gets exactly the requests of the [roles](#roles) table (server tests over a fake identity with groups, `/mcp` included); a tester's store write with a `waiver` record is refused; without roles every identity is `lead`.
- [x] A customer sees only the test cases of plan items assigned to them (by email or `group:`) in specs, status, test cases, runs, plans, fixtures, evidence and reports, and cannot record a run of another test case.
- [x] The `cloudflare-access` adapter reads group IDs, names and emails from a fake `get-identity` endpoint with the token as the `CF_Authorization` cookie, once per token; a failed lookup gives no groups.
- [x] End to end on the Worker with a fake Access API and a fake Access JWT issuer (local JWKS): a lead's invite assigns plan items and the fake policy receives the email; the customer's JWT then sees only those items and records a run, which the lead sees; after the revoke the policy no longer lists the email and the customer gets 403. A run against a real Cloudflare Access policy is a manual step.
- [x] `iw invite` writes the plan through `formatToml()` and calls a fake `AccessPolicy`; `--revoke` keeps the policy entry while another item is still assigned to the email; without `[hosting.roles]` it exits 3.
- [x] On the Worker, `/s/<token>` of an active share link answers without an Access JWT, while `/api/*` still answers 401; the store endpoint refuses a log object with a `share` record (server and Worker tests).
