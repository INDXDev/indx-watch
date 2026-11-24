/**
 * The one MCP tool set of `iw mcp` (stdio, packages/cli) and `/mcp` (Streamable HTTP, mcp.ts), and the list/show
 * data both return (docs/spec/agents.md#mcp-server). Errors are BundleErrors with a CLI error code.
 */
import * as B from '@indx-watch/bundle';
import * as core from '@indx-watch/core';
import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import PKG from '../package.json' with { type: 'json' };

const READ = { readOnlyHint: true, openWorldHint: false };
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const NETWORK = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const opt = z.string().optional();
const STATUS = z.enum(['pass', 'fail', 'blocked', 'skipped']);
const TICKS = z.array(z.boolean()).optional().describe("Which of the step's checks hold, in order");

export const TOOL_INPUTS = {
  status: z.object({ release: opt, environment: opt, mine: z.boolean().optional() }),
  list: z.object({
    kind: z.enum(['features', 'ucs', 'tcs', 'fixtures', 'envs', 'releases', 'plans', 'runs']),
    ...{ status: opt, tag: opt, priority: opt, mode: opt, uc: opt, tc: opt, release: opt },
    limit: z.number().int().positive().optional(),
  }),
  show: z.object({ ref: z.string() }),
  check: z.object({}),
  new: z.object({
    kind: z.enum(['feature', 'uc', 'ac', 'tc', 'fixture', 'env', 'release', 'plan']),
    fields: z
      .record(z.string(), z.unknown())
      .describe('Fields as in the TOML file: title, steps, covers, text …'),
    ...{
      uc: opt.describe('Parent use case of an ac or tc'),
      feature: opt.describe('Parent feature of a uc'),
    },
    ...{ model: opt.describe('Your model ID'), skill: opt },
  }),
  record_run: z.object({
    ...{ test_case: z.string(), verdict: STATUS, note: opt, confidence: z.number().min(0).max(1).optional() },
    steps: z
      .array(z.object({ index: z.number().int().positive(), status: STATUS, note: opt, checks: TICKS }))
      .optional(),
    evidence: z
      .array(z.string())
      .optional()
      .describe(
        'File paths (iw mcp) or sha256 of blobs uploaded with POST /api/blobs (/mcp), optionally with @step',
      ),
    model: opt.describe('Your model ID'),
  }),
  report: z.object({ release: opt, format: z.enum(['md', 'json']).default('md') }),
  sync: z.object({}),
};
export type ToolName = keyof typeof TOOL_INPUTS;
/** `iw new` and `new` kinds → definition kinds */
export const NEW_KINDS: Record<string, B.NewKind> = {
  ...{ feature: 'feature', uc: 'use-case', ac: 'criterion', tc: 'test-case', fixture: 'fixture' },
  ...{ env: 'environment', release: 'release', plan: 'plan' },
};
const ABOUT: Record<ToolName, [string, object]> = {
  status: ['Coverage, use case status and the readiness gate (= iw status --json; mine = --mine)', READ],
  list: ['List features, ucs, tcs, fixtures, envs, releases, plans or runs', READ],
  show: ['One entity (UC-n, TC-n, FX-n, PLAN-n, a run ID or prefix) with references and runs', READ],
  check: ['Validate the bundle; read problems[] (file, path, message)', READ],
  new: ['Create a definition as an AI draft (origin "ai"); a human approves it', WRITE],
  record_run: ['Record a run you executed: verdict, confidence (0-1), steps, evidence files', WRITE],
  report: ['Release report: Markdown text (md) or the report data (json)', READ],
  sync: ['Push and pull records and blobs with the store in project.toml', NETWORK],
};
/** Output schemas per tool (report has none): CommandData of packages/cli/src/json.ts, their home, passed in by the CLI. */
export type ToolOutputs = Record<Exclude<ToolName, 'report'>, z.ZodType>;

export type ToolResult = { content: { type: 'text'; text: string }[] } & {
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};
// biome-ignore lint/suspicious/noExplicitAny: inputs are validated by each tool's zod schema before the handler runs
export type ToolHandlers = Record<ToolName, (input: any) => Promise<ToolResult>>;
export const toolText = (text: string): ToolResult => ({ content: [{ type: 'text', text }] });
/** `data` becomes structuredContent; warnings follow as a second text block. */
export function toolData(data: unknown, warnings: B.Problem[] = []): ToolResult {
  const r = toolText(JSON.stringify(data));
  if (warnings.length) r.content.push({ type: 'text', text: JSON.stringify({ warnings }) });
  return { ...r, structuredContent: data as Record<string, unknown> };
}
export const toolError = (code: string, message: string, details?: unknown[]): ToolResult => ({
  ...toolText(JSON.stringify({ code, message, details })),
  isError: true,
});

/** An MCP server with the tools; there is no approve/review/waive tool. */
export function createToolServer(outputs: ToolOutputs, tools: (s: McpServer) => ToolHandlers): McpServer {
  const server = new McpServer({ name: 'indx-watch', version: PKG.version });
  const h = tools(server);
  for (const [name, inputSchema] of Object.entries(TOOL_INPUTS) as [ToolName, z.ZodType][]) {
    const [description, annotations] = ABOUT[name];
    const outputSchema = name === 'report' ? undefined : outputs[name];
    server.registerTool(name, { description, inputSchema, outputSchema, annotations }, h[name] as never);
  }
  return server;
}

