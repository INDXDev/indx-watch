/**
 * Portable full archive (docs/spec/cli.md#iw-export---full--iw-import-archive).
 * Uncompressed tar (modern-tar: sorted entries, mtime 0, uid/gid 0, fixed modes); compression (zstd when available, else gzip) is done by the caller.
 * CONTRACT: signatures frozen; implementation T-114.
 */
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

/** Layout: manifest.json, bundle/**, records.ndjson, blobs/sha256/<aa>/<hash>. */
export async function createArchive(input: {
  project: string;
  bundleFiles: ArchiveEntry[];
  records: unknown[];
  blobs: ArchiveEntry[];
  now?: Date;
}): Promise<{ tar: Uint8Array; manifest: ArchiveManifest }> {
  void input;
  throw new Error('not implemented (T-114)');
}

/** Parse and verify every hash; throws on mismatch. */
export async function readArchive(tar: Uint8Array): Promise<{
  manifest: ArchiveManifest;
  bundleFiles: ArchiveEntry[];
  records: unknown[];
  blobs: ArchiveEntry[];
}> {
  void tar;
  throw new Error('not implemented (T-114)');
}
