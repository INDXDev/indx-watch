#!/usr/bin/env bash
# Biome must reject node:fs, aws4fetch and hono in packages/core and packages/bundle outside src/node/
# (docs/architecture.md#acceptance-criteria). Writes a probe file, lints it, removes it.
set -euo pipefail
cd "$(dirname "$0")/.."
probe() { # <dir> <module> <expected biome exit code>
  local f="$1/__pure_probe.ts" code=0
  printf "import * as m from '%s';\n\nexport const x = m;\n" "$2" > "$f"
  pnpm exec biome lint "$f" > /dev/null 2>&1 || code=$?
  rm -f "$f"
  [ "$code" = "$3" ] || { echo "Biome purity rule: $2 in $1 gave exit $code, expected $3" >&2; exit 1; }
}
for m in node:fs aws4fetch hono; do probe packages/core/src "$m" 1; probe packages/bundle/src "$m" 1; done
probe packages/bundle/src/node node:fs 0
echo "Biome rejects I/O and vendor imports in core and bundle"
