/**
 * Model → response shapes of contract.ts. Pure apart from reading fixture data through a callback.
 * Rules (status, verdicts, plan items) come only from packages/core.
 */
import { TRANSLATABLE_FIELDS, translationSourceHash } from '@indx-watch/bundle';
import type { RunView, Scope } from '@indx-watch/core';
import {
  computeStatus,
  type FixtureNode,
  type Model,
  planItemStatus,
  testCaseStatus,
} from '@indx-watch/core';
import type { FixtureDetail, PlanView, RunSummary, SpecTree, TestCaseDetail } from './contract.js';

type Obj = Record<string, unknown>;
export type ReadFile = (path: string) => Promise<Uint8Array | null>;

/** A copy whose `i18n` tables say `status: "stale"` when their source_hash no longer matches the source. */
export async function markStale<T extends object>(entity: T, kind: keyof typeof TRANSLATABLE_FIELDS) {
  const e: Obj = { ...(entity as Obj) };
  const hash = e.i18n ? await translationSourceHash(e, TRANSLATABLE_FIELDS[kind]) : '';
  const mark = ([l, t]: [string, Obj]) => [l, t.source_hash === hash ? t : { ...t, status: 'stale' }];
  if (e.i18n) e.i18n = Object.fromEntries(Object.entries(e.i18n as Record<string, Obj>).map(mark));
  const all = (xs: unknown, k: typeof kind) => Promise.all((xs as Obj[]).map((x) => markStale(x, k)));
  if (kind === 'test-case') e.steps = await all(e.steps, 'step');
  if (kind === 'use-case') e.criteria = await all(e.criteria, 'criterion');
  return e as T;
}

export function runSummary(v: RunView, model: Model): RunSummary {
  const { id, actor, source, release, environment, test_case: tc, build, ended_at: at } = v.record;
  const [testCase, evidence] = [model.keyOf(tc.id) ?? tc.key, v.record.evidence?.length ?? 0];
  const { verdict, rule } = v.decision;
  const more = { release, environment, commit: build?.commit, at, evidence };
  return { id, testCase, version: tc.version, verdict, rule, stale: v.stale, actor, source, ...more };
}

/** Non-retracted runs, newest first, filtered by test case ID and scope. */
export function listRuns(model: Model, f: Scope & { tcId?: string | undefined }): RunView[] {
  const ok = (want: string | undefined, have: string | undefined) => !want || want === have;
  const match = ({ record: r, retracted }: RunView) =>
    !retracted && ok(f.tcId, r.test_case.id) && ok(f.release, r.release) && ok(f.environment, r.environment);
  const runs = [...model.runs.values()].filter(match);
  const order = (v: RunView) => `${v.record.ended_at}|${v.record.id}`;
  return runs.sort((a, b) => (order(a) < order(b) ? 1 : -1));
}

export async function specTree(model: Model, scope: Scope): Promise<SpecTree> {
  const status = computeStatus(model, scope);
  const tcStatus = new Map(status.testCases.map((t) => [t.key, t.status]));
  const testCase = async (k: string) => {
    const t = model.testCases.get(k)!;
    const { title, mode, status: lifecycle = 'draft', i18n } = await markStale(t.data, 'test-case');
    return { key: k, title, mode, status: tcStatus.get(k) ?? 'untested', lifecycle, i18n };
  };
  const useCase = async (u: Model['features'][number]['useCases'][number]) => {
    const s = status.useCases.find((x) => x.key === u.data.key);
    const { key, title, priority, i18n, criteria } = await markStale(u.data, 'use-case');
    const nodes = u.criteria.filter((c) => c.data.status !== 'retired');
    const acs = nodes.map(async (c) => {
      const tcs = await Promise.all([...c.testCases, ...c.draftTestCases].map(testCase));
      const st = s?.criteria.find((x) => x.key === c.data.key)?.status ?? 'uncovered';
      const i18n = criteria.find((x) => x.key === c.data.key)?.i18n;
      return { key: c.data.key, text: c.data.text, status: st, testCases: tcs, i18n };
    });
    const [st, done] = [s?.status ?? 'uncovered', !!s?.done];
    return { key, title, priority, status: st, done, i18n, criteria: await Promise.all(acs) };
  };
  const features = model.features.map(async (f) => {
    const { key, title, i18n } = await markStale(f.data, 'feature');
    const useCases = await Promise.all(f.useCases.filter((u) => u.data.status !== 'deprecated').map(useCase));
    return { key, title, i18n, useCases };
  });
  return { scope, features: await Promise.all(features) };
}

