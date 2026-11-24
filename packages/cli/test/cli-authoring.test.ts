/** Authoring commands on a temp copy of examples/shop: init, check, fmt, new, approve, translate. */
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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
    // nothing of the source's cache/ is copied; only init's pull of the sample results writes its sync state
    expect(readdirSync(join(dir, '.indx-watch/cache')).sort()).toEqual(['sync', 'writer-id']);
    // the sample store is seeded, so the fixture blob is there and check is clean
    expect(iw(dir, ['check', '--strict']).code).toBe(0);
    expect(iwJson(dir, 'status', ['status']).json.data.counts.fail).toBe(1); // init pulled the sample results
    expect(iwJson(dir, 'sync', ['sync']).json.data.pulled.records).toBe(0);
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

/** Arguments of the `iw new` calls the authoring tests repeat. */
const NEW_AC = [
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
];
const NEW_FIXTURE = ['new', 'fixture', '--kind', 'dataset', '--title', 'Codes', '--from', '-'];
const NEW_TC = [
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
];
const TC_DRAFT = 'tags = ["reviews"]\n[[steps]]\ninstruction = "Open it"\nexpected = "It opens"\n';
const AGENT_MODEL = 'claude-test';
const AGENT = { IW_ACTOR_KIND: 'agent' };
const AGENT_WITH_MODEL = { ...AGENT, IW_AGENT_MODEL: AGENT_MODEL };

