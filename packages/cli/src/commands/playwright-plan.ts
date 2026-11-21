/** `iw import playwright-plan <file.md>`: Playwright Test Agents planner plans as AI-written draft test cases. */
import { readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import * as iwb from '@indx-watch/bundle';
import * as cx from '../context.js';
import { type Args, type Ctx, fail, many, str } from '../util.js';
import { knownKeys, originOf } from './specs.js';

interface RawStep {
  instruction: string;
  expected: string[];
}
export interface PlanScenario {
  suite: string;
  title: string;
  seed?: string;
  steps: RawStep[];
}

/**
 * Scenarios of a planner plan (docs/spec/cli.md#iw-import-playwright-plan-filemd): `### n. Suite`,
 * `**Seed:**`, `#### n.m. Test`, `**Steps:**` with numbered steps and `- expect:` bullets, or a separate
 * `**Expected Results:**` list (the older docs format), whose bullets belong to the last step.
 */
export function parsePlan(md: string): PlanScenario[] {
  const out: PlanScenario[] = [];
  let suite = '';
  let seed: string | undefined;
  let cur: PlanScenario | undefined;
  let section = '';
  for (const line of md.split(/\r?\n/)) {
    const h = /^(#{1,4})\s+(?:\d+(?:\.\d+)*\.?\s+)?(.+?)\s*$/.exec(line);
    const label = /^\*\*(Seed|Steps|Expected[^*]*):?\*\*\s*`?([^`]*)`?/i.exec(line);
    const num = /^\s*\d+\.\s+(.+)$/.exec(line);
    const bullet = /^\s*[-*]\s+(expect:\s*)?(.+)$/.exec(line);
    if (h) {
      [cur, section] = [h[1] === '####' ? { suite, title: h[2]!, seed, steps: [] } : undefined, ''];
      if (h[1] === '###') [suite, seed] = [h[2]!, undefined];
      if (cur) out.push(cur);
    } else if (label?.[1] === 'Seed') seed = label[2]!.trim();
    else if (label) section = label[1]!.toLowerCase();
    else if (cur && num && section === 'steps') cur.steps.push({ instruction: num[1]!.trim(), expected: [] });
    else if (cur && bullet) {
      if (!cur.steps.length) cur.steps.push({ instruction: '-', expected: [] });
      const last = cur.steps.at(-1)!;
      if (bullet[1] || section !== 'steps') last.expected.push(bullet[2]!.trim());
      else last.instruction += `\n- ${bullet[2]!.trim()}`;
    }
  }
  return out;
}

/** Test case steps: a step without an expected result joins the next one (trailing ones join the last). */
export function toSteps(raw: RawStep[]): { instruction: string; expected: string }[] {
  const steps: { instruction: string; expected: string }[] = [];
  let pending: string[] = [];
  for (const s of raw) {
    if (s.instruction !== '-') pending.push(s.instruction);
    if (!s.expected.length) continue;
    const last = steps.at(-1);
    if (!pending.length && last) last.expected += `\n${s.expected.join('\n')}`;
    else steps.push({ instruction: pending.join('\n') || '-', expected: s.expected.join('\n') });
    pending = [];
  }
  const last = steps.at(-1);
  if (last && pending.length) last.instruction += `\n${pending.join('\n')}`;
  return steps;
}

/** A planner test name like "should-add-single-todo" reads as "Should add single todo". */
const titleOf = (name: string) => {
  const t = /\s/.test(name) ? name : name.replace(/[-_]+/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
};

export async function importPlaywrightPlan(ctx: Ctx, a: Args) {
  const [, path] = many(a._);
  const uc = str(a.uc);
  if (!path || !uc) fail('USAGE', 'Usage: iw import playwright-plan <file.md> --uc <UC>');
  if (a['dry-run'] || a.merge) fail('USAGE', '--dry-run and --merge apply to archives only');
  const file = resolve(ctx.cwd, path!);
  const md = await readFile(file, 'utf8').catch(() => fail('NOT_FOUND', `${path} not found`));
  const p = await cx.openProject(ctx, a);
  const { origin, model } = await originOf(ctx, { ...a, origin: 'ai' });
  const ai = { model: model!, skill: str(a.skill) ?? 'playwright-test-planner' };
  const keys = knownKeys(await p.replica.records());
  const created: iwb.CreateResult[] = [];
  const warnings: iwb.Problem[] = [];
  for (const s of parsePlan(md)) {
    const steps = toSteps(s.steps);
    const where = `${s.suite ? `${s.suite} › ` : ''}${s.title}`;
    if (!steps.length) {
      const message = `Skipped "${where}": no step has an expected result`;
      warnings.push({ severity: 'warning', code: 'plan-no-expected', file: path, message });
      continue;
    }
    const fields: Record<string, unknown> = { title: titleOf(s.title), steps, mode: str(a.mode) ?? 'manual' };
    if (s.seed) fields.preconditions = `Playwright seed test: ${s.seed}`;
    const r = await iwb.createDefinition(p.fs, p.bundle, {
      ...{ kind: 'test-case', fields, parent: uc, origin, ai },
      knownKeys: [...keys, ...created.map((c) => c.key)],
    });
    created.push(r);
  }
  if (!created.length)
    fail('INVALID_INPUT', `No scenario with steps and expected results in ${path}`, warnings);
  const data = { plan: relative(ctx.cwd, file).replaceAll('\\', '/'), uc: uc!, created };
  const text = created.map((r) => `Created ${r.key} (draft) in ${r.file}`).join('\n');
  return { data, warnings, text };
}
