/** `iw mcp` in process (docs/spec/agents.md#acceptance-criteria). */
import { join } from 'node:path';

import { startNodeServer } from '@indx-watch/server/node';
import { InMemoryTransport, type JSONRPCMessage } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { describe, expect, it } from 'vitest';
import { makeCtx } from '../src/cli.js';
import { CommandData } from '../src/json.js';
import { createMcpServer } from '../src/mcp.js';
import { TOOL_OUTPUTS } from '../src/tools.js';
import { cleanEnv, iw, shop } from './helpers.js';

/** A minimal JSON-RPC client over an in-memory transport (2025-era opening, served by the same factory). */
async function connect(dir: string, env: Record<string, string> = {}) {
  const [client, server] = InMemoryTransport.createLinkedPair();
  const waiting = new Map<number, (m: JSONRPCMessage) => void>();
  client.onmessage = (m) => waiting.get((m as { id: number }).id)?.(m);
  await client.start();
  serveStdio(() => createMcpServer(makeCtx({ ...cleanEnv(), ...env }, dir)), { transport: server });
  let id = 0;
  // biome-ignore lint/suspicious/noExplicitAny: JSON-RPC results
  const request = async (method: string, params: object): Promise<any> => {
    const n = ++id;
    const reply = new Promise<JSONRPCMessage>((res) => waiting.set(n, res));
    await client.send({ jsonrpc: '2.0', id: n, method, params } as JSONRPCMessage);
    return ((await reply) as { result: unknown }).result;
  };
  const clientInfo = { name: 'test', version: '1' };
  await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo });
  await client.send({ jsonrpc: '2.0', method: 'notifications/initialized' } as JSONRPCMessage);
  return {
    request,
    call: (name: string, args: object = {}) => request('tools/call', { name, arguments: args }),
  };
}

describe('iw mcp', () => {
  it('lists the tools with explicit annotations', async () => {
    const { request } = await connect(shop());
    const { tools } = await request('tools/list', {});
    expect(tools.map((t: { name: string }) => t.name)).toEqual([
      'status',
      'list',
      'show',
      'check',
      'new',
      'record_run',
      'report',
      'sync',
    ]);
    const by = Object.fromEntries(
      tools.map((t: { name: string; annotations: object }) => [t.name, t.annotations]),
    );
    expect(by.status).toMatchObject({ readOnlyHint: true });
    expect(by.record_run).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    });
    expect(tools.some((t: { name: string }) => /approve|review|waive/.test(t.name))).toBe(false);
  });

  it('status returns the same data as iw status --json', async () => {
    const dir = shop();
    const { call } = await connect(dir);
    const r = await call('status');
    expect(r.structuredContent).toEqual(iw(dir, ['status', '--json']).json.data);
    expect(CommandData.status.safeParse(r.structuredContent).success).toBe(true);
    const env = { IW_ACTOR: 'alex@shop.test' };
    const mine = await (await connect(dir, env)).call('status', { mine: true });
    expect(mine.structuredContent).toEqual(iw(dir, ['status', '--mine', '--json'], { env }).json.data);
    expect(mine.structuredContent.mine.features).toEqual(['FEAT-2']);
  });

  it('record_run as an agent with confidence 0.6 yields needs_review', async () => {
    const dir = shop();
    const { call } = await connect(dir);
    const r = await call('record_run', {
      test_case: 'TC-9',
      verdict: 'pass',
      confidence: 0.6,
      steps: [{ index: 1, status: 'pass', checks: [true] }],
    });
    expect(r.structuredContent).toMatchObject({ verdict: 'needs_review', rule: 6 });
    expect(r.structuredContent.run.steps).toEqual([{ index: 1, status: 'pass', checks: [true] }]);
    expect(r.structuredContent.run.actor.kind).toBe('agent');
    expect(r.structuredContent.run.judgements[0]).toMatchObject({ kind: 'llm', confidence: 0.6 });
    // no evidence and no model: the CLI's warnings come back as a second text block
    const warnings = JSON.parse(r.content[1].text).warnings.map((w: { code: string }) => w.code);
    expect(warnings).toEqual(expect.arrayContaining(['no-evidence', 'no-model']));
    expect(r.structuredContent.run.actor.model).toBe('test/1'); // the MCP client, for lack of a model
    const m = await call('record_run', {
      test_case: 'TC-9',
      verdict: 'fail',
      confidence: 0.9,
      model: 'claude-x',
    });
    expect(m.structuredContent.run.actor.model).toBe('claude-x');
    expect(m.structuredContent.run.judgements[0].by.model).toBe('claude-x');
    // TC-6 declares a human judge: a confident agent pass waits for a person (rule 10)
    const guided = await call('record_run', { test_case: 'TC-6', verdict: 'pass', confidence: 1 });
    expect(guided.structuredContent).toMatchObject({ verdict: 'needs_review', rule: 10 });
  });

  it('new writes AI drafts; show, list, check and errors', async () => {
    const dir = shop();
    const { call } = await connect(dir);
    const fields = {
      title: 'Rejects text files',
      steps: [{ instruction: 'Attach a .txt', expected: 'An error' }],
    };
    const r = await call('new', {
      kind: 'tc',
      uc: 'UC-5',
      fields,
      origin: 'human', // not an input: agents always write AI drafts
      model: 'claude-opus-5-5',
      skill: 'write-test-cases',
    });
    expect(r.structuredContent).toMatchObject({ key: 'TC-11' });
    expect((await call('show', { ref: 'TC-11' })).structuredContent).toMatchObject({
      status: 'draft',
      origin: 'ai',
      ai: { model: 'claude-opus-5-5' },
    });
    const ac = await call('new', { kind: 'ac', uc: 'UC-5', fields: { text: 'Agent AC' }, model: 'm' });
    expect((await call('show', { ref: ac.structuredContent.key })).structuredContent).toMatchObject({
      status: 'draft',
      origin: 'ai',
    });
    expect((await call('list', { kind: 'tcs', uc: 'UC-5' })).structuredContent.items).toHaveLength(2);
    expect((await call('check')).structuredContent.errors).toBe(0);
    const missing = await call('show', { ref: 'TC-99' });
    expect(missing.isError).toBe(true);
    expect(JSON.parse(missing.content[0].text)).toMatchObject({ code: 'NOT_FOUND' });
    // bundle errors keep their code and details, as in iw --json
    const dup = await call('new', {
      kind: 'tc',
      uc: 'UC-5',
      fields: { ...fields, key: 'TC-11' },
      model: 'm',
    });
    expect(JSON.parse(dup.content[0].text).code).toBe('CONFLICT');
  });

  it('report json returns report data', async () => {
    const { call } = await connect(shop());
    const r = await call('report', { format: 'json' });
    expect(r.structuredContent.project.key).toBe('SHOP');
  });
});

