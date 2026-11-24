'use client';

/**
 * Building blocks of the product demo: timing helpers, window frames, the INDX Watch app header, status
 * pills and the pointer. Every scene is a pure function of `ms`, the time since its chapter started, so a
 * frame can be rendered at any moment (and the reduced-motion view simply renders the last one).
 */
import { createContext, Fragment, type ReactNode, useContext, useLayoutEffect, useRef, useState } from 'react';
import type { DemoText } from '@/content/types';

/** The scene's clock, in milliseconds since the chapter started. */
export const Clock = createContext(0);
export const useMs = () => useContext(Clock);

/** The first characters of `text` typed since `start`, at `cps` characters per second. */
export function typed(text: string, ms: number, start: number, cps = 24): string {
  if (ms < start) return '';
  return text.slice(0, Math.floor(((ms - start) * cps) / 1000));
}

/** Milliseconds `typed` needs for `text`. */
export const typeTime = (text: string, cps = 24) => Math.ceil((text.length * 1000) / cps);

/** How many of `count` items are shown when one appears every `gap` ms from `start`. */
export function revealed(ms: number, start: number, gap: number, count: number): number {
  if (ms < start) return 0;
  return Math.min(count, Math.floor((ms - start) / gap) + 1);
}

/**
 * Inline text of the app: “quoted” and "quoted" strings get the literal highlight of the real app, `code`
 * becomes a test data value and **bold** stays bold.
 */
export function AppText({ text }: { text: string }) {
  return (
    <>
      {text.split(/(“[^”]+”|"[^"]+"|「[^」]+」|`[^`]+`|\*\*[^*]+\*\*)/).map((part, i) => {
        const key = `${i}:${part}`;
        if (/^(“.+”|".+")$/.test(part))
          return (
            <span key={key} className="dm-lit">
              "{part.slice(1, -1)}"
            </span>
          );
        if (/^「.+」$/.test(part))
          return (
            <span key={key} className="dm-lit">
              「{part.slice(1, -1)}」
            </span>
          );
        if (part.startsWith('`') && part.endsWith('`') && part.length > 2)
          return (
            <span key={key} className="dm-fx">
              {part.slice(1, -1)}
            </span>
          );
        if (part.startsWith('**') && part.endsWith('**') && part.length > 4)
          return <strong key={key}>{part.slice(2, -2)}</strong>;
        return <Fragment key={key}>{part}</Fragment>;
      })}
    </>
  );
}

/** A browser window with an address bar. */
export function Browser({
  url,
  className,
  children,
}: {
  url: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`dm-window dm-browser ${className ?? ''}`}>
      <div className="dm-titlebar">
        <span className="dm-lights">
          <i />
          <i />
          <i />
        </span>
        <span className="dm-url">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" />
            <path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7" />
          </svg>
          {url}
        </span>
      </div>
      <div className="dm-viewport">{children}</div>
    </div>
  );
}

/** A terminal window (always dark). */
export function Terminal({
  title,
  className,
  children,
}: {
  title: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`dm-window dm-term ${className ?? ''}`}>
      <div className="dm-titlebar">
        <span className="dm-lights">
          <i />
          <i />
          <i />
        </span>
        <span className="dm-title">{title}</span>
      </div>
      <div className="dm-term-body">{children}</div>
    </div>
  );
}

/** The INDX Watch mark as the app draws it. */
export function AppLogo() {
  return (
    <svg className="dm-logo" viewBox="0 0 16 16" aria-hidden="true">
      <rect width="16" height="16" rx="3.5" />
      <path d="M4 8.5l2.5 2.5L12 5" />
    </svg>
  );
}

/** The app's header: brand, project, the five screens, release scope, upload, CLI, language and avatar. */
export function AppHeader({ app, active, avatar }: { app: DemoText['app']; active: number; avatar: string }) {
  return (
    <div className="dm-app-header">
      <span className="dm-brand">
        <AppLogo />
        INDX Watch
        <span className="dm-project">Shop</span>
      </span>
      <span className="dm-nav">
        {app.nav.map((item, i) => (
          <span key={item} className={i === active ? 'on' : ''}>
            {item}
          </span>
        ))}
      </span>
      <span className="dm-scope">
        <b>v1.2.0</b>
        <span>{app.allEnvironments}</span>
      </span>
      <span className="dm-hbtn">⇪ {app.upload}</span>
      <span className="dm-hbtn">&gt;_ CLI</span>
      <span className="dm-avatar">{avatar}</span>
    </div>
  );
}

