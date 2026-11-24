/**
 * Shared steps (docs/spec/bundle-format.md#shared-steps, ADR 0015): a test case step `use = "SS-n"` is replaced
 * by the steps of that shared step when a bundle is loaded, and put back when the test case is written.
 */
import type { FileStep, Step } from './schema/definitions.js';

export type SharedSteps = ReadonlyMap<string, readonly FileStep[]>;
export interface StepIssue {
  code: 'unresolved-ref' | 'shared-step-cycle';
  /** dotted path of the `use` that causes it, e.g. 'steps[1].use' */
  path: string;
  message: string;
}

/** The steps behind one key, nested uses flattened; a missing key or a cycle is reported and yields none. */
function flatten(key: string, shared: SharedSteps, trail: string[], path: string, out: StepIssue[]): Step[] {
  const body = shared.get(key);
  if (!body) {
    out.push({ code: 'unresolved-ref', path, message: `Shared step ${key} does not exist` });
    return [];
  }
  if (trail.includes(key)) {
    const message = `Shared steps form a cycle: ${[...trail, key].join(' → ')}`;
    out.push({ code: 'shared-step-cycle', path, message });
    return [];
  }
  return body.flatMap((s) => (s.use ? flatten(s.use, shared, [...trail, key], path, out) : [s as Step]));
}

/**
 * Every `use` step replaced by its shared steps, each marked `from` the key the file named (`fromFirst` on the
 * first). `own` is the key of the shared step being checked itself, so a cycle back to it is found.
 */
export function expandSteps(
  steps: readonly FileStep[],
  shared: SharedSteps,
  own?: string,
): { steps: Step[]; issues: StepIssue[] } {
  const issues: StepIssue[] = [];
  const out = steps.flatMap((s, i): Step[] => {
    if (!s.use) return [s as Step];
    const got = flatten(s.use, shared, own ? [own] : [], `steps[${i}].use`, issues);
    return got.map((g, n) => ({ ...g, from: s.use!, ...(n === 0 && { fromFirst: true }) }));
  });
  return { steps: out, issues };
}

/** The file form of loaded steps: each run of expanded steps becomes the single `use` it came from. */
export const collapseSteps = (steps: readonly Step[]): FileStep[] =>
  steps.flatMap(({ from, fromFirst, ...s }): FileStep[] => (from ? (fromFirst ? [{ use: from }] : []) : [s]));
