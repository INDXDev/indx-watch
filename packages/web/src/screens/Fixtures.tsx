/**
 * Test data: list of fixtures and one fixture's files, data preview and users, with create, edit and remove for a
 * lead (docs/spec/web.md#test-data). Secrets show and are entered as references only.
 */
import { useState } from 'react';
import { useApp } from '../App';
import { api, type FixtureDetail } from '../api';
import { useI18n } from '../i18n';
import { href } from '../router';
import { AccessList, DataTabs, SecretValue, ShareDialog, SharingChip } from '../share';
import { Chip, Copy, Focus, fmtBytes, Load, Meta, Section, THead, Tx, useApi, ViewSwitch } from '../ui';
import { CreateDialog } from './fixtures/CreateDialog';
import { Editor } from './fixtures/Editor';

export function Fixtures({ selected }: { selected?: string | undefined }) {
  const { t } = useI18n();
  const { project, upload } = useApp();
  const list = useApi(api.fixtures, [project]);
  const [creating, setCreating] = useState(false);
  const first = list.data?.[0]?.key;
  const can = !!project.can.data;
  return (
    <>
      {!selected && <DataTabs at="fixtures" />}
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
        <div className="chips">
          {can && !selected && (
            <>
              <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
                + {t('fx.new')}
              </button>
              {project.can.upload && (
                <button type="button" className="btn" onClick={() => upload()}>
                  ⇪ {t('fx.fromFiles')}
                </button>
              )}
            </>
          )}
          <ViewSwitch
            view={selected ? 'focus' : 'list'}
            list={href.fixtures()}
            focus={first && href.fixtures(selected ?? first)}
          />
        </div>
      </div>
      {can && !selected && <p className="muted small">{t('fx.dropHint')}</p>}
      {can && project.mode === 'hosted' && !project.can.edit && (
        <p className="callout s-needs_review small">{t('fx.gitHostedHint')}</p>
      )}
      <Load state={list}>
        {(items) =>
          selected ? (
            <Focus items={items.map((f) => f.key)} at={selected} go={(k) => href.fixtures(k)}>
              <FixturePanel fxKey={selected} can={can} onChange={list.reload} />
            </Focus>
          ) : (
            <FixtureList items={items} />
          )
        }
      </Load>
      <CreateDialog open={creating} onClose={() => setCreating(false)} onDone={list.reload} />
    </>
  );
}

