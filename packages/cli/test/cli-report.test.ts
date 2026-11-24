/** Report, archive and tooling commands on a temp copy of examples/shop: report, export, import, deploy, reindex, migrate, login, serve, help. */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createArchive } from '@indx-watch/bundle';
import { describe, expect, it } from 'vitest';
import { CommandData, okEnvelope } from '../src/json.js';
import { read, records, serverReady, TC3 } from './cli-fixtures.js';
import { cleanEnv, fakeBin, iw, iwJson, ROOT, shop, TSX } from './helpers.js';

describe('commands: report', () => {
  it('report --format json with IW_NOW/IW_ACTOR; md when the server package renders', () => {
    const dir = shop();
    const env = { IW_NOW: '2026-11-19T00:00:00Z' };
    const r = iwJson(dir, 'report', ['report', '--format', 'json', '--out', 'r.json'], { env });
    expect(r.json.data.file).toBe('r.json');
    const data = JSON.parse(readFileSync(join(dir, 'r.json'), 'utf8'));
    expect(data).toMatchObject({ generatedAt: '2026-11-19T00:00:00Z', generatedBy: 'qa@shop.test' });
    expect(data.bundleCommit).toBeUndefined();
    expect(iw(dir, ['report', '--format', 'docx']).code).toBe(2);
    if (!serverReady) return;
    const md = iw(dir, ['report'], { env });
    expect(md.code).toBe(0);
    expect(iw(dir, ['report'], { env }).stdout).toBe(md.stdout);
    expect(
      iwJson(dir, 'report', ['report', '--format', 'html', '--audience', 'customer']).json.data.file,
    ).toBe('report-v1.2.0.customer.html');
  });

  it('the report gate equals the gate of status --json for the same scope', () => {
    const dir = shop();
    iwJson(dir, 'sync', ['sync']); // the sample results: TC-8 fails
    for (const scope of [[], ['--env', 'staging'], ['--release', 'v1.2.0', '--env', 'staging']]) {
      const status = iwJson(dir, 'status', ['status', ...scope]).json.data;
      const r = iwJson(dir, 'report', ['report', ...scope, '--format', 'json', '--out', 'r.json']);
      expect(status.gate.passed).toBe(false);
      expect(r.json.data.gate, scope.join(' ')).toEqual(status.gate);
      const report = JSON.parse(readFileSync(join(dir, 'r.json'), 'utf8'));
      expect({ environment: null, ...report.scope }, scope.join(' ')).toEqual(status.scope);
      expect(report.status.gate, scope.join(' ')).toEqual(status.gate);
      if (!serverReady) continue;
      const md = iw(dir, ['report', ...scope]).stdout;
      for (const c of status.gate.checks)
        expect(md, `${scope.join(' ')} ${c.key}`).toContain(
          `| \`${c.actual}\` | \`${c.expected}\` | ${c.passed ? '✓' : '✕'}`,
        );
    }
  });
});

describe('commands: export and import', () => {
  it('export --full and import (dry run, conflicts, merge)', () => {
    const dir = shop();
    iwJson(dir, 'record', ['record', 'TC-1', '--verdict', 'pass']);
    const gz = iwJson(dir, 'export', ['export', '--full'], { env: { IW_NOW: '2026-11-19T00:00:00Z' } });
    expect(gz.json.data.archive).toBe(join(dir, 'shop-2026-11-19.tar.gz'));
    expect([...readFileSync(gz.json.data.archive).subarray(0, 2)]).toEqual([0x1f, 0x8b]); // gzip by default
    const ex = iwJson(dir, 'export', ['export', '--full', '--zstd', '--out', 'shop.tar.zst']).json.data;
    expect(ex.manifest.records).toBe(1);
    expect(readFileSync(join(dir, 'shop.tar.zst')).subarray(0, 4)).toEqual(
      Buffer.from([0x28, 0xb5, 0x2f, 0xfd]),
    );
    const zst = join(dir, 'shop.tar.zst');
    const to = mkdtempSync(join(tmpdir(), 'iw-imp-'));
    expect(iwJson(to, 'import', ['import', zst, '--dry-run']).json.data.dryRun).toBe(true);
    expect(existsSync(join(to, '.indx-watch'))).toBe(false);
    iwJson(to, 'import', ['import', zst]);
    expect(iw(to, ['check']).code).toBe(0);
    expect(records(to)).toHaveLength(1);
    expect(iwJson(to, 'import', ['import', zst]).json.error.code).toBe('CONFLICT');
    expect(iwJson(to, 'import', ['import', zst, '--merge', '--dry-run']).code).toBe(0);
    writeFileSync(join(to, '.indx-watch', TC3), `${read(to, TC3)}notes = "changed"\n`);
    expect(iwJson(to, 'import', ['import', zst, '--merge', '--dry-run']).code).toBe(1);
    expect(iw(dir, ['export']).code).toBe(2);
    expect(
      iwJson(mkdtempSync(join(tmpdir(), 'iw-gz-')), 'import', ['import', gz.json.data.archive]).code,
    ).toBe(0);
  });

  it('import refuses archive paths outside the bundle (zip slip)', async () => {
    const { tar } = await createArchive({
      project: 'SHOP',
      bundleFiles: [
        { path: 'project.toml', data: readFileSync(join(ROOT, 'examples/shop/.indx-watch/project.toml')) },
        { path: '../../escaped.txt', data: new TextEncoder().encode('pwned') },
      ],
      records: [],
      blobs: [],
    });
    const root = mkdtempSync(join(tmpdir(), 'iw-slip-'));
    const to = join(root, 'a', 'b');
    mkdirSync(to, { recursive: true });
    writeFileSync(join(to, 'evil.tar'), tar);
    const r = iwJson(to, 'import', ['import', 'evil.tar']);
    expect([r.code, r.json.error.code]).toEqual([2, 'INVALID_INPUT']);
    expect(existsSync(join(root, 'a', 'escaped.txt'))).toBe(false);
    expect(existsSync(join(to, '.indx-watch'))).toBe(false);
  });
});

