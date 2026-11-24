import { describe, expect, it } from 'vitest';
import { pick, pickList, pickLocale, segments, t } from '../src/i18n';
import en from '../src/messages/en.json';
import ja from '../src/messages/ja.json';

describe('messages', () => {
  it('en.json and ja.json have identical keys', () => {
    expect(Object.keys(ja).sort()).toEqual(Object.keys(en).sort());
  });

  it('every message is non-empty and uses the same placeholders in both locales', () => {
    const vars = (s: string) => [...s.matchAll(/\{(\w+)(?:\}|, plural,)/g)].map((m) => m[1]).sort();
    for (const [k, v] of Object.entries(en)) {
      const other = (ja as Record<string, string>)[k]!;
      expect(v.trim(), k).not.toBe('');
      expect(other.trim(), k).not.toBe('');
      expect(vars(other), k).toEqual(vars(v));
    }
  });

  it('has a label for every status, gate check and decision rule', () => {
    const keys = new Set(Object.keys(en));
    for (const s of [
      'pass',
      'fail',
      'needs_review',
      'stale',
      'blocked',
      'untested',
      'waived',
      'uncovered',
      'skipped',
    ])
      expect(keys.has(`status.${s}`), s).toBe(true);
    for (const g of [
      'p0_coverage',
      'p0_all_pass',
      'p1_pass_rate',
      'max_needs_review',
      'max_untested',
      'allow_stale',
      'require_evidence',
      'has_gated_tests',
    ])
      expect(keys.has(`gate.${g}`), g).toBe(true);
    for (let n = 1; n <= 10; n++) expect(keys.has(`rule.${n}`), `rule.${n}`).toBe(true);
  });
});

describe('t()', () => {
  it('fills placeholders and keeps unknown ones', () => {
    expect(t('en', 'runner.progress', { done: 1, total: 2 })).toBe('1 of 2 steps recorded');
    expect(t('ja', 'runner.progress', { done: 1 })).toBe('{total} 手順中 1 手順を記録済み');
  });
  it('picks ICU plural forms by the locale and fills # with the number', () => {
    const summary = (features: number) => t('en', 'specs.summary', { features, useCases: 0, criteria: 1 });
    expect(summary(1)).toBe('1 feature · 0 use cases · 1 acceptance criterion');
    expect(summary(3)).toBe('3 features · 0 use cases · 1 acceptance criterion');
    expect(t('ja', 'specs.summary', { features: 1, useCases: 0, criteria: 1 })).toBe(
      '機能 1 · ユースケース 0 · 完了条件 1',
    );
    expect(t('en', 'specs.summary')).toContain('{features, plural,');
  });
  it('falls back to the key for unknown keys', () => {
    expect(t('en', 'no.such.key' as never)).toBe('no.such.key');
  });
});

describe('pickLocale()', () => {
  it('prefers the stored choice, then browser languages, then the project source locale', () => {
    expect(pickLocale('ja', ['en-US'], 'en')).toBe('ja');
    expect(pickLocale(null, ['fr-FR', 'ja-JP'], 'en')).toBe('ja');
    expect(pickLocale('xx', ['fr-FR'], 'ja')).toBe('ja');
    expect(pickLocale(null, [], undefined)).toBe('en');
  });
});

describe('pick()', () => {
  // examples/shop TC-4 step 1
  const step = {
    instruction: 'Open the cart and enter {{FX-1.code}} in the coupon field, then press "Apply".',
    i18n: {
      ja: {
        instruction: 'カートを開き、クーポン欄に {{FX-1.code}} を入力して「Apply」を押す。',
        status: 'reviewed',
      },
    },
  };
  it('uses a valid translation', () => {
    expect(pick(step, 'instruction', 'ja')).toEqual({
      text: step.i18n.ja.instruction,
      translated: true,
      outdated: false,
      machine: false, // reviewed
    });
  });
  it('shows the source for the source locale and for missing fields', () => {
    expect(pick(step, 'instruction', 'en').text).toBe(step.instruction);
    expect(pick(step, 'expected', 'ja')).toEqual({ text: '', translated: false, outdated: false });
  });
  it('falls back to the source with an outdated flag when the server marks the translation stale', () => {
    const stale = { ...step, i18n: { ja: { ...step.i18n.ja, status: 'stale' } } };
    expect(pick(stale, 'instruction', 'ja')).toEqual({
      text: step.instruction,
      translated: false,
      outdated: true,
    });
  });
});

describe('pickList()', () => {
  // examples/shop TC-3 step 1
  const step = {
    checks: ['The discount line shows "-4.00".', 'The total is "36.00".'],
    i18n: {
      ja: { checks: ['割引行に「-4.00」と表示される。', '合計が「36.00」になる。'], status: 'machine' },
    },
  };
  it('uses a current translation of the same length, else the source', () => {
    expect(pickList(step, 'checks', 'ja')).toEqual(step.i18n.ja.checks);
    expect(pickList(step, 'checks', 'en')).toEqual(step.checks);
    const short = {
      ...step,
      i18n: { ja: { checks: ['割引行に「-4.00」と表示される。'], status: 'machine' } },
    };
    expect(pickList(short, 'checks', 'ja')).toEqual(step.checks);
    const stale = { ...step, i18n: { ja: { ...step.i18n.ja, status: 'stale' } } };
    expect(pickList(stale, 'checks', 'ja')).toEqual(step.checks);
    expect(pickList({}, 'checks', 'ja')).toEqual([]);
  });
});

describe('segments()', () => {
  it('marks literal strings and placeholders without changing them', () => {
    const s = segments('Enter {{FX-1.code}}, press "Apply" or 「Apply」.');
    expect(s.map((x) => x.text).join('')).toBe('Enter {{FX-1.code}}, press "Apply" or 「Apply」.');
    expect(s.filter((x) => x.kind !== 'text')).toEqual([
      { kind: 'placeholder', text: '{{FX-1.code}}' },
      { kind: 'literal', text: '"Apply"' },
      { kind: 'literal', text: '「Apply」' },
    ]);
  });
  it('returns plain text as one segment', () => {
    expect(segments('Reload the page.')).toEqual([{ kind: 'text', text: 'Reload the page.' }]);
  });
});
