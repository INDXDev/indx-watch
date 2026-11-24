/**
 * Secrets kept by INDX Watch and who has access (docs/spec/security.md#secrets, #sharing): `secret` records sealed
 * with IW_SECRETS_KEY, so only this server can read a value or write sharing that counts; every reveal is recorded.
 */
import * as B from '@indx-watch/bundle';
import { canSee, customerModel, isAssignee, type Model, type Principal, roleOf } from '@indx-watch/core';
import type { Context, Hono } from 'hono';
import type { Ctx } from './app.js';
import type { Access, AccessOverview, SecretInput, SecretList, SecretView } from './contract.js';
import { bad, fail, HttpError, notFound } from './http.js';

/** Who has access to an item shared with `shared`, by the role table (docs/spec/security.md#sharing). Pure; tested. */
export function accessOf(shared: readonly string[] | undefined, roles: B.Roles | undefined): Access[] {
  if (!roles) return [{ who: '*', why: 'everyone' }];
  const of = (role: B.Role, why: Access['why']) => (roles[role] ?? []).map((who) => ({ who, why, role }));
  const team = shared
    ? []
    : [
        ...of('tester', 'team'),
        ...of('viewer', 'team'),
        ...(roles.default ? [{ who: '*', why: 'team' as const, role: roles.default }] : []),
      ];
  return [...of('lead', 'lead'), ...team, ...(shared ?? []).map((who) => ({ who, why: 'shared' as const }))];
}

/** `iw:<name>` references of the fixtures and environments that name each secret. */
function usersOf(m: Model) {
  const out = new Map<string, string[]>();
  const add = (ref: string | undefined, by: string) => {
    if (ref?.startsWith('iw:')) out.set(ref.slice(3), [...(out.get(ref.slice(3)) ?? []), by]);
  };
  for (const f of m.fixtures.values()) add(f.data.account?.secret_ref, f.data.key);
  for (const e of m.environments) {
    const refs = [e.hooks?.seed?.secret_ref, e.hooks?.reset?.secret_ref, ...(e.access?.secret_refs ?? [])];
    for (const r of new Set(refs)) add(r, e.name);
  }
  return out;
}

type Current = { record: B.SecretRecord; value: string };

