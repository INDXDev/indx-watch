/**
 * Bundle + records → Model (docs/architecture.md#core-model).
 */
import {
  type AnyRecord,
  type Bundle,
  DECISION_POLICY_DEFAULTS,
  type DeploymentRecord,
  type Judgement,
  type JudgementRecord,
  type Priority,
  type RunRecord,
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

export const PRIORITY_RANK: Record<Priority, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
const KINDS = new Set(['run', 'judgement', 'waiver', 'deployment', 'bundle', 'file', 'retraction']);
const keyNum = (k: string) => Number(/(\d+)(?:\.(\d+))?$/.exec(k)?.[1] ?? 0);
export const byKey = (a: string, b: string) => keyNum(a) - keyNum(b) || (a < b ? -1 : a > b ? 1 : 0);

export function buildModel(
  bundle: Bundle,
  records: Iterable<AnyRecord>,
): { model: Model; warnings: string[] } {
  const warnings: string[] = [];
  const p = bundle.project.data;
  const projectPolicy = { ...DECISION_POLICY_DEFAULTS, ...p.decision_policy };
  const ids = new Map<string, string>([[p.id, p.key]]);

  const useCases = new Map<string, UseCaseNode>();
  const criteria = new Map<string, CriterionNode>();
  for (const uc of bundle.useCases) {
    const node: UseCaseNode = {
      data: uc.data,
      file: uc.file,
      feature: uc.feature,
      criteria: uc.data.criteria.map((c) => ({
        data: c,
        useCase: uc.data.key,
        testCases: [],
        draftTestCases: [],
      })),
    };
    useCases.set(uc.data.key, node);
    ids.set(uc.data.id, uc.data.key);
    for (const c of node.criteria) {
      criteria.set(c.data.key, c);
      ids.set(c.data.id, c.data.key);
    }
  }
  const features: FeatureNode[] = bundle.features.map((f) => {
    ids.set(f.data.id, f.data.key);
    return {
      data: f.data,
      file: f.file,
      useCases: [...useCases.values()].filter((u) => u.feature === f.data.key),
    };
  });

  const testCases = new Map<string, TestCaseNode>();
  const tcById = new Map<string, TestCaseNode>();
  for (const t of bundle.testCases) {
    let priority: Priority | undefined;
    for (const k of t.data.covers) {
      const c = criteria.get(k);
      const up = c && useCases.get(c.useCase)?.data.priority;
      if (up && (!priority || PRIORITY_RANK[up] < PRIORITY_RANK[priority])) priority = up;
      if (c && t.data.status === 'ready') c.testCases.push(t.data.key);
      else if (c && (t.data.status ?? 'draft') === 'draft') c.draftTestCases.push(t.data.key);
    }
    const node: TestCaseNode = {
      data: t.data,
      file: t.file,
      useCase: t.useCase,
      version: t.version,
      priority: t.data.priority ?? priority ?? 'P2',
      policy: { ...projectPolicy, ...t.data.decision_policy },
    };
    testCases.set(t.data.key, node);
    tcById.set(t.data.id, node);
    ids.set(t.data.id, t.data.key);
  }

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
  for (const pl of bundle.plans) ids.set(pl.data.id, pl.data.key);
  for (const e of bundle.environments) ids.set(e.data.id, e.data.name);
  for (const r of bundle.releases) ids.set(r.data.id, r.data.version);
  const keys = new Set(ids.values());

  // records: dedupe by ID, collect retractions
  const byId = new Map<string, AnyRecord>();
  for (const r of records) {
    const rec = r as Partial<AnyRecord> | null;
    if (!rec || typeof rec !== 'object' || !KINDS.has(String(rec.kind)) || typeof rec.id !== 'string') {
      warnings.push(`Skipped an invalid record (${String(rec?.id ?? 'no id')})`);
      continue;
    }
    if (byId.has(rec.id)) {
      if (JSON.stringify(byId.get(rec.id)) !== JSON.stringify(rec))
        warnings.push(`Record ${rec.id} appears twice with different content; kept the first`);
      continue;
    }
    byId.set(rec.id, r);
  }
  const all = [...byId.values()];
  const retracted = new Set(all.filter((r) => r.kind === 'retraction').map((r) => r.target));
  const live = <K extends AnyRecord['kind']>(kind: K) =>
    all.filter((r): r is Extract<AnyRecord, { kind: K }> => r.kind === kind && !retracted.has(r.id));

  const later = new Map<string, Judgement[]>();
  for (const jr of live('judgement') as JudgementRecord[]) {
    if (!byId.has(jr.run)) warnings.push(`Judgement ${jr.id} refers to unknown run ${jr.run}`);
    const j = { ...jr.judgement, at: jr.judgement.at ?? jr.at, by: jr.judgement.by ?? jr.actor };
    later.set(jr.run, [...(later.get(jr.run) ?? []), j]);
  }
  const runs = new Map<string, RunView>();
  for (const r of all.filter((x): x is RunRecord => x.kind === 'run')) {
    const tc = tcById.get(r.test_case?.id);
    if (!tc)
      warnings.push(`Run ${r.id} refers to a test case that is not in the bundle (${r.test_case?.key})`);
    const inline = (r.judgements ?? []).map((j) => ({ ...j, at: j.at ?? r.ended_at, by: j.by ?? r.actor }));
    const judgements = [...inline, ...(later.get(r.id) ?? [])].sort(byAtThenId);
    const used = r.fixtures ?? [];
    const rows = used.flatMap((f) => f.rows ?? []).sort();
    runs.set(r.id, {
      record: r,
      judgements,
      decision: decide(judgements, tc?.policy ?? projectPolicy, {
        priority: tc?.priority ?? 'P2',
        mode: tc?.data.mode ?? '',
        reported: r.reported ?? null,
        judges: tc?.data.judges?.map((j) => j.kind),
      }),
      stale:
        !tc ||
        tc.version !== r.test_case.version ||
        used.some((f) => fxById.get(f.id)?.version !== f.version),
      variant: `${r.automation?.project ?? ''}|${rows.join(',')}`,
      group: r.automation?.group ?? r.id,
      retracted: retracted.has(r.id),
    });
  }

  const model: Model = {
    project: p,
    environments: bundle.environments.map((e) => e.data),
    releases: bundle.releases.map((r) => r.data),
    plans: bundle.plans.map((pl) => pl.data),
    features,
    useCases,
    testCases,
    fixtures,
    runs,
    waivers: live('waiver') as WaiverRecord[],
    deployments: live('deployment') as DeploymentRecord[],
    keyOf(ref: string) {
      const bare = ref.startsWith(`${p.key}:`) ? ref.slice(p.key.length + 1) : ref;
      if (keys.has(bare)) return bare;
      return ids.get(bare) ?? (runs.has(bare) ? bare : undefined);
    },
  };
  return { model, warnings };
}
