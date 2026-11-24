/** The new-fixture dialog of the test data page (docs/spec/web.md#test-data). */
import { type FormEvent, useState } from 'react';
import { api, type FixtureInput } from '../../api';
import { useI18n } from '../../i18n';
import { href } from '../../router';
import { Dialog } from '../../ui';
import { type Account, AccountFields, errorText, filesInput, KINDS, type Kind } from './form';

/** Title and kind, plus what that kind cannot be without: a file, column names or the account. */
export function CreateDialog({ open, onClose, onDone }: { open: boolean; onClose(): void; onDone(): void }) {
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
    await api.createFixture(await createInput(title, kind, { files, columns, account })).then(
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
        <KindField value={kind} onChange={setKind} />
        {kind === 'file' && (
          <label className="field">
            <span>{t('fx.files')}</span>
            <input type="file" multiple required onChange={(e) => setFiles([...(e.target.files ?? [])])} />
          </label>
        )}
        {kind === 'dataset' && <ColumnsField value={columns} onChange={setColumns} />}
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

/** The new fixture: what its kind needs, with a `key` column when a dataset names none. */
async function createInput(
  title: string,
  kind: Kind,
  x: { files: File[]; columns: string; account: Account },
): Promise<FixtureInput> {
  const cols = x.columns
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);
  return {
    title,
    kind,
    ...(kind === 'file' && { add: await filesInput(x.files) }),
    ...(kind === 'dataset' && { table: { columns: cols.length ? cols : ['key'], rows: [] } }),
    ...(kind === 'seed' && { json: '{}\n' }),
    ...(kind === 'account' && { account: x.account }),
  };
}

function KindField({ value, onChange }: { value: Kind; onChange(k: Kind): void }) {
  const { t } = useI18n();
  return (
    <label className="field">
      <span>{t('fx.kindField')}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as Kind)}>
        {KINDS.map((k) => (
          <option key={k} value={k}>
            {t(`fx.kind.${k}` as 'fx.kind.file')} — {t(`fx.kindHint.${k}` as 'fx.kindHint.file')}
          </option>
        ))}
      </select>
    </label>
  );
}

function ColumnsField({ value, onChange }: { value: string; onChange(v: string): void }) {
  const { t } = useI18n();
  return (
    <label className="field">
      <span>{t('fx.columnsField')}</span>
      <input value={value} placeholder="email, name, plan" onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
