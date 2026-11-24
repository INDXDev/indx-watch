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
const CI_VIA = ['gitlab', 'circleci', 'buildkite'] as const; // docs/spec/integrations.md#ci-identity-and-context
/** How an actor was identified (docs/spec/security.md#identity). */
export const Via = z.enum(['git', 'github', 'github-oidc', 'cloudflare-access', 'env', 'browser', ...CI_VIA]);
export type Via = z.infer<typeof Via>;
/** `via` values that claim a verified source; such records need a valid signature (docs/spec/security.md#signed-records). */
export const VERIFIED_VIA: readonly Via[] = ['cloudflare-access', 'github-oidc', 'github', ...CI_VIA];
export const Tag = z.string().regex(/^[a-z0-9][a-z0-9-]*$/);
/** Secret references only, never values (docs/spec/security.md#secrets). */
// `iw:` names follow SecretName, so every reference that passes can name a secret kept by INDX Watch
export const SecretRef = z
  .string()
  .regex(/^((env|cf|gh|op|aws-sm|gcp-sm|vault):[A-Za-z0-9_./-]+|iw:[A-Za-z0-9][A-Za-z0-9_.-]{0,63})$/);
/** Name of a secret kept by INDX Watch itself (`iw:<name>`, docs/spec/security.md#secrets) */
export const SecretName = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/);
/** Who an item is shared with: an email, `group:<name>` or `ci:access:<client id>` (docs/spec/security.md#sharing) */
export const Sharee = z.string().regex(/^(group:\S.*|ci:access:\S+|[^@\s:]+@[^@\s]+)$/);
/** base64url without padding */
const b64u = (bytes: number) =>
  z.string().regex(new RegExp(`^[A-Za-z0-9_-]{${Math.ceil((bytes * 4) / 3)}}$`));
/** A trusted record-signing public key (project.toml [[signing_keys]]). */
export const SigningKey = z.strictObject({
  kid: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/),
  /** raw Ed25519 public key */
  public_key: b64u(32),
  /** verified `via` values this key may vouch for (default: all) */
  via: z.array(Via).optional(),
  note: z.string().optional(),
});
export type SigningKey = z.infer<typeof SigningKey>;
/** Record signature: Ed25519 over the canonical record without `sig` (docs/spec/sync.md#signed-records). */
export const RecordSig = z.strictObject({
  alg: z.literal('Ed25519'),
  kid: SigningKey.shape.kid,
  value: b64u(64),
});
export type RecordSig = z.infer<typeof RecordSig>;
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
