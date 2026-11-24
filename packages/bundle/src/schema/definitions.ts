/**
 * Schemas for every definition file in .indx-watch/ (docs/spec/bundle-format.md).
 * FROZEN CONTRACT for v0.1: additive changes only; change requests go to the lead.
 */
import { z } from 'zod';
import {
  AiMeta,
  DateTime,
  DefStatus,
  Extra,
  idOf,
  keyOf,
  LocalDate,
  Locale,
  Origin,
  Priority,
  SecretRef,
  Sha256,
  Sharee,
  SigningKey,
  Tag,
  translation,
} from './common.js';

/** Fields shared by most definitions, in canonical order after id/key/title. */
const lifecycle = {
  status: DefStatus.optional(),
  origin: Origin.optional(),
  approved_by: z.string().optional(),
  /** version (tcv:/fxv:) or use-case content hash at approval; written by `iw approve` */
  approved_version: z.string().optional(),
  tags: z.array(Tag).optional(),
};
/** Origin mark of features, environments, releases and plans (no status: an AI one is approved, not made ready). */
const authored = {
  origin: Origin.optional(),
  /** human who reviewed an AI-written item (`iw approve`); without it `iw check` warns */
  approved_by: z.string().optional(),
};
const tail = {
  notes: z.string().optional(),
  ai: AiMeta.optional(),
  x: Extra.optional(),
};

// ---------- project.toml ----------
export const Gate = z.strictObject({
  p0_coverage: z.number().min(0).max(1).optional(),
  p0_all_pass: z.boolean().optional(),
  p1_pass_rate: z.number().min(0).max(1).optional(),
  max_needs_review: z.number().int().min(0).optional(),
  max_untested: z.number().int().min(0).optional(),
  allow_stale: z.boolean().optional(),
  require_evidence: z.boolean().optional(),
  /** evaluate the gate without records that claim a verified `via` but carry no valid signature (v0.2) */
  ignore_unverified: z.boolean().optional(),
});
export type Gate = z.infer<typeof Gate>;
export const GATE_DEFAULTS: Required<Gate> = {
  p0_coverage: 1,
  p0_all_pass: true,
  p1_pass_rate: 0.95,
  max_needs_review: 0,
  max_untested: 0,
  allow_stale: false,
  require_evidence: true,
  ignore_unverified: false,
};

export const DecisionPolicy = z.strictObject({
  llm_pass_confidence: z.number().min(0).max(1).optional(),
  llm_fail_confidence: z.number().min(0).max(1).optional(),
  visual_threshold: z.number().min(0).max(1).optional(),
  require_human_for: z.array(Priority).optional(),
});
export type DecisionPolicy = z.infer<typeof DecisionPolicy>;
export const DECISION_POLICY_DEFAULTS: Required<DecisionPolicy> = {
  llm_pass_confidence: 0.8,
  llm_fail_confidence: 0.8,
  visual_threshold: 0.01,
  require_human_for: [],
};

export const StoreConfig = z.strictObject({
  url: z.string().regex(/^(file|s3|https?):\/\//),
  mode: z.enum(['git', 'workspace']).optional(),
  evidence: z.enum(['on-demand', 'all', 'none']).optional(),
  endpoint: z.string().url().optional(),
  region: z.string().optional(),
  force_path_style: z.boolean().optional(),
});
export type StoreConfig = z.infer<typeof StoreConfig>;

export const Role = z.enum(['lead', 'tester', 'viewer', 'customer']);
export type Role = z.infer<typeof Role>;
const principals = z.array(z.string().min(1)).optional();
export const Roles = z.strictObject({
  ...{ lead: principals, tester: principals, viewer: principals, customer: principals },
  default: Role.optional(),
});
export type Roles = z.infer<typeof Roles>;

export const HostingConfig = z.strictObject({
  provider: z.literal('cloudflare'),
  name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/),
  r2_bucket: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,62}$/)
    .optional(),
  d1_database: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,62}$/)
    .optional(),
  access_team: z.string().optional(),
  access_aud: z.string().optional(),
  branch: z.string().optional(),
  /** GitHub repositories (owner/name or repository ID) whose OIDC tokens the Worker signs for (docs/spec/security.md#github-oidc) */
  oidc_repositories: z.array(z.string().min(1)).optional(),
  /** Access emails or groups per role on the hosted app (v0.3, docs/spec/security.md#roles) */
  roles: Roles.optional(),
});
export type HostingConfig = z.infer<typeof HostingConfig>;

