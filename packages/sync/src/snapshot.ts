/** バンドルのスナップショット（定義ファイルの tar）と definitions_hash。 */
import { type BundleFs, sha256Hex } from '@indx-watch/bundle';
import { packTar } from 'modern-tar';

/** 定義ファイルを集める。cache/・runs/ とドットで始まる名前（.gitignore など）は含めない。 */
async function collect(fs: BundleFs, dir: string, out: string[]): Promise<void> {
  for (const e of await fs.list(dir)) {
    if (e.name.startsWith('.') || (!dir && (e.name === 'cache' || e.name === 'runs'))) continue;
    const path = dir ? `${dir}/${e.name}` : e.name;
    if (e.dir) await collect(fs, path, out);
    else out.push(path);
  }
}

/** SHA-256 over the sorted `path sha256` lines (each ending in '\n'). */
export async function definitionsHash(files: { path: string; sha256: string }[]): Promise<string> {
  const lines = files.map((f) => `${f.path} ${f.sha256}\n`).sort();
  return sha256Hex(lines.join(''));
}

/** 決まった順序・mtime 0・uid/gid 0・mode 0644 の tar を作る（同じ中身なら同じバイト列）。 */
export async function snapshotBundle(
  fs: BundleFs,
): Promise<{ tar: Uint8Array; hash: string; files: number }> {
  const paths: string[] = [];
  await collect(fs, '', paths);
  paths.sort();
  const entries: { path: string; data: Uint8Array; sha256: string }[] = [];
  for (const path of paths) {
    const data = await fs.read(path);
    if (data) entries.push({ path, data, sha256: await sha256Hex(data) });
  }
  const tar = await packTar(
    entries.map((e) => ({
      header: {
        name: e.path,
        size: e.data.byteLength,
        type: 'file' as const,
        mtime: new Date(0),
        mode: 0o644,
        uid: 0,
        gid: 0,
      },
      body: e.data,
    })),
  );
  return { tar, hash: await definitionsHash(entries), files: entries.length };
}
