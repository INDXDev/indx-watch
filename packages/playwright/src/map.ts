/** Pure functions that map Playwright results to INDX Watch records (docs/spec/integrations.md#mapping). */
import { type Build, type Bundle, type EvidenceKind, newUlid, parseRef } from '@indx-watch/bundle';
import type { Model, TestCaseNode } from '@indx-watch/core';

type Env = Record<string, string | undefined>;

/** Test case tags of one test: mapped nodes, plus tags that look like this project's TC refs but are unknown. */
export function mapTags(model: Model, tags: readonly string[]): { tcs: TestCaseNode[]; unknown: string[] } {
  const tcs = new Map<string, TestCaseNode>();
  const unknown: string[] = [];
  for (const tag of new Set(tags)) {
    const ref = parseRef(tag.replace(/^@/, ''));
    if (!ref) continue;
    if (
      ref.type === 'key' &&
      (!ref.key.startsWith('TC-') || (ref.project && ref.project !== model.project.key))
    )
      continue; // other kinds of keys and other projects' test cases are not ours
    if (ref.type === 'id' && ref.prefix !== 'tc') continue;
    const key = ref.type === 'id' ? model.keyOf(ref.id) : ref.key;
    const node = key ? model.testCases.get(key) : undefined;
    if (node) tcs.set(node.data.key, node);
    else unknown.push(tag);
  }
  return { tcs: [...tcs.values()], unknown };
}

/** '_iw.fixture' annotations ('FX-1:SUMMER10') → fixture key → sorted rows. */
export function annotatedRows(annotations: readonly { type: string; description?: string }[]) {
  const rows = new Map<string, string[]>();
  for (const a of annotations) {
    const m = a.type === '_iw.fixture' ? /^(FX-\d+):(.+)$/.exec(a.description?.trim() ?? '') : null;
    if (m) rows.set(m[1]!, [...new Set([...(rows.get(m[1]!) ?? []), m[2]!])].sort());
  }
  return rows;
}

/** Step number from a 'N. title' step title. */
export const stepNumber = (title: string) => {
  const m = /^\s*(\d+)\.\s/.exec(title);
  return m ? Number(m[1]) : undefined;
};

interface StepLike {
  title: string;
  category?: string;
  error?: { message?: string };
  steps?: StepLike[];
  attachments?: { name: string; path?: string }[];
}

/** Numbered test.step results (any depth) → step number → status and first error line. */
export function numberedSteps(steps: readonly StepLike[], out = new Map<number, StepLike>()) {
  for (const s of steps) {
    const n = s.category === 'test.step' ? stepNumber(s.title) : undefined;
    if (n && !out.has(n)) out.set(n, s);
    numberedSteps(s.steps ?? [], out);
  }
  return out;
}

export function evidenceKind(name: string, contentType: string): EvidenceKind {
  if (name === 'trace' || (/trace/i.test(name) && contentType === 'application/zip')) return 'trace';
  if (contentType.startsWith('video/')) return 'video';
  if (contentType.startsWith('image/')) return 'screenshot';
  if (isText(contentType)) return 'log';
  return 'file';
}
export const isText = (type: string) => /^text\/|^application\/(json|xml)\b/.test(type);

/** `env:` secret references of an environment (access credentials and hook tokens). */
export const environmentRefs = (e: Bundle['environments'][number]) => [
  ...(e.data.access?.secret_refs ?? []),
  e.data.hooks?.seed?.secret_ref,
  e.data.hooks?.reset?.secret_ref,
];

/** Values (3+ characters) of `env:` secret references that are set in this process. */
export const resolveRefs = (refs: (string | undefined)[], env: Env): string[] =>
  refs.flatMap((r) => {
    const v = r?.startsWith('env:') ? env[r.slice(4)] : undefined;
    return v && v.length >= 3 ? [v] : [];
  });

const ENTITY = ['&amp;', '&lt;', '&gt;', '&quot;', '&#39;'];
/** A value as it appears in logs and requests: raw, URL- and form-encoded, JSON- and HTML-escaped. */
const forms = (v: string) => [
  v,
  encodeURIComponent(v),
  new URLSearchParams({ v }).toString().slice(2),
  JSON.stringify(v).slice(1, -1),
  v.replace(/[&<>"']/g, (c) => ENTITY[`&<>"'`.indexOf(c)]!),
];

/** Secret values of the bundle set in this process, in all their forms (plus Basic auth of accounts), longest first. */
export function secretValues(bundle: Bundle, env: Env): string[] {
  const values = [
    ...resolveRefs(bundle.environments.flatMap(environmentRefs), env).flatMap(forms),
    ...bundle.fixtures.flatMap((f) =>
      resolveRefs([f.data.account?.secret_ref], env).flatMap((v) => [
        ...forms(v),
        Buffer.from(`${f.data.account?.username}:${v}`).toString('base64'),
      ]),
    ),
  ];
  return [...new Set(values)].sort((a, b) => b.length - a.length);
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: strips ANSI color codes from Playwright errors
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;
/** Plain text with ANSI codes stripped and secret values replaced, at most `max` characters. */
export function redactor(secrets: readonly string[]) {
  return (text: string, max = 2000) => {
    let t = text.replace(ANSI, '');
    for (const s of secrets) t = t.split(s).join('***');
    return t.length > max ? `${t.slice(0, max - 1)}…` : t;
  };
}

/** automation.group: IW_RUN_GROUP → <provider>:<run_id>:<attempt> in CI → a fresh ID per invocation. */
export function runGroup(env: Env, ci?: { provider: string; run_id?: string; run_attempt?: number }): string {
  if (env.IW_RUN_GROUP) return env.IW_RUN_GROUP;
  if (ci?.run_id) return `${ci.provider}:${ci.run_id}:${ci.run_attempt ?? 1}`;
  return newUlid();
}

/**
 * Release of a run (docs/spec/bundle-format.md#releasesversiontoml): explicit → a release whose refs contain the
 * build's tag or branch → current_release on the default branch or outside CI. Otherwise none, with a warning.
 */
export function resolveRelease(
  bundle: Bundle,
  build: Build,
  opts: { explicit?: string | undefined; inCi: boolean },
): { release?: string; warning?: string } {
  const p = bundle.project.data;
  const unknown = opts.explicit && !bundle.releases.some((r) => r.data.version === opts.explicit);
  if (opts.explicit)
    return {
      release: opts.explicit,
      warning: unknown ? `release ${opts.explicit} is not in releases/` : undefined,
    };
  const name = build.ref?.replace(/^refs\/(heads|tags)\//, '');
  const byRef = name ? bundle.releases.find((r) => r.data.refs?.includes(name)) : undefined;
  if (byRef) return { release: byRef.data.version };
  const branch = build.ref?.startsWith('refs/heads/') ? name : undefined;
  if (p.current_release && (!opts.inCi || branch === (p.default_branch ?? 'main')))
    return { release: p.current_release };
  return { warning: `no release for ${build.ref ?? 'this build'}: runs are not counted (set IW_RELEASE)` };
}
