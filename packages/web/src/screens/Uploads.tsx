/** Uploads: bundle snapshots, newest first, with who uploaded them (docs/spec/web.md#upload). */
import { useApp } from '../App';
import { api } from '../api';
import { useI18n } from '../i18n';
import { Copy, Load, useAgo, useApi, Who } from '../ui';

export function Uploads() {
  const { t } = useI18n();
  const { project, upload } = useApp();
  const ago = useAgo();
  const snaps = useApi(api.snapshots, [project.snapshot?.id]);
  const clone = project.share.clone;
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
      <div className="grid-2 uploads-cli">
        <Copy label={t('cli.push')} text="npx indx-watch push" />
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
                          {s.dirty && <span className="chip chip-warn">{t('uploads.dirty')}</span>}
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
