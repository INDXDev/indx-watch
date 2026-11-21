/** Impact analysis: test cases a change touches (docs/spec/concepts.md#impact-analysis). Information only. */
import type { Priority } from '@indx-watch/bundle';
import { byKey } from './model.js';
import type { Model } from './types.js';

/** file: the changed path; pattern: the [automation].files entry it matched */
export type ImpactReason = { kind: 'automation' | 'definition' | 'fixture'; file: string; pattern?: string };
export type ImpactSuggestion = { key: string; id: string; title: string; status: string } & {
  priority: Priority;
  reasons: ImpactReason[];
};

/** A path or glob: `*` and `?` stay within one segment, `**` spans segments, a trailing `/` covers a folder. */
export function globMatch(pattern: string, path: string): boolean {
  const q = pattern.replace(/^\.\//, '');
  const p = q.endsWith('/') ? `${q}**` : q;
  const re = p.replace(/\*\*\/|\*\*|[*?]|[.+^${}()|[\]\\]/g, (t) =>
    t === '**/' ? '(?:.*/)?' : t === '**' ? '.*' : t === '*' ? '[^/]*' : t === '?' ? '[^/]' : `\\${t}`,
  );
  return new RegExp(`^${re}$`).test(path);
}

const dirOf = (file: string) => file.slice(0, file.lastIndexOf('/') + 1);

/** changed: paths from the repository root; prefix: the bundle's path from it ('' or 'examples/shop/.indx-watch/'). */
export function impactedTestCases(model: Model, changed: string[], prefix = ''): ImpactSuggestion[] {
  const out: ImpactSuggestion[] = [];
  for (const tc of model.testCases.values()) {
    const d = tc.data;
    if (d.status === 'deprecated') continue;
    const own = [prefix + tc.file, prefix + (model.useCases.get(tc.useCase)?.file ?? tc.file)];
    const fixtures = (d.fixtures ?? []).map((f) => model.fixtures.get(f.ref)?.file);
    const fixtureDirs = fixtures.flatMap((f) => (f ? [prefix + dirOf(f)] : []));
    const reasons: ImpactReason[] = changed.flatMap((file): ImpactReason[] => [
      ...(d.automation?.files ?? [])
        .filter((pattern) => globMatch(pattern, file))
        .map((pattern) => ({ kind: 'automation' as const, file, pattern })),
      ...(own.includes(file) ? [{ kind: 'definition' as const, file }] : []),
      ...(fixtureDirs.some((dir) => file.startsWith(dir)) ? [{ kind: 'fixture' as const, file }] : []),
    ]);
    const { key, id, title, status = 'draft' } = d;
    if (reasons.length) out.push({ key, id, title, status, priority: tc.priority, reasons });
  }
  return out.sort((a, b) => a.priority.localeCompare(b.priority) || byKey(a.key, b.key));
}
