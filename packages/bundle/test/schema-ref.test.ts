/** `[tool]` and the git ref of the #:schema line (docs/spec/bundle-format.md#projecttoml). */
import { describe, expect, it } from 'vitest';
import { formatToml, Project, parseToml, schemaRefOf, schemaUrl } from '../src/index.js';

const PROJECT = {
  schema_version: 1,
  id: 'prj_01JF3Q8M5X2V7K9D4R6T1W0Y00',
  key: 'SHOP',
  name: 'Shop',
  source_locale: 'en',
  locales: ['en'],
};

describe('[tool] in project.toml', () => {
  it('accepts an exact version, and omitting it changes nothing', () => {
    expect(Project.safeParse({ ...PROJECT, tool: { indx_watch: '0.1.3' } }).success).toBe(true);
    expect(Project.safeParse({ ...PROJECT, tool: { indx_watch: '0.2.0-rc.1' } }).success).toBe(true);
    expect(Project.safeParse(PROJECT).success).toBe(true);
    expect(formatToml('project', PROJECT)).not.toContain('[tool]');
  });

  it('refuses a range, a tag name and unknown keys', () => {
    for (const bad of ['^0.1.3', 'latest', '0.1', 'v0.1.3'])
      expect(Project.safeParse({ ...PROJECT, tool: { indx_watch: bad } }).success, bad).toBe(false);
    expect(Project.safeParse({ ...PROJECT, tool: { other: 1 } }).success).toBe(false);
  });

  it('is written canonically, after [hosting] and before the keys', () => {
    const text = formatToml('project', { ...PROJECT, tool: { indx_watch: '0.1.3' } });
    expect(text).toContain('\n[tool]\nindx_watch = "0.1.3"\n');
    expect(parseToml(text).tool).toEqual({ indx_watch: '0.1.3' });
  });
});

describe('the ref of the #:schema line', () => {
  it('is main by default and a version tag on request; schemaRefOf reads either', () => {
    expect(schemaUrl('project')).toContain('/INDXDev/indx-watch/main/schemas/v1/project.json');
    const text = formatToml('project', PROJECT, 'v0.1.3');
    expect(text.split('\n')[0]).toBe(
      '#:schema https://raw.githubusercontent.com/INDXDev/indx-watch/v0.1.3/schemas/v1/project.json',
    );
    expect(schemaRefOf(text)).toBe('v0.1.3');
    expect(schemaRefOf(formatToml('project', PROJECT))).toBe('main');
  });

  it('knows nothing of a line that is not ours', () => {
    expect(schemaRefOf('#:schema https://example.test/main/schemas/v1/x.json\n')).toBeUndefined();
    expect(schemaRefOf('schema_version = 1\n')).toBeUndefined();
    expect(schemaRefOf(undefined)).toBeUndefined();
  });
});
