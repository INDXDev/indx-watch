/** `iw mcp`: the same operations as typed MCP tools on stdio (docs/spec/agents.md#mcp-server). */
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import type { Spec } from './cli.js';
import { appCommands } from './commands/app.js';
import { dataCommands } from './commands/data.js';
import { resultCommands as R } from './commands/results.js';
import { specCommands } from './commands/specs.js';
import { CommandData as D } from './json.js';
import { type Args, CliError, type Ctx, str } from './util.js';

const READ = { readOnlyHint: true, openWorldHint: false };
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const NETWORK = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const opt = z.string().optional();
const STATUS = z.enum(['pass', 'fail', 'blocked', 'skipped']);
const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });
type Result = ReturnType<typeof text> & { structuredContent?: Record<string, unknown>; isError?: boolean };
// biome-ignore lint/suspicious/noExplicitAny: inputs are validated by each tool's zod schema before the handler runs
type Input = any;

const INPUTS = {
  status: z.object({ release: opt, environment: opt }),
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
    ...{
      origin: z.enum(['ai', 'human', 'import']).optional(),
      model: opt.describe('Your model ID'),
      skill: opt,
    },
  }),
  record_run: z.object({
    ...{ test_case: z.string(), verdict: STATUS, note: opt, confidence: z.number().min(0).max(1).optional() },
    steps: z.array(z.object({ index: z.number().int().positive(), status: STATUS, note: opt })).optional(),
    evidence: z.array(z.string()).optional().describe('File paths, optionally with @step'),
  }),
  report: z.object({ release: opt, format: z.enum(['md', 'json']).default('md') }),
  sync: z.object({}),
};
const ABOUT: Record<keyof typeof INPUTS, [string, z.ZodType | undefined, object]> = {
  status: ['Coverage, use case status and the readiness gate (= iw status --json)', D.status, READ],
  list: ['List features, ucs, tcs, fixtures, envs, releases, plans or runs', D.list, READ],
  show: ['One entity (UC-n, TC-n, FX-n, PLAN-n, a run ID or prefix) with references and runs', D.show, READ],
  check: ['Validate the bundle; read problems[] (file, path, message)', D.check, READ],
  new: ['Create a definition as an AI draft (origin "ai"); a human approves it', D.new, WRITE],
  record_run: [
    'Record a run you executed: verdict, confidence (0-1), steps, evidence files',
    D.record,
    WRITE,
  ],
  report: ['Release report: Markdown text (md) or the report data (json)', undefined, READ],
  sync: ['Push and pull records and blobs with the store in project.toml', D.sync, NETWORK],
};

/** An MCP server whose writes are all recorded with actor.kind = "agent". There is no approve/review/waive tool. */
export function createMcpServer(base: Ctx, dir?: string): McpServer {
  const server = new McpServer({ name: 'indx-watch', version: '0.1.0' });
  const ctx: Ctx = { ...base, env: { ...base.env, IW_ACTOR_KIND: 'agent' } };
  const ok = (d: unknown) => ({
    ...text(JSON.stringify(d)),
    structuredContent: d as Record<string, unknown>,
  });
  /** Run a command; its `data` becomes structuredContent ("no" answers such as failed checks keep their data). */
  const call = async (spec: Spec, a: Args, input?: Record<string, unknown>): Promise<Result> => {
    try {
      return ok((await spec.run({ ...ctx, ...(input ? { input } : {}) }, { ...a, dir, json: true })).data);
    } catch (e) {
      const err = e instanceof CliError ? e : new CliError('INTERNAL', (e as Error).message);
      if (err.data && typeof err.data === 'object') return ok(err.data);
      return { ...text(`${err.code}: ${err.message}`), isError: true };
    }
  };
  const steps = (s: { index: number; status: string; note?: string }[] = []) =>
    s.map((x) => `${x.index}=${x.status}${x.note ? `:${x.note}` : ''}`);
  const handlers: Record<keyof typeof INPUTS, (i: Input) => Promise<Result>> = {
    status: (i) => call(R.status!, { release: i.release, env: i.environment }),
    list: ({ kind, limit, ...f }) => call(R.list!, { what: kind, ...f, limit: limit?.toString() }),
    show: ({ ref }) => call(R.show!, { ref }),
    check: () => call(specCommands.check!, {}),
    new: ({ kind, fields, origin, ...rest }) =>
      call(specCommands.new!, { entity: kind, origin: origin ?? 'ai', ...rest }, fields),
    record_run: (i) =>
      call(R.record!, {
        ...{ tc: i.test_case, verdict: i.verdict, note: i.note, evidence: i.evidence ?? [] },
        ...{ step: steps(i.steps), confidence: i.confidence?.toString() },
      }),
    report: async ({ release, format }) => {
      const r = await call(appCommands.report!, { release, format, json: true });
      const body = r.structuredContent?.text as string | undefined;
      return !body ? r : format === 'md' ? text(body) : ok(JSON.parse(body));
    },
    sync: () => call(dataCommands.sync!, {}),
  };
  for (const [name, inputSchema] of Object.entries(INPUTS)) {
    const [description, outputSchema, annotations] = ABOUT[name as keyof typeof INPUTS];
    const handler = handlers[name as keyof typeof INPUTS];
    server.registerTool(name, { description, inputSchema, outputSchema, annotations }, handler as never);
  }
  return server;
}

export const mcpCommand: Spec = {
  description: 'Start the MCP server on stdio',
  async run(ctx, a) {
    serveStdio(() => createMcpServer(ctx, str(a.dir)));
    ctx.log('indx-watch MCP server on stdio');
    // stdout belongs to the protocol: never resolve; the process ends when stdin closes
    return new Promise<never>(() => {});
  },
};
