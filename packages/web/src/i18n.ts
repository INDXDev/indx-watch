/**
 * UI strings (src/messages/{en,ja}.json, identical keys) and content translation picking (docs/spec/i18n.md).
 */
import { createContext, useContext } from 'react';
import en from './messages/en.json';
import ja from './messages/ja.json';

export type Locale = 'en' | 'ja';
export type MsgKey = keyof typeof en;
export type Vars = Record<string, string | number>;
export const LOCALES: readonly Locale[] = ['en', 'ja'];
export const catalogs: Record<Locale, Record<string, string>> = { en, ja };
const isLocale = (v: unknown): v is Locale => v === 'en' || v === 'ja';

/** Translate a UI key; `{name}` placeholders are replaced from vars. Falls back to English, then the key. */
export function t(locale: Locale, key: MsgKey, vars?: Vars): string {
  const s = catalogs[locale][key] ?? catalogs.en[key] ?? key;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
}

/** User choice (browser storage) → browser languages (Accept-Language) → project source locale. */
export function pickLocale(stored: string | null, languages: readonly string[], source?: string): Locale {
  if (isLocale(stored)) return stored;
  for (const l of languages) {
    const p = l.slice(0, 2).toLowerCase();
    if (isLocale(p)) return p;
  }
  return isLocale(source) ? source : 'en';
}

const STORE_KEY = 'indx-watch.locale';
export function readStored(key = STORE_KEY): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
export function writeStored(value: string, key = STORE_KEY): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage blocked (private mode, sandbox): the choice lasts for this page only
  }
}

export interface Localized {
  text: string;
  /** the translation was used */
  translated: boolean;
  /** a translation exists but is outdated: the source text is shown with a badge */
  outdated: boolean;
  /** the translation used is a machine translation nobody reviewed yet */
  machine?: boolean;
}

/**
 * Pick a content field for a locale from an entity with `[i18n.<locale>]` tables.
 * The server marks outdated translations with `status = "stale"` (computed; see i18n.md).
 */
export function pick(entity: unknown, field: string, locale: Locale): Localized {
  const e = (entity ?? {}) as Record<string, unknown> & {
    i18n?: Record<string, Record<string, unknown> | undefined>;
  };
  const source = typeof e[field] === 'string' ? (e[field] as string) : '';
  const tr = e.i18n?.[locale];
  const text = tr?.[field];
  if (typeof text !== 'string') return { text: source, translated: false, outdated: false };
  if (tr?.status === 'stale' || tr?.stale === true)
    return { text: source, translated: false, outdated: true };
  return { text, translated: true, outdated: false, machine: tr?.status === 'machine' };
}

/** A list field (a step's `checks`) for a locale: a current translation of the same length, else the source. */
export function pickList(entity: unknown, field: string, locale: Locale): string[] {
  const e = (entity ?? {}) as Record<string, unknown> & { i18n?: Record<string, Record<string, unknown>> };
  const source = Array.isArray(e[field]) ? (e[field] as string[]) : [];
  const tr = e.i18n?.[locale];
  const list = tr?.[field];
  const current = tr?.status !== 'stale' && tr?.stale !== true;
  return Array.isArray(list) && list.length === source.length && current ? (list as string[]) : source;
}

export type Segment = { kind: 'text' | 'literal' | 'placeholder'; text: string };
/** Split text into plain text, literal on-screen strings ("…" or 「…」) and fixture placeholders ({{FX-1.code}}). */
export function segments(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(/"[^"\n]+"|「[^」\n]+」|\{\{\s*FX-\d+\.[\w-]+\s*\}\}/g)) {
    const i = m.index ?? 0;
    if (i > last) out.push({ kind: 'text', text: text.slice(last, i) });
    out.push({ kind: m[0].startsWith('{{') ? 'placeholder' : 'literal', text: m[0] });
    last = i + m[0].length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out;
}

export interface I18n {
  locale: Locale;
  setLocale(l: Locale): void;
  t(key: MsgKey, vars?: Vars): string;
  date(iso: string | undefined): string;
  /** a TOML local date (YYYY-MM-DD) */
  day(d: string | undefined): string;
}
export function makeI18n(locale: Locale, setLocale: (l: Locale) => void): I18n {
  const fmt = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
  const fmtDay = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' });
  return {
    locale,
    setLocale,
    t: (key, vars) => t(locale, key, vars),
    date: (iso) => (iso ? fmt.format(new Date(iso)) : '—'),
    day: (d) => (d ? fmtDay.format(new Date(`${d}T00:00:00Z`)) : '—'),
  };
}
export const I18nContext = createContext<I18n>(makeI18n('en', () => {}));
export const useI18n = (): I18n => useContext(I18nContext);
