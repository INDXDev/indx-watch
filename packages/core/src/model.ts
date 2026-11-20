/**
 * Bundle + records → Model (docs/architecture.md#core-model).
 */
import {
  type AnyRecord,
  type Bundle,
  type BundleRecord,
  DECISION_POLICY_DEFAULTS,
  type DeploymentRecord,
  type Judgement,
  type JudgementRecord,
  type Priority,
  type RunRecord,
  verifiedClaims,
  verifyRecord,
  type WaiverRecord,
} from '@indx-watch/bundle';
import { byAtThenId, decide } from './decide.js';
import type {
  CriterionNode,
  FeatureNode,
  FixtureNode,
  Model,
  RunView,
  TestCaseNode,
  UseCaseNode,
} from './types.js';

/** Priority order: lower rank is more important. */
export const PRIORITY_RANK: Record<Priority, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
/** Snapshot order: by commit_time, then at, then id (docs/spec/sync.md#snapshots-from-people-v02). */
const snapOrder = (r: BundleRecord) => `${r.commit_time ?? ''}|${r.at}|${r.id}`;
const KINDS = new Set(['run', 'judgement', 'waiver', 'deployment', 'bundle', 'file', 'retraction']);
const keyNum = (k: string) => Number(/(\d+)(?:\.(\d+))?$/.exec(k)?.[1] ?? 0);
/** Sorts keys by their trailing number (`UC-2` before `UC-10`), then as strings. */
export const byKey = (a: string, b: string) => keyNum(a) - keyNum(b) || (a < b ? -1 : a > b ? 1 : 0);

type Policy = TestCaseNode['policy'];
type TestCaseData = Bundle['testCases'][number]['data'];

/** Bundle entities as nodes, plus every entity ID mapped to its key (or name/version). */
interface Index {
  ids: Map<string, string>;
  policy: Policy;
  useCases: Map<string, UseCaseNode>;
  criteria: Map<string, CriterionNode>;
  features: FeatureNode[];
  testCases: Map<string, TestCaseNode>;
  tcById: Map<string, TestCaseNode>;
  fixtures: Map<string, FixtureNode>;
  fxById: Map<string, FixtureNode>;
}

/** Records deduplicated by ID, with the IDs that retractions target. */
interface RecordSet {
  byId: Map<string, AnyRecord>;
  all: AnyRecord[];
  retracted: Set<string>;
}

/** What building the run views needs; `flagged` collects `<run id>#<judgement id>` of unverified judgements. */
interface RunContext {
  index: Index;
  set: RecordSet;
  unverified?: ReadonlySet<string>;
  warnings: string[];
  flagged: Set<string>;
}

function indexUseCases(bundle: Bundle, ids: Map<string, string>) {
  const useCases = new Map<string, UseCaseNode>();
  const criteria = new Map<string, CriterionNode>();
  for (const uc of bundle.useCases) {
    const key = uc.data.key;
    const nodes = uc.data.criteria.map(
      (c): CriterionNode => ({ data: c, useCase: key, testCases: [], draftTestCases: [] }),
    );
    useCases.set(key, { data: uc.data, file: uc.file, feature: uc.feature, criteria: nodes });
    ids.set(uc.data.id, key);
    for (const c of nodes) {
      criteria.set(c.data.key, c);
      ids.set(c.data.id, c.data.key);
    }
  }
  return { useCases, criteria };
}

/** The most important priority among the use cases a test case covers, if any. */
function inheritedPriority(covers: string[], idx: Pick<Index, 'useCases' | 'criteria'>) {
  let priority: Priority | undefined;
  for (const k of covers) {
    const c = idx.criteria.get(k);
    const up = c && idx.useCases.get(c.useCase)?.data.priority;
    if (up && (!priority || PRIORITY_RANK[up] < PRIORITY_RANK[priority])) priority = up;
  }
  return priority;
}

/** Lists a test case under each criterion it covers: ready ones as tests, drafts as draft tests. */
function linkCriteria(t: TestCaseData, criteria: Map<string, CriterionNode>) {
  const status = t.status ?? 'draft';
  for (const k of t.covers) {
    const c = criteria.get(k);
    if (status === 'ready') c?.testCases.push(t.key);
    else if (status === 'draft') c?.draftTestCases.push(t.key);
  }
}

function indexTestCases(bundle: Bundle, idx: Pick<Index, 'ids' | 'policy' | 'useCases' | 'criteria'>) {
  const testCases = new Map<string, TestCaseNode>();
  const tcById = new Map<string, TestCaseNode>();
  for (const t of bundle.testCases) {
    linkCriteria(t.data, idx.criteria);
    const node: TestCaseNode = {
      data: t.data,
      file: t.file,
      useCase: t.useCase,
      version: t.version,
      priority: t.data.priority ?? inheritedPriority(t.data.covers, idx) ?? 'P2',
      policy: { ...idx.policy, ...t.data.decision_policy },
    };
    testCases.set(t.data.key, node);
    tcById.set(t.data.id, node);
    idx.ids.set(t.data.id, t.data.key);
  }
  return { testCases, tcById };
}

