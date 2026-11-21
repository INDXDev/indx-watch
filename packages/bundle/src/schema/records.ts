/**
 * Result-store records (docs/spec/sync.md#records). JSON, not TOML.
 * FROZEN CONTRACT for v0.1: additive changes only.
 */
import { z } from 'zod';
import { FxVersion, idOf, Locale, RecordSig, Sha256, TcVersion, Via } from './common.js';
import { DateTime, EvidenceKind, JudgeKind } from './definitions.js';

/** http(s) URLs only: other schemes (javascript:, file:) are never rendered as links. */
const HttpUrl = z.string().regex(/^https?:\/\/[^\s]+$/i);

export const ActorKind = z.enum(['human', 'ci', 'agent']);
export type ActorKind = z.infer<typeof ActorKind>;
export const Actor = z.strictObject({
  kind: ActorKind,
  id: z.string().min(1),
  name: z.string().optional(),
  via: Via,
  model: z.string().optional(),
});
export type Actor = z.infer<typeof Actor>;

export const Source = z.enum(['manual', 'playwright', 'agent', 'cli', 'ci', 'import']);
export type Source = z.infer<typeof Source>;

export const VerdictValue = z.enum(['pass', 'fail', 'blocked', 'skipped', 'needs_review']);
export type VerdictValue = z.infer<typeof VerdictValue>;
export const StepStatus = z.enum(['pass', 'fail', 'blocked', 'skipped']);
export type StepStatus = z.infer<typeof StepStatus>;

export const Build = z.strictObject({
  commit: z
    .string()
    .regex(/^[0-9a-f]{7,64}$/)
    .optional(),
  ref: z.string().optional(),
  dirty: z.boolean().optional(),
  url: HttpUrl.optional(),
});
export type Build = z.infer<typeof Build>;

export const CiContext = z.strictObject({
  provider: z.string(),
  url: HttpUrl.optional(),
  run_id: z.string().optional(),
  run_attempt: z.number().int().optional(),
  job: z.string().optional(),
  workflow: z.string().optional(),
  event: z.string().optional(),
  repository: z.string().optional(),
  pr: z.number().int().optional(),
});
export type CiContext = z.infer<typeof CiContext>;

export const Evidence = z.strictObject({
  sha256: Sha256,
  name: z.string().min(1),
  media_type: z.string().min(1),
  size: z.number().int().min(0),
  kind: EvidenceKind,
  step: z.number().int().positive().optional(),
});
export type Evidence = z.infer<typeof Evidence>;

export const Judgement = z.strictObject({
  id: idOf('jdg'),
  kind: JudgeKind,
  verdict: z.enum(['pass', 'fail', 'blocked', 'skipped', 'unknown', 'diff']),
  confidence: z.number().min(0).max(1).optional(),
  /** visual judge: changed-pixel ratio */
  diff_ratio: z.number().min(0).max(1).optional(),
  reason: z.string().optional(),
  /** Playwright title path or rule name that produced it */
  test: z.string().optional(),
  flaky: z.boolean().optional(),
  by: Actor.optional(),
  at: DateTime.optional(),
  /** content language the reviewer read and wrote the reason in (v0.2) */
  locale: Locale.optional(),
});
export type Judgement = z.infer<typeof Judgement>;

export const StepResult = z.strictObject({
  index: z.number().int().positive(),
  status: StepStatus,
  note: z.string().optional(),
  evidence: z.array(Sha256).optional(),
});
export type StepResult = z.infer<typeof StepResult>;

/** Envelope fields; every record starts with kind and id, then these (canonical key order). */
const envelope = {
  v: z.literal(1),
  project: idOf('prj'),
  at: DateTime,
  actor: Actor,
  source: Source,
  /** signature of a trusted writer (v0.2, docs/spec/sync.md#signed-records) */
  sig: RecordSig.optional(),
};
const TcRef = z.strictObject({ id: idOf('tc'), key: z.string(), version: TcVersion });

export const RunRecord = z.strictObject({
  kind: z.literal('run'),
  id: idOf('run'),
  ...envelope,
  test_case: TcRef,
  fixtures: z
    .array(
      z.strictObject({
        id: idOf('fx'),
        key: z.string(),
        version: FxVersion,
        rows: z.array(z.string()).optional(),
      }),
    )
    .default([]),
  release: z.string().optional(),
  environment: z.string().optional(),
  build: Build.default({}),
  ci: CiContext.optional(),
  started_at: DateTime.optional(),
  ended_at: DateTime,
  reported: z.enum(['blocked', 'skipped']).nullable().default(null),
  locale: Locale.optional(),
  note: z.string().optional(),
  steps: z.array(StepResult).default([]),
  evidence: z.array(Evidence).default([]),
  judgements: z.array(Judgement).default([]),
  automation: z
    .strictObject({
      framework: z.string(),
      project: z.string().optional(),
      group: z.string().optional(),
      file: z.string().optional(),
    })
    .optional(),
});
export type RunRecord = z.infer<typeof RunRecord>;

