/** Small helpers shared by every command: errors, argument shorthands, value coercion, git, packaged files. */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Problem } from '@indx-watch/bundle';
import type { ArgDef } from 'citty';
import type { ErrorCode } from './json.js';

export type Env = Record<string, string | undefined>;
export type Args = Record<string, string | boolean | string[] | undefined>;

/** What a command returns: `data` for --json, `text` for people. */
export interface Out {
  data: unknown;
  warnings?: Problem[];
  text?: string;
}
export interface Ctx {
  cwd: string;
  env: Env;
  /** reads GitHub issues for `iw import github-issue` (tests pass a fake; default: the REST adapter) */
  issues?: import('@indx-watch/store').IssueSource;
  /** structured input from the MCP server instead of --from */
  input?: Record<string, unknown>;
  /** warnings found on the way (definition files that do not load), added to every command's output */
  notes?: Problem[];
  log(line: string): void;
  stdin(): Promise<string>;
}

export class CliError extends Error {
  /** text: human output printed before the error (e.g. the status of a failed gate) */
  constructor(
    public code: ErrorCode,
    message: string,
    public details?: unknown[],
    public data?: unknown,
    public text?: string,
  ) {
    super(message);
  }
}
type FailArgs = [code: ErrorCode, message: string, details?: unknown[], data?: unknown, text?: string];
export const fail = (...a: FailArgs): never => {
  throw new CliError(...a);
};

// citty argument shorthands: string, boolean, positional
export const S = (d?: string, required = false): ArgDef => ({ type: 'string', description: d, required });
export const B = (d?: string): ArgDef => ({ type: 'boolean', description: d });
export const P = (d: string, required = true): ArgDef => ({ type: 'positional', description: d, required });

export const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);
export const many = (v: unknown): string[] => (Array.isArray(v) ? v : typeof v === 'string' ? [v] : []);
export const csv = (v: unknown) => many(v).flatMap((s) => s.split(/\s*,\s*/).filter(Boolean));
export const iso = (d = new Date()) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
/** The named fields of an object ('a b c'). */
export const pick = (o: object, keys: string) =>
  Object.fromEntries(keys.split(' ').map((k) => [k, (o as Record<string, unknown>)[k]]));

/** git output (trimmed) or null. */
export function git(cwd: string, ...args: string[]): string | null {
  try {
    return String(execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'ignore'] })).trim();
  } catch {
    return null;
  }
}

/** Directory of this module: dist/ when bundled, src/ when run from source. */
export const here = dirname(fileURLToPath(import.meta.url));
/** A file shipped in the package (dist/<dist>), or its repository path when running from source. */
export function asset(dist: string, repo: string): string {
  const bundled = basename(here) === 'dist';
  const hits = (bundled ? [join(here, dist), join(here, '..', dist)] : [join(here, '../../..', repo)]).filter(
    existsSync,
  );
  return hits[0] ?? fail('INTERNAL', `missing packaged file ${dist}; reinstall indx-watch`);
}
