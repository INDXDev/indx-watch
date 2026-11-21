/**
 * Public JSON output contract of `iw --json` (docs/spec/cli.md#json-envelope).
 * FROZEN CONTRACT for v0.1: additive changes only. Tests validate every command's output against these.
 */
import { z } from 'zod';

export const Problem = z.object({
  severity: z.enum(['error', 'warning']),
  code: z.string(),
  file: z.string().optional(),
  path: z.string().optional(),
  message: z.string(),
});

export const ErrorCode = z.enum([
  'CHECK_FAILED',
  'GATE_FAILED',
  'USAGE',
  'NOT_FOUND',
  'AMBIGUOUS_REF',
  'NO_BUNDLE',
  'UNSUPPORTED_SCHEMA',
  'INVALID_CONFIG',
  'INVALID_INPUT',
  'SECRETS_FOUND',
  'STORE_ERROR',
  'EXTERNAL_TOOL',
  'CONFLICT',
  'INTERNAL',
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

/** Exit code per error code (docs/spec/cli.md#exit-codes). */
export const EXIT_CODES: Record<ErrorCode, 0 | 1 | 2 | 3 | 4> = {
  CHECK_FAILED: 1,
  GATE_FAILED: 1,
  CONFLICT: 1,
  SECRETS_FOUND: 1,
  USAGE: 2,
  NOT_FOUND: 2,
  AMBIGUOUS_REF: 2,
  INVALID_INPUT: 2,
  NO_BUNDLE: 3,
  UNSUPPORTED_SCHEMA: 3,
  INVALID_CONFIG: 3,
  STORE_ERROR: 4,
  EXTERNAL_TOOL: 4,
  INTERNAL: 4,
};

export const okEnvelope = <T extends z.ZodTypeAny>(data: T) =>
  z.object({ ok: z.literal(true), command: z.string(), data, warnings: z.array(Problem) });

export const ErrorEnvelope = z.object({
  ok: z.literal(false),
  command: z.string(),
  error: z.object({ code: ErrorCode, message: z.string(), details: z.array(z.unknown()).optional() }),
  /** commands like `check` and `status --gate` still return their data on a "no" answer */
  data: z.unknown().optional(),
});

const Gate = z.object({
  passed: z.boolean(),
  checks: z.array(
    z.object({
      key: z.string(),
      passed: z.boolean(),
      actual: z.string(),
      expected: z.string(),
      items: z.array(z.string()).optional(),
    }),
  ),
});

const REASON = { file: z.string(), pattern: z.string().optional() };

/** `data` shape per command. */
export const CommandData = {
  init: z.object({ dir: z.string(), files: z.array(z.string()) }),
  check: z.object({
    files: z.number(),
    errors: z.number(),
    warnings: z.number(),
    problems: z.array(Problem),
    changed: z.array(z.string()),
    renumbered: z.array(z.object({ from: z.string(), to: z.string(), id: z.string() })),
  }),
  fmt: z.object({ changed: z.array(z.string()) }),
  new: z.object({ kind: z.string(), id: z.string(), key: z.string(), file: z.string() }),
  status: z.object({
    scope: z.object({ release: z.string().nullable(), environment: z.string().nullable() }),
    gate: Gate,
    coverage: z.object({ covered: z.number(), total: z.number(), ratio: z.number() }),
    useCases: z.array(z.record(z.string(), z.unknown())),
    testCases: z.array(z.record(z.string(), z.unknown())),
    counts: z.record(z.string(), z.number()),
  }),
  /** docs/spec/concepts.md#impact-analysis */
  impact: z.object({
    ...{ base: z.string().nullable(), changed: z.array(z.string()) },
    testCases: z.array(
      z.object({
        ...{ key: z.string(), id: z.string(), title: z.string(), status: z.string(), priority: z.string() },
        reasons: z.array(z.object({ kind: z.enum(['automation', 'definition', 'fixture']), ...REASON })),
      }),
    ),
  }),
  show: z.record(z.string(), z.unknown()),
  list: z.object({ items: z.array(z.record(z.string(), z.unknown())) }),
  record: z.object({ run: z.record(z.string(), z.unknown()), verdict: z.string(), rule: z.number() }),
  review: z.object({ judgement: z.record(z.string(), z.unknown()), verdict: z.string() }),
  judge: z.object({
    judgement: z.record(z.string(), z.unknown()),
    verdict: z.string(),
    recorded: z.boolean(),
  }),
  waive: z.object({ waiver: z.record(z.string(), z.unknown()) }),
  approve: z.object({ ref: z.string(), file: z.string(), version: z.string(), approved_by: z.string() }),
  retract: z.object({ retraction: z.record(z.string(), z.unknown()) }),
  'deployment add': z.object({ deployment: z.record(z.string(), z.unknown()) }),
  login: z.object({ url: z.string() }),
  keygen: z.object({
    kid: z.string(),
    public_key: z.string(),
    via: z.array(z.string()).optional(),
    /** the IW_SIGNING_KEY value: store it as a secret, never in files */
    secret: z.string(),
    /** the [[signing_keys]] entry for project.toml */
    toml: z.string(),
  }),
  'fixture add': z.object({
    files: z.array(z.object({ name: z.string(), sha256: z.string(), pointer: z.boolean() })),
  }),
  'fixture fetch': z.object({
    files: z.array(
      /** path: absolute path of the file (cache/blobs/<sha256> for a pointer, or the copy with --out) */
      z.object({ name: z.string(), sha256: z.string(), pointer: z.boolean(), path: z.string().optional() }),
    ),
  }),
  sync: z.object({
    pushed: z.object({ records: z.number(), blobs: z.number() }),
    pulled: z.object({ records: z.number(), blobs: z.number() }),
    snapshot: z.string().nullable(),
    cursor: z.string().nullable(),
    /** non-fatal problems (unreadable log objects, records held back) */
    warnings: z.array(z.string()).optional(),
    /** secret-scan problems of records held back from the push */
    held: z.array(Problem).optional(),
  }),
  push: z.object({
    snapshot: z.string().nullable(),
    files: z.number(),
    unchanged: z.boolean(),
    pushed: z.object({ records: z.number(), blobs: z.number() }),
    url: z.string().nullable(),
  }),
  clone: z.object({
    dir: z.string(),
    snapshot: z.string(),
    files: z.number(),
    pulled: z.object({ records: z.number(), blobs: z.number() }),
  }),
  translate: z.union([
    z.object({
      ref: z.string().nullable(),
      locale: z.string(),
      fields: z.array(
        z.object({
          ref: z.string(),
          path: z.string(),
          source: z.string(),
          text: z.string().optional(),
          state: z.enum(['missing', 'machine', 'reviewed', 'stale']),
        }),
      ),
    }),
    z.object({
      ref: z.string(),
      locale: z.string(),
      file: z.string(),
      status: z.string(),
      written: z.array(z.string()),
    }),
  ]),
  serve: z.object({ url: z.string() }),
  report: z.object({
    file: z.string().nullable(),
    gate: Gate,
    /** the rendered report, when --json is used without --out for md/json */
    text: z.string().optional(),
  }),
  export: z.object({
    archive: z.string(),
    manifest: z.object({ sha256: z.string(), files: z.number(), records: z.number(), blobs: z.number() }),
  }),
  import: z.union([
    z.object({
      archive: z.string(),
      manifest: z.object({ sha256: z.string(), files: z.number(), records: z.number(), blobs: z.number() }),
      dryRun: z.boolean(),
      changes: z.array(z.string()),
    }),
    /** iw import playwright-plan: one draft test case per planner scenario */
    z.object({
      plan: z.string(),
      uc: z.string(),
      created: z.array(z.object({ kind: z.string(), id: z.string(), key: z.string(), file: z.string() })),
    }),
  ]),
  deploy: z.object({
    resources: z.array(
      z.object({ type: z.enum(['r2', 'd1', 'worker']), name: z.string(), exists: z.boolean() }),
    ),
    commands: z.array(z.string()),
    url: z.string().nullable(),
  }),
  reindex: z.object({ records: z.number(), definitions: z.number(), ms: z.number() }),
  migrate: z.object({ from: z.number(), to: z.number(), changed: z.array(z.string()) }),
  'skills install': z.object({ installed: z.array(z.string()) }),
} as const;
export type CommandName = keyof typeof CommandData;
