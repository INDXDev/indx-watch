/** Shared building blocks: data loading, status badges, rich text with literals and placeholders. */
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { type MsgKey, pick, pickList, segments, useI18n } from './i18n';

export * from './focus';
export * from './people';

export interface Loadable<T> {
  data?: T | undefined;
  error?: string | undefined;
  /** API error code (e.g. 'no-snapshot') */
  code?: string | undefined;
  reload(): void;
}
/** Run an async loader when deps change; keeps the previous data while reloading. */
export function useApi<T>(load: () => Promise<T>, deps: readonly unknown[]): Loadable<T> {
  const [state, setState] = useState<{ data?: T; error?: string; code?: string }>({});
  const [tick, setTick] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: deps are passed by the caller
  useEffect(() => {
    let live = true;
    load().then(
      (data) => live && setState({ data }),
      (e: unknown) =>
        live &&
        setState({
          error: e instanceof Error ? e.message : String(e),
          code: (e as { code?: string }).code,
        }),
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
      <span className="badge-text">{t(`status.${status}` as MsgKey)}</span>
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

/** "Show original": one switch for every content field on the page (docs/spec/web.md#languages). */
export const OriginalContext = createContext<{ original: boolean; toggle(): void }>({
  original: false,
  toggle: () => {},
});

/**
 * A translatable content field: picks the translation for the UI locale and flags outdated ones.
 * `mark` shows the "Machine translation" switch (use it once per item, on its title).
 */
type TxProps = { of: unknown; field: string; values?: Record<string, string> | undefined; mark?: boolean };
export function Tx({ of, field, values, mark }: TxProps) {
  const { locale, t } = useI18n();
  const { original, toggle } = useContext(OriginalContext);
  const l = pick(of, field, locale);
  const source = (of as Record<string, unknown> | null)?.[field];
  const text = original && typeof source === 'string' ? source : l.text;
  return (
    <>
      <Rich text={text} values={values} />
      {l.machine && mark && (
        <button
          type="button"
          className="chip chip-machine tx-badge"
          title={t('i18n.machineHint')}
          aria-pressed={original}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            toggle();
          }}
        >
          {t(original ? 'i18n.showTranslation' : 'i18n.machine')}
        </button>
      )}
      {l.outdated && (
        <span className="chip chip-warn tx-badge" title={t('i18n.outdatedHint')}>
          {t('i18n.outdated')}
        </span>
      )}
    </>
  );
}
export const txt = (of: unknown, field: string, locale: 'en' | 'ja') => pick(of, field, locale).text;
/** The text of a content field in the chosen language, or the source while "Show original" is on. */
export function useTxt() {
  const { locale } = useI18n();
  const { original } = useContext(OriginalContext);
  return (of: unknown, field: string) => {
    const source = (of as Record<string, unknown> | null)?.[field];
    return original && typeof source === 'string' ? source : pick(of, field, locale).text;
  };
}
/** A step's `checks` in the chosen language, or the source while "Show original" is on. */
export function useChecks() {
  const { locale } = useI18n();
  const { original } = useContext(OriginalContext);
  return (step: { checks?: string[] | undefined }) =>
    original ? (step.checks ?? []) : pickList(step, 'checks', locale);
}

type SectionProps = { title: ReactNode; actions?: ReactNode; children: ReactNode; id?: string };
/** A card with a heading, optional header actions and an id-linked label. */
export function Section({ title, actions, children, id }: SectionProps) {
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

/** A table head row: each column is a message key, or [key, className]. */
export function THead({ cols }: { cols: (MsgKey | [MsgKey, string])[] }) {
  const { t } = useI18n();
  return (
    <thead>
      <tr>
        {cols.map((c) => {
          const [key, className] = typeof c === 'string' ? [c] : c;
          return (
            <th key={key} className={className}>
              {t(key)}
            </th>
          );
        })}
      </tr>
    </thead>
  );
}
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

// ---------- copy, menus, dialogs ----------
/** A command or value with a copy button. */
export function Copy({ text, label }: { text: string; label?: string }) {
  const { t } = useI18n();
  const [done, setDone] = useState(false);
  const copy = async (e: React.MouseEvent<HTMLButtonElement>) => {
    const shown = e.currentTarget.previousElementSibling;
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch {
      // clipboard blocked or unavailable (insecure context, denied permission): select the text to copy by hand
      if (shown) window.getSelection()?.selectAllChildren(shown);
    }
  };
  return (
    <div className="copy">
      {label && <span className="copy-label">{label}</span>}
      <code className="copy-text">{text}</code>
      <button type="button" className="btn btn-sm" onClick={copy} aria-label={t('common.copyThis', { text })}>
        {done ? `✓ ${t('common.copied')}` : t('common.copy')}
      </button>
    </div>
  );
}

/** A button with a popover panel that closes on Escape and outside clicks. */
export function Popover({
  label,
  button,
  className,
  children,
}: {
  label: string;
  button: ReactNode;
  className?: string;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onDown = (e: PointerEvent) =>
      !(e.target as Element).closest?.(`[data-pop="${CSS.escape(id)}"]`) && setOpen(false);
    const off = new AbortController();
    window.addEventListener('keydown', onKey, off);
    window.addEventListener('pointerdown', onDown, off);
    return () => off.abort();
  }, [open, id]);
  return (
    <div className="pop" data-pop={id}>
      <button
        type="button"
        className={className ?? 'btn btn-ghost'}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={label}
        onClick={() => setOpen(!open)}
      >
        {button}
      </button>
      {open && (
        <div className="pop-panel" role="dialog" aria-label={label}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

/** A modal dialog on the native <dialog> element. */
export function Dialog({
  open,
  title,
  onClose,
  children,
  wide,
}: {
  open: boolean;
  title: string;
  onClose(): void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal?.();
    if (!open && d.open) d.close();
  }, [open]);
  const { t } = useI18n();
  return (
    <dialog ref={ref} className={`dialog${wide ? ' dialog-wide' : ''}`} onClose={onClose} aria-label={title}>
      <header className="dialog-head">
        <h2>{title}</h2>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onClose}
          aria-label={t('common.close')}
        >
          ✕
        </button>
      </header>
      {open && children}
    </dialog>
  );
}
