/**
 * Pure domain logic. CONTRACT: signatures frozen; implementation T-103.
 */
import type { Locale } from '@indx-watch/bundle';
import type { PlanItemStatus, Scope, StatusResult } from './types.js';

/** decide(judgements, policy, ctx): the decision policy (docs/spec/concepts.md#decision-policy). */
export { decide } from './decide.js';
/** buildModel(bundle, records): unknown/invalid records are skipped and reported. */
export { buildModel, buildVerifiedModel, verifyRecords } from './model.js';
export { reportData } from './report.js';
/**
 * testCaseStatus(model, key, scope): latest relevant result of one test case in a scope.
 * computeStatus(model, scope): everything `iw status` shows.
 * evaluateGate(model, scope): the readiness gate (docs/spec/concepts.md#readiness-gate).
 * planItemStatus(model, planKey, itemIndex): status of plan item #itemIndex (0-based);
 * scope = (plan.release, item.environment ?? plan.environment).
 */
export { computeStatus, evaluateGate, gateTestCases, planItemStatus, testCaseStatus } from './status.js';
export * from './types.js';

/** Extra options localize() reads at run time (the frozen signature stays unchanged). */
export interface LocalizeOptions {
  currentSourceHash?: string;
  allowStale?: boolean;
  /** the project's source_locale; without it the source locale is inferred from the translation tables */
  sourceLocale?: Locale;
}

/** Resolve a translated field (docs/spec/i18n.md). */
export function localize(
  entity: { i18n?: Partial<Record<Locale, Record<string, unknown>>> | undefined } & Record<string, unknown>,
  field: string,
  locale: Locale,
  opts?: LocalizeOptions,
): { text: string; locale: Locale; fallback: boolean; stale: boolean } {
  const o = (opts ?? {}) as LocalizeOptions;
  const source = typeof entity[field] === 'string' ? (entity[field] as string) : '';
  const tables = Object.keys(entity.i18n ?? {}) as Locale[];
  const sourceLocale = o.sourceLocale ?? (tables.length ? (tables.includes('ja') ? 'en' : 'ja') : undefined);
  const tr = locale === sourceLocale ? undefined : entity.i18n?.[locale];
  const text = tr?.[field];
  const stale = !!tr && o.currentSourceHash !== undefined && tr.source_hash !== o.currentSourceHash;
  if (typeof text === 'string' && (!stale || o.allowStale)) return { text, locale, fallback: false, stale };
  const from = sourceLocale ?? locale;
  return { text: source, locale: from, fallback: from !== locale || sourceLocale === undefined, stale };
}

/** Data for a release or plan report (docs/spec/reports.md#contents); rendering lives in the server package. */
export interface ReportData {
  project: { key: string; name: string };
  scope: Scope;
  plan?: string | undefined;
  audience: 'internal' | 'customer';
  generatedAt: string;
  generatedBy: string;
  bundleCommit?: string | undefined;
  cursor?: string | undefined;
  policy: Required<import('@indx-watch/bundle').DecisionPolicy>;
  gateThresholds: Record<string, number | boolean>;
  countsByPriority: Record<import('@indx-watch/bundle').Priority, Record<string, number>>;
  planItems?: {
    testCase: string;
    assignee?: string | undefined;
    due?: string | undefined;
    environment?: string | undefined;
    status: PlanItemStatus;
  }[];
  status: StatusResult;
  failures: {
    testCase: string;
    title: string;
    priority: import('@indx-watch/bundle').Priority;
    status: string;
    run?: string | undefined;
    step?: number | undefined;
    note?: string | undefined;
    evidence?: string | undefined;
  }[];
  waivers: { testCase: string; reason: string; by: string; at: string }[];
  runs: {
    id: string;
    testCase: string;
    version: string;
    verdict: string;
    actor: string;
    actorKind: string;
    /** claims a verified `via` without a valid signature (docs/spec/security.md#signed-records) */
    unverified?: true;
    source: string;
    commit?: string | undefined;
    environment?: string | undefined;
    at: string;
    evidence: number;
    ciUrl?: string | undefined;
  }[];
}
