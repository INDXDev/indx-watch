/** Deterministic fakes of the execution ports (docs/architecture.md#ports-and-adapters) for tests. */
import type {
  AccessPolicy,
  AgentAction,
  AgentStepInput,
  BrowserAction,
  BrowserObservation,
  BrowserProvider,
  LlmClient,
  LlmJudgement,
  Notification,
  Notifier,
} from './ports.js';

type Page = Omit<BrowserObservation, 'url'>;
const href = (url: string, base?: string) => new URL(url, base).href;

/** A scripted browser: `pages` maps absolute URLs to what they show. `navigate` moves between them; every action is recorded. */
export function fakeBrowserProvider(
  pages: Record<string, Page>,
): BrowserProvider & { actions: BrowserAction[] } {
  const known = new Map(Object.entries(pages).map(([url, page]) => [href(url), page]));
  const actions: BrowserAction[] = [];
  return {
    actions,
    async open({ baseUrl }) {
      let url = href(baseUrl);
      let closed = false;
      const live = () => {
        if (closed) throw new Error('the browser session is closed');
      };
      return {
        async observe() {
          live();
          return { url, ...(known.get(url) ?? { title: '', tree: '' }) };
        },
        async act(action) {
          live();
          actions.push(action);
          if (action.type !== 'navigate') return { ok: true };
          const next = href(action.url, url);
          if (!known.has(next)) return { ok: false, error: `no page at ${next}` };
          url = next;
          return { ok: true };
        },
        async close() {
          closed = true;
        },
      };
    },
  };
}

/**
 * An LLM without a model: `answer` judges (default: pass when the expected text is in the page's tree); `plan` picks
 * the agent's actions (default: every step passes at once). Calls are recorded in `calls` and `steps`.
 */
export function fakeLlmClient(
  answer?: (input: Parameters<LlmClient['judge']>[0]) => Partial<LlmJudgement>,
  plan: (input: AgentStepInput) => AgentAction = () => ({ type: 'step_done', status: 'pass', note: 'Done' }),
): Required<LlmClient> & { calls: Parameters<LlmClient['judge']>[0][]; steps: AgentStepInput[] } {
  const calls: Parameters<LlmClient['judge']>[0][] = [];
  const steps: AgentStepInput[] = [];
  return {
    calls,
    steps,
    async next(input) {
      steps.push(input);
      return plan(input);
    },
    async judge(input) {
      calls.push(input);
      const pass = input.observation.tree.includes(input.expected);
      return {
        verdict: pass ? 'pass' : 'fail',
        confidence: 1,
        reason: pass ? 'the expected text is on the page' : 'the expected text is not on the page',
        model: 'fake',
        ...answer?.(input),
      };
    },
  };
}

/** An Access policy held in memory: `emails` is its include list. */
export function fakeAccessPolicy(emails = new Set<string>()): AccessPolicy & { emails: Set<string> } {
  const change = async (email: string, add: boolean) => {
    const e = email.toLowerCase();
    if (emails.has(e) === add) return false;
    if (add) emails.add(e);
    else emails.delete(e);
    return true;
  };
  return { emails, allow: (e) => change(e, true), revoke: (e) => change(e, false) };
}

/** A notifier that keeps what it was given, one array per `send`. */
export function fakeNotifier(): Notifier & { sent: Notification[][] } {
  const sent: Notification[][] = [];
  return { sent, send: async (m) => void (m.length && sent.push(m)) };
}
