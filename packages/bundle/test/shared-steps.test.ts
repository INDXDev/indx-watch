/** Shared steps (T-521): expanded at load, part of the test case version, checked for references and cycles. */
import { describe, expect, it } from 'vitest';
import { checkBundle } from '../src/check.js';
import { loadBundle } from '../src/load.js';
import { parseToml } from '../src/toml.js';
import { approveDefinition, createDefinition } from '../src/write.js';
import { codes, edit } from './check-helpers.js';
import { memFs } from './helpers.js';

const TC8 = 'specs/FEAT-3-account/UC-4-customer-signs-in/TC-8-wrong-password.toml';
const SS1 = 'steps/SS-1-reload-signed-out.toml';
const versionOf = async (fs: ReturnType<typeof memFs>, key = 'TC-8') =>
  (await loadBundle(fs)).bundle!.testCases.find((t) => t.data.key === key)!.version;

describe('shared steps', () => {
  it('TC-8 uses SS-1: its steps are expanded and marked, its version is as before', async () => {
    const { bundle, problems } = await loadBundle(memFs());
    expect(problems.filter((p) => p.severity === 'error')).toEqual([]);
    expect(bundle!.sharedSteps.map((s) => s.data.key)).toEqual(['SS-1']);
    const steps = bundle!.testCases.find((t) => t.data.key === 'TC-8')!.data.steps;
    expect(steps).toHaveLength(2);
    expect(steps[1]).toMatchObject({ instruction: 'Reload the page.', from: 'SS-1', fromFirst: true });
    expect(steps[1]!.i18n?.ja?.instruction).toBe('ページを再読み込みする。');
    expect(steps[0]!.from).toBeUndefined();
  });

  it('editing a shared step makes every test case that uses it stale; a title or translation does not', async () => {
    const fs = memFs();
    const before = await versionOf(fs);
    edit(fs, SS1, (t) => t.replace('title = "Reload', 'title = "Refresh'));
    expect(await versionOf(fs)).toBe(before);
    edit(fs, SS1, (t) => t.replace('expected = "The header still', 'expected = "The page header still'));
    expect(await versionOf(fs)).not.toBe(before);
  });

  it('a step written out by hand has the same version as the shared step it replaces', async () => {
    const fs = memFs();
    const before = await versionOf(fs);
    edit(fs, TC8, (t) =>
      t.replace(
        'use = "SS-1"',
        'instruction = "Reload the page."\nexpected = "The header still shows \\"Sign in\\"."',
      ),
    );
    expect(await versionOf(fs)).toBe(before);
  });

  it('a missing shared step is an unresolved-ref error on the test case', async () => {
    const fs = memFs();
    edit(fs, TC8, (t) => t.replace('use = "SS-1"', 'use = "SS-9"'));
    const r = await checkBundle(fs);
    expect(r.problems.find((p) => p.code === 'unresolved-ref')).toMatchObject({
      file: TC8,
      path: 'steps[1].use',
      message: 'Shared step SS-9 does not exist',
    });
    expect((await loadBundle(fs)).bundle!.invalidFiles).toContain(TC8);
  });

  it('a cycle between shared steps is an error on the shared steps and on the test case that uses it', async () => {
    const fs = memFs();
    edit(fs, SS1, (t) => t.replace('[[steps]]', '[[steps]]\nuse = "SS-2"\n\n[[steps]]'));
    fs.files.set(
      'steps/SS-2-loop.toml',
      new TextEncoder().encode(
        '#:schema https://raw.githubusercontent.com/INDXDev/indx-watch/main/schemas/v1/shared-step.json\n\n' +
          'id = "ss_01JF3Q8M5X2V7K9D4R6T1W0Y72"\nkey = "SS-2"\ntitle = "Loop"\n\n[[steps]]\nuse = "SS-1"\n',
      ),
    );
    const r = await checkBundle(fs);
    const cycles = r.problems.filter((p) => p.code === 'shared-step-cycle');
    expect(cycles.map((p) => p.file).sort()).toEqual([TC8, SS1, 'steps/SS-2-loop.toml'].sort());
    expect(cycles[0]!.message).toContain('→');
  });

  it('a step is use alone, or instruction and expected', async () => {
    const fs = memFs();
    edit(fs, TC8, (t) => t.replace('use = "SS-1"', 'use = "SS-1"\ninstruction = "x"'));
    expect(codes(await checkBundle(fs))).toContain('invalid-value');
    edit(fs, TC8, (t) => t.replace('use = "SS-1"\ninstruction = "x"', 'expected = "x"'));
    expect(codes(await checkBundle(fs))).toContain('invalid-value');
  });

  it('a shared step file is checked for its name, unknown keys and translations', async () => {
    const fs = memFs();
    edit(fs, SS1, (t) => t.replace('key = "SS-1"', 'key = "SS-3"').replace('title =', 'titel ='));
    const r = await checkBundle(fs);
    expect(r.problems.filter((p) => p.file === SS1).map((p) => p.code)).toEqual(
      expect.arrayContaining(['unknown-key']),
    );
    const fs2 = memFs();
    edit(fs2, SS1, (t) => t.replace('key = "SS-1"', 'key = "SS-3"'));
    expect((await checkBundle(fs2)).problems.map((p) => p.code)).toContain('path-mismatch');
    const fs3 = memFs();
    edit(fs3, SS1, (t) => t.replace('instruction = "Reload the page."', 'instruction = "Reload it."'));
    expect((await checkBundle(fs3)).problems.filter((p) => p.code === 'stale-translation')).toHaveLength(1);
  });

  it('writing a test case puts the use back: approve keeps `use = "SS-1"` and the version', async () => {
    const fs = memFs();
    const b = (await loadBundle(fs)).bundle!;
    const { version } = await approveDefinition(fs, b, 'TC-8', 'alex@shop.test');
    const raw = parseToml(fs.text(TC8)!);
    expect(raw.steps).toHaveLength(2);
    expect((raw.steps as { use?: string }[])[1]).toEqual({ use: 'SS-1' });
    expect(version).toBe(await versionOf(fs));
    expect(raw.approved_version).toBe(version);
  });

  it('iw new creates a shared step with the next key; approving it records the reviewer', async () => {
    const fs = memFs();
    const b = (await loadBundle(fs)).bundle!;
    const r = await createDefinition(fs, b, {
      kind: 'shared-step',
      fields: { title: 'Sign in', steps: [{ instruction: 'Open "Sign in".', expected: 'The form opens.' }] },
    });
    expect(r).toMatchObject({ key: 'SS-2', file: 'steps/SS-2-sign-in.toml' });
    expect(codes(await checkBundle(fs))).toEqual([]);
    const placeholder = await createDefinition(fs, (await loadBundle(fs)).bundle!, {
      kind: 'shared-step',
      fields: { title: 'Empty' },
      origin: 'ai',
      ai: { model: 'm' },
    });
    expect(placeholder.key).toBe('SS-3');
    expect((await checkBundle(fs)).problems.map((p) => p.code)).toEqual(['ai-not-approved']);
    await approveDefinition(fs, (await loadBundle(fs)).bundle!, 'SS-3', 'alex@shop.test');
    expect((await checkBundle(fs)).problems).toEqual([]);
  });
});
