/**
 * Test data: list of fixtures and one fixture's files, data preview and users, with create, edit and remove for a
 * lead (docs/spec/web.md#test-data). Secrets show and are entered as references only.
 */
import { type FormEvent, useState } from 'react';
import { useApp } from '../App';
import { api, type FixtureDetail, type FixtureInput } from '../api';
import { useI18n } from '../i18n';
import { href } from '../router';
import { AccessList, DataTabs, SecretValue, ShareDialog, SharingChip } from '../share';
import {
  Chip,
  Copy,
  Dialog,
  Focus,
  fmtBytes,
  Load,
  Meta,
  Section,
  THead,
  Tx,
  useApi,
  ViewSwitch,
} from '../ui';
import { base64 } from '../upload';

const KINDS = ['file', 'dataset', 'seed', 'account'] as const;
type Kind = (typeof KINDS)[number];

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
          ) : items.length === 0 ? (
            <section className="card muted">{t('fx.none')}</section>
          ) : (
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
          )
        }
      </Load>
      <CreateDialog open={creating} onClose={() => setCreating(false)} onDone={list.reload} />
    </>
  );
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const filesInput = async (files: File[]) =>
  Promise.all(files.map(async (f) => ({ name: f.name, data: await base64(f) })));

/** Title and kind, plus what that kind cannot be without: a file, column names or the account. */
function CreateDialog({ open, onClose, onDone }: { open: boolean; onClose(): void; onDone(): void }) {
  const { t } = useI18n();
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<Kind>('file');
  const [files, setFiles] = useState<File[]>([]);
  const [columns, setColumns] = useState('');
  const [account, setAccount] = useState({ username: '', secret_ref: 'env:' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const cols = columns
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean);
    const input: FixtureInput = {
      title,
      kind,
      ...(kind === 'file' && { add: await filesInput(files) }),
      ...(kind === 'dataset' && { table: { columns: cols.length ? cols : ['key'], rows: [] } }),
      ...(kind === 'seed' && { json: '{}\n' }),
      ...(kind === 'account' && { account }),
    };
    await api.createFixture(input).then(
      (r) => {
        onDone();
        onClose();
        window.location.hash = href.fixtures(r.key).replace(/^#/, '');
      },
      (x: unknown) => setError(errorText(x)),
    );
    setBusy(false);
  };
  return (
    <Dialog open={open} title={t('fx.new')} onClose={onClose}>
      <form className="stack-sm" onSubmit={save}>
        <label className="field">
          <span>{t('fx.titleField')}</span>
          <input value={title} required onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="field">
          <span>{t('fx.kindField')}</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`fx.kind.${k}` as 'fx.kind.file')} — {t(`fx.kindHint.${k}` as 'fx.kindHint.file')}
              </option>
            ))}
          </select>
        </label>
        {kind === 'file' && (
          <label className="field">
            <span>{t('fx.files')}</span>
            <input type="file" multiple required onChange={(e) => setFiles([...(e.target.files ?? [])])} />
          </label>
        )}
        {kind === 'dataset' && (
          <label className="field">
            <span>{t('fx.columnsField')}</span>
            <input
              value={columns}
              placeholder="email, name, plan"
              onChange={(e) => setColumns(e.target.value)}
            />
          </label>
        )}
        {kind === 'account' && (
          <AccountFields value={account} onChange={(a) => setAccount({ ...account, ...a })} />
        )}
        {error && <p className="callout s-fail">{error}</p>}
        <p className="chips">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {t('fx.create')}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
        </p>
      </form>
    </Dialog>
  );
}