/** (v0.5) the version everything pins, and the fork whose releases to follow */
export const Tool = z.strictObject({
  indx_watch: z
    .string()
    .regex(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/)
    .optional(),
  source: z
    .string()
    .regex(/^github:[\w.-]+\/[\w.-]+$/)
    .optional(),
});
export type Tool = z.infer<typeof Tool>;

/** (v0.5) report branding; `logo` is a file in `ui/` (checked by `iw check`) */
export const ReportBrand = z.strictObject({
  title: z.string().min(1).max(120).optional(),
  logo: z.string().min(1).optional(),
  footer: z.string().max(500).optional(),
});
export type ReportBrand = z.infer<typeof ReportBrand>;

export const Project = z.strictObject({
  schema_version: z.number().int().positive(),
  id: idOf('prj'),
  key: keyOf('project'),
  name: z.string().min(1),
  source_locale: Locale,
  locales: z.array(Locale).min(1),
  default_environment: z.string().optional(),
  current_release: z.string().optional(),
  /** branch whose builds fall back to current_release (default 'main') */
  default_branch: z.string().optional(),
  gate: Gate.optional(),
  decision_policy: DecisionPolicy.optional(),
  fixtures: z.strictObject({ inline_max_bytes: z.number().int().positive().optional() }).optional(),
  store: StoreConfig.optional(),
  hosting: HostingConfig.optional(),
  /** public keys whose record signatures readers trust (v0.2, docs/spec/security.md#signed-records) */
  signing_keys: z.array(SigningKey).optional(),
  glossary: z.array(z.strictObject({ term: z.string(), definition: z.string() })).optional(),
  tool: Tool.optional(),
  report: ReportBrand.optional(),
  notes: z.string().optional(),
  x: Extra.optional(),
});
export type Project = z.infer<typeof Project>;

// ---------- environments/<name>.toml ----------
const Hook = z.strictObject({
  method: z.enum(['POST', 'PUT']).optional(),
  url: z.string().min(1),
  secret_ref: SecretRef.optional(),
});
export const Environment = z.strictObject({
  id: idOf('env'),
  name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  title: z.string().min(1),
  ...authored,
  base_url: z.string().url(),
  accounts: z.array(keyOf('fixture')).optional(),
  guide: z.string().optional(),
  access: z
    .strictObject({
      method: z.enum(['public', 'basic', 'cloudflare_access', 'vpn', 'sso', 'other']),
      secret_refs: z.array(SecretRef).optional(),
    })
    .optional(),
  hooks: z.strictObject({ seed: Hook.optional(), reset: Hook.optional() }).optional(),
  i18n: z
    .partialRecord(Locale, translation({ title: z.string().optional(), guide: z.string().optional() }))
    .optional(),
  ...tail,
});
export type Environment = z.infer<typeof Environment>;

// ---------- releases/<version>.toml ----------
export const Release = z.strictObject({
  id: idOf('rel'),
  version: z.string().min(1),
  title: z.string().optional(),
  ...authored,
  state: z.enum(['planning', 'testing', 'ready', 'released']),
  target_date: LocalDate.optional(),
  refs: z.array(z.string()).optional(),
  /** when set, the readiness gate only counts test cases in this plan */
  plan: keyOf('plan').optional(),
  i18n: z.partialRecord(Locale, translation({ title: z.string().optional() })).optional(),
  ...tail,
});
export type Release = z.infer<typeof Release>;

/** A plan item assignee or a feature owner: an email, `ci`, `agent:<name>` or `group:<name>`. */
export const Assignee = z.string().regex(/^(ci|agent:[a-z0-9-]+|group:\S.*|[^@\s]+@[^@\s]+)$/);