function indexFixtures(bundle: Bundle, ids: Map<string, string>) {
  const fixtures = new Map<string, FixtureNode>();
  const fxById = new Map<string, FixtureNode>();
  for (const f of bundle.fixtures) {
    const usedBy = bundle.testCases
      .filter((t) => t.data.fixtures?.some((r) => r.ref === f.data.key))
      .map((t) => t.data.key);
    const node: FixtureNode = {
      data: f.data,
      file: f.file,
      version: f.version,
      dataFiles: f.dataFiles,
      usedBy,
    };
    fixtures.set(f.data.key, node);
    fxById.set(f.data.id, node);
    ids.set(f.data.id, f.data.key);
  }
  return { fixtures, fxById };
}

/** Indexes every bundle entity. IDs are registered in a fixed order, so a later duplicate ID wins as before. */
function indexBundle(bundle: Bundle): Index {
  const p = bundle.project.data;
  const ids = new Map<string, string>([[p.id, p.key]]);
  const policy = { ...DECISION_POLICY_DEFAULTS, ...p.decision_policy };
  const { useCases, criteria } = indexUseCases(bundle, ids);
  const features = bundle.features.map((f) => {
    ids.set(f.data.id, f.data.key);
    const ucs = [...useCases.values()].filter((u) => u.feature === f.data.key);
    return { data: f.data, file: f.file, useCases: ucs };
  });
  const tcs = indexTestCases(bundle, { ids, policy, useCases, criteria });
  const fxs = indexFixtures(bundle, ids);
  for (const pl of bundle.plans) ids.set(pl.data.id, pl.data.key);
  for (const e of bundle.environments) ids.set(e.data.id, e.data.name);
  for (const r of bundle.releases) ids.set(r.data.id, r.data.version);
  return { ids, policy, useCases, criteria, features, ...tcs, ...fxs };
}

/** Dedupes records by ID (first wins) and collects retractions; invalid and conflicting records become warnings. */
function collectRecords(records: Iterable<AnyRecord>, warnings: string[]): RecordSet {
  const byId = new Map<string, AnyRecord>();
  for (const r of records) {
    const rec = r as Partial<AnyRecord> | null;
    if (!rec || typeof rec !== 'object' || !KINDS.has(String(rec.kind)) || typeof rec.id !== 'string') {
      warnings.push(`Skipped an invalid record (${String(rec?.id ?? 'no id')})`);
      continue;
    }
    const seen = byId.get(rec.id);
    if (!seen) byId.set(rec.id, r);
    else if (JSON.stringify(seen) !== JSON.stringify(rec))
      warnings.push(`Record ${rec.id} appears twice with different content; kept the first`);
  }
  const all = [...byId.values()];
  const retracted = new Set(all.filter((r) => r.kind === 'retraction').map((r) => r.target));
  return { byId, all, retracted };
}

/** Records of one kind that are not retracted. */
const live = <K extends AnyRecord['kind']>(set: RecordSet, kind: K) =>
  set.all.filter((r): r is Extract<AnyRecord, { kind: K }> => r.kind === kind && !set.retracted.has(r.id));

/**
 * Judgement records grouped by run. Unverified ones are flagged per source record, so a forged record that
 * copies a judgement ID cannot mark the genuine judgement unverified.
 */
function laterJudgements(ctx: RunContext) {
  const later = new Map<string, Judgement[]>();
  for (const jr of live(ctx.set, 'judgement') as JudgementRecord[]) {
    if (!ctx.set.byId.has(jr.run)) ctx.warnings.push(`Judgement ${jr.id} refers to unknown run ${jr.run}`);
    const j = { ...jr.judgement, at: jr.judgement.at ?? jr.at, by: jr.judgement.by ?? jr.actor };
    later.set(jr.run, [...(later.get(jr.run) ?? []), j]);
    if (ctx.unverified?.has(jr.id)) ctx.flagged.add(`${jr.run}#${j.id}`);
  }
  return later;
}

function runView(r: RunRecord, later: Judgement[], ctx: RunContext): RunView {
  const tc = ctx.index.tcById.get(r.test_case?.id);
  if (!tc)
    ctx.warnings.push(`Run ${r.id} refers to a test case that is not in the bundle (${r.test_case?.key})`);
  const inline = (r.judgements ?? []).map((j) => ({ ...j, at: j.at ?? r.ended_at, by: j.by ?? r.actor }));
  if (ctx.unverified?.has(r.id)) for (const j of inline) ctx.flagged.add(`${r.id}#${j.id}`);
  const judgements = [...inline, ...later].sort(byAtThenId);
  const used = r.fixtures ?? [];
  const rows = used.flatMap((f) => f.rows ?? []).sort();
  const decision = decide(judgements, tc?.policy ?? ctx.index.policy, {
    priority: tc?.priority ?? 'P2',
    mode: tc?.data.mode ?? '',
    reported: r.reported ?? null,
    judges: tc?.data.judges?.map((j) => j.kind),
  });
  const fixtureChanged = used.some((f) => ctx.index.fxById.get(f.id)?.version !== f.version);
  return {
    record: r,
    judgements,
    decision,
    stale: !tc || tc.version !== r.test_case.version || fixtureChanged,
    variant: `${r.automation?.project ?? ''}|${rows.join(',')}`,
    group: r.automation?.group ?? r.id,
    retracted: ctx.set.retracted.has(r.id),
  };
}

