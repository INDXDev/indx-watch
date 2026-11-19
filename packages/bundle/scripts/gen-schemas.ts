/**
 * Zod → JSON Schema: schemas/v1/<file type>.json and schemas/v1/record.json.
 * `--check` exits 1 when a generated file would change (CI).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { SCHEMA_BASE_URL } from '../src/schema/common.js';
import { FILE_TYPES } from '../src/schema/definitions.js';
import { AnyRecord } from '../src/schema/records.js';

const out = resolve(dirname(fileURLToPath(import.meta.url)), '../../../schemas/v1');

function toJson(name: string, schema: z.ZodType): string {
  const json = z.toJSONSchema(schema, {
    // TOML dates and datetimes are TOML values, not strings with a pattern
    override: ({ zodSchema, jsonSchema }) => {
      const toml = (z.globalRegistry.get(zodSchema as unknown as z.ZodType) as { toml?: string } | undefined)
        ?.toml;
      if (toml === 'date' || toml === 'datetime') {
        delete jsonSchema.pattern;
        delete (jsonSchema as Record<string, unknown>).toml;
        jsonSchema.format = toml === 'date' ? 'date' : 'date-time';
      }
    },
  });
  return `${JSON.stringify({ ...json, $id: `${SCHEMA_BASE_URL}/${name}.json`, title: name }, null, 2)}\n`;
}

const files: [string, string][] = [
  ...Object.entries(FILE_TYPES).map(([name, schema]) => [name, toJson(name, schema)] as [string, string]),
  ['record', toJson('record', AnyRecord)],
];

const check = process.argv.includes('--check');
let stale = 0;
mkdirSync(out, { recursive: true });
for (const [name, text] of files) {
  const path = join(out, `${name}.json`);
  let current: string | null = null;
  try {
    current = readFileSync(path, 'utf8');
  } catch {}
  if (current === text) continue;
  stale++;
  if (check) console.error(`schemas/v1/${name}.json is out of date; run pnpm schemas`);
  else writeFileSync(path, text);
}
if (check && stale) process.exit(1);
console.error(check ? 'schemas are up to date' : `wrote ${stale} schema file(s)`);
