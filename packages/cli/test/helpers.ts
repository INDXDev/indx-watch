/** Test helpers: a temp copy of examples/shop and the CLI spawned through tsx (stdin is a pipe, never a TTY). */
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from 'vitest';
import { CommandData, type CommandName, ErrorEnvelope, okEnvelope } from '../src/json.js';

export const ROOT = join(import.meta.dirname, '../../..');
const BIN = join(ROOT, 'packages/cli/src/bin.ts');
/** tsx's CLI run by this node, so a test may replace PATH entirely */
export const TSX = [join(ROOT, 'node_modules/tsx/dist/cli.mjs'), BIN];

/** process.env without agent markers, CI variables or IW_* overrides, plus a fixed human actor. */
export function cleanEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env))
    if (v !== undefined && !/^(IW_|CODEX_|GITHUB_|CLAUDECODE$|CI$)/.test(k)) env[k] = v;
  return { ...env, IW_ACTOR: 'qa@shop.test', NO_COLOR: '1', ...extra };
}

/** A temp directory holding a copy of examples/shop/.indx-watch and its sample store. */
export function shop(): string {
  const dir = mkdtempSync(join(tmpdir(), 'iw-cli-'));
  const skip = /[/\\](runs|cache)([/\\]|$)/;
  cpSync(join(ROOT, 'examples/shop/.indx-watch'), join(dir, '.indx-watch'), {
    recursive: true,
    filter: (s) => !skip.test(s),
  });
  cpSync(join(ROOT, 'examples/shop/store'), join(dir, 'store'), { recursive: true });
  return dir;
}

export interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
  // biome-ignore lint/suspicious/noExplicitAny: test convenience
  json: any;
}

export function iw(
  cwd: string,
  args: string[],
  opts: { env?: Record<string, string>; input?: string } = {},
): Run {
  const r = spawnSync(process.execPath, [...TSX, ...args], {
    cwd,
    env: cleanEnv(opts.env),
    input: opts.input ?? '',
    encoding: 'utf8',
  });
  let json: unknown;
  try {
    json = JSON.parse(r.stdout);
  } catch {}
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, json };
}

/** Run with --json and check the envelope against packages/cli/src/json.ts. */
export function iwJson(
  cwd: string,
  name: CommandName,
  args: string[],
  opts: Parameters<typeof iw>[2] = {},
): Run {
  const r = iw(cwd, [...args, '--json'], opts);
  expect(r.stdout.trim().split('\n'), r.stderr).toHaveLength(1);
  const schema = r.json?.ok ? okEnvelope(CommandData[name]) : ErrorEnvelope;
  const parsed = schema.safeParse(r.json);
  expect(parsed.success, `${r.stdout}\n${r.stderr}\n${parsed.error}`).toBe(true);
  expect(r.json.command).toBe(name);
  return r;
}

/** A directory with fake executables (e.g. wrangler, cloudflared) to put first on PATH. */
export function fakeBin(scripts: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'iw-bin-'));
  mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(scripts)) {
    writeFileSync(join(dir, name), `#!/bin/sh\n${body}\n`);
    chmodSync(join(dir, name), 0o755);
  }
  return dir;
}
