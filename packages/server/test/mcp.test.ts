/** `/mcp`: the MCP tools over Streamable HTTP on createApp (docs/spec/agents.md#mcp-server). */
import { parseToml } from '@indx-watch/bundle';
import { nodeFs } from '@indx-watch/bundle/node';
import { describe, expect, it } from 'vitest';
import { createApp, statusData } from '../src/index.js';
import { ALEX, fakeDeps, SHOP, SHOT_SHA } from './helpers.js';
import { mcpCall, mcpRequest } from './mcp-helpers.js';

const BASE = 'http://127.0.0.1';
/** The shop bundle files as a hosted server serves them. */
async function bundleFiles() {
  const fs = nodeFs(SHOP);
  const { walk } = await import('@indx-watch/bundle');
  const files = new Map<string, Uint8Array>();
  for (const p of await walk(fs, '')) files.set(p, (await fs.read(p))!);
  return files;
}

describe('/mcp', () => {
  it('lists the tools of iw mcp, read-only ones annotated', async () => {
    const { app } = { app: createApp((await fakeDeps()).deps) };
    const { tools } = await mcpRequest(app.fetch, BASE, 'tools/list', {});
    const names = tools.map((t: { name: string }) => t.name);
    expect(names).toEqual(['status', 'list', 'show', 'check', 'new', 'record_run', 'report', 'sync']);
    expect(tools[0].annotations).toMatchObject({ readOnlyHint: true });
  });

  it('read tools return the data of the CLI commands', async () => {
    const f = await fakeDeps();
    const app = createApp(f.deps);
    const r = await mcpCall(app.fetch, BASE, 'status', { release: 'v1.2.0' });
    const { model } = await f.deps.loadModel();
    expect(r.structuredContent).toEqual(statusData(model, { release: 'v1.2.0' }));
    const show = await mcpCall(app.fetch, BASE, 'show', { ref: 'TC-4' });
    expect(show.structuredContent).toMatchObject({
      key: 'TC-4',
      runs: [expect.objectContaining({ testCase: 'TC-4' })],
    });
    const list = await mcpCall(app.fetch, BASE, 'list', { kind: 'tcs', priority: 'P0' });
    expect(list.structuredContent.items.every((t: { priority: string }) => t.priority === 'P0')).toBe(true);
    const missing = await mcpCall(app.fetch, BASE, 'show', { ref: 'TC-999' });
    expect(missing.isError).toBe(true);
    expect(JSON.parse(missing.content[0].text)).toMatchObject({ code: 'NOT_FOUND' });
    const report = await mcpCall(app.fetch, BASE, 'report', { release: 'v1.2.0' });
    expect(report.content[0].text).toContain('TC-4');
    expect((await mcpCall(app.fetch, BASE, 'sync')).isError).toBe(true);
  });

  it('record_run writes an agent run as the request identity, with evidence uploaded before', async () => {
    const f = await fakeDeps();
    const app = createApp(f.deps);
    const r = await mcpCall(app.fetch, BASE, 'record_run', {
      ...{ test_case: 'TC-9', verdict: 'pass', confidence: 0.6, model: 'claude-test' },
      ...{ steps: [{ index: 1, status: 'pass' }], evidence: [`${SHOT_SHA}@1`] },
    });
    expect(r.structuredContent).toMatchObject({ verdict: 'needs_review', rule: 6 });
    const run = f.written[0] as Extract<(typeof f.written)[number], { kind: 'run' }>;
    expect(run.actor).toEqual({ ...ALEX, kind: 'agent', model: 'claude-test' });
    expect(run).toMatchObject({ source: 'agent', judgements: [{ kind: 'llm', confidence: 0.6 }] });
    expect(run.steps[0]).toMatchObject({ index: 1, evidence: [SHOT_SHA] });
    const unknown = await mcpCall(app.fetch, BASE, 'record_run', {
      ...{ test_case: 'TC-9', verdict: 'pass', evidence: ['0'.repeat(64)] },
    });
    expect(unknown.isError).toBe(true);
  });

  it('new publishes an AI draft into the served bundle; check validates it', async () => {
    const f = await fakeDeps();
    const published: { files: Map<string, Uint8Array>; info: { actor: unknown; changed: string[] } }[] = [];
    const files = await bundleFiles();
    const app = createApp({
      ...f.deps,
      bundleFiles: async () => files,
      publishBundle: async (next, info) => void published.push({ files: next, info }),
    } as typeof f.deps);
    const noModel = await mcpCall(app.fetch, BASE, 'new', { kind: 'tc', uc: 'UC-1', fields: { title: 'x' } });
    expect(noModel.isError).toBe(true);
    const fields = {
      title: 'Coupon survives a reload',
      steps: [{ instruction: 'Reload', expected: 'Kept' }],
    };
    const r = await mcpCall(app.fetch, BASE, 'new', { kind: 'tc', uc: 'UC-1', fields, model: 'claude-test' });
    expect(r.structuredContent).toMatchObject({ kind: 'test-case', key: expect.stringMatching(/^TC-\d+$/) });
    const [{ files: next, info }] = published as [(typeof published)[number]];
    expect(info.actor).toMatchObject({ kind: 'agent', id: ALEX.id, model: 'claude-test' });
    const toml = parseToml(new TextDecoder().decode(next.get(r.structuredContent.file)));
    expect(toml).toMatchObject({ origin: 'ai', status: 'draft', ai: { model: 'claude-test' } });
    expect(files.has(r.structuredContent.file)).toBe(false); // the served files are not changed in place
    const check = await mcpCall(app.fetch, BASE, 'check');
    expect(check.structuredContent).toMatchObject({ errors: 0 });
  });
});