export type Tone = 'pass' | 'fail' | 'untested' | 'review' | 'uncovered';

const ICON: Record<Tone, string> = { pass: '✓', fail: '✕', untested: '○', review: '?', uncovered: '!' };

/** A status pill: always an icon and a word, never color alone (docs/design/tokens.css). */
export function Pill({ tone, children, small }: { tone: Tone; children: ReactNode; small?: boolean }) {
  return (
    <span className={`dm-pill dm-${tone} ${small ? 'dm-pill-sm' : ''}`}>
      <span aria-hidden="true">{ICON[tone]}</span> {children}
    </span>
  );
}

export function Priority({ p }: { p: string }) {
  return <span className={`dm-prio ${p === 'P0' ? 'dm-p0' : ''}`}>{p}</span>;
}

/**
 * The pointer. It glides to the element marked `data-target={target}` inside its positioned parent and
 * shows a ripple while `click` is true. Positions are measured in the canvas' own pixels, so they hold at
 * any scale of the stage.
 */
export function Pointer({ target, click }: { target: string | null; click?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number; jump: boolean } | null>(null);
  // Measured after every render: steps open and close, so a target can move without changing its name.
  useLayoutEffect(() => {
    const host = ref.current?.parentElement;
    if (!host || !target) return;
    const el = host.querySelector<HTMLElement>(`[data-target="${target}"]`);
    if (!el) return;
    const a = host.getBoundingClientRect();
    const b = el.getBoundingClientRect();
    const scale = a.width / host.offsetWidth || 1;
    const x = (b.left - a.left + Math.min(b.width * 0.55, 60)) / scale;
    const y = (b.top - a.top + b.height * 0.6) / scale;
    setPos((p) => {
      if (p && Math.abs(p.x - x) < 0.5 && Math.abs(p.y - y) < 0.5) return p.jump ? { ...p, jump: false } : p;
      return { x, y, jump: !p };
    });
  });
  return (
    <div
      ref={ref}
      className={`dm-pointer ${click ? 'is-click' : ''} ${pos && target ? 'is-on' : ''} ${pos?.jump ? 'is-jump' : ''}`}
      style={pos ? { transform: `translate(${pos.x}px, ${pos.y}px)` } : undefined}
      aria-hidden="true"
    >
      <svg viewBox="0 0 24 24">
        <path d="M5 3.5v15.2l4.1-3.9 2.6 6 2.6-1.1-2.6-5.9 5.7-.3z" />
      </svg>
    </div>
  );
}

/** The latest entry of a timeline `[[ms, value], …]` that has started by `ms`. */
export function at<T>(ms: number, timeline: [number, T][], fallback: T): T {
  let value = fallback;
  for (const [start, v] of timeline) if (ms >= start) value = v;
  return value;
}

/**
 * A scrolling page inside a window: it slides so that the element marked `data-target={to}` sits `offset`
 * pixels below the top (or back to the top when `to` is null), never past the end of the content.
 */
export function ScrollView({ to, offset = 24, children }: { to: string | null; offset?: number; children: ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [y, setY] = useState(0);
  useLayoutEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (!o || !i) return;
    let next = 0;
    if (to) {
      const el = i.querySelector<HTMLElement>(`[data-target="${to}"]`);
      if (el) {
        const a = i.getBoundingClientRect();
        const scale = a.width / i.offsetWidth || 1;
        const top = (el.getBoundingClientRect().top - a.top) / scale;
        next = Math.max(0, Math.min(top - offset, i.offsetHeight - o.offsetHeight));
      }
    }
    setY((prev) => (Math.abs(prev - next) < 1 ? prev : next));
  });
  return (
    <div ref={outer} className="dm-scroll">
      <div ref={inner} className="dm-scroll-inner" style={{ transform: `translateY(${-y}px)` }}>
        {children}
      </div>
    </div>
  );
}
