/** A bucket holding the shop bundle in workspace mode (docs/spec/sync.md#workspace-mode-v02), for Worker tests. */
import { type AnyRecord, FileRecord, newId, parseToml, sha256Hex } from '@indx-watch/bundle';
import { nodeFs } from '@indx-watch/bundle/node';
import { createResultStore } from '@indx-watch/store';
import { r2ObjectStore } from '@indx-watch/store/workers';
import { definitionFiles } from '@indx-watch/sync';
import { fakeR2 } from '../../store/test/helpers/fakes.js';
import { SHOP, shop } from './helpers.js';

const [enc, dec] = [new TextEncoder(), new TextDecoder()];
export const TC3 = 'specs/FEAT-2-checkout/UC-2-guest-applies-coupon/TC-3-valid-coupon.toml';
const workspaceToml = (t: string) => t.replace('mode = "git"', 'mode = "workspace"');

/** A bucket holding the shop bundle in workspace mode as `file` records, as a first `iw sync` publishes it. */
export async function workspaceBucket() {
  const r2 = fakeR2({ honorStartAfter: true });
  const store = createResultStore(r2ObjectStore(r2, 'shop'));
  const files = await definitionFiles(nodeFs(SHOP));
  files.set('project.toml', enc.encode(workspaceToml(dec.decode(files.get('project.toml')!))));
  const project = (await shop()).project.data.id;
  await store.init(project);
  const records: AnyRecord[] = [];
  const actor = { kind: 'human', id: 'alex@shop.test', via: 'git' } as const;
  for (const [path, data] of files) {
    const sha256 = await sha256Hex(data);
    await store.putBlob(sha256, data, 'application/octet-stream');
    const id = path.endsWith('.toml') ? parseToml(dec.decode(data)).id : undefined;
    const entity = typeof id === 'string' ? id : undefined;
    const at = '2026-11-18T00:00:00Z';
    const env = { kind: 'file', id: newId('rec'), v: 1, project, at, actor, source: 'cli' };
    records.push(FileRecord.parse({ ...env, path, entity, sha256 }));
  }
  await store.appendLog('wa', records);
  return { r2, store, first: records.find((r) => (r as FileRecord).path === TC3)! };
}
