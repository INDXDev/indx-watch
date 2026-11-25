/** Uploads: bundle snapshots, newest first, with who uploaded them (docs/spec/web.md#upload). */
import { useApp } from '../App';
import { api, type ProjectInfo } from '../api';
import { type MsgKey, useI18n } from '../i18n';
import { Copy, Load, useAgo, useApi, Who } from '../ui';

/**
 * Where the shown definitions come from, what is not in git yet, and how each kind of change travels
 * (docs/spec/web.md#sync-status). Only for a hosted app in git mode, where git and the app can differ.
 */
function SyncStatus({ project }: { project: ProjectInfo }) {
  const { t } = useI18n();
  const ago = useAgo();
  const s = project.snapshot;
  if (!s) return null;
  const unsynced = s.unsynced ?? [];
  const from = s.commit ? s.commit.slice(0, 7) : t('uploads.browser');
  const rows = ['repo', 'data', 'results', 'ci'] as const;
  return (
    <section className="card sync-status" data-testid="sync-status">
      <h2>{t('sync.title')}</h2>
      <p>
        {t('sync.showing', { from, ref: s.ref?.replace('refs/heads/', '') ?? '-' })} <Who who={s.actor} />{' '}
        <span className="muted">· {ago(s.at)}</span>
      </p>
      {unsynced.length ? (
        <div className="callout s-needs_review">
          <p>
            <strong>{t('sync.unsynced', { count: unsynced.length, commit: from })}</strong>
          </p>
          <ul className="small">
            {unsynced.slice(0, 20).map((f) => (
              <li key={f}>
                <code>{f}</code>
              </li>
            ))}
          </ul>
          <p className="small">{t('sync.unsyncedNext')}</p>
          <Copy label={t('cli.pull')} text="npx indx-watch pull" />
        </div>
      ) : (
        <p className="callout s-pass small">{t('sync.inGit', { commit: from })}</p>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t('sync.change')}</th>
              <th>{t('sync.toApp')}</th>
              <th>{t('sync.toGit')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r}>
                <td>{t(`sync.row.${r}` as MsgKey)}</td>
                <td className="small">{t(`sync.row.${r}.app` as MsgKey)}</td>
                <td className="small">{t(`sync.row.${r}.git` as MsgKey)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">{t('sync.conflicts')}</p>
    </section>
  );
}

export function Uploads() {
  const { t } = useI18n();
  const { project, upload } = useApp();
  const ago = useAgo();
  const snaps = useApi(api.snapshots, [project.snapshot?.id]);
  const clone = project.share.clone;
  const gitHosted = project.mode === 'hosted' && project.definitions !== 'workspace';
  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('uploads.title')}</h1>
          <p className="muted">{t('uploads.intro')}</p>
        </div>
        {project.can.upload && (
          <button type="button" className="btn btn-primary" onClick={() => upload()}>
            ⇪ {t('upload.button')}
          </button>
        )}
      </div>
      {gitHosted && <SyncStatus project={project} />}
      <div className="grid-2 uploads-cli">
        {gitHosted ? (
          <Copy label={t('cli.deploy')} text="npx indx-watch deploy" />
        ) : (
          <Copy label={t('cli.push')} text="npx indx-watch push" />
        )}
        {clone && <Copy label={t('cli.clone')} text={`npx indx-watch clone ${clone}`} />}
      </div>
      <Load state={snaps}>
        {(list) =>
          list.length === 0 ? (
            <div className="dropzone">
              <div className="drop-icon">⇪</div>
              <p>
                <strong>{t('uploads.none')}</strong>
              </p>
              <p className="muted small">{t(project.can.upload ? 'upload.dropHere' : 'uploads.noneHint')}</p>
            </div>
          ) : (
            <section className="card">
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>{t('uploads.who')}</th>
                      <th>{t('uploads.when')}</th>
                      <th>{t('uploads.from')}</th>
                      <th className="num">{t('uploads.files')}</th>
                      <th>
                        <span className="sr">{t('uploads.download')}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((s, i) => (
                      <tr key={s.id}>
                        <td>
                          <Who who={s.actor} unverified={s.unverified} />{' '}
                          {i === 0 && <span className="chip chip-accent">{t('uploads.current')}</span>}
                          {s.message && <div className="muted small">{s.message}</div>}
                        </td>
                        <td>{ago(s.at)}</td>
                        <td className="small">
                          {s.commit ? <code>{s.commit.slice(0, 7)}</code> : t('uploads.browser')}
                          {s.ref && <span className="muted"> {s.ref.replace('refs/heads/', '')}</span>}
                          {s.dirty && !s.unsynced?.length && (
                            <span className="chip chip-warn">{t('uploads.dirty')}</span>
                          )}
                          {!!s.unsynced?.length && (
                            <div className="muted">{t('uploads.unsynced', { count: s.unsynced.length })}</div>
                          )}
                        </td>
                        <td className="num">{s.files}</td>
                        <td>
                          <a
                            className="btn btn-sm"
                            href={api.blobUrl(s.sha256)}
                            download={`${project.project.key.toLowerCase()}-${s.id}.tar`}
                          >
                            {t('uploads.download')}
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )
        }
      </Load>
    </>
  );
}
