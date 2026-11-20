# Bundle format (schema version 1)

The **bundle** is the `.indx-watch/` directory: typed TOML files plus data files. It is the source of truth for definitions. This page is the format specification; the meaning of each entity is in [concepts.md](concepts.md), and how results are stored is in [sync.md](sync.md). Every example below is a real file in [`examples/shop/.indx-watch/`](../../examples/shop/.indx-watch).

The Zod schemas in [`packages/bundle/src/schema/`](../../packages/bundle/src/schema) implement this page. JSON Schemas generated from them are published in [`schemas/v1/`](../../schemas/v1).

## Layout

```text
.indx-watch/
├── project.toml                      # project, gate, policy, store and hosting config (no secrets)
├── environments/
│   └── staging.toml                  # one file per environment, file name = environment name
├── releases/
│   └── v1.2.0.toml                   # one file per release, file name = version
├── specs/
│   └── FEAT-2-checkout/
│       ├── feature.toml
│       └── UC-2-guest-applies-coupon/
│           ├── use-case.toml         # use case + acceptance criteria
│           ├── TC-3-valid-coupon.toml
│           └── TC-4-expired-coupon.toml
├── fixtures/
│   ├── FX-1-coupons/
│   │   ├── fixture.toml
│   │   └── coupons.csv               # data file, inline in git
│   └── FX-4-review-photo/
│       ├── fixture.toml
│       └── review-photo.png.blob.toml   # pointer to a large file in the result store
├── plans/
│   └── PLAN-1-v1-2-0-regression.toml
├── templates/
│   └── test-case.web.toml            # partial files used by `iw new --template`
├── .gitignore                        # written by `iw init`: ignores cache/ and runs/
├── cache/                            # ignored: index, sync state, fetched blobs
└── runs/                             # ignored by default: local replica of the result store
```

Rules:

- **Identity is the `id` inside a file**, not its path. Directory and file names are `{KEY}-{slug}`; the slug is cosmetic: `iw new` writes it from the title, and `iw check --fix` only rewrites the key part of a name (a title change keeps the slug). Moving or renaming a file never changes identity.
- A use case directory must be inside a feature directory; test case files must be inside a use case directory. A test case may still cover ACs of other use cases.
- Files and directories not described here produce a warning from `iw check` and are ignored, except `README.md` files, which are allowed anywhere. The secret scan still covers every file in the folder, because snapshots and exports pack them.
- Symbolic links are ignored: tools do not list them and refuse to read or write a path whose real location is outside the folder.
- The folder is `.indx-watch/` at the repository root by default. Commands find it by walking up from the current directory; `--dir` or `IW_DIR` override this.

## Common rules for every TOML file

```toml
#:schema https://raw.githubusercontent.com/INDXDev/indx-watch/main/schemas/v1/test-case.json

id = "tc_01JF3Q8M5X2V7K9D4R6T1W0Y33"
key = "TC-3"
```

