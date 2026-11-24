/** Error paths and first-run messages (docs/spec/cli.md): load problems, missing files, bad arguments, init. */
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { iw, iwJson, shop } from './helpers.js';

const UC4 = 'specs/FEAT-3-account/UC-4-customer-signs-in/use-case.toml';

describe('a definition file that does not load', () => {
  it('fails the gate, and every command warns about it; check reports it once with its position', () => {
    const dir = shop();
    iw(dir, ['sync']);
    const ok = iw(dir, ['status', '--gate']);
    expect(ok.stdout).not.toContain('valid_definitions');
    appendFileSync(join(dir, '.indx-watch', UC4), '\n[[[\n');
    const r = iw(dir, ['status', '--gate']);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain('FAIL valid_definitions: 1 (expected ≤ 0)');
    expect(r.stderr).toMatch(
      new RegExp(`warning: ${UC4}: warning invalid-toml .* at line \\d+, column \\d+: \\[\\[\\[`),
    );
    const j = iwJson(dir, 'status', ['status', '--gate']);
    expect(j.json.warnings).toMatchObject([{ severity: 'warning', code: 'invalid-toml', file: UC4 }]);
    expect(iwJson(dir, 'list', ['list', 'ucs']).json.warnings).toHaveLength(1);
    const c = iw(dir, ['check']);
    expect(c.code).toBe(1);
    expect(c.stderr).not.toContain('warning:');
    expect(c.stdout).toMatch(/invalid-toml .* at line \d+, column \d+: \[\[\[/);
    expect(`${c.stdout}${c.stderr}`.match(/\d+ files, \d+ errors, \d+ warnings?/g)).toHaveLength(1);
    const one = shop();
    const tc1 = join(
      one,
      '.indx-watch/specs/FEAT-1-catalog/UC-1-shopper-finds-product/TC-1-product-list.toml',
    );
    writeFileSync(tc1, `foo = 1\n${readFileSync(tc1, 'utf8')}`);
    expect(iw(one, ['check']).stderr).toMatch(/^error: \d+ files, 1 error, \d+ warnings?$/m);
  });
});

describe('usage and missing files', () => {
  it('missing --from files and --out folders are NOT_FOUND (exit 2), never a stack', () => {
    const dir = shop();
    for (const args of [
      ['record', '--tc', 'TC-1', '--verdict', 'pass', '--from', 'nope.json'],
      ['new', 'tc', '--uc', 'UC-1', '--title', 'x', '--from', 'nope.toml'],
      ['translate', 'TC-3', '--locale', 'ja', '--from', 'nope.json'],
      ['report', '--format', 'html', '--out', '/nonexistent/r.html'],
    ]) {
      const r = iw(dir, [...args, '--json']);
      expect([r.code, r.json?.error?.code], args.join(' ')).toEqual([2, 'NOT_FOUND']);
      expect(r.stderr).not.toContain('    at ');
    }
  });

  it('a bad --port and an unexpected argument are usage errors', () => {
    const dir = shop();
    for (const port of ['abc', '70000']) expect(iw(dir, ['serve', '--port', port]).code).toBe(2);
    const r = iw(dir, ['sync', 's3://other']);
    expect([r.code, r.stderr.trim()]).toEqual([2, 'error: Unexpected argument s3://other']);
  });

  it('list tcs sorts keys by number and marks drafts; status without ready criteria says so', () => {
    const dir = shop();
    const keys = iw(dir, ['list', 'tcs']).stdout.trim().split('\n');
    expect(keys.map((l) => l.split(' ')[0])).toEqual([...Array(10)].map((_, i) => `TC-${i + 1}`));
    expect(keys.filter((l) => l.endsWith('(draft)')).map((l) => l.split(' ')[0])).toEqual(['TC-9', 'TC-10']);
    const empty = mkdtempSync(join(tmpdir(), 'iw-empty-'));
    iw(empty, ['init', '--no-agents']);
    iw(empty, ['new', 'uc', '--title', 'Pay', '--ac', 'It works', '--origin', 'ai', '--model', 'm']);
    expect(iw(empty, ['status']).stdout).toContain('Coverage: no ready acceptance criteria yet');
  });
});

describe('iw init', () => {
  it('--example pulls the sample results; a second init says it is set up; help has no stray prefix', () => {
    const dir = mkdtempSync(join(tmpdir(), 'iw-init-'));
    const r = iw(dir, ['init', 'app', '--example', '--no-agents']);
    expect(r.stdout).toContain('pulled 9 sample results');
    expect(r.stdout).toContain('npx indx-watch serve --dir app/.indx-watch --open');
    expect(iw(join(dir, 'app'), ['status']).stdout).toMatch(/fail 1/);
    const again = iw(dir, ['init', 'app']);
    expect(again.code).toBe(1);
    expect(again.stderr).toContain('Already set up');
    expect(again.stderr).toContain('npx indx-watch skills install');
    expect(iw(dir, ['init', '--help']).stdout).not.toContain('cx.');
    const fresh = iw(dir, ['init', 'two']);
    expect(fresh.stdout).toContain('say "Set up testing for this repo" (/iw-setup, $iw-setup)');
    expect(readFileSync(join(dir, 'two/.indx-watch/project.toml'), 'utf8')).toContain('key = "TWO"');
  });
});
