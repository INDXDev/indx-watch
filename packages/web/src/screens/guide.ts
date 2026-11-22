/** Pure helpers of the test case page (docs/spec/web.md#test-case-page). */
import type { TestCaseDetail } from '../api';

/** `FX-1.code` → value, from the first selected row of each fixture (used to fill {{…}} placeholders). Pure. */
export function placeholderValues(fixtures: TestCaseDetail['fixtures']): Record<string, string> {
  const out: Record<string, string> = {};
  for (const fx of fixtures)
    for (const [k, v] of Object.entries(fx.values?.[0] ?? {})) out[`${fx.key}.${k}`] = v;
  return out;
}

/** The environment's `base_url` followed by the test case's `start` path (one `/` between them). Pure; tested. */
export const startUrl = (base: string, start?: string) => (start ? base.replace(/\/+$/, '') + start : base);

/** 1-based numbers of the steps whose instruction mentions the fixture key (`FX-4`, `{{FX-4.code}}`). Pure; tested. */
export const stepsUsing = (steps: readonly { instruction: string }[], key: string) =>
  steps.flatMap((s, i) => (new RegExp(`\\b${key}(?!\\d)`).test(s.instruction) ? [i + 1] : []));

/** Preconditions as checklist items: one per line or sentence. Pure; tested. */
export const sentences = (text: string) =>
  text
    .split(/\n+|(?<=[.!?])\s+(?=\S)|(?<=[。！？])/)
    .map((x) => x.trim())
    .filter(Boolean);
