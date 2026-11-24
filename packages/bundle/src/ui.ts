/**
 * Customizing without code (docs/spec/bundle-format.md#customizing-v05): `ui/messages.<locale>.json` and `ui/theme.toml`.
 * Pure: reads through a BundleFs, validates, and turns a theme into CSS. Unknown message keys are checked with the
 * English catalog the caller passes in, because the texts live in the web package.
 */
import { parseToml } from './toml.js';
import type { BundleFs, Problem } from './types.js';

export const UI_LOCALES = ['en', 'ja'] as const;
export type UiLocale = (typeof UI_LOCALES)[number];
export interface Theme {
  light?: Record<string, string>;
  dark?: Record<string, string>;
  common?: Record<string, string>;
}
export interface Ui {
  messages: Partial<Record<UiLocale, Record<string, string>>>;
  theme?: Theme;
  /** `[report].logo` as a data URI, when the file is usable */
  logo?: string;
}

type Kind = 'color' | 'font' | 'size';
const colors = Object.fromEntries(
  'accent accent-hover accent-text accent-soft focus bg surface surface-2 border border-strong text text-muted'
    .split(' ')
    .map((k) => [k, 'color' as Kind]),
);
/** tokens of packages/web/src/tokens.css a theme may set, and what each takes */
export const THEME_TOKENS: Record<keyof Theme, Record<string, Kind>> = {
  light: colors,
  dark: colors,
  common: {
    'font-sans': 'font',
    'font-mono': 'font',
    'radius-sm': 'size',
    radius: 'size',
    'radius-lg': 'size',
  },
};
const VALUE: Record<Kind, RegExp> = {
  color: /^(#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|(?:rgb|hsl)a?\([\d\s.,%/-]{1,40}\))$/i,
  font: /^[\w\s"',.-]{1,200}$/,
  size: /^\d{1,3}(?:\.\d+)?(?:px|rem)$/,
};
/** a text on a background that must stay readable (WCAG AA) */
const PAIRS = [
  ['text', 'bg'],
  ['text', 'surface'],
  ['text-muted', 'bg'],
  ['accent-text', 'accent'],
] as const;
const MARKUP = /<[a-z/!?]|&[a-z#][a-z0-9]*;/i;
const dec = new TextDecoder();
const problem = (code: string, file: string, message: string, path?: string): Problem => ({
  severity: 'error',
  code,
  file,
  message,
  ...(path && { path }),
});

function luminance(hex: string): number | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex);
  if (!m) return null;
  const h = m[1]!.length === 3 ? [...m[1]!].map((c) => c + c).join('') : m[1]!;
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = Number.parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** The valid part of a parsed theme with its problems: unknown tables and tokens, unsafe values, pairs below 4.5:1 (warning). */
function themeOf(file: string, raw: Record<string, unknown>): { theme: Theme; problems: Problem[] } {
  const [problems, theme] = [[] as Problem[], {} as Theme];
  for (const [table, body] of Object.entries(raw)) {
    const allowed = THEME_TOKENS[table as keyof Theme];
    if (!allowed || typeof body !== 'object' || body === null || Array.isArray(body)) {
      const message = `Unknown table "${table}"; use [light], [dark] or [common]`;
      problems.push(problem('invalid-ui', file, message, table));
      continue;
    }
    const ok: Record<string, string> = {};
    for (const [token, value] of Object.entries(body)) {
      const [kind, path] = [allowed[token], `${table}.${token}`];
      if (!kind)
        problems.push(problem('unknown-ui-key', file, `"${token}" cannot be themed in [${table}]`, path));
      else if (typeof value !== 'string' || !VALUE[kind].test(value))
        problems.push(problem('invalid-ui', file, `[${table}] ${token} must be a plain ${kind}`, path));
      else ok[token] = value;
    }
    theme[table as keyof Theme] = ok;
  }
  for (const mode of ['light', 'dark'] as const)
    for (const [fg, bg] of PAIRS) {
      const [a, b] = [luminance(theme[mode]?.[fg] ?? ''), luminance(theme[mode]?.[bg] ?? '')];
      if (a === null || b === null) continue;
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      const message = `[${mode}] ${fg} on ${bg} is ${ratio.toFixed(1)}:1; 4.5:1 reads well`;
      if (ratio < 4.5) problems.push({ ...problem('low-contrast', file, message), severity: 'warning' });
    }
  return { theme, problems };
}

/** One `messages.<locale>.json`: its valid texts and problems. */
function messagesOf(file: string, text: string): { texts?: Record<string, string>; problems: Problem[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { problems: [problem('invalid-ui', file, `Not valid JSON: ${(e as Error).message}`)] };
  }
  if (typeof raw !== 'object' || !raw || Array.isArray(raw))
    return { problems: [problem('invalid-ui', file, 'Must be one object of message keys to texts')] };
  const [texts, problems] = [{} as Record<string, string>, [] as Problem[]];
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v !== 'string' || v.length > 500)
      problems.push(problem('invalid-ui', file, `"${k}" must be a text of up to 500 characters`, k));
    else if (MARKUP.test(v))
      problems.push(problem('ui-markup', file, `"${k}" has markup; write plain text`, k));
    else texts[k] = v;
  }
  return { texts, problems };
}