// ---------- specs/<FEAT>/feature.toml ----------
export const Feature = z.strictObject({
  id: idOf('fea'),
  key: keyOf('feature'),
  title: z.string().min(1),
  ...authored,
  description: z.string().optional(),
  /** (v0.4) emails, actor IDs or `group:<name>`: whose "my features" this is (docs/spec/concepts.md#feature-owners) */
  owners: z.array(Assignee).optional(),
  i18n: z
    .partialRecord(Locale, translation({ title: z.string().optional(), description: z.string().optional() }))
    .optional(),
  ...tail,
});
export type Feature = z.infer<typeof Feature>;

// ---------- specs/<FEAT>/<UC>/use-case.toml ----------
export const Criterion = z.strictObject({
  id: idOf('ac'),
  key: keyOf('criterion'),
  text: z.string().min(1),
  /** default ready; draft (e.g. AI-proposed) and retired criteria do not count; retired keeps the key reserved */
  status: z.enum(['draft', 'ready', 'retired']).optional(),
  origin: Origin.optional(),
  /** human who approved an AI-proposed criterion (`iw approve AC-n.m`); required for origin "ai" to count */
  approved_by: z.string().optional(),
  ai: AiMeta.optional(),
  notes: z.string().optional(),
  i18n: z.partialRecord(Locale, translation({ text: z.string() })).optional(),
});
export type Criterion = z.infer<typeof Criterion>;

export const UseCase = z.strictObject({
  id: idOf('uc'),
  key: keyOf('useCase'),
  title: z.string().min(1),
  ...lifecycle,
  actor: z.string().min(1),
  goal: z.string().min(1),
  priority: Priority,
  links: z.array(z.string().url()).optional(),
  criteria: z.array(Criterion).min(1),
  i18n: z
    .partialRecord(
      Locale,
      translation({
        title: z.string().optional(),
        actor: z.string().optional(),
        goal: z.string().optional(),
      }),
    )
    .optional(),
  ...tail,
});
export type UseCase = z.infer<typeof UseCase>;

// ---------- specs/<FEAT>/<UC>/TC-<n>-<slug>.toml ----------
export const Mode = z.enum(['manual', 'playwright', 'agent', 'hybrid']);
export type Mode = z.infer<typeof Mode>;
export const EvidenceKind = z.enum(['screenshot', 'video', 'trace', 'log', 'file']);
export type EvidenceKind = z.infer<typeof EvidenceKind>;
export const JudgeKind = z.enum(['assert', 'visual', 'llm', 'human']);
export type JudgeKind = z.infer<typeof JudgeKind>;

const text = z.string().optional();
const onePath = z.string().regex(/^\/(?!\/)/);
export const Step = z.strictObject({
  instruction: z.string().min(1),
  expected: z.string().min(1),
  /** yes/no observations that make up `expected` (guidance: not part of the version) */
  checks: z.array(z.string().min(1)).optional(),
  evidence: z.array(EvidenceKind).optional(),
  i18n: z
    .partialRecord(
      Locale,
      translation({ instruction: text, expected: text, checks: z.array(z.string()).optional() }),
    )
    .optional(),
});
export type Step = z.infer<typeof Step>;

export const FixtureRef = z.strictObject({
  ref: keyOf('fixture'),
  rows: z.array(z.string()).optional(),
  apply: z.enum(['before_run']).optional(),
  /** what the tester does with the data (guidance: not part of the version) */
  use: z.enum(['download', 'upload', 'enter', 'seeded']).optional(),
  note: text,
  i18n: z.partialRecord(Locale, translation({ note: text })).optional(),
});
export type FixtureRef = z.infer<typeof FixtureRef>;

export const JudgeConfig = z.strictObject({
  kind: JudgeKind,
  rubric: z.array(z.string()).optional(),
  baseline: z.string().optional(),
});
export type JudgeConfig = z.infer<typeof JudgeConfig>;