/** The secret routes; the sealer and the values of records already opened live as long as the app. */
export function registerSecretRoutes(app: Hono, x: Ctx) {
  const opened = new Map<string, string | null>();
  let sealer: B.SecretSealer | undefined;
  const seal = () => {
    if (!x.deps.secretsKey)
      throw new HttpError(503, 'unavailable', 'set IW_SECRETS_KEY (iw keygen --secrets)');
    sealer ??= B.secretSealer(x.deps.secretsKey);
    return sealer;
  };

  /** Per name, the newest `set` that opens with the key, unless a newer `delete` that opens follows it. */
  async function current(m: Model) {
    const s = seal();
    const out = new Map<string, Current | null>();
    const sorted = m.secrets
      .filter((r) => r.action !== 'reveal')
      .sort((a, b) => (a.at === b.at ? (a.id < b.id ? 1 : -1) : a.at < b.at ? 1 : -1));
    for (const r of sorted) {
      // every record is opened (once), so the history can leave out the ones that do not count
      if (!opened.has(r.id)) opened.set(r.id, await s.open(r));
      const value = opened.get(r.id);
      if (value != null && !out.has(r.name))
        out.set(r.name, r.action === 'set' ? { record: r, value } : null);
    }
    return new Map([...out].filter((e): e is [string, Current] => !!e[1]));
  }

  /** The secrets the request may see: shared with it, or (customers) not restricted and used by their test data. */
  async function visible(c: Context) {
    const [{ role, who }, all, mine] = [await x.grant(c), await x.model(null), await x.model(c)];
    const [secrets, used] = [await current(all), usersOf(mine)];
    const sees = ({ record: r }: Current) =>
      role === 'customer'
        ? r.shared_with
          ? canSee(r.shared_with, who, role)
          : (used.get(r.name) ?? []).some((k) => mine.fixtures.get(k) && !mine.fixtures.get(k)!.hidden)
        : canSee(r.shared_with, who, role);
    return { role, who, all, secrets: new Map([...secrets].filter(([, s]) => sees(s))) };
  }

  /**
   * A customer sees no history, no access list and not whom it is shared with: they name other people
   * (docs/spec/security.md#roles). The history leaves out `set` and `delete` records whose seal does not open.
   */
  const view = (m: Model, { record: r }: Current, customer = false): SecretView => {
    const { name, title, username, notes, at, actor } = r;
    const shared_with = customer && r.shared_with ? [] : r.shared_with;
    const history = m.secrets
      .filter((e) => e.name === name && (e.action === 'reveal' || opened.get(e.id) != null))
      .sort((a, b) => (a.at < b.at ? 1 : -1))
      .slice(0, customer ? 0 : 50)
      .map((e) => ({ action: e.action, at: e.at, actor: e.actor }));
    return {
      ...{ name, ref: `iw:${name}`, title, username, notes, shared_with, at, actor, history },
      ...{
        usedBy: usersOf(m).get(name) ?? [],
        access: customer ? [] : accessOf(r.shared_with, x.deps.roles),
      },
    };
  };

  /** Write one sealed `set` or `delete`, or an unsealed `reveal`. */
  type Fields = Pick<B.SecretRecord, 'action' | 'name' | 'title' | 'username' | 'notes' | 'shared_with'>;
  async function write(c: Context, m: Model, fields: Fields, value?: string) {
    const env = {
      kind: 'secret' as const,
      id: B.newId('rec'),
      v: 1 as const,
      project: m.project.id,
      at: x.now(),
    };
    const base = { ...env, actor: await x.actor(c), source: 'manual' as const, ...fields };
    const sealed = value === undefined ? undefined : await seal().seal(base, value);
    const record = B.SecretRecord.parse({ ...base, ...(sealed && { sealed }) });
    if (sealed) opened.set(record.id, value!);
    await x.deps.writeRecord(record);
    return record;
  }

  const nameOf = (c: Context) =>
    B.SecretName.safeParse(c.req.param('name')).data ??
    fail(bad('a secret name: letters, digits, "_", ".", "-"'));
  const editor = async (c: Context) => {
    const who = await x.actor(c);
    if (who.kind === 'agent') throw new HttpError(403, 'forbidden', 'agents use secret references only');
    return who;
  };

  app.get('/api/secrets', async (c) => {
    if (!x.deps.secretsKey) return c.json({ available: false, secrets: [] } satisfies SecretList);
    const { all, secrets, role } = await visible(c);
    const list = [...secrets.values()]
      .map((s) => view(all, s, role === 'customer'))
      .sort((a, b) => (a.name < b.name ? -1 : 1));
    return c.json({ available: true, secrets: list } satisfies SecretList);
  });

  app.post('/api/secrets/:name/reveal', async (c) => {
    const name = nameOf(c);
    const { all, secrets } = await visible(c);
    const s = secrets.get(name) ?? fail(notFound(`secret ${name}`));
    await write(c, all, { action: 'reveal', name });
    return c.json({ value: s.value });
  });

  app.put('/api/secrets/:name', async (c) => {
    await editor(c);
    const name = nameOf(c);
    const input = await c.req.json<SecretInput>().catch(() => fail(bad('request body must be JSON')));
    const { role, who, all, secrets } = await visible(c);
    const old = secrets.get(name);
    if (!old && (await current(all)).has(name))
      throw new HttpError(403, 'forbidden', `${name} is not shared with you`);
    // an empty value keeps the current one (docs/spec/web.md#secrets)
    const value =
      (typeof input.value === 'string' && input.value) ||
      (old?.value ?? fail(bad('value: a new secret needs a value')));
    const text = (k: 'title' | 'username' | 'notes') =>
      (k in input ? String(input[k] ?? '').trim() : old?.record[k]) || undefined;
    const list = input.shared_with;
    if (list != null && (!Array.isArray(list) || list.some((e) => typeof e !== 'string')))
      throw bad('shared_with: a list of emails and group:<name> entries, or null');
    const shared_with = list === undefined ? old?.record.shared_with : (list ?? undefined);
    const fixed = shared_with && [...new Set(shared_with.map((e) => e.trim()))];
    if (!canSee(fixed, who, role)) throw bad('you would lose access: share it with yourself too');
    const fields = {
      title: text('title'),
      username: text('username'),
      notes: text('notes'),
      shared_with: fixed,
    };
    const r = await write(c, all, { action: 'set', name, ...fields }, value);
    return c.json(view({ ...all, secrets: [...all.secrets, r] }, { record: r, value }), old ? 200 : 201);
  });

  app.delete('/api/secrets/:name', async (c) => {
    await editor(c);
    const name = nameOf(c);
    const { all, secrets } = await visible(c);
    const old = secrets.get(name) ?? fail(notFound(`secret ${name}`));
    await write(c, all, { action: 'delete', name, shared_with: old.record.shared_with }, '');
    return c.json({ name, deleted: true });
  });

  app.get('/api/access', async (c) =>
    accessOverview(c, x, await current(await x.model(null)).catch(() => new Map())),
  );
}

