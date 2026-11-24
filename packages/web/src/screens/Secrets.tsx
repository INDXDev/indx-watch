/**
 * Secrets kept by INDX Watch (passwords, API keys, logins) and, for leads, who can open which test data and secrets
 * (docs/spec/web.md#secrets, #access). Values are sealed on the server; showing one is recorded.
 */
import { type FormEvent, useState } from 'react';
import { useApp } from '../App';
import { api, type SecretView } from '../api';
import { useI18n } from '../i18n';
import { href, navigate } from '../router';
import { AccessList, DataTabs, SecretValue, ShareDialog, SharingChip } from '../share';
import { Chip, Copy, Dialog, Load, Meta, Section, useApi } from '../ui';

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function Secrets({ selected }: { selected?: string | undefined }) {
  const { t, date } = useI18n();
  const { project } = useApp();
  const list = useApi(api.secrets, [project]);
  const [editing, setEditing] = useState<SecretView | 'new' | null>(null);
  const [sharing, setSharing] = useState<SecretView | null>(null);
  const can = !!project.can.data && !!project.can.secrets;
  return (
    <>
      <DataTabs at="secrets" />
      <div className="page-head">
        <div>
          <h1>{t('secret.title')}</h1>
          <p className="muted">{t('secret.subtitle')}</p>
        </div>
        {can && (
          <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>
            + {t('secret.new')}
          </button>
        )}
      </div>
      <Load state={list}>
        {({ available, secrets }) =>
          !available ? (
            <p className="callout s-needs_review">{t('secret.unavailable')}</p>
          ) : secrets.length === 0 ? (
            <section className="card muted">{t('secret.none')}</section>
          ) : (
            <div className="stack">
              {secrets.map((s) => (
                <Section
                  key={s.name}
                  id={`secret-${s.name}`}
                  title={
                    <a href={href.secrets(s.name)}>
                      🔑 {s.title ?? s.name} <code className="muted small">{s.ref}</code>
                    </a>
                  }
                  actions={
                    <span className="chips">
                      <SharingChip shared={s.shared_with} />
                      {can && (
                        <>
                          <button type="button" className="btn btn-sm" onClick={() => setSharing(s)}>
                            {t('sharing.button')}
                          </button>
                          <button type="button" className="btn btn-sm" onClick={() => setEditing(s)}>
                            {t('fx.edit')}
                          </button>
                        </>
                      )}
                    </span>
                  }
                >
                  <Meta
                    items={[
                      [t('secret.username'), s.username && <Copy key="u" text={s.username} />],
                      [t('secret.value'), <SecretValue key="v" secretRef={s.ref} />],
                      [t('secret.reference'), <Copy key="r" text={s.ref} />],
                      [
                        t('fx.usedBy'),
                        s.usedBy.length
                          ? s.usedBy.map((k) =>
                              k.startsWith('FX-') ? (
                                <a key={k} className="key" href={href.fixtures(k)}>
                                  {k}
                                </a>
                              ) : (
                                <code key={k}>{k}</code>
                              ),
                            )
                          : t('fx.unused'),
                      ],
                      [t('secret.updated'), `${date(s.at)} · ${s.actor.name ?? s.actor.id}`],
                    ]}
                  />
                  {s.notes && <p>{s.notes}</p>}
                  {selected === s.name && (
                    <div className="stack-sm">
                      <h3>{t('sharing.whoHasAccess')}</h3>
                      <AccessList access={s.access} />
                      {s.history.length > 0 && (
                        <>
                          <h3>{t('secret.history')}</h3>
                          <ul className="list small">
                            {s.history.map((e) => (
                              <li key={`${e.at}${e.action}${e.actor.id}`}>
                                <Chip>{t(`secret.action.${e.action}` as 'secret.action.set')}</Chip>
                                <span className="grow">{e.actor.name ?? e.actor.id}</span>
                                <span className="muted">{date(e.at)}</span>
                              </li>
                            ))}
                          </ul>
                        </>
                      )}
                    </div>
                  )}
                </Section>
              ))}
            </div>
          )
        }
      </Load>
      {editing && (
        <SecretDialog
          secret={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onDone={list.reload}
        />
      )}
      {sharing && (
        <ShareDialog
          open
          title={sharing.title ?? sharing.name}
          shared={sharing.shared_with}
          onClose={() => setSharing(null)}
          onSave={(shared_with) => api.saveSecret(sharing.name, { shared_with }).then(list.reload)}
        />
      )}
    </>
  );
}

/** Create or edit a secret: name (new only), title, login ID, value (blank keeps it), notes; or delete it. */
function SecretDialog(props: { secret?: SecretView | undefined; onClose(): void; onDone(): void }) {
  const { t } = useI18n();
  const s = props.secret;
  const [form, setForm] = useState({
    name: s?.name ?? '',
    title: s?.title ?? '',
    username: s?.username ?? '',
    value: '',
    notes: s?.notes ?? '',
  });
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (p: Promise<unknown>) => {
    setBusy(true);
    await p.then(
      () => {
        props.onDone();
        props.onClose();
      },
      (x: unknown) => setError(errorText(x)),
    );
    setBusy(false);
  };
  const save = (e: FormEvent) => {
    e.preventDefault();
    const { name, value, ...rest } = form;
    void run(api.saveSecret(name.trim(), { ...rest, ...(value && { value }) }));
  };
  const field = (k: keyof typeof form, label: string, extra: object = {}) => (
    <label className="field">
      <span>{label}</span>
      <input value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} {...extra} />
    </label>
  );
  return (
    <Dialog open title={s ? (s.title ?? s.name) : t('secret.new')} onClose={props.onClose}>
      <form className="stack-sm" onSubmit={save}>
        {!s &&
          field('name', t('secret.name'), {
            required: true,
            pattern: '[A-Za-z0-9][A-Za-z0-9_.\\-]{0,63}',
            placeholder: 'staging-admin',
            className: 'mono',
          })}
        {field('title', t('fx.titleField'), { placeholder: 'Staging admin' })}
        {field('username', t('secret.username'), { autoComplete: 'off' })}
        {field('value', t('secret.value'), {
          type: 'password',
          autoComplete: 'new-password',
          required: !s,
          placeholder: s ? t('secret.keep') : '',
        })}
        <label className="field">
          <span>{t('fx.notesField')}</span>
          <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </label>
        {!s && <p className="muted small">{t('secret.newHint')}</p>}
        {error && <p className="callout s-fail">{error}</p>}
        <p className="chips">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {s ? t('tc.save') : t('fx.create')}
          </button>
          <button type="button" className="btn" onClick={props.onClose}>
            {t('common.cancel')}
          </button>
          <span className="grow" />
          {s &&
            (confirm ? (
              <button
                type="button"
                className="btn btn-danger"
                disabled={busy}
                onClick={() => run(api.deleteSecret(s.name).then(() => navigate(href.secrets())))}
              >
                {t('secret.deleteConfirm', { name: s.name })}
              </button>
            ) : (
              <button type="button" className="btn btn-ghost" onClick={() => setConfirm(true)}>
                {t('fx.delete')}
              </button>
            ))}
        </p>
      </form>
    </Dialog>
  );
}