describe('commands: new', () => {
  it('new: ac, fixture --from -, tc --from file, template, --ready refused for agents', () => {
    const dir = shop();
    expect(iwJson(dir, 'new', NEW_AC).json.data.key).toBe('AC-5.2');
    const fx = iwJson(dir, 'new', NEW_FIXTURE, { input: '{ "row_key": "code" }' });
    expect(parseToml(read(dir, fx.json.data.file))).toMatchObject({ kind: 'dataset', row_key: 'code' });
    writeFileSync(join(dir, 'codes.csv'), 'code,percent\nSPRING5,5\n');
    const add = iwJson(dir, 'fixture add', ['fixture', 'add', 'codes.csv', '--to', fx.json.data.key]);
    expect(add.code).toBe(0);
    writeFileSync(join(dir, 'tc.toml'), TC_DRAFT);
    const tc = iwJson(dir, 'new', NEW_TC);
    expect(parseToml(read(dir, tc.json.data.file))).toMatchObject({ covers: ['AC-5.2'], tags: ['reviews'] });
    const web = iwJson(dir, 'new', ['new', 'tc', '--uc', 'UC-2', '--title', 'web', '--template', 'web']);
    expect(web.code).toBe(0);
    expect(iw(dir, ['new', 'uc', '--title', 'y', '--ac', 'z', '--ready'], { env: AGENT }).code).toBe(2);
    expect(iw(dir, ['check']).code).toBe(0);
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

describe('commands: new by an agent', () => {
  it('new by an agent always writes an AI draft with its model', () => {
    const dir = shop();
    const env = AGENT_WITH_MODEL;
    const tc = iwJson(dir, 'new', ['new', 'tc', '--uc', 'UC-5', '--title', 'No origin flag'], { env });
    expect(parseToml(read(dir, tc.json.data.file))).toMatchObject({
      status: 'draft',
      origin: 'ai',
      ai: { model: AGENT_MODEL },
    });
    const ac = iwJson(dir, 'new', ['new', 'ac', '--uc', 'UC-5', '--text', 'Agent criterion'], { env });
    const uc = parseToml(read(dir, ac.json.data.file)) as { criteria: { key: string; status?: string }[] };
    expect(uc.criteria.find((c) => c.key === ac.json.data.key)).toMatchObject({
      status: 'draft',
      origin: 'ai',
    });
    const humanArgs = ['new', 'tc', '--uc', 'UC-5', '--title', 'x', '--origin', 'human'];
    const human = iwJson(dir, 'new', humanArgs, { env });
    expect([human.code, human.json.error.code]).toEqual([2, 'USAGE']);
    const noModel = iwJson(dir, 'new', ['new', 'fixture', '--title', 'x'], { env: AGENT });
    expect([noModel.code, noModel.json.error.message]).toEqual([
      2,
      expect.stringContaining('IW_AGENT_MODEL'),
    ]);
    expect(iw(dir, ['check']).code).toBe(0);
  });

  it('new feature|env|release|plan by an agent carries origin "ai"; check warns until a human approves', () => {
    const dir = shop();
    const made = [
      ['feature', '--title', 'Agent feature'],
      ['env', '--title', 'Preview'],
      ['release', '--title', 'v9.0.0'],
      ['plan', '--title', 'Agent plan'],
    ].map((args) => {
      const r = iwJson(dir, 'new', ['new', ...args], { env: AGENT_WITH_MODEL });
      expect(r.code).toBe(0);
      expect(parseToml(read(dir, r.json.data.file))).toMatchObject({
        origin: 'ai',
        ai: { model: AGENT_MODEL },
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
    const agent = iwJson(dir, 'translate', [...set, '--reviewed'], { env: AGENT });
    expect(agent.code).toBe(2);
    writeFileSync(join(dir, '.indx-watch', TC3), read(dir, TC3).replace('(price 40.00)', '(price 40)'));
    const stale = iwJson(dir, 'translate', set);
    expect(stale.json.error.message).toContain('preconditions');
    const two = [...set, '--set', 'preconditions=x', '--set', 'purpose=p', '--set', 'start_note=s'];
    expect(iwJson(dir, 'translate', [...two, '--set', 'steps.1.expected=y']).json.data.written).toEqual([
      'title',
      'preconditions',
      'purpose',
      'start_note',
      'steps.1.expected',
    ]);
    expect(iwJson(dir, 'translate', ['translate', 'TC-3', '--locale', 'en']).code).toBe(2);
    // guidance: one path per check (a list is written whole), fixture notes
    const paths = listed.map((f: { path: string }) => f.path);
    expect(paths).toEqual(expect.arrayContaining(['steps.1.checks.2', 'fixtures.1.note']));
    writeFileSync(join(dir, '.indx-watch', TC3), read(dir, TC3).replace('"The total is', '"The sum is'));
    const tr = (...kv: string[]) =>
      iwJson(dir, 'translate', ['translate', 'TC-3', '--locale', 'ja', ...kv.flatMap((x) => ['--set', x])]);
    expect(tr('steps.1.checks.2=合計').json.error.message).toContain('steps.1.checks.1');
    expect(tr('steps.1.checks.3=x').code).toBe(2);
    const steps = [
      'steps.1.instruction=a',
      'steps.1.expected=b',
      'steps.1.checks.1=c1',
      'steps.1.checks.2=c2',
    ];
    expect(tr(...steps, 'fixtures.1.note=n').json.data.written).toContain('fixtures.1.note');
    expect(read(dir, TC3)).toContain('checks = ["c1", "c2"]');
    expect(tr('steps.1.checks.1=d1').json.data.written).toEqual(['steps.1.checks.1']);
    expect(read(dir, TC3)).toContain('checks = ["d1", "c2"]');
    expect(iwJson(dir, 'translate', ['translate', 'TC-3', '--locale', 'ja', '--set', 'nope=x']).code).toBe(2);
  });

  it('translate refuses fields without source text and drops translations of removed fields', () => {
    const dir = shop();
    const tr = (ref: string, ...kv: string[]) =>
      iwJson(dir, 'translate', ['translate', ref, '--locale', 'ja', ...kv.flatMap((x) => ['--set', x])]);
    expect(tr('TC-8', 'preconditions=x').json.error.code).toBe('USAGE'); // TC-8 has no preconditions
    const src = read(dir, TC3);
    writeFileSync(
      join(dir, '.indx-watch', TC3),
      src.replace(/^checks = \["The discount.*\n/m, '').replace(/^note = "Type this code.*\n/m, ''),
    );
    expect(tr('TC-3', 'steps.1.checks.1=x').json.error.code).toBe('USAGE');
    expect(tr('TC-3', 'fixtures.1.note=x').json.error.code).toBe('USAGE');
    const step = tr('TC-3', 'steps.1.instruction=a', 'steps.1.expected=b');
    expect(step.json.data.written).toEqual(['steps.1.instruction', 'steps.1.expected']);
    expect(read(dir, TC3)).not.toContain('割引行に');
    const problems = iwJson(dir, 'check', ['check']).json.data.problems as { code: string; path?: string }[];
    expect(problems.filter((x) => x.path === 'steps[0].i18n.ja' && x.code !== 'missing-literal')).toEqual([]);
  });
});