function FixtureList({ items }: { items: FixtureDetail[] }) {
  const { t } = useI18n();
  if (items.length === 0) return <section className="card muted">{t('fx.none')}</section>;
  return (
    <section className="card">
      <ul className="list">
        {items.map((f) => (
          <li key={f.key}>
            <span className="key">{f.key}</span>
            <a className="grow" href={href.fixtures(f.key)}>
              <Tx of={f.data} field="title" />
            </a>
            {f.data.status === 'draft' && <Chip tone="warn">{t('fx.draft')}</Chip>}
            {f.hidden ? (
              <Chip tone="warn">🔒 {t('sharing.notShared')}</Chip>
            ) : (
              f.data.shared_with && <SharingChip shared={f.data.shared_with} />
            )}
            <Chip>{t(`fx.kind.${f.data.kind}` as 'fx.kind.file')}</Chip>
            <span className="muted small">{f.usedBy.join(' ')}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function FixturePanel({ fxKey, can, onChange }: { fxKey: string; can: boolean; onChange(): void }) {
  const fx = useApi(() => api.fixture(fxKey), [fxKey]);
  const [editing, setEditing] = useState(false);
  const done = (saved: boolean) => {
    setEditing(false);
    if (!saved) return;
    fx.reload();
    onChange();
  };
  return (
    <Load state={fx}>
      {(f) =>
        editing ? (
          <Editor f={f} done={done} />
        ) : (
          <Detail
            f={f}
            onEdit={can && !f.hidden ? () => setEditing(true) : undefined}
            onShared={() => done(true)}
          />
        )
      }
    </Load>
  );
}

type DetailProps = { f: FixtureDetail; onEdit?: (() => void) | undefined; onShared(): void };

function Detail({ f, onEdit, onShared }: DetailProps) {
  const { t } = useI18n();
  const [sharing, setSharing] = useState(false);
  return (
    <div className="stack">
      <Summary f={f} onEdit={onEdit} onShare={() => setSharing(true)} />
      {f.data.account && (
        <Section title={t('fx.account')}>
          <Meta
            items={[
              [t('fx.username'), <Copy key="u" text={f.data.account.username} />],
              [t('fx.secret'), <SecretValue key="s" secretRef={f.data.account.secret_ref} />],
              ...Object.entries(f.data.account.fields ?? {}).map(
                ([k, v]) => [k, <code key={k}>{v}</code>] as [string, React.ReactNode],
              ),
            ]}
          />
          {!f.data.account.secret_ref.startsWith('iw:') && (
            <p className="muted small">{t('fx.secretHint')}</p>
          )}
        </Section>
      )}
      {f.access?.length > 0 && (
        <Section title={t('sharing.whoHasAccess')}>
          <AccessList access={f.access} />
        </Section>
      )}
      {/* mounted only while open, so a cancelled edit does not come back next time */}
      {sharing && (
        <ShareDialog
          open
          title={`${f.key} ${f.data.title}`}
          shared={f.data.shared_with}
          onClose={() => setSharing(false)}
          onSave={(shared_with) => api.editFixture(f.key, { shared_with }).then(onShared)}
        />
      )}
      {f.files.length > 0 && <FilesSection files={f.files} />}
      <PreviewSection f={f} />
    </div>
  );
}

/** Key, title, chips, the share and edit buttons, notes and metadata. */
function Summary({
  f,
  onEdit,
  onShare,
}: {
  f: FixtureDetail;
  onEdit?: (() => void) | undefined;
  onShare(): void;
}) {
  const { t } = useI18n();
  return (
    <Section
      title={
        <>
          <span className="key">{f.key}</span> <Tx of={f.data} field="title" />
        </>
      }
      actions={
        <span className="chips">
          {f.data.status === 'draft' && <Chip tone="warn">{t('fx.draft')}</Chip>}
          <Chip>{t(`fx.kind.${f.data.kind}` as 'fx.kind.file')}</Chip>
          <SharingChip shared={f.data.shared_with} />
          {onEdit && (
            <>
              <button type="button" className="btn btn-sm" onClick={onShare}>
                {t('sharing.button')}
              </button>
              <button type="button" className="btn btn-sm" onClick={onEdit}>
                {t('fx.edit')}
              </button>
            </>
          )}
        </span>
      }
    >
      {f.hidden && <p className="callout s-needs_review">🔒 {t('sharing.notSharedHint')}</p>}
      {f.data.notes && <p>{f.data.notes}</p>}
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
  );
}

function FilesSection({ files }: { files: FixtureDetail['files'] }) {
  const { t } = useI18n();
  return (
    <Section title={t('fx.files')}>
      <div className="table-wrap">
        <table>
          <THead cols={['fx.name', ['fx.size', 'num'], 'fx.sha', 'fx.stored']} />
          <tbody>
            {files.map((x) => (
              <tr key={x.name}>
                <td>
                  <a href={api.blobUrl(x.sha256)} download={x.name}>
                    <code>{x.name}</code>
                  </a>
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
  );
}

/** The dataset rows, the text or the first image, when the fixture has any. */
function PreviewSection({ f }: { f: FixtureDetail }) {
  const { t } = useI18n();
  const rows = f.preview?.rows ?? [];
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const image = f.files.find((x) => x.media_type?.startsWith('image/'));
  if (!(rows.length > 0 || f.preview?.text || image)) return null;
  return (
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
  );
}
