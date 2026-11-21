/**
 * The agent execution loop (docs/spec/agents.md#agent-execution-mode-v02): walks a test case's steps in a browser from a
 * BrowserProvider, asking an LlmClient for each action, and ends with one llm judgement. Runtime-neutral.
 */
import type {
  AgentStepInput,
  BrowserAction,
  BrowserProvider,
  BrowserSession,
  LlmClient,
  LlmJudgement,
} from './ports.js';

export interface AgentStepResult {
  index: number;
  status: 'pass' | 'fail' | 'blocked' | 'skipped';
  /** the agent's note, then the actions it took */
  note: string;
  /** the page when the step ended */
  screenshot?: Uint8Array | undefined;
}

export interface AgentRunInput {
  browser: BrowserProvider;
  llm: LlmClient;
  baseUrl: string;
  goal: string;
  /** placeholders already filled */
  steps: { instruction: string; expected: string }[];
  rubric: string[];
  /** actions per step before it counts as blocked (default 15) */
  maxActions?: number;
}

const describe = (a: BrowserAction) =>
  a.type === 'navigate'
    ? `navigate ${a.url}`
    : a.type === 'press'
      ? `press ${a.key}`
      : `${a.type} ${a.ref}${a.type === 'fill' ? ` "${a.value}"` : a.type === 'select' ? ` "${a.option}"` : ''}`;
const withLog = (note: string, log: string[]) => (log.length ? `${note}\nActions: ${log.join('; ')}` : note);

type Next = (input: AgentStepInput) => ReturnType<NonNullable<LlmClient['next']>>;

/** One step: observe, ask, act, until the agent reports the step's result or runs out of actions. */
async function runStep(
  s: BrowserSession,
  next: Next,
  step: AgentStepInput['step'],
  goal: string,
  max: number,
) {
  const history: string[] = [];
  for (let n = 0; n < max; n++) {
    const observation = await s.observe();
    const a = await next({ goal, step, observation, history: [...history] });
    if (a.type === 'step_done') {
      const { status, note } = a;
      return { index: step.index, status, note: withLog(note, history), screenshot: observation.screenshot };
    }
    const r = await s.act(a);
    history.push(`${describe(a)}: ${r.ok ? 'ok' : `error: ${r.error}`}`);
  }
  const { screenshot } = await s.observe();
  return {
    index: step.index,
    status: 'blocked' as const,
    note: withLog(`No result after ${max} actions`, history),
    screenshot,
  };
}

/** Run every step (after one that does not pass, the rest are skipped), then ask for the llm judgement. */
export async function runAgent(
  input: AgentRunInput,
): Promise<{ steps: AgentStepResult[]; judgement: LlmJudgement }> {
  const { llm, goal } = input;
  if (!llm.next) throw new Error('this LlmClient cannot drive a browser (it has no next())');
  const next: Next = (i) => llm.next!(i);
  const session = await input.browser.open({ baseUrl: input.baseUrl });
  try {
    const steps: AgentStepResult[] = [];
    for (const [i, step] of input.steps.entries()) {
      steps.push(
        steps.some((r) => r.status !== 'pass')
          ? { index: i + 1, status: 'skipped', note: 'Not run: an earlier step did not pass' }
          : await runStep(session, next, { index: i + 1, ...step }, goal, input.maxActions ?? 15),
      );
    }
    const page = await session.observe();
    const results = steps.map((r) => `Step ${r.index}: ${r.status}: ${r.note}`).join('\n');
    const expected = input.steps.map((s, i) => `${i + 1}. ${s.instruction} => ${s.expected}`).join('\n');
    const observation = { ...page, tree: `${results}\n\nFinal page:\n${page.tree}` };
    return { steps, judgement: await llm.judge({ rubric: input.rubric, expected, observation }) };
  } finally {
    await session.close();
  }
}
