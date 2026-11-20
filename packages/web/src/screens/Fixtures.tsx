/** Fixture browser: list of fixtures and one fixture's files, data preview and users. Secrets show as references only. */
import { api, type FixtureDetail } from '../api';
import { useI18n } from '../i18n';
import { href } from '../router';
import { Chip, Focus, fmtBytes, Load, Meta, Section, Tx, useApi, ViewSwitch } from '../ui';

export function Fixtures({ selected }: { selected?: string | undefined }) {
  const { t } = useI18n();
  const list = useApi(api.fixtures, []);
  const first = list.data?.[0]?.key;
  return (
    <>
      <div className={`page-head${selected ? ' page-head-tight' : ''}`}>
        {selected ? (
          <p className="eyebrow">
            <a href={href.fixtures()}>{t('fx.title')}</a>
          </p>
        ) : (
          <div>
            <h1>{t('fx.title')}</h1>
            <p className="muted">{t('fx.subtitle')}</p>
          </div>
        )}
        <ViewSwitch
          view={selected ? 'focus' : 'list'}
          list={href.fixtures()}
          focus={first && href.fixtures(selected ?? first)}
        />
      </div>
      <Load state={list}>
        {(items) =>
          selected ? (
            <Focus items={items.map((f) => f.key)} at={selected} go={(k) => href.fixtures(k)}>
              <FixturePanel fxKey={selected} />
            </Focus>
          ) : (
            <section className="card">
              <ul className="list">
                {items.map((f) => (
                  <li key={f.key}>
                    <span className="key">{f.key}</span>
                    <a className="grow" href={href.fixtures(f.key)}>
                      <Tx of={f.data} field="title" />
                    </a>
                    <Chip>{f.data.kind}</Chip>
                    <span className="muted small">{f.usedBy.join(' ')}</span>
                  </li>
                ))}
              </ul>
            </section>
          )
        }
      </Load>
    </>
  );
}

function FixturePanel({ fxKey }: { fxKey: string }) {
  const fx = useApi(() => api.fixture(fxKey), [fxKey]);
  return <Load state={fx}>{(f) => <Detail f={f} />}</Load>;
}

function Detail({ f }: { f: FixtureDetail }) {
  const { t } = useI18n();
  const rows = f.preview?.rows ?? [];
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const image = f.files.find((x) => x.media_type?.startsWith('image/'));
  return (
    <div className="stack">
      <Section
        title={
          <>
            <span className="key">{f.key}</span> <Tx of={f.data} field="title" />
          </>
        }
        actions={<Chip>{f.data.kind}</Chip>}
      >
        <Meta
          items={[
            [t('fx.version'), <code key="v">{f.version}</code>],
            [t('tc.file'), <code key="f">{f.file}</code>],
            [t('fx.rowKey'), f.data.row_key && <code>{f.data.row_key}</code>],
            [t('fx.hook'), f.data.hook],
            [
              t('fx.usedBy'),
              f.usedBy.length
                ? f.usedBy.map((k) => (
                    <a key={k} className="key" href={href.testCase(k)}>
                      {k}
                    </a>
                  ))
                : t('fx.unused'),
            ],
          ]}
        />
      </Section>
      {f.data.account && (
        <Section title={t('fx.account')}>
          <Meta
            items={[
              [t('fx.username'), <code key="u">{f.data.account.username}</code>],
              [t('fx.secret'), <code key="s">{f.data.account.secret_ref}</code>],
            ]}
          />
          <p className="muted small">{t('fx.secretHint')}</p>
        </Section>
      )}
      {f.files.length > 0 && (
        <Section title={t('fx.files')}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('fx.name')}</th>
                  <th className="num">{t('fx.size')}</th>
                  <th>SHA-256</th>
                  <th>{t('fx.stored')}</th>
                </tr>
              </thead>
              <tbody>
                {f.files.map((x) => (
                  <tr key={x.name}>
                    <td>
                      <code>{x.name}</code>
                    </td>
                    <td className="num">{fmtBytes(x.size)}</td>
                    <td className="mono small" title={x.sha256}>
                      {x.sha256.slice(0, 12)}…
                    </td>
                    <td>{x.pointer ? <Chip tone="accent">{t('fx.pointer')}</Chip> : t('fx.inGit')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}
      {(rows.length > 0 || f.preview?.text || image) && (
        <Section title={t('fx.preview')}>
          {rows.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    {cols.map((c) => (
                      <th key={c}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r[f.data.row_key ?? ''] ?? i}>
                      {cols.map((c) => (
                        <td key={c} className="mono">
                          {r[c]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {f.preview?.text && <pre className="code">{f.preview.text}</pre>}
          {image && <img className="preview-img" src={api.blobUrl(image.sha256)} alt={image.name} />}
        </Section>
      )}
    </div>
  );
}
