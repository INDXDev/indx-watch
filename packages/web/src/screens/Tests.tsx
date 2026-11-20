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

/** Test case keys in tree order (each once), only open ones with `f=open`. Pure; tested. */
export function testOrder(tree: SpecTree, filter?: string): string[] {
  const out: string[] = [];
  for (const f of tree.features)
    for (const u of f.useCases)
      for (const c of u.criteria)
        for (const x of c.testCases)
          if (!out.includes(x.key) && (filter !== 'open' || OPEN.has(x.status))) out.push(x.key);
  return out;
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

function Tree({ tree, filter }: { tree: SpecTree; filter: Filter }) {
  const { t, locale } = useI18n();
  const [q, setQ] = useState('');
  const setFilter = (f: Filter) => navigate(href.tests(f === 'open' ? { f } : undefined));
  const first = testOrder(tree, filter)[0];
  const needle = q.trim().toLowerCase();
  const ucs = tree.features.flatMap((f) => f.useCases);
  const acs = ucs.flatMap((u) => u.criteria);
  const match = (...parts: string[]) => !needle || parts.some((p) => p.toLowerCase().includes(needle));
  const features = tree.features
    .map((f) => ({
      ...f,
      useCases: f.useCases.filter(
        (u) =>
          (filter === 'all' || u.status !== 'pass') &&
          match(
            f.key,
            txt(f, 'title', locale),
            u.key,
            txt(u, 'title', locale),
            ...u.criteria.flatMap((c) => [
              c.key,
              txt(c, 'text', locale),
              ...c.testCases.flatMap((x) => [x.key, x.title, txt(x, 'title', locale)]),
            ]),
          ),
      ),
    }))
    .filter((f) => f.useCases.length > 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('specs.title')}</h1>
          <p className="muted">
            {t('specs.summary', {
              features: tree.features.length,
              useCases: ucs.length,
              criteria: acs.length,
            })}
          </p>
        </div>
        <div className="filters">
          <ViewSwitch
            view="list"
            list={href.tests(filter === 'open' ? { f: 'open' } : undefined)}
            focus={first ? href.testCase(first, filter === 'open' ? { f: 'open' } : undefined) : undefined}
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
            onChange={setFilter}
          />
        </div>
      </div>
      {features.length === 0 && <p className="empty">{t('specs.none')}</p>}
      {features.map((f) => (
        <details key={f.key} className="card tree-feature" open>
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
            <div key={u.key} className="tree-uc">
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
                  <li key={c.key}>
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
                        <a
                          key={x.key}
                          className={`tc-chip s-${x.status}`}
                          href={href.testCase(x.key, filter === 'open' ? { f: 'open' } : undefined)}
                        >
                          <Icon status={x.status} />
                          <span className="key">{x.key}</span> <Tx of={x} field="title" />{' '}
                          <Chip>{x.mode}</Chip>
                          <span className="sr">{t(`status.${x.status}`)}</span>
                        </a>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </details>
      ))}
    </>
  );
}
