# Self-host on Cloudflare

`iw deploy` puts the same server and web UI that `iw serve` runs locally on Cloudflare Workers. Results go to an R2 bucket (the store), the query index lives in D1, and Cloudflare Access decides who gets in. Your team then syncs with `iw sync` against the Worker's URL and opens the UI in a browser. The command reference is [cli.md](../spec/cli.md#iw-deploy); the security model is [security.md](../spec/security.md#hosted-app).

```mermaid
flowchart LR
  dev["iw sync (laptop, CI)"] -- "cf-access-token / service token" --> access["Cloudflare Access"]
  browser["Browser"] --> access
  access -- "Cf-Access-Jwt-Assertion" --> worker["Worker (same server as iw serve)"]
  worker --> r2[("R2: store")]
  worker --> d1[("D1: index")]
```

## Prerequisites

- A Cloudflare account. The Free plan works for a small team; Workers Paid is recommended because the Free CPU limit per request is tight for large bundles ([limits](../research/platform-notes.md#limits)).
- A Cloudflare Zero Trust organization. Its **team name** is the `<team>` in `<team>.cloudflareaccess.com` (shown under Zero Trust → Settings).
- Node ≥ 22.13 and the `indx-watch` package (`npx indx-watch …` works).
- `wrangler` 4. `iw deploy` uses `wrangler` from your `PATH`, or runs `npx --yes wrangler@4` when it is missing. Log in once with `npx wrangler login`, or set `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (start from the "Edit Cloudflare Workers" token template and add D1 Edit and Workers R2 Storage Edit).
- `cloudflared` on the machines of people who use the CLI against the hosted server ([Cloudflare docs](https://developers.cloudflare.com/cloudflare-one/tutorials/cli/)).

## Configure `[hosting]`

Add a `[hosting]` table to `.indx-watch/project.toml` (from [`examples/shop`](../../examples/shop/.indx-watch/project.toml)):

```toml
[hosting]
provider = "cloudflare"
name = "shop-watch"        # Worker name → https://shop-watch.<your-subdomain>.workers.dev
r2_bucket = "shop-watch"   # default: name
d1_database = "shop-watch" # default: name
access_team = "example"    # your Zero Trust team name
# access_aud = "…"         # filled in after the Access application exists (step 3 below)
```

| Key                        | Required               |                                                                                                 |
| -------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------- |
| `provider`                 | yes                    | Only `cloudflare` in v0.1                                                                       |
| `name`                     | yes                    | Worker name: lowercase letters, digits and `-`. `--name` overrides it.                          |
| `r2_bucket`, `d1_database` | no                     | Default to `name`. Existing resources with these names are reused.                              |
| `access_team`              | yes, unless `--public` | Team name of your Zero Trust organization                                                       |
| `access_aud`               | after the first deploy | The Access application's Audience (AUD) tag. Until it is set, the Worker rejects every request. |
| `oidc_repositories`        | no                     | *(v0.2)* GitHub repositories (`owner/name` or numeric ID) whose Actions jobs may get records signed by the Worker ([CI signing with GitHub OIDC](#ci-signing-with-github-oidc)). |
| `roles`                    | no                     | *(v0.3)* `[hosting.roles]`: Access emails or groups per role (`lead`, `tester`, `viewer`, `customer`, optional `default`). Without it everyone Access lets in is `lead` ([roles](../spec/security.md#roles)). Run `iw deploy` again after changing it. |

Nothing in `[hosting]` is secret. Never put API tokens in `project.toml`.

## 1. Preview the plan

```console
$ npx indx-watch deploy --dry-run
Cloudflare Access is not finished: [hosting].access_aud is empty, so the Worker rejects every request until you set it.
  1. Cloudflare dashboard → Zero Trust → Access → Applications → Add an application → Self-hosted.
  …
Dry run: nothing was changed. Commands:
  wrangler r2 bucket create shop-watch
  wrangler d1 create shop-watch
  wrangler deploy --config /work/shop/.indx-watch/cache/deploy/wrangler.jsonc
```

`--dry-run` only reads: it runs `wrangler whoami`, `wrangler d1 list --json`, `wrangler r2 bucket info <bucket> --json` and `wrangler deployments list --name <worker> --json`, then prints the resources and the exact commands a real deploy would run. Resources that already exist are not created again, so the list gets shorter on later deploys. With `--json` the plan is printed as `{ "resources": [...], "commands": [...], "url": null }`.

It also writes the generated Wrangler configuration to `.indx-watch/cache/deploy/wrangler.jsonc` (`cache/` is git-ignored), so you can read exactly what will be deployed:

| Setting               | Value                                                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `main`                | The Worker bundle shipped in the `indx-watch` package                                                                                             |
| `assets`              | The web UI build, binding `ASSETS`, `not_found_handling: "single-page-application"`, `run_worker_first: ["/api/*", "/healthz", "/mcp", "/mcp/*", "/s/*"]` |
| `r2_buckets`          | Binding `STORE` → `r2_bucket`                                                                                                                     |
| `d1_databases`        | Binding `DB` → `d1_database` (with its ID)                                                                                                        |
| `vars`                | `ACCESS_TEAM`, `ACCESS_AUD`, `SIGNING_KEYS`, `OIDC_REPOSITORIES` and `ROLES` when configured (and `PUBLIC = "true"` only with `--public`)               |
| `triggers.crons`      | `["* * * * *"]`: once a minute the Worker picks up new store objects into its index                                                               |
| `compatibility_flags` | `["nodejs_compat"]`                                                                                                                               |

Do not edit the file: it is rewritten on every deploy. Change `[hosting]` instead.

## 2. Deploy

```console
$ npx indx-watch deploy
```

The command creates the missing R2 bucket and D1 database, fills the database ID into the configuration, runs `wrangler deploy` and prints the URL (`https://shop-watch.<your-subdomain>.workers.dev`). Running it again is safe: it only deploys a new version.

If `wrangler` is not logged in, `iw deploy` stops before changing anything with exit code 4 (`EXTERNAL_TOOL`). Without `access_team` it refuses with exit code 3, unless you pass `--public`. Do not use `--public` for anything but a throwaway demo with sample data: anyone with the URL can read and write.

## 3. Put Cloudflare Access in front

INDX Watch has no login of its own. The Worker checks the `Cf-Access-Jwt-Assertion` header that Cloudflare Access adds, against your team's keys and the application's AUD tag.

1. Cloudflare dashboard → **Zero Trust → Access → Applications → Add an application → Self-hosted**.
2. **Application domain**: `shop-watch.<your-subdomain>.workers.dev`, or the custom domain you attached to the Worker. (Alternative: **Workers & Pages → shop-watch → Settings → Domains & Routes**, enable Cloudflare Access for `workers.dev`; it shows the AUD tag in a dialog.)
3. Add policies (next section).
4. Open the application's **Overview / Additional settings** and copy the **Application Audience (AUD) Tag**.
5. Put it in `project.toml` and deploy again:

   ```toml
   [hosting]
   access_aud = "<the AUD tag from step 4>"
   ```

   ```console
   $ npx indx-watch deploy
   Cloudflare Access: team example.cloudflareaccess.com, audience set. Requests without a valid Access token get 401.
   ```

The Worker lets only `/healthz` and report share links (`/s/<token>`) through without a valid token. Access itself still covers both; to monitor `/healthz` from outside, add a separate Access application for that path with a Bypass policy. To let customers open [share links](../spec/reports.md#share-links), add one more Access application for the path `/s/*` with a Bypass policy: the Worker serves only frozen report snapshots of active links there. If `project.toml` pins `[[signing_keys]]`, set the `IW_SIGNING_KEY` secret too (a pinned key whose `via` allows `cloudflare-access`): share links only count signed records there, and creating one answers 503 without it.

### Policies

| Who                     | Login method (Zero Trust → Settings → Authentication) | Policy                                                                                                          |
| ----------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Your team               | **Google Workspace** (or any OIDC/SAML IdP)           | Allow → _Emails ending in_ `@your-company.com`, or a Google Workspace group                                     |
| Invited customers (UAT) | **One-time PIN** (code sent by email)                 | A second Allow policy → _Emails_ listing each customer address. Turn on one-time PIN for this application only. |
| CI and scripts          | **Service token**                                     | Service Auth → the token (see below)                                                                            |

Keep the session duration short for customers (for example 24 hours). Removing an address from the policy revokes access at the next login.

### Invite customers (UAT)

*(v0.3)* `iw invite` assigns a customer to plan items and adds their email to the customer policy for you ([customer UAT](../spec/security.md#customer-uat)). Set it up once:

1. **One-time PIN**: Zero Trust → **Integrations → Identity providers → Add new → One-time PIN** (or the Identity Providers API with type `onetimepin`). In the application's **Login methods**, enable One-time PIN, together with your team's IdP. If your customers' mail gateways filter mail, allowlist `noreply@notify.cloudflare.com`.
2. **Customer policy**: Zero Trust → Access → **Policies → Add a policy** (a reusable policy): action **Allow**, name `UAT customers`, a short session duration, and an _Emails_ rule with a placeholder address you control. Attach it to the INDX Watch application. Copy the policy ID from its URL and your account ID from the dashboard.
3. **API token**: My Profile → **API Tokens → Create Token → Custom**, permission **Account → Access: Apps and Policies → Edit**, limited to your account.
4. **Roles**: `[hosting.roles]` must exist in `project.toml` without a `default` role (or with `default = "customer"`): an invited email that matches no entry becomes a `customer`. `iw deploy` again after changing it.
5. For `iw invite` in a working copy, export `IW_ACCESS_POLICY=<account id>/<policy id>` and `CLOUDFLARE_API_TOKEN`. For invites from the hosted app (workspace mode), store both on the Worker: `npx wrangler secret put IW_ACCESS_POLICY --name shop-watch` and `npx wrangler secret put CLOUDFLARE_API_TOKEN --name shop-watch`.

Then:

```console
$ npx indx-watch invite pat@client.test --plan PLAN-1 --items TC-8,TC-9
Invited pat@client.test to PLAN-1 (TC-8, TC-9); Access policy: added
$ npx indx-watch push                               # git mode: publish the changed plan (or iw sync --snapshot in CI)
$ npx indx-watch invite pat@client.test --plan PLAN-1 --revoke
```

The customer opens the app, enters their email, types the PIN from the Access mail and sees only their items. CI never calls the Cloudflare API: try the whole flow once against your real policy with a test address before inviting customers.

### CI: service tokens

1. **Zero Trust → Access → Service credentials → Service Tokens → Create**. Copy the Client ID and Client Secret (the secret is shown once).
2. Add a policy with the action **Service Auth** that includes this token.
3. Store both values as CI secrets and expose them as `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET`. `iw sync` and the Playwright reporter send them as `CF-Access-Client-Id` / `CF-Access-Client-Secret`.

Records written with a service token carry the CI identity of the job (see [security.md](../spec/security.md#identity)), not the token.

### CI signing with GitHub OIDC

*(v0.2)* Instead of storing `IW_SIGNING_KEY` as a CI secret, a GitHub Actions job can have its records signed by the Worker, which checks the job's OIDC token first. The design and its limits are in [security.md](../spec/security.md#github-oidc).

1. Create a key for the Worker and pin it: `npx indx-watch keygen --kid watch --via github-oidc` (add `github` and other `via` values if the Worker should vouch for them too), put the printed `[[signing_keys]]` entry in `project.toml`, and store the secret on the Worker with `npx wrangler secret put IW_SIGNING_KEY --name shop-watch`.
2. List the repositories whose jobs may sign; the numeric repository ID survives renames:

   ```toml
   [hosting]
   oidc_repositories = ["INDXDev/shop"]
   ```

3. Run `npx indx-watch deploy` again. It pins the keys and the repositories as Worker variables; without both, `POST /api/sign` answers 404.
4. Let the job reach `/api/sign` through Access: add a second Access application for the path `/api/sign` with a **Bypass** policy (the Worker then checks the OIDC token instead of an Access token), or keep the job's service token (above), which is sent along.
5. In the workflow, grant `permissions: id-token: write` and set `IW_OIDC_SIGNER` to the Worker's URL ([integrations.md](../spec/integrations.md)). Do not set `IW_ACTOR` or `IW_SIGNING_KEY` in that job: either one turns OIDC signing off.

## 4. Sync against the hosted server

Point the store at the Worker so everyone shares results through it:

```toml
[store]
url = "https://shop-watch.example.workers.dev"
```

On a laptop, log in once per Access session; INDX Watch stores no token itself:

```console
$ npx indx-watch login https://shop-watch.example.workers.dev   # runs: cloudflared access login <url>
$ npx indx-watch sync
```

`iw sync` gets a token with `cloudflared access token -app=<url>` and sends it as `cf-access-token`. You can also pass a token in `IW_ACCESS_TOKEN`. The protocol is the same as for any other store ([sync.md](../spec/sync.md#store-http-endpoints)).

The bundle (definitions) still travels through git. CI on the default branch runs `iw sync --snapshot` (the [GitHub Action](../spec/integrations.md) does this) so the hosted UI shows the current test cases.

## Demo site from GitHub Actions

This repository deploys a public demo of the web app with [`.github/workflows/demo.yml`](../../.github/workflows/demo.yml): the server and UI from the current commit, loaded with [`examples/shop`](../../examples/shop) (its bundle snapshot and sample results). It runs on every push to `main` that touches `packages/` or the shop bundle, and on demand (**Actions → Demo → Run workflow**, optionally with another Worker name for a second demo).

The job copies `examples/shop`, drops the Access keys from the copy's `[hosting]` so the Worker, R2 bucket and D1 database all take the demo name (default `indx-watch-demo`), runs `iw deploy --public`, waits for `/healthz`, then runs `iw sync` (sample results into the local replica), copies the sample's blobs into the replica (sync fetches blobs lazily, and `iw push` holds back a record whose blobs are missing locally) and runs `iw push --store <url>` (records, blobs and a bundle snapshot). The smoke test fails when the demo's gate differs from `iw status` on the sample. The URL appears on the run's summary and on the `demo` environment.

Setup, once per repository:

1. Create a Cloudflare API token from the "Edit Cloudflare Workers" template, adding D1 Edit and Workers R2 Storage Edit.
2. **Settings → Environments → New environment** `demo`; add the secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` there (or with `gh secret set CLOUDFLARE_API_TOKEN --env demo`).
3. Run the workflow once by hand.

`--public` means anyone with the URL can read and write the demo, so only sample data goes there, and visitors' runs stay until you empty the bucket. To reset it, follow [Teardown](#teardown) for the demo name and run the workflow again. Never point a real project at a public deploy.

## Costs and limits

The free tiers of Workers, R2 and D1 cover a small team. Watch the Workers CPU limit per request, the request body limit (keep large evidence such as videos small) and the D1 database size limit. The current numbers, with dates and sources, are in [platform notes](../research/platform-notes.md#limits) ([D1](../research/platform-notes.md#d1), [R2](../research/platform-notes.md#r2)); check them before relying on them.

## Upgrade

Update the package and run `npx indx-watch@latest deploy`. The store layout is versioned and never rewritten, and the D1 index is derived from the store, so upgrades need no migration step in v0.1.

## Teardown

Export first if you want to keep the results (`iw sync` to another store, or `iw export --full`). Empty the R2 bucket (dashboard → R2 → the bucket, or an expiring lifecycle rule), then:

```console
$ npx wrangler delete --name shop-watch
$ npx wrangler d1 delete shop-watch
$ npx wrangler r2 bucket delete shop-watch   # the bucket must be empty
```

Finally delete the Access application and any service tokens in Zero Trust.

## Troubleshooting

| Symptom                                                 | Fix                                                                                                     |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `wrangler is not logged in` (exit 4)                    | `npx wrangler login`, or set `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`                         |
| `refusing to deploy without Cloudflare Access` (exit 3) | Set `[hosting].access_team`                                                                             |
| Every request returns 401                               | `access_aud` is missing or wrong, or the Access application does not cover the Worker's domain          |
| `iw sync` gets 401/403                                  | Run `iw login <url>` again (session expired), or check the CI service token and its Service Auth policy |
| `missing build output`                                  | You are running from a source checkout without `pnpm build`; use the published package or build first   |
