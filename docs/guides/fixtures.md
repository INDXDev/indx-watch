# Fixtures

A fixture is the test data a test case needs: coupon codes, a catalog to seed, a photo to upload, an account to sign in with. Fixtures live next to the test cases in `.indx-watch/fixtures/`, are versioned by content hash, and every run records which version it used. Format reference: [bundle format → fixtures](../spec/bundle-format.md#fixtures); kinds and versions: [concepts](../spec/concepts.md#fixture-kinds). All examples are from [`examples/shop`](../../examples/shop/.indx-watch/fixtures).

## Pick a kind

| Kind      | Holds                                                | Shop example                       |
| --------- | ---------------------------------------------------- | ---------------------------------- |
| `dataset` | Rows in one CSV or JSON file                         | `FX-1` coupon codes                |
| `seed`    | One JSON payload sent to the environment's seed hook | `FX-2` catalog with three products |
| `file`    | Files used in upload steps                           | `FX-4` review photo                |
| `account` | A username, public fields and a secret **reference** | `FX-3` staging customer            |

Create one with `iw new fixture --kind dataset --title "Coupon codes"`, then add data files with `iw fixture add`.

## Datasets: rows and placeholders

```toml
key = "FX-1"
title = "Coupon codes"
status = "ready"
kind = "dataset"
files = ["coupons.csv"]
row_key = "code"
```

```csv
code,discount,expires,expected_message
SUMMER10,0.10,2099-12-31,
OLD5,0.05,2020-01-01,This coupon has expired
```

- `row_key` names the column that identifies a row; its values must be unique.
- A test case selects rows: `[[fixtures]] ref = "FX-1"` with `rows = ["OLD5"]`.
- Steps insert values with `{{FX-1.code}}`. With several rows selected, each row is a separate variant of the run and is tracked separately ([computed done](../spec/concepts.md#computed-done)).
- Put the expected on-screen text in the data when it varies by row (`expected_message`), copied exactly from the app.

## Seeds and environment hooks

A `seed` fixture is a JSON payload that resets the environment to a known state before a run:

```toml
key = "FX-2"
kind = "seed"
files = ["catalog.json"]
hook = "seed"
```

The environment describes where the payload goes; the token is a reference:

```toml
# environments/staging.toml
[hooks.seed]
method = "POST"
url = "/__test/seed"
secret_ref = "env:SHOP_SEED_TOKEN"
```

A test case that needs it says `apply = "before_run"`:

```toml
[[fixtures]]
ref = "FX-2"
apply = "before_run"
```

Whoever executes the test case applies the seed first, as the environment's `guide` explains. Playwright tests do it in code: the shop's `tests/support.ts` posts `catalog.json` to the hook in `beforeEach`.

## Files and large-file pointers

```bash
iw fixture add ./review-photo.png --to FX-4
```

`fixture add` runs the secret scan, copies the file next to `fixture.toml` and records its SHA-256. Files larger than `[fixtures].inline_max_bytes` (1 MiB by default), or any file added with `--blob`, become a **pointer** instead of being committed:

```toml
# fixtures/FX-4-review-photo/review-photo.png.blob.toml
sha256 = "8760bc67a01b22044c4098fddeb3a749cd395c4757fab3740aa626cd0da51e1b"
size = 8295
media_type = "image/png"
```

The blob itself goes to the local replica and is uploaded to the result store by `iw sync`. Teammates download it with:

```bash
iw fixture fetch FX-4
```

Pointers need a `[store]` in `project.toml`, otherwise nobody else could resolve them; `fixture add` refuses to create one without a store unless you pass `--local-only`. Setting up a store: [S3 sync](s3-sync.md).

## Accounts and secrets

```toml
key = "FX-3"
title = "Staging customer account"
status = "ready"
kind = "account"

[account]
username = "casey@shop.test"
secret_ref = "env:SHOP_CUSTOMER_PASSWORD"
```

- The bundle stores **references only**: `env:NAME` in v0.1, plus `cf:`, `gh:`, `op:`, `aws-sm:`, `gcp-sm:` and `vault:` forms ([security](../spec/security.md#secrets)).
- Each tester and CI job sets the variable (`SHOP_CUSTOMER_PASSWORD`) in their own environment or secret store. The value is resolved at execution time and never written to records, reports or the index.
- Public details that help testers (a display name, a role) go into `[account] fields`.
- List the accounts an environment offers in its `accounts = ["FX-3"]`.
- `iw check`, `iw fixture add`, `iw sync` and `iw export` run a secret scan over every file. A finding is an error; remove the value and use a reference.
- Evidence can still capture secrets: the Playwright reporter skips traces and videos for test cases that use an account fixture.

## Versions and staleness

A fixture's version (`fxv:…`) is a hash of its definition and its data files. Title, tags, notes and translations do not count.

- Every run records the version of every fixture it used.
- When the data changes, results that used the old version become **stale**: the test case shows `stale` in `iw status` and the gate's `allow_stale = false` treats it as not passing until it is re-run.
- Before editing a widely used fixture, check who uses it: `iw show FX-1` lists the test cases that reference it. Often adding a new row or a new fixture is better than changing an existing one.
- History is git history: `iw show FX-1 --versions`.

## Using fixtures in Playwright tests

Tests read fixture data from the bundle and tell the reporter which rows they used:

```ts
// examples/shop/tests/support.ts (abridged)
/** FX-1: one row of the coupon dataset, keyed by `code`. Records the row for the INDX Watch reporter. */
export function coupon(code: string): Record<string, string> {
  const rows = parseCsv(readFileSync(new URL('FX-1-coupons/coupons.csv', fixtures), 'utf8'));
  const row = rows.find((r) => r.code === code);
  if (!row) throw new Error(`FX-1 has no row ${code}`);
  test.info().annotations.push({ type: '_iw.fixture', description: `FX-1:${code}` });
  return row;
}
```

See [Playwright → fixtures](playwright.md#fixtures-and-rows).

## Drafts

Fixtures follow the same lifecycle as test cases: new ones are `draft` (AI-written ones also carry `origin = "ai"`) until a human runs `iw approve FX-5`. Fixtures are deprecated, not deleted, so their keys stay reserved.
