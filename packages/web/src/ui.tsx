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
import { type MsgKey, pick, segments, useI18n } from './i18n';

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
export function Tx({
  of,
  field,
  values,
  mark,
}: {
  of: unknown;
  field: string;
  values?: Record<string, string> | undefined;
  mark?: boolean;
}) {
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

// ---------- people (docs/spec/web.md#identity) ----------
type Person = { kind: string; id: string; name?: string | undefined; via: string };
const VERIFIED = new Set(['cloudflare-access', 'github-oidc', 'github']);
export const isVerified = (a: Person) => VERIFIED.has(a.via);
export const personName = (a: Person) => a.name ?? a.id;
/** Initials and a stable hue from the ID. Pure; tested. */
export function avatarOf(a: Person): { initials: string; hue: number } {
  const base = personName(a)
    .replace(/@.*/, '')
    .replace(/^[a-z]+:/i, '');
  const words = base.split(/[\s._-]+/).filter(Boolean);
  const initials = (words.length > 1 ? `${words[0]![0]}${words[1]![0]}` : base.slice(0, 2)).toUpperCase();
  let h = 0;
  for (const c of a.id) h = (h * 31 + c.charCodeAt(0)) % 360;
  return { initials: initials || '?', hue: h };
}
export function Avatar({ who, size }: { who: Person; size?: 'sm' | 'lg' }) {
  const { initials, hue } = avatarOf(who);
  const kind = who.kind === 'agent' ? ' avatar-agent' : who.kind === 'ci' ? ' avatar-ci' : '';
  return (
    <span
      className={`avatar${size ? ` avatar-${size}` : ''}${kind}`}
      style={{ '--hue': hue } as object}
      aria-hidden="true"
    >
      {who.kind === 'ci' ? '⚙' : who.kind === 'agent' ? '✦' : initials}
    </span>
  );
}
/** Avatar, name and a verified mark. */
export function Who({ who }: { who: Person }) {
  const { t } = useI18n();
  return (
    <span className="who">
      <Avatar who={who} size="sm" />
      <span>{personName(who)}</span>
      {isVerified(who) && (
        <span className="verified" title={t('who.verified', { via: who.via })}>
          ✓
        </span>
      )}
    </span>
  );
}

/** One line of a feed: avatar, "<name> <verb> <link>", and when. */
export function FeedItem({ who, at, children }: { who: Person; at: string; children: ReactNode }) {
  const ago = useAgo();
  const { t } = useI18n();
  return (
    <li className="feed-item">
      <Avatar who={who} />
      <div className="feed-main">
        <p>
          <strong>{personName(who)}</strong>
          {isVerified(who) && (
            <span className="verified" title={t('who.verified', { via: who.via })}>
              {' '}
              ✓
            </span>
          )}{' '}
          {children}
        </p>
        <p className="muted small">{ago(at)}</p>
      </div>
    </li>
  );
}

/** "5 min ago" in the UI locale. */
export function useAgo() {
  const { locale, date } = useI18n();
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  return (iso: string) => {
    const s = (Date.now() - Date.parse(iso)) / 1000;
    if (!(s >= 0) || s > 7 * 86400) return date(iso);
    const [n, u]: [number, Intl.RelativeTimeFormatUnit] =
      s < 60
        ? [s, 'second']
        : s < 3600
          ? [s / 60, 'minute']
          : s < 86400
            ? [s / 3600, 'hour']
            : [s / 86400, 'day'];
    return rtf.format(-Math.floor(n), u);
  };
}

// ---------- copy, menus, dialogs ----------
export function Copy({ text, label }: { text: string; label?: string }) {
  const { t } = useI18n();
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch {
      // clipboard blocked: the text stays selectable
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
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
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

// ---------- List and Focus (docs/spec/web.md#list-and-focus) ----------
export function ViewSwitch({ view, list, focus }: { view: 'list' | 'focus'; list: string; focus?: string }) {
  const { t } = useI18n();
  return (
    <nav className="viewswitch" aria-label={t('view.label')}>
      <a href={list} aria-current={view === 'list' ? 'page' : undefined}>
        <span aria-hidden="true">☰</span> {t('view.list')}
      </a>
      <a href={focus ?? '#'} aria-current={view === 'focus' ? 'page' : undefined} aria-disabled={!focus}>
        <span aria-hidden="true">▢</span> {t('view.focus')}
      </a>
    </nav>
  );
}

const typing = (e: Event) => {
  const el = e.target as HTMLElement | null;
  return !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);
};
/** Previous/next of `at` in `items`. Pure; tested. */
export function neighbours(items: readonly string[], at: string) {
  const i = items.indexOf(at);
  return { index: i, prev: i > 0 ? items[i - 1] : undefined, next: i >= 0 ? items[i + 1] : undefined };
}

/** One item per screen with ← / → keys, swipes and footer buttons. `go` turns a key into a URL. */
export function Focus({
  items,
  at,
  go,
  actions,
  children,
}: {
  items: readonly string[];
  at: string;
  go: (key: string) => string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const { index, prev, next } = neighbours(items, at);
  const start = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e) || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const to = e.key === 'ArrowLeft' ? prev : e.key === 'ArrowRight' ? next : undefined;
      if (to) window.location.hash = go(to).replace(/^#/, '');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [prev, next, go]);
  const onTouchEnd = (e: React.TouchEvent) => {
    const s = start.current;
    const p = e.changedTouches[0];
    start.current = null;
    if (!s || !p) return;
    const [dx, dy] = [p.clientX - s.x, p.clientY - s.y];
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    const to = dx < 0 ? next : prev;
    if (to) window.location.hash = go(to).replace(/^#/, '');
  };
  return (
    <div
      className="focus"
      onTouchStart={(e) => {
        const p = e.touches[0];
        start.current = p ? { x: p.clientX, y: p.clientY } : null;
      }}
      onTouchEnd={onTouchEnd}
    >
      {index >= 0 && (
        <div className="focus-pos" aria-live="polite">
          {t('view.position', { n: index + 1, total: items.length })}
          <span className="dots" aria-hidden="true">
            {items.length <= 24 &&
              items.map((k, i) => <span key={k} className={i === index ? 'dot dot-on' : 'dot'} />)}
          </span>
        </div>
      )}
      <div className="focus-body" key={at}>
        {children}
      </div>
      <nav className="focus-nav" aria-label={t('view.nav')}>
        {prev ? (
          <a className="btn" href={go(prev)} rel="prev">
            ← {t('view.prev')}
          </a>
        ) : (
          <span />
        )}
        <div className="focus-actions">{actions}</div>
        {next ? (
          <a className="btn" href={go(next)} rel="next">
            {t('view.next')} →
          </a>
        ) : (
          <span />
        )}
      </nav>
      <p className="muted small focus-hint">{t('view.hint')}</p>
    </div>
  );
}
