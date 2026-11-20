/** `iw skills install` and the portable-frontmatter rule (docs/spec/agents.md#acceptance-criteria). */
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { iwJson, ROOT } from './helpers.js';

const SKILLS = join(ROOT, 'skills');
const names = readdirSync(SKILLS, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);
const PORTABLE = ['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools'];

/** Top-level keys of the YAML frontmatter (a blank line may follow the opening ---). */
function frontmatterKeys(text: string): string[] {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  if (!m) throw new Error('no frontmatter');
  return m[1]!
    .split(/\r?\n/)
    .flatMap((l) => (/^([A-Za-z][\w-]*):/.exec(l)?.[1] ? [/^([A-Za-z][\w-]*):/.exec(l)![1]!] : []));
}

describe('skills', () => {
  it('every SKILL.md has only portable frontmatter keys, including name and description', () => {
    expect(names.length).toBeGreaterThanOrEqual(6);
    for (const n of names) {
      const keys = frontmatterKeys(readFileSync(join(SKILLS, n, 'SKILL.md'), 'utf8'));
      expect(
        keys.filter((k) => !PORTABLE.includes(k)),
        n,
      ).toEqual([]);
      expect(keys, n).toEqual(expect.arrayContaining(['name', 'description']));
    }
  });

  it('skills install copies every skill folder (with references/) to both locations', () => {
    const dir = mkdtempSync(join(tmpdir(), 'iw-skills-'));
    const r = iwJson(dir, 'skills install', ['skills', 'install']);
    expect(r.json.data.installed).toHaveLength(names.length * 2);
    for (const base of ['.claude/skills', '.agents/skills'])
      for (const n of names) expect(existsSync(join(dir, base, n, 'SKILL.md')), `${base}/${n}`).toBe(true);
    expect(existsSync(join(dir, '.claude/skills/indx-watch/references/cli-json.md'))).toBe(true);
    expect(existsSync(join(dir, '.claude/skills/README.md'))).toBe(false);
    const only = mkdtempSync(join(tmpdir(), 'iw-skills-'));
    expect(iwJson(only, 'skills install', ['skills', 'install', '--codex']).json.data.installed[0]).toMatch(
      /^\.agents\//,
    );
    expect(existsSync(join(only, '.claude'))).toBe(false);
  });
});
