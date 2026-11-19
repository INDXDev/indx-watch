/**
 * The only place that runs `wrangler`. Commands go through an injectable `Exec` so tests use a fake.
 * Swap for the `cf` CLI here once it replaces wrangler (docs/research/platform-notes.md#wrangler-and-cf).
 */
import { execFile } from 'node:child_process';
import { z } from 'zod';
import type { ErrorCode } from '../json.js';
import type { Existing } from './plan.js';

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}
/** Resolves with the exit code; rejects only when the program cannot be started (e.g. ENOENT). */
export type Exec = (file: string, args: string[], opts?: { env?: NodeJS.ProcessEnv }) => Promise<ExecResult>;
export type Run = (args: string[], env?: NodeJS.ProcessEnv) => Promise<ExecResult>;

/** Error carrying a CLI error code (packages/cli/src/json.ts → exit code). */
export class DeployError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DeployError';
  }
}

export const nodeExec: Exec = (file, args, opts) =>
  new Promise((resolve, reject) => {
    const options = {
      env: opts?.env ?? process.env,
      maxBuffer: 64 << 20,
      shell: process.platform === 'win32',
    };
    execFile(file, args, options, (err, stdout, stderr) => {
      if (err && typeof err.code === 'string') return reject(err);
      resolve({ code: err ? Number(err.code ?? 1) : 0, stdout: String(stdout), stderr: String(stderr) });
    });
  });

/** `wrangler` from PATH, else `npx --yes wrangler@4`. */
export async function wranglerRunner(exec: Exec): Promise<{ bin: string[]; run: Run }> {
  const onPath = await exec('wrangler', ['--version']).then(
    (r) => r.code === 0,
    () => false,
  );
  const bin = onPath ? ['wrangler'] : ['npx', '--yes', 'wrangler@4'];
  const run: Run = async (args, env) => {
    try {
      return await exec(bin[0]!, [...bin.slice(1), ...args], env ? { env } : undefined);
    } catch (e) {
      throw new DeployError('EXTERNAL_TOOL', `cannot start ${bin.join(' ')}: ${(e as Error).message}`);
    }
  };
  return { bin, run };
}

const D1List = z.array(z.object({ name: z.string(), uuid: z.string() }));

export async function listD1(run: Run): Promise<Existing['d1']> {
  const r = await run(['d1', 'list', '--json']);
  const json = r.stdout.slice(r.stdout.indexOf('['), r.stdout.lastIndexOf(']') + 1);
  const parsed = r.code === 0 ? D1List.safeParse(safeJson(json)) : null;
  if (!parsed?.success) throw new DeployError('EXTERNAL_TOOL', `wrangler d1 list failed: ${tail(r)}`);
  return parsed.data.map(({ name, uuid }) => ({ name, uuid }));
}

/** Read-only discovery: login, D1 databases, the R2 bucket, the Worker. */
export async function discover(run: Run, names: { worker: string; bucket: string }): Promise<Existing> {
  const who = await run(['whoami']);
  if (who.code !== 0 || /not (authenticated|logged in)/i.test(who.stdout + who.stderr)) {
    throw new DeployError(
      'EXTERNAL_TOOL',
      'wrangler is not logged in: run `npx wrangler login`, or set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID',
    );
  }
  const d1 = await listD1(run);
  const bucket = await run(['r2', 'bucket', 'info', names.bucket, '--json']);
  const worker = await run(['deployments', 'list', '--name', names.worker, '--json']);
  return { r2: bucket.code === 0 ? [names.bucket] : [], d1, worker: worker.code === 0 };
}

export function tail(r: ExecResult): string {
  return (r.stderr.trim() || r.stdout.trim()).split('\n').slice(-5).join('\n') || `exit ${r.code}`;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