describe('commands: deploy, reindex, migrate and login', () => {
  it('deploy --dry-run through a fake wrangler', () => {
    const bin = fakeBin({
      wrangler: 'case "$1" in --version) echo 4.165.0;; whoami) echo ok;; d1) echo "[]";; *) exit 1;; esac',
    });
    const r = iwJson(shop(), 'deploy', ['deploy', '--dry-run'], {
      env: { PATH: `${bin}:${process.env.PATH}` },
    });
    expect(r.json.data.resources.map((x: { type: string }) => x.type).sort()).toEqual(['d1', 'r2', 'worker']);
    expect(r.json.data.url).toBeNull();
  });

  it('reindex and migrate', () => {
    const dir = shop();
    expect(iwJson(dir, 'reindex', ['reindex']).json.data.definitions).toBeGreaterThan(20);
    expect(iwJson(dir, 'migrate', ['migrate']).json.data).toEqual({ from: 1, to: 1, changed: [] });
  });

  it('login wraps cloudflared', () => {
    const bin = fakeBin({ cloudflared: 'echo "logged in to $3"' });
    const env = { PATH: `${bin}:${process.env.PATH}` };
    expect(iwJson(tmpdir(), 'login', ['login', 'https://watch.example.com'], { env }).json.data.url).toBe(
      'https://watch.example.com',
    );
    const none = iwJson(tmpdir(), 'login', ['login', 'https://x.test'], { env: { PATH: '/nonexistent' } });
    expect([none.code, none.json.error.code]).toEqual([4, 'EXTERNAL_TOOL']);
  });
});

describe('commands: serve, --help and --version', () => {
  it.skipIf(!serverReady)('serve --json prints the URL; a non-loopback host warns', async () => {
    const dir = shop();
    const serve = async (...args: string[]) => {
      const child = spawn(process.execPath, [...TSX, 'serve', '--port', '0', '--json', ...args], {
        cwd: dir,
        env: cleanEnv(),
      });
      const line = await new Promise<string>((res) => child.stdout.once('data', (d) => res(String(d))));
      child.kill();
      const json = JSON.parse(line);
      expect(okEnvelope(CommandData.serve).safeParse(json).success, line).toBe(true);
      return json;
    };
    expect(await serve()).toMatchObject({
      ok: true,
      command: 'serve',
      data: { url: expect.stringMatching(/^http/) },
      warnings: [],
    });
    expect((await serve('--host', '0.0.0.0')).warnings).toEqual([
      expect.objectContaining({ code: 'public-host' }),
    ]);
  });

  it('--help and --version', () => {
    expect(iw(tmpdir(), ['--help']).stdout).toContain('record');
    expect(iw(tmpdir(), ['new', '--help']).stdout).toContain('--step');
    expect(iw(tmpdir(), ['fixture', 'add', '--help']).stdout).toContain('USAGE iw fixture add ');
    expect(iw(tmpdir(), ['deployment', 'add', '--help']).stdout).toContain('USAGE iw deployment add ');
    expect(iw(tmpdir(), ['--version']).stdout.trim()).toBe('0.1.2');
  });
});

describe('commands: status --mine and list --mine (docs/spec/concepts.md#feature-owners)', () => {
  it('narrows status and lists to the features the actor owns', () => {
    const dir = shop();
    iwJson(dir, 'sync', ['sync']);
    const env = { IW_ACTOR: 'alex@shop.test' }; // owns Checkout
    const mine = iwJson(dir, 'status', ['status', '--mine'], { env }).json.data;
    expect(mine.mine).toEqual({ actor: 'alex@shop.test', features: ['FEAT-2'] });
    expect(mine.testCases.map((t: { key: string }) => t.key)).toEqual(['TC-3', 'TC-4', 'TC-5', 'TC-6']);
    const all = iwJson(dir, 'status', ['status'], { env }).json.data;
    expect(all.mine).toBeUndefined();
    for (const t of mine.testCases) expect(all.testCases).toContainEqual(t);
    const tcs = iwJson(dir, 'list', ['list', 'tcs', '--mine'], { env }).json.data.items;
    expect(tcs.map((t: { key: string }) => t.key)).toEqual(['TC-3', 'TC-4', 'TC-5', 'TC-6']);
    const none = iwJson(dir, 'status', ['status', '--mine']).json.data; // qa@shop.test owns nothing by ID
    expect([none.mine.features, none.testCases]).toEqual([[], []]);
    expect(iw(dir, ['status', '--mine'], { env }).stdout).toContain('My features (alex@shop.test): FEAT-2');
  });
});
