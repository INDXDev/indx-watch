/**
 * `/mcp`: the tools of `iw mcp` (tools.ts) over Streamable HTTP, behind the same identity as /api
 * (docs/spec/agents.md#mcp-server). Writes record the request's identity with kind "agent".
 */
import * as B from '@indx-watch/bundle';
import { decide, type Model, runFacts } from '@indx-watch/core';
import { createMcpHandler, type McpServer } from '@modelcontextprotocol/server';
import type { Context, Hono } from 'hono';
import type { z } from 'zod';
import type { Ctx } from './app.js';
import { renderReport } from './report.js';
import { evidenceOf, reportOf, resolveRelease, runFixtures } from './routes.js';
import * as T from './tools.js';
import { memoryBundleFs, safePath } from './upload.js';

/** Stateless: each request gets a fresh server bound to that request's identity. */
export function registerMcpRoute(app: Hono, x: Ctx, outputs: T.ToolOutputs) {
  app.all('/mcp', (c) => {
    const factory = () => T.createToolServer(outputs, (server) => hostedTools(x, c, server));
    return createMcpHandler(factory).fetch(c.req.raw);
  });
}

const CODES: Record<string, string> = {
  'not-found': 'NOT_FOUND',
  invalid: 'INVALID_INPUT',
  forbidden: 'USAGE',
};
const { fail } = T;
const recordsOf = (m: Model) => [...[...m.runs.values()].map((v) => v.record), ...m.waivers];

function hostedTools(x: Ctx, c: Context, server: McpServer): T.ToolHandlers {
  /** errors become the tool's { code, message, details } */
  const run = (f: () => Promise<T.ToolResult>) =>
    f().catch((e: Error & { code?: string; details?: unknown[] }) =>
      T.toolError(CODES[e.code ?? ''] ?? e.code ?? 'INTERNAL', e.message, e.details),
    );
  const scope = (m: Model, release = m.project.current_release, environment?: string) => ({
    ...{ release, environment },
  });
  /** the agent behind a write: the identity of the request with kind "agent" and the model, which it must give */
  const agent = async (given?: string, lead = false) => {
    const { role } = await x.grant(c);
    if (role !== 'lead' && (lead || role !== 'tester')) fail('USAGE', `The ${role} role cannot write here`);
    const { model, warnings } = T.writeModel(server, given);
    if (!model) fail('USAGE', 'Agent writes over HTTP need your model ID: pass model');
    return { actor: { ...(await x.actor(c)), kind: 'agent' as const, model }, warnings };
  };
  const read = (f: (m: Model) => unknown) => run(async () => T.toolData(f(await x.model(c))));
  return {
    status: (i) => read((m) => T.statusData(m, scope(m, i.release, i.environment))),
    list: ({ kind, limit, ...f }) => read((m) => ({ items: T.listItems(m, kind, f, scope(m), limit) })),
    show: ({ ref }) => read((m) => T.showEntity(m, ref, scope(m))),
    check: () =>
      run(async () => {
        const files = await (
          x.deps.bundleFiles ?? (() => fail('USAGE', 'This server has no bundle files'))
        )();
        const knownKeys = T.knownKeys(recordsOf(await x.model(c)));
        return T.toolData(await B.checkBundle(memoryBundleFs(new Map(files)), { knownKeys }));
      }),
    new: (i) => run(() => createDraft(x, i, agent)),
    record_run: (i) => run(() => recordRun(x, i, agent)),
    report: ({ release, format }) =>
      run(async () => {
        const m = await x.model(c);
        const [a, locale] = [await x.actor(c), m.project.source_locale];
        const data = await reportOf(x, m, a, { scope: scope(m, release), audience: 'internal', locale });
        if (format === 'json') return T.toolData(data);
        return T.toolText(await renderReport(data, { format: 'md', locale, evidence: 'links' }));
      }),
    sync: async () =>
      T.toolError(
        'USAGE',
        'The hosted server is the result store; run iw sync (or iw mcp) where the files are',
      ),
  };
}
type Agent = (given?: string, lead?: boolean) => Promise<{ actor: B.Actor; warnings: B.Problem[] }>;

