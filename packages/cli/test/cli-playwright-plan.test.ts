/** `iw import playwright-plan`: the shop's planner plan becomes AI-written draft test cases that pass check. */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseToml } from '@indx-watch/bundle';
import { describe, expect, it } from 'vitest';
import { parsePlan, toSteps } from '../src/commands/playwright-plan.js';
import { read } from './cli-fixtures.js';
import { iw, iwJson, ROOT, shop } from './helpers.js';

const PLAN = join(ROOT, 'examples/shop/specs/coupon.plan.md');

describe('iw import playwright-plan', () => {
  it('imports every scenario of examples/shop/specs/coupon.plan.md as an AI draft; check passes', () => {
    const dir = shop();
    const args = ['import', 'playwright-plan', PLAN, '--uc', 'UC-2', '--model', 'claude-test'];
    const r = iwJson(dir, 'import', args);
    expect(r.code, r.stderr).toBe(0);
    const { created, uc } = r.json.data;
    expect(uc).toBe('UC-2');
    expect(created.map((c: { key: string }) => c.key)).toEqual(['TC-10', 'TC-11', 'TC-12']);
    const tc = parseToml(read(dir, created[0].file)) as Record<string, unknown>;
    expect(tc).toMatchObject({
      title: 'Should apply valid coupon',
      status: 'draft',
      origin: 'ai',
      ai: { model: 'claude-test', skill: 'playwright-test-planner' },
      covers: ['AC-2.1', 'AC-2.2'],
      mode: 'manual',
      preconditions: 'Playwright seed test: tests/seed.spec.ts',
    });
    // the step without an expectation joins the next one; canonical TOML ends multi-line strings with \n
    expect(tc.steps).toEqual([
      {
        instruction: 'Click "Add Canvas Tote to cart" on the home page',
        expected: "The header link shows 'Cart (1)'",
      },
      {
        instruction:
          "Open the cart and type 'SUMMER10' into the 'Coupon code' field\nClick the 'Apply' button\n",
        expected: "The discount line shows '-4.00'\nThe total shows '36.00'\n",
      },
    ]);
    expect(iwJson(dir, 'check', ['check']).json.data.errors).toBe(0);
  });

  it('needs --uc and a model; refuses --dry-run, and plan flags on archives', () => {
    const dir = shop();
    expect(iw(dir, ['import', 'playwright-plan', PLAN, '--model', 'm']).code).toBe(2);
    expect(iw(dir, ['import', 'playwright-plan', PLAN, '--uc', 'UC-2']).code).toBe(2);
    expect(
      iw(dir, ['import', 'playwright-plan', PLAN, '--uc', 'UC-2', '--model', 'm', '--dry-run']).code,
    ).toBe(2);
    expect(iw(dir, ['import', 'x.tar', '--uc', 'UC-2']).code).toBe(2);
  });

  it('skips a scenario without expected results with a warning', () => {
    const dir = shop();
    const plan = join(dir, 'empty.plan.md');
    writeFileSync(
      plan,
      '### 1. Suite\n\n#### 1.1. a\n\n**Steps:**\n  1. Do it\n\n#### 1.2. b\n\n**Steps:**\n  1. Go\n    - expect: Done\n',
    );
    const r = iwJson(dir, 'import', ['import', 'playwright-plan', plan, '--uc', 'UC-2', '--model', 'm']);
    expect(r.json.data.created).toHaveLength(1);
    expect(r.json.warnings.map((w: { code: string }) => w.code)).toEqual(['plan-no-expected']);
  });

  it('parses the older docs format with a separate Expected Results list', () => {
    const md = [
      '#### 1.1 Add Valid Todo',
      '**Steps:**',
      '1. Click in the input field',
      '2. Type "Buy groceries"',
      '**Expected Results:**',
      '- Todo appears in the list',
      '- Counter shows "1 item left"',
    ].join('\n');
    const [s] = parsePlan(md);
    expect(s?.title).toBe('Add Valid Todo');
    expect(toSteps(s!.steps)).toEqual([
      {
        instruction: 'Click in the input field\nType "Buy groceries"',
        expected: 'Todo appears in the list\nCounter shows "1 item left"',
      },
    ]);
  });
});
