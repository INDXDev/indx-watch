/**
 * Tests: the List view (features → use cases → criteria → test cases) and the Focus view (one test case per
 * screen) of docs/spec/web.md#list-and-focus.
 */
import { useState } from 'react';
import { useApp } from '../App';
import { api, type SpecTree } from '../api';
import { useI18n } from '../i18n';
import { href, navigate } from '../router';
import { Badge, Chip, Focus, Icon, Load, Priority, Seg, Tx, txt, useApi, ViewSwitch } from '../ui';
import { TestCaseView } from './TestCase';

type Filter = 'all' | 'open';
const OPEN = new Set(['fail', 'needs_review', 'blocked', 'stale', 'untested', 'uncovered']);

/** Every test case under every criterion, in tree order (a test case covering several criteria repeats). */
export const allTestCases = (tree: SpecTree) =>
  tree.features.flatMap((f) => f.useCases.flatMap((u) => u.criteria.flatMap((c) => c.testCases)));

/** Test case keys in tree order (each once), only open ones with `f=open`. Pure; tested. */
export function testOrder(tree: SpecTree, filter?: string): string[] {
  const keys = allTestCases(tree).filter((x) => filter !== 'open' || OPEN.has(x.status));
  return [...new Set(keys.map((x) => x.key))];
}

export function Tests({ filter }: { filter?: string | undefined }) {
  const { scope } = useApp();
  const specs = useApi(() => api.specs(scope), [scope.release, scope.env]);
  return <Load state={specs}>{(s) => <Tree tree={s} filter={filter === 'open' ? 'open' : 'all'} />}</Load>;
}

/** #/tc/TC-3: the Focus card of a test case, with ← / → over the list it was opened from. */
export function TestFocus({ tcKey, filter }: { tcKey: string; filter?: string | undefined }) {
  const { scope } = useApp();
  const { t } = useI18n();
  const specs = useApi(() => api.specs(scope), [scope.release, scope.env]);
  const items = specs.data ? testOrder(specs.data, filter) : [];
  const list = items.includes(tcKey) ? items : specs.data ? testOrder(specs.data) : [tcKey];
  const q = filter === 'open' ? { f: 'open' } : undefined;
  return (
    <>
      <div className="page-head page-head-tight">
        <p className="eyebrow">
          <a href={href.tests(q)}>{t('nav.tests')}</a>
          {filter === 'open' && ` · ${t('specs.filter.open')}`}
        </p>
        <ViewSwitch view="focus" list={href.tests(q)} />
      </div>
      <Focus
        items={list}
        at={tcKey}
        go={(k) => href.testCase(k, q)}
        actions={
          <a className="btn btn-primary" href={href.runner(tcKey, list.slice(list.indexOf(tcKey)))}>
            ▶ {t('tc.runManually')}
          </a>
        }
      >
        <TestCaseView tcKey={tcKey} />
      </Focus>
    </>
  );
}

type Feature = SpecTree['features'][number];
type UseCase = Feature['useCases'][number];
const query = (filter: Filter) => (filter === 'open' ? { f: filter } : undefined);

/** Features with only the use cases that pass the filter and whose own or nested text contains `needle`. */
function visibleFeatures(tree: SpecTree, filter: Filter, needle: string, locale: 'en' | 'ja') {
  const match = (...parts: string[]) => !needle || parts.some((p) => p.toLowerCase().includes(needle));
  const words = (f: Feature, u: UseCase) => [
    ...[f.key, txt(f, 'title', locale), u.key, txt(u, 'title', locale)],
    ...u.criteria.flatMap((c) => [
      c.key,
      txt(c, 'text', locale),
      ...c.testCases.flatMap((x) => [x.key, x.title, txt(x, 'title', locale)]),
    ]),
  ];
  return tree.features
    .map((f) => ({
      ...f,
      useCases: f.useCases.filter((u) => (filter === 'all' || u.status !== 'pass') && match(...words(f, u))),
    }))
    .filter((f) => f.useCases.length > 0);
}

/** The Tests list: summary, view switch, search and the open/all filter over the feature tree. */
function Tree({ tree, filter }: { tree: SpecTree; filter: Filter }) {
  const { t, locale } = useI18n();
  const [q, setQ] = useState('');
  const first = testOrder(tree, filter)[0];
  const ucs = tree.features.flatMap((f) => f.useCases);
  const features = visibleFeatures(tree, filter, q.trim().toLowerCase(), locale);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('specs.title')}</h1>
          <p className="muted">
            {t('specs.summary', {
              features: tree.features.length,
              useCases: ucs.length,
              criteria: ucs.flatMap((u) => u.criteria).length,
            })}
          </p>
        </div>
        <div className="filters">
          <ViewSwitch
            view="list"
            list={href.tests(query(filter))}
            focus={first ? href.testCase(first, query(filter)) : undefined}
          />
          <label>
            <span className="sr">{t('specs.search')}</span>
            <input
              type="search"
              placeholder={t('specs.search')}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </label>
          <Seg
            label={t('specs.filter')}
            value={filter}
            options={['all', 'open'] as const}
            text={(f) => t(`specs.filter.${f}`)}
            onChange={(f) => navigate(href.tests(query(f)))}
          />
        </div>
      </div>
      {features.length === 0 && <p className="empty">{t('specs.none')}</p>}
      {features.map((f) => (
        <FeatureNode key={f.key} f={f} filter={filter} />
      ))}
    </>
  );
}

function FeatureNode({ f, filter }: { f: Feature; filter: Filter }) {
  return (
    <details className="card tree-feature" open>
      <summary>
        <span className="key">{f.key}</span>
        <strong>
          <Tx of={f} field="title" />
        </strong>
        <span className="muted grow">
          <Tx of={f} field="description" />
        </span>
      </summary>
      {f.useCases.map((u) => (
        <UseCaseNode key={u.key} u={u} filter={filter} />
      ))}
    </details>
  );
}

function UseCaseNode({ u, filter }: { u: UseCase; filter: Filter }) {
  const { t } = useI18n();
  return (
    <div className="tree-uc">
      <div className="tree-uc-head">
        <span className="key">{u.key}</span>
        <strong className="grow">
          <Tx of={u} field="title" />
        </strong>
        <Priority p={u.priority} />
        <Badge status={u.status} />
        {u.done && <span className="ok">✓ {t('dash.done')}</span>}
      </div>
      <ul className="tree-acs">
        {u.criteria.map((c) => (
          <CriterionNode key={c.key} c={c} filter={filter} />
        ))}
      </ul>
    </div>
  );
}

function CriterionNode({ c, filter }: { c: UseCase['criteria'][number]; filter: Filter }) {
  const { t } = useI18n();
  return (
    <li>
      <div className="tree-ac">
        <span className="key">{c.key}</span>
        <span className="grow">
          <Tx of={c} field="text" />
        </span>
        <Badge status={c.status} />
      </div>
      <div className="tc-chips">
        {c.testCases.length === 0 && <span className="muted">{t('specs.noTests')}</span>}
        {c.testCases.map((x) => (
          <a key={x.key} className={`tc-chip s-${x.status}`} href={href.testCase(x.key, query(filter))}>
            <Icon status={x.status} />
            <span className="key">{x.key}</span> <Tx of={x} field="title" /> <Chip>{x.mode}</Chip>
            <span className="sr">{t(`status.${x.status}`)}</span>
          </a>
        ))}
      </div>
    </li>
  );
}
