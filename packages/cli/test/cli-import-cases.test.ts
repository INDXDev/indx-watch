/** `iw import testrail` and `iw import testomatio` (T-522): draft use cases, criteria and test cases that pass check. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseToml } from '@indx-watch/bundle';
import { describe, expect, it } from 'vitest';
import { parseCsv, parseTestomatio, parseTestrail } from '../src/commands/import-cases.js';
import { read } from './cli-fixtures.js';
import { iw, iwJson, shop } from './helpers.js';

/** Hand-written, in the layout of TestRail's CSV export (one row per case; separated steps on the rows below). */
const TESTRAIL = [
  'ID,Title,Section Hierarchy,Priority,Preconditions,Steps (Step),Steps (Expected Result)',
  'C101,Pay by card,Checkout > Payment,Critical,"The cart holds one item, so there is something to pay for.","Open the cart, then press ""Pay""",The card form opens',
  ',,,,,Enter 4242 4242 4242 4242 and press Confirm,"The order is paid.',
  'A receipt is shown."',
  'C102,Pay by invoice,Checkout > Payment,Medium,,Choose Invoice,An invoice is offered',
  'C103,Change language,Settings,Low,,Open Settings and pick Japanese,The page is in Japanese',
  'C104,No steps here,Settings,,,,',
].join('\r\n');

const TESTOMATIO = `<!-- suite
id: @S380c64db
-->
# Login

Tests for the login process.

<!-- test
id: @T12345678
type: manual
priority: high
tags: critical, Smoke Test
-->
# Successful login

A user can log in.

## Steps

* Open the login page
  *Expected*: The form shows two fields
* Click "Login"
  *Expected*: The dashboard opens
  *Expected*: The user name is shown

<!-- example -->
| Username | Role |
| --- | --- |
| admin | admin |

<!-- test
id: @T87654321
priority: low
-->
# Wrong password

## Steps

* Enter a wrong password
`;

/** A parsed TOML file, as far as these tests look into it. */
type Toml = { criteria: { key: string; text: string; status: string; origin: string }[]; steps: unknown[] };

describe('parsers', () => {
  it('parseCsv reads quoted cells with commas, quotes and line breaks', () => {
    expect(parseCsv('a,b\r\n"x, ""y""","1\n2"\r\n\r\n')).toEqual([
      ['a', 'b'],
      ['x, "y"', '1\n2'],
    ]);
  });

  it('parseTestrail groups cases by the last section and joins separated steps', () => {
    const warnings: string[] = [];
    const groups = parseTestrail(TESTRAIL, (m) => warnings.push(m));
    expect(groups.map((g) => [g.title, g.cases.map((c) => c.id)])).toEqual([
      ['Payment', ['C101', 'C102']],
      ['Settings', ['C103', 'C104']],
    ]);
    const [pay] = groups[0]!.cases;
    expect(pay).toMatchObject({ priority: 'P0', preconditions: expect.stringContaining('one item') });
    expect(pay!.steps).toEqual([
      { instruction: 'Open the cart, then press "Pay"', expected: 'The card form opens' },
      {
        instruction: 'Enter 4242 4242 4242 4242 and press Confirm',
        expected: 'The order is paid.\nA receipt is shown.',
      },
    ]);
    expect(warnings).toEqual([]);
  });

  it('parseTestomatio reads suite, tests, metadata, steps with expected lines and ignores examples', () => {
    const warnings: string[] = [];
    const [login] = parseTestomatio(TESTOMATIO, (m) => warnings.push(m));
    expect(login!.title).toBe('Login');
    expect(login!.cases.map((c) => [c.id, c.title, c.priority, c.tags])).toEqual([
      ['@T12345678', 'Successful login', 'P1', ['critical', 'smoke-test']],
      ['@T87654321', 'Wrong password', 'P3', undefined],
    ]);
    expect(login!.cases[0]!.steps).toEqual([
      { instruction: 'Open the login page', expected: 'The form shows two fields' },
      { instruction: 'Click "Login"', expected: 'The dashboard opens\nThe user name is shown' },
    ]);
    expect(login!.cases[1]!.steps).toHaveLength(1);
    expect(warnings).toEqual(['Wrong password: a step has no expected result; it is a placeholder to write']);
  });
});

