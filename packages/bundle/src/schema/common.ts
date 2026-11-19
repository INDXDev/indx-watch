/**
 * Shared building blocks for every bundle file and record schema.
 * Field order in each z.strictObject() is the canonical key order (docs/spec/bundle-format.md).
 */
import { z } from 'zod';

export const ID_PREFIXES = {
  project: 'prj',
  environment: 'env',
  release: 'rel',
  feature: 'fea',
  useCase: 'uc',
  criterion: 'ac',
  testCase: 'tc',
  fixture: 'fx',
  plan: 'pln',
  run: 'run',
  judgement: 'jdg',
  deployment: 'dep',
  waiver: 'wvr',
  record: 'rec',
} as const;
export type IdPrefix = (typeof ID_PREFIXES)[keyof typeof ID_PREFIXES];

const ULID = '[0-9A-HJKMNP-TV-Z]{26}';
export const idOf = (prefix: IdPrefix) =>
  z.string().regex(new RegExp(`^${prefix}_${ULID}$`), `must be ${prefix}_<ULID>`);

export const KEY_PATTERNS = {
  project: /^[A-Z][A-Z0-9]{1,9}$/,
  feature: /^FEAT-[1-9][0-9]*$/,
  useCase: /^UC-[1-9][0-9]*$/,
  criterion: /^AC-[1-9][0-9]*\.[1-9][0-9]*$/,
  testCase: /^TC-[1-9][0-9]*$/,
  fixture: /^FX-[1-9][0-9]*$/,
  plan: /^PLAN-[1-9][0-9]*$/,
} as const;
export const keyOf = (kind: keyof typeof KEY_PATTERNS) => z.string().regex(KEY_PATTERNS[kind]);

export const Locale = z.enum(['en', 'ja']);
export type Locale = z.infer<typeof Locale>;
export const Priority = z.enum(['P0', 'P1', 'P2', 'P3']);
export type Priority = z.infer<typeof Priority>;
export const DefStatus = z.enum(['draft', 'ready', 'deprecated']);
export type DefStatus = z.infer<typeof DefStatus>;
export const Origin = z.enum(['human', 'ai', 'import']);
export type Origin = z.infer<typeof Origin>;
export const Tag = z.string().regex(/^[a-z0-9][a-z0-9-]*$/);
/** Secret references only, never values (docs/spec/security.md#secrets). */
export const SecretRef = z.string().regex(/^(env|cf|gh|op|aws-sm|gcp-sm|vault):[A-Za-z0-9_./-]+$/);
export const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);
/** 12 hex chars: versions and translation source hashes. */
export const ShortHash = z.string().regex(/^[0-9a-f]{12}$/);
export const TcVersion = z.string().regex(/^tcv:[0-9a-f]{12}$/);
export const FxVersion = z.string().regex(/^fxv:[0-9a-f]{12}$/);
/** TOML local date (YYYY-MM-DD); smol-toml yields a TomlDate which the loader normalizes to string. */
export const LocalDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .meta({ toml: 'date' });
/** RFC 3339 UTC, second precision. */
export const DateTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/)
  .meta({ toml: 'datetime' });

/** Translation table: fields depend on the entity; status/source_hash are always last. */
export const translation = <S extends z.ZodRawShape>(fields: S) =>
  z.strictObject({
    ...fields,
    status: z.enum(['machine', 'reviewed']),
    source_hash: ShortHash,
  });

export const AiMeta = z.strictObject({
  model: z.string().min(1),
  skill: z.string().optional(),
  created_at: DateTime,
});
export type AiMeta = z.infer<typeof AiMeta>;

/** Free-form extension table, preserved and sorted alphabetically. */
export const Extra = z.record(z.string(), z.unknown());

export const SCHEMA_BASE_URL = 'https://raw.githubusercontent.com/INDXDev/indx-watch/main/schemas/v1';
export const SCHEMA_VERSION = 1;
