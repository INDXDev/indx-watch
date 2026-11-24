/** `iw mcp`: the tool set of @indx-watch/server (tools.ts) on stdio, run as CLI commands (docs/spec/agents.md#mcp-server). */
import {
  createToolServer,
  type ToolResult as Result,
  toolData,
  toolError,
  toolText,
  writeModel,
} from '@indx-watch/server';
import type { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { type Spec, toError, unique } from './cli.js';
import { appCommands } from './commands/app.js';
import { dataCommands } from './commands/data.js';
import { resultCommands as R } from './commands/results.js';
import { specCommands } from './commands/specs.js';
import { TOOL_OUTPUTS } from './tools.js';
import { type Args, type Ctx, str } from './util.js';

/** An MCP server whose writes are all recorded with actor.kind = "agent". */
export function createMcpServer(base: Ctx, dir?: string): McpServer {
  const ctx: Ctx = { ...base, env: { ...base.env, IW_ACTOR_KIND: 'agent' } };
  return createToolServer(TOOL_OUTPUTS, (server) => {
    /** Run a command as the CLI would ("no" answers such as failed checks keep their data; errors are the --json error). */
    type Write = { input?: Record<string, unknown>; model?: string };
    const call = async (spec: Spec, a: Args, write?: Write): Promise<Result> => {
      const w = write ? writeModel(server, write.model, ctx.env.IW_AGENT_MODEL) : { warnings: [] };
      const env = 'model' in w && w.model ? { ...ctx.env, IW_AGENT_MODEL: w.model } : ctx.env;
      const c: Ctx = { ...ctx, env, input: write?.input, notes: [] };
      try {
        const out = await spec.run(c, { ...a, dir, json: true });
        return toolData(out.data, unique([...(out.warnings ?? []), ...w.warnings, ...c.notes!]));
      } catch (e) {
        const { code, message, details, data } = toError(e);
        return data && typeof data === 'object' ? toolData(data, c.notes) : toolError(code, message, details);
      }
    };
    type Step = { index: number; status: string; note?: string; checks?: boolean[] };
    const steps = (s: Step[] = []) => s.map((x) => `${x.index}=${x.status}${x.note ? `:${x.note}` : ''}`);
    const ticks = (s: Step[] = []) =>
      s.flatMap((x) => (x.checks ? [`${x.index}=${x.checks.map(Number).join(',')}`] : []));
    return {
      status: (i) => call(R.status!, { release: i.release, env: i.environment, mine: i.mine }),
      list: ({ kind, limit, ...f }) => call(R.list!, { what: kind, ...f, limit: limit?.toString() }),
      show: ({ ref }) => call(R.show!, { ref }),
      check: () => call(specCommands.check!, {}),
      // agents always write AI drafts: `iw new` sets origin "ai" for an agent actor
      new: ({ kind, fields, model, skill, uc, feature }) =>
        call(specCommands.new!, { entity: kind, skill, uc, feature }, { input: fields, model }),
      record_run: (i) => {
        const run = { tc: i.test_case, verdict: i.verdict, note: i.note, evidence: i.evidence ?? [] };
        const more = { step: steps(i.steps), checks: ticks(i.steps), confidence: i.confidence?.toString() };
        return call(R.record!, { ...run, ...more }, { model: i.model });
      },
      report: async ({ release, format }) => {
        const r = await call(appCommands.report!, { release, format, json: true });
        const body = r.structuredContent?.text as string | undefined;
        return !body ? r : format === 'md' ? toolText(body) : toolData(JSON.parse(body));
      },
      sync: () => call(dataCommands.sync!, {}),
      assign: (i) =>
        call(specCommands.assign!, {
          plan: i.plan,
          split: i.split,
          'only-unassigned': i.only_unassigned,
          'dry-run': true,
        }),
    };
  });
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