/** Leads: pick a person and see every fixture and secret they can open, and why. */
export function AccessOverview({ who }: { who?: string | undefined }) {
  const { t } = useI18n();
  const data = useApi(() => api.access(who), [who]);
  const [entry, setEntry] = useState(who ?? '');
  return (
    <>
      <DataTabs at="access" />
      <div className="page-head">
        <div>
          <h1>{t('access.title')}</h1>
          <p className="muted">{t('access.subtitle')}</p>
        </div>
      </div>
      <Load state={data}>
        {(a) => (
          <div className="stack">
            <form
              className="chips"
              onSubmit={(e) => {
                e.preventDefault();
                navigate(href.access(entry.trim()));
              }}
            >
              <input
                className="grow"
                list="access-people"
                type="email"
                value={entry}
                aria-label={t('access.person')}
                placeholder={t('access.person')}
                onChange={(e) => setEntry(e.target.value)}
              />
              <datalist id="access-people">
                {a.people.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
              <button type="submit" className="btn btn-primary">
                {t('access.check')}
              </button>
            </form>
            {!a.who && (
              <section className="card">
                <ul className="list">
                  {a.people.map((p) => (
                    <li key={p}>
                      <a className="grow" href={href.access(p)}>
                        {p}
                      </a>
                    </li>
                  ))}
                  {a.groups.map((g) => (
                    <li key={g} className="muted">
                      {g}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {a.who && (
              <Section
                title={a.who}
                actions={<Chip>{a.role ? t(`role.${a.role}` as 'role.lead') : t('access.noRole')}</Chip>}
              >
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>{t('access.item')}</th>
                        <th>{t('access.can')}</th>
                        <th>{t('access.why')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(a.items ?? []).map((i) => (
                        <tr key={`${i.type}:${i.key}`}>
                          <td>
                            <a href={i.type === 'secret' ? href.secrets(i.key) : href.fixtures(i.key)}>
                              {i.type === 'secret' ? '🔑' : <span className="key">{i.key}</span>} {i.title}
                            </a>
                          </td>
                          <td className={i.can ? 's-pass' : 's-fail'}>{i.can ? '✓' : '✕'}</td>
                          <td className="small">
                            {t(`access.why.${i.why}` as 'access.why.none')}
                            {i.groups && ` (${t('access.ifMember', { groups: i.groups.join(', ') })})`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Section>
            )}
          </div>
        )}
      </Load>
    </>
  );
}
