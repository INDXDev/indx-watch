/** Drive-style upload of definition files with a preview (docs/spec/web.md#upload). */
import { useEffect, useState } from 'react';
import { api, type UploadInput, type UploadResult } from './api';
import { useI18n } from './i18n';
import { href } from './router';
import { Dialog, Icon } from './ui';

export type Picked = { path: string; file: File };

/** Files of a folder drop or picker: relative paths, without hidden, cache/ and runs/ entries. */
async function walk(entry: FileSystemEntry, out: Picked[]): Promise<void> {
  if (entry.name.startsWith('.') && entry.name !== '.indx-watch') return;
  if (entry.isFile) {
    const file = await new Promise<File>((ok, no) => (entry as FileSystemFileEntry).file(ok, no));
    out.push({ path: entry.fullPath.replace(/^\//, ''), file });
    return;
  }
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((ok, no) => reader.readEntries(ok, no));
    if (!batch.length) break;
    for (const e of batch) await walk(e, out);
  }
}
export async function fromDrop(dt: DataTransfer): Promise<Picked[]> {
  const out: Picked[] = [];
  const entries = [...dt.items].map((i) => i.webkitGetAsEntry?.()).filter((e): e is FileSystemEntry => !!e);
  if (entries.length) for (const e of entries) await walk(e, out);
  else for (const f of dt.files) out.push({ path: f.name, file: f });
  return out;
}
export const fromInput = (files: FileList | null): Picked[] =>
  [...(files ?? [])].map((f) => ({ path: f.webkitRelativePath || f.name, file: f }));

/**
 * A folder with project.toml is a whole bundle (paths relative to it); anything else is single files.
 * Pure; tested.
 */
export function plan(paths: string[]): { replace: boolean; root: string } {
  const roots = paths.filter((p) => p === 'project.toml' || p.endsWith('/project.toml'));
  const root = roots.sort((a, b) => a.length - b.length)[0];
  return root === undefined
    ? { replace: false, root: '' }
    : { replace: true, root: root.slice(0, -'project.toml'.length) };
}

export const base64 = async (f: File) => {
  const bytes = new Uint8Array(await f.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
async function toInput(picked: Picked[]): Promise<UploadInput> {
  const { replace, root } = plan(picked.map((p) => p.path));
  const inside = picked.filter((p) => p.path.startsWith(root));
  const skip = (rel: string) => /^(cache|runs)\//.test(rel) || rel.split('/').some((s) => s.startsWith('.'));
  const files = [];
  for (const p of replace ? inside : picked) {
    const rel = replace ? p.path.slice(root.length) : p.file.name;
    if (replace && skip(rel)) continue;
    files.push({ name: p.file.name, ...(replace && { path: rel }), data: await base64(p.file) });
  }
  return { files, replace };
}

/** A full-window drop target; calls onFiles with what was dropped. */
export function DropOverlay({ onFiles }: { onFiles(p: Picked[]): void }) {
  const { t } = useI18n();
  const [over, setOver] = useState(false);
  useEffect(() => {
    let depth = 0;
    const files = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');
    const dragenter = (e: DragEvent) => {
      if (!files(e)) return;
      depth++;
      setOver(true);
    };
    const dragleave = (e: DragEvent) => {
      if (!files(e) || --depth > 0) return;
      depth = 0;
      setOver(false);
    };
    const dragover = (e: DragEvent) => {
      if (files(e)) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      if (!files(e) || !e.dataTransfer) return;
      e.preventDefault();
      depth = 0;
      setOver(false);
      fromDrop(e.dataTransfer).then(onFiles);
    };
    const on = Object.entries({ dragenter, dragleave, dragover, drop }) as [string, EventListener][];
    for (const [type, f] of on) window.addEventListener(type, f);
    return () => {
      for (const [type, f] of on) window.removeEventListener(type, f);
    };
  }, [onFiles]);
  if (!over) return null;
  return (
    <div className="drop-overlay" aria-hidden="true">
      <div>
        <div className="drop-icon">⇪</div>
        <p>{t('upload.dropHere')}</p>
      </div>
    </div>
  );
}

/** Buttons that open the file and folder pickers. */
export function Pickers({ onFiles }: { onFiles(p: Picked[]): void }) {
  const { t } = useI18n();
  return (
    <div className="actions">
      <label className="btn btn-primary">
        <input
          type="file"
          className="sr"
          // @ts-expect-error non-standard attribute supported by every current browser
          webkitdirectory=""
          onChange={(e) => onFiles(fromInput(e.target.files))}
        />
        {t('upload.pickFolder')}
      </label>
      <label className="btn">
        <input type="file" className="sr" multiple onChange={(e) => onFiles(fromInput(e.target.files))} />
        {t('upload.pickFiles')}
      </label>
    </div>
  );
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Upload state machine: a dry-run preview whenever the picked files change, then the real upload. */
function useUpload(picked: Picked[] | null, onDone: () => void) {
  const [input, setInput] = useState<UploadInput>();
  const [preview, setPreview] = useState<UploadResult>();
  const [done, setDone] = useState<UploadResult>();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    setPreview(undefined);
    setDone(undefined);
    setError(undefined);
    if (!picked?.length) return;
    setBusy(true);
    toInput(picked)
      .then(async (i) => {
        setInput(i);
        setPreview(await api.uploadBundle({ ...i, dryRun: true }));
      })
      .catch((e: unknown) => setError(errorText(e)))
      .finally(() => setBusy(false));
  }, [picked]);
  const upload = async () => {
    if (!input) return;
    setBusy(true);
    try {
      const r = await api.uploadBundle({ ...input, ...(message.trim() && { message: message.trim() }) });
      if (r.ok) {
        setDone(r);
        onDone();
      } else setPreview(r);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const changed = preview?.changes.filter((c) => c.change !== 'unchanged') ?? [];
  return { input, preview, done, message, setMessage, busy, error, upload, changed };
}
type Upload = ReturnType<typeof useUpload>;
type Shared = { hosted: boolean; workspace?: boolean | undefined; onClose(): void };

type DialogProps = Shared & {
  open: boolean;
  picked: Picked[] | null;
  onDone(): void;
  onFiles(p: Picked[]): void;
};

/** Pick, preview and upload definition files. */
export function UploadDialog({ open, picked, hosted, workspace, onClose, onDone, onFiles }: DialogProps) {
  const { t } = useI18n();
  const u = useUpload(picked, onDone);
  return (
    <Dialog open={open} title={t('upload.title')} onClose={onClose} wide>
      {u.done ? (
        <UploadDone count={u.changed.length} hosted={hosted} workspace={workspace} onClose={onClose} />
      ) : !picked?.length ? (
        <div className="stack-sm">
          <div className="dropzone">
            <div className="drop-icon">⇪</div>
            <p>
              <strong>{t('upload.dropHere')}</strong>
            </p>
            <p className="muted small">{t('upload.what')}</p>
            <Pickers onFiles={onFiles} />
          </div>
        </div>
      ) : (
        <div className="stack-sm">
          {u.busy && !u.preview && <p className="muted">{t('upload.checking')}</p>}
          {u.error && (
            <div className="callout s-fail" role="alert">
              {t('common.error', { message: u.error })}
            </div>
          )}
          {u.preview && <UploadPreview u={u} hosted={hosted} workspace={workspace} onClose={onClose} />}
        </div>
      )}
    </Dialog>
  );
}

function UploadDone({ count, hosted, workspace, onClose }: Shared & { count: number }) {
  const { t } = useI18n();
  return (
    <div className="stack-sm">
      <div className="callout s-pass" role="status">
        <Icon status="pass" />{' '}
        {t(workspace ? 'upload.doneWorkspace' : hosted ? 'upload.doneHosted' : 'upload.doneLocal', { count })}
      </div>
      <div className="actions">
        <a className="btn btn-primary" href={href.uploads()} onClick={onClose}>
          {t('upload.viewUploads')}
        </a>
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          {t('common.close')}
        </button>
      </div>
    </div>
  );
}

/** The dry-run result: what changes, what the check found, and the upload button. */
function UploadPreview({ u, hosted, workspace, onClose }: Shared & { u: Upload }) {
  const { t } = useI18n();
  const { changed, busy } = u;
  const preview = u.preview!;
  const count = (change: string) => changed.filter((c) => c.change === change).length;
  return (
    <>
      <p>
        <strong>{t(u.input?.replace ? 'upload.wholeFolder' : 'upload.someFiles')}</strong>{' '}
        <span className="muted">
          {t('upload.summary', {
            added: count('added'),
            changed: count('changed'),
            removed: count('removed'),
          })}
        </span>
      </p>
      <ul className="list small changes">
        {changed.map((c) => (
          <li key={c.path}>
            <span className={`chip change-${c.change}`}>
              {t(`upload.change.${c.change}` as 'upload.change.added')}
            </span>
            <code className="grow">{c.path}</code>
          </li>
        ))}
        {preview.unplaced.map((x) => (
          <li key={x.name}>
            <span className="chip chip-warn">{t('upload.unplaced')}</span>
            <code>{x.name}</code> <span className="muted">{x.reason}</span>
          </li>
        ))}
        {changed.length === 0 && <li className="muted">{t('upload.nothing')}</li>}
      </ul>
      <CheckResult problems={preview.problems} />
      {hosted && !workspace && (
        <label className="field">
          <span>{t('upload.message')}</span>
          <input value={u.message} onChange={(e) => u.setMessage(e.target.value)} maxLength={500} />
        </label>
      )}
      <p className="muted small">
        {t(workspace ? 'upload.explainWorkspace' : hosted ? 'upload.explainHosted' : 'upload.explainLocal')}
      </p>
      <div className="actions">
        <button type="button" className="btn btn-primary" disabled={!preview.ok || busy} onClick={u.upload}>
          {busy ? t('upload.uploading') : t('upload.go', { count: changed.length })}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          {t('common.cancel')}
        </button>
      </div>
    </>
  );
}

function CheckResult({ problems }: { problems: UploadResult['problems'] }) {
  const { t } = useI18n();
  const errors = problems.filter((p) => p.severity === 'error');
  const warnings = problems.filter((p) => p.severity !== 'error');
  return (
    <div className={`callout ${errors.length ? 's-fail' : 's-pass'}`} role="status">
      <Icon status={errors.length ? 'fail' : 'pass'} />{' '}
      {errors.length
        ? t('upload.checkFailed', { count: errors.length })
        : t('upload.checkPassed', { warnings: warnings.length })}
      {[...errors, ...warnings].slice(0, 8).map((p) => (
        <div key={`${p.file}:${p.message}`} className="small">
          {p.file && <code>{p.file}</code>} {p.message}
        </div>
      ))}
    </div>
  );
}