/** GET /api/access (leads): known people and groups and, for `?who=`, the fixtures and secrets that person can open. */
async function accessOverview(c: Context, x: Ctx, secrets: Map<string, Current>) {
  const m = await x.model(null);
  const roles = x.deps.roles;
  const lists = [
    ...Object.entries(roles ?? {}).flatMap(([k, v]) => (k === 'default' ? [] : (v as string[]))),
    ...[...m.fixtures.values()].flatMap((f) => f.data.shared_with ?? []),
    ...[...secrets.values()].flatMap((s) => s.record.shared_with ?? []),
    ...m.features.flatMap((f) => f.data.owners ?? []),
    ...m.plans.flatMap((p) => (p.items ?? []).flatMap((i) => i.assignee ?? [])),
  ];
  const unique = (xs: string[]) => [...new Set(xs.map((s) => s.toLowerCase()))].sort();
  const out: AccessOverview = {
    people: unique(lists.filter((e) => B.Sharee.safeParse(e).success && !e.startsWith('group:'))),
    groups: unique(lists.filter((e) => e.startsWith('group:'))),
  };
  const id = c.req.query('who')?.trim().toLowerCase();
  if (!id) return c.json(out);
  const who: Principal = { id, groups: [] };
  const role = roles ? (roleOf(roles, who) ?? roleOf(roles, who, isAssignee(m.plans, id))) : 'lead';
  // a customer sees only the test data of their assigned test cases, and a team secret only when it uses it
  const cm = role === 'customer' ? customerModel(m, who) : undefined;
  const used = cm && usersOf(cm);
  const reach = (type: 'fixture' | 'secret', key: string, shared?: string[]) =>
    !cm ||
    (type === 'fixture'
      ? cm.fixtures.has(key)
      : !!shared ||
        (used?.get(key) ?? []).some((k) => canSee(cm.fixtures.get(k)?.data.shared_with, who, role)));
  const item = (type: 'fixture' | 'secret', key: string, title: string, shared?: string[]) => {
    const inReach = !!role && reach(type, key, shared);
    const can = inReach && canSee(shared, who, role);
    const why = !can ? 'none' : !roles ? 'everyone' : role === 'lead' ? 'lead' : shared ? 'shared' : 'team';
    const groups = can || !inReach ? [] : (shared ?? []).filter((e) => e.startsWith('group:'));
    return { type, key, title, can, why, ...(groups.length && { groups }) } as const;
  };
  out.items = [
    ...[...m.fixtures.values()].map((f) => item('fixture', f.data.key, f.data.title, f.data.shared_with)),
    ...[...secrets.values()].map(({ record: r }) => item('secret', r.name, r.title ?? r.name, r.shared_with)),
  ];
  return c.json({ ...out, who: id, ...(role && { role }) });
}
