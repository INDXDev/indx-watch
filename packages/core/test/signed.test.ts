import {
  type AnyRecord,
  type Bundle,
  generateSigningKey,
  type RunRecord,
  recordSigner,
  type SigningKey,
  verifyRecord,
} from '@indx-watch/bundle';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildVerifiedModel, evaluateGate, reportData, verifyRecords } from '../src/index.js';
import { run, shop } from './fixtures.js';

// docs/spec/security.md#signed-records; keys are generated per test run, never stored
let b: Bundle;
let key: SigningKey;
let sign: <R extends AnyRecord>(r: R) => Promise<R>;
const access = {
  kind: 'human' as const,
  id: 'lee@shop.test',
  name: 'Lee',
  via: 'cloudflare-access' as const,
};
const withKeys = (keys: SigningKey[], ignore = false): Bundle => {
  const data = {
    ...b.project.data,
    signing_keys: keys,
    gate: { ...b.project.data.gate, ignore_unverified: ignore },
  };
  return { ...b, project: { ...b.project, data } };
};
const human = (key: string): RunRecord => ({
  ...run(b, key, { judgements: [{ kind: 'human', verdict: 'pass', reason: 'Confirmation shown' }] }),
  ...{ actor: access, source: 'manual' as const },
});

beforeAll(async () => {
  b = await shop();
  const k = await generateSigningKey('hosted-test');
  [key, sign] = [k.key, recordSigner(k.secret)];
});

describe('signed records', () => {
  it('a forged cloudflare-access record without a valid signature is unverified', async () => {
    const forged = human('TC-6');
    const bundle = withKeys([key]);
    expect(await verifyRecord(forged, [key])).toBe(false);
    const ids = await verifyRecords(bundle, [forged]);
    expect(ids).toEqual(new Set([forged.id, ...forged.judgements.map((j) => j.id)]));
    // a signature by an unknown key is no better
    const other = await generateSigningKey('attacker');
    const byOther = await recordSigner(other.secret)(human('TC-6'));
    expect((await verifyRecords(bundle, [byOther])).has(byOther.id)).toBe(true);
  });

  it('a record signed by a trusted key is verified; tampering breaks it', async () => {
    const signed = await sign(human('TC-6'));
    expect(signed.sig).toMatchObject({ alg: 'Ed25519', kid: 'hosted-test' });
    expect(await verifyRecord(signed, [key])).toBe(true);
    expect((await verifyRecords(withKeys([key]), [signed])).size).toBe(0);
    const tampered = { ...signed, judgements: [{ ...signed.judgements[0]!, verdict: 'fail' as const }] };
    expect(await verifyRecord(tampered, [key])).toBe(false);
    // a key limited to other via values cannot vouch for cloudflare-access
    expect(await verifyRecord(signed, [{ ...key, via: ['github-oidc'] }])).toBe(false);
  });

  it('self-asserted via values never count as unverified', async () => {
    const git = {
      ...run(b, 'TC-6'),
      actor: { kind: 'human' as const, id: 'a@shop.test', via: 'git' as const },
    };
    expect((await verifyRecords(withKeys([]), [git])).size).toBe(0);
  });

  it('the gate ignores unverified records only with gate.ignore_unverified', async () => {
    const forged = human('TC-6');
    const p0 = (bundle: Bundle) =>
      buildVerifiedModel(bundle, [forged]).then(
        ({ model }) =>
          evaluateGate(model, { release: 'v1.2.0' }).checks.find((c) => c.key === 'p0_all_pass')!,
      );
    const shown = await p0(withKeys([key]));
    const ignored = await p0(withKeys([key], true));
    expect(shown.actual).toMatch(/^1\//);
    expect(ignored.actual).toMatch(/^0\//);
    // a signed record still counts when unverified ones are ignored
    const signed = await sign(human('TC-6'));
    const { model } = await buildVerifiedModel(withKeys([key], true), [signed]);
    expect(
      evaluateGate(model, { release: 'v1.2.0' }).checks.find((c) => c.key === 'p0_all_pass')?.actual,
    ).toMatch(/^1\//);
    // the UI and reports still show the forged run, marked unverified
    const m = (await buildVerifiedModel(withKeys([key], true), [forged])).model;
    expect(m.runs.has(forged.id)).toBe(true);
    const data = reportData(
      m,
      { release: 'v1.2.0' },
      { audience: 'internal', generatedBy: 'qa', now: new Date(0) },
    );
    expect(data.runs.find((r) => r.id === forged.id)?.unverified).toBe(true);
  });
});