/** Views of every run, retracted ones included, with their inline and later judgements. */
function buildRuns(ctx: RunContext) {
  const later = laterJudgements(ctx);
  const runs = new Map<string, RunView>();
  for (const r of ctx.set.all) if (r.kind === 'run') runs.set(r.id, runView(r, later.get(r.id) ?? [], ctx));
  return runs;
}

/** Resolves an ID, key or run ID (optionally prefixed with `<project key>:`) to a key or run ID. */
function keyResolver(projectKey: string, ids: Map<string, string>, runs: Map<string, RunView>) {
  const keys = new Set(ids.values());
  return (ref: string) => {
    const bare = ref.startsWith(`${projectKey}:`) ? ref.slice(projectKey.length + 1) : ref;
    if (keys.has(bare)) return bare;
    return ids.get(bare) ?? (runs.has(bare) ? bare : undefined);
  };
}

/**
 * Builds the model from a bundle and its records. Pass `unverified` (from verifyRecords()) to flag
 * judgements of unsigned records and, with `gate.ignore_unverified`, to add a verified-only model.
 */
export function buildModel(
  bundle: Bundle,
  records: Iterable<AnyRecord>,
  /** unverified: record IDs from verifyRecords() */
  opts: { unverified?: ReadonlySet<string> } = {},
): { model: Model; warnings: string[] } {
  const warnings: string[] = [];
  const p = bundle.project.data;
  const index = indexBundle(bundle);
  const set = collectRecords(records, warnings);
  const { unverified } = opts;
  const flagged = new Set<string>();
  const runs = buildRuns({ index, set, unverified, warnings, flagged });
  const model: Model = {
    project: p,
    environments: bundle.environments.map((e) => e.data),
    releases: bundle.releases.map((r) => r.data),
    plans: bundle.plans.map((pl) => pl.data),
    features: index.features,
    useCases: index.useCases,
    testCases: index.testCases,
    fixtures: index.fixtures,
    runs,
    waivers: live(set, 'waiver') as WaiverRecord[],
    deployments: live(set, 'deployment') as DeploymentRecord[],
    snapshots: (live(set, 'bundle') as BundleRecord[]).sort((a, b) => (snapOrder(a) < snapOrder(b) ? 1 : -1)),
    keyOf: keyResolver(p.key, index.ids, runs),
  };
  if (!unverified?.size) return { model, warnings };
  model.unverified = new Set([...unverified, ...flagged]);
  if (p.gate?.ignore_unverified)
    model.verifiedOnly = buildModel(
      bundle,
      set.all.filter((r) => !unverified.has(r.id)),
    ).model;
  return { model, warnings };
}

/** verifyRecords() results per isolate or process: keys JSON → record JSON → valid (a rebuild re-checks nothing). */
const verified = new Map<string, Map<string, boolean>>();

/**
 * IDs of records that claim a verified `via` without a valid signature by a key in project.toml
 * [[signing_keys]] (docs/spec/security.md#signed-records). buildModel() flags the judgements in them per run.
 */
export async function verifyRecords(bundle: Bundle, records: Iterable<AnyRecord>): Promise<Set<string>> {
  const keys = bundle.project.data.signing_keys ?? [];
  const out = new Set<string>();
  // results are cached by the exact keys and record bytes, so a forged body that copies id and sig misses the cache
  const cache = verified.get(JSON.stringify(keys)) ?? new Map<string, boolean>();
  if (cache.size > 50_000 || verified.size > 8) for (const m of [cache, verified]) m.clear();
  verified.set(JSON.stringify(keys), cache);
  const check = async (r: AnyRecord) => {
    if (!verifiedClaims(r).length) return;
    const json = JSON.stringify(r);
    const ok = cache.get(json) ?? (await verifyRecord(r, keys));
    cache.set(json, ok);
    if (!ok) out.add(r.id);
  };
  await Promise.all([...records].map(check));
  return out;
}

/** buildModel() with signatures checked: what the CLI and the server show. */
export async function buildVerifiedModel(bundle: Bundle, records: Iterable<AnyRecord>) {
  const list = [...records];
  return buildModel(bundle, list, { unverified: await verifyRecords(bundle, list) });
}
