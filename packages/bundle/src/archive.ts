/**
 * Portable full archive (docs/spec/cli.md#iw-export---full--iw-import-archive).
 * Uncompressed tar (modern-tar: sorted entries, mtime 0, uid/gid 0, fixed modes); compression (zstd when available, else gzip) is done by the caller.
 * CONTRACT: signatures frozen; implementation T-114.
 */
import { packTar, unpackTar } from 'modern-tar';
import { sha256Hex } from './hash.js';
import { encodeRecord } from './record-io.js';

export interface ArchiveEntry {
  path: string;
  data: Uint8Array;
}

export interface ArchiveManifest {
  format: 'indx-watch-archive';
  version: 1;
  project: string;
  created_at: string;
  /** sha256 over the sorted 'path\tsha256' lines of all entries except manifest.json */
  sha256: string;
  files: { path: string; sha256: string; size: number }[];
  records: number;
  blobs: number;
}

const enc = new TextEncoder();
const dec = new TextDecoder();
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
/** Fixed tar header fields, so the same content always gives the same bytes. */
const HEADER = { mtime: new Date(0), mode: 0o644, uid: 0, gid: 0, uname: '', gname: '' };

/** Canonical record JSON (records from newer tools are kept as given). */
function recordLine(r: unknown): string {
  try {
    return encodeRecord(r);
  } catch {
    return typeof r === 'string' ? r : JSON.stringify(r);
  }
}

async function manifestOf(entries: ArchiveEntry[]) {
  const files = await Promise.all(
    entries.map(async (e) => ({ path: e.path, sha256: await sha256Hex(e.data), size: e.data.length })),
  );
  files.sort((a, b) => cmp(a.path, b.path));
  return { files, sha256: await sha256Hex(files.map((f) => `${f.path}\t${f.sha256}\n`).join('')) };
}

/**
 * Layout: manifest.json, bundle/**, records.ndjson, blobs/sha256/<aa>/<hash>.
 * A blob entry's path is ignored: blobs are stored under the SHA-256 of their content.
 */
export async function createArchive(input: {
  project: string;
  bundleFiles: ArchiveEntry[];
  records: unknown[];
  blobs: ArchiveEntry[];
  now?: Date;
}): Promise<{ tar: Uint8Array; manifest: ArchiveManifest }> {
  const id = (line: string) => String((JSON.parse(line) as { id?: unknown }).id);
  const lines = input.records.map(recordLine).sort((a, b) => cmp(id(a), id(b)));
  const blobs = new Map<string, Uint8Array>();
  for (const b of input.blobs) blobs.set(await sha256Hex(b.data), b.data);
  const entries: ArchiveEntry[] = [
    ...input.bundleFiles.map((f) => ({ path: `bundle/${f.path.replace(/^\/+/, '')}`, data: f.data })),
    { path: 'records.ndjson', data: enc.encode(lines.map((l) => `${l}\n`).join('')) },
    ...[...blobs].map(([h, data]) => ({ path: `blobs/sha256/${h.slice(0, 2)}/${h}`, data })),
  ];
  const created_at = (input.now ?? new Date()).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const { files, sha256 } = await manifestOf(entries);
  const counts = { records: lines.length, blobs: blobs.size };
  const manifest: ArchiveManifest = {
    format: 'indx-watch-archive',
    version: 1,
    project: input.project,
    created_at,
    sha256,
    files,
    ...counts,
  };
  entries.push({ path: 'manifest.json', data: enc.encode(`${JSON.stringify(manifest, null, 2)}\n`) });
  entries.sort((a, b) => cmp(a.path, b.path));
  const tar = await packTar(
    entries.map((e) => ({ header: { ...HEADER, name: e.path, size: e.data.length }, body: e.data })),
  );
  return { tar: new Uint8Array(tar), manifest };
}

/** Only the v1 layout, and bundle paths without '.', '..', empty segments, backslashes or NUL (no zip-slip). */
const safePath = (p: string) =>
  p === 'manifest.json' ||
  p === 'records.ndjson' ||
  /^blobs\/sha256\/[0-9a-f]{2}\/[0-9a-f]{64}$/.test(p) ||
  (p.startsWith('bundle/') &&
    p
      .slice(7)
      .split('/')
      .every((s) => s && s !== '.' && s !== '..' && !/[\\\0]/.test(s)));

/** Parse and verify every hash; throws on mismatch or an entry outside the layout. */
export async function readArchive(tar: Uint8Array): Promise<{
  manifest: ArchiveManifest;
  bundleFiles: ArchiveEntry[];
  records: unknown[];
  blobs: ArchiveEntry[];
}> {
  const entries = (await unpackTar(tar, { strict: true }))
    .filter((e) => (e.header.type ?? 'file') === 'file')
    .map((e) => ({ path: e.header.name, data: new Uint8Array(e.data ?? new Uint8Array()) }));
  for (const e of entries)
    if (!safePath(e.path)) throw new Error(`archive entry ${JSON.stringify(e.path)} is not allowed`);
  const m = entries.find((e) => e.path === 'manifest.json');
  const manifest = JSON.parse(m ? dec.decode(m.data) : '{}') as ArchiveManifest;
  if (manifest.format !== 'indx-watch-archive' || manifest.version !== 1)
    throw new Error('not an indx-watch archive v1');
  const content = entries.filter((e) => e !== m);
  const { files, sha256 } = await manifestOf(content);
  const listed = [...manifest.files].sort((a, b) => cmp(a.path, b.path));
  if (sha256 !== manifest.sha256 || JSON.stringify(files) !== JSON.stringify(listed))
    throw new Error('archive hash mismatch: the archive is corrupt or was modified');
  const under = (prefix: string) =>
    content
      .filter((e) => e.path.startsWith(prefix))
      .map((e) => ({ path: e.path.slice(prefix.length), data: e.data }));
  const blobs = under('blobs/sha256/').map((b) => ({ path: b.path.slice(3), data: b.data }));
  for (const b of blobs)
    if ((await sha256Hex(b.data)) !== b.path) throw new Error(`blob hash mismatch: ${b.path}`);
  const ndjson = dec.decode(content.find((e) => e.path === 'records.ndjson')?.data);
  const records = ndjson.split('\n').flatMap((l) => (l ? [JSON.parse(l) as unknown] : []));
  return { manifest, bundleFiles: under('bundle/'), records, blobs };
}
