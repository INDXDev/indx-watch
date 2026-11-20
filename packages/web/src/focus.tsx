/** List and Focus (docs/spec/web.md#list-and-focus): the view switch and the one-item-per-screen Focus view. */
import { type ReactNode, useEffect, useRef } from 'react';
import { useI18n } from './i18n';

/** The List / Focus links in a page head; Focus is disabled when there is no item to open. */
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

type Nav = { prev: string | undefined; next: string | undefined; go: (key: string) => string };
const visit = (go: Nav['go'], to: string | undefined) => {
  if (to) window.location.hash = go(to).replace(/^#/, '');
};

/** ← / → keys (outside form fields, without modifiers) move to the previous / next item. */
function useArrowKeys({ prev, next, go }: Nav) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e) || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      visit(go, e.key === 'ArrowLeft' ? prev : e.key === 'ArrowRight' ? next : undefined);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [prev, next, go]);
}

/** Touch handlers: a mostly horizontal swipe of at least 60px moves to the next (left) or previous (right) item. */
function useSwipe({ prev, next, go }: Nav) {
  const start = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    const p = e.touches[0];
    start.current = p ? { x: p.clientX, y: p.clientY } : null;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const s = start.current;
    const p = e.changedTouches[0];
    start.current = null;
    if (!s || !p) return;
    const [dx, dy] = [p.clientX - s.x, p.clientY - s.y];
    if (Math.abs(dx) >= 60 && Math.abs(dx) >= Math.abs(dy) * 1.5) visit(go, dx < 0 ? next : prev);
  };
  return { onTouchStart, onTouchEnd };
}

/** One item per screen with ← / → keys, swipes and footer buttons. `go` turns a key into a URL. */
export function Focus(props: {
  items: readonly string[];
  at: string;
  go: (key: string) => string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { items, at, go, actions, children } = props;
  const { t } = useI18n();
  const { index, prev, next } = neighbours(items, at);
  useArrowKeys({ prev, next, go });
  const link = (to: string | undefined, rel: 'prev' | 'next', label: string) =>
    to ? (
      <a className="btn" href={go(to)} rel={rel}>
        {label}
      </a>
    ) : (
      <span />
    );
  return (
    <div className="focus" {...useSwipe({ prev, next, go })}>
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
        {link(prev, 'prev', `← ${t('view.prev')}`)}
        <div className="focus-actions">{actions}</div>
        {link(next, 'next', `${t('view.next')} →`)}
      </nav>
      <p className="muted small focus-hint">{t('view.hint')}</p>
    </div>
  );
}
