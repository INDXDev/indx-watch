/** The opened project: bundle, local replica, model, identity, records and refs. */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { Actor, Bundle, BundleFs, Problem } from '@indx-watch/bundle';
import { AnyRecord, loadBundle, newId, parseToml } from '@indx-watch/bundle';
import { findBundleDir, nodeFs } from '@indx-watch/bundle/node';
import { buildVerifiedModel, type Model } from '@indx-watch/core';
import { type LocalReplica, StoreError } from '@indx-watch/store';
import { openReplica, processContext, processIdentity, processSigner } from '@indx-watch/store/node';
import { type Args, type Ctx, fail, git, iso, str } from './util.js';

export interface Project {
  dir: string;
  /** repository root (git), else the bundle's parent */
  root: string;
  fs: BundleFs;
  bundle: Bundle;
  replica: LocalReplica;
}

/** Find, load and validate the bundle (exit 3 when missing or when project.toml is invalid). */
export async function openProject(ctx: Ctx, a: Args): Promise<Project> {
  const dir = findBundleDir(ctx.cwd, { ...ctx.env, IW_DIR: str(a.dir) ?? ctx.env.IW_DIR }) ?? '';
  if (!existsSync(join(dir, 'project.toml')))
    fail('NO_BUNDLE', 'No .indx-watch/ with a project.toml here or above; run `iw init` or pass --dir');
  const fs = nodeFs(dir);
  const { bundle, problems } = await loadBundle(fs);
  const newer = problems.some((p) => p.code === 'unsupported-schema-version');
  const message = problems.map((p) => `${p.file}: ${p.message}`).join('; ');
  if (!bundle) fail(newer ? 'UNSUPPORTED_SCHEMA' : 'INVALID_CONFIG', message, problems);
  const root = git(dir, 'rev-parse', '--show-toplevel') ?? dirname(dir);
  return { dir, root, fs, bundle: bundle!, replica: openReplica(dir) };
}

export const loadModel = async (p: Project): Promise<Model> =>
  (await buildVerifiedModel(p.bundle, await p.replica.records())).model;
export const actorOf = (ctx: Ctx): Promise<Actor> =>
  processIdentity({ env: ctx.env, cwd: ctx.cwd }).current();
/**
 * Signs written records with IW_SIGNING_KEY or through GitHub OIDC (docs/spec/security.md#signed-records); a no-op
 * without either. The key is read when a record is signed, so a malformed one (also broken key material) fails that
 * write with exit 3; a failed OIDC exchange fails it with exit 4.
 */
export function signerOf(ctx: Ctx) {
  const bad = (e: unknown) =>
    e instanceof StoreError
      ? Promise.reject(e)
      : fail('INVALID_CONFIG', 'IW_SIGNING_KEY is not a signing key from `iw keygen`');
  let sign: ReturnType<typeof processSigner> | undefined; // one signer: the OIDC token is reused
  return <R extends AnyRecord>(r: R) =>
    (async () => {
      sign ??= processSigner(ctx.env);
      return sign(r);
    })().catch(bad);
}
export const contextOf = (ctx: Ctx) => processContext({ env: ctx.env, cwd: ctx.cwd });

/** Refuse agents for approve / review / waive (exit 2). */
export async function humanOnly(ctx: Ctx, what: string): Promise<Actor> {
  const actor = await actorOf(ctx);
  if (actor.kind === 'agent') fail('USAGE', `Agents cannot ${what}; ask a human to run it`);
  return actor;
}

/** Build a record (envelope from the identity), validate it (canonical key order) and append it to the replica. */
export async function append<K extends AnyRecord['kind']>(ctx: Ctx, p: Project, kind: K, fields: object) {
  const actor = await actorOf(ctx);
  const source = actor.kind === 'agent' ? 'agent' : actor.kind === 'ci' ? 'ci' : 'cli';
  const prefix = ({ run: 'run', waiver: 'wvr', deployment: 'dep' } as const)[kind as 'run'] ?? 'rec';
  const envelope = { v: 1, project: p.bundle.project.data.id, at: iso(), actor, source };
  const r = await signerOf(ctx)(AnyRecord.parse({ kind, id: newId(prefix), ...envelope, ...fields }));
  await p.replica.putRecord(r);
  return r as Extract<AnyRecord, { kind: K }>;
}

export { resolveKey, resolveRun } from '@indx-watch/server';

/** Field values from --from <file|-> (JSON or TOML), or the MCP input. */
export async function fromInput(ctx: Ctx, a: Args): Promise<Record<string, unknown>> {
  const from = str(a.from);
  if (ctx.input || !from) return ctx.input ?? {};
  const text = from === '-' ? await ctx.stdin() : await readFile(resolve(ctx.cwd, from), 'utf8');
  let v: unknown;
  try {
    v = text.trim().startsWith('{') ? JSON.parse(text) : parseToml(text);
  } catch (e) {
    fail('INVALID_INPUT', `--from: ${(e as Error).message}`);
  }
  if (!v || typeof v !== 'object' || Array.isArray(v))
    fail('INVALID_INPUT', '--from needs a JSON or TOML object');
  return v as Record<string, unknown>;
}

/** Release of a scope: flag → IW_RELEASE → project.current_release. */
export const releaseOf = (ctx: Ctx, p: Project, a: Args) =>
  str(a.release) ?? ctx.env.IW_RELEASE ?? p.bundle.project.data.current_release;

/** A release or environment that names nothing: NOT_FOUND when given as a flag (a typo), else a warning. */
export function checkScope(m: Model, a: Args, scope: { release?: string; environment?: string }): Problem[] {
  const runs = [...m.runs.values()].map((v) => v.record);
  const known = {
    release: (v: string) =>
      m.releases.some((r) => r.version === v || r.refs?.includes(v)) || runs.some((r) => r.release === v),
    env: (v: string) => m.environments.some((e) => e.name === v) || runs.some((r) => r.environment === v),
  };
  const warnings: Problem[] = [];
  const given = { release: scope.release, env: scope.environment };
  for (const flag of ['release', 'env'] as const) {
    const [v, what] = [given[flag], flag === 'env' ? 'environment' : 'release'];
    if (!v || known[flag](v)) continue;
    const message = `Unknown ${what} ${v}: not in ${what}s/ and no runs use it`;
    if (str(a[flag])) fail('NOT_FOUND', message);
    warnings.push({ severity: 'warning', code: `unknown-${what}`, message });
  }
  return warnings;
}