type Account = { username: string; secret_ref: string };
function AccountFields({ value, onChange }: { value: Account; onChange(a: Partial<Account>): void }) {
  const { t } = useI18n();
  return (
    <>
      <label className="field">
        <span>{t('fx.username')}</span>
        <input value={value.username} required onChange={(e) => onChange({ username: e.target.value })} />
      </label>
      <label className="field">
        <span>{t('fx.secret')}</span>
        <input
          value={value.secret_ref}
          required
          className="mono"
          onChange={(e) => onChange({ secret_ref: e.target.value })}
        />
        <small className="muted">{t('fx.secretRefHint')}</small>
      </label>
    </>
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

function Detail(props: { f: FixtureDetail; onEdit?: (() => void) | undefined; onShared(): void }) {
  const { f, onEdit } = props;
  const { t } = useI18n();
  const [sharing, setSharing] = useState(false);
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
        actions={
          <span className="chips">
            {f.data.status === 'draft' && <Chip tone="warn">{t('fx.draft')}</Chip>}
            <Chip>{t(`fx.kind.${f.data.kind}` as 'fx.kind.file')}</Chip>
            <SharingChip shared={f.data.shared_with} />
            {onEdit && (
              <>
                <button type="button" className="btn btn-sm" onClick={() => setSharing(true)}>
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
      <ShareDialog
        open={sharing}
        title={`${f.key} ${f.data.title}`}
        shared={f.data.shared_with}
        onClose={() => setSharing(false)}
        onSave={(shared_with) => api.editFixture(f.key, { shared_with }).then(props.onShared)}
      />
      {f.files.length > 0 && (
        <Section title={t('fx.files')}>
          <div className="table-wrap">
            <table>
              <THead cols={['fx.name', ['fx.size', 'num'], 'fx.sha', 'fx.stored']} />
              <tbody>
                {f.files.map((x) => (
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

/** The table of a dataset as columns and string rows (from the preview, which holds every row up to 1,000). */
export function tableOf(f: FixtureDetail): { columns: string[]; rows: string[][] } {
  const rows = f.preview?.rows ?? [];
  const columns = [...new Set([...(f.preview?.columns ?? []), ...rows.flatMap((r) => Object.keys(r))])];
  return { columns, rows: rows.map((r) => columns.map((c) => r[c] ?? '')) };
}

/** Edit a fixture in place: title, notes, the dataset table, the seed JSON, the account and the files. */
function Editor({ f, done }: { f: FixtureDetail; done(saved: boolean): void }) {
  const { t } = useI18n();
  const kind = f.data.kind;
  const start = tableOf(f);
  const [title, setTitle] = useState(f.data.title);
  const [notes, setNotes] = useState(f.data.notes ?? '');
  const [table, setTable] = useState(start.columns.length ? start : { columns: ['key'], rows: [] });
  const [rowKey, setRowKey] = useState(f.data.row_key ?? '');
  const [json, setJson] = useState(f.preview?.text ?? '{}\n');
  const [account, setAccount] = useState({
    username: f.data.account?.username ?? '',
    secret_ref: f.data.account?.secret_ref ?? 'env:',
  });
  const [fields, setFields] = useState(Object.entries(f.data.account?.fields ?? {}));
  const [added, setAdded] = useState<File[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const tooBig = (f.preview?.total ?? 0) > (f.preview?.rows?.length ?? 0);
  const tableData = kind === 'dataset' && !tooBig;
  const run = async (p: Promise<unknown>) => {
    setBusy(true);
    await p.then(
      () => done(true),
      (x: unknown) => setError(errorText(x)),
    );
    setBusy(false);
  };
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const fieldMap = Object.fromEntries(fields.filter(([k]) => k.trim()).map(([k, v]) => [k.trim(), v]));
    const input: FixtureInput = {
      ...(title !== f.data.title && { title }),
      ...(notes !== (f.data.notes ?? '') && { notes: notes || null }),
      ...(tableData && { table: { ...table, row_key: rowKey } }),
      ...(kind === 'seed' && json !== f.preview?.text && { json }),
      ...(kind === 'account' && {
        account: { ...account, ...(Object.keys(fieldMap).length && { fields: fieldMap }) },
      }),
      ...(added.length && { add: await filesInput(added) }),
      ...(removed.length && { remove: removed }),
    };
    await run(api.editFixture(f.key, input));
  };
  const cell = (r: number, c: number, v: string) =>
    setTable({
      ...table,
      rows: table.rows.map((row, i) => (i === r ? row.map((x, j) => (j === c ? v : x)) : row)),
    });
  const pad = (row: string[]) => table.columns.map((_, i) => row[i] ?? '');
  return (
    <form className="stack" onSubmit={save}>
      <Section
        title={<span className="key">{f.key}</span>}
        actions={<Chip>{t(`fx.kind.${kind}` as 'fx.kind.file')}</Chip>}
      >
        <div className="stack-sm">
          <label className="field">
            <span>{t('fx.titleField')}</span>
            <input value={title} required onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="field">
            <span>{t('fx.notesField')}</span>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
        </div>
      </Section>
      {kind === 'dataset' && (
        <Section title={t('fx.data')}>
          {tooBig ? (
            <p className="muted">{t('fx.tooBig', { count: f.preview?.total ?? 0 })}</p>
          ) : (
            <div className="stack-sm">
              <div className="table-wrap">
                <table className="edit-table">
                  <thead>
                    <tr>
                      {table.columns.map((c, j) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: positional cells of controlled inputs
                        <th key={j}>
                          <input
                            aria-label={t('fx.column')}
                            value={c}
                            required
                            onChange={(e) =>
                              setTable({
                                ...table,
                                columns: table.columns.map((x, i) => (i === j ? e.target.value : x)),
                              })
                            }
                          />
                          <button
                            type="button"
                            className="btn btn-sm btn-ghost"
                            aria-label={t('fx.removeColumn')}
                            disabled={table.columns.length === 1}
                            onClick={() =>
                              setTable({
                                columns: table.columns.filter((_, i) => i !== j),
                                rows: table.rows.map((r) => pad(r).filter((_, i) => i !== j)),
                              })
                            }
                          >
                            ✕
                          </button>
                        </th>
                      ))}
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {table.rows.map((r, i) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: positional cells of controlled inputs
                      <tr key={i}>
                        {pad(r).map((v, j) => (
                          // biome-ignore lint/suspicious/noArrayIndexKey: positional cells of controlled inputs
                          <td key={j}>
                            <input
                              value={v}
                              aria-label={table.columns[j]}
                              onChange={(e) => cell(i, j, e.target.value)}
                            />
                          </td>
                        ))}
                        <td>
                          <button
                            type="button"
                            className="btn btn-sm btn-ghost"
                            aria-label={t('fx.removeRow')}
                            onClick={() => setTable({ ...table, rows: table.rows.filter((_, x) => x !== i) })}
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="chips">
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setTable({ ...table, rows: [...table.rows, table.columns.map(() => '')] })}
                >
                  + {t('fx.addRow')}
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() =>
                    setTable({
                      columns: [...table.columns, `column${table.columns.length + 1}`],
                      rows: table.rows,
                    })
                  }
                >
                  + {t('fx.addColumn')}
                </button>
                <label className="field-inline">
                  <span>{t('fx.rowKey')}</span>{' '}
                  <select value={rowKey} onChange={(e) => setRowKey(e.target.value)}>
                    {table.columns.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
              </p>
            </div>
          )}
        </Section>
      )}
      {kind === 'seed' && (
        <Section title={t('fx.data')}>
          <label className="field">
            <span>{t('fx.jsonField')}</span>
            <textarea className="mono" rows={12} value={json} onChange={(e) => setJson(e.target.value)} />
          </label>
        </Section>
      )}
      {kind === 'account' && (
        <Section title={t('fx.account')}>
          <div className="stack-sm">
            <AccountFields value={account} onChange={(a) => setAccount({ ...account, ...a })} />
            {fields.map(([k, v], i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: positional cells of controlled inputs
              <p key={i} className="chips">
                <input
                  aria-label={t('fx.fieldName')}
                  value={k}
                  onChange={(e) => setFields(fields.map((x, j) => (j === i ? [e.target.value, x[1]] : x)))}
                />
                <input
                  aria-label={t('fx.fieldValue')}
                  value={v}
                  onChange={(e) => setFields(fields.map((x, j) => (j === i ? [x[0], e.target.value] : x)))}
                />
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => setFields(fields.filter((_, j) => j !== i))}
                >
                  ✕
                </button>
              </p>
            ))}
            <p>
              <button type="button" className="btn btn-sm" onClick={() => setFields([...fields, ['', '']])}>
                + {t('fx.addField')}
              </button>
            </p>
          </div>
        </Section>
      )}
      {kind !== 'account' && (
        <Section title={t('fx.files')}>
          <ul className="list small">
            {f.files
              .filter((x) => !removed.includes(x.name))
              .map((x) => (
                <li key={x.name}>
                  <code className="grow">{x.name}</code>
                  <span className="muted">{fmtBytes(x.size)}</span>
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    onClick={() => setRemoved([...removed, x.name])}
                  >
                    {t('fx.removeFile')}
                  </button>
                </li>
              ))}
            {added.map((x) => (
              <li key={x.name}>
                <span className="chip change-added">{t('upload.change.added')}</span>
                <code className="grow">{x.name}</code>
                <span className="muted">{fmtBytes(x.size)}</span>
              </li>
            ))}
          </ul>
          <label className="btn btn-sm">
            <input
              type="file"
              className="sr"
              multiple
              onChange={(e) => setAdded([...added, ...(e.target.files ?? [])])}
            />
            + {t('fx.addFiles')}
          </label>
        </Section>
      )}
      {error && <p className="callout s-fail">{error}</p>}
      <p className="chips">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {t('tc.save')}
        </button>
        <button type="button" className="btn" onClick={() => done(false)}>
          {t('common.cancel')}
        </button>
        <span className="grow" />
        {confirm ? (
          <>
            <span className="muted small">{t('fx.deleteConfirm', { key: f.key })}</span>
            <button
              type="button"
              className="btn btn-danger"
              disabled={busy}
              onClick={() =>
                run(
                  api.deleteFixture(f.key).then(() => {
                    window.location.hash = href.fixtures().replace(/^#/, '');
                  }),
                )
              }
            >
              {t('fx.delete')}
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-ghost" onClick={() => setConfirm(true)}>
            {t('fx.delete')}
          </button>
        )}
      </p>
    </form>
  );
}
