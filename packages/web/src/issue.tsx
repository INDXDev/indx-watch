/** Open as GitHub issue and Related issues (docs/spec/web.md#open-as-github-issue): the app opens a prefilled page; a person submits. */
import { useState } from 'react';
import { useApp } from './App';
import { api } from './api';
import { useI18n } from './i18n';
import { Copy, useApi } from './ui';

const HTTP = /^https?:\/\/[^\s]+$/i;
/** "#42" for an issue URL, else the host. Pure; tested. */
export const issueLabel = (url: string) => {
  const n = /\/issues\/(\d+)\/?(?:[?#].*)?$/.exec(url)?.[1];
  return n ? `#${n}` : new URL(url).host;
};

/** The issue links of a test case that are web URLs (anything else is never rendered as a link). */
export const webLinks = (links?: string[]) => (links ?? []).filter((l) => HTTP.test(l));

/**
 * Related issues of a test case, and (with a repository) the button that opens the prefilled issue for `ref`
 * (a run ID or a key) and the step that stores the new issue's URL.
 */
export function IssueBar({
  ref_,
  tcKey,
  links,
  reload,
}: {
  ref_: string;
  tcKey: string;
  links?: string[] | undefined;
  reload(): void;
}) {
  const { t } = useI18n();
  const { project } = useApp();
  const [opened, setOpened] = useState(false);
  const issue = useApi(() => (project.github ? api.issue(ref_) : Promise.resolve(undefined)), [ref_]);
  const related = webLinks(links);
  if (!issue.data && !related.length) return null;
  return (
    <>
      <div className="issue-bar">
        {related.map((l) => (
          <a key={l} className="chip" href={l} target="_blank" rel="noreferrer">
            {t('issue.related', { label: issueLabel(l) })}
          </a>
        ))}
        {issue.data && (
          <a
            className="btn btn-sm"
            href={issue.data.url}
            target="_blank"
            rel="noreferrer"
            onClick={() => setOpened(true)}
          >
            {t('issue.open')}
          </a>
        )}
      </div>
      {opened && <PasteLink tcKey={tcKey} links={links ?? []} done={reload} />}
    </>
  );
}

/** "Paste the issue URL": saved in the test case's `links` where the app may edit definitions, else the command to run. */
function PasteLink({ tcKey, links, done }: { tcKey: string; links: string[]; done(): void }) {
  const { t } = useI18n();
  const { project } = useApp();
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const valid = HTTP.test(url.trim());
  const save = () =>
    api.editTestCase(tcKey, { links: [...new Set([...links, url.trim()])] }).then(
      () => [setUrl(''), done()],
      (e: Error) => setError(e.message),
    );
  return (
    <form
      className="issue-paste"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid && project.can.edit) save();
      }}
    >
      <p className="muted small">{t('issue.opened')}</p>
      <label>
        {t('issue.paste')}
        <input
          type="url"
          value={url}
          placeholder="https://github.com/…/issues/42"
          onChange={(e) => setUrl(e.target.value)}
        />
      </label>
      {project.can.edit ? (
        <button type="submit" className="btn btn-sm" disabled={!valid}>
          {t('issue.save')}
        </button>
      ) : (
        valid && (
          <p className="small">
            {t('issue.cli')}
            <Copy text={`iw issue ${tcKey} --link ${url.trim()}`} />
          </p>
        )
      )}
      {error && <p className="error small">{error}</p>}
    </form>
  );
}
