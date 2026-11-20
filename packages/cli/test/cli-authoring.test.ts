/** Authoring commands on a temp copy of examples/shop: init, check, fmt, new, approve, translate. */
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseToml } from '@indx-watch/bundle';
import { describe, expect, it } from 'vitest';
import { read, TC3 } from './cli-fixtures.js';
import { iw, iwJson, ROOT, shop } from './helpers.js';

describe('commands: init, check and fmt', () => {
  it('init --example copies the shop bundle; init refuses an existing bundle', () => {
    const dir = mkdtempSync(join(tmpdir(), 'iw-ex-'));
    iwJson(dir, 'init', ['init', '--example']);
    expect(read(dir, 'project.toml')).toContain('key = "SHOP"');
    expect(read(dir, '.gitignore')).toBe('cache/\nruns/\n'); // written, not copied: npm drops .gitignore
    expect(existsSync(join(dir, '.indx-watch/cache'))).toBe(false);
    // the sample store is seeded, so the fixture blob is there and check is clean
    expect(iw(dir, ['check', '--strict']).code).toBe(0);
    expect(iwJson(dir, 'sync', ['sync']).json.data.pulled.records).toBeGreaterThan(0);
    expect(iwJson(dir, 'init', ['init']).json.error.code).toBe('CONFLICT');
  });

  it('check --fix and fmt rewrite non-canonical files; --strict fails on warnings', () => {
    const dir = shop();
    writeFileSync(join(dir, '.indx-watch', TC3), `\n\n${read(dir, TC3)}`);
    expect(iwJson(dir, 'check', ['check', '--strict']).code).toBe(1);
    expect(iwJson(dir, 'fmt', ['fmt']).json.data.changed).toEqual([TC3]);
    expect(iwJson(dir, 'check', ['check', '--fix']).json.data.changed).toEqual([]);
  });
});

describe('commands: new', () => {
  it('new: ac, fixture --from -, tc --from file, template, --ready refused for agents', () => {
    const dir = shop();
    const ac = iwJson(dir, 'new', [
      'new',
      'ac',
      '--uc',
      'UC-5',
      '--text',
      'Shows "Photos must be PNG or JPEG"',
      '--origin',
      'ai',
      '--model',
      'm',
    ]);
    expect(ac.json.data.key).toBe('AC-5.2');
    const fx = iwJson(
      dir,
      'new',
      ['new', 'fixture', '--kind', 'dataset', '--title', 'Codes', '--from', '-'],
      {
        input: '{ "row_key": "code" }',
      },
    );
    expect(parseToml(read(dir, fx.json.data.file))).toMatchObject({ kind: 'dataset', row_key: 'code' });
    writeFileSync(join(dir, 'codes.csv'), 'code,percent\nSPRING5,5\n');
    expect(iwJson(dir, 'fixture add', ['fixture', 'add', 'codes.csv', '--to', fx.json.data.key]).code).toBe(
      0,
    );
    writeFileSync(
      join(dir, 'tc.toml'),
      'tags = ["reviews"]\n[[steps]]\ninstruction = "Open it"\nexpected = "It opens"\n',
    );
    const tc = iwJson(dir, 'new', [
      'new',
      'tc',
      '--uc',
      'UC-5',
      '--title',
      'Rejects text',
      '--covers',
      'AC-5.2',
      '--from',
      'tc.toml',
    ]);
    expect(parseToml(read(dir, tc.json.data.file))).toMatchObject({ covers: ['AC-5.2'], tags: ['reviews'] });
    expect(
      iwJson(dir, 'new', ['new', 'tc', '--uc', 'UC-2', '--title', 'web', '--template', 'web']).code,
    ).toBe(0);
    const agent = { IW_ACTOR_KIND: 'agent' };
    expect(iw(dir, ['new', 'uc', '--title', 'y', '--ac', 'z', '--ready'], { env: agent }).code).toBe(2);
    expect(iw(dir, ['check']).code).toBe(0);
  });

  it('new by an agent always writes an AI draft with its model', () => {
    const dir = shop();
    const agent = { IW_ACTOR_KIND: 'agent', IW_AGENT_MODEL: 'claude-test' };
    const tc = iwJson(dir, 'new', ['new', 'tc', '--uc', 'UC-5', '--title', 'No origin flag'], { env: agent });
    expect(parseToml(read(dir, tc.json.data.file))).toMatchObject({
      status: 'draft',
      origin: 'ai',
      ai: { model: 'claude-test' },
    });
    const ac = iwJson(dir, 'new', ['new', 'ac', '--uc', 'UC-5', '--text', 'Agent criterion'], { env: agent });
    const uc = parseToml(read(dir, ac.json.data.file)) as { criteria: { key: string; status?: string }[] };
    expect(uc.criteria.find((c) => c.key === ac.json.data.key)).toMatchObject({
      status: 'draft',
      origin: 'ai',
    });
    const human = iwJson(dir, 'new', ['new', 'tc', '--uc', 'UC-5', '--title', 'x', '--origin', 'human'], {
      env: agent,
    });
    expect([human.code, human.json.error.code]).toEqual([2, 'USAGE']);
    const noModel = iwJson(dir, 'new', ['new', 'fixture', '--title', 'x'], {
      env: { IW_ACTOR_KIND: 'agent' },
    });
    expect([noModel.code, noModel.json.error.message]).toEqual([
      2,
      expect.stringContaining('IW_AGENT_MODEL'),
    ]);
    expect(iw(dir, ['check']).code).toBe(0);
  });

  it('new feature|env|release|plan by an agent carries origin "ai"; check warns until a human approves', () => {
    const dir = shop();
    const agent = { IW_ACTOR_KIND: 'agent', IW_AGENT_MODEL: 'claude-test' };
    const made = [
      ['feature', '--title', 'Agent feature'],
      ['env', '--title', 'Preview'],
      ['release', '--title', 'v9.0.0'],
      ['plan', '--title', 'Agent plan'],
    ].map((args) => {
      const r = iwJson(dir, 'new', ['new', ...args], { env: agent });
      expect(r.code).toBe(0);
      expect(parseToml(read(dir, r.json.data.file))).toMatchObject({
        origin: 'ai',
        ai: { model: 'claude-test' },
      });
      return r.json.data;
    });
    const check = iwJson(dir, 'check', ['check']);
    expect(check.code).toBe(0);
    const warned = check.json.data.problems.filter((p: { code: string }) => p.code === 'ai-not-approved');
    expect(warned.map((p: { severity: string; file: string }) => [p.severity, p.file])).toEqual(
      made.map((m) => ['warning', m.file]),
    );
    for (const m of made) {
      const r = iwJson(dir, 'approve', ['approve', m.key]);
      expect([r.code, r.json.data.file]).toEqual([0, m.file]);
      expect(read(dir, m.file)).toContain('approved_by = "qa@shop.test"');
    }
    const after = iwJson(dir, 'check', ['check']).json.data.problems;
    expect(after.filter((p: { code: string }) => p.code === 'ai-not-approved')).toEqual([]);
  });

  it('new never reuses a fixture key that recorded runs used', () => {
    const dir = shop();
    expect(iwJson(dir, 'sync', ['sync', '--pull-only']).code).toBe(0); // sample runs use FX-1..FX-3
    for (const d of readdirSync(join(dir, '.indx-watch/fixtures')).filter((d) => /^FX-[34]-/.test(d)))
      rmSync(join(dir, '.indx-watch/fixtures', d), { recursive: true });
    const fx = iwJson(dir, 'new', ['new', 'fixture', '--title', 'Another account']).json.data.key;
    expect(fx).toBe('FX-4'); // FX-4 was never used by a run; FX-3 was
  });
});