/** `new`: an AI draft written into the served bundle, like an upload by the request's identity. */
async function createDraft(
  x: Ctx,
  i: Record<string, unknown> & { fields: Record<string, unknown> },
  agent: Agent,
) {
  const { actor, warnings } = await agent(i.model as string | undefined, true);
  const { bundleFiles, publishBundle } = x.deps;
  if (!bundleFiles || !publishBundle) fail('USAGE', 'This server cannot write definitions');
  const files = new Map(await bundleFiles!());
  const fs = memoryBundleFs(files);
  const bundle = (await B.loadBundle(fs)).bundle ?? fail('INVALID_CONFIG', 'The served bundle does not load');
  const kind = T.NEW_KINDS[i.kind as string]!;
  const fields = { ...i.fields };
  if (kind === 'criterion') {
    fields.text = fields.title ?? fields.text;
    delete fields.title;
  }
  const ai = { model: actor.model!, ...(typeof i.skill === 'string' && { skill: i.skill }) };
  const parent = (kind === 'use-case' ? i.feature : i.uc) as string | undefined;
  const knownKeys = T.knownKeys(recordsOf(await x.model(null)));
  const r = await B.createDefinition(fs, bundle, { kind, fields, parent, origin: 'ai', ai, knownKeys });
  // a release version or environment name becomes the file name: never outside the bundle (like uploads)
  if (!safePath(r.file)) fail('INVALID_INPUT', `${JSON.stringify(r.file)} is not a path inside the bundle`);
  await publishBundle!(files, { actor, changed: [r.file], removed: [], message: `MCP new ${r.key}` });
  return T.toolData(r, warnings);
}

type RunInput = z.infer<typeof T.TOOL_INPUTS.record_run>;
/** `record_run`: an agent run with an llm judgement; evidence names blobs uploaded with POST /api/blobs. */
async function recordRun(x: Ctx, i: RunInput, agent: Agent) {
  const m = await x.model(null);
  const tc =
    m.testCases.get(T.resolveKey(m, i.test_case)) ?? fail('NOT_FOUND', `${i.test_case} is not a test case`);
  const { actor, warnings } = await agent(i.model);
  const evidence: B.Evidence[] = [];
  for (const e of i.evidence ?? []) {
    const [, sha = e, step] = /^(.*?)(?:@(\d+))?$/.exec(e) ?? [];
    evidence.push(await evidenceOf(x, sha, step ? Number(step) : undefined));
  }
  const shas = (n: number) => evidence.filter((e) => e.step === n).map((e) => e.sha256);
  const steps = (i.steps ?? []).map((s) => ({
    ...s,
    ...(shas(s.index).length && { evidence: shas(s.index) }),
  }));
  const [at, build, ci] = [x.now(), (await x.deps.context?.build()) ?? {}, await x.deps.context?.ci()];
  const release = resolveRelease(m, undefined, build, ci);
  const reported = i.verdict === 'blocked' || i.verdict === 'skipped' ? i.verdict : null;
  const by = { by: actor, at, confidence: i.confidence, reason: i.note };
  const judgement = { id: B.newId('jdg'), kind: 'llm', verdict: i.verdict, ...by };
  const run = B.RunRecord.parse({
    ...{ kind: 'run', id: B.newId('run'), v: 1, project: m.project.id, at, actor, source: 'agent' },
    ...{
      test_case: { id: tc.data.id, key: tc.data.key, version: tc.version },
      fixtures: runFixtures(m, tc, null),
    },
    ...{
      release,
      environment: m.project.default_environment,
      build,
      ci,
      ended_at: at,
      reported,
      note: i.note,
    },
    ...{ steps, evidence, judgements: [judgement] },
  });
  await x.deps.writeRecord(run);
  const d = decide(run.judgements, tc.policy, runFacts(tc, reported));
  const check = { kind: 'llm', conf: i.confidence, verdict: i.verdict, evidence: evidence.length, release };
  return T.toolData({ run, verdict: d.verdict, rule: d.rule }, [...T.recordWarnings(check), ...warnings]);
}
