/**
 * Sharing test data and secrets like a shared drive (docs/spec/web.md#sharing): who has access and why, the share
 * dialog (the whole team, or only the people and groups listed), and a secret value shown on demand.
 */
import { type FormEvent, useState } from 'react';
import { useApp } from './App';
import { type Access, api } from './api';
import { useI18n } from './i18n';
import { href } from './router';
import { Chip, Copy, Dialog, Seg } from './ui';

/** Team or restricted, as a chip. */
export function SharingChip({ shared }: { shared?: string[] | undefined }) {
  const { t } = useI18n();
  return shared ? <Chip tone="warn">🔒 {t('sharing.restricted')}</Chip> : <Chip>{t('sharing.team')}</Chip>;
}

/** "Who has access": each person, group or role entry and why. */
export function AccessList({ access }: { access: Access[] }) {
  const { t } = useI18n();
  if (!access.length) return null;
  return (
    <ul className="list small access-list">
      {access.map((a) => (
        <li key={`${a.why}:${a.who}:${a.role ?? ''}`}>
          <span className="grow">
            {a.who === '*' ? t(a.why === 'everyone' ? 'sharing.everyone' : 'sharing.anyoneSignedIn') : a.who}
          </span>
          <Chip tone={a.why === 'shared' ? 'accent' : undefined}>
            {t(`sharing.why.${a.why}` as 'sharing.why.lead')}
            {a.role && a.why === 'team' ? ` · ${a.role}` : ''}
          </Chip>
        </li>
      ))}
    </ul>
  );
}

const SHAREE = /^(group:\S.*|ci:access:\S+|[^@\s:]+@[^@\s]+)$/;

/** The share dialog: general access, the people and groups it is shared with, and the leads who always have it. */
export function ShareDialog(props: {
  open: boolean;
  title: string;
  shared?: string[] | undefined;
  onClose(): void;
  onSave(shared: string[] | null): Promise<unknown>;
}) {
  const { t } = useI18n();
  const { project } = useApp();
  const me = project.identity.id;
  const [mode, setMode] = useState<'team' | 'restricted'>(props.shared ? 'restricted' : 'team');
  const [list, setList] = useState<string[]>(props.shared ?? (me.includes('@') ? [me] : []));
  const [entry, setEntry] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const add = (e: FormEvent) => {
    e.preventDefault();
    const v = entry.trim();
    if (!SHAREE.test(v)) return setError(t('sharing.badEntry'));
    if (!list.some((x) => x.toLowerCase() === v.toLowerCase())) setList([...list, v]);
    setEntry('');
    setError('');
  };
  const save = async () => {
    setBusy(true);
    await props
      .onSave(mode === 'team' ? null : list)
      .then(props.onClose, (x: unknown) => setError(x instanceof Error ? x.message : String(x)));
    setBusy(false);
  };
  const leads = project.team?.lead ?? [];
  return (
    <Dialog open={props.open} title={t('sharing.title', { name: props.title })} onClose={props.onClose}>
      <div className="stack-sm">
        <Seg
          label={t('sharing.general')}
          value={mode}
          options={['team', 'restricted'] as const}
          text={(o) => t(o === 'team' ? 'sharing.teamLong' : 'sharing.restrictedLong')}
          onChange={setMode}
        />
        {mode === 'restricted' && (
          <>
            <form className="chips" onSubmit={add}>
              <input
                className="grow"
                value={entry}
                aria-label={t('sharing.add')}
                placeholder="kim@shop.test, group:qa"
                onChange={(e) => setEntry(e.target.value)}
              />
              <button type="submit" className="btn btn-sm">
                + {t('sharing.add')}
              </button>
            </form>
            <ul className="list small">
              {list.map((x) => (
                <li key={x}>
                  <span className="grow">{x}</span>
                  {x.toLowerCase() === me.toLowerCase() && <Chip>{t('sharing.you')}</Chip>}
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    aria-label={t('sharing.remove', { who: x })}
                    onClick={() => setList(list.filter((y) => y !== x))}
                  >
                    ✕
                  </button>
                </li>
              ))}
              {!list.length && <li className="muted">{t('sharing.leadsOnly')}</li>}
            </ul>
          </>
        )}
        <p className="muted small">
          {project.team ? t('sharing.leadsAlways', { leads: leads.join(', ') || '—' }) : t('sharing.noRoles')}
        </p>
        {error && <p className="callout s-fail">{error}</p>}
        <p className="chips">
          <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>
            {t('tc.save')}
          </button>
          <button type="button" className="btn" onClick={props.onClose}>
            {t('common.cancel')}
          </button>
        </p>
      </div>
    </Dialog>
  );
}

/** A secret's value: hidden until "Show" (each reveal is recorded), then with a copy button. */
export function SecretValue({ secretRef }: { secretRef: string }) {
  const { t } = useI18n();
  const [value, setValue] = useState<string>();
  const [error, setError] = useState('');
  const { project } = useApp();
  // without IW_SECRETS_KEY (and on a read-only demo) there is no value to show
  if (!secretRef.startsWith('iw:') || !project.can.secrets) return <code>{secretRef}</code>;
  const name = secretRef.slice(3);
  const show = () =>
    api.revealSecret(name).then(
      (r) => setValue(r.value),
      (x: unknown) => setError(x instanceof Error ? x.message : String(x)),
    );
  if (value !== undefined)
    return (
      <span className="chips">
        <Copy text={value} />
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setValue(undefined)}>
          {t('secret.hide')}
        </button>
      </span>
    );
  return (
    <span className="chips">
      <code>••••••••</code>
      <button type="button" className="btn btn-sm" onClick={show}>
        👁 {t('secret.show')}
      </button>
      <a className="muted small" href={href.secrets(name)}>
        {secretRef}
      </a>
      {error && <span className="s-fail small">{error}</span>}
    </span>
  );
}

/** Tabs of the Test data area: data, secrets and (leads) who has access to what. */
export function DataTabs({ at }: { at: 'fixtures' | 'secrets' | 'access' }) {
  const { t } = useI18n();
  const { project } = useApp();
  const tabs = [
    ['fixtures', href.fixtures(), t('fx.title')],
    ['secrets', href.secrets(), t('secret.title')],
    ...(project.role === 'lead' ? [['access', href.access(), t('access.title')]] : []),
  ];
  return (
    <nav className="viewswitch tabs" aria-label={t('fx.title')}>
      {tabs.map(([k, to, label]) => (
        <a key={k} href={to} aria-current={k === at ? 'page' : undefined}>
          {label}
        </a>
      ))}
    </nav>
  );
}