export const JudgementRecord = z.strictObject({
  kind: z.literal('judgement'),
  id: idOf('rec'),
  ...envelope,
  run: idOf('run'),
  judgement: Judgement,
});
export type JudgementRecord = z.infer<typeof JudgementRecord>;

export const WaiverRecord = z.strictObject({
  kind: z.literal('waiver'),
  id: idOf('wvr'),
  ...envelope,
  release: z.string().min(1),
  test_case: z.strictObject({ id: idOf('tc'), key: z.string() }),
  reason: z.string().min(1),
  /** test case version the waiver applies to; it stops applying when the version changes */
  version: TcVersion.optional(),
  run: idOf('run').optional(),
  revokes: idOf('wvr').optional(),
});
export type WaiverRecord = z.infer<typeof WaiverRecord>;

export const DeploymentRecord = z.strictObject({
  kind: z.literal('deployment'),
  id: idOf('dep'),
  ...envelope,
  environment: z.string().min(1),
  build: Build,
  release: z.string().optional(),
  url: HttpUrl.optional(),
});
export type DeploymentRecord = z.infer<typeof DeploymentRecord>;

export const BundleRecord = z.strictObject({
  kind: z.literal('bundle'),
  id: idOf('rec'),
  ...envelope,
  commit: z.string().optional(),
  /** committer date of commit; snapshots are ordered by commit_time, then at */
  commit_time: DateTime.optional(),
  ref: z.string().optional(),
  sha256: Sha256,
  /** hash over the definition files (sorted path + sha256 list); used to skip unchanged snapshots */
  definitions_hash: Sha256,
  files: z.number().int().min(0),
  /** uncommitted changes were included (`iw push`, v0.2) */
  dirty: z.boolean().optional(),
  /** free text from `iw push --message` or the upload dialog (v0.2) */
  message: z.string().optional(),
});
export type BundleRecord = z.infer<typeof BundleRecord>;

/** Reserved for workspace mode (v0.2, roadmap T-209); not written by v0.1 tools. */
export const FileRecord = z.strictObject({
  kind: z.literal('file'),
  id: idOf('rec'),
  ...envelope,
  path: z.string().min(1),
  sha256: Sha256.optional(),
  deleted: z.boolean().optional(),
  bases: z.array(Sha256).default([]),
});
export type FileRecord = z.infer<typeof FileRecord>;

/** Hides a record (e.g. a run attributed to the wrong release) from the model; nothing is deleted. */
export const RetractionRecord = z.strictObject({
  kind: z.literal('retraction'),
  id: idOf('rec'),
  ...envelope,
  target: z.string().min(1),
  reason: z.string().min(1),
});
export type RetractionRecord = z.infer<typeof RetractionRecord>;

export const AnyRecord = z.discriminatedUnion('kind', [
  RunRecord,
  JudgementRecord,
  WaiverRecord,
  DeploymentRecord,
  BundleRecord,
  FileRecord,
  RetractionRecord,
]);
export type AnyRecord = z.infer<typeof AnyRecord>;
export type RecordKind = AnyRecord['kind'];

/** Body of one object under v1/log/ in a store. */
export const LogObject = z.strictObject({
  v: z.literal(1),
  writer: z.string().min(1),
  records: z.array(z.unknown()).max(1000),
});
export type LogObject = z.infer<typeof LogObject>;

const LogKey = z.string().regex(/^v1\/log\/[0-9A-HJKMNP-TV-Z]{26}\.json$/);
/** Body of one object under v1/snapshots/: copies of log objects, in key order (docs/spec/sync.md#log-snapshots-v02). */
export const LogSnapshot = z.object({
  v: z.literal(1),
  format: z.literal('indx-watch-log-snapshot'),
  project: idOf('prj'),
  upto: LogKey,
  logs: z.array(z.object({ key: LogKey, records: z.array(z.unknown()) })),
});
export type LogSnapshot = z.infer<typeof LogSnapshot>;

/** indx-watch-store.json at the store prefix root. */
export const StoreManifest = z.strictObject({
  format: z.literal('indx-watch-store'),
  version: z.literal(1),
  project: idOf('prj'),
});
export type StoreManifest = z.infer<typeof StoreManifest>;
