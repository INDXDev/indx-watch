/** Editing definitions in workspace mode (docs/spec/web.md#editing-in-workspace-mode): a `file` record per save. */
import * as B from '@indx-watch/bundle';
import type { Model } from '@indx-watch/core';
import { headsOf, versionsByEntity } from '@indx-watch/sync';
import type { Context } from 'hono';
import type { Ctx } from './app.js';
import type { TestCaseEdit } from './contract.js';
import { bad, fail, HttpError, notFound } from './http.js';

const [enc, dec] = [new TextEncoder(), new TextDecoder()];
export const workspaceMode = (m: Model | undefined) => m?.project.store?.mode === 'workspace';
const text = (v: unknown, what: string) =>
  typeof v === 'string' && v.trim() ? v.trim() : fail(bad(`${what} must be a non-empty string`));

/** The fields of a test case after an edit: title, priority (null removes it) and steps (other step fields kept by index). */
function applyEdit(data: Record<string, unknown>, input: TestCaseEdit) {
  const out = { ...data };
  if (input.title !== undefined) out.title = text(input.title, 'title');
  if (input.priority === null) delete out.priority;
  else if (input.priority !== undefined)
    out.priority = B.Priority.safeParse(input.priority).success
      ? input.priority
      : fail(bad('priority: P0–P3'));
  if (input.steps !== undefined) {
    if (!Array.isArray(input.steps) || !input.steps.length) throw bad('steps: at least one step');
    const old = (data.steps ?? []) as Record<string, unknown>[];
    out.steps = input.steps.map((s, i) => ({
      ...old[i],
      instruction: text(s?.instruction, `step ${i + 1}: instruction`),
      expected: text(s?.expected, `step ${i + 1}: expected`),
    }));
  }
  return out;
}

/** An agent's edit is an AI draft that a person approves again (docs/spec/security.md#identity). */
function asDraft(data: Record<string, unknown>, who: B.Actor, at: string) {
  const { approved_by: _, approved_version: __, ...rest } = data;
  const ai = (data.ai ?? {}) as Partial<B.AiMeta>;
  const meta = {
    model: who.model ?? ai.model ?? 'unknown',
    skill: ai.skill,
    created_at: ai.created_at ?? at,
  };
  return { ...rest, status: 'draft', origin: 'ai', ai: meta };
}

/** PATCH /api/test-cases/:key: apply the changed fields to the current file and append a `file` record. */
export async function editTestCase(c: Context, x: Ctx) {
  const input = await c.req.json<TestCaseEdit>().catch(() => fail(bad('request body must be JSON')));
  const m = await x.model();
  if (!workspaceMode(m))
    throw new HttpError(409, 'conflict', 'definitions come from git here: edit the file');
  const t = m.testCases.get(m.keyOf(c.req.param('key')!) ?? '') ?? fail(notFound('test case'));
  const records = (await x.deps.records?.()) ?? [];
  if (x.deps.mode === 'hosted' && !records.some((r) => r.kind === 'file'))
    throw new HttpError(
      409,
      'conflict',
      'no workspace in this store yet: run `iw sync` in a working copy first',
    );
  const files = (await x.deps.bundleFiles?.()) ?? new Map<string, Uint8Array>();
  // saving on top of a conflict would silently drop the other value: it is resolved in a working copy
  if ([...files.keys()].some((p) => B.CONFLICT_FILE.test(p) && p.replace(B.CONFLICT_FILE, '$1') === t.file))
    throw new HttpError(409, 'conflict', `${t.file} has a conflict: resolve it in a working copy first`);
  const current = files.get(t.file) ?? fail(notFound(t.file));
  const [who, at] = [await x.actor(c), x.now()];
  const edited = applyEdit(B.parseToml(dec.decode(current)), input);
  const parsed = B.TestCase.safeParse(who.kind === 'agent' ? asDraft(edited, who, at) : edited);
  if (!parsed.success)
    throw bad(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  const data = enc.encode(B.formatToml('test-case', parsed.data as Record<string, unknown>));
  const sha256 = await x.deps.putBlob(data, 'application/toml');
  const parents = headsOf(versionsByEntity(records).get(t.data.id) ?? []).map((v) => v.id);
  const record = B.FileRecord.parse({
    ...{ kind: 'file', id: B.newId('rec'), v: 1, project: m.project.id, at, actor: who, source: 'manual' },
    ...{ path: t.file, entity: t.data.id, sha256, parents },
  });
  await x.deps.writeRecord(record);
  await x.deps.writeFile?.(t.file, data);
  return c.json({ file: t.file, record }, 201);
}
