import { describe, expect, it } from 'vitest';
import { FILE_TYPES, type FileType } from '../src/schema/definitions.js';
import { canonicalBody, formatToml, formatTomlBody, parseToml, schemaUrl } from '../src/toml.js';
import { shopFiles } from './helpers.js';

const dec = new TextDecoder();

describe('canonical TOML round trip', () => {
  const files = [...shopFiles()].filter(([p]) => p.endsWith('.toml'));
  it.each(files.map(([p, b]) => [p, dec.decode(b)]))('%s', (path, text) => {
    const data = parseToml(text);
    const m = /^#:schema .*\/([a-z-]+)\.json\n\n/.exec(text);
    if (path.startsWith('templates/')) {
      expect(m).toBeNull();
      expect(formatTomlBody(path.split('/')[1]!.split('.')[0] as FileType, data)).toBe(text);
    } else {
      expect(m?.[1]).toBeDefined();
      const type = m![1] as FileType;
      expect(FILE_TYPES[type].safeParse(data).success).toBe(true);
      expect(formatToml(type, data)).toBe(text);
    }
  });
});

describe('serializer rules', () => {
  it('writes floats with a decimal digit and integers without', () => {
    const out = formatToml('project', {
      schema_version: 1,
      id: 'prj_01JF3Q8M5X2V7K9D4R6T1W0Y00',
      key: 'SHOP',
      name: 'Shop',
      source_locale: 'en',
      locales: ['en'],
      gate: { p0_coverage: 1, max_untested: 2 },
    });
    expect(out).toContain('p0_coverage = 1.0\nmax_untested = 2\n');
  });

  it('puts plain values before tables and orders by schema', () => {
    const out = formatToml('environment', {
      hooks: { seed: { url: '/s' } },
      title: 'T',
      base_url: 'http://x.test',
      name: 'x',
      id: 'env_01JF3Q8M5X2V7K9D4R6T1W0Y01',
    });
    expect(out).toBe(
      `#:schema ${schemaUrl('environment')}\n\nid = "env_01JF3Q8M5X2V7K9D4R6T1W0Y01"\nname = "x"\ntitle = "T"\nbase_url = "http://x.test"\n\n[hooks.seed]\nurl = "/s"\n`,
    );
  });

  it('wraps long arrays one item per line', () => {
    const tags = Array.from({ length: 12 }, (_, i) => `tag-number-${i}`);
    const out = canonicalBody({ tags });
    expect(out.startsWith('tags = [\n  "tag-number-0",\n')).toBe(true);
    expect(parseToml(out).tags).toEqual(tags);
  });

  it('normalizes multi-line strings and escapes', () => {
    const out = canonicalBody({ a: 'one\ntwo', b: 'say "hi"\\', x: 'tab\there' });
    expect(out).toBe('a = """\none\ntwo\n"""\nb = "say \\"hi\\"\\\\"\nx = "tab\\there"\n');
    expect(parseToml(out)).toEqual({ a: 'one\ntwo\n', b: 'say "hi"\\', x: 'tab\there' });
  });

  it('sorts free-form [x] tables', () => {
    const out = formatTomlBody('feature', {
      id: 'fea_01JF3Q8M5X2V7K9D4R6T1W0Y10',
      key: 'FEAT-1',
      title: 'C',
      x: { zeta: 1, alpha: { b: true, a: 'q' } },
    });
    expect(out).toContain('[x]\nzeta = 1\n\n[x.alpha]\na = "q"\nb = true\n');
  });

  it('normalizes dates to strings', () => {
    expect(parseToml('a = 2026-12-01\nb = 2026-11-19T03:00:00Z\n')).toEqual({
      a: '2026-12-01',
      b: '2026-11-19T03:00:00Z',
    });
  });
});
