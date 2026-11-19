/** Playwright の結果を INDX Watch の記録に写すための純粋な関数（docs/spec/integrations.md#mapping）。 */
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

/** Values of `env:` secret references in the bundle that are set in this process (longest first). */
export function secretValues(bundle: Bundle, env: Env): string[] {
  const refs = [
    ...bundle.environments.flatMap((e) => [
      ...(e.data.access?.secret_refs ?? []),
      e.data.hooks?.seed?.secret_ref,
      e.data.hooks?.reset?.secret_ref,
    ]),
    ...bundle.fixtures.map((f) => f.data.account?.secret_ref),
  ];
  const values = refs.flatMap((r) => (r?.startsWith('env:') ? [env[r.slice(4)]] : []));
  const set = new Set(values.filter((v): v is string => !!v && v.length >= 3));
  return [...set].sort((a, b) => b.length - a.length);
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

/** automation.group: IW_RUN_GROUP → github:<run_id>:<attempt> → a fresh ID per invocation. */
export function runGroup(env: Env): string {
  if (env.IW_RUN_GROUP) return env.IW_RUN_GROUP;
  if (env.GITHUB_ACTIONS === 'true' && env.GITHUB_RUN_ID)
    return `github:${env.GITHUB_RUN_ID}:${env.GITHUB_RUN_ATTEMPT || '1'}`;
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
