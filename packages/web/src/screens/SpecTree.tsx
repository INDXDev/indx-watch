/** Spec tree: features → use cases → acceptance criteria → test cases, each with its computed status. */
import { useState } from 'react';
import { useApp } from '../App';
import { api, type SpecTree } from '../api';
import { useI18n } from '../i18n';
import { href } from '../router';
import { Badge, Chip, Icon, Load, Priority, Seg, Tx, txt, useApi } from '../ui';

type Filter = 'all' | 'open';

export function SpecTreeView() {
  const { scope } = useApp();
  const specs = useApi(() => api.specs(scope), [scope.release, scope.env]);
  return <Load state={specs}>{(s) => <Tree tree={s} />}</Load>;
}

function Tree({ tree }: { tree: SpecTree }) {
  const { t, locale } = useI18n();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
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
              ...c.testCases.flatMap((x) => [x.key, x.title]),
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
                        <a key={x.key} className={`tc-chip s-${x.status}`} href={href.testCase(x.key)}>
                          <Icon status={x.status} />
                          <span className="key">{x.key}</span> {x.title} <Chip>{x.mode}</Chip>
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