export const TestCase = z.strictObject({
  id: idOf('tc'),
  key: keyOf('testCase'),
  title: z.string().min(1),
  ...lifecycle,
  covers: z.array(keyOf('criterion')).min(1),
  priority: Priority.optional(),
  mode: Mode,
  /** (v0.4) guidance (not part of the version): `bdd` shows preconditions and steps as Given / When / Then */
  style: z.enum(['steps', 'bdd']).optional(),
  /** guidance (not part of the version): what the feature is for and what this test proves */
  purpose: text,
  /** path appended to the environment's base_url where the tester starts: `/cart`, never `//host/cart` */
  start: onePath.optional(),
  start_note: text,
  preconditions: z.string().optional(),
  fixtures: z.array(FixtureRef).optional(),
  steps: z.array(Step).min(1),
  judges: z.array(JudgeConfig).optional(),
  decision_policy: DecisionPolicy.optional(),
  automation: z.strictObject({ files: z.array(z.string()).optional() }).optional(),
  i18n: z
    .partialRecord(Locale, translation({ title: text, preconditions: text, purpose: text, start_note: text }))
    .optional(),
  ...tail,
});
export type TestCase = z.infer<typeof TestCase>;

/**
 * Fields whose canonical form defines the test case version (docs/spec/concepts.md#versions-and-staleness).
 * steps[].i18n is excluded; the text of each covered criterion is included.
 */
export const TEST_CASE_VERSION_FIELDS = [
  'covers',
  'mode',
  'preconditions',
  'fixtures',
  'steps',
  'judges',
  'decision_policy',
] as const;

// ---------- fixtures/<FX>/fixture.toml ----------
export const FixtureKind = z.enum(['dataset', 'seed', 'file', 'account']);
export type FixtureKind = z.infer<typeof FixtureKind>;
export const Fixture = z.strictObject({
  id: idOf('fx'),
  key: keyOf('fixture'),
  title: z.string().min(1),
  ...lifecycle,
  kind: FixtureKind,
  files: z.array(z.string().regex(/^[^/\\]+$/)).optional(),
  row_key: z.string().optional(),
  hook: z.enum(['seed', 'reset']).optional(),
  account: z
    .strictObject({
      username: z.string().min(1),
      secret_ref: SecretRef,
      fields: z.record(z.string(), z.string()).optional(),
    })
    .optional(),
  /** (v0.5) only these people, groups and leads see it; absent: the whole team (docs/spec/security.md#sharing) */
  shared_with: z.array(Sharee).optional(),
  i18n: z.partialRecord(Locale, translation({ title: z.string().optional() })).optional(),
  ...tail,
});
export type Fixture = z.infer<typeof Fixture>;

/** Fields excluded from the fixture version hash. */
export const FIXTURE_VERSION_EXCLUDED = [
  'title',
  'status',
  'origin',
  'approved_by',
  'approved_version',
  'tags',
  'notes',
  'ai',
  'x',
  'i18n',
  'shared_with',
] as const;

// ---------- <file>.blob.toml ----------
export const BlobPointer = z.strictObject({
  sha256: Sha256,
  size: z.number().int().min(0),
  media_type: z.string().min(1),
});
export type BlobPointer = z.infer<typeof BlobPointer>;

// ---------- plans/<PLAN>-<slug>.toml ----------
export const PlanItem = z.strictObject({
  test_case: keyOf('testCase'),
  assignee: Assignee.optional(),
  environment: z.string().optional(),
  due: LocalDate.optional(),
  notes: z.string().optional(),
});
export type PlanItem = z.infer<typeof PlanItem>;
export const Plan = z.strictObject({
  id: idOf('pln'),
  key: keyOf('plan'),
  title: z.string().min(1),
  ...authored,
  release: z.string().optional(),
  environment: z.string().optional(),
  due: LocalDate.optional(),
  items: z.array(PlanItem).optional(),
  i18n: z.partialRecord(Locale, translation({ title: z.string().optional() })).optional(),
  ...tail,
});
export type Plan = z.infer<typeof Plan>;

// ---------- registry ----------
export const FILE_TYPES = {
  project: Project,
  environment: Environment,
  release: Release,
  feature: Feature,
  'use-case': UseCase,
  'test-case': TestCase,
  fixture: Fixture,
  'blob-pointer': BlobPointer,
  plan: Plan,
} as const;
export type FileType = keyof typeof FILE_TYPES;

/** Datetime used in AiMeta etc. re-exported for convenience. */
export { DateTime, Sha256 };