/** Read `ui/` (its valid parts only) with the problems found; `paths` are all bundle paths. */
export async function loadUi(
  fs: BundleFs,
  paths: string[],
  logo?: string,
): Promise<{ ui?: Ui; problems: Problem[] }> {
  const [problems, ui]: [Problem[], Ui] = [[], { messages: {} }];
  const text = async (f: string) => dec.decode((await fs.read(f)) ?? new Uint8Array());
  for (const file of paths.filter((p) => /^ui\/messages\.[^/]+\.json$/.test(p))) {
    const locale = file.slice(12, -5) as UiLocale;
    if (!UI_LOCALES.includes(locale)) {
      problems.push(
        problem('invalid-ui', file, `Unknown locale "${locale}"; use ${UI_LOCALES.join(' or ')}`),
      );
      continue;
    }
    const m = messagesOf(file, await text(file));
    problems.push(...m.problems);
    if (m.texts) ui.messages[locale] = m.texts;
  }
  if (paths.includes('ui/theme.toml')) {
    try {
      const t = themeOf('ui/theme.toml', parseToml(await text('ui/theme.toml')));
      ui.theme = t.theme;
      problems.push(...t.problems);
    } catch (e) {
      problems.push(problem('invalid-toml', 'ui/theme.toml', (e as Error).message.split('\n')[0]!));
    }
  }
  if (logo && !(await logoProblem(fs, logo))) {
    const [bytes, ext] = [(await fs.read(logo))!, logo.split('.').pop()!.toLowerCase()];
    const type = { svg: 'svg+xml', jpg: 'jpeg' }[ext] ?? ext;
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000)
      bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    ui.logo = `data:image/${type};base64,${btoa(bin)}`;
  }
  return { ui: Object.keys(ui.messages).length || ui.theme || ui.logo ? ui : undefined, problems };
}

const holes = (s: string) => [...new Set([...s.matchAll(/\{(\w+)(?=[,}])/g)].map((m) => m[1]))].sort().join();
/** Overrides of keys the app does not have, or that change the `{placeholders}` of the original (`known`: English texts). */
export function uiKeyProblems(ui: Ui | undefined, known: Record<string, string>): Problem[] {
  return Object.entries(ui?.messages ?? {}).flatMap(([locale, texts]) =>
    Object.entries(texts ?? {}).flatMap(([key, text]): Problem[] => {
      const file = `ui/messages.${locale}.json`;
      if (!(key in known)) return [problem('unknown-ui-key', file, `Unknown message key "${key}"`, key)];
      if (holes(text) === holes(known[key]!)) return [];
      const message = `"${key}" must keep the placeholders of the original text: ${holes(known[key]!) || 'none'}`;
      return [problem('ui-placeholder', file, message, key)];
    }),
  );
}

/** CSS for a theme: light and common tokens always, dark ones by the system setting or `data-theme="dark"`. */
export function themeCss(theme: Theme | undefined): string {
  const decl = (o?: Record<string, string>) =>
    Object.entries(o ?? {})
      .map(([k, v]) => `--${k}:${v};`)
      .join('');
  const [base, dark] = [decl({ ...theme?.common, ...theme?.light }), decl(theme?.dark)];
  return [
    base && `:root{${base}}`,
    dark && `@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){${dark}}}`,
    dark && `:root[data-theme="dark"]{${dark}}`,
  ]
    .filter(Boolean)
    .join('\n');
}

/** Why `[report].logo` cannot be used (null: it can). */
export async function logoProblem(fs: BundleFs, logo: string): Promise<string | null> {
  if (!/^ui\/[^/]+\.(png|jpe?g|webp|svg)$/i.test(logo))
    return 'must be a .png, .jpg, .webp or .svg file in ui/';
  const bytes = await fs.read(logo);
  if (!bytes) return 'file not found';
  return bytes.length > 200_000 ? 'is larger than 200 KB' : null;
}
