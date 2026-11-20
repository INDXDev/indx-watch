#!/usr/bin/env bash
# Regenerates examples/shop/reports/v1.2.0.md from the committed sample store and fails on any difference
# (docs/spec/reports.md#example). Needs `pnpm build` first.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
cp -r "$ROOT/examples/shop/.indx-watch" "$TMP/.indx-watch"
rm -rf "$TMP/.indx-watch/runs" "$TMP/.indx-watch/cache"
cp -r "$ROOT/examples/shop/store" "$TMP/store"
cd "$TMP"
export IW_NOW=2026-11-19T00:00:00Z IW_ACTOR=qa@shop.test
node "$ROOT/packages/cli/dist/bin.js" sync --pull-only --json > /dev/null
node "$ROOT/packages/cli/dist/bin.js" report --release v1.2.0 --format md --out report.md > /dev/null
diff -u "$ROOT/examples/shop/reports/v1.2.0.md" report.md
echo "examples/shop report is reproducible"