/** The model of an agent's write: given, else the env fallback, else the MCP client's name with a warning. */
export function writeModel(server: McpServer, given?: string, fallback?: string) {
  const client = !given && !fallback && server.server.getClientVersion();
  const model = given ?? fallback ?? (client ? `${client.name}/${client.version}` : undefined);
  const message = `No model ID given; recorded the MCP client ${model} instead`;
  return { model, warnings: client ? [{ severity: 'warning' as const, code: 'no-model', message }] : [] };
}

/** A step's ticked checks need one entry per check of the step (docs/spec/sync.md#run-record). */
export const checksError = (steps: { checks?: string[] }[], s: { index: number; checks?: boolean[] }) =>
  s.checks && s.checks.length !== (steps[s.index - 1]?.checks?.length ?? 0)
    ? `step ${s.index}: checks must have one entry per check of the step`
    : undefined;

/** Warnings about a run that may not count the way the recorder expects. */
export function recordWarnings(c: {
  kind: string;
  conf?: number;
  verdict?: string;
  evidence: number;
  release?: string;
}) {
  const llm = c.kind === 'llm';
  const all = [
    [llm && c.conf === undefined, 'no-confidence', 'Agent verdicts need --confidence'],
    [llm && c.verdict === 'pass' && !c.evidence, 'no-evidence', 'An agent pass needs evidence'],
    [!c.release, 'no-release', 'No release for this build; the run does not count towards one'],
  ] as const;
  return all
    .filter(([on]) => on)
    .map(([, code, message]): B.Problem => ({ severity: 'warning', code, message }));
}

// ---------- data shared by the CLI commands and both tool hosts ----------

/** Throws a BundleError with a CLI error code. */
export const fail = (code: string, message: string, details?: unknown[]): never => {
  throw new B.BundleError(code, message, details);
};
const pick = (o: object, keys: string) =>
  Object.fromEntries(keys.split(' ').map((k) => [k, (o as Record<string, unknown>)[k]]));

/** Any ref (key, ID, PROJECT:KEY) → key. */
export function resolveKey(model: core.Model, ref: string): string {
  const pr = B.parseRef(ref);
  if (pr?.type === 'key' && pr.project && pr.project !== model.project.key)
    fail('NOT_FOUND', `${ref} belongs to project ${pr.project}, not ${model.project.key}`);
  return model.keyOf(pr?.type === 'key' ? pr.key : ref) ?? fail('NOT_FOUND', `${ref} not found`);
}

/** A run by ID or a unique prefix of ≥ 8 characters after run_. */
export function resolveRun(model: core.Model, ref: string): core.RunView {
  if (!/^run_[0-9A-Za-z]{8,}$/.test(ref)) fail('NOT_FOUND', `No run ${ref} (give ≥ 8 characters after run_)`);
  const hits = [...model.runs.keys()].filter((id) => id.startsWith(`run_${ref.slice(4).toUpperCase()}`));
  if (hits.length > 1) fail('AMBIGUOUS_REF', `${ref} matches ${hits.length} runs`, hits);
  return model.runs.get(hits[0] ?? fail('NOT_FOUND', `Run ${ref} not found`))!;
}

/** Keys used by records (test cases and fixtures), so retired keys are never reused. */
const used = (r: B.AnyRecord) =>
  r.kind === 'run' ? [r.test_case, ...(r.fixtures ?? [])] : r.kind === 'waiver' ? [r.test_case] : [];
export const knownKeys = (records: B.AnyRecord[]) => records.flatMap(used).map((x) => x.key);

const runSummary = (v: core.RunView) => ({
  ...pick(v.record, 'id at source release environment'),
  testCase: v.record.test_case.key,
  version: v.record.test_case.version,
  ...pick(v.decision, 'verdict rule'),
  actor: v.record.actor.id,
  commit: v.record.build.commit,
  ...pick(v, 'stale retracted'),
});
const newest = (x: core.RunView, y: core.RunView) =>
  x.record.at + x.record.id < y.record.at + y.record.id ? 1 : -1;
/** Runs of the given test cases, newest first. */
const runsOf = (m: core.Model, tcs: string[], limit = 10) =>
  [...m.runs.values()]
    .filter((v) => tcs.includes(v.record.test_case.key))
    .sort(newest)
    .slice(0, limit)
    .map(runSummary);

/** `iw status` data; with `who`, of the features they own, listed in `mine` (docs/spec/concepts.md#feature-owners). */
export function statusData(m: core.Model, scope: core.Scope, who?: core.Principal) {
  const features = who ? core.ownedFeatures(m, who) : [];
  return {
    ...core.computeStatus(who ? core.ownedModel(m, features) : m, scope),
    scope: { release: scope.release ?? null, environment: scope.environment ?? null },
    ...(who && { mine: { actor: who.id, features } }),
  };
}