| Rule | Detail |
|---|---|
| Schema line | Line 1 is `#:schema <url>` for that file type, line 2 is blank. Tombi and Taplo use it for completion and validation. See [platform notes](../research/platform-notes.md#toml-and-editor-tooling). |
| Encoding | UTF-8, LF line endings, exactly one trailing newline, no trailing whitespace, no tabs. Readers treat CRLF as LF (a Windows checkout with `core.autocrlf` gives the same values and versions); `iw fmt` writes LF. In multi-line strings, spaces at the end of a line are written as `\u0020`. |
| Key order | The order in which fields are listed in this spec (= the Zod schema), except that every value written as a table or array of tables comes after all plain values, as TOML requires. A table that contains only sub-tables gets no header of its own (`[hooks.seed]`, not `[hooks]` + `[hooks.seed]`). Unknown keys are errors, except inside an `[x]` table, which is free-form and sorted alphabetically. |
| Optional fields | Omitted when empty (empty string, empty array, empty table). Booleans are written as given, `false` included. |
| Strings | Basic strings (`"…"`). Strings containing a newline use multi-line basic strings (`"""` on its own line … `"""`), with a trailing newline normalized to exactly one. |
| Arrays | Arrays of scalars are inline if the line fits in 100 characters, otherwise one item per line with a trailing comma. |
| Tables in arrays | Arrays of objects are written as arrays of tables (`[[steps]]`). Nested objects inside them use dotted sub-tables (`[steps.i18n.ja]`). |
| Datetimes | RFC 3339 offset datetimes in UTC with `Z`, second precision (`2026-11-19T04:05:12Z`). Dates are local dates (`2026-12-01`). |
| Numbers | Fields declared as integers are written without separators; all other numbers are floats with at least one decimal digit (`1.0`, `0.95`). Inside `[x]`, values are plain data: an integral number is written as an integer (`5.0` → `5`) and a date or datetime as a string. |
| Comments | Allowed but **not preserved** when a tool rewrites the file. Use `notes` fields for anything that must survive. |

**Canonical form.** `formatToml(parse(file))` is the canonical form. For any valid canonical file, parse → format is byte-identical. `iw check` reports non-canonical files; `iw fmt` rewrites them. All tools write through the same serializer. See [ADR 0004](../adr/0004-canonical-toml.md).

**Common fields.** Most definition files share these fields, in this order, after `id` and `key`:

| Field | Type | Notes |
|---|---|---|
| `title` | string | Required. Plain language. |
| `status` | `draft` \| `ready` \| `deprecated` | Default `draft`. Use cases, test cases, fixtures. |
| `origin` | `human` \| `ai` \| `import` | Default `human` (omitted). |
| `approved_by` | string | Identity of the human who approved the item (written by `iw approve`). |
| `approved_version` | string | Version hash at approval (`tcv:…`, `fxv:…`, or the use case's content hash). |
| `tags` | string[] | Lowercase, `[a-z0-9-]+`. |
| `notes` | string | Free text that survives formatting. Always the last plain value of a file. |
| `[i18n.<locale>]` | table | Translations; see [i18n.md](i18n.md#content-translations). |
| `[ai]` | table | `model`, `skill`, `created_at` — required when `origin = "ai"`. |
| `[x]` | table | Free-form extension data. |

Entity-specific fields sit between `tags` and `notes`. The exact order of every file type is the field order of its Zod schema in [`packages/bundle/src/schema/definitions.ts`](../../packages/bundle/src/schema/definitions.ts).

**Secret references.** Anywhere a secret is needed, the file stores a reference string matching `^(env|cf|gh|op|aws-sm|gcp-sm|vault):[A-Za-z0-9_./-]+$`, for example `env:SHOP_STAGING_PASSWORD`. See [security.md](security.md#secrets).

## `project.toml`

```toml
#:schema https://raw.githubusercontent.com/INDXDev/indx-watch/main/schemas/v1/project.json

schema_version = 1
id = "prj_01JF3Q8M5X2V7K9D4R6T1W0Y00"
key = "SHOP"
name = "Shop"
source_locale = "en"
locales = ["en", "ja"]
default_environment = "staging"
current_release = "v1.2.0"

[gate]
p0_coverage = 1.0
p0_all_pass = true
p1_pass_rate = 0.95
max_needs_review = 0
max_untested = 0
allow_stale = false
require_evidence = true

[decision_policy]
llm_pass_confidence = 0.8
llm_fail_confidence = 0.8
visual_threshold = 0.01

[fixtures]
inline_max_bytes = 1048576

[store]
url = "file://../store"
mode = "git"
evidence = "on-demand"

[hosting]
provider = "cloudflare"
name = "shop-watch"
r2_bucket = "shop-watch"
d1_database = "shop-watch"
access_team = "example"

[[glossary]]
term = "Coupon"
definition = "A code that reduces the order total."
```

| Field | Required | Notes |
|---|---|---|
| `schema_version` | yes | Integer. See [Versioning](#versioning). |
| `key` | yes | `^[A-Z][A-Z0-9]{1,9}$`. |
| `source_locale`, `locales` | yes | `en` and/or `ja` in v1. |
| `default_environment` | no | Environment used for manual runs (UI, `iw record`) that name none. `iw status`, `iw report` and the dashboard cover all environments unless one is chosen. |
| `current_release` | no | Release used by `iw status` and runs when none is given. |
| `default_branch` | no | Branch whose builds fall back to `current_release` (default `main`). |
| `[gate]` | no | Readiness gate thresholds; defaults in [concepts](concepts.md#readiness-gate). |
| `[decision_policy]` | no | Project defaults; a test case may override. |
| `[store]` | no | Omit for local-only use. `url` schemes: `file://` (`file:///abs/path`, or `file://../rel` = a path relative to the `.indx-watch/` directory — not a WHATWG URL), `s3://bucket/prefix`, `https://` (a hosted INDX Watch). S3 options: `endpoint`, `region`, `force_path_style`. `mode`: `git` (default; `workspace` is reserved for v0.2). `evidence`: `on-demand` (default), `all`, `none`. Credentials never go here. See [sync.md](sync.md). |
| `[hosting]` | no | Read by `iw deploy`. See [guides/self-host-cloudflare.md](../guides/self-host-cloudflare.md). |

## `environments/<name>.toml`

```toml
#:schema https://raw.githubusercontent.com/INDXDev/indx-watch/main/schemas/v1/environment.json

id = "env_01JF3Q8M5X2V7K9D4R6T1W0Y01"
name = "staging"
title = "Staging"
base_url = "http://localhost:4173"
accounts = ["FX-3"]
guide = """
Open the base URL in any browser. No VPN is needed.
Sign in with the account in FX-3 when a step asks you to.
"""

[access]
method = "public"

[hooks.seed]
method = "POST"
url = "/__test/seed"
secret_ref = "env:SHOP_SEED_TOKEN"
```

- `name` matches `^[a-z0-9][a-z0-9-]*$` and the file name.
- `[access].method`: `public`, `basic`, `cloudflare_access`, `vpn`, `sso`, `other`; `secret_refs` lists what a tester needs.
- `[hooks.seed]` and `[hooks.reset]` describe HTTP hooks that receive a `seed` fixture's payload. Relative URLs resolve against `base_url`.

## `releases/<version>.toml`

```toml
#:schema https://raw.githubusercontent.com/INDXDev/indx-watch/main/schemas/v1/release.json

id = "rel_01JF3Q8M5X2V7K9D4R6T1W0Y02"
version = "v1.2.0"
title = "Coupons and sign-in"
state = "testing"
target_date = 2026-12-01
refs = ["v1.2.0", "release/1.2"]
```

- `state`: `planning`, `testing`, `ready`, `released`.
- `refs`: git tags or branches whose builds belong to this release.
- `plan`: optional plan key. When set, the readiness gate counts only the test cases in that plan, so a release does not need fresh results for features it did not touch.
- A run's release is resolved in this order: explicit `--release` / `IW_RELEASE` → a release whose `refs` contains the build's tag or branch → `project.current_release`, but only when the build's branch is `default_branch` or the run is not in CI. Otherwise the run has no release and a warning is printed: results from unmerged branches do not count towards a release.

## `specs/<FEAT>/feature.toml`

```toml
#:schema https://raw.githubusercontent.com/INDXDev/indx-watch/main/schemas/v1/feature.json

id = "fea_01JF3Q8M5X2V7K9D4R6T1W0Y11"
key = "FEAT-2"
title = "Checkout"
description = "Cart, coupons and placing an order."

[i18n.ja]
title = "購入手続き"
description = "カート・クーポン・注文確定。"
status = "reviewed"
source_hash = "21d4059be89b"
```

## `specs/<FEAT>/<UC>/use-case.toml`

```toml
#:schema https://raw.githubusercontent.com/INDXDev/indx-watch/main/schemas/v1/use-case.json

id = "uc_01JF3Q8M5X2V7K9D4R6T1W0Y21"
key = "UC-2"
title = "Guest applies a coupon at checkout"
status = "ready"
actor = "Guest shopper"
goal = "Pay a discounted price for the items in the cart."
priority = "P0"
links = ["https://github.com/INDXDev/indx-watch/issues/2"]

[[criteria]]
id = "ac_01JF3Q8M5X2V7K9D4R6T1W0Y22"
key = "AC-2.1"
text = "A valid coupon reduces the order total by its discount."

[[criteria]]
id = "ac_01JF3Q8M5X2V7K9D4R6T1W0Y23"
key = "AC-2.2"
text = "An expired coupon shows \"This coupon has expired\" and the total does not change."

[criteria.i18n.ja]
text = "期限切れのクーポンは「This coupon has expired」と表示され、合計は変わらない。"
status = "reviewed"
source_hash = "50c93fc9dcc3"

[i18n.ja]
title = "ゲストが購入時にクーポンを使う"
actor = "ゲストの購入者"
goal = "カートの商品を割引価格で購入したい。"
status = "machine"
source_hash = "9fba5a63e3e8"
```

- `priority`: `P0`–`P3`. `iw new uc` writes `P1` unless told otherwise, so a new use case is gated.
- `criteria`: at least one. `key` is `AC-{uc}.{n}`. A criterion has an optional `status`: `ready` (default), `draft` (e.g. proposed by an AI; does not count) or `retired` (kept so its key is never reused). Do not delete criteria.
- A criterion may also have `origin`, `approved_by` and an `[criteria.ai]` table (`model`, `skill`, `created_at`), like other AI-written items. An `origin = "ai"` criterion needs the `[ai]` table, and counts as `ready` only with `approved_by` (written by `iw approve AC-n.m`); `iw check` reports `ai-not-approved` otherwise.

## `specs/<FEAT>/<UC>/TC-<n>-<slug>.toml`

```toml
#:schema https://raw.githubusercontent.com/INDXDev/indx-watch/main/schemas/v1/test-case.json

id = "tc_01JF3Q8M5X2V7K9D4R6T1W0Y33"
key = "TC-3"
title = "Valid coupon reduces the total"
status = "ready"
tags = ["coupon", "smoke"]
covers = ["AC-2.1"]
mode = "playwright"
preconditions = "The cart contains one \"Canvas Tote\" (price 40.00)."

[[fixtures]]
ref = "FX-1"
rows = ["SUMMER10"]

[[fixtures]]
ref = "FX-2"
apply = "before_run"

[[steps]]
instruction = "Open the cart and enter {{FX-1.code}} in the coupon field, then press \"Apply\"."
expected = "The discount line shows \"-4.00\" and the total is \"36.00\"."
evidence = ["screenshot"]

[[steps]]
instruction = "Press \"Place order\"."
expected = "The confirmation page shows an order number."

[[judges]]
kind = "assert"

[automation]
files = ["examples/shop/tests/coupon.spec.ts"]
```

| Field | Required | Notes |
|---|---|---|
| `covers` | yes | AC keys (`AC-2.1`) — resolved to AC IDs by `iw check`. |
| `priority` | no | Defaults to the highest priority among covered use cases, and may not be lower than it. |
| `mode` | yes | `manual`, `playwright`, `agent`, `hybrid`. |
| `preconditions` | no | Plain language. |
| `[[fixtures]]` | no | `ref` (fixture key), optional `rows` (dataset row keys), optional `apply` (`before_run` for seeds). |
| `[[steps]]` | yes | `instruction`, `expected`, optional `evidence` (`screenshot`, `video`, `trace`, `log`, `file`), optional `[steps.i18n.<locale>]` (with `status` and `source_hash` like every translation). Steps are numbered by position, starting at 1. |
| `[[judges]]` | no | `kind` (`assert`, `visual`, `llm`, `human`) plus `rubric` (string[]) for `llm` and `baseline` for `visual`. Default: `human` for `manual`, `assert` for `playwright`. |
| `[decision_policy]` | no | Overrides project defaults for this test case. |
| `[automation]` | no | `files`: paths of automated tests that implement this test case. The link itself is the tag `@TC-3` (see [integrations](integrations.md#playwright-reporter)). |

**Placeholders.** `{{FX-1.code}}` inserts column `code` of the selected row of fixture `FX-1`; `{{env.base_url}}` inserts an environment field. Text in double quotes is a literal on-screen string of the app under test and is never translated ([i18n.md](i18n.md#literal-strings)).

**Version.** The test case version is computed from these fields and the text of the covered criteria — see [concepts](concepts.md#versions-and-staleness). It is not stored in the file.

## Fixtures

`fixtures/<FX>-<slug>/fixture.toml` plus data files in the same directory.

```toml
#:schema https://raw.githubusercontent.com/INDXDev/indx-watch/main/schemas/v1/fixture.json

id = "fx_01JF3Q8M5X2V7K9D4R6T1W0Y41"
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

| Kind | Required fields | Data |
|---|---|---|
| `dataset` | `files` (one `.csv` or `.json` array of objects), `row_key` | Rows; `rows` in a test case selects by `row_key` value. |
| `seed` | `files` (one `.json`), optional `hook` (`seed` or `reset`, default `seed`) | Payload POSTed to the environment hook. |
| `file` | `files` | Any files. |
| `account` | `[account]`: `username`, `secret_ref`, optional `fields` (public key/values) | No data files. |

```toml
#:schema https://raw.githubusercontent.com/INDXDev/indx-watch/main/schemas/v1/fixture.json

id = "fx_01JF3Q8M5X2V7K9D4R6T1W0Y43"
key = "FX-3"
title = "Staging customer account"
status = "ready"
kind = "account"

[account]
username = "casey@shop.test"
secret_ref = "env:SHOP_CUSTOMER_PASSWORD"
```

**Large files** become pointer files. A file listed as `review-photo.png` may be stored as `review-photo.png.blob.toml`:

```toml
#:schema https://raw.githubusercontent.com/INDXDev/indx-watch/main/schemas/v1/blob-pointer.json

sha256 = "8760bc67a01b22044c4098fddeb3a749cd395c4757fab3740aa626cd0da51e1b"
size = 8295
media_type = "image/png"
```

- `iw fixture add <path> --to FX-4` runs the secret scan on the file, copies it in, and turns it into a pointer if it is larger than `[fixtures].inline_max_bytes` (or with `--blob`). The blob goes to the local replica and is uploaded by `iw sync`. Without a `[store]`, creating a pointer is refused unless `--local-only` is given, because teammates could not resolve it.
- `iw check` warns when a pointer's blob is in neither the local replica nor `cache/blobs/`; run `iw fixture fetch` or `iw sync` first.
- `iw fixture fetch FX-4` downloads the blob into `cache/blobs/<sha256>` (flat) and verifies the hash. Tools resolve fixture files through the bundle API, never by path guessing.

## `plans/<PLAN>-<slug>.toml`

```toml
#:schema https://raw.githubusercontent.com/INDXDev/indx-watch/main/schemas/v1/plan.json

id = "pln_01JF3Q8M5X2V7K9D4R6T1W0Y51"
key = "PLAN-1"
title = "v1.2.0 regression"
release = "v1.2.0"
environment = "staging"
due = 2026-11-28

[[items]]
test_case = "TC-6"
assignee = "alex@shop.test"
due = 2026-11-26

[[items]]
test_case = "TC-8"
assignee = "sam@shop.test"

[[items]]
test_case = "TC-9"
assignee = "agent:claude"

[[items]]
test_case = "TC-3"
assignee = "ci"

[[items]]
test_case = "TC-4"
assignee = "ci"

[[items]]
test_case = "TC-5"
assignee = "ci"

[[items]]
test_case = "TC-7"
assignee = "ci"
```

- `assignee`: an email, `ci`, or `agent:<name>`.
- An item may override `environment` and `due`. Item status is computed ([concepts](concepts.md#plan-item-computed)).

## Templates

`templates/<kind>.<name>.toml` holds a **partial** file of kind `test-case`, `use-case` or `fixture`, without `id`, `key` and without a `#:schema` line (editors would flag the missing required fields). It is formatted in the field order of its kind. `iw new tc --template web` merges it under the generated fields. Templates are validated as partials.

## `.gitignore`

`iw init` writes:

```gitignore
cache/
runs/
```

Teams that prefer results in git can delete the `runs/` line: run records are immutable, uniquely named files, so they never conflict.

## Versioning

- `schema_version` (in `project.toml`) is an integer and applies to the whole bundle.
- **Additive** changes (new optional field, new enum value read as unknown by old tools) do not bump it.
- **Breaking** changes (rename, removal, new required field, meaning change) bump it. `iw migrate` rewrites a bundle from version N to N+1, in place, and is idempotent. Tools refuse to write a bundle with a higher `schema_version` than they support and tell the user to upgrade.
- JSON Schemas are published per major version at `schemas/v<N>/`.

## Acceptance criteria

- [x] Every TOML example on this page that contains an `id` is byte-identical to the corresponding file in `examples/shop/.indx-watch/` (a test extracts the code blocks and compares), and the bundle passes `iw check`.
- [x] For every file in `examples/shop/.indx-watch/`, parse → format is byte-identical (CI round-trip test).
- [x] `pnpm schemas` regenerates `schemas/v1/*.json` with no diff (CI).
- [x] A file with an unknown key outside `[x]` fails `iw check` with the file path and key.
- [ ] A fixture data file larger than `inline_max_bytes` added via `iw fixture add` becomes a `*.blob.toml` pointer whose hash matches the content.
- [x] A bundle with `schema_version` higher than supported is rejected with exit code 3.