describe('iw import testrail', () => {
  const setup = () => {
    const dir = shop();
    const file = join(dir, 'cases.csv');
    writeFileSync(file, TESTRAIL);
    return { dir, file };
  };

  it('creates a draft use case per section with a criterion and a test case per case; check passes', () => {
    const { dir, file } = setup();
    const r = iwJson(dir, 'import', ['import', 'testrail', file, '--feature', 'FEAT-2']);
    expect(r.code, r.stderr).toBe(0);
    const { created, skipped, source } = r.json.data;
    expect([source, skipped]).toEqual(['testrail', 0]);
    expect(created.map((c: { key: string }) => c.key)).toEqual(['UC-6', 'TC-11', 'TC-12', 'UC-7', 'TC-13']);
    expect(r.json.warnings.map((w: { code: string }) => w.code)).toEqual(['import-no-steps']);
    const uc = parseToml(read(dir, created[0].file)) as Toml;
    expect(uc).toMatchObject({ title: 'Payment', status: 'draft', origin: 'import', priority: 'P0' });
    expect(uc.criteria.map((c) => [c.key, c.text, c.status, c.origin])).toEqual([
      ['AC-6.1', 'Pay by card', 'draft', 'import'],
      ['AC-6.2', 'Pay by invoice', 'draft', 'import'],
    ]);
    const tc = parseToml(read(dir, created[1].file)) as Toml;
    expect(tc).toMatchObject({
      ...{ title: 'Pay by card', status: 'draft', origin: 'import', mode: 'manual', covers: ['AC-6.1'] },
      ...{ x: { import: { source: 'testrail', id: 'C101' } } },
    });
    expect(tc.steps).toHaveLength(2);
    expect(created[0].file).toContain('FEAT-2-checkout/');
    const check = iwJson(dir, 'check', ['check']);
    expect(check.json.data.problems.filter((p: { severity: string }) => p.severity === 'error')).toEqual([]);
    // nothing counts until a person approves it
    expect(iwJson(dir, 'status', ['status']).json.data.counts).toBeDefined();
  });

  it('a second import changes nothing and says so', () => {
    const { dir, file } = setup();
    iwJson(dir, 'import', ['import', 'testrail', file, '--feature', 'FEAT-2']);
    const again = iwJson(dir, 'import', ['import', 'testrail', file, '--feature', 'FEAT-2']);
    expect(again.code, again.stderr).toBe(0);
    expect(again.json.data).toMatchObject({ created: [], skipped: 3 });
  });

  it('needs a file with a Title column; refuses archive flags', () => {
    const { dir } = setup();
    expect(iw(dir, ['import', 'testrail']).code).toBe(2);
    expect(iw(dir, ['import', 'testrail', join(dir, 'missing.csv')]).code).toBe(2);
    const bad = join(dir, 'bad.csv');
    writeFileSync(bad, 'a,b\n1,2\n');
    expect(iw(dir, ['import', 'testrail', bad]).code).toBe(2);
    expect(iw(dir, ['import', 'testrail', join(dir, 'cases.csv'), '--dry-run']).code).toBe(2);
  });
});

describe('iw import testomatio', () => {
  it('imports a folder of Markdown files as drafts that pass check; placeholders are warned about', () => {
    const dir = shop();
    const folder = join(dir, 'tests');
    mkdirSync(folder);
    writeFileSync(join(folder, 'login.test.md'), TESTOMATIO);
    const r = iwJson(dir, 'import', ['import', 'testomatio', folder]);
    expect(r.code, r.stderr).toBe(0);
    expect(r.json.data.files).toEqual(['tests/login.test.md']);
    expect(r.json.data.created.map((c: { key: string }) => c.key)).toEqual(['UC-6', 'TC-11', 'TC-12']);
    expect(r.json.warnings.map((w: { code: string }) => w.code)).toEqual(['import-no-expected']);
    const tc = parseToml(read(dir, r.json.data.created[1].file)) as Toml;
    expect(tc).toMatchObject({
      origin: 'import',
      status: 'draft',
      tags: ['critical', 'smoke-test'],
    });
    expect(iwJson(dir, 'check', ['check']).json.data.errors).toBe(0);
    expect(
      iwJson(dir, 'import', ['import', 'testomatio', join(folder, 'login.test.md')]).json.data,
    ).toMatchObject({
      created: [],
      skipped: 2,
    });
  });

  it('an agent writes AI drafts instead: it needs a model', () => {
    const dir = shop();
    const file = join(dir, 'login.test.md');
    writeFileSync(file, TESTOMATIO);
    expect(iw(dir, ['import', 'testomatio', file], { env: { CLAUDECODE: '1' } }).code).toBe(2);
    const r = iwJson(dir, 'import', ['import', 'testomatio', file, '--model', 'm'], {
      env: { CLAUDECODE: '1' },
    });
    expect(r.code, r.stderr).toBe(0);
    const uc = parseToml(read(dir, r.json.data.created[0].file)) as Toml;
    expect(uc).toMatchObject({ origin: 'ai', status: 'draft', ai: { model: 'm' } });
  });
});
