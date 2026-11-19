/** Shared building blocks: data loading, status badges, rich text with literals and placeholders. */
import { type ReactNode, useCallback, useEffect, useId, useState } from 'react';
import { type MsgKey, pick, segments, useI18n } from './i18n';

export interface Loadable<T> {
  data?: T | undefined;
  error?: string | undefined;
  reload(): void;
}
/** Run an async loader when deps change; keeps the previous data while reloading. */
export function useApi<T>(load: () => Promise<T>, deps: readonly unknown[]): Loadable<T> {
  const [state, setState] = useState<{ data?: T; error?: string }>({});
  const [tick, setTick] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: deps are passed by the caller
  useEffect(() => {
    let live = true;
    load().then(
      (data) => live && setState({ data }),
      (e: unknown) => live && setState({ error: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      live = false;
    };
  }, [...deps, tick]);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { ...state, reload };
}

/** Render children once data is there; otherwise a loading line or the error. */
export function Load<T>({ state, children }: { state: Loadable<T>; children: (data: T) => ReactNode }) {
  const { t } = useI18n();
  if (state.error)
    return (
      <div className="callout s-fail" role="alert">
        <Icon status="fail" /> {t('common.error', { message: state.error })}
      </div>
    );
  if (state.data === undefined)
    return (
      <p className="muted" aria-busy="true">
        {t('common.loading')}
      </p>
    );
  return <>{children(state.data)}</>;
}

const ICONS: Record<string, string> = {
  pass: '✓',
  done: '✓',
  fail: '✕',
  needs_review: '?',
  review: '?',
  stale: '↻',
  blocked: '‖',
  untested: '○',
  todo: '○',
  waived: '≈',
  uncovered: '!',
  skipped: '»',
};
const CLASS: Record<string, string> = { done: 'pass', review: 'needs_review', todo: 'untested' };

export const Icon = ({ status }: { status: string }) => (
  <span className="icon" aria-hidden="true">
    {ICONS[status] ?? '•'}
  </span>
);

/** Status, verdict or plan-item status: always color + icon + word. */
export function Badge({ status, size }: { status: string; size?: 'lg' }) {
  const { t } = useI18n();
  return (
    <span className={`badge s-${CLASS[status] ?? status}${size ? ` badge-${size}` : ''}`}>
      <Icon status={status} />
      {t(`status.${status}` as MsgKey)}
    </span>
  );
}

/** Neutral chip for lifecycle values (draft, ready, P0, manual …). */
export const Chip = ({ children, tone }: { children: ReactNode; tone?: 'accent' | 'warn' }) => (
  <span className={`chip${tone ? ` chip-${tone}` : ''}`}>{children}</span>
);

export const Priority = ({ p }: { p: string }) => <span className={`prio prio-${p}`}>{p}</span>;

/** Text with literal on-screen strings and fixture placeholders marked; placeholders resolve when values are given. */
export function Rich({ text, values }: { text: string; values?: Record<string, string> | undefined }) {
  return (
    <>
      {segments(text).map((s, i) => {
        const key = `${i}${s.kind}`;
        if (s.kind === 'literal')
          return (
            <span key={key} className="literal">
              {s.text}
            </span>
          );
        if (s.kind === 'placeholder') {
          const ref = s.text.slice(2, -2).trim();
          const v = values?.[ref];
          return (
            <code key={key} className="placeholder" title={ref}>
              {v ?? ref}
            </code>
          );
        }
        return <span key={key}>{s.text}</span>;
      })}
    </>
  );
}

/** A translatable content field: picks the translation for the UI locale and flags outdated ones. */
export function Tx({
  of,
  field,
  values,
}: {
  of: unknown;
  field: string;
  values?: Record<string, string> | undefined;
}) {
  const { locale, t } = useI18n();
  const l = pick(of, field, locale);
  return (
    <>
      <Rich text={l.text} values={values} />
      {l.outdated && (
        <span className="chip chip-warn tx-badge" title={t('i18n.outdatedHint')}>
          {t('i18n.outdated')}
        </span>
      )}
    </>
  );
}
export const txt = (of: unknown, field: string, locale: 'en' | 'ja') => pick(of, field, locale).text;

export function Section({
  title,
  actions,
  children,
  id,
}: {
  title: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section className="card" id={id} aria-labelledby={id ? `${id}-h` : undefined}>
      <header className="card-head">
        <h2 id={id ? `${id}-h` : undefined}>{title}</h2>
        {actions && <div className="actions">{actions}</div>}
      </header>
      {children}
    </section>
  );
}

export function Meta({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="meta">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

export const shortId = (id: string) => `${id.slice(0, 12)}…`;
export const fmtBytes = (n: number) =>
  n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;

/** A segmented choice built from real radio inputs. `status` colors each option by its status and adds the icon. */
export function Seg<T extends string>(props: {
  label: string;
  value: T | undefined;
  options: readonly T[];
  text: (v: T) => ReactNode;
  onChange: (v: T) => void;
  status?: boolean;
  lg?: boolean;
}) {
  const name = useId();
  const { label, value, options, text, onChange, status, lg } = props;
  return (
    <fieldset className={`seg${status ? ' seg-status' : ''}${lg ? ' seg-lg' : ''}`}>
      <legend className="sr">{label}</legend>
      {options.map((o) => (
        <label key={o} className={status ? `s-${o}` : undefined}>
          <input type="radio" className="sr" name={name} checked={value === o} onChange={() => onChange(o)} />
          {status && <Icon status={o} />}
          {text(o)}
        </label>
      ))}
    </fieldset>
  );
}