/** Minimal CSV (RFC 4180 quoting) → rows keyed by the header. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [[]];
  for (const [, cell = '', end] of text.matchAll(/("(?:[^"]|"")*"|[^,\r\n]*)(,|\r?\n|$)/g)) {
    rows.at(-1)!.push(cell.startsWith('"') ? cell.slice(1, -1).replaceAll('""', '"') : cell);
    if (end !== ',') rows.push([]);
    if (!end) break;
  }
  const [head = [], ...body] = rows.filter((r) => r.some((c) => c !== ''));
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), r[i] ?? ''])));
}

/** Rows of a dataset fixture (CSV or JSON array files, in file order). */
export async function datasetRows(fx: FixtureNode, read: ReadFile): Promise<Record<string, string>[]> {
  const out: Record<string, string>[] = [];
  for (const f of fx.dataFiles) {
    const text = f.pointer ? null : new TextDecoder().decode((await read(f.file)) ?? new Uint8Array());
    if (text && f.name.endsWith('.csv')) out.push(...parseCsv(text));
    if (!text || !f.name.endsWith('.json')) continue;
    const rows = JSON.parse(text) as unknown;
    for (const r of Array.isArray(rows) ? (rows as Obj[]) : [])
      out.push(Object.fromEntries(Object.entries(r ?? {}).map(([k, v]) => [k, String(v ?? '')])));
  }
  return out;
}

const MEDIA: Record<string, string> = { csv: 'text/csv', json: 'application/json', png: 'image/png' };
export const mediaOf = (name: string) => MEDIA[name.split('.').pop()?.toLowerCase() ?? ''];

export async function fixtureDetail(fx: FixtureNode, read: ReadFile): Promise<FixtureDetail> {
  const { kind, account, key } = fx.data;
  const seed = fx.dataFiles.find((x) => !x.pointer);
  const bytes = kind === 'seed' && seed ? await read(seed.file) : null;
  const text = bytes ? new TextDecoder().decode(bytes.slice(0, 100_000)) : '';
  const preview =
    kind === 'dataset'
      ? { rows: (await datasetRows(fx, read)).slice(0, 200) }
      : account
        ? { rows: [{ username: account.username, secret_ref: account.secret_ref }] }
        : text
          ? { text }
          : undefined;
  const files = fx.dataFiles.map(({ name, sha256, size, pointer: p }) => ({
    ...{ name, sha256: p?.sha256 ?? sha256, size: p?.size ?? size },
    ...{ pointer: !!p, media_type: p?.media_type ?? mediaOf(name) },
  }));
  const data = await markStale(fx.data, 'fixture');
  return { key, file: fx.file, version: fx.version, data, files, preview, usedBy: fx.usedBy };
}

export async function testCaseDetail(model: Model, key: string, scope: Scope, read: ReadFile) {
  const t = model.testCases.get(key)!;
  const refs = (t.data.fixtures ?? []).filter((r) => model.fixtures.has(r.ref));
  const fixtures = refs.map(async ({ ref, rows }) => {
    const fx = model.fixtures.get(ref)!;
    const { kind, account, row_key, title } = fx.data;
    let values: Record<string, string>[] | undefined = account ? [{ username: account.username }] : undefined;
    if (kind === 'dataset') {
      const all = await datasetRows(fx, read);
      const col = row_key ?? Object.keys(all[0] ?? {})[0] ?? '';
      values = rows ? all.filter((r) => rows.includes(r[col] ?? '')) : all;
    }
    return { key: ref, title, kind, version: fx.version, ...(rows && { rows }), ...(values && { values }) };
  });
  const { file, version, priority, useCase } = t;
  const runs = listRuns(model, { ...scope, tcId: t.data.id }).map((v) => runSummary(v, model));
  const status = testCaseStatus(model, key, scope);
  const data = await markStale(t.data, 'test-case');
  const detail = { key, file, version, priority, useCase, data, fixtures: await Promise.all(fixtures) };
  return { ...detail, status, runs } satisfies TestCaseDetail;
}

export function planViews(model: Model): PlanView[] {
  return model.plans.map(({ key, title, release, environment, due, items = [] }) => ({
    ...{ key, title, release, environment, due },
    items: items.map((it, i) => ({
      ...{ test_case: it.test_case, assignee: it.assignee, environment: it.environment ?? environment },
      ...{ due: it.due ?? due, status: planItemStatus(model, key, i) },
    })),
  }));
}
