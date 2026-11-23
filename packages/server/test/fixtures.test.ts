import { parseToml } from '@indx-watch/bundle';
import { nodeFs } from '@indx-watch/bundle/node';
import { definitionFiles } from '@indx-watch/sync';
import { describe, expect, it } from 'vitest';
import { toCsv } from '../src/fixtures.js';
import type { FixtureSaved, ProjectInfo } from '../src/index.js';
import { createApp, prepareUpload } from '../src/index.js';
import { ALEX, fakeDeps, req, SHOP } from './helpers.js';

const b64 = (d: string | Uint8Array) => Buffer.from(d).toString('base64');
const text = (d?: Uint8Array) => new TextDecoder().decode(d);
const PDF = '%PDF-1.4\n% sales deck\n';

describe('upload of files that are not in the bundle', () => {
  it('turns a PDF into a draft file fixture and a CSV into a dataset', async () => {
    const base = await definitionFiles(nodeFs(SHOP));
    const { next, result } = await prepareUpload(base, {
      files: [
        { name: 'Sales deck.pdf', data: b64(PDF) },
        { name: 'leads.csv', data: b64('email,name\na@shop.test,A\n') },
      ],
    });
    expect(result.unplaced).toEqual([]);
    expect(result.ok).toBe(true);
    const added = result.changes.filter((c) => c.change === 'added').map((c) => c.path);
    expect(added).toEqual([
      'fixtures/FX-5-sales-deck/Sales deck.pdf',
      'fixtures/FX-5-sales-deck/fixture.toml',
      'fixtures/FX-6-leads/fixture.toml',
      'fixtures/FX-6-leads/leads.csv',
    ]);
    expect(parseToml(text(next.get('fixtures/FX-5-sales-deck/fixture.toml')))).toMatchObject({
      key: 'FX-5',
      title: 'Sales deck',
      status: 'draft',
      kind: 'file',
      files: ['Sales deck.pdf'],
    });
    expect(parseToml(text(next.get('fixtures/FX-6-leads/fixture.toml')))).toMatchObject({
      kind: 'dataset',
      row_key: 'email',
    });
  });

  it('stores a file larger than inline_max_bytes as a pointer and returns its blob', async () => {
    const base = await definitionFiles(nodeFs(SHOP));
    const big = new Uint8Array(1048577).fill(65);
    const { next, blobs, result } = await prepareUpload(base, {
      files: [{ name: 'big.pdf', data: b64(big) }],
    });
    expect(result.ok).toBe(true);
    expect(blobs).toHaveLength(1);
    expect(text(next.get('fixtures/FX-5-big/big.pdf.blob.toml'))).toContain('size = 1048577');
    expect(next.has('fixtures/FX-5-big/big.pdf')).toBe(false);
  });
});

it('toCsv quotes cells with commas, quotes and line breaks', () => {
  expect(toCsv(['a', 'b'], [['x,y', 'say "hi"'], ['1']])).toBe('a,b\n"x,y","say ""hi"""\n1,\n');
});

/** fakeDeps over a bundle in memory that publishBundle writes back to (git mode). */
async function editable() {
  const f = await fakeDeps();
  let files = await definitionFiles(nodeFs(SHOP));
  const published: { changed: string[]; removed: string[] }[] = [];
  f.deps.bundleFiles = async () => new Map(files);
  f.deps.publishBundle = async (next, info) => {
    files = new Map(next);
    published.push(info);
    return undefined;
  };
  return { ...f, app: createApp(f.deps), files: () => files, published };
}
const send = (method: string, path: string, json?: unknown) =>
  req(path, json === undefined ? { method, headers: { 'X-IW-Request': '1' } } : { method, json });

describe('POST, PATCH and DELETE /api/fixtures', () => {
  it('creates a dataset from a table, edits it and removes it', async () => {
    const e = await editable();
    const info = (await (await e.app.fetch(req('/api/project'))).json()) as ProjectInfo;
    expect(info.can.data).toBe(true);
    const table = { columns: ['company', 'contact'], rows: [['Acme', 'a@acme.test']] };
    const res = await e.app.fetch(
      send('POST', '/api/fixtures', { title: 'Prospects', kind: 'dataset', table }),
    );
    expect(res.status).toBe(201);
    const saved = (await res.json()) as FixtureSaved;
    expect(saved).toMatchObject({ key: 'FX-5', file: 'fixtures/FX-5-prospects/fixture.toml' });
    expect(text(e.files().get('fixtures/FX-5-prospects/prospects.csv'))).toBe(
      'company,contact\nAcme,a@acme.test\n',
    );
    expect(e.published[0]?.changed).toHaveLength(2);

    const edit = {
      title: 'Prospect list',
      notes: 'For the sales demo',
      table: {
        columns: ['company', 'contact'],
        rows: [
          ['Acme', 'a@acme.test'],
          ['Beta, Inc.', ''],
        ],
      },
      add: [{ name: 'deck.pdf', data: b64(PDF) }],
    };
    expect((await e.app.fetch(send('PATCH', '/api/fixtures/FX-5', edit))).status).toBe(200);
    const fx = parseToml(text(e.files().get(saved.file)));
    expect(fx).toMatchObject({ title: 'Prospect list', notes: 'For the sales demo', row_key: 'company' });
    expect(fx.files).toEqual(['prospects.csv', 'deck.pdf']);
    expect(text(e.files().get('fixtures/FX-5-prospects/prospects.csv'))).toContain('"Beta, Inc.",');

    const remove = { remove: ['deck.pdf'] };
    expect((await e.app.fetch(send('PATCH', '/api/fixtures/FX-5', remove))).status).toBe(200);
    expect(e.files().has('fixtures/FX-5-prospects/deck.pdf')).toBe(false);

    expect((await e.app.fetch(send('DELETE', '/api/fixtures/FX-5'))).status).toBe(200);
    expect([...e.files().keys()].some((p) => p.startsWith('fixtures/FX-5-'))).toBe(false);
  });

  it('refuses a broken result, an unsafe file name and agents', async () => {
    const e = await editable();
    // FX-1 is used by TC-3 and TC-4: removing it fails the check and writes nothing
    const used = await e.app.fetch(send('DELETE', '/api/fixtures/FX-1'));
    expect(used.status).toBe(400);
    const bad = { add: [{ name: '../x.pdf', data: b64(PDF) }] };
    expect((await e.app.fetch(send('PATCH', '/api/fixtures/FX-2', bad))).status).toBe(400);
    const secret = { kind: 'account', title: 'Demo', account: { username: 'u', secret_ref: 'hunter2' } };
    expect((await e.app.fetch(send('POST', '/api/fixtures', secret))).status).toBe(400);
    e.setActor({ ...ALEX, kind: 'agent', model: 'claude-opus-5-5' });
    expect((await e.app.fetch(send('POST', '/api/fixtures', { kind: 'file', title: 'x' }))).status).toBe(403);
    expect(e.published).toEqual([]);
  });
});
