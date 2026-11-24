/** `iw assign` (docs/spec/cli.md#iw-assign) and the automation mix in `iw status` on a temp copy of examples/shop. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseToml } from '@indx-watch/bundle';
import { describe, expect, it } from 'vitest';
import { iw, iwJson, shop } from './helpers.js';

const PLAN = '.indx-watch/plans/PLAN-1-v1-2-0-regression.toml';
const SPLIT = 'alex@shop.test:2,sam@shop.test:1,agent:claude:1';
const items = (dir: string) =>
  Object.fromEntries(
    (
      parseToml(readFileSync(join(dir, PLAN), 'utf8')) as {
        items: { test_case: string; assignee?: string }[];
      }
    ).items.map((i) => [i.test_case, i.assignee]),
  );

describe('iw assign', () => {
  it('--dry-run proposes a deterministic split and writes nothing, even as an agent', () => {
    const dir = shop();
    const before = readFileSync(join(dir, PLAN), 'utf8');
    const a = iwJson(dir, 'assign', ['assign', '--plan', 'PLAN-1', '--split', SPLIT, '--dry-run']);
    const b = iwJson(dir, 'assign', ['assign', '--plan', 'plan-1', '--split', SPLIT, '--dry-run'], {
      env: { CLAUDECODE: '1' },
    });
    expect(a.json.data).toMatchObject({
      plan: 'PLAN-1',
      dry_run: true,
      file: 'plans/PLAN-1-v1-2-0-regression.toml',
      load: { 'alex@shop.test': 3, 'sam@shop.test': 2, 'agent:claude': 2 },
      unassigned: 0,
    });
    expect(a.json.data.assignments).toContainEqual({
      test_case: 'TC-3',
      assignee: 'alex@shop.test',
      from: 'ci',
    });
    expect(b.json.data).toEqual(a.json.data);
    expect(readFileSync(join(dir, PLAN), 'utf8')).toBe(before);
  });

  it('writes the split through formatToml; a second run changes nothing; --only-unassigned keeps assignees', () => {
    const dir = shop();
    const r = iwJson(dir, 'assign', ['assign', '--plan', 'PLAN-1', '--split', SPLIT]);
    expect(r.json.data.dry_run).toBe(false);
    expect(items(dir)).toEqual({
      'TC-6': 'alex@shop.test',
      'TC-8': 'sam@shop.test',
      'TC-9': 'agent:claude',
      'TC-3': 'alex@shop.test',
      'TC-4': 'alex@shop.test',
      'TC-5': 'agent:claude',
      'TC-7': 'sam@shop.test',
    });
    expect(
      iwJson(dir, 'assign', ['assign', '--plan', 'PLAN-1', '--split', SPLIT]).json.data.assignments,
    ).toEqual([]);
    const kept = iwJson(dir, 'assign', [
      'assign',
      '--plan',
      'PLAN-1',
      '--split',
      'kim@shop.test',
      '--only-unassigned',
    ]);
    expect(kept.json.data.assignments).toEqual([]);
    expect(iw(dir, ['check', '--dir', join(dir, '.indx-watch')]).code).toBe(0);
  });

  it('--to --items gives named items to one assignee', () => {
    const dir = shop();
    const r = iwJson(dir, 'assign', [
      'assign',
      '--plan',
      'PLAN-1',
      '--to',
      'kim@shop.test',
      '--items',
      'TC-8,TC-9',
    ]);
    expect(r.json.data.assignments).toEqual([
      { test_case: 'TC-8', assignee: 'kim@shop.test', from: 'sam@shop.test' },
      { test_case: 'TC-9', assignee: 'kim@shop.test', from: 'agent:claude' },
    ]);
    expect(items(dir)).toMatchObject({
      'TC-8': 'kim@shop.test',
      'TC-9': 'kim@shop.test',
      'TC-6': 'alex@shop.test',
    });
  });

  it('refuses agents without --dry-run, bad splits, unknown items and wrong flag combinations', () => {
    const dir = shop();
    const before = readFileSync(join(dir, PLAN), 'utf8');
    const agent = iwJson(dir, 'assign', ['assign', '--plan', 'PLAN-1', '--split', SPLIT], {
      env: { CLAUDECODE: '1' },
    });
    expect(agent.json.error.code).toBe('USAGE');
    expect(iwJson(dir, 'assign', ['assign', '--plan', 'PLAN-1', '--split', 'nobody']).json.error.code).toBe(
      'INVALID_INPUT',
    );
    expect(iwJson(dir, 'assign', ['assign', '--plan', 'PLAN-9', '--split', 'ci']).json.error.code).toBe(
      'NOT_FOUND',
    );
    expect(
      iwJson(dir, 'assign', ['assign', '--plan', 'PLAN-1', '--to', 'ci', '--items', 'TC-1']).json.error.code,
    ).toBe('NOT_FOUND');
    expect(iwJson(dir, 'assign', ['assign', '--plan', 'PLAN-1']).json.error.code).toBe('USAGE');
    expect(iwJson(dir, 'assign', ['assign', '--plan', 'PLAN-1', '--to', 'ci']).json.error.code).toBe('USAGE');
    expect(readFileSync(join(dir, PLAN), 'utf8')).toBe(before);
  });
});

describe('iw status automation mix', () => {
  it('adds who runs the plan items of the release', () => {
    const r = iwJson(shop(), 'status', ['status']);
    expect(r.json.data.automation).toEqual({ people: 2, ci: 4, agents: 1, total: 7 });
  });
});
