/** `iw mcp` in process (docs/spec/agents.md#acceptance-criteria). */
import { InMemoryTransport, type JSONRPCMessage } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { describe, expect, it } from 'vitest';
import { makeCtx } from '../src/cli.js';
import { CommandData } from '../src/json.js';
import { createMcpServer } from '../src/mcp.js';
import { cleanEnv, iw, shop } from './helpers.js';

/** A minimal JSON-RPC client over an in-memory transport (2025-era opening, served by the same factory). */
async function connect(dir: string) {
  const [client, server] = InMemoryTransport.createLinkedPair();
  const waiting = new Map<number, (m: JSONRPCMessage) => void>();
  client.onmessage = (m) => waiting.get((m as { id: number }).id)?.(m);
  await client.start();
  serveStdio(() => createMcpServer(makeCtx(cleanEnv(), dir)), { transport: server });
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
  });

  it('record_run as an agent with confidence 0.6 yields needs_review', async () => {
    const dir = shop();
    const { call } = await connect(dir);
    const r = await call('record_run', {
      test_case: 'TC-9',
      verdict: 'pass',
      confidence: 0.6,
      steps: [{ index: 1, status: 'pass' }],
    });
    expect(r.structuredContent).toMatchObject({ verdict: 'needs_review', rule: 6 });
    expect(r.structuredContent.run.actor.kind).toBe('agent');
    expect(r.structuredContent.run.judgements[0]).toMatchObject({ kind: 'llm', confidence: 0.6 });
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
      model: 'claude-opus-5-5',
      skill: 'write-test-cases',
    });
    expect(r.structuredContent).toMatchObject({ key: 'TC-10' });
    expect((await call('show', { ref: 'TC-10' })).structuredContent).toMatchObject({
      status: 'draft',
      origin: 'ai',
    });
    expect((await call('list', { kind: 'tcs', uc: 'UC-5' })).structuredContent.items).toHaveLength(2);
    expect((await call('check')).structuredContent.errors).toBe(0);
    const missing = await call('show', { ref: 'TC-99' });
    expect(missing.isError).toBe(true);
  });

  it('report json returns report data', async () => {
    const { call } = await connect(shop());
    const r = await call('report', { format: 'json' });
    expect(r.structuredContent.project.key).toBe('SHOP');
  });
});
