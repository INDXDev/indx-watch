/** Editing definitions in workspace mode (docs/spec/web.md#editing-in-workspace-mode): a `file` record per save. */
import * as B from '@indx-watch/bundle';
import { canInvite, EMAIL, inviteItems, isAssignee, type Model } from '@indx-watch/core';
import { headsOf, versionsByEntity } from '@indx-watch/sync';
import type { Context } from 'hono';
import type { Ctx } from './app.js';
import type { AssignInput, AssignResult, InviteInput, InviteResult, TestCaseEdit } from './contract.js';
import { bad, fail, HttpError, notFound } from './http.js';
import { assignPlan } from './tools.js';

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
  if (input.links === null) delete out.links;
  else if (input.links !== undefined) {
    const links = [...new Set(input.links)];
    if (!links.every((l) => typeof l === 'string' && /^https?:\/\/[^\s]+$/i.test(l)))
      throw bad('links: http(s) URLs');
    out.links = links;
  }
  if (input.steps !== undefined) {
    if (!Array.isArray(input.steps) || !input.steps.length) throw bad('steps: at least one step');
    const old = (data.steps ?? []) as Record<string, unknown>[];
    // the steps shown are expanded, so they cannot be mapped back onto a file that uses shared steps
    if (old.some((s) => s.use))
      throw bad('steps: this test case uses shared steps; edit them in steps/SS-n-….toml');
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
  if (dec.decode(data) === dec.decode(current)) return { file }; // nothing changed: no new version
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
  if (!canInvite(x.deps.roles))
    throw new HttpError(409, 'conflict', 'invites need pinned [hosting.roles] with no default role');
  const body: Partial<InviteInput> = revoke
    ? {}
    : await c.req.json<InviteInput>().catch(() => fail(bad('request body must be JSON')));
  const email = (revoke ? c.req.param('email') : body.email) ?? '';
  if (!EMAIL.test(email)) throw bad('email must be an email address');
  const keys = revoke ? (c.req.query('items')?.split(',').filter(Boolean) ?? []) : (body.items ?? []);
  const m = await x.model(c);
  const key = c.req.param('key')!.toUpperCase();
  const plan = m.plans.find((p) => p.key.toUpperCase() === key) ?? fail(notFound('plan'));
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
  const { changed: items, reassigned } = r!;
  const out: InviteResult = { ...saved, email, plan: plan.key, items, reassigned, revoked: revoke, access };
  return c.json(out, revoke ? 200 : 201);
}

const mine = (a: string | undefined, id: string) => a?.toLowerCase() === id.toLowerCase();

/**
 * POST /api/plans/:key/assign: set or split assignees (docs/spec/security.md#customer-uat). A lead may do all of it; a
 * tester may take an unassigned item for themselves or give back one assigned to them. Writes like an invite.
 */
export async function assign(c: Context, x: Ctx) {
  const [who, { role }] = [await x.actor(c), await x.grant(c)];
  const body = await c.req.json<AssignInput>().catch(() => fail(bad('request body must be JSON')));
  const m = await x.model(c);
  const plan =
    m.plans.find((p) => p.key.toUpperCase() === c.req.param('key')!.toUpperCase()) ?? fail(notFound('plan'));
  const dry = body.dry_run === true;
  if (!dry && who.kind !== 'human')
    throw new HttpError(403, 'forbidden', 'only a person may assign; propose with dry_run');
  const split = body.split !== undefined;
  if (split === (body.to !== undefined)) throw bad('send `split`, or `to` with `items`');
  const keys = new Set((body.items ?? []).map((k) => k.toUpperCase()));
  const items = (plan.items ?? []).filter((i) => keys.has(i.test_case.toUpperCase()));
  const ownTurn =
    typeof body.to === 'string'
      ? mine(body.to, who.id) && items.every((i) => !i.assignee)
      : body.to === null && items.every((i) => mine(i.assignee, who.id));
  if (role !== 'lead' && !(role === 'tester' && ownTurn && !split && !dry && keys.size))
    throw new HttpError(403, 'forbidden', 'a tester may only take unassigned items or give back their own');
  let r: ReturnType<typeof assignPlan>;
  try {
    r = assignPlan(m, {
      plan: plan.key,
      split: body.split,
      to: body.to,
      items: [...keys],
      onlyUnassigned: body.only_unassigned,
    });
  } catch (e) {
    if (!(e instanceof B.BundleError)) throw e;
    throw e.code === 'NOT_FOUND' ? notFound(e.message.replace(/ not found$/, '')) : bad(e.message);
  }
  const out: AssignResult = { ...r.data, dry_run: dry };
  if (dry) return c.json(out);
  const next = r.data.assignments;
  const target = { entity: plan.id, type: 'plan' } as const;
  const saved = await saveFile(c, x, m, target, (data) => (next.length ? { ...data, items: r.items } : data));
  return c.json({ ...out, ...saved } satisfies AssignResult, 201);
}