describe('commands: approve and translate', () => {
  it('approve sets ready, approved_by and approved_version', () => {
    const dir = shop();
    const r = iwJson(dir, 'approve', ['approve', 'TC-9']);
    expect(r.json.data).toMatchObject({ ref: 'TC-9', approved_by: 'qa@shop.test' });
    expect(read(dir, r.json.data.file)).toContain(`approved_version = "${r.json.data.version}"`);
  });

  it('translate lists, writes with source_hash, refuses --reviewed for agents and stale leftovers', () => {
    for (const d of [join(ROOT, 'examples/shop/.indx-watch'), join(ROOT, '.indx-watch')]) {
      const missing = iwJson(ROOT, 'translate', ['translate', '--missing', '--locale', 'ja', '--dir', d]);
      expect(missing.json.data.fields, d).toEqual([]); // docs/spec/i18n.md: the examples stay bilingual
    }
    const dir = shop();
    const set = ['translate', 'TC-3', '--locale', 'ja', '--set', 'title=有効なクーポンで合計が安くなる'];
    expect(iwJson(dir, 'translate', set).json.data).toMatchObject({ status: 'machine', written: ['title'] });
    expect(read(dir, TC3)).toContain('title = "有効なクーポンで合計が安くなる"');
    const problems = iwJson(dir, 'check', ['check']).json.data.problems as { code: string }[];
    expect(problems.filter((x) => x.code.includes('translation') || x.code.includes('literal'))).toEqual([]);
    const listed = iwJson(dir, 'translate', ['translate', 'TC-3', '--locale', 'ja']).json.data.fields;
    expect(listed.find((f: { path: string }) => f.path === 'title')).toMatchObject({ state: 'machine' });
    const agent = iwJson(dir, 'translate', [...set, '--reviewed'], { env: { IW_ACTOR_KIND: 'agent' } });
    expect(agent.code).toBe(2);
    writeFileSync(join(dir, '.indx-watch', TC3), read(dir, TC3).replace('(price 40.00)', '(price 40)'));
    const stale = iwJson(dir, 'translate', set);
    expect(stale.json.error.message).toContain('preconditions');
    const two = [...set, '--set', 'preconditions=x', '--set', 'steps.1.expected=y'];
    expect(iwJson(dir, 'translate', two).json.data.written).toEqual([
      'title',
      'preconditions',
      'steps.1.expected',
    ]);
    expect(iwJson(dir, 'translate', ['translate', 'TC-3', '--locale', 'en']).code).toBe(2);
    expect(iwJson(dir, 'translate', ['translate', 'TC-3', '--locale', 'ja', '--set', 'nope=x']).code).toBe(2);
  });
});