describe('/mcp on iw serve', () => {
  /** one stateless JSON-RPC POST to /mcp; the reply is JSON or a one-message SSE stream */
  // biome-ignore lint/suspicious/noExplicitAny: JSON-RPC results
  const post = async (url: string, method: string, params: object = {}): Promise<any> => {
    const res = await fetch(`${url}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    const text = await res.text();
    return JSON.parse(text.startsWith('{') ? text : /^data: (.*)$/m.exec(text)![1]!).result;
  };

  it('serves the same tools as iw mcp over Streamable HTTP, reads and writes the same project', async () => {
    const dir = shop();
    const server = await startNodeServer({
      dir: join(dir, '.indx-watch'),
      port: 0,
      sync: false,
      webRoot: dir,
      toolOutputs: TOOL_OUTPUTS,
    });
    try {
      const { request } = await connect(dir);
      const { tools } = await post(server.url, 'tools/list');
      expect(tools.map((t: { name: string }) => t.name)).toHaveLength(8);
      expect(tools).toEqual((await request('tools/list', {})).tools); // names, schemas and annotations
      const call = (name: string, args: object) => post(server.url, 'tools/call', { name, arguments: args });
      const show = await call('show', { ref: 'TC-9' });
      expect(show.structuredContent).toEqual(iw(dir, ['show', 'TC-9', '--json']).json.data);
      const args = {
        test_case: 'TC-9',
        verdict: 'fail',
        note: 'Coupon lost',
        confidence: 0.9,
        model: 'claude-x',
      };
      const r = await call('record_run', args);
      expect(r.structuredContent.run.actor).toMatchObject({ kind: 'agent', model: 'claude-x' });
      expect(CommandData.record.safeParse(r.structuredContent).success).toBe(true);
      const recorded = iw(dir, ['show', r.structuredContent.run.id, '--json']).json.data;
      expect(recorded.record.source).toBe('agent');
    } finally {
      await server.close();
    }
  });
});
