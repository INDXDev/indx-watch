/** What the create dialog and the editor share: the kinds, the account fields and how files and errors are sent. */
import { useI18n } from '../../i18n';
import { base64 } from '../../upload';

export const KINDS = ['file', 'dataset', 'seed', 'account'] as const;
export type Kind = (typeof KINDS)[number];

export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
export const filesInput = async (files: File[]) =>
  Promise.all(files.map(async (f) => ({ name: f.name, data: await base64(f) })));

export type Account = { username: string; secret_ref: string };
export function AccountFields({ value, onChange }: { value: Account; onChange(a: Partial<Account>): void }) {
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