/** `iw show` data (without --versions). */
export function showEntity(m: core.Model, ref: string, scope: core.Scope): Record<string, unknown> {
  if (ref.startsWith('run_')) {
    const v = resolveRun(m, ref);
    return { id: v.record.id, ...v };
  }
  const named = m.environments.find((e) => e.name === ref) ?? m.releases.find((r) => r.version === ref);
  if (named) return { ...named, runs: [] };
  const key = resolveKey(m, ref);
  const [tc, uc, fx] = [m.testCases.get(key), m.useCases.get(key), m.fixtures.get(key)];
  const plan = m.plans.find((x) => x.key === key);
  const feature = m.features.find((f) => f.data.key === key);
  const ac = [...m.useCases.values()].flatMap((u) => u.criteria).find((c) => c.data.key === key);
  const refs = (c: NonNullable<typeof ac>) => ({ ...c.data, ...pick(c, 'useCase testCases draftTestCases') });
  let e: Record<string, unknown>;
  if (tc)
    e = {
      ...tc.data,
      ...pick(tc, 'file useCase version priority'),
      result: core.testCaseStatus(m, key, scope),
    };
  else if (uc) {
    const result = core.computeStatus(m, scope).useCases.find((u) => u.key === key);
    e = { ...uc.data, ...pick(uc, 'file feature'), criteria: uc.criteria.map(refs), result };
  } else if (fx) e = { ...fx.data, ...pick(fx, 'file version dataFiles usedBy') };
  else if (plan)
    e = { ...plan, items: plan.items?.map((it, i) => ({ ...it, status: core.planItemStatus(m, key, i) })) };
  else if (feature)
    e = { ...feature.data, file: feature.file, useCases: feature.useCases.map((u) => u.data.key) };
  else e = refs(ac ?? fail('NOT_FOUND', `${ref} not found`));
  const covering = uc?.criteria.flatMap((c) => [...c.testCases, ...c.draftTestCases]);
  e.runs = runsOf(m, plan?.items?.map((i) => i.test_case) ?? covering ?? fx?.usedBy ?? [key]);
  return e;
}

export type ListFilters = Partial<
  Record<'status' | 'tag' | 'priority' | 'mode' | 'uc' | 'tc' | 'release', string>
>;
/** `iw list` items. */
export function listItems(m: core.Model, kind: string, f: ListFilters, scope: core.Scope, limit?: number) {
  const [uc, tc] = [f.uc && resolveKey(m, f.uc), f.tc && resolveKey(m, f.tc)];
  const inUc = (t: { useCase: string; data: { covers: string[] } }) =>
    !uc || t.useCase === uc || t.data.covers.some((c) => c.startsWith(`AC-${uc.slice(3)}.`));
  const draft = { status: 'draft' };
  const lists: Record<string, () => Record<string, unknown>[]> = {
    tc: () =>
      [...m.testCases.values()].filter(inUc).map((t) => {
        const { status: result, latestRun } = core.testCaseStatus(m, t.data.key, scope);
        const def = { ...draft, ...pick(t.data, 'key id title status mode covers tags') };
        return { ...def, ...pick(t, 'priority useCase file version'), result, latestRun };
      }),
    uc: () => {
      const st = core.computeStatus(m, scope).useCases;
      return [...m.useCases.values()].map((u) => ({
        ...{ ...draft, ...pick(u.data, 'key id title status priority tags'), ...pick(u, 'feature file') },
        criteria: u.criteria.map((c) => c.data.key),
        result: st.find((s) => s.key === u.data.key)?.status,
      }));
    },
    feature: () =>
      m.features.map((x) => ({ ...x.data, file: x.file, useCases: x.useCases.map((u) => u.data.key) })),
    fixture: () =>
      [...m.fixtures.values()].map((x) => ({
        ...{ ...draft, ...pick(x.data, 'key id title status kind tags'), ...pick(x, 'file version usedBy') },
        files: x.dataFiles.map((d) => d.name),
      })),
    env: () => m.environments,
    release: () => m.releases,
    plan: () => m.plans,
    run: () => runsOf(m, [...new Set([...m.runs.values()].map((v) => v.record.test_case.key))], Infinity),
  };
  const what = kind.replace(/s$/, '');
  const list = lists[what] ?? fail('USAGE', `Unknown list ${kind}; see iw list --help`);
  const has = (x: Record<string, unknown>, k: string, v?: string) =>
    !v || x[k] === v || (Array.isArray(x[k]) && (x[k] as unknown[]).includes(v));
  const items = list().filter(
    (x) =>
      (!f.status || [x.status, x.result, x.verdict].includes(f.status)) &&
      has(x, 'tags', f.tag) &&
      has(x, 'priority', f.priority) &&
      has(x, 'mode', f.mode) &&
      (what !== 'run' || ((!tc || x.testCase === tc) && has(x, 'release', f.release))),
  );
  // keys in number order (TC-2 before TC-10); runs keep their time order
  if (what !== 'run') items.sort((x, y) => (x.key && y.key ? core.byKey(`${x.key}`, `${y.key}`) : 0));
  return limit === undefined ? items : items.slice(0, limit);
}
