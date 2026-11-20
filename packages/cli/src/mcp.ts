/** `iw mcp`: the same operations as typed MCP tools on stdio (docs/spec/agents.md#mcp-server). */
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import { type Spec, toError } from './cli.js';
import { appCommands } from './commands/app.js';
import { dataCommands } from './commands/data.js';
import { resultCommands as R } from './commands/results.js';
import { specCommands } from './commands/specs.js';
import { CommandData as D } from './json.js';
import { type Args, type Ctx, type Out, str } from './util.js';

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
    ...{ model: opt.describe('Your model ID'), skill: opt },
  }),
  record_run: z.object({
    ...{ test_case: z.string(), verdict: STATUS, note: opt, confidence: z.number().min(0).max(1).optional() },
    steps: z.array(z.object({ index: z.number().int().positive(), status: STATUS, note: opt })).optional(),
    evidence: z.array(z.string()).optional().describe('File paths, optionally with @step'),
    model: opt.describe('Your model ID'),
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
  /** `data` becomes structuredContent; warnings follow as a second text block. */
  const ok = ({ data, warnings = [] }: Out) => {
    const r = text(JSON.stringify(data));
    if (warnings.length) r.content.push({ type: 'text', text: JSON.stringify({ warnings }) });
    return { ...r, structuredContent: data as Record<string, unknown> };
  };
  /** Run a command as the CLI would ("no" answers such as failed checks keep their data; errors are the --json error). */
  type Write = { input?: Record<string, unknown>; model?: string };
  const call = async (spec: Spec, a: Args, write?: Write): Promise<Result> => {
    // the model of a write: the input, IW_AGENT_MODEL, else the MCP client's name (with a warning)
    const client = server.server.getClientVersion();
    const guess = write && !write.model && !ctx.env.IW_AGENT_MODEL && client;
    const model = write?.model ?? (guess ? `${guess.name}/${guess.version}` : undefined);
    const env = model ? { ...ctx.env, IW_AGENT_MODEL: model } : ctx.env;
    const message = `No model ID given; recorded the MCP client ${model} instead`;
    const warnings = guess ? [{ severity: 'warning' as const, code: 'no-model', message }] : [];
    try {
      const out = await spec.run({ ...ctx, env, input: write?.input }, { ...a, dir, json: true });
      return ok({ ...out, warnings: [...(out.warnings ?? []), ...warnings] });
    } catch (e) {
      const { code, message, details, data } = toError(e);
      if (data && typeof data === 'object') return ok({ data });
      return { ...text(JSON.stringify({ code, message, details })), isError: true };
    }
  };
  const steps = (s: { index: number; status: string; note?: string }[] = []) =>
    s.map((x) => `${x.index}=${x.status}${x.note ? `:${x.note}` : ''}`);
  const handlers: Record<keyof typeof INPUTS, (i: Input) => Promise<Result>> = {
    status: (i) => call(R.status!, { release: i.release, env: i.environment }),
    list: ({ kind, limit, ...f }) => call(R.list!, { what: kind, ...f, limit: limit?.toString() }),
    show: ({ ref }) => call(R.show!, { ref }),
    check: () => call(specCommands.check!, {}),
    // agents always write AI drafts: `iw new` sets origin "ai" for an agent actor
    new: ({ kind, fields, model, skill, uc, feature }) =>
      call(specCommands.new!, { entity: kind, skill, uc, feature }, { input: fields, model }),
    record_run: (i) => {
      const run = { tc: i.test_case, verdict: i.verdict, note: i.note, evidence: i.evidence ?? [] };
      const more = { step: steps(i.steps), confidence: i.confidence?.toString() };
      return call(R.record!, { ...run, ...more }, { model: i.model });
    },
    report: async ({ release, format }) => {
      const r = await call(appCommands.report!, { release, format, json: true });
      const body = r.structuredContent?.text as string | undefined;
      return !body ? r : format === 'md' ? text(body) : ok({ data: JSON.parse(body) });
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
