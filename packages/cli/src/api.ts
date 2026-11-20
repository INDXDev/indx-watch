/**
 * Programmatic API, published as 'indx-watch' and 'indx-watch/api'.
 * The same functions the CLI uses: load a project, compute status, record a run.
 */
import { resolve } from 'node:path';
import type { Bundle, RunRecord } from '@indx-watch/bundle';
import type { Model } from '@indx-watch/core';
import { makeCtx } from './cli.js';
import { resultCommands } from './commands/results.js';
import * as cx from './context.js';
import type { Env } from './util.js';

export { computeStatus, decide, evaluateGate, reportData, testCaseStatus } from '@indx-watch/core';
export type { CommandName } from './json.js';
export { CommandData, ErrorEnvelope, EXIT_CODES } from './json.js';

/** Load the bundle found at or above `dir`, and the model built from it plus the local replica. */
export async function loadProject(
  dir = '.',
  env: Env = process.env,
): Promise<{ bundle: Bundle; model: Model; dir: string }> {
  const p = await cx.openProject(makeCtx(env, resolve(dir)), {});
  return { bundle: p.bundle, model: await cx.loadModel(p), dir: p.dir };
}

export interface RecordRunInput {
  testCase: string;
  verdict: 'pass' | 'fail' | 'blocked' | 'skipped';
  steps?: { index: number; status: 'pass' | 'fail' | 'blocked' | 'skipped'; note?: string }[];
  /** file paths, optionally with @step */
  evidence?: string[];
  note?: string;
  confidence?: number;
  release?: string;
  environment?: string;
  /** a directory inside the project (default: cwd) */
  dir?: string;
  env?: Env;
}

/** Record a run exactly like `iw record`; returns the record and the computed verdict. */
export async function recordRun(
  i: RecordRunInput,
): Promise<{ run: RunRecord; verdict: string; rule: number }> {
  const ctx = makeCtx(i.env ?? process.env, resolve(i.dir ?? '.'));
  const out = await resultCommands.record!.run(ctx, {
    tc: i.testCase,
    verdict: i.verdict,
    step: (i.steps ?? []).map((s) => `${s.index}=${s.status}${s.note ? `:${s.note}` : ''}`),
    evidence: i.evidence ?? [],
    note: i.note,
    confidence: i.confidence === undefined ? undefined : String(i.confidence),
    release: i.release,
    env: i.environment,
  });
  return out.data as { run: RunRecord; verdict: string; rule: number };
}
