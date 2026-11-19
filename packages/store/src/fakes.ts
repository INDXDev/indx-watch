/**
 * Fakes of the execution ports (docs/architecture.md#ports-and-adapters): v0.1 ships the interfaces and these fakes;
 * real adapters (Playwright, Cloudflare Browser Run, Anthropic) come in v0.2 and must pass the same contract tests.
 */
import type { BrowserAction, BrowserObservation, BrowserProvider, LlmClient, LlmJudgement } from './ports.js';

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

/** An LLM judge without a model: `answer` decides (default: pass when the expected text is in the page's tree). */
export function fakeLlmClient(
  answer?: (input: Parameters<LlmClient['judge']>[0]) => Partial<LlmJudgement>,
): LlmClient & { calls: Parameters<LlmClient['judge']>[0][] } {
  const calls: Parameters<LlmClient['judge']>[0][] = [];
  return {
    calls,
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
