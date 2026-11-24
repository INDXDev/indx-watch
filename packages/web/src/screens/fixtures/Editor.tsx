/** Edit a fixture in place (docs/spec/web.md#test-data): title, notes, the dataset table, the seed JSON, the account and the files. */
import { type FormEvent, useState } from 'react';
import { api, type FixtureDetail, type FixtureInput } from '../../api';
import { useI18n } from '../../i18n';
import { href } from '../../router';
import { Chip, fmtBytes, Section } from '../../ui';
import { DatasetEditor, type Table } from './DatasetEditor';
import { AccountFields, errorText, filesInput } from './form';

/** The table of a dataset as columns and string rows (from the preview, which holds every row up to 1,000). */
export function tableOf(f: FixtureDetail): Table {
  const rows = f.preview?.rows ?? [];
  const columns = [...new Set([...(f.preview?.columns ?? []), ...rows.flatMap((r) => Object.keys(r))])];
  return { columns, rows: rows.map((r) => columns.map((c) => r[c] ?? '')) };
}

type Draft = ReturnType<typeof draftOf>;
function draftOf(f: FixtureDetail) {
  const start = tableOf(f);
  return {
    title: f.data.title,
    notes: f.data.notes ?? '',
    table: start.columns.length ? start : { columns: ['key'], rows: [] },
    rowKey: f.data.row_key ?? '',
    json: f.preview?.text ?? '{}\n',
    account: { username: f.data.account?.username ?? '', secret_ref: f.data.account?.secret_ref ?? 'env:' },
    fields: Object.entries(f.data.account?.fields ?? {}),
    added: [] as File[],
    removed: [] as string[],
  };
}

/** Only what changed, plus the whole table or account of those kinds. */
async function editInput(f: FixtureDetail, d: Draft, tableData: boolean): Promise<FixtureInput> {
  const kind = f.data.kind;
  const fieldMap = Object.fromEntries(d.fields.filter(([k]) => k.trim()).map(([k, v]) => [k.trim(), v]));
  return {
    ...(d.title !== f.data.title && { title: d.title }),
    ...(d.notes !== (f.data.notes ?? '') && { notes: d.notes || null }),
    ...(tableData && { table: { ...d.table, row_key: d.rowKey } }),
    ...(kind === 'seed' && d.json !== f.preview?.text && { json: d.json }),
    ...(kind === 'account' && {
      account: { ...d.account, ...(Object.keys(fieldMap).length && { fields: fieldMap }) },
    }),
    ...(d.added.length && { add: await filesInput(d.added) }),
    ...(d.removed.length && { remove: d.removed }),
  };
}

export function Editor({ f, done }: { f: FixtureDetail; done(saved: boolean): void }) {
  const { t } = useI18n();
  const kind = f.data.kind;
  const [d, setDraft] = useState(() => draftOf(f));
  const patch = (p: Partial<Draft>) => setDraft((x) => ({ ...x, ...p }));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const tooBig = (f.preview?.total ?? 0) > (f.preview?.rows?.length ?? 0);
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
    await run(api.editFixture(f.key, await editInput(f, d, kind === 'dataset' && !tooBig)));
  };
  return (
    <form className="stack" onSubmit={save}>
      <TitleEditor f={f} d={d} patch={patch} />
      {kind === 'dataset' && (
        <DatasetEditor
          table={d.table}
          setTable={(table) => patch({ table })}
          rowKey={d.rowKey}
          setRowKey={(rowKey) => patch({ rowKey })}
          tooBig={tooBig && (f.preview?.total ?? 0)}
        />
      )}
      {kind === 'seed' && (
        <Section title={t('fx.data')}>
          <label className="field">
            <span>{t('fx.jsonField')}</span>
            <textarea
              className="mono"
              rows={12}
              value={d.json}
              onChange={(e) => patch({ json: e.target.value })}
            />
          </label>
        </Section>
      )}
      {kind === 'account' && <AccountEditor d={d} patch={patch} />}
      {kind !== 'account' && <FilesEditor f={f} d={d} patch={patch} />}
      {error && <p className="callout s-fail">{error}</p>}
      <EditorActions fxKey={f.key} busy={busy} cancel={() => done(false)} run={run} />
    </form>
  );
}

