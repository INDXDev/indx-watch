/** Editing definitions in workspace mode (docs/spec/web.md#editing-in-workspace-mode): a `file` record per save. */
import * as B from '@indx-watch/bundle';
import { EMAIL, inviteItems, isAssignee, type Model } from '@indx-watch/core';
import { headsOf, versionsByEntity } from '@indx-watch/sync';
import type { Context } from 'hono';
import type { Ctx } from './app.js';
import type { InviteInput, InviteResult, TestCaseEdit } from './contract.js';
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

type Edit = (data: Record<string, unknown>, who: B.Actor, at: string) => Record<string, unknown>;
type Target = { file?: string; entity: string; type: 'test-case' | 'plan' };

/** Save a new version of a definition file (found by `entity` without `file`) as a `file` record, after the edit guards. */
async function saveFile(c: Context, x: Ctx, m: Model, t: Target, edit: Edit) {
  if (!workspaceMode(m))
    throw new HttpError(409, 'conflict', 'definitions come from git here: edit the file');
  const records = (await x.deps.records?.()) ?? [];
  if (x.deps.mode === 'hosted' && !records.some((r) => r.kind === 'file'))
    throw new HttpError(
      409,
      'conflict',
      'no workspace in this store yet: run `iw sync` in a working copy first',
    );
  const files = (await x.deps.bundleFiles?.()) ?? new Map<string, Uint8Array>();
  const ours = ([p, d]: [string, Uint8Array]) =>
    p.endsWith('.toml') && B.parseToml(dec.decode(d)).id === t.entity;
  const file = t.file ?? [...files].find(ours)?.[0] ?? fail(notFound(t.entity));
  // saving on top of a conflict would silently drop the other value: it is resolved in a working copy
  if ([...files.keys()].some((p) => B.CONFLICT_FILE.test(p) && p.replace(B.CONFLICT_FILE, '$1') === file))
    throw new HttpError(409, 'conflict', `${file} has a conflict: resolve it in a working copy first`);
  const current = files.get(file) ?? fail(notFound(file));
  const [who, at] = [await x.actor(c), x.now()];
  const parsed = B.FILE_TYPES[t.type].safeParse(edit(B.parseToml(dec.decode(current)), who, at));
  if (!parsed.success)
    throw bad(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  const data = enc.encode(B.formatToml(t.type, parsed.data as Record<string, unknown>));
  const sha256 = await x.deps.putBlob(data, 'application/toml');
  const parents = headsOf(versionsByEntity(records).get(t.entity) ?? []).map((v) => v.id);
  const record = B.FileRecord.parse({
    ...{ kind: 'file', id: B.newId('rec'), v: 1, project: m.project.id, at, actor: who, source: 'manual' },
    ...{ path: file, entity: t.entity, sha256, parents },
  });
  await x.deps.writeRecord(record);
  await x.deps.writeFile?.(file, data);
  return { file, record };
}

/** PATCH /api/test-cases/:key: apply the changed fields to the current file and append a `file` record. */
export async function editTestCase(c: Context, x: Ctx) {
  const input = await c.req.json<TestCaseEdit>().catch(() => fail(bad('request body must be JSON')));
  const m = await x.model(c);
  if (!workspaceMode(m))
    throw new HttpError(409, 'conflict', 'definitions come from git here: edit the file');
  const t = m.testCases.get(m.keyOf(c.req.param('key')!) ?? '') ?? fail(notFound('test case'));
  const target = { file: t.file, entity: t.data.id, type: 'test-case' } as const;
  const saved = await saveFile(c, x, m, target, (data, who, at) => {
    const edited = applyEdit(data, input);
    return who.kind === 'agent' ? asDraft(edited, who, at) : edited;
  });
  return c.json(saved, 201);
}

/** POST /api/plans/:key/invites and DELETE …/:email: assign or unassign a customer, then the Access policy. */
export async function invite(c: Context, x: Ctx, revoke: boolean) {
  const who = await x.actor(c);
  if (who.kind !== 'human') throw new HttpError(403, 'forbidden', 'only a person may invite');
  if (!x.deps.roles) throw new HttpError(409, 'conflict', 'invites need [hosting.roles] pinned by iw deploy');
  const body: Partial<InviteInput> = revoke
    ? {}
    : await c.req.json<InviteInput>().catch(() => fail(bad('request body must be JSON')));
  const email = (revoke ? decodeURIComponent(c.req.param('email')!) : body.email) ?? '';
  if (!EMAIL.test(email)) throw bad('email must be an email address');
  const keys = revoke ? (c.req.query('items')?.split(',').filter(Boolean) ?? []) : (body.items ?? []);
  const m = await x.model(c);
  const plan = m.plans.find((p) => p.key === c.req.param('key')) ?? fail(notFound('plan'));
  let r: ReturnType<typeof inviteItems> | undefined;
  const target = { entity: plan.id, type: 'plan' } as const;
  const saved = await saveFile(c, x, m, target, (data) => {
    r = inviteItems((data.items ?? []) as B.PlanItem[], email, keys, revoke);
    return r.missing.length
      ? fail(notFound(`${r.missing.join(', ')} in ${plan.key}`))
      : { ...data, items: r.items };
  });
  const others = [...m.plans.filter((p) => p.id !== plan.id), { items: r!.items }];
  const policy = x.deps.accessPolicy;
  const kept = revoke && isAssignee(others, email);
  const access = !policy ? 'manual' : kept ? 'kept' : revoke ? 'removed' : 'added';
  if (policy && !kept)
    await (revoke ? policy.revoke(email) : policy.allow(email)).catch((e: Error) => {
      throw new HttpError(502, 'access-policy', `the plan was saved; ${e.message}`);
    });
  const out: InviteResult = { ...saved, email, plan: plan.key, items: r!.selected, revoked: revoke, access };
  return c.json(out, revoke ? 200 : 201);
}
