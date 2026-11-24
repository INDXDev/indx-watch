---
title: "Sync results through S3"
description: "Share runs and evidence through a folder or an S3-compatible bucket (AWS S3, Cloudflare R2, MinIO, GCS)."
---

# Sync results through S3 (or R2, MinIO, GCS)

Definitions travel through git. Results — runs, reviews, waivers, deployments and their screenshots — travel through a **result store**: a shared folder or any S3-compatible bucket. Nobody runs a server; `iw sync` exchanges immutable records with the bucket, so two people (or a laptop and CI) see each other's runs within seconds. How it works: [sync](../spec/sync.md); why: [ADR 0002](../adr/0002-two-sync-channels.md), [ADR 0003](../adr/0003-storage-only-store-protocol.md).

## What you need

| Store                | `[store].url`                                                                   | Extra settings                                                   | Credentials                                                           |
| -------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------- |
| Shared folder        | `file:///mnt/team/shop-watch` or `file://../store` (relative to `.indx-watch/`) | —                                                                | File permissions                                                      |
| AWS S3               | `s3://shop-watch-results/shop`                                                  | `region`                                                         | `AWS_*` variables or an AWS profile                                   |
| Cloudflare R2        | `s3://shop-watch/shop`                                                          | `endpoint`, `region = "auto"`                                    | R2 API token (S3 access key)                                          |
| MinIO                | `s3://shop-watch/shop`                                                          | `endpoint`, `region`, `force_path_style = true`                  | MinIO user access key                                                 |
| Google Cloud Storage | `s3://shop-watch-results/shop`                                                  | `endpoint = "https://storage.googleapis.com"`, `region = "auto"` | HMAC key                                                              |
| Hosted INDX Watch    | `https://watch.example.com`                                                     | —                                                                | Cloudflare Access ([sync → store URLs](../spec/sync.md#store-layout)) |

The path after the bucket (`/shop`) is a prefix, so one bucket can hold several projects. A store is bound to one project the first time anyone writes to it; a store that belongs to another project is refused (exit code 4).

**Credentials never go in `project.toml`.** INDX Watch reads the standard variables `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` and `AWS_SESSION_TOKEN`. With `AWS_PROFILE` (including AWS SSO), it gets credentials from `aws configure export-credentials --format process`.

INDX Watch only needs to **list, read and create** objects. It never overwrites or deletes: every write is create-if-absent, records are immutable and blobs are named by their SHA-256. Do not grant delete permissions.

## AWS S3

Create a private bucket (new buckets block public access by default; keep it that way):

```bash
aws s3api create-bucket --bucket shop-watch-results --region eu-central-1 \
  --create-bucket-configuration LocationConstraint=eu-central-1
```

Optional but recommended: turn on versioning, so even a principal with delete rights cannot silently remove history.

```bash
aws s3api put-bucket-versioning --bucket shop-watch-results --versioning-configuration Status=Enabled
```

Minimal IAM policy for the team and CI (read-write on one prefix):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::shop-watch-results",
      "Condition": { "StringLike": { "s3:prefix": ["shop/*"] } }
    },
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject"],
      "Resource": "arn:aws:s3:::shop-watch-results/shop/*"
    }
  ]
}
```

For read-only viewers, drop `s3:PutObject`. Then in `.indx-watch/project.toml`:

```toml
[store]
url = "s3://shop-watch-results/shop"
region = "eu-central-1"
```

## Cloudflare R2

```bash
npx wrangler r2 bucket create shop-watch
```

In the Cloudflare dashboard, go to **R2 → Manage API tokens → Create API token**, choose the permission **Object Read & Write**, and scope it to the `shop-watch` bucket (use **Object Read only** for viewers). Copy the **Access Key ID** and **Secret Access Key**; the secret is shown only once. Put them in `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`.

```toml
[store]
url = "s3://shop-watch/shop"
endpoint = "https://<ACCOUNT_ID>.r2.cloudflarestorage.com"
region = "auto"
```

Replace `<ACCOUNT_ID>` with your Cloudflare account ID (not a secret). Read the store only through this S3 endpoint, never through a cached custom domain. R2 has no egress fees, which suits screenshots and traces. Platform details: [R2 notes](../research/platform-notes.md#r2).

## MinIO

MinIO is handy for a self-hosted store or local experiments. Its community edition is in maintenance mode ([platform notes](../research/platform-notes.md#s3-and-conditional-writes)), so check that your version supports conditional writes (`If-None-Match`).

```bash
minio server ~/minio-data                       # serves http://localhost:9000
mc alias set local http://localhost:9000 <root-user> <root-password>
mc mb local/shop-watch
```

Create a user for INDX Watch with a policy equivalent to the IAM policy above (`s3:ListBucket` on the bucket, `s3:GetObject` and `s3:PutObject` on `shop-watch/shop/*`), and use that user's keys as `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`.

```toml
[store]
url = "s3://shop-watch/shop"
endpoint = "http://localhost:9000"
region = "us-east-1"
force_path_style = true
```

## Google Cloud Storage (XML interoperability)

```bash
gcloud storage buckets create gs://shop-watch-results --location=europe-west1 --uniform-bucket-level-access
gcloud iam service-accounts create shop-watch
gcloud storage buckets add-iam-policy-binding gs://shop-watch-results \
  --member=serviceAccount:shop-watch@<PROJECT_ID>.iam.gserviceaccount.com --role=roles/storage.objectViewer
gcloud storage buckets add-iam-policy-binding gs://shop-watch-results \
  --member=serviceAccount:shop-watch@<PROJECT_ID>.iam.gserviceaccount.com --role=roles/storage.objectCreator
gcloud storage hmac create shop-watch@<PROJECT_ID>.iam.gserviceaccount.com
```

`objectViewer` lets the account list and read; `objectCreator` lets it create objects without overwriting or deleting them. The HMAC key's access ID and secret go into `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`.

```toml
[store]
url = "s3://shop-watch-results/shop"
endpoint = "https://storage.googleapis.com"
region = "auto"
```

GCS does not honor `If-None-Match: *` on uploads; INDX Watch sends GCS's own create-only precondition instead ([sync → store layout](../spec/sync.md#store-layout)).

## First sync

```bash
iw sync --json
```

```json
{
  "ok": true,
  "command": "sync",
  "data": {
    "pushed": { "records": 12, "blobs": 9 },
    "pulled": { "records": 0, "blobs": 0 },
    "snapshot": null,
    "cursor": "01JF…"
  },
  "warnings": []
}
```

Running it again transfers nothing: sync is idempotent and safe to interrupt. Useful flags ([cli.md](../spec/cli.md#iw-sync)):

| Command                                  | Does                                                                                                              |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `iw sync --pull-only` / `--push-only`    | One direction only                                                                                                |
| `iw sync --evidence all`                 | Also download every screenshot and trace (default `on-demand`: fetched when a page, report or command needs them) |
| `iw sync --store s3://other-bucket/shop` | Use another store once (or set `IW_STORE`)                                                                        |
| `iw sync --full`                         | List the whole store log once, e.g. after a writer's clock was wrong                                              |
| `iw status --sync`                       | Sync, then compute the status                                                                                     |

`iw sync` runs the secret scan first and refuses to push while `iw check` reports secrets. `iw serve` syncs in the background when a store is configured, and the [Playwright reporter](./playwright.md) pushes at the end of each run.

## Live sync: `iw sync --watch`

```bash
iw sync --watch    # push local writes within ~300 ms, poll the store every 3 s
```

`--interval` changes how often the store is polled. Leave it running in a terminal while you test, or rely on `iw serve`.

## Two-clone demo

Two copies of a project on one machine show how sync works with your bucket: a run recorded in one appears in the other within seconds. It uses the shop example; any project works.

```bash
npx indx-watch init demo --example     # the examples/shop bundle
```

Edit `demo/.indx-watch/project.toml` and replace the sample `[store]` with your bucket (any section above). Then make a second "clone" and export the credentials in two terminals:

```bash
cp -r demo demo-b && rm -rf demo-b/.indx-watch/cache   # clones never share cache/
```

**Terminal B** — watch:

```bash
cd demo-b
iw sync --watch
```

**Terminal A** — record a manual run of `TC-8` ("Wrong password is rejected") with a screenshot and push it. Any PNG works as the screenshot, for example one you take of the shop's sign-in page:

```bash
cd demo
iw record TC-8 --verdict pass --step 1=pass --step 2=pass --evidence ./wrong-password.png@1
iw sync
```

Within a few seconds terminal B pulls one record and one blob. In a third terminal:

```bash
cd demo-b && iw show TC-8
```

lists the run from clone A, with A's identity, the commit and the screenshot. `iw status` in B shows `TC-8` as `pass`. In a real team, the two clones are two checkouts of the same git repository; definitions arrive with `git pull`, results with `iw sync`.

## Troubleshooting

| Symptom                           | Cause                                                                                     |
| --------------------------------- | ----------------------------------------------------------------------------------------- |
| Exit code 4, `STORE_ERROR`        | Wrong credentials, endpoint or region, or the store belongs to another project            |
| `403` on write                    | The key lacks `PutObject` (or `objectCreator`) on the prefix                              |
| Runs from a teammate missing      | Their `iw sync` has not run yet, or they push to a different prefix; try `iw sync --full` |
| Fixture pointer cannot be fetched | The blob was never pushed: the person who added it runs `iw sync`                         |
| Exit code 1, `SECRETS_FOUND`      | A secret value in the bundle; `iw check` lists it. Replace it with an `env:` reference    |
