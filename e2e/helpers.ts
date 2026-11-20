import { execFileSync, spawn } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(ROOT, 'packages/cli/dist/bin.js');

export interface Result {
  code: number;
  stdout: string;
  stderr: string;
  json: any;
}

/** Run the built CLI. Never throws on a non-zero exit. */
export function iw(args: string[], opts: { cwd: string; env?: Record<string, string> }): Result {
  const env = { ...process.env, NO_COLOR: '1', IW_ACTOR: 'e2e@indx.dev', IW_ACTOR_NAME: 'E2E', ...opts.env };
  delete (env as Record<string, string | undefined>).IW_DIR;
  try {
    const stdout = execFileSync(process.execPath, [BIN, ...args], {
      cwd: opts.cwd,
      env,
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return { code: 0, stdout, stderr: '', json: parse(stdout) };
  } catch (e) {
    const err = e as { status: number; stdout: string; stderr: string };
    return {
      code: err.status ?? 1,
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? '',
      json: parse(err.stdout ?? ''),
    };
  }
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function tempDir(prefix = 'iw-e2e-'): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** A private copy of examples/shop (bundle + sample store) to mutate freely. */
export function shopCopy(): string {
  const dir = tempDir('iw-shop-');
  cpSync(join(ROOT, 'examples/shop/.indx-watch'), join(dir, '.indx-watch'), {
    recursive: true,
    filter: (src) => !/[/\\](runs|cache)([/\\]|$)/.test(src),
  });
  cpSync(join(ROOT, 'examples/shop/store'), join(dir, 'store'), { recursive: true });
  return dir;
}

/** Rows of a CSV fixture in this repo's own bundle (no quoting needed for our data). */
export function fixtureRows(path: string): Record<string, string>[] {
  const [head, ...lines] = readFileSync(join(ROOT, '.indx-watch/fixtures', path), 'utf8')
    .trim()
    .split('\n');
  const cols = head!.split(',');
  return lines.map((l) => {
    const cells = l.split(',');
    return Object.fromEntries(cols.map((c, i) => [c, cells[i] ?? '']));
  });
}

/** Start `iw serve` on a free port and resolve once it prints its URL. */
export function serve(cwd: string, env: Record<string, string> = {}): Promise<{ url: string; stop(): void }> {
  const child = spawn(process.execPath, [BIN, 'serve', '--port', '0', '--json'], {
    cwd,
    env: { ...process.env, NO_COLOR: '1', IW_ACTOR: 'tester@indx.dev', IW_ACTOR_NAME: 'Tester', ...env },
  });
  return new Promise((ok, fail) => {
    let out = '';
    child.stdout.on('data', (d) => {
      out += d;
      const m = /"url"\s*:\s*"([^"]+)"/.exec(out);
      if (m) ok({ url: m[1]!, stop: () => child.kill() });
    });
    child.on('exit', (code) => fail(new Error(`iw serve exited ${code}: ${out}`)));
    setTimeout(() => fail(new Error(`iw serve did not start: ${out}`)), 20_000);
  });
}