type Part = { d: Draft; patch(p: Partial<Draft>): void };

function TitleEditor({ f, d, patch }: Part & { f: FixtureDetail }) {
  const { t } = useI18n();
  return (
    <Section
      title={<span className="key">{f.key}</span>}
      actions={<Chip>{t(`fx.kind.${f.data.kind}` as 'fx.kind.file')}</Chip>}
    >
      <div className="stack-sm">
        <label className="field">
          <span>{t('fx.titleField')}</span>
          <input value={d.title} required onChange={(e) => patch({ title: e.target.value })} />
        </label>
        <label className="field">
          <span>{t('fx.notesField')}</span>
          <textarea value={d.notes} onChange={(e) => patch({ notes: e.target.value })} />
        </label>
      </div>
    </Section>
  );
}

/** The username, the secret reference and any extra fields of an account. */
function AccountEditor({ d, patch }: Part) {
  const { t } = useI18n();
  const { fields } = d;
  const setField = (i: number, k: 0 | 1, v: string) =>
    patch({ fields: fields.map((x, j) => (j === i ? (k ? [x[0], v] : [v, x[1]]) : x)) });
  return (
    <Section title={t('fx.account')}>
      <div className="stack-sm">
        <AccountFields value={d.account} onChange={(a) => patch({ account: { ...d.account, ...a } })} />
        {fields.map(([k, v], i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: positional cells of controlled inputs
          <p key={i} className="chips">
            <input
              aria-label={t('fx.fieldName')}
              value={k}
              onChange={(e) => setField(i, 0, e.target.value)}
            />
            <input
              aria-label={t('fx.fieldValue')}
              value={v}
              onChange={(e) => setField(i, 1, e.target.value)}
            />
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => patch({ fields: fields.filter((_, j) => j !== i) })}
            >
              ✕
            </button>
          </p>
        ))}
        <p>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => patch({ fields: [...fields, ['', '']] })}
          >
            + {t('fx.addField')}
          </button>
        </p>
      </div>
    </Section>
  );
}

/** The fixture's files: remove one, or add more (sent on save). */
function FilesEditor({ f, d, patch }: Part & { f: FixtureDetail }) {
  const { t } = useI18n();
  return (
    <Section title={t('fx.files')}>
      <ul className="list small">
        {f.files
          .filter((x) => !d.removed.includes(x.name))
          .map((x) => (
            <li key={x.name}>
              <code className="grow">{x.name}</code>
              <span className="muted">{fmtBytes(x.size)}</span>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => patch({ removed: [...d.removed, x.name] })}
              >
                {t('fx.removeFile')}
              </button>
            </li>
          ))}
        {d.added.map((x) => (
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
          onChange={(e) => patch({ added: [...d.added, ...(e.target.files ?? [])] })}
        />
        + {t('fx.addFiles')}
      </label>
    </Section>
  );
}

/** Save, cancel and delete (after a confirmation). */
function EditorActions(props: {
  fxKey: string;
  busy: boolean;
  cancel(): void;
  run(p: Promise<unknown>): void;
}) {
  const { fxKey, busy, run } = props;
  const { t } = useI18n();
  const [confirm, setConfirm] = useState(false);
  const remove = () =>
    run(
      api.deleteFixture(fxKey).then(() => {
        window.location.hash = href.fixtures().replace(/^#/, '');
      }),
    );
  return (
    <p className="chips">
      <button type="submit" className="btn btn-primary" disabled={busy}>
        {t('tc.save')}
      </button>
      <button type="button" className="btn" onClick={props.cancel}>
        {t('common.cancel')}
      </button>
      <span className="grow" />
      {confirm ? (
        <>
          <span className="muted small">{t('fx.deleteConfirm', { key: fxKey })}</span>
          <button type="button" className="btn btn-danger" disabled={busy} onClick={remove}>
            {t('fx.delete')}
          </button>
        </>
      ) : (
        <button type="button" className="btn btn-ghost" onClick={() => setConfirm(true)}>
          {t('fx.delete')}
        </button>
      )}
    </p>
  );
}
